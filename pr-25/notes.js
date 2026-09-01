/* Notes panel: owns the analysis worker and the interpretation on top of it.
 *
 * The split matters and is the whole point of the design — see docs/transcription.md.
 * ANALYSIS (decimate + YIN) runs once in the worker and its result is immutable.
 * INTERPRETATION (interpret()) runs here on the main thread, because at ~12 ms it is
 * cheaper to run than to message, and that is what lets a slider re-derive live.
 *
 * A module, so it cannot share scope with app.js. It talks to the player only through
 * window.sansBass, exactly as separate.js does. */

import { interpret, applyEdits, detectKey, notesToChroma, relativeKey } from './lib/pitch.js?v=1.16.5';
import { scheduleNotes } from './lib/sonify.js?v=1.16.5';

const el = {
  panel: document.getElementById('notes'),
  go: document.getElementById('notes-go'),
  count: document.getElementById('notes-count'),
  tune: document.getElementById('notes-tune'),
  min: document.getElementById('notes-min'),
  minOut: document.getElementById('notes-min-out'),
  clip: document.getElementById('notes-clip'),
  hmm: document.getElementById('notes-hmm'),
  fold: document.getElementById('notes-fold'),
  foldTol: document.getElementById('notes-fold-tol'),
  foldTolOut: document.getElementById('notes-fold-tol-out'),
  foldStats: document.getElementById('notes-fold-stats'),
  show: document.getElementById('notes-show'),
  edit: document.getElementById('notes-edit'),
  editsRow: document.getElementById('notes-edits'),
  editsSummary: document.getElementById('notes-edits-summary'),
  editUndo: document.getElementById('notes-edit-undo'),
  editRows: document.getElementById('notes-edit-rows'),
  exportBtn: document.getElementById('notes-export'),
  importBtn: document.getElementById('notes-import'),
  importFile: document.getElementById('notes-import-file'),
  listSecs: document.getElementById('notes-list-secs'),
  listExport: document.getElementById('notes-list-export'),
  jianpu: document.getElementById('notes-jianpu'),
  keyTonic: document.getElementById('notes-key-tonic'),
  keyMode: document.getElementById('notes-key-mode'),
  keyRel: document.getElementById('notes-key-rel'),
};

/* Note names are never translated in this app — a saved zip is `vocals.wav` in every
 * language, and C# is C# in every language too. */
const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
for (let i = 0; i < 12; i++) {
  const o = document.createElement('option');
  o.value = String(i);
  o.textContent = PITCH_CLASSES[i];
  el.keyTonic.appendChild(o);
}

const tr = (key, params) => window.SansI18n.t(key, params);

/* On the label, not the input: the checkbox itself is a 13 px target and the sentence
 * beside it is what the pointer actually rests on. */
const syncTips = () => {
  el.hmm.parentElement.title = tr('notes.hmmTip');
  el.clip.parentElement.title = tr('notes.clipTip');
  el.fold.parentElement.title = tr('notes.foldTip');
  el.foldTol.parentElement.title = tr('notes.foldTolTip');
  el.jianpu.parentElement.title = tr('notes.jianpuTip');
  el.edit.parentElement.title = tr('notes.editTip');
  el.keyRel.title = tr('notes.relativeTip');
};
syncTips();

let worker = null;
let frames = null;           // the immutable analysis result
let notes = [];
let analysedBuffer = null;   // identity of the AudioBuffer `frames` was computed from
let sonifier = null;         // the running note schedule, or null

/* The 簡譜 reading. `auto` stays true until the user touches a control, so a fresh detection
 * on a newly loaded song adopts its key — but never overrides a choice already made. */
let jianpu = { on: false, tonic: 0, mode: 'major', auto: true };

/* The edit list, as GROUPS — one undo/list-display entry each. Most actions push a
 * one-element group; a normal split pushes two primitive edits (a timeAdjust shrink plus an
 * add) as a single group, so undo and per-row removal act on the whole split at once rather
 * than half of it. lib/pitch.js's applyEdits() only ever sees the flattened primitives — see
 * docs/superpowers/specs/2026-08-31-note-editing-design.md. */
