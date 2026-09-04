# Chroma-based chord detection for the 簡譜 export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bass-note-as-root chord detector with chromagram + chord-template
matching over whichever of guitar/piano/bass are loaded, with optional slash-chord
(`Root/BassNote`) fusion from the bass channel's own tracked notes.

**Architecture:** A new pure module `lib/chroma.js` extracts a 12-bin chromagram from a
window of audio via Hann-windowed Goertzel power at 48 fixed target frequencies (MIDI 36-83),
then scores it against 72 chord templates (12 roots x 6 qualities) with Pearson correlation.
`lib/chords.js` is rewritten to drive this per half-bar over a caller-assembled mono mix of
the harmonic stems, decimating once for the whole song, and to fuse in a slash chord when the
bass channel's own note disagrees with the chroma-matched root. `notes.js`'s export handler
is rewired to assemble that mix and to stop reading tonic/mode off the bass channel (chroma
matching no longer depends on key at all).

**Tech Stack:** Vanilla ES modules, Vitest (Node tier for the new/rewritten pure-function
tests), no new dependencies.

**Spec:** [`docs/superpowers/specs/2026-09-03-chroma-chord-detection-design.md`](../specs/2026-09-03-chroma-chord-detection-design.md)
(supersedes [`2026-09-03-bass-chord-detection-design.md`](../specs/2026-09-03-bass-chord-detection-design.md))

## Global Constraints

- Chord vocabulary is exactly `{maj, min, 7, min7, sus2, sus4}` — no other qualities (no
  maj7/dim/aug/6/add9/...).
- No confidence threshold or "uncertain" marker — always render the top template match.
- No beat-synchronous or HMM cross-bar smoothing — bar boundaries come in already known.
- No UI for correcting or overriding a chord guess.
- Chord detection is independent of the song's detected key entirely (a wrong key estimate
  can no longer produce a wrong chord).
- `detectChords()`'s per-bar `{ first, second }` output contract is unchanged from today — no
  changes to `lib/jianpu.js`, `notes.js`'s rendering (`jianpuHtml`/`fragmentHtml`, the
  `.chords`/`.chord-first`/`.chord-second` markup/CSS), the live app UI, the ribbon, or the
  zoomed pane.
- `lib/chroma.js` and `lib/chords.js` are pure: no DOM, no AudioContext, no Worker — mirrors
  `lib/tempo.js`/`lib/pitch.js`.
- Target frequencies: MIDI 36 (C2) through 83 (B5) inclusive, 48 notes, via
  `hzFromCents(midi * 100)` from `lib/pitch.js` (reuses the existing A4=440 anchor).
- Silence gate: `silenceDb: -50`, converted to linear RMS the same way
  `TRACK_DEFAULTS.silenceDb` already is in `lib/pitch.js`'s `f0Track`.
- Decimation factor 2 (44100 -> 22050 Hz) via `decimate()` from `lib/pitch.js`, once for the
  whole song, not per half-bar.
- Template scoring uses the same Pearson-correlation helper `detectKey()` already uses
  internally in `lib/pitch.js` (`pearson`) — exported for reuse, no behavior change.
- Degrades gracefully: any subset of `{guitar, piano, bass}` loaded (down to just one) still
  produces chords from whatever is mixed in; zero of the three loaded produces no chord data
  at all, identical in effect to today's "no bass stem" case.
- This repo's standing rules apply throughout: real ESM `import`/`export` (no
  `window.SansX` bridges), vanilla JS, `npm test` (Vitest) as the automated gate.

---

## File Structure

```
lib/pitch.js          (modified) — export the existing `pearson` helper, no behavior change
lib/chroma.js         (new)      — chromaFromAudio, matchChordTemplate (pure, ESM)
lib/chords.js         (rewritten) — detectChords, new signature/internals
tests/chroma.test.js  (new)
tests/chords.test.js  (rewritten)
vitest.config.js      (modified) — register 'chroma' in the Node test tier
notes.js              (modified) — mixDown() + HARMONIC_STEMS, chordSource() narrowed to
                        { notes }, listExport handler rewired, jianpuHtml doc comment updated
docs/behaviour.md     (modified) — E44 rewritten for the chroma-based redesign
```

---

### Task 1: `lib/chroma.js` — chromagram extraction and chord-template matching

**Files:**
- Modify: `lib/pitch.js:479` (export the existing `pearson` helper)
- Create: `lib/chroma.js`
- Test: `tests/chroma.test.js`
- Modify: `vitest.config.js` (register the new test file in the Node tier)

