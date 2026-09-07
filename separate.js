/* Separation service: owns the worker's lifecycle and the separation feature's state.
 * Loaded as a plain module script: file:// support was dropped in v1.5.0. Also imported
 * directly by components/SeparationPanel.jsx for its `separation` store — the same "both a
 * script-tag entry and an import target" pattern app.js and every lib/*.js file already use
 * (see CLAUDE.md's ESM-modules rule); a single module instance either way, so there is
 * exactly one Worker lifecycle regardless of which path reached this file first.
 *
 * Presentation (the #sep panel) is owned by components/SeparationPanel.jsx as of Phase 5a.
 * This module owns only the Worker, the state machine, and the commands that drive it. */

import { encodeWav } from './lib/wav.js';
import { buildZip } from './lib/zip.js';
import * as SansI18n from './lib/i18n.js';
import * as SansPlatform from './lib/platform.js';
import * as SansAnalytics from './lib/analytics.js';
import { separationView } from './lib/separation-state.js';
import { playerApplication } from './lib/player-application.js';

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
let progress = null;         // 0..1, or null while the bar is hidden
let lastStatus = null;       // { key, params } or null — params may contain thunks; see
                              // lib/separation-state.js#resolveStatusParams
let saving = false;          // true only while save() is encoding/downloading — independent
                              // of `phase`, which stays 'success' throughout a save so the
                              // button itself stays visible while temporarily disabled

const tr = (key, params) => SansI18n.t(key, params);

/* Analytics must never be able to break separation. A blocked or missing analytics
 * script degrades to a no-op rather than throwing out of an event handler. */
const gcTrack = (n) => { try { SansAnalytics?.track(n); } catch (e) { /* never */ } };
const gcOnce  = (n) => { try { SansAnalytics?.once(n);  } catch (e) { /* never */ } };

const listeners = new Set();
let lastView = null;

/**
 * Recompute the published view from current phase/progress/status and notify subscribers.
 * `singleTrack` defaults to the current bridge read so most call sites don't need to pass it;
 * a few call sites override it explicitly around the success/replacement transition, matching
 * the exact sequencing the legacy DOM-writing code used.
 */
function publish(singleTrack = window.sansBass?.isSingleTrack?.() ?? false) {
  const view = separationView({ state: phase, singleTrack, handheld: HANDHELD });
  lastView = Object.freeze({
    ...view,
    saveDisabled: view.saveDisabled || saving,
    handheld: HANDHELD,
    progress,
    status: lastStatus,
  });
  for (const listener of [...listeners]) {
    try { listener(lastView); } catch (error) {
      console.error('sans_bass: separation subscriber failed', error);
    }
  }
  return lastView;
}

function setProgress(frac) { progress = frac; publish(); }

function setStatus(key, params) { lastStatus = key ? { key, params } : null; publish(); }

function busy(on) {
  phase = on ? 'running' : 'idle';
  publish();
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
    progress = null;
    lastStatus = null;
    saving = false;
  }
  if (runToken !== null && !playerApplication.isCurrentSongToken(runToken)) {
    worker?.terminate();
    worker = null;
    runToken = null;
    lastStems = null;
    phase = 'idle';
    progress = null;
    lastStatus = null;
    saving = false;
  }
  if (HANDHELD) {
    // Same visibility rule as below — the panel belongs to a single unseparated song —
    // but its contents are the explanation, and the controls never come back.
    const single = window.sansBass?.isSingleTrack?.();
    publish(single);
    // once(), not track(): refresh() runs on a 400 ms interval and track() would fire all
    // session. This counts visitors who were shown the message, exactly once each.
    if (single) gcOnce('separate-handheld-blocked');
    return;
  }

  const single = window.sansBass?.isSingleTrack?.();
  if (single) {
    if (phase !== 'running' && phase !== 'success') phase = 'idle';
    publish(true);
    if (phase !== 'success') lastStems = null;
  } else if (!lastStems) {
    publish(false);            // a stems folder was loaded directly
  }
}

