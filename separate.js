/* Separation panel: owns the worker's lifecycle and the UI around it.
 * Loaded as a plain module script: file:// support was dropped in v1.5.0. */

import { encodeWav } from './lib/wav.js?v=1.18.7';
import { buildZip } from './lib/zip.js?v=1.18.7';

const el = {
  panel:  document.getElementById('sep'),
  go:     document.getElementById('sep-go'),
  save:   document.getElementById('sep-save'),
  cancel: document.getElementById('sep-cancel'),
  status: document.getElementById('sep-status'),
  bar:    document.getElementById('sep-bar'),
  fill:   document.getElementById('sep-fill'),
  handheld: document.getElementById('sep-handheld'),
};

/* Separation cannot run on a phone or tablet — the first session.run() kills the tab. See
 * lib/platform.js for the evidence. Read once: the answer cannot change within a page
 * load, and refresh() runs every 400 ms. */
const HANDHELD = window.SansPlatform?.isHandheld() ?? false;

const MB = 1e6;
let worker = null;
let lastStems = null;
let lastName = 'song';

function setProgress(frac) {
  el.bar.hidden = frac === null;
  if (frac !== null) el.fill.style.width = `${Math.round(frac * 100)}%`;
}

const tr = (key, params) => window.SansI18n.t(key, params);

/* Analytics must never be able to break separation. A blocked or missing analytics
 * script degrades to a no-op rather than throwing out of an event handler. */
const gcTrack = (n) => { try { window.SansAnalytics?.track(n); } catch (e) { /* never */ } };
const gcOnce  = (n) => { try { window.SansAnalytics?.once(n);  } catch (e) { /* never */ } };

/* Same shape as app.js's say(): remember the key, not the rendered text, so a language
 * switch mid-separation re-renders the progress line instead of freezing it. */
let lastStatus = null;

/* A param whose value is ITSELF translated must be passed as a thunk and resolved at
 * render time. Resolving at call time stores the old locale's string, and the re-render
 * below then mixes the two — "worker failed: 記憶體不足？ — try a shorter track". */
function resolve(params) {
  if (!params) return params;
  const out = {};
  for (const [k, v] of Object.entries(params)) out[k] = typeof v === 'function' ? v() : v;
  return out;
}

function status(key, params) {
  lastStatus = key ? { key, params } : null;
  el.status.textContent = key ? tr(key, resolve(params)) : '';
}

window.addEventListener('sansbass:langchange', () => {
  if (lastStatus) el.status.textContent = tr(lastStatus.key, resolve(lastStatus.params));
});

function busy(on) {
  el.go.disabled = on;
  el.cancel.hidden = !on;
  // Save must not be reachable mid-run: the stems it would write are the *previous*
  // track's, and encoding them competes with the worker for memory.
  el.save.disabled = on;
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker('separate.worker.js?v=1.18.7', { type: 'module' });
  return worker;
}

/**
 * The panel is for a single unseparated track — but it must stay up after a successful
 * run, or the Save button vanishes 400 ms after the stems appear.
 */
function refresh() {
  if (HANDHELD) {
    // Same visibility rule as below — the panel belongs to a single unseparated song —
    // but its contents are the explanation, and the controls never come back.
    const single = window.sansBass?.isSingleTrack?.();
    el.panel.hidden = !single;
    // once(), not track(): refresh() runs on a 400 ms interval and track() would fire all
    // session. This counts visitors who were shown the message, exactly once each.
    if (single) gcOnce('separate-handheld-blocked');
    return;
  }

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
      !confirm(tr('sep.confirmLong', { min: Math.round(dur / 60) }))) {
    return;
  }

  gcTrack('separate-start');

  lastName = mix.name.replace(/\.[^.]+$/, '');   // "1 基隆路.flac" -> "1 基隆路"
  const left = mix.buffer.getChannelData(0).slice();
  const right = (mix.buffer.numberOfChannels > 1
    ? mix.buffer.getChannelData(1)
    : mix.buffer.getChannelData(0)).slice();

  const w = getWorker();
  busy(true);
  status('sep.loadingModel');
  setProgress(0);

  // A worker killed by the OOM reaper never posts anything. Without this the UI
  // would sit on a progress bar for ever.
  w.onerror = (err) => {
    gcTrack('separate-fail');
    busy(false);
    setProgress(null);
    status('sep.workerFailed', { msg: err.message || (() => tr('sep.oom')) });
    worker = null;
  };

  w.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'download') {
      status('sep.downloading', {
        loaded: (m.loaded / MB).toFixed(0), total: (m.total / MB).toFixed(0) });
      setProgress(m.total ? m.loaded / m.total : 0);
    } else if (m.type === 'ready') {
      gcTrack(m.backend === 'webgpu' ? 'separate-backend-webgpu' : 'separate-backend-wasm');
      // Explicit === true / === false: a null (model supplied directly) fires neither.
      if (m.cached === true) gcTrack('model-cached');
      else if (m.cached === false) gcTrack('model-download');
      status(m.backend === 'webgpu' ? 'sep.gpu' : 'sep.cpu');
      setProgress(0);
    } else if (m.type === 'progress') {
      status('sep.progress', { segment: m.segment, total: m.total, eta: Math.ceil(m.etaSec) });
      setProgress(m.segment / m.total);
    } else if (m.type === 'log') {
      console.log('[separate]', m.message);
    } else if (m.type === 'result') {
      gcTrack('separate-done');
      lastStems = m.stems;
      busy(false);
      setProgress(null);
      status('');                      // the six lanes appearing is the confirmation
      el.go.hidden = true;             // this song is separated; nothing left to separate
      el.save.hidden = false;
      window.sansBass.loadSeparated({ name: lastName, buffer: mix.buffer }, m.stems);
      el.panel.hidden = false;         // keep the panel up so Save stays reachable
    } else if (m.type === 'error') {
      gcTrack(m.message === 'cancelled' ? 'separate-cancel' : 'separate-fail');
      busy(false);
      setProgress(null);
      status(m.message === 'cancelled' ? 'sep.cancelled' : 'sep.failed', { msg: m.message });
    }
  };

  w.postMessage({ type: 'separate', left, right }, [left.buffer, right.buffer]);
});

el.cancel.addEventListener('click', () => {
  worker?.postMessage({ type: 'cancel' });
  status('sep.cancelling');
});

el.save.addEventListener('click', async () => {
  if (!lastStems) return;
  el.save.disabled = true;
  status('sep.encoding');
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
    status('sep.saved', { mb: (blob.size / MB).toFixed(0) });
    gcTrack('stems-save');
  } catch (e) {
    status('sep.saveFailed', { msg: e.message });
  } finally {
    el.save.disabled = false;
  }
});

// The player has no load event, so poll for a track appearing. Cheap and avoids
// reaching into app.js internals.
if (HANDHELD) {
  el.handheld.hidden = false;
  // #sep-go is the only control the markup leaves visible; save, cancel and the progress
  // bar already start hidden. styles.css carries the global
  // [hidden] { display: none !important } that this depends on.
  el.go.hidden = true;
}

setInterval(refresh, 400);
refresh();