**Interfaces:**
- Consumes: `hzFromCents(cents) → number` and `TRACK_DEFAULTS.silenceDb` (both already exported
  from `lib/pitch.js`); `pearson(a, b) → number` (exported by this task's first step).
- Produces: `chromaFromAudio(samples, sampleRate, tStart, tEnd, opts) → Float32Array(12)` and
  `matchChordTemplate(chroma) → { rootPc, quality, score } | null`, both consumed by Task 2.

- [ ] **Step 1: Export `pearson` from `lib/pitch.js`**

In `lib/pitch.js`, change line 479 from:

```js
function pearson(a, b) {
```

to:

```js
export function pearson(a, b) {
```

No other change in this file — same helper, same behavior, just a wider export surface so
`lib/chroma.js` can reuse it instead of duplicating it.

- [ ] **Step 2: Write the failing tests**

Create `tests/chroma.test.js`:

```js
import { test, assert, assertEq } from './assert.js';
import { hzFromCents } from '../lib/pitch.js';
import { chromaFromAudio, matchChordTemplate } from '../lib/chroma.js';

function sine(hz, seconds, sampleRate, amp = 0.3) {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

test('chroma: a 440 Hz sine tone peaks its chroma bin at pitch class A', () => {
  const sampleRate = 44100;
  const chroma = chromaFromAudio(sine(440, 1, sampleRate), sampleRate, 0, 1);
  let peak = 0;
  for (let i = 1; i < 12; i++) if (chroma[i] > chroma[peak]) peak = i;
  assertEq(peak, 9, 'A is pitch class 9');
});

test('chroma: an octave-up tone (880 Hz) folds into the same pitch class as 440 Hz', () => {
  const sampleRate = 44100;
  const chromaLow = chromaFromAudio(sine(440, 1, sampleRate), sampleRate, 0, 1);
  const chromaHigh = chromaFromAudio(sine(880, 1, sampleRate), sampleRate, 0, 1);
  let peakLow = 0;
  let peakHigh = 0;
  for (let i = 1; i < 12; i++) {
    if (chromaLow[i] > chromaLow[peakLow]) peakLow = i;
    if (chromaHigh[i] > chromaHigh[peakHigh]) peakHigh = i;
  }
  assertEq(peakLow, peakHigh, 'both fold to pitch class A (9)');
});

test('chroma: a silent (all-zero) window returns an all-zero vector', () => {
  const sampleRate = 44100;
  const chroma = chromaFromAudio(new Float32Array(sampleRate), sampleRate, 0, 1);
  for (let i = 0; i < 12; i++) assertEq(chroma[i], 0, `bin ${i} is zero`);
});

test('chroma: the RMS silence gate rejects a very quiet signal below silenceDb -50', () => {
  const sampleRate = 44100;
  const amp = Math.pow(10, -60 / 20);   // -60 dBFS: well under the -50 dB gate
  const chroma = chromaFromAudio(sine(440, 1, sampleRate, amp), sampleRate, 0, 1);
  for (let i = 0; i < 12; i++) assertEq(chroma[i], 0, `bin ${i} is zero below the gate`);
});

function chromaAt(pcs) {
  const chroma = new Float32Array(12);
  for (const pc of pcs) chroma[pc] = 1;
  return chroma;
}

test('matchChordTemplate: C/E/G (pitch classes 0,4,7) matches C major', () => {
  const match = matchChordTemplate(chromaAt([0, 4, 7]));
  assertEq(match.rootPc, 0);
  assertEq(match.quality, 'maj');
});

test('matchChordTemplate: C/D#/G (0,3,7) matches C minor', () => {
  const match = matchChordTemplate(chromaAt([0, 3, 7]));
  assertEq(match.rootPc, 0);
  assertEq(match.quality, 'min');
});

test('matchChordTemplate: C/E/G/A# (0,4,7,10) matches C7', () => {
  const match = matchChordTemplate(chromaAt([0, 4, 7, 10]));
  assertEq(match.rootPc, 0);
  assertEq(match.quality, '7');
});

test('matchChordTemplate: C/D#/G/A# (0,3,7,10) matches Cmin7', () => {
  const match = matchChordTemplate(chromaAt([0, 3, 7, 10]));
  assertEq(match.rootPc, 0);
  assertEq(match.quality, 'min7');
});

test('matchChordTemplate: C/D/G (0,2,7) matches Csus2', () => {
  const match = matchChordTemplate(chromaAt([0, 2, 7]));
  assertEq(match.rootPc, 0);
  assertEq(match.quality, 'sus2');
});

test('matchChordTemplate: C/F/G (0,5,7) matches Csus4', () => {
  const match = matchChordTemplate(chromaAt([0, 5, 7]));
  assertEq(match.rootPc, 0);
  assertEq(match.quality, 'sus4');
});

test('matchChordTemplate: an all-zero chroma returns null', () => {
  assertEq(matchChordTemplate(new Float32Array(12)), null);
});
```

- [ ] **Step 3: Register the new test file and run to verify it fails**

In `vitest.config.js`, change:

```js
const NODE_TESTS = [
  'soundtouch', 'transport-math', 'overlap', 'tempo', 'pitch', 'ribbon', 'zip', 'unzip', 'stems',
  'jianpu', 'platform', 'notes-edits', 'time', 'chords',
].map((name) => `tests/${name}.test.js`);
```

to:

```js
const NODE_TESTS = [
  'soundtouch', 'transport-math', 'overlap', 'tempo', 'pitch', 'ribbon', 'zip', 'unzip', 'stems',
  'jianpu', 'platform', 'notes-edits', 'time', 'chroma', 'chords',
].map((name) => `tests/${name}.test.js`);
```

Run: `npx vitest run tests/chroma.test.js`
Expected: FAIL — `lib/chroma.js` does not exist yet (module resolution error).

- [ ] **Step 4: Implement `lib/chroma.js`**

Create `lib/chroma.js`:

```js
/* Chromagram extraction and chord-template matching, over the harmonic instruments' audio
 * (guitar/piano/bass, mixed) — the front half of the chroma-based chord detector, which
 * lib/chords.js drives per half-bar. Pure: no DOM, no AudioContext, no Worker — same
 * isolation rule as lib/tempo.js. See
 * docs/superpowers/specs/2026-09-03-chroma-chord-detection-design.md. */
import { hzFromCents, TRACK_DEFAULTS, pearson } from './pitch.js';

// MIDI 36 (C2, 65.41 Hz) through 83 (B5, 987.77 Hz) inclusive: 48 notes, 4 full octaves,
// 12 pitch classes x 4 — every target frequency chromaFromAudio scans.
const MIDI_LOW = 36;
const MIDI_HIGH = 83;

/** Goertzel power at `freq` over an already Hann-windowed buffer — one multiply-add pass
 *  per sample, same O(n) shape as yinFrame's own difference-function loop in lib/pitch.js.
 *  No FFT: only 48 frequencies are ever wanted here, not a full spectrum. */
function goertzelPower(windowed, freq, sampleRate) {
  const omega = (2 * Math.PI * freq) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < windowed.length; i++) {
    const s0 = windowed[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const real = s1 - s2 * Math.cos(omega);
  const imag = s2 * Math.sin(omega);
  return real * real + imag * imag;
}

/**
 * One chroma bin per pitch class (index 0 = C, same convention as notesToChroma() in
 * lib/pitch.js), normalized to sum 1. All-zero when the window is silent — RMS gated on the
 * raw signal before any Goertzel folding, against `opts.silenceDb` (default
 * TRACK_DEFAULTS.silenceDb, -50), converted to linear RMS the same way f0Track() already
 * does.
 */
export function chromaFromAudio(samples, sampleRate, tStart, tEnd, opts = {}) {
  const silenceDb = opts.silenceDb ?? TRACK_DEFAULTS.silenceDb;
  const start = Math.max(0, Math.round(tStart * sampleRate));
  const end = Math.min(samples.length, Math.round(tEnd * sampleRate));
  const chroma = new Float32Array(12);
  const n = end - start;
  if (n <= 0) return chroma;

  let energy = 0;
  for (let i = start; i < end; i++) energy += samples[i] * samples[i];
  const silenceRms = Math.pow(10, silenceDb / 20);
  if (Math.sqrt(energy / n) < silenceRms) return chroma;

  const windowed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1 || 1));
    windowed[i] = samples[start + i] * w;
  }

  for (let midi = MIDI_LOW; midi <= MIDI_HIGH; midi++) {
    const freq = hzFromCents(midi * 100);
    chroma[midi % 12] += goertzelPower(windowed, freq, sampleRate);
  }

  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i];
  if (sum > 0) for (let i = 0; i < 12; i++) chroma[i] /= sum;
  return chroma;
}

// Interval sets in semitones from the root, for the agreed chord vocabulary — the design
// spec's Goal 2.
const CHORD_QUALITIES = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  7: [0, 4, 7, 10],
  min7: [0, 3, 7, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
};

// 72 templates (12 roots x 6 qualities), built once at module load — a 12-bin vector with a
// 1 at each interval's pitch class rooted at that root, 0 elsewhere.
const TEMPLATES = (() => {
  const out = [];
  for (let root = 0; root < 12; root++) {
    for (const quality of Object.keys(CHORD_QUALITIES)) {
      const vec = new Float32Array(12);
      for (const interval of CHORD_QUALITIES[quality]) vec[(root + interval) % 12] = 1;
      out.push({ rootPc: root, quality, vec });
    }
  }
  return out;
})();

/**
 * The best-scoring chord template against a 12-bin chroma, via the same Pearson-correlation
 * helper detectKey() uses internally in lib/pitch.js. `null` when `chroma` is all-zero (the
 * silence gate in chromaFromAudio already produces this for a silent window).
 */
export function matchChordTemplate(chroma) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i];
  if (sum === 0) return null;

  let best = null;
  for (const t of TEMPLATES) {
    const score = pearson(chroma, t.vec);
    if (!best || score > best.score) best = { rootPc: t.rootPc, quality: t.quality, score };
  }
  return best;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/chroma.test.js`
Expected: PASS, all 11 tests.

- [ ] **Step 6: Run the full suite and commit**

Run: `npm test`
Expected: PASS (no regressions in `tests/pitch.test.js` from the `pearson` export — it only
widens the export surface).

```bash
git add lib/pitch.js lib/chroma.js tests/chroma.test.js vitest.config.js
git commit -m "$(cat <<'EOF'
feat: add chroma extraction and chord-template matching

lib/chroma.js computes a 12-bin chromagram via Hann-windowed Goertzel power at 48 fixed
MIDI target frequencies and scores it against 72 chord templates (maj/min/7/min7/sus2/sus4)
with Pearson correlation, reused from lib/pitch.js's detectKey() via a newly-exported
pearson() helper.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PN6gyeK5cRavgTM42Juqbk
EOF
)"
```

---

### Task 2: Rewrite `lib/chords.js` — per-half chord labels with slash-chord fusion

**Files:**
- Modify: `lib/chords.js` (full rewrite)
- Test: `tests/chords.test.js` (full rewrite)

**Interfaces:**
- Consumes: `chromaFromAudio`/`matchChordTemplate` from Task 1 (`lib/chroma.js`); `decimate`
  and `roundSeconds` (already exported from `lib/pitch.js` and `lib/time.js`).
- Produces: `detectChords(harmonicSamples, sampleRate, barBounds, bassNotes) →
  Array<{ first, second }>`, consumed by Task 3 (`notes.js`).

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `tests/chords.test.js` with:

```js
import { test, assert, assertEq } from './assert.js';
import { hzFromCents } from '../lib/pitch.js';
import { detectChords } from '../lib/chords.js';

const SR = 44100;

function sine(hz, seconds, sampleRate, amp = 0.3) {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

function chordTone(midis, seconds, sampleRate) {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (const midi of midis) {
    const tone = sine(hzFromCents(midi * 100), seconds, sampleRate);
    for (let i = 0; i < out.length; i++) out[i] += tone[i];
  }
  return out;
}

function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

const n = (start, end, midi) => ({ start, end, midi });

// A major triad (A3 C#4 E4) then E major triad (E4 G#4 B4), 1 second each — one 2-second
// bar, midpoint at 1s.
const A_MAJ = [57, 61, 64];
const E_MAJ = [64, 68, 71];
const ONE_BAR = [0, 2];

test('chords: a bar with an A-major triad in half 1 and E-major in half 2 labels "A" then "E"', () => {
  const samples = concat(chordTone(A_MAJ, 1, SR), chordTone(E_MAJ, 1, SR));
  const [bar] = detectChords(samples, SR, ONE_BAR, null);
  assertEq(bar.first, 'A');
  assertEq(bar.second, 'E');
});

test('chords: slash-chord fusion labels "E/G#" when the bass note differs from the chroma root', () => {
  const samples = concat(chordTone(A_MAJ, 1, SR), chordTone(E_MAJ, 1, SR));
  const bassNotes = [n(1, 2, 56)];   // G#3 (pc 8) under the E-major half
  const [bar] = detectChords(samples, SR, ONE_BAR, bassNotes);
  assertEq(bar.second, 'E/G#');
});

test('chords: a matching bass pitch class omits the slash', () => {
  const samples = concat(chordTone(A_MAJ, 1, SR), chordTone(E_MAJ, 1, SR));
  const bassNotes = [n(1, 2, 64)];   // E4 (pc 4) — same pitch class as the chroma root
  const [bar] = detectChords(samples, SR, ONE_BAR, bassNotes);
  assertEq(bar.second, 'E');
});

test('chords: bassNotes null produces plain root+quality labels, no slash, on the same chroma', () => {
  const samples = concat(chordTone(A_MAJ, 1, SR), chordTone(E_MAJ, 1, SR));
  const [bar] = detectChords(samples, SR, ONE_BAR, null);
  assertEq(bar.second, 'E');
});

test('chords: a bass note that does not overlap the window leaves the label alone', () => {
  const samples = concat(chordTone(A_MAJ, 1, SR), chordTone(E_MAJ, 1, SR));
  const bassNotes = [n(5, 6, 56)];   // well outside either half
  const [bar] = detectChords(samples, SR, ONE_BAR, bassNotes);
  assertEq(bar.first, 'A');
  assertEq(bar.second, 'E');
});

test('chords: a silent half labels null', () => {
  const samples = concat(chordTone(A_MAJ, 1, SR), new Float32Array(SR));
  const [bar] = detectChords(samples, SR, ONE_BAR, null);
  assertEq(bar.first, 'A');
  assertEq(bar.second, null, 'no audio in the second half');
});

test('chords: the same chord in both halves comes back with second === null', () => {
  const samples = concat(chordTone(A_MAJ, 1, SR), chordTone(A_MAJ, 1, SR));
  const [bar] = detectChords(samples, SR, ONE_BAR, null);
  assertEq(bar.first, 'A');
  assertEq(bar.second, null, 'same label both halves: second is deduped to null');
});

test('chords: a bar splits at its time MIDPOINT, not by beat count (a non-4/4 bar)', () => {
  const samples = concat(chordTone(A_MAJ, 1.5, SR), chordTone(E_MAJ, 1.5, SR));
  const [bar] = detectChords(samples, SR, [0, 3], null);
  assertEq(bar.first, 'A', 'first half [0, 1.5)');
  assertEq(bar.second, 'E', 'second half [1.5, 3)');
});

test('chords: multiple bars each get their own entry, same convention as layoutBars', () => {
  const samples = concat(chordTone(A_MAJ, 2, SR), chordTone(E_MAJ, 2, SR));
  const bars = detectChords(samples, SR, [0, 2, 4], null);
  assertEq(bars.length, 2);
  assertEq(bars[0].first, 'A');
  assertEq(bars[1].first, 'E');
});

test('chords: silent harmonicSamples produces every bar/half null', () => {
  const bars = detectChords(new Float32Array(4 * SR), SR, [0, 2, 4], null);
  assertEq(bars.length, 2);
  for (const bar of bars) {
    assertEq(bar.first, null);
    assertEq(bar.second, null);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/chords.test.js`
Expected: FAIL — `detectChords`'s current signature is `(bassNotes, barBounds, tonicPc,
mode)`, incompatible with the new calls (a `Float32Array` where `barBounds` is expected, and
`detectChords`'s old body treats `harmonicSamples`/`SR` as `bassNotes`/`barBounds`), so
assertions on `bar.first`/`bar.second` fail or throw.

- [ ] **Step 3: Rewrite `lib/chords.js`**

Replace the entire contents of `lib/chords.js` with:

```js
/* Chord labels guessed from a chromagram over the harmonic instruments (guitar/piano/bass,
 * whichever are loaded, mixed together), printed above each bar of a 簡譜 export — with
 * optional slash-chord fusion against the bass channel's own tracked notes, when the actual
 * bass note in a half-bar differs from the chroma-matched chord's root. Pure, no DOM —
 * mirrors lib/jianpu.js, so it's testable in isolation and imported directly by notes.js
 * alongside it. See docs/superpowers/specs/2026-09-03-chroma-chord-detection-design.md
 * (supersedes docs/superpowers/specs/2026-09-03-bass-chord-detection-design.md). */
