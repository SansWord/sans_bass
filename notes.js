/* Notes panel: owns the analysis worker and the interpretation on top of it, for one
 * melodic stem — see createNotesChannel() below.
 *
 * The split matters and is the whole point of the design — see docs/transcription.md.
 * ANALYSIS (decimate + YIN) runs once in the worker and its result is immutable.
 * INTERPRETATION (interpret()) runs here on the main thread, because at ~12 ms it is
 * cheaper to run than to message, and that is what lets a slider re-derive live.
 *
 * A module, so it cannot share scope with app.js. It talks to the player only through
 * window.sansBass, exactly as separate.js does.
 *
 * Two independent channels — one per note-capable stem — are created at the bottom of this
 * file. Everything that is genuinely per-song state (frames, notes, edits, jianpu, the
 * worker) lives inside createNotesChannel()'s closure. Tempo is the one exception: it is
 * derived from the drums stem and has never depended on which melodic stem is being read,
 * so its state and DOM wiring stay shared, module-level code below the channel factory.
 * See docs/superpowers/specs/2026-09-01-bass-notes-design.md. */

import { interpret, applyEdits, detectKey, notesToChroma, relativeKey, stemMismatch, BASS_RANGE }
  from './lib/pitch.js';
import { scheduleNotes } from './lib/sonify.js';

const tr = (key, params) => window.SansI18n.t(key, params);

/* Note names are never translated in this app — a saved zip is `vocals.wav` in every
 * language, and C# is C# in every language too. */
const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const STEM_TIMBRE = { vocals: 'piano', bass: 'bass' };
const STEM_RANGE = { vocals: undefined, bass: BASS_RANGE };   // undefined -> the worker keeps YIN_DEFAULTS

/* English-only, like the major/minor word below — this file is read outside the app, where
 * the current UI language doesn't apply. Not routed through tr(); a dictionary key would
 * imply it is meant to be translated, which it deliberately never is. */
const STEM_WORD = { vocals: 'Vocals', bass: 'Bass' };

