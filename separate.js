/* Separation panel: owns the worker's lifecycle and the UI around it.
 * Loaded as a plain module script: file:// support was dropped in v1.5.0. */

import { encodeWav } from './lib/wav.js';
import { buildZip } from './lib/zip.js';
import * as SansI18n from './lib/i18n.js';
import * as SansPlatform from './lib/platform.js';
import * as SansAnalytics from './lib/analytics.js';
import { separationView } from './lib/separation-state.js';
import { playerApplication } from './lib/player-application.js';

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
const HANDHELD = SansPlatform?.isHandheld() ?? false;

const MB = 1e6;
let worker = null;
let lastStems = null;
let lastName = 'song';
let phase = 'idle';
let runToken = null;

function renderControls(singleTrack = window.sansBass?.isSingleTrack?.()) {
  const view = separationView({ state: phase, singleTrack, handheld: HANDHELD });
  el.panel.hidden = !view.panel;
  el.go.hidden = !view.go;
  el.cancel.hidden = !view.cancel;
  el.save.hidden = !view.save;
  el.go.disabled = view.goDisabled;
  el.save.disabled = view.saveDisabled;
}

function setProgress(frac) {
  el.bar.hidden = frac === null;
  if (frac !== null) el.fill.style.width = `${Math.round(frac * 100)}%`;
}

const tr = (key, params) => SansI18n.t(key, params);

/* Analytics must never be able to break separation. A blocked or missing analytics
 * script degrades to a no-op rather than throwing out of an event handler. */
const gcTrack = (n) => { try { SansAnalytics?.track(n); } catch (e) { /* never */ } };
const gcOnce  = (n) => { try { SansAnalytics?.once(n);  } catch (e) { /* never */ } };

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

const retranslateStatus = () => {
  if (lastStatus) el.status.textContent = tr(lastStatus.key, resolve(lastStatus.params));
};
window.addEventListener('sansbass:langchange', retranslateStatus);

function busy(on) {
  phase = on ? 'running' : 'idle';
  renderControls();
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./separate.worker.js', import.meta.url), { type: 'module' });
  return worker;
}

/**
 * The panel is for a single unseparated track — but it must stay up after a successful
 * run, or the Save button vanishes 400 ms after the stems appear.
 */
function refresh(snapshot = playerApplication.getSnapshot()) {
  if (snapshot.loading) {
    worker?.terminate();
    worker = null;
    runToken = null;
    lastStems = null;
    phase = 'idle';
    setProgress(null);
    status('');
  }
  if (runToken !== null && !playerApplication.isCurrentSongToken(runToken)) {
    worker?.terminate();
    worker = null;
    runToken = null;
    lastStems = null;
    phase = 'idle';
    setProgress(null);
    status('');
  }
  if (HANDHELD) {
    // Same visibility rule as below — the panel belongs to a single unseparated song —
    // but its contents are the explanation, and the controls never come back.
    const single = window.sansBass?.isSingleTrack?.();
    renderControls(single);
    // once(), not track(): refresh() runs on a 400 ms interval and track() would fire all
    // session. This counts visitors who were shown the message, exactly once each.
    if (single) gcOnce('separate-handheld-blocked');
    return;
  }

  const single = window.sansBass?.isSingleTrack?.();
  if (single) {
    if (phase !== 'running' && phase !== 'success') phase = 'idle';
    renderControls(true);
    if (phase !== 'success') lastStems = null;
  } else if (!lastStems) {
    renderControls(false);            // a stems folder was loaded directly
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
  runToken = playerApplication.currentSongToken();
  busy(true);
  status('sep.loadingModel');
  setProgress(0);

  // A worker killed by the OOM reaper never posts anything. Without this the UI
  // would sit on a progress bar for ever.
  w.onerror = (err) => {
    if (w !== worker || !playerApplication.isCurrentSongToken(runToken)) return;
    gcTrack('separate-fail');
    phase = 'error';
    renderControls();
    setProgress(null);
    status('sep.workerFailed', { msg: err.message || (() => tr('sep.oom')) });
    worker = null;
  };

  w.onmessage = (e) => {
    if (w !== worker || !playerApplication.isCurrentSongToken(runToken)) return;
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
      phase = 'success';
      renderControls(false);
      setProgress(null);
      status('');                      // the six lanes appearing is the confirmation
      runToken = null;                 // the result is complete before replacement advances identity
      playerApplication.commands.replaceSong({ name: lastName, buffer: mix.buffer }, m.stems);
      renderControls(false);           // keep the panel up so Save stays reachable
    } else if (m.type === 'error') {
      gcTrack(m.message === 'cancelled' ? 'separate-cancel' : 'separate-fail');
      phase = m.message === 'cancelled' ? 'cancel' : 'error';
      renderControls();
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
  const saveToken = playerApplication.currentSongToken();
  const stems = lastStems;
  const name = lastName;
  el.save.disabled = true;
  status('sep.encoding');
  try {
    // Encode one stem at a time and hand each straight to the ZIP builder, so the WAV
    // bytes are never all live at once on top of the stems themselves.
    const entries = [];
    for (const [stem, ch] of Object.entries(stems)) {
      entries.push({ name: `${name}/${stem}.wav`, bytes: encodeWav(ch.left, ch.right, 44100) });
      await new Promise((r) => setTimeout(r, 0));   // let the UI repaint between stems
      if (!playerApplication.isCurrentSongToken(saveToken)) return;
    }
    const blob = buildZip(entries);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}-stems.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    status('sep.saved', { mb: (blob.size / MB).toFixed(0) });
    gcTrack('stems-save');
  } catch (e) {
    if (!playerApplication.isCurrentSongToken(saveToken)) return;
    status('sep.saveFailed', { msg: e.message });
  } finally {
    if (playerApplication.isCurrentSongToken(saveToken)) el.save.disabled = false;
  }
});

// Song/loading changes arrive through the Phase 2 application subscription below.
if (HANDHELD) {
  el.handheld.hidden = false;
  // #sep-go is the only control the markup leaves visible; save, cancel and the progress
  // bar already start hidden. styles.css carries the global
  // [hidden] { display: none !important } that this depends on.
  renderControls();
}

const unsubscribePlayer = playerApplication.subscribe(refresh);
playerApplication.registerCleanup(() => {
  unsubscribePlayer();
  window.removeEventListener('sansbass:langchange', retranslateStatus);
  worker?.terminate();
  worker = null;
  runToken = null;
});
refresh();