import { roundSeconds } from './time.js';
import { decimate } from './pitch.js';
import { chromaFromAudio, matchChordTemplate } from './chroma.js';

/* Note names are never translated in this app, same convention as notes.js's own
 * PITCH_CLASSES — sharps only. */
const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const QUALITY_SUFFIX = { maj: '', min: 'm', 7: '7', min7: 'm7', sus2: 'sus2', sus4: 'sus4' };

// 44100 -> 22050 Hz: comfortably above the ~988 Hz top target frequency chromaFromAudio
// scans, unlike lib/pitch.js's own pitch-tracking default factor (4), which is tuned for a
// lower frequency range. decimate()'s cost is linear in signal length regardless of how the
// result is sliced afterward, so the whole song is decimated once, not per half-bar.
const CHROMA_DECIMATION = 2;

/** The note with the greatest overlap duration inside `[halfStart, halfEnd)` — ties broken
 *  by earliest `start`. `notes` is every note already known to overlap the window at all
 *  (so every candidate's overlap here is > 0). Kept verbatim from the superseded bass-chord
 *  design, re-described: it now answers "what note is actually in the bass" for slash-chord
 *  fusion, not "what is the chord root". */
function pickBassNote(notes, halfStart, halfEnd) {
  let best = notes[0];
  let bestOverlap = Math.min(best.end, halfEnd) - Math.max(best.start, halfStart);
  for (let i = 1; i < notes.length; i++) {
    const note = notes[i];
    const overlap = Math.min(note.end, halfEnd) - Math.max(note.start, halfStart);
    if (overlap > bestOverlap || (overlap === bestOverlap && note.start < best.start)) {
      best = note;
      bestOverlap = overlap;
    }
  }
  return best;
}

