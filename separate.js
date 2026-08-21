/* Separation panel: owns the worker's lifecycle and the UI around it.
 * Loaded only over HTTP — see the injection guard in index.html. */

import { encodeWav } from './lib/wav.js?v=1.4.0';
import { buildZip } from './lib/zip.js?v=1.4.0';

const el = {
  panel:  document.getElementById('sep'),
  go:     document.getElementById('sep-go'),
  save:   document.getElementById('sep-save'),
  cancel: document.getElementById('sep-cancel'),
  status: document.getElementById('sep-status'),
  bar:    document.getElementById('sep-bar'),
  fill:   document.getElementById('sep-fill'),
};

const MB = 1e6;
let worker = null;
let lastStems = null;
let lastName = 'song';

function setProgress(frac) {
  el.bar.hidden = frac === null;
  if (frac !== null) el.fill.style.width = `${Math.round(frac * 100)}%`;
}

function status(msg) { el.status.textContent = msg; }

function busy(on) {
  el.go.disabled = on;
  el.cancel.hidden = !on;
  // Save must not be reachable mid-run: the stems it would write are the *previous*
  // track's, and encoding them competes with the worker for memory.
  el.save.disabled = on;
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker('separate.worker.js?v=1.4.0', { type: 'module' });
  return worker;
}

/**
 * The panel is for a single unseparated track — but it must stay up after a successful
 * run, or the Save button vanishes 400 ms after the stems appear.
 */
function refresh() {
  const single = window.sansBass?.isSingleTrack?.();
  if (single) {
    el.panel.hidden = false;
    el.go.hidden = false;             // a fresh unseparated song can be separated again
    el.save.hidden = true;
    lastStems = null;                 // a newly loaded song invalidates old results
  } else if (!lastStems) {
    el.panel.hidden = true;           // a stems folder was loaded directly
  }
}

el.go.addEventListener('click', () => {
  const mix = window.sansBass.currentMix();
  if (!mix) return;

  const dur = mix.buffer.duration;
  if (dur > 8 * 60 &&
      !confirm(`This track is ${Math.round(dur / 60)} minutes long. Separation holds every ` +
               `stem in memory and may exhaust it. Continue?`)) {
    return;
  }

  lastName = mix.name.replace(/\.[^.]+$/, '');   // "1 基隆路.flac" -> "1 基隆路"
  const left = mix.buffer.getChannelData(0).slice();
  const right = (mix.buffer.numberOfChannels > 1
    ? mix.buffer.getChannelData(1)
    : mix.buffer.getChannelData(0)).slice();

  const w = getWorker();
  busy(true);
  status('loading model…');
  setProgress(0);

  // A worker killed by the OOM reaper never posts anything. Without this the UI
  // would sit on a progress bar for ever.
  w.onerror = (err) => {
    busy(false);
    setProgress(null);
    status(`worker failed: ${err.message || 'out of memory?'} — try a shorter track`);
    worker = null;
  };

  w.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'download') {
      status(`downloading model ${(m.loaded / MB).toFixed(0)} / ${(m.total / MB).toFixed(0)} MB`);
      setProgress(m.total ? m.loaded / m.total : 0);
    } else if (m.type === 'ready') {
      status(m.backend === 'webgpu'
        ? 'separating on GPU…'
        : 'separating on CPU — no WebGPU here, so this will take many minutes');
      setProgress(0);
    } else if (m.type === 'progress') {
      status(`segment ${m.segment}/${m.total} — about ${Math.ceil(m.etaSec)}s left`);
      setProgress(m.segment / m.total);
    } else if (m.type === 'log') {
      console.log('[separate]', m.message);
    } else if (m.type === 'result') {
      lastStems = m.stems;
      busy(false);
      setProgress(null);
      status('');                      // the six lanes appearing is the confirmation
      el.go.hidden = true;             // this song is separated; nothing left to separate
      el.save.hidden = false;
      window.sansBass.loadSeparated({ name: lastName, buffer: mix.buffer }, m.stems);
      el.panel.hidden = false;         // keep the panel up so Save stays reachable
    } else if (m.type === 'error') {
      busy(false);
      setProgress(null);
      status(m.message === 'cancelled' ? 'cancelled' : `failed: ${m.message}`);
    }
  };

  w.postMessage({ type: 'separate', left, right }, [left.buffer, right.buffer]);
});

el.cancel.addEventListener('click', () => {
  worker?.postMessage({ type: 'cancel' });
  status('cancelling…');
});

el.save.addEventListener('click', async () => {
  if (!lastStems) return;
  el.save.disabled = true;
  status('encoding WAVs…');
  try {
    // Encode one stem at a time and hand each straight to the ZIP builder, so the WAV
    // bytes are never all live at once on top of the stems themselves.
    const entries = [];
    for (const [stem, ch] of Object.entries(lastStems)) {
      entries.push({ name: `${lastName}/${stem}.wav`, bytes: encodeWav(ch.left, ch.right, 44100) });
      await new Promise((r) => setTimeout(r, 0));   // let the UI repaint between stems
    }
    const blob = buildZip(entries);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${lastName}-stems.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    status(`saved ${(blob.size / MB).toFixed(0)} MB`);
  } catch (e) {
    status(`save failed: ${e.message}`);
  } finally {
    el.save.disabled = false;
  }
});

// The player has no load event, so poll for a track appearing. Cheap and avoids
// reaching into app.js internals.
setInterval(refresh, 400);
refresh();