function start() {
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
  setStatus('sep.loadingModel');
  setProgress(0);

  // A worker killed by the OOM reaper never posts anything. Without this the UI
  // would sit on a progress bar for ever.
  w.onerror = (err) => {
    if (w !== worker || !playerApplication.isCurrentSongToken(runToken)) return;
    gcTrack('separate-fail');
    phase = 'error';
    setProgress(null);
    setStatus('sep.workerFailed', { msg: err.message || (() => tr('sep.oom')) });
    worker = null;
  };

  w.onmessage = (e) => {
    if (w !== worker || !playerApplication.isCurrentSongToken(runToken)) return;
    const m = e.data;
    if (m.type === 'download') {
      setStatus('sep.downloading', {
        loaded: (m.loaded / MB).toFixed(0), total: (m.total / MB).toFixed(0) });
      setProgress(m.total ? m.loaded / m.total : 0);
    } else if (m.type === 'ready') {
      gcTrack(m.backend === 'webgpu' ? 'separate-backend-webgpu' : 'separate-backend-wasm');
      // Explicit === true / === false: a null (model supplied directly) fires neither.
      if (m.cached === true) gcTrack('model-cached');
      else if (m.cached === false) gcTrack('model-download');
      setStatus(m.backend === 'webgpu' ? 'sep.gpu' : 'sep.cpu');
      setProgress(0);
    } else if (m.type === 'progress') {
      setStatus('sep.progress', { segment: m.segment, total: m.total, eta: Math.ceil(m.etaSec) });
      setProgress(m.segment / m.total);
    } else if (m.type === 'log') {
      console.log('[separate]', m.message);
    } else if (m.type === 'result') {
      gcTrack('separate-done');
      lastStems = m.stems;
      phase = 'success';
      publish(false);
      setProgress(null);
      setStatus(null);                 // the six lanes appearing is the confirmation
      runToken = null;                 // the result is complete before replacement advances identity
      playerApplication.commands.replaceSong({ name: lastName, buffer: mix.buffer }, m.stems);
      publish(false);                  // keep the panel up so Save stays reachable
    } else if (m.type === 'error') {
      gcTrack(m.message === 'cancelled' ? 'separate-cancel' : 'separate-fail');
      phase = m.message === 'cancelled' ? 'cancel' : 'error';
      setProgress(null);
      setStatus(m.message === 'cancelled' ? 'sep.cancelled' : 'sep.failed', { msg: m.message });
    }
  };

  w.postMessage({ type: 'separate', left, right }, [left.buffer, right.buffer]);
}

function cancel() {
  worker?.postMessage({ type: 'cancel' });
  setStatus('sep.cancelling');
}

async function save() {
  if (!lastStems) return;
  const saveToken = playerApplication.currentSongToken();
  const stems = lastStems;
  const name = lastName;
  saving = true;
  setStatus('sep.encoding');
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
    setStatus('sep.saved', { mb: (blob.size / MB).toFixed(0) });
    gcTrack('stems-save');
  } catch (e) {
    if (!playerApplication.isCurrentSongToken(saveToken)) return;
    setStatus('sep.saveFailed', { msg: e.message });
  } finally {
    if (playerApplication.isCurrentSongToken(saveToken)) {
      saving = false;
      publish();
    }
  }
}

/** Peer service consumed directly by components/SeparationPanel.jsx (Phase 5a) — the same
 * subscribe/getSnapshot/commands shape lib/player-application.js established, scoped to
 * separation's own state, which is not player/song/transport state and has no other owner. */
export const separation = {
  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('subscriber must be a function');
    listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  },
  getSnapshot() {
    if (!lastView) return publish();
    return lastView;
  },
  commands: { start, cancel, save },
};

const unsubscribePlayer = playerApplication.subscribe(refresh);
playerApplication.registerCleanup(() => {
  unsubscribePlayer();
  worker?.terminate();
  worker = null;
  runToken = null;
});
refresh();