/** One half-bar's chord label, or `null` if silent. `notesInWindow` is every bass note
 *  overlapping `[halfStart, halfEnd)` at all, an empty array when bass notes exist but none
 *  overlap, or `null` when the bass channel has no analysis at all — only the first case can
 *  produce a slash. */
function labelForHalf(samples, sampleRate, halfStart, halfEnd, notesInWindow) {
  const chroma = chromaFromAudio(samples, sampleRate, halfStart, halfEnd);
  const match = matchChordTemplate(chroma);
  if (!match) return null;
  const rootName = PITCH_CLASSES[match.rootPc];
  const label = rootName + QUALITY_SUFFIX[match.quality];
  if (!notesInWindow || !notesInWindow.length) return label;

  const bassNote = pickBassNote(notesInWindow, halfStart, halfEnd);
  const bassPc = ((bassNote.midi % 12) + 12) % 12;
  return bassPc === match.rootPc ? label : `${label}/${PITCH_CLASSES[bassPc]}`;
}

/**
 * A chord guess for each half of each bar, from a chromagram over `harmonicSamples` — the
 * caller-assembled sum of whichever of guitar/piano/bass are loaded (mixed together),
 * independent of which channel is being exported. `bassNotes` is the bass channel's own
 * tracked notes for slash-chord fusion, or `null` when the bass channel has no analysis yet.
 * One `{ first, second }` entry per bar (`barBounds.length - 1` entries, same convention as
 * lib/jianpu.js's layoutBars). `second` is `null` whenever that half is silent OR resolves to
 * the same label as `first` — the caller renders whatever isn't null with no comparison of
 * its own.
 *
 * Each half is split at the bar's time MIDPOINT, not by beat count, so this stays correct
 * under a non-4/4 beatsPerBar — same convention the superseded bass-note design already used.
 * `barBounds` is rounded through roundSeconds first, same precision every note's own
 * start/end is stored at (see lib/jianpu.js's layoutBars doc comment for why).
 */