function mmss(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- shared: tempo grid
//
// Derived from the drums stem; refresh(), the tempo grid state, and its DOM wiring stay
// module-level rather than living inside either channel's closure, because both channels'
// note lanes draw the SAME beat/bar grid from the SAME detected tempo.

const tempoEl = {
  panel: document.getElementById('notes-tempo'),
  on: document.getElementById('notes-tempo-on'),
  bpm: document.getElementById('notes-tempo-bpm'),
  half: document.getElementById('notes-tempo-half'),
  double: document.getElementById('notes-tempo-double'),
  phase: document.getElementById('notes-tempo-phase'),
  phaseBack: document.getElementById('notes-tempo-phase-back'),
  phaseFwd: document.getElementById('notes-tempo-phase-fwd'),
  beats: document.getElementById('notes-tempo-beats'),
  rangeToggle: document.getElementById('notes-tempo-range'),
  redetect: document.getElementById('notes-tempo-redetect'),
  status: document.getElementById('notes-tempo-status'),
};

/* The tempo grid. `auto` stays true until the user touches a control (or presses Re-detect,
 * which always re-adopts auto). */
let tempo = { on: true, auto: true, bpmValue: 120, phaseMs: 0, beatsPerBar: 4, confidence: 0 };
let tempoRange = null;        // { from, to } in seconds, or null = whole song (the default)
let tempoRangeArmed = false;  // "Select BPM range" toggle; mirrored to app.js for the drag UI

const channels = [];   // filled at the bottom of this file; tempo handlers re-derive every channel

/** The drums stem's audio, sliced to `tempoRange` if one is set — sliced BEFORE handing to
 *  the worker, not after, so the protocol stays simple (the worker never knows about ranges)
 *  and less data crosses the postMessage boundary for a narrow selection. Returns null when
 *  there is no drums stem to analyse. */
function currentTempoRangeChannels() {
  const stem = window.sansBass.stemBuffer('drums');
  if (!stem) return null;
  const buffer = stem.buffer;
  const chans = [];
  for (let i = 0; i < buffer.numberOfChannels; i++) {
    const data = buffer.getChannelData(i);
    if (tempoRange) {
      const from = Math.max(0, Math.floor(tempoRange.from * buffer.sampleRate));
      const to = Math.min(data.length, Math.ceil(tempoRange.to * buffer.sampleRate));
      chans.push(data.slice(from, to));
    } else {
      chans.push(data.slice());
    }
  }
  return { channels: chans, sampleRate: buffer.sampleRate };
}

/** Restores the tempo grid to its defaults for a freshly loaded song. Tempo is derived from
 *  THIS song's drums stem, so nothing about it — including a range selection or a manual
 *  BPM/phase override — should survive into the next song. Idempotent: safe to call more
 *  than once for the same load (each channel's reset() calls it, and so does the
 *  'sansbass:songload' listener below, so both paths agreeing is fine). */
function resetTempo() {
  tempo = { on: true, auto: true, bpmValue: 120, phaseMs: 0, beatsPerBar: 4, confidence: 0 };
  tempoRange = null;
  tempoRangeArmed = false;
  tempoEl.rangeToggle.classList.remove('note-tbtn-armed');
  syncTempoControls();
}

/** Adopts a fresh { bpmValue, phaseSec, confidence } from the worker. */
function applyTempoResult(result) {
  tempo = {
    on: true,
    auto: true,
    bpmValue: +result.bpmValue.toFixed(1),
    phaseMs: +(((tempoRange ? tempoRange.from : 0) * 1000) + result.phaseSec * 1000).toFixed(1),
    beatsPerBar: tempo.beatsPerBar,
    confidence: result.confidence,
  };
}

/* Every control but the panel-level checkbox is meaningless without a drums stem, so they go
 * visibly inert rather than silently doing nothing. */
function syncTempoControls() {
  const hasDrums = !!window.sansBass.stemBuffer('drums');
  for (const c of [tempoEl.bpm, tempoEl.half, tempoEl.double, tempoEl.phase,
                    tempoEl.phaseBack, tempoEl.phaseFwd, tempoEl.beats,
                    tempoEl.rangeToggle, tempoEl.redetect]) c.disabled = !hasDrums;
  tempoEl.on.checked = tempo.on;
  tempoEl.bpm.value = tempo.bpmValue;
  tempoEl.phase.value = tempo.phaseMs;
  tempoEl.beats.value = String(tempo.beatsPerBar);
  tempoEl.status.textContent = tempo.confidence > 0
    ? tr('notes.tempoStatus', { bpm: tempo.bpmValue.toFixed(1), pct: Math.round(tempo.confidence * 100) })
    : tr('notes.tempoStatusNone');
}

function reinterpretAll() { for (const c of channels) c.reinterpret(); }

tempoEl.on.addEventListener('change', () => { tempo.on = tempoEl.on.checked; reinterpretAll(); });
tempoEl.bpm.addEventListener('input', () => {
  const v = Number(tempoEl.bpm.value);
  if (Number.isFinite(v) && v > 0) { tempo.bpmValue = v; tempo.auto = false; }
  reinterpretAll();
});
tempoEl.half.addEventListener('click', () => {
  tempo.bpmValue = +(tempo.bpmValue / 2).toFixed(1);
  tempo.auto = false;
  reinterpretAll();
});
tempoEl.double.addEventListener('click', () => {
  tempo.bpmValue = +(tempo.bpmValue * 2).toFixed(1);
  tempo.auto = false;
  reinterpretAll();
});
const PHASE_NUDGE_MS = 10;
tempoEl.phase.addEventListener('input', () => {
  const v = Number(tempoEl.phase.value);
  if (Number.isFinite(v)) { tempo.phaseMs = v; tempo.auto = false; }
  reinterpretAll();
});
tempoEl.phaseBack.addEventListener('click', () => {
  tempo.phaseMs -= PHASE_NUDGE_MS;
  tempo.auto = false;
  reinterpretAll();
});
tempoEl.phaseFwd.addEventListener('click', () => {
  tempo.phaseMs += PHASE_NUDGE_MS;
  tempo.auto = false;
  reinterpretAll();
});
tempoEl.beats.addEventListener('change', () => {
  tempo.beatsPerBar = Number(tempoEl.beats.value);
  tempo.auto = false;
  reinterpretAll();
});
tempoEl.rangeToggle.addEventListener('click', () => {
  tempoRangeArmed = !tempoRangeArmed;
  tempoEl.rangeToggle.classList.toggle('note-tbtn-armed', tempoRangeArmed);
  window.dispatchEvent(new CustomEvent('sansbass:temporangemode', { detail: { on: tempoRangeArmed } }));
});
tempoEl.redetect.addEventListener('click', () => {
  const drums = currentTempoRangeChannels();
  if (!drums) return;
  const w = new Worker(new URL('./notes.worker.js', import.meta.url), { type: 'module' });
  tempoEl.redetect.disabled = true;
  w.onmessage = (e) => {
    w.terminate();
    if (e.data.type === 'tempo') applyTempoResult(e.data.tempo);
    else if (e.data.type === 'error') window.sansBass.say('notes.failed', { message: e.data.message }, true);
    syncTempoControls();
    reinterpretAll();
  };
  w.onerror = (e) => {
    w.terminate();
    window.sansBass.say('notes.failed', { message: e.message || 'worker error' }, true);
    syncTempoControls();
  };
  w.postMessage({ type: 'tempo', channels: drums.channels, sampleRate: drums.sampleRate });
});
/* app.js owns the drag surface (the drums stem's own lane) and dispatches this once a
 * selection commits or the caption's Clear button is pressed. Mirrored here because this
 * copy is what persists across export/import and reset — see
 * docs/superpowers/specs/2026-09-01-tempo-grid-design.md. */
window.addEventListener('sansbass:temporange', (e) => { tempoRange = e.detail; });

/* Hidden until a real detection has actually run — showing default 120 BPM controls before
 * any drums audio has been examined is the same illusion-of-completion problem the shared
 * Find-notes button and each channel's meta row solve for note counts. Confidence resets to
 * 0 on every song load (resetTempo()), so this re-hides on its own without extra wiring. */
function refreshTempo() {
  tempoEl.panel.hidden = !(tempo.confidence > 0);
  syncTempoControls();
  /* app.js shows a calculated/original BPM readout next to the speed percent, and needs to
   * know the current BPM — including a manual override, which is just tempo.bpmValue like
   * any other reading — regardless of which of the many controls changed it. Piggybacking on
   * this function's existing 400ms poll (refreshAll()) is simpler than hooking every mutation
   * site (the checkbox, the number field, half/double, phase, redetect, import). */
  window.dispatchEvent(new CustomEvent('sansbass:tempo', {
    detail: { bpmValue: tempo.bpmValue, confidence: tempo.confidence },
  }));
}

/* app.js dispatches this once per buildUI() call (i.e. once per song load), unconditionally —
 * unlike each channel's own reset(), which only fires once that channel has frames to discard.
 * Tempo can be dirtied (a manual BPM tweak, a range drag) without either channel ever having
 * run analysis, so the module-level reset can't rely on the per-channel path alone. */
window.addEventListener('sansbass:songload', resetTempo);

// ---------------------------------------------------------------- per-channel factory

function createNotesChannel(stem, els) {
  const timbre = STEM_TIMBRE[stem];
  const range = STEM_RANGE[stem];

  /* Populated per channel — each has its own <select>. */
  for (let i = 0; i < 12; i++) {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = PITCH_CLASSES[i];
    els.keyTonic.appendChild(o);
  }

  /* On the label, not the input: the checkbox itself is a 13 px target and the sentence
   * beside it is what the pointer actually rests on. */
  const syncTips = () => {
    els.hmm.parentElement.title = tr('notes.hmmTip');
    els.clip.parentElement.title = tr('notes.clipTip');
    els.fold.parentElement.title = tr('notes.foldTip');
    els.foldTol.parentElement.title = tr('notes.foldTolTip');
    els.jianpu.parentElement.title = tr('notes.jianpuTip');
    els.keyRel.title = tr('notes.relativeTip');
  };
  syncTips();

  let worker = null;
  let frames = null;           // the immutable analysis result
  let notes = [];
  let analysedBuffer = null;   // identity of the AudioBuffer `frames` was computed from
  let sonifier = null;         // the running note schedule, or null
  let editable = false;        // this channel is the one currently in edit mode

  /* The 簡譜 reading. `auto` stays true until the user touches a control, so a fresh detection
   * on a newly loaded song adopts its key — but never overrides a choice already made. */
  let jianpu = { on: false, tonic: 0, mode: 'major', auto: true };

  /* The edit list, as GROUPS — see docs/superpowers/specs/2026-08-31-note-editing-design.md. */
  let editGroups = [];
  let orphaned = [];
  let nextEditId = 1;

  function currentParams() {
    return {
      interpreter: els.hmm.checked ? 'hmm-v1' : 'threshold-v1',
      params: {
        minDurationMs: Number(els.min.value),
        fold: els.fold.checked,
        confidentWithin: Number(els.foldTol.value),
      },
    };
  }

  function syncFoldControls() {
    const on = els.fold.checked;
    els.foldTol.disabled = !on;
    els.foldTolOut.textContent = tr('notes.foldTolVal', { n: els.foldTol.value });
    els.foldTolOut.classList.toggle('risky', Number(els.foldTol.value) >= 2.5);
    els.foldStats.hidden = !on;
    if (!on) return;
    let folded = 0;
    let muted = 0;
    for (const n of notes) {
      if (!n.fix) continue;
      if (n.fix.state === 'folded') folded++;
      else if (n.fix.state === 'doubt') muted++;
    }
    const frag = (key, n, cls) => {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = tr(key, { n });
      return span;
    };
    els.foldStats.replaceChildren(
      frag('notes.foldStatsFolded', folded, 'n-fold'),
      document.createTextNode(' · '),
      frag('notes.foldStatsMuted', muted, 'n-mute'),
    );
  }

  function editTypeLabel(edit) {
    const KEYS = {
      octave: edit.dir > 0 ? 'notes.editOctaveUp' : 'notes.editOctaveDown',
      pitchNudge: edit.semitones > 0 ? 'notes.editPitchUp' : 'notes.editPitchDown',
      timeAdjust: 'notes.editTimeAdjustLabel',
      delete: 'notes.editDeleteLabel',
      add: 'notes.editAddLabel',
      rangeDelete: 'notes.editRangeDeleteLabel',
    };
    return tr(KEYS[edit.type]);
  }

  function groupLabel(group) {
    return group.edits.length > 1 ? tr('notes.editSplitLabel') : editTypeLabel(group.edits[0]);
  }

  function groupTimeLabel(group) {
    const e = group.edits[0];
    if (e.type === 'rangeDelete') return `${e.from.toFixed(2)}–${e.to.toFixed(2)}s`;
    if (e.type === 'add') return `${e.start.toFixed(2)}s`;
    return `${e.at.toFixed(2)}s`;
  }

  function renderEditList() {
    els.editsRow.hidden = editGroups.length === 0;
    els.editsSummary.textContent = tr('notes.editsSummary', { n: editGroups.length });
    els.editUndo.disabled = editGroups.length === 0;
    els.editRows.replaceChildren(...editGroups.map((g) => {
      const li = document.createElement('li');
      li.className = 'edit-row';
      if (g.edits.some((e) => orphaned.includes(e))) {
        const warn = document.createElement('span');
        warn.className = 'edit-warn';
        warn.textContent = '⚠';
        warn.title = tr('notes.editOrphanTip');
        li.appendChild(warn);
      }
      const label = document.createElement('span');
      label.textContent = `${groupLabel(g)} · ${groupTimeLabel(g)}`;
      li.appendChild(label);
      const rm = document.createElement('button');
      rm.className = 'mini edit-remove';
      rm.type = 'button';
      rm.textContent = '✕';
      rm.title = tr('notes.editRemoveTip');
      rm.addEventListener('click', () => {
        editGroups = editGroups.filter((x) => x.id !== g.id);
        reinterpret();
      });
      li.appendChild(rm);
      return li;
    }));
  }

  function syncJianpuControls() {
    els.keyTonic.value = String(jianpu.tonic);
    els.keyMode.value = jianpu.mode;
    for (const c of [els.keyTonic, els.keyMode, els.keyRel]) c.disabled = !jianpu.on;
    els.listExport.disabled = !notes.length;
  }

  /** Re-derive notes from the existing frames. No worker, no re-analysis. */
  function reinterpret() {
    if (!frames) return;
    const p = currentParams();
    notes = interpret(frames, p);
    const applied = applyEdits(notes, editGroups.flatMap((g) => g.edits));
    notes = applied.notes;
    orphaned = applied.orphaned;
    els.count.textContent = tr('notes.count', { n: notes.length });
    els.minOut.textContent = `${els.min.value} ms`;
    syncFoldControls();
    if (jianpu.auto && notes.length) {
      const k = detectKey(notesToChroma(notes));
      jianpu.tonic = k.tonic;
      jianpu.mode = k.mode;
    }
    syncJianpuControls();
    window.sansBass.setNotes(stem, {
      notes, frames, params: p, clip: els.clip.checked,
      jianpu: { on: jianpu.on, tonic: jianpu.tonic, mode: jianpu.mode },
      tempo: { on: tempo.on, bpmValue: tempo.bpmValue, phaseMs: tempo.phaseMs, beatsPerBar: tempo.beatsPerBar },
    });
    resync();
    renderEditList();
  }

  /* Start (or restart) the synth against the transport's OWN t0 and offset. */
  function resync() {
    if (sonifier) { sonifier.stop(); sonifier = null; }
    if (!frames || !notes.length) return;
    if (window.sansBass.ribbonMuted(stem)) return;
    const audio = window.sansBass.notesAudio(stem);
    const t = window.sansBass.transport();
    if (!audio || !t.playing) return;
    sonifier = scheduleNotes(audio.ctx, audio.destination, notes, {
      timbre, when: t.t0, offset: t.offset, loopA: t.loopA, loopB: t.loopB, rate: t.rate,
    });
  }

  function syncShowLabel() {
    els.show.textContent = tr(window.sansBass.ribbonVisible(stem) ? 'notes.hide' : 'notes.show');
  }

  function reset() {
    if (sonifier) { sonifier.stop(); sonifier = null; }
    if (worker) { worker.terminate(); worker = null; }
    els.show.hidden = true;
    frames = null;
    notes = [];
    analysedBuffer = null;
    // Count, show/hide toggle, 簡譜 and key controls are all meaningless before this channel
    // has notes — hidden as one row rather than each looking individually inert, same
    // principle as els.tune below.
    els.meta.hidden = true;
    els.tune.hidden = true;
    els.count.textContent = '';
    jianpu.auto = true;
    editGroups = [];
    orphaned = [];
    els.exportBtn.disabled = true;
    els.importBtn.disabled = true;
    /* Only announce if THIS channel believed it was the editable one — otherwise a reset on
     * the channel that ISN'T currently selected would blank editmode out from under whichever
     * channel actually is (every 'on:false' clears editable everywhere, stem match or not). */
    if (editable) window.dispatchEvent(new CustomEvent('sansbass:editmode', { detail: { on: false, stem: null } }));
    renderEditList();
    syncJianpuControls();
    // Belt-and-braces alongside the 'sansbass:songload' listener above: harmless to call
    // twice (once per channel) since resetTempo() is idempotent.
    resetTempo();
  }

  function analyse() {
    const stemAudio = window.sansBass.stemBuffer(stem);
    if (!stemAudio) return;

    window.sansBass.say('notes.working');

    const buffer = stemAudio.buffer;
    const chans = [];
    for (let i = 0; i < buffer.numberOfChannels; i++) chans.push(buffer.getChannelData(i).slice());

    const drums = currentTempoRangeChannels();

    worker = new Worker(new URL('./notes.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      worker.terminate();
      worker = null;
      if (m.type === 'error') {
        window.sansBass.say('notes.failed', { message: m.message }, true);
        return;
      }
      window.sansBass.say('');
      frames = m.frames;
      // Skip re-applying an auto-detected tempo once the user has manually tuned it
      // (tempo.auto === false) — otherwise running analysis on the second channel silently
      // discards a manual BPM/phase tweak made between the two runs.
      if (m.tempo && tempo.auto) { applyTempoResult(m.tempo); syncTempoControls(); }
      els.meta.hidden = false;
      els.tune.hidden = false;
      els.show.hidden = false;
      els.exportBtn.disabled = false;
      els.importBtn.disabled = false;
      syncShowLabel();
      // Not just reinterpret(): a tempo result above belongs to BOTH channels, so the other
      // channel (if it already has frames) must also pick up the fresh grid.
      reinterpretAll();
    };
    worker.onerror = (e) => {
      if (worker) { worker.terminate(); worker = null; }
      window.sansBass.say('notes.failed', { message: e.message || 'worker error' }, true);
    };
    analysedBuffer = buffer;
    worker.postMessage({
      type: 'analyse', channels: chans, sampleRate: buffer.sampleRate,
      ...(drums ? { drums } : {}),
      ...(range ? { range } : {}),
    });
  }

  /* Hidden until this channel actually has notes, not merely until its stem is loaded —
   * same principle as the meta/tune rows inside it (and #notes-tempo): an empty panel with
   * disabled Export/Import/Export-list controls sitting there before Find Notes is pressed
   * is output before there is any. Checked ahead of the reset() call below so a song/stem
   * change hides the panel in the same tick frames is cleared, not one poll tick later.
   * There is no load event to hang this on — separate.js polls the same way, for the same
   * reason. */
  function refresh() {
    const stemAudio = window.sansBass?.stemBuffer?.(stem);
    if (frames && (!stemAudio || stemAudio.buffer !== analysedBuffer)) reset();
    els.panel.hidden = !frames;
  }

  /* Read by the shared #notes-go-all button (module-level, below) to decide whether this
   * channel still needs a run and whether one is already in flight — this channel has no
   * button of its own any more. */
  function hasStem() { return !!window.sansBass?.stemBuffer?.(stem); }
  function needsAnalyse() { return hasStem() && !frames; }
  function busy() { return worker !== null; }

  els.min.addEventListener('input', reinterpret);
  els.clip.addEventListener('change', reinterpret);
  els.hmm.addEventListener('change', reinterpret);
  els.fold.addEventListener('change', reinterpret);
  els.foldTol.addEventListener('input', reinterpret);
  els.jianpu.addEventListener('change', () => {
    jianpu.on = els.jianpu.checked;
    syncJianpuControls();
    reinterpret();
  });
  els.show.addEventListener('click', () => {
    window.sansBass.setRibbonVisible(stem, !window.sansBass.ribbonVisible(stem));
    syncShowLabel();
  });
  for (const c of [els.keyTonic, els.keyMode]) {
    c.addEventListener('change', () => {
      jianpu.auto = false;
      jianpu.tonic = Number(els.keyTonic.value);
      jianpu.mode = els.keyMode.value;
      reinterpret();
    });
  }
  els.keyRel.addEventListener('click', () => {
    const r = relativeKey(jianpu.tonic, jianpu.mode);
    jianpu.auto = false;
    jianpu.tonic = r.tonic;
    jianpu.mode = r.mode;
    syncJianpuControls();
    reinterpret();
  });
  window.addEventListener('sansbass:langchange', () => {
    if (frames) {
      els.count.textContent = tr('notes.count', { n: notes.length });
      syncShowLabel();
    }
    syncTips();
  });
  /* The player broadcasts its transport because app.js is a classic script and this file is
   * a module — the same seam the language switch uses. */
  window.addEventListener('sansbass:transport', (e) => {
    if (!e.detail.playing) {
      if (sonifier) { sonifier.stop(); sonifier = null; }
      return;
    }
    resync();
  });
  window.addEventListener('sansbass:ribbonmute', (e) => {
    if (e.detail.stem === stem) resync();
  });
  window.addEventListener('sansbass:editmode', (e) => {
    editable = e.detail.stem === stem && e.detail.on;
  });
  window.addEventListener('sansbass:noteedit', (e) => {
    if (!editable) return;
    editGroups.push({ id: nextEditId++, edits: e.detail.edits });
    reinterpret();
  });
  els.editUndo.addEventListener('click', () => {
    editGroups.pop();
    reinterpret();
  });
  window.addEventListener('sansbass:editundo', () => {
    if (!editable) return;
    editGroups.pop();
    reinterpret();
  });
  document.addEventListener('pointerdown', (e) => {
    if (els.editsRow.open && !els.editsRow.contains(e.target)) els.editsRow.open = false;
  });

  els.exportBtn.addEventListener('click', () => {
    const mix = window.sansBass.currentMix ? window.sansBass.currentMix() : null;
    const payload = {
      version: 1,
      stem,
      ...(mix ? { song: mix.name } : {}),
      ...currentParams(),
      clip: els.clip.checked,
      jianpu: { on: jianpu.on, tonic: jianpu.tonic, mode: jianpu.mode },
      tempo: { on: tempo.on, bpmValue: tempo.bpmValue, phaseMs: tempo.phaseMs, beatsPerBar: tempo.beatsPerBar },
      tempoRange,
      edits: editGroups.map((g) => g.edits),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${mix ? mix.name : 'song'}-${stem}-edits.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });

  els.listExport.addEventListener('click', () => {
    const secs = Number(els.listSecs.value) || 10;
    const mix = window.sansBass.currentMix ? window.sansBass.currentMix() : null;
    const refOct = window.SansJianpu.referenceOctave(notes, jianpu.tonic);

    const windows = new Map();
    for (const n of notes) {
      const idx = Math.floor(n.start / secs);
      if (!windows.has(idx)) windows.set(idx, []);
      windows.get(idx).push(n);
    }

    const modeWord = jianpu.mode === 'minor' ? 'minor' : 'major';
    const lines = [`## ${mix ? mix.name + ' — ' : ''}${STEM_WORD[stem]} — 1=${PITCH_CLASSES[jianpu.tonic]} ${modeWord}`, ''];
    for (const idx of [...windows.keys()].sort((a, b) => a - b)) {
      const from = idx * secs;
      const to = from + secs;
      lines.push(`### ${mmss(from)} - ${mmss(to)}`);
      lines.push(windows.get(idx)
        .map((n) => window.SansJianpu.degreeToken(n.midi, jianpu.tonic, jianpu.mode, refOct))
        .join(' '));
      lines.push('');
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${mix ? mix.name : 'song'}-${stem}-notes.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });

  els.importBtn.addEventListener('click', () => els.importFile.click());

  els.importFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      window.sansBass.say('notes.importFailed', { message: err.message }, true);
      return;
    }
    if (!data || data.version !== 1 || !Array.isArray(data.edits)) {
      window.sansBass.say('notes.importFailed', { message: 'not a note-edits file' }, true);
      return;
    }

    const mix = window.sansBass.currentMix ? window.sansBass.currentMix() : null;
    if (data.song && mix && data.song !== mix.name) {
      window.sansBass.say('notes.importMismatch', { song: data.song }, true);
    }
    if (stemMismatch(data, stem)) {
      window.sansBass.say('notes.importStemMismatch', { stem: tr('stem.' + data.stem) }, true);
    }

    if (data.params) {
      if (data.params.minDurationMs != null) els.min.value = data.params.minDurationMs;
      els.fold.checked = !!data.params.fold;
      if (data.params.confidentWithin != null) els.foldTol.value = data.params.confidentWithin;
    }
    els.hmm.checked = data.interpreter !== 'threshold-v1';
    els.clip.checked = data.clip !== false;
    if (data.jianpu) {
      jianpu.on = !!data.jianpu.on;
      jianpu.auto = false;
      jianpu.tonic = data.jianpu.tonic ?? 0;
      jianpu.mode = data.jianpu.mode || 'major';
      els.jianpu.checked = jianpu.on;
    }
    if (data.tempo) {
      tempo.on = !!data.tempo.on;
      tempo.auto = false;
      if (data.tempo.bpmValue != null) tempo.bpmValue = data.tempo.bpmValue;
      if (data.tempo.phaseMs != null) tempo.phaseMs = data.tempo.phaseMs;
      if (data.tempo.beatsPerBar != null) tempo.beatsPerBar = data.tempo.beatsPerBar;
      syncTempoControls();
    }
    if (data.tempoRange !== undefined) {
      tempoRange = data.tempoRange || null;
      window.sansBass.setTempoRange(tempoRange);
    }
    editGroups = data.edits.map((edits) => ({ id: nextEditId++, edits }));
    syncJianpuControls();
    // Not just reinterpret(): an imported tempo (shared across both channels) may have
    // changed, and the sibling channel needs to redraw its own grid too.
    reinterpretAll();
  });

  syncJianpuControls();      // the selectors are inert until 簡譜 is ticked, from the first paint

  return { refresh, reinterpret, analyse, needsAnalyse, busy, hasStem, stem };
}

// ---------------------------------------------------------------- two instances

channels.push(createNotesChannel('vocals', {
  panel: document.getElementById('notes-vocals'),
  meta: document.getElementById('notes-meta-vocals'),
  count: document.getElementById('notes-count-vocals'),
  tune: document.getElementById('notes-tune-vocals'),
  min: document.getElementById('notes-min-vocals'),
  minOut: document.getElementById('notes-min-out-vocals'),
  clip: document.getElementById('notes-clip-vocals'),
  hmm: document.getElementById('notes-hmm-vocals'),
  fold: document.getElementById('notes-fold-vocals'),
  foldTol: document.getElementById('notes-fold-tol-vocals'),
  foldTolOut: document.getElementById('notes-fold-tol-out-vocals'),
  foldStats: document.getElementById('notes-fold-stats-vocals'),
  show: document.getElementById('notes-show-vocals'),
  editsRow: document.getElementById('notes-edits-vocals'),
  editsSummary: document.getElementById('notes-edits-summary-vocals'),
  editUndo: document.getElementById('notes-edit-undo-vocals'),
  editRows: document.getElementById('notes-edit-rows-vocals'),
  exportBtn: document.getElementById('notes-export-vocals'),
  importBtn: document.getElementById('notes-import-vocals'),
  importFile: document.getElementById('notes-import-file-vocals'),
  listSecs: document.getElementById('notes-list-secs-vocals'),
  listExport: document.getElementById('notes-list-export-vocals'),
  jianpu: document.getElementById('notes-jianpu-vocals'),
  keyTonic: document.getElementById('notes-key-tonic-vocals'),
  keyMode: document.getElementById('notes-key-mode-vocals'),
  keyRel: document.getElementById('notes-key-rel-vocals'),
}));

channels.push(createNotesChannel('bass', {
  panel: document.getElementById('notes-bass'),
  meta: document.getElementById('notes-meta-bass'),
  count: document.getElementById('notes-count-bass'),
  tune: document.getElementById('notes-tune-bass'),
  min: document.getElementById('notes-min-bass'),
  minOut: document.getElementById('notes-min-out-bass'),
  clip: document.getElementById('notes-clip-bass'),
  hmm: document.getElementById('notes-hmm-bass'),
  fold: document.getElementById('notes-fold-bass'),
  foldTol: document.getElementById('notes-fold-tol-bass'),
  foldTolOut: document.getElementById('notes-fold-tol-out-bass'),
  foldStats: document.getElementById('notes-fold-stats-bass'),
  show: document.getElementById('notes-show-bass'),
  editsRow: document.getElementById('notes-edits-bass'),
  editsSummary: document.getElementById('notes-edits-summary-bass'),
  editUndo: document.getElementById('notes-edit-undo-bass'),
  editRows: document.getElementById('notes-edit-rows-bass'),
  exportBtn: document.getElementById('notes-export-bass'),
  importBtn: document.getElementById('notes-import-bass'),
  importFile: document.getElementById('notes-import-file-bass'),
  listSecs: document.getElementById('notes-list-secs-bass'),
  listExport: document.getElementById('notes-list-export-bass'),
  jianpu: document.getElementById('notes-jianpu-bass'),
  keyTonic: document.getElementById('notes-key-tonic-bass'),
  keyMode: document.getElementById('notes-key-mode-bass'),
  keyRel: document.getElementById('notes-key-rel-bass'),
}));

// ---------------------------------------------------------------- shared: detect button
//
// One button for both channels, since detection is the only step that's genuinely
// per-channel-independent yet always wanted together. Its enabled state is recomputed on
// the same poll as everything else below, not on a dedicated listener — there is no event
// for "a stem just became available" any more than there is for the panels themselves.

const goAllSection = document.getElementById('notes-detect');
const goAllBtn = document.getElementById('notes-go-all');
const goAllSpinner = document.getElementById('notes-detect-spinner');
const goAllStatus = document.getElementById('notes-detect-status');

goAllBtn.addEventListener('click', () => {
  for (const c of channels) if (c.needsAnalyse() && !c.busy()) c.analyse();
});

/* Two illusions this closes: (1) a bare "disabled" button gives no clue that vocals finished
 * while bass is still grinding away — busyChannels names exactly which stem(s) are still in
 * flight, updating as each one lands, so the wait never silently looks finished partway
 * through. (2) the section disappears entirely once every melodic stem present has been
 * analysed — there is nothing left this button could ever do for this song, so leaving it
 * sitting there disabled would itself be a stale-looking leftover. It stays visible+disabled
 * only for the genuinely permanent case: no melodic stem was ever loaded at all. */
function syncGoAll() {
  const anyStem = channels.some((c) => c.hasStem());
  const busyChannels = channels.filter((c) => c.busy());
  const anyPending = channels.some((c) => c.needsAnalyse());
  goAllSection.hidden = anyStem && !anyPending && busyChannels.length === 0;
  goAllBtn.disabled = busyChannels.length > 0 || !anyPending;
  goAllSpinner.hidden = busyChannels.length === 0;
  goAllStatus.textContent = busyChannels.length
    ? tr('notes.detecting', { stems: busyChannels.map((c) => tr('stem.' + c.stem)).join(', ') })
    : '';
}

function refreshAll() {
  refreshTempo();
  for (const c of channels) c.refresh();
  syncGoAll();
}
setInterval(refreshAll, 400);
refreshAll();
