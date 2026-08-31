/* Notes panel: owns the analysis worker and the interpretation on top of it.
 *
 * The split matters and is the whole point of the design — see docs/transcription.md.
 * ANALYSIS (decimate + YIN) runs once in the worker and its result is immutable.
 * INTERPRETATION (interpret()) runs here on the main thread, because at ~12 ms it is
 * cheaper to run than to message, and that is what lets a slider re-derive live.
 *
 * A module, so it cannot share scope with app.js. It talks to the player only through
 * window.sansBass, exactly as separate.js does. */

import { interpret, detectKey, notesToChroma, relativeKey } from './lib/pitch.js?v=1.14.0';
import { scheduleNotes } from './lib/sonify.js?v=1.14.0';

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

/* The key selectors mean nothing while 簡譜 is off, so they go visibly inert rather than
 * silently doing nothing — the same pattern as the fold tolerance slider. */
function syncJianpuControls() {
  el.keyTonic.value = String(jianpu.tonic);
  el.keyMode.value = jianpu.mode;
  for (const c of [el.keyTonic, el.keyMode, el.keyRel]) c.disabled = !jianpu.on;
}

/** Re-derive notes from the existing frames. No worker, no re-analysis. */
function reinterpret() {
  if (!frames) return;
  const p = currentParams();
  notes = interpret(frames, p);
  el.count.textContent = tr('notes.count', { n: notes.length });
  el.minOut.textContent = `${el.min.value} ms`;
  syncFoldControls();
  if (jianpu.auto && notes.length) {
    const k = detectKey(notesToChroma(notes));
    jianpu.tonic = k.tonic;
    jianpu.mode = k.mode;
    syncJianpuControls();
  }
  window.sansBass.setNotes({
    notes, frames, params: p, clip: el.clip.checked,
    jianpu: { on: jianpu.on, tonic: jianpu.tonic, mode: jianpu.mode },
  });
  resync();
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

  worker = new Worker('./notes.worker.js?v=1.14.0', { type: 'module' });
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