export function detectChords(harmonicSamples, sampleRate, barBounds, bassNotes) {
  const dec = decimate([harmonicSamples], sampleRate, CHROMA_DECIMATION);
  const bounds = barBounds.map(roundSeconds);
  const result = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const barStart = bounds[i];
    const barEnd = bounds[i + 1];
    const mid = roundSeconds((barStart + barEnd) / 2);
    const halves = [[barStart, mid], [mid, barEnd]];
    const [first, second] = halves.map(([hs, he]) => {
      const notesInWindow = bassNotes
        ? bassNotes.filter((note) => note.start < he && note.end > hs)
        : null;
      return labelForHalf(dec.samples, dec.sampleRate, hs, he, notesInWindow);
    });
    result.push({ first, second: second === first ? null : second });
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/chords.test.js`
Expected: PASS, all 10 tests.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: PASS. (`notes.js` still calls `detectChords()` with the OLD signature until Task 3
— this is fine, since nothing in the automated suite exercises `notes.js`'s `listExport`
handler; Task 3 fixes the call site next.)

```bash
git add lib/chords.js tests/chords.test.js
git commit -m "$(cat <<'EOF'
feat: rewrite chord detection to chroma-template matching with slash-chord fusion

Replaces the bass-note-as-root diatonic-table approach with a chromagram over the harmonic
stems matched against maj/min/7/min7/sus2/sus4 templates, independent of the song's detected
key. A bass note whose pitch class differs from the chroma-matched root now produces a
Root/BassNote slash label (e.g. E/G#) instead of mislabeling the chord entirely.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PN6gyeK5cRavgTM42Juqbk
EOF
)"
```

---

### Task 3: Wire chroma-based chords into `notes.js`'s export flow

**Files:**
- Modify: `notes.js`

**Interfaces:**
- Consumes: `detectChords(harmonicSamples, sampleRate, barBounds, bassNotes) →
  Array<{ first, second }>` from Task 2; `window.sansBass.stemBuffer(stem) → { name, buffer }
  | null` (already exists in `app.js`).
- Produces: nothing consumed by a later task — this is the integration point.

- [ ] **Step 1: Add the harmonic-mix helper**

In `notes.js`, immediately after `currentTempoRangeChannels()`'s closing brace (the function
ending `return { channels: chans, sampleRate: buffer.sampleRate }; }`), insert:

```js