let editGroups = [];
let orphaned = [];         // primitive edits from the last applyEdits() call with no target
let nextEditId = 1;

/* Parameters carry the interpreter that understands them: params written by one are
 * meaningless to another, so the name travels with them. The checkbox picks which — both
 * read the SAME frames, which is what makes comparing them mean anything.
 *
 * `fold` is the exception: it is a post-pass both interpreters share, which is why it sits
 * in `params` rather than beside `interpreter`. Note that `params` is also the bag
 * foldOctaves reads its own tuning from (confidentWithin, maxShift, madMultiple,
 * minHalfWidth), so anything that ever persists and restores this object must not carry a
 * stale one of those forward — it would silently retune the fold. */
function currentParams() {
  return {
    interpreter: el.hmm.checked ? 'hmm-v1' : 'threshold-v1',
    params: {
      minDurationMs: Number(el.min.value),
      fold: el.fold.checked,
      confidentWithin: Number(el.foldTol.value),
    },
  };
}

/* The tolerance slider only means anything while folding is on, so it goes visibly inert
 * rather than silently doing nothing. The counts are the point of the slider: without them
 * you are dragging blind, since the note total deliberately never moves. */
function syncFoldControls() {
  const on = el.fold.checked;
  el.foldTol.disabled = !on;
  el.foldTolOut.textContent = tr('notes.foldTolVal', { n: el.foldTol.value });
  /* An octave-plus-a-fifth error lands about 4.98 semitones from its neighbours, and ordinary
   * melodic movement lands 2-3 out — so the two populations overlap and there is no safe
   * dividing line. From 2.5 up the fold increasingly accepts harmonic errors and draws them
   * blue, i.e. as trusted. Marked rather than forbidden: the range is there to be explored. */
  el.foldTolOut.classList.toggle('risky', Number(el.foldTol.value) >= 2.5);
  el.foldStats.hidden = !on;
  if (!on) return;
  let folded = 0;
  let muted = 0;
  for (const n of notes) {
    if (!n.fix) continue;
    if (n.fix.state === 'folded') folded++;
    else if (n.fix.state === 'doubt') muted++;
  }
  /* Two independently translated fragments rather than one string with two placeholders:
   * the number leads in English ("9 corrected") and trails in Chinese (「已修正 9」), and
   * each half needs its own colour. textContent throughout, never innerHTML. */
  const frag = (key, n, cls) => {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = tr(key, { n });
    return span;
  };
  el.foldStats.replaceChildren(
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

/** Rebuilds the edit-list panel from editGroups/orphaned. Called at the end of reinterpret()
 *  and from reset(). Every node is built and textContent-assigned, never innerHTML — the
 *  same rule every other dynamic list in this file follows. */
function renderEditList() {
  el.editsRow.hidden = editGroups.length === 0;
  el.editsSummary.textContent = tr('notes.editsSummary', { n: editGroups.length });
  el.editUndo.disabled = editGroups.length === 0;
  el.editRows.replaceChildren(...editGroups.map((g) => {
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

/* The key selectors mean nothing while 簡譜 is off, so they go visibly inert rather than
 * silently doing nothing — the same pattern as the fold tolerance slider. */
function syncJianpuControls() {
  el.keyTonic.value = String(jianpu.tonic);
  el.keyMode.value = jianpu.mode;
  for (const c of [el.keyTonic, el.keyMode, el.keyRel]) c.disabled = !jianpu.on;
  /* Meaningless without both a key AND at least one note — unlike the key selectors, which
   * only need 簡譜 to be on (they still work before any analysis has run). */
  el.listExport.disabled = !jianpu.on || !notes.length;
}

/** Re-derive notes from the existing frames. No worker, no re-analysis. */
function reinterpret() {
  if (!frames) return;
  const p = currentParams();
  notes = interpret(frames, p);
  const applied = applyEdits(notes, editGroups.flatMap((g) => g.edits));
  notes = applied.notes;
  orphaned = applied.orphaned;
  el.count.textContent = tr('notes.count', { n: notes.length });
  el.minOut.textContent = `${el.min.value} ms`;
  syncFoldControls();
  if (jianpu.auto && notes.length) {
    const k = detectKey(notesToChroma(notes));
    jianpu.tonic = k.tonic;
    jianpu.mode = k.mode;
  }
  syncJianpuControls();
  window.sansBass.setNotes({
    notes, frames, params: p, clip: el.clip.checked,
    jianpu: { on: jianpu.on, tonic: jianpu.tonic, mode: jianpu.mode },
  });
  resync();
  renderEditList();
}

/* Start (or restart) the synth against the transport's OWN t0 and offset. Scheduling
 * from `ctx.currentTime` instead would put the notes near the stems rather than with
 * them, which is the entire difference between a reference and a distraction. */
function resync() {
  if (sonifier) { sonifier.stop(); sonifier = null; }
  if (!frames || !notes.length) return;
  if (window.sansBass.ribbonMuted()) return;      // muted: schedule nothing at all
  const audio = window.sansBass.notesAudio();
  const t = window.sansBass.transport();
  if (!audio || !t.playing) return;
  sonifier = scheduleNotes(audio.ctx, audio.destination, notes, {
    when: t.t0, offset: t.offset, loopA: t.loopA, loopB: t.loopB,
  });
}

/* The button says what pressing it will DO, not what the state is — "Hide notes" while
 * they are showing. Naming the action is the convention the rest of the player follows. */
function syncShowLabel() {
  el.show.textContent = tr(window.sansBass.ribbonVisible() ? 'notes.hide' : 'notes.show');
}

function reset() {
  if (sonifier) { sonifier.stop(); sonifier = null; }
  /* Terminate an analysis still in flight. Left running it burns a core to completion and
   * then writes the PREVIOUS song's frames into module state — self-correcting on the next
   * refresh tick, but until then a slider drag or a play press schedules the old song's
   * notes against the new one. */
  if (worker) { worker.terminate(); worker = null; el.go.disabled = false; }
  el.show.hidden = true;
  el.go.hidden = false;
  frames = null;
  notes = [];
  analysedBuffer = null;
  el.tune.hidden = true;
  el.count.textContent = '';
  /* Hand the key back to automatic detection. An override is a statement about THIS song —
   * carrying it into the next one labels every note from an unrelated key, and the selectors
   * sit there reading a value nothing chose. The 簡譜 checkbox itself is a reading
   * preference, not a claim about the music, so it deliberately survives the load. */
  jianpu.auto = true;
  editGroups = [];
  orphaned = [];
  el.edit.disabled = true;
  el.edit.checked = false;
  el.exportBtn.disabled = true;
  el.importBtn.disabled = true;
  window.dispatchEvent(new CustomEvent('sansbass:editmode', { detail: { on: false } }));
  renderEditList();
  syncJianpuControls();
}

function analyse() {
  const stem = window.sansBass.stemBuffer('vocals');
  if (!stem) return;

  el.go.disabled = true;
  window.sansBass.say('notes.working');

  const buffer = stem.buffer;
  const channels = [];
  /* .slice() — a COPY. getChannelData returns a live view into an AudioBuffer that is
   * very possibly playing right now; handing the view to postMessage as a transferable
   * detaches its backing store and the stem goes silent with no error anywhere. */
  for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i).slice());

  worker = new Worker('./notes.worker.js?v=1.16.5', { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    worker.terminate();
    worker = null;
    el.go.disabled = false;
    if (m.type === 'error') {
      window.sansBass.say('notes.failed', { message: m.message }, true);
      return;
    }
    window.sansBass.say('');
    frames = m.frames;
    el.tune.hidden = false;
    el.go.hidden = true;      // its job is done; the toggle takes its place
    el.show.hidden = false;
    el.edit.disabled = false;
    el.exportBtn.disabled = false;
    el.importBtn.disabled = false;
    syncShowLabel();
    reinterpret();
  };
  worker.onerror = (e) => {
    if (worker) { worker.terminate(); worker = null; }
    el.go.disabled = false;
    window.sansBass.say('notes.failed', { message: e.message || 'worker error' }, true);
  };
  analysedBuffer = buffer;
  worker.postMessage({ type: 'analyse', channels, sampleRate: buffer.sampleRate });
}

/* The panel is only meaningful with a vocals stem, and there is no load event to hang
 * this on — separate.js polls the same way, for the same reason. */
function refresh() {
  const stem = window.sansBass?.stemBuffer?.('vocals');
  el.panel.hidden = !stem;
  /* Reset when the vocals stem goes away OR is replaced. Checking only for absence would
   * keep the previous song's frames alive across a load of another zip that also has
   * vocals — and the lane would then draw the old melody against the new duration. Buffer
   * identity is the reliable signal; a name can repeat across albums. */
  if (frames && (!stem || stem.buffer !== analysedBuffer)) reset();
}
setInterval(refresh, 400);
refresh();
syncJianpuControls();      // the selectors are inert until 簡譜 is ticked, from the first paint

el.go.addEventListener('click', analyse);
el.min.addEventListener('input', reinterpret);
el.clip.addEventListener('change', reinterpret);   // clip rides in the payload
el.hmm.addEventListener('change', reinterpret);
el.fold.addEventListener('change', reinterpret);
el.foldTol.addEventListener('input', reinterpret);
el.jianpu.addEventListener('change', () => {
  jianpu.on = el.jianpu.checked;
  syncJianpuControls();
  reinterpret();
});
el.edit.addEventListener('change', () => {
  window.dispatchEvent(new CustomEvent('sansbass:editmode', { detail: { on: el.edit.checked } }));
});
/* Touching either selector ends the automatic tracking: a detected key is a suggestion, and
 * once it has been overruled a later re-interpretation must not quietly undo that. */
for (const c of [el.keyTonic, el.keyMode]) {
  c.addEventListener('change', () => {
    jianpu.auto = false;
    jianpu.tonic = Number(el.keyTonic.value);
    jianpu.mode = el.keyMode.value;
    reinterpret();
  });
}
el.keyRel.addEventListener('click', () => {
  const r = relativeKey(jianpu.tonic, jianpu.mode);
  jianpu.auto = false;
  jianpu.tonic = r.tonic;
  jianpu.mode = r.mode;
  syncJianpuControls();
  reinterpret();
});
el.show.addEventListener('click', () => {
  window.sansBass.setRibbonVisible(!window.sansBass.ribbonVisible());
  syncShowLabel();
});
window.addEventListener('sansbass:langchange', () => {
  if (frames) {
    el.count.textContent = tr('notes.count', { n: notes.length });
    syncShowLabel();
  }
  syncTips();
});

/* The player broadcasts its transport because app.js is a classic script and this file is
 * a module — the same seam the language switch uses. `seek()` is composed of stop() then
 * play(), so those two events cover scrubbing as well. */
window.addEventListener('sansbass:transport', (e) => {
  if (!e.detail.playing) {
    if (sonifier) { sonifier.stop(); sonifier = null; }
    return;
  }
  resync();
});
window.addEventListener('sansbass:ribbonmute', resync);
/* app.js owns the zoomed pane and dispatches this once the user finishes an edit action —
 * one primitive edit for most actions, two for a normal split (shrink + add) — always
 * grouped as one undo/list entry. See docs/superpowers/specs/2026-08-31-note-editing-design.md. */
window.addEventListener('sansbass:noteedit', (e) => {
  editGroups.push({ id: nextEditId++, edits: e.detail.edits });
  reinterpret();
});
el.editUndo.addEventListener('click', () => {
  editGroups.pop();
  reinterpret();
});
window.addEventListener('sansbass:editundo', () => {
  editGroups.pop();
  reinterpret();
});

/* The floating panel (styles.css: .notes-edit-panel, position: absolute) doesn't push
 * anything down while open, but it also doesn't get the free "click elsewhere closes it"
 * behaviour a native dropdown would — <details> only toggles on its own summary. pointerdown,
 * not click, so it closes as soon as a drag starts elsewhere (e.g. into the zoomed pane)
 * rather than waiting for that gesture's release. Runs on every pointerdown regardless of
 * `open`, same as syncEditToolbar's per-frame check elsewhere in this feature — cheap enough
 * not to need gating. */
document.addEventListener('pointerdown', (e) => {
  if (el.editsRow.open && !el.editsRow.contains(e.target)) el.editsRow.open = false;
});

el.exportBtn.addEventListener('click', () => {
  const mix = window.sansBass.currentMix ? window.sansBass.currentMix() : null;
  const payload = {
    version: 1,
    ...(mix ? { song: mix.name } : {}),
    ...currentParams(),
    clip: el.clip.checked,
    jianpu: { on: jianpu.on, tonic: jianpu.tonic, mode: jianpu.mode },
    edits: editGroups.map((g) => g.edits),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${mix ? mix.name : 'song'}-edits.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
});

/* A human-readable export, independent of the JSON edits round-trip above: the current
 * 簡譜 reading, chunked into fixed-length timecoded lines, for reading (e.g. while singing)
 * without the player open. See docs/superpowers/specs/2026-09-01-notes-jianpu-export-design.md. */
function mmss(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

el.listExport.addEventListener('click', () => {
  const secs = Number(el.listSecs.value) || 10;
  const mix = window.sansBass.currentMix ? window.sansBass.currentMix() : null;
  const refOct = window.SansJianpu.referenceOctave(notes, jianpu.tonic);

  const windows = new Map();
  for (const n of notes) {
    const idx = Math.floor(n.start / secs);
    if (!windows.has(idx)) windows.set(idx, []);
    windows.get(idx).push(n);
  }

  const modeWord = tr(jianpu.mode === 'minor' ? 'notes.minor' : 'notes.major');
  const lines = [`# ${mix ? mix.name + ' — ' : ''}1=${PITCH_CLASSES[jianpu.tonic]} ${modeWord}`, ''];
  for (const idx of [...windows.keys()].sort((a, b) => a - b)) {
    const from = idx * secs;
    const to = from + secs;
    lines.push(`== ${mmss(from)} - ${mmss(to)}`);
    lines.push(windows.get(idx)
      .map((n) => window.SansJianpu.degreeToken(n.midi, jianpu.tonic, jianpu.mode, refOct))
      .join(' '));
    lines.push('');
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${mix ? mix.name : 'song'}-notes.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
});

el.importBtn.addEventListener('click', () => el.importFile.click());

/* Cleared after read, same reason app.js's #file-input does it: picking the same file twice
 * in a row must still fire change. */
el.importFile.addEventListener('change', async (e) => {
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

  if (data.params) {
    if (data.params.minDurationMs != null) el.min.value = data.params.minDurationMs;
    el.fold.checked = !!data.params.fold;
    if (data.params.confidentWithin != null) el.foldTol.value = data.params.confidentWithin;
  }
  el.hmm.checked = data.interpreter !== 'threshold-v1';
  el.clip.checked = data.clip !== false;
  if (data.jianpu) {
    jianpu.on = !!data.jianpu.on;
    jianpu.auto = false;
    jianpu.tonic = data.jianpu.tonic ?? 0;
    jianpu.mode = data.jianpu.mode || 'major';
    el.jianpu.checked = jianpu.on;
  }
  editGroups = data.edits.map((edits) => ({ id: nextEditId++, edits }));
  syncJianpuControls();
  reinterpret();
});