/** Every stem whose chroma can contribute a chord label — guitar/piano/bass, mixed
 *  together regardless of which channel is being exported (bass alone is also this app's
 *  only note-tracked channel, so it doubles as the slash-chord fusion source below). */
const HARMONIC_STEMS = ['guitar', 'piano', 'bass'];

/** Sums each loaded AudioBuffer's channels to mono (same per-sample averaging
 *  onsetEnvelope() already does in lib/tempo.js for multi-channel input), then sums those
 *  mono signals sample-for-sample, zero-padding the shorter ones to the longest buffer's
 *  length — stems can differ slightly in length after separation. No per-stem weighting:
 *  chromaFromAudio() normalizes its output regardless of input loudness. `sampleRate` is
 *  read off the first buffer — every loaded stem shares this app's fixed 44100 Hz
 *  AudioContext rate (see CLAUDE.md), so there is nothing to resample or reconcile. */
function mixDown(buffers) {
  const monos = buffers.map((buffer) => {
    const mono = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) mono[i] += data[i];
    }
    const gain = 1 / buffer.numberOfChannels;
    for (let i = 0; i < mono.length; i++) mono[i] *= gain;
    return mono;
  });
  const length = Math.max(...monos.map((m) => m.length));
  const samples = new Float32Array(length);
  for (const mono of monos) for (let i = 0; i < mono.length; i++) samples[i] += mono[i];
  return { samples, sampleRate: buffers[0].sampleRate };
}
```

- [ ] **Step 2: Narrow `chordSource()` to `{ notes }`**

Find (inside `createNotesChannel`):

```js
  /** This channel's notes and key, for another channel's export to derive chord labels
   *  from — `null` when this channel has nothing analysed yet. Populated automatically once
   *  the channel has notes (jianpu.tonic/mode are always kept current, whether or not this
   *  channel's own 簡譜 checkbox is on) — see lib/chords.js's detectChords(). */
  function chordSource() {
    return hasFrames() && notes.length ? { notes, tonicPc: jianpu.tonic, mode: jianpu.mode } : null;
  }
```

Replace with:

```js
  /** This channel's notes, for slash-chord fusion in another export's chord row — `null`
   *  when this channel has nothing analysed yet. Only the bass channel's chordSource() is
   *  ever read (see the listExport handler below); tonicPc/mode are dropped from this
   *  return value since chroma-based chord detection no longer depends on the song's
   *  detected key at all — see lib/chords.js's detectChords(). */
  function chordSource() {
    return hasFrames() && notes.length ? { notes } : null;
  }
```

- [ ] **Step 3: Rewire the `listExport` handler's chord assembly**

Find (inside the `els.listExport.addEventListener('click', ...)` handler):

```js
    // Chord labels always come from the BASS channel's own notes/key, regardless of which
    // channel is being exported — see lib/chords.js's detectChords() and the design spec.
    // `undefined` (no bass stem loaded, or it was never analysed) means this export carries
    // no chord data at all, and jianpuHtml renders exactly as it did before this feature.
    const bassChannel = channels.find((c) => c.stem === 'bass');
    const chordSrc = bassChannel ? bassChannel.chordSource() : null;
    const chords = chordSrc
      ? detectChords(chordSrc.notes, barStarts, chordSrc.tonicPc, chordSrc.mode)
      : undefined;
```

Replace with:

```js
    // Chord labels come from a chromagram over whichever of guitar/piano/bass are loaded
    // (mixed together), independent of which channel is being exported — see
    // lib/chroma.js/lib/chords.js's detectChords() and the design spec. `undefined` (none of
    // the three loaded) means this export carries no chord data at all, and jianpuHtml
    // renders exactly as it did before this feature.
    const loadedHarmonic = HARMONIC_STEMS
      .map((stemId) => window.sansBass.stemBuffer(stemId))
      .filter(Boolean);
    const harmonicSamples = loadedHarmonic.length ? mixDown(loadedHarmonic.map((s) => s.buffer)) : null;

    const bassChannel = channels.find((c) => c.stem === 'bass');
    const bassNotes = bassChannel && bassChannel.chordSource() ? bassChannel.chordSource().notes : null;

    const chords = harmonicSamples
      ? detectChords(harmonicSamples.samples, harmonicSamples.sampleRate, barStarts, bassNotes)
      : undefined;
```

- [ ] **Step 4: Update `jianpuHtml`'s doc comment**

Find:

```js
 *  `chords` (optional, same length as `bars`) is lib/chords.js's detectChords() output for
 *  the BASS channel — passed regardless of which channel this export is actually for. When
 *  present, every bar gets a `.chords` row (see chordsHtml above); when omitted entirely
 *  (no bass stem loaded, or it was never analysed), no `.chords` element is rendered on any
 *  bar and `.bar`'s visual height/appearance match what they were before this feature. */
```

Replace with:

```js
 *  `chords` (optional, same length as `bars`) is lib/chords.js's detectChords() output —
 *  computed from a chromagram over whichever of the guitar/piano/bass stems are loaded
 *  (mixed together), passed regardless of which channel this export is actually for. When
 *  present, every bar gets a `.chords` row (see chordsHtml above); when omitted entirely
 *  (none of guitar/piano/bass loaded), no `.chords` element is rendered on any bar and
 *  `.bar`'s visual height/appearance match what they were before this feature. */
```

- [ ] **Step 5: Verify the app still builds and the automated suite still passes**

Run: `npm test`
Expected: PASS (no unit test exercises `notes.js`'s `listExport` handler directly — this is
a wiring change verified by the build and, at the end of this plan, by hand).

Run: `npm run build`
Expected: exits 0, no bundling/import errors — confirms `notes.js` still resolves its new
`HARMONIC_STEMS`/`mixDown` references and the `detectChords()` call site's new argument
shapes with no syntax errors.

- [ ] **Step 6: Commit**

```bash
git add notes.js
git commit -m "$(cat <<'EOF'
feat: wire chroma-based chord detection into the 簡譜 export

listExport now assembles a mono mix of whichever of guitar/piano/bass are loaded (mixDown())
and passes it to the rewritten detectChords(), with the bass channel's own notes supplied
separately for slash-chord fusion. chordSource() narrows to { notes } — tonic/mode are no
longer needed anywhere in chord detection.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PN6gyeK5cRavgTM42Juqbk
EOF
)"
```

---

### Task 4: Update `docs/behaviour.md`'s E44 row for the chroma-based redesign

**Files:**
- Modify: `docs/behaviour.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing.

- [ ] **Step 1: Replace the E44 row**

Find the E44 table row (search for `| E44 |`) and replace its entire contents with:

```
| E44 | **Export list** prints a chord guess above each bar, from a chromagram over whichever of the guitar/piano/bass stems are loaded for the current song (mixed together via `notes.js`'s `mixDown`), independent of which channel is being exported (`lib/chroma.js`'s `chromaFromAudio`/`matchChordTemplate`, driven per half-bar by `lib/chords.js`'s `detectChords()`). Each bar is split at its time MIDPOINT into two halves; each half's chroma is matched against a template dictionary covering `{maj, min, 7, min7, sus2, sus4}` via Pearson correlation (the same helper `detectKey()` uses), independent of the song's detected key — a wrong key estimate can no longer produce a wrong chord guess. When the bass channel has analysed notes, a half whose actual bass note's pitch class differs from the chroma-matched root is labelled `Root/BassNote` (e.g. `E/G#`); with no analysed bass channel, or no bass note overlapping the half, the bare `Root` label renders instead. The bar's `.chords` row shows the first half's label top-left and the second half's label (only when it differs from the first) centered above the bar — `second` comes back `null` from `detectChords()` whenever that half is silent or matches the first half, same rendering contract as before this redesign. With none of guitar/piano/bass loaded, no `.chords` element is rendered on any bar and the bar renders identically (visually) to before this feature (`chords` is `undefined`, not an array of nulls). | Detect notes on the bass channel of a song with a clear chord progression that also has guitar and/or piano stems loaded, export any channel's list: each bar shows a chord label top-left, with a slash notation wherever the bass plays something other than the chord root (e.g. an inversion). Export with only bass loaded (no guitar/piano): chords still render, from bass's own chroma alone. Load a song with none of guitar/piano/bass loaded, export: no chord row appears above any bar. Load guitar/piano but never run **Find notes** on bass: chords still render (from the guitar/piano chroma), just without slash notation. |
```

- [ ] **Step 2: Commit**

```bash
git add docs/behaviour.md
git commit -m "$(cat <<'EOF'
docs: update E44 for chroma-based chord detection

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PN6gyeK5cRavgTM42Juqbk
EOF
)"
```

---

### Task 5: Manual verification against the real reference chart (final task)

**Files:** none (verification only, per this project's convention of consolidating browser
verification into one final task rather than repeating it per task — see CLAUDE.md).

**Interfaces:** none.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Load the reference song and run separation/detection**

In the browser, load `examples/nov_you.zip`. Run **Find notes** (Detect) on the guitar,
piano, and bass channels (whichever the zip provides — bass at minimum, for slash-chord
fusion). Open the notes panel for any channel, tick 簡譜, and click **Export list**.

- [ ] **Step 3: Compare the exported chord row against the reference chart**

Open the downloaded HTML export and read the chord row above each bar. Compare against the
reference chart transcribed by ear in the design spec's Motivation section:

```
A, E/G#, F#m, E, D, Dm7, A, F#m, Bm7, E...
```

in A major. This is the actual acceptance check for whether the redesign fixes the real
problem the superseded bass-note-as-root approach had — not a per-task substitute for it. If
the labels diverge meaningfully from the reference chart in a way that points at a bug (not
just an inherent naive-chroma limitation the design spec already anticipated — see its
Non-goals on overtone correction), stop and diagnose before considering this plan complete.

- [ ] **Step 4: Report the result**

No commit for this task — it is a verification gate. If the export matches the reference
chart (allowing for the known, deliberately-deferred naive-chroma limitations noted in the
design spec's Non-goals), the plan is complete.
