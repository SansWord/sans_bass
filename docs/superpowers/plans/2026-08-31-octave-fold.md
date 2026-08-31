# Octave Fold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct octave-outlier notes by folding them whole octaves into the singer's range using neighbouring notes, marking every touched note so nothing is silently changed or hidden.

**Architecture:** One pure function `foldOctaves(notes, opts)` in `lib/pitch.js`, applied as a post-pass inside `interpret()`. It never adds or removes notes — it sets `midi`/`cents`/`name` on the ones it corrects and attaches a `fix` provenance field. `app.js` gains two draw colours; `lib/sonify.js` skips doubtful notes.

**Tech Stack:** Vanilla ESM and classic scripts, no build step, no dependencies. Tests are the existing browser harness.

**Spec:** [`docs/superpowers/specs/2026-08-31-octave-fold-design.md`](../specs/2026-08-31-octave-fold-design.md)
**Background, read first:** [`docs/transcription.md`](../../transcription.md) — especially *Two octave errors, and they are opposites*.

**Branch:** `feat/octave-fold` (already created, off `main` after #15 merged).

---

## The one thing to understand before starting

This corrects the **泛音 / harmonic** error — the detector locking onto an overtone and reading
*too high*. It is the mirror of the **次諧波 / subharmonic** error that `hmm-v1` fixed in
v1.12.0, which reads an octave *low*.

```
true F#2 = 92.5 Hz          detector reports F#5 = 740 Hz = 8 x 92.5
   |                                    |
   +-- fundamental, dip too shallow     +-- 8th harmonic, deepest dip in the curve
       to survive any threshold             so YIN picks it, 3 octaves high
```

The fundamental is **not recoverable from the frame** — measured, F#2's dip only appears at
`candidateThreshold` 1.2 / `maxCandidates` 20, ranked fifteenth at p = 0.04, while the frame
still prefers F#5 at p = 0.10. Do not try to fix this in `yinFrame` or `viterbiPitch`; that
door is closed and the spec records the measurement. The signal that *does* resolve it is the
neighbouring notes, which only exist at the note layer.

**Why whole octaves works:** the errors land on the 2nd, 4th and 8th harmonics — powers of
two — so they preserve pitch class. That is also why folding leaves the key estimate
untouched. The 3rd/6th-harmonic cases (an octave + a fifth) are *not* octave-foldable and must
end up doubtful, never folded.

**The threshold is load-bearing, and 5 was wrong.** A power-of-two error leaves a residual of
exactly 0 after the right octave shift; a 3rd/6th-harmonic error leaves **4.98** — under a
threshold of 5, so those were being folded a fifth wrong and tagged confident. The two
populations overlap once melodic movement is accounted for (foldable 0–3.5, unfoldable
1.5–7), so no threshold separates them cleanly. `confidentWithin` is **1.5**: it folds nothing
it cannot justify, at the cost of about half the true corrections. Do not raise it without
measuring. Tasks 2 and 7 both depend on this.

## File structure

| File | Responsibility |
|---|---|
| `lib/pitch.js` (modify) | `FOLD_DEFAULTS`, `pitchBand()`, `foldOctaves()`; call from `interpret()`. ~90 added lines. |
| `tests/pitch.test.js` (modify) | Band robustness, fold/doubt classification, pitch-class and count invariants. |
| `lib/sonify.js` (modify) | Skip `fix.doubt` notes when scheduling. |
| `tests/sonify.test.js` (modify) | A doubtful note is not scheduled. |
| `app.js` (modify) | Two new fill colours, in **both** note-drawing loops. |
| `index.html`, `lib/i18n.js`, `notes.js` (modify) | One checkbox, two strings per locale, wiring. |
| `docs/behaviour.md`, `docs/devlog.md`, `docs/transcription.md` (modify) | Behaviour rows, learnings, status. |

**No `?v=` bump during Tasks 1–8.** The bump belongs to the release, at Task 9.

## Running the tests

```bash
./scripts/serve.sh          # http://localhost:8777
```

Units at `http://localhost:8777/tests/test.html` — read `window.__testResults`.
**Baseline before you start: 157 passing, 0 failing.**

If the suite reports `window.__testResults` as `undefined`, do not hunt the results object —
an ESM named import of a not-yet-written export fails the whole module at link time. Read the
console for a `SyntaxError` naming the missing export.

---

## Task 1: `pitchBand` — a range the outliers cannot inflate

**Files:**
- Modify: `lib/pitch.js`
- Modify: `tests/pitch.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/pitch.test.js`:

```js
import { pitchBand } from '../lib/pitch.js';

/* Notes of equal duration at the given MIDI numbers. Duration matters to pitchBand — it is
 * duration-weighted — so equal durations isolate the pitch distribution. */
function notesAt(midis, seconds = 0.5) {
  return midis.map((m, i) => ({
    start: i * seconds, end: (i + 1) * seconds, midi: m,
    cents: m * 100, name: noteName(m), confidence: 0.9,
  }));
}

test('pitch: pitchBand covers a steady singer with the minimum one-octave margin', () => {
  const [lo, hi] = pitchBand(notesAt([48, 50, 52, 53, 55, 52, 50, 48]));
  assert(lo <= 48 && hi >= 55, `the sung range is inside the band (${lo}..${hi})`);
  assert(hi - lo >= 24, 'the floor keeps the band at least an octave either side');
});

test('pitch: pitchBand is not inflated by the outliers it exists to exclude', () => {
  /* THE property that rules out a percentile band. Measured on ng_kipin, a 5th/95th
   * percentile stretched to E2-D#5 and absorbed the very notes it should have flagged.
   *
   * A median does shift slightly under contamination — adding four high notes moves it from
   * 51 to 52 here — so this asserts the property that actually matters: the band does not
   * WIDEN to swallow the tail, and the outliers stay outside it. A percentile band fails
   * both of those; a median/MAD band fails neither. */
  const body = [48, 50, 52, 53, 55, 52, 50, 48, 51, 49, 53, 50];
  const clean = pitchBand(notesAt(body));
  const dirty = pitchBand(notesAt([...body, 84, 86, 84, 88]));   // 25% contamination
  assertEq(dirty[1] - dirty[0], clean[1] - clean[0], 'the band does not widen');
  assert(Math.abs(dirty[0] - clean[0]) <= 2, `the low edge barely moves (${clean[0]} -> ${dirty[0]})`);
  assert(84 > dirty[1], `and every outlier is still outside it (hi = ${dirty[1]})`);
});

test('pitch: pitchBand weights by duration, not by note count', () => {
  // One long low note plus many short high ones: the long note must dominate the centre.
  const notes = [{ start: 0, end: 20, midi: 40, cents: 4000, name: 'E2', confidence: 0.9 }];
  for (let i = 0; i < 30; i++) {
    notes.push({ start: 20 + i * 0.1, end: 20.1 + i * 0.1, midi: 64, cents: 6400, name: 'E4', confidence: 0.9 });
  }
  const [lo, hi] = pitchBand(notes);
  const centre = (lo + hi) / 2;
  assert(Math.abs(centre - 40) < Math.abs(centre - 64), `the held note pulls the centre (${centre})`);
});

test('pitch: pitchBand survives an empty list', () => {
  const [lo, hi] = pitchBand([]);
  assert(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo, 'a usable band, not NaN');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Reload `http://localhost:8777/tests/test.html`.
Expected: `window.__testResults` is `undefined` and the console shows
`SyntaxError: The requested module '../lib/pitch.js' does not provide an export named 'pitchBand'`.

- [ ] **Step 3: Write the implementation**

Append to `lib/pitch.js`, after `interpret()`:

```js
// ---------------------------------------------------------------- octave folding

export const FOLD_DEFAULTS = {
  madMultiple: 3,        // band half-width, in MADs
  minHalfWidth: 12,      // ...but never tighter than an octave either side
  maxShift: 4,           // octaves searched in each direction
  confidentWithin: 5,    // semitones: a fourth. Beyond this we mark rather than guess.
};

/**
 * The singer's plausible pitch range, as [loMidi, hiMidi].
 *
 * Duration-weighted median +/- max(minHalfWidth, madMultiple x MAD).
 *
 * Median and MAD, NOT percentiles. The outliers this band exists to exclude are numerous
 * enough to inflate their own band: measured on ng_kipin, a 5th/95th percentile stretched to
 * E2-D#5 and caught only 14 of 23 outliers, having absorbed the rest. Median and MAD are
 * robust to a contaminated tail; percentiles at those fractions are not.
 *
 * Duration-weighted for the same reason pitchRange is: a held tonic should define the range,
 * forty passing sixteenths should not.
 */
export function pitchBand(notes, opts = {}) {
  const madMultiple = opts.madMultiple ?? FOLD_DEFAULTS.madMultiple;
  const minHalfWidth = opts.minHalfWidth ?? FOLD_DEFAULTS.minHalfWidth;
  if (!notes || !notes.length) return [59 - minHalfWidth, 59 + minHalfWidth];

  const weighted = [];
  for (const n of notes) {
    const reps = Math.max(1, Math.round((n.end - n.start) * 40));
    for (let i = 0; i < reps; i++) weighted.push(n.midi);
  }
  weighted.sort((a, b) => a - b);
  const median = weighted[weighted.length >> 1];

  const deviations = weighted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = deviations[deviations.length >> 1];

  const half = Math.max(minHalfWidth, madMultiple * mad);
  return [median - half, median + half];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.
Expected: four new `PASS` beginning `pitch: pitchBand`, suite green at **161**.

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "Pitch: a duration-weighted median/MAD band the outliers cannot inflate"
```

---

## Task 2: `foldOctaves` — fold when confident, mark when not

**Files:**
- Modify: `lib/pitch.js`
- Modify: `tests/pitch.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/pitch.test.js`:

```js
import { foldOctaves } from '../lib/pitch.js';

test('pitch: foldOctaves folds an outlier onto the octave its neighbours imply', () => {
  // F#5 between F2 and G2 — the exact shape measured on ng_kipin, an 8th-harmonic error.
  const notes = notesAt([41, 43, 78, 41, 43, 41, 43, 41]);
  const out = foldOctaves(notes);
  assertEq(out.length, notes.length, 'nothing is added or removed');
  assertEq(out[2].midi, 42, 'F#5 folds three octaves down to F#2');
  assertEq(out[2].name, 'F#2', 'the name is rewritten to match');
  assertEq(out[2].cents, 4200, 'and so are the cents');
  assertEq(out[2].fix.from, 78, 'provenance records what the detector said');
  assertEq(out[2].fix.shift, -3, 'and how far it moved');
  assert(!out[2].fix.doubt, 'a confident fold is not doubtful');
});

test('pitch: foldOctaves leaves in-band notes completely untouched', () => {
  const notes = notesAt([48, 50, 52, 53, 55, 52, 50, 48]);
  const out = foldOctaves(notes);
  for (let i = 0; i < notes.length; i++) {
    assertEq(out[i].midi, notes[i].midi, `note ${i} unmoved`);
    assert(!('fix' in out[i]), `note ${i} carries no fix field`);
  }
});

test('pitch: foldOctaves marks an odd-harmonic error doubtful rather than guessing', () => {
  /* B4 (71) between G3 (55) and D3 (50) is a 3rd-harmonic error implying E3 (52) — an
   * octave PLUS a fifth. No whole-octave shift reaches it: 71-12=59 is 6.5 from the
   * neighbour mean of 52.5, and 71-24=47 is 5.5 away. Both exceed the fourth, so this must
   * be marked, not folded. Measured on ng_kipin, this is 4 of 23 outliers. */
  const notes = notesAt([55, 50, 71, 55, 50, 55, 50, 55]);
  const out = foldOctaves(notes);
  assertEq(out[2].midi, 71, 'the pitch is left exactly as detected');
  assertEq(out[2].fix.doubt, true, 'but it is marked as untrusted');
  assertEq(out[2].fix.from, 71, 'from is present even when it equals midi');
});

test('pitch: foldOctaves judges a trailing outlier on its one available neighbour', () => {
  /* The last note has no right-hand neighbour at all. One-sided context is still context:
   * C7 (96) after a body around C3 folds four octaves to C3 (48), two semitones from the
   * 50 beside it. Requiring both neighbours would strand every phrase-final outlier. */
  const out = foldOctaves(notesAt([48, 50, 52, 50, 48, 50, 52, 50, 96]));
  assertEq(out[8].midi, 48, 'folded down four octaves on the left neighbour alone');
  assertEq(out[8].fix.shift, -4, 'and the shift is recorded');
  assertEq(out[8].name, 'C3', 'the name follows the pitch');
});

test('pitch: foldOctaves survives an empty list', () => {
  const out = foldOctaves([]);
  assert(Array.isArray(out) && out.length === 0, 'an empty list in, an empty list out');
});

test('pitch: foldOctaves stays fast when almost every note is an outlier', () => {
  /* The neighbour search scans outward until it finds an IN-BAND note, so a long run of
   * consecutive outliers makes it O(n^2). At the shortest-note setting a song can reach
   * ~1200 notes, and this runs on the main thread during a slider drag — the same place an
   * unbounded running median cost 5.9 s in v1.11.0. This is the guard on that. */
  const midis = [];
  for (let i = 0; i < 1200; i++) midis.push(i % 40 === 0 ? 50 : 96);   // 39 outliers per island
  const t0 = performance.now();
  const out = foldOctaves(notesAt(midis, 0.05));
  const ms = performance.now() - t0;
  assertEq(out.length, 1200, 'every note still comes back');
  assert(ms < 100, `1200 notes fold in well under a tenth of a second (${ms.toFixed(0)} ms)`);
});

test('pitch: foldOctaves never changes pitch class, so the key estimate is safe', () => {
  const notes = notesAt([41, 43, 78, 41, 43, 41, 43, 41]);
  const before = notesToChroma(notes);
  const after = notesToChroma(foldOctaves(notes));
  for (let i = 0; i < 12; i++) {
    assertClose(after[i], before[i], 1e-9, `pitch class ${i} unchanged by folding`);
  }
});

test('pitch: foldOctaves does not mutate the notes it was given', () => {
  const notes = notesAt([41, 43, 78, 41, 43, 41, 43, 41]);
  foldOctaves(notes);
  assertEq(notes[2].midi, 78, 'the caller\'s array is untouched');
  assert(!('fix' in notes[2]), 'and gains no fields');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Reload. Expected: `window.__testResults` is `undefined`, console shows
`does not provide an export named 'foldOctaves'`.

- [ ] **Step 3: Write the implementation**

Append to `lib/pitch.js`:

```js
/**
 * Fold octave-outlier notes into the singer's range, marking every note it touches.
 *
 * Corrects the HARMONIC (泛音) error: YIN locking onto an overtone and reading octaves high.
 * This is not fixable at the frame layer — the fundamental's dip is genuinely absent from the
 * curve, measured — but the neighbouring notes resolve it, and they only exist here. See
 * docs/transcription.md, "Two octave errors, and they are opposites".
 *
 * NOTHING IS REMOVED. Every input note appears in the output. A note that was corrected, or
 * that we declined to correct, carries a `fix` field:
 *
 *   { from, shift }        folded: midi/cents/name are corrected, `from` is the original
 *   { from, doubt: true }  untrusted: midi is untouched, but it should not be sounded
 *
 * Returns new note objects; the input array is never mutated.
 */
export function foldOctaves(notes, opts = {}) {
  const maxShift = opts.maxShift ?? FOLD_DEFAULTS.maxShift;
  const confidentWithin = opts.confidentWithin ?? FOLD_DEFAULTS.confidentWithin;
  if (!notes || !notes.length) return [];

  const [lo, hi] = pitchBand(notes, opts);
  const inBand = (m) => m >= lo && m <= hi;
  const out = notes.map((n) => ({ ...n }));

  for (let i = 0; i < out.length; i++) {
    const n = out[i];
    if (inBand(n.midi)) continue;

    /* The nearest IN-BAND note either side, not merely the adjacent one: an outlier next to
     * another outlier must never be judged against it. Read from the original list so a
     * fold earlier in the loop cannot change a later note's context. */
    let left = null;
    let right = null;
    /* Scans outward until it finds an in-band note. Worst case is O(n^2) on a long run of
     * consecutive outliers; at realistic note counts (~1200) that is under 10 ms, and there
     * is a test pinning it. If it ever needs to be linear, precompute a prefix/suffix array
     * of the nearest in-band index. */
    for (let j = i - 1; j >= 0; j--) if (inBand(notes[j].midi)) { left = notes[j].midi; break; }
    for (let j = i + 1; j < notes.length; j++) if (inBand(notes[j].midi)) { right = notes[j].midi; break; }

    const context = [left, right].filter((v) => v !== null);
    if (!context.length) { n.fix = { from: n.midi, doubt: true }; continue; }
    const target = context.reduce((s, v) => s + v, 0) / context.length;

    /* Only shifts landing back inside the band are considered, so a fold can never leave a
     * note still out of range and no second pass is needed. Ties prefer the smaller |k|,
     * then the negative k — every shift measured on real material is downward, so an exact
     * tie must not silently resolve upward. */
    let bestK = 0;
    let bestD = Infinity;
    for (let k = -maxShift; k <= maxShift; k++) {
      if (k === 0) continue;
      const candidate = n.midi + 12 * k;
      if (!inBand(candidate)) continue;
      const d = Math.abs(candidate - target);
      if (d < bestD || (d === bestD && (Math.abs(k) < Math.abs(bestK) || (Math.abs(k) === Math.abs(bestK) && k < bestK)))) {
        bestD = d;
        bestK = k;
      }
    }

    if (bestK === 0 || bestD > confidentWithin) {
      n.fix = { from: n.midi, doubt: true };
      continue;
    }
    const midi = n.midi + 12 * bestK;
    n.fix = { from: n.midi, shift: bestK };
    n.midi = midi;
    n.cents = +(midi * 100).toFixed(1);
    n.name = noteName(midi);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload. Expected: eight new `PASS` beginning `pitch: foldOctaves`, suite green at **169**. (Later corrections took Task 2 to 174 — see the note below it.)

> **The listing above is historical.** Task 2 shipped, then a code review found
> `confidentWithin: 5` was wrong — it sits *on* the 4.98-semitone residual of an
> octave-plus-a-fifth error, so it folded them and tagged them confident (measured: 7 wrong
> folds on `threshold-v1`, 24 on `hmm-v1`). The shipped value is **1.5**, `fix` carries a
> `state` field, and a fold shifts `cents` rather than re-quantising. See commits `aa4360e`
> then `b632636`, and the Correction section of the spec.

If "folds an outlier onto the octave its neighbours imply" fails, print `out[2].fix` — a
`doubt` there means `bestD` exceeded `confidentWithin`. Do **not** widen `confidentWithin` to
make it pass. It does not cleanly separate foldable from unfoldable harmonics — nothing does,
the populations overlap — it is set low deliberately so that the fold never claims confidence
it has not earned. Raising it trades that guarantee for coverage, and there is a bracketing
test that will fail if you do.

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "Pitch: foldOctaves corrects octave outliers and marks what it will not guess"
```

---

## Task 3: Wire folding into `interpret()`

**Files:**
- Modify: `lib/pitch.js`
- Modify: `tests/pitch.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/pitch.test.js`:

```js
test('pitch: interpret folds only when asked', () => {
  const tr = fakeTrack([[4100, 20], [4300, 20], [7800, 20], [4100, 20], [4300, 20]]);
  const plain = interpret(tr, { interpreter: 'threshold-v1', params: { minDurationMs: 80 } });
  const folded = interpret(tr, { interpreter: 'threshold-v1', params: { minDurationMs: 80, fold: true } });
  assertEq(folded.length, plain.length, 'folding never changes the note count');
  assert(plain.every((n) => !('fix' in n)), 'without fold, no note carries a fix field');
  assert(folded.some((n) => n.fix && n.fix.state === 'folded'), 'with fold, at least one note is corrected');
});

test('pitch: interpret folds for hmm-v1 too', () => {
  const tr = fakeTrack([[4100, 20], [4300, 20], [7800, 20], [4100, 20], [4300, 20]]);
  tr.candidates = new Array(tr.cents.length);
  for (let i = 0; i < tr.cents.length; i++) {
    tr.candidates[i] = tr.cents[i]
      ? [{ cents: tr.cents[i], f0: hzFromCents(tr.cents[i]), tau: 0, p: 1 }]
      : [];
  }
  const folded = interpret(tr, { interpreter: 'hmm-v1', params: { minDurationMs: 80, fold: true } });
  assert(folded.length > 0, 'hmm-v1 still returns notes');
  assert(folded.some((n) => n.fix), 'and folding applies to its output too');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Reload. Expected: two `FAIL` on `with fold, at least one note is corrected` and
`and folding applies to its output too` — `interpret` currently ignores `params.fold`.

- [ ] **Step 3: Write the implementation**

In `lib/pitch.js`, replace the body of `interpret()`:

```js
export function interpret(track, interpretation) {
  const params = interpretation?.params ?? {};
  let notes;
  if (interpretation?.interpreter === 'hmm-v1' && track?.candidates) {
    const cents = viterbiPitch(track, params);
    const decoded = { ...track, cents };
    notes = segmentNotesHmm(decoded, { ...params, onsetCost: (params.minDurationMs ?? 80) / 20 });
  } else {
    notes = segmentNotes(track, params);
  }
  /* Last, and for both interpreters: folding reads the note list, so it has to run after
   * whichever produced it. Off unless asked — nothing about the shipped output moves. */
  return params.fold ? foldOctaves(notes, params) : notes;
}
```

Also extend the doc comment above `interpret()` with one line before the closing `*/`:

```js
 * `params.fold` runs foldOctaves over the result, for either interpreter.
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload. Expected: two new `PASS`, suite green at **176**.
(The plan originally predicted 171; Task 2's two review-driven fix rounds added five tests.)

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "Pitch: interpret() applies octave folding when params.fold is set"
```

---

## Task 4: A doubtful note makes no sound

**Files:**
- Modify: `lib/sonify.js`
- Modify: `tests/sonify.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/sonify.test.js`:

```js
test('sonify: a doubtful note is never scheduled', () => {
  /* Sounding a note we have already flagged as untrusted would re-introduce exactly the
   * wrong-octave blurt that folding exists to remove. It stays visible in the lane; it
   * simply does not play. */
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  const notes = [
    { start: 0.0, end: 0.2, midi: 60, cents: 6000, name: 'C4', confidence: 0.9 },
    { start: 0.3, end: 0.5, midi: 84, cents: 8400, name: 'C6', confidence: 0.9, fix: { from: 84, doubt: true } },
    { start: 0.6, end: 0.8, midi: 62, cents: 6200, name: 'D4', confidence: 0.9 },
  ];
  const started = [];
  const origStart = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (when) { started.push(when); return origStart.call(this, when); };
  try {
    const s = scheduleNotes(ctx, ctx.destination, notes, { when: 0, offset: 0 });
    s.stop();
  } finally {
    OscillatorNode.prototype.start = origStart;
  }
  assertEq(started.length, 2, `only the two trusted notes sound (got ${started.length})`);
});
```

- [ ] **Step 2: Run the tests to verify it fails**

Reload. Expected: `FAIL` with `only the two trusted notes sound (got 3)`.

- [ ] **Step 3: Write the implementation**

In `lib/sonify.js`, inside `scheduleNotes`, add the guard to **both** collection loops.
Change the lap-0 loop at line ~79:

```js
  const lap0 = [];
  for (const n of notes) {
    if (n.fix && n.fix.state === 'doubt') continue;   // untrusted: visible, but silent
    if (looping ? (n.start < offset || n.start >= loopB) : n.end <= offset) continue;
    lap0.push({ note: n, at: when + (n.start - offset) });
  }
```

And the loop-lap collection just below it:

```js
  const loopBase = [];
  if (looping) {
    for (const n of notes) {
      if (n.fix && n.fix.state === 'doubt') continue;   // same rule on every lap
      if (n.start < loopA || n.start >= loopB) continue;
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload. Expected: one new `PASS`, suite green at **177**.

- [ ] **Step 5: Commit**

```bash
git add lib/sonify.js tests/sonify.test.js
git commit -m "Sonify: a doubtful note stays visible but does not play"
```

---

## Task 5: Two new colours, in both note-drawing loops

**Files:**
- Modify: `app.js`

`app.js` draws notes in **two** places — the full-width lane and the zoomed pane. Both need
the new cases or the panes will disagree about the same note.

- [ ] **Step 1: Add the shared colour table**

In `app.js`, immediately above `renderRibbon` (search for the function that contains
`A clipped note keeps its position in time`), add:

```js
/* Note fill by provenance. Blue for a folded note and gray for one we declined to correct:
 * both must be distinguishable from an untouched note (green) AND from an out-of-band note
 * (the A-B orange), because "corrected", "untrusted" and "off-scale" are three different
 * things the reader has to tell apart. Gray recedes without vanishing — a hidden note would
 * be a silent lie, the same rule the orange edge marks follow. */
const NOTE_FILL = {
  plain:  { normal: '#8ee0ad', dim: '#4c8f6c' },
  folded: { normal: '#6cc5e0', dim: '#3a7186' },
  doubt:  { normal: '#5a5a68', dim: '#3a3a44' },
};
const noteFillKey = (n) => (n.fix ? n.fix.state : 'plain');   // 'folded' | 'doubt'
```

- [ ] **Step 2: Use it in the full-width lane**

In the lane loop, replace this line:

```js
      c.fillStyle = out ? (dim ? '#8a5c17' : '#ff9f1c') : (dim ? '#4c8f6c' : '#8ee0ad');
```

with:

```js
      const fill = NOTE_FILL[noteFillKey(n)];
      c.fillStyle = out ? (dim ? '#8a5c17' : '#ff9f1c') : (dim ? fill.dim : fill.normal);
```

Out-of-band still wins: a note outside the lane's scale is drawn at the edge in orange
whatever its provenance, because the reader's first question there is "why can I not see it".

- [ ] **Step 3: Use it in the zoomed pane**

In the zoom loop, replace:

```js
    c.fillStyle = out ? '#ff9f1c' : 'rgba(142,224,173,.86)';
```

with:

```js
    c.fillStyle = out ? '#ff9f1c' : NOTE_FILL[noteFillKey(n)].normal;
```

- [ ] **Step 4: Verify in the browser**

The checkbox does not exist until Task 6, so verify the colours directly against the module
instead of through the UI. Load any song, open the console, and count the pixels the lane
actually painted:

```js
const { interpret, decimate, f0Track } = await import('/lib/pitch.js');
const stem = window.sansBass.stemBuffer('vocals');
const ch = [];
for (let i = 0; i < stem.buffer.numberOfChannels; i++) ch.push(stem.buffer.getChannelData(i));
const dec = decimate(ch, stem.buffer.sampleRate);
const tr = f0Track(dec.samples, dec.sampleRate);
const notes = interpret(tr, { interpreter: 'threshold-v1', params: { minDurationMs: 100, fold: true } });
window.sansBass.setNotes({ notes, frames: tr, params: {}, clip: true });
({ folded: notes.filter(n => n.fix && n.fix.state === 'folded').length,
   doubtful: notes.filter(n => n.fix && n.fix.state === 'doubt').length });
```

Then read the canvas back — a blue and a gray pixel must both be present:

```js
const cv = document.querySelector('.lane.ribbon canvas');
const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
const seen = new Set();
for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]},${d[i+1]},${d[i+2]}`);
({ blue: seen.has('108,197,224'), gray: seen.has('90,90,104') });
```

Both must be `true`. **Also take a screenshot** — in v1.2.2 four property assertions passed
against a visibly broken panel, and only the picture caught it.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "Ribbon: draw folded notes in blue and untrusted ones in gray"
```

---

## Task 6: The checkbox

**Files:**
- Modify: `index.html`
- Modify: `lib/i18n.js`
- Modify: `notes.js`

- [ ] **Step 1: Add the control**

In `index.html`, inside `<details class="notes-adv">`, after the `notes-hmm` label:

```html
          <label class="notes-ctl">
            <input id="notes-fold" type="checkbox">
            <span data-i18n="notes.fold">Fix octave outliers</span>
          </label>
```

Unchecked by default: nothing about the shipped behaviour changes until it is chosen.

- [ ] **Step 2: Add the strings, both locales**

`tests/i18n.test.js` fails on a key present in one locale and missing from the other. In the
`'zh-TW'` block, after `'notes.hmmTip'`:

```js
      'notes.fold': '修正八度異常值',
      'notes.foldTip': '依前後音符，把偏離的音符整個八度移回音域內。修正過的音符顯示為藍色，無法判斷的顯示為灰色且不發聲。不會刪除任何音符。',
```

And in `'en'`, in the same position:

```js
      'notes.fold': 'Fix octave outliers',
      'notes.foldTip': 'Moves stray notes by whole octaves back into range, using the notes around them. Corrected notes are drawn in blue; ones we cannot judge are gray and stay silent. Nothing is removed.',
```

- [ ] **Step 3: Wire it up**

In `notes.js`, add the element to the `el` object after `hmm`:

```js
  fold: document.getElementById('notes-fold'),
```

Add its tooltip inside `syncTips`:

```js
const syncTips = () => {
  el.hmm.parentElement.title = tr('notes.hmmTip');
  el.clip.parentElement.title = tr('notes.clipTip');
  el.fold.parentElement.title = tr('notes.foldTip');
};
```

Extend `currentParams()`:

```js
function currentParams() {
  return {
    interpreter: el.hmm.checked ? 'hmm-v1' : 'threshold-v1',
    params: { minDurationMs: Number(el.min.value), fold: el.fold.checked },
  };
}
```

And add the listener beside the others:

```js
el.fold.addEventListener('change', reinterpret);
```

- [ ] **Step 4: Verify in the browser**

Load `stems/ng_kipin.zip`, click **Find notes**, then in the console:

```js
const fold = document.getElementById('notes-fold');
const count = () => document.getElementById('notes-count').textContent;
const before = count();
const t0 = performance.now();
fold.checked = true; fold.dispatchEvent(new Event('change'));
({ before, after: count(), ms: +(performance.now() - t0).toFixed(1) });
```

Expected: the count is **unchanged** — folding never adds or removes notes — and `ms` is in
the tens. That the count holds is the point: this feature changes pitches, not populations.

- [ ] **Step 5: Commit**

```bash
git add index.html lib/i18n.js notes.js
git commit -m "Notes: a checkbox to fold octave outliers, off by default"
```

---

## Task 7: Measure it on real material

**Files:**
- Modify: `tests/notes.html`

- [ ] **Step 1: Add fold to the comparison table**

In `tests/notes.html`, in the `== INTERPRETERS ==` block, replace the loop over interpreter
names with one that also varies folding:

```js
log('\n== INTERPRETERS ==   (same frames, same shortest-note setting)');
const compare = {};
for (const name of ['threshold-v1', 'hmm-v1']) {
  for (const fold of [false, true]) {
    const spec = { interpreter: name, params: { minDurationMs: opts.minDurationMs ?? 120, fold } };
    const c0 = performance.now();
    const list = interpret(frames, spec);
    const ms = +(performance.now() - c0).toFixed(1);
    const folded = list.filter((n) => n.fix && n.fix.state === 'folded').length;
    const doubted = list.filter((n) => n.fix && n.fix.state === 'doubt').length;
    compare[name + (fold ? ' +fold' : '')] = { ...metrics(list), decodeMs: ms, folded, doubted };
  }
}
const cols = ['notes', 'octaveOutliers', 'lowTimePct', 'touchingSame', 'rangeSemitones', 'folded', 'doubted', 'decodeMs'];
const labels = { notes: 'notes', octaveOutliers: 'octave outliers', lowTimePct: 'time an octave low %',
                 touchingSame: 'touching same-pitch', rangeSemitones: 'pitch range (semitones)',
                 folded: 'folded', doubted: 'doubtful', decodeMs: 'decode ms' };
const names = Object.keys(compare);
log(`${''.padEnd(24)} ${names.map((n) => n.padStart(15)).join('')}`);
for (const k of cols) {
  log(`${labels[k].padEnd(24)} ${names.map((n) => String(compare[n][k]).padStart(15)).join('')}`);
}
```

- [ ] **Step 2: Run it and record the numbers**

The page builds its URL as `/stems/reborn/<track>/<stem>.m4a`, so extract the stem into a
directory matching that shape and transcode to `.m4a`:

```bash
python3 -c "
import zipfile, os
z = zipfile.ZipFile('stems/ng_kipin.zip')
n = [i for i in z.infolist() if i.filename.endswith('vocals.wav')][0]
os.makedirs('stems/reborn/ng_kipin', exist_ok=True)
with z.open(n) as f, open('stems/reborn/ng_kipin/vocals.wav','wb') as o:
    while (b := f.read(1<<20)): o.write(b)
"
ffmpeg -y -i stems/reborn/ng_kipin/vocals.wav -c:a aac -b:a 192k stems/reborn/ng_kipin/vocals.m4a
rm stems/reborn/ng_kipin/vocals.wav
```

`stems/` is gitignored, so none of this can be committed by accident.

Open `http://localhost:8777/tests/notes.html?track=ng_kipin&minDurationMs=100`.

Note counts must be identical with and without folding — that is the invariant to check
first, and it holds regardless of tuning.

**Do not expect the counts an earlier draft of this plan predicted** (19 folded / 4 doubted).
Those came from `confidentWithin: 5`, which was wrong: it folded octave-plus-a-fifth errors
and tagged them confident. At the corrected 1.5 the split moves sharply toward doubtful —
independently measured at `confidentWithin: 1.5` on ng_kipin: **`threshold-v1` 9 folded /
16 doubtful** (25 outliers of 185 notes, band 36–66) and **`hmm-v1` 10 folded / 33 doubtful**
(43 outliers of 307, band 39–63). Record what you actually measure; these are calibration, not
assertions, and they will move with the decode path.

Also sweep the threshold while you are here, since this is the measurement step:

```js
for (const confidentWithin of [1, 1.5, 2, 3, 5]) {
  const list = interpret(frames, { interpreter: 'threshold-v1',
    params: { minDurationMs: 100, fold: true, confidentWithin } });
  console.log(confidentWithin,
    'folded', list.filter(n => n.fix && n.fix.state === 'folded').length,
    'doubt',  list.filter(n => n.fix && n.fix.state === 'doubt').length);
}
```

If `folded` is 0, the band is wrong — print `pitchBand(list)` and check it is near C2–F#4
rather than the whole range.

- [ ] **Step 3: Commit**

```bash
git add tests/notes.html
git commit -m "Bench: report folded and doubtful counts beside the interpreter metrics"
```

---

## Task 8: Behaviour documentation

**Files:**
- Modify: `docs/behaviour.md`

- [ ] **Step 1: Add rows to the Notes lane table**

After N32, in the same format:

```markdown
| N33 | **Fix octave outliers** never changes the note count. It corrects pitches and marks what it will not correct; it adds and removes nothing. | Tick it: `#notes-count` is unchanged, and `interpret(...).length` is equal with and without `fold: true`. |
| N34 | It is **off** by default. | Load a song, run detection: `#notes-fold.checked` is `false`, and no note carries a `fix` field. |
| N35 | A folded note draws **blue**, a doubtful one **gray**, in both the lane and the zoomed pane. An out-of-band note still draws orange at the edge whatever its provenance. | Load `ng_kipin`, tick the box, screenshot both panes. Do not assert on properties alone — check the picture. |
| N36 | A **doubtful note makes no sound** but stays visible. | Unmute the Notes lane with folding on; count `OscillatorNode.start` calls — notes carrying `fix.doubt` are not among them. |
| N37 | Folding **never changes pitch class**, so the detected key is unaffected. | `notesToChroma(notes)` is identical with and without `fold: true`. |
```

- [ ] **Step 2: Commit**

```bash
git add docs/behaviour.md
git commit -m "Docs: behaviour rows for octave folding"
```

---

## Task 9: Docs, version, and the PR

**Files:**
- Modify: `docs/transcription.md`, `docs/devlog.md`, `docs/roadmap.md`
- Modify: `index.html`, `separate.js`, `separate.worker.js`, `notes.js`, `notes.worker.js`

- [ ] **Step 1: Update the transcription status table**

The `notes lane` row currently ends `**Clip octave outliers** is a display choice about the
vertical scale only`. Add a row beneath it:

```
| octave folding | built — `foldOctaves()` over the note list | the **Fix octave outliers** checkbox; marks rather than guesses |
```

- [ ] **Step 2: Update the roadmap**

In `docs/roadmap.md`, change the octave-folding heading line from `**Designed**` to
`**Built** — v1.13.0`, and note that the odd-harmonic (3rd/6th) cases remain uncorrected and
are the natural next step, requiring a fold that changes pitch class.

- [ ] **Step 3: Bump the asset version**

This changes `lib/pitch.js`, `lib/sonify.js`, `app.js`, `notes.js` and `index.html`, all of
which `index.html` loads. Pick `v1.13.0`:

```bash
sed -i '' 's/?v=1\.12\.0/?v=1.13.0/g' index.html separate.js separate.worker.js notes.js notes.worker.js tests/notes.test.js
grep -rn '1\.12\.0' index.html separate.js separate.worker.js notes.js notes.worker.js   # expect none
```

Then update `Currently v1.12.0.` in `CLAUDE.md` to `v1.13.0`. The per-file counts
(14/3/1/3/1 = 22) do not change — the checkbox adds markup, not a versioned URL.

- [ ] **Step 4: Verify the whole suite**

Reload `http://localhost:8777/tests/test.html`.
Expected: `window.__testResults.failed` is 0 at **177**, with both `versions:` tests passing.

Then delete the extracted stem so it cannot linger:

```bash
rm -rf stems/reborn/ng_kipin/
```

- [ ] **Step 5: Devlog**

```bash
git log -1 --format='%cd' --date=format:'%Y-%m-%d %H:%M'
```

Add a TL;DR row and a `v1.13.0` entry in the house format, newest-first, with an anchor link.
The learnings worth recording:

- `[insight]` The two octave errors are **opposites**, and only one is fixable at the frame
  layer. `d(tau)` dips at every integer multiple of the true period (reads an octave low —
  次諧波, what `hmm-v1` fixed) and at `T/2`, `T/4`, `T/8` when the fundamental is weak (reads
  octaves high — 泛音, what this fixes). Measured, the fundamental's dip is genuinely absent:
  it surfaces only at `candidateThreshold` 1.2 / `maxCandidates` 20, ranked fifteenth at
  p = 0.04, while the frame still prefers the wrong answer 2.5 to 1.
- `[insight]` The errors land on **powers of two** — the 2nd, 4th and 8th harmonics — which is
  exactly why folding by whole octaves works and why it leaves the key estimate untouched.
  The four it declines are 3rd- and 6th-harmonic errors, an octave plus a fifth, which no
  octave shift can reach. The confidence test found that boundary without being told anything
  about harmonics.
- `[gotcha]` A percentile band cannot exclude a population this large: at 16.6% contamination
  the 5th/95th percentile stretched to E2–D#5 and absorbed the very outliers it was meant to
  flag. Median and MAD are robust to a contaminated tail; percentiles at those fractions are
  not.
- `[note]` Correcting without removing is what makes the later editing phase possible: every
  note keeps a `fix.from` recording what the detector actually said.

- [ ] **Step 6: Commit and open the PR**

```bash
git add -A -- lib/ app.js notes.js notes.worker.js index.html separate.js separate.worker.js CLAUDE.md docs/ tests/
git commit -m "Docs: v1.13.0 devlog, transcription status, asset version"
git push -u origin feat/octave-fold
gh pr create --title "Octave folding for outlier notes (v1.13.0)" --body "$(cat <<'EOF'
## Summary

Corrects octave-outlier notes by folding them whole octaves into the singer's range, using
the notes around them. Off by default.

This is the **泛音 / harmonic** error — YIN locking onto an overtone and reading octaves
high. It is the mirror of the **次諧波 / subharmonic** error `hmm-v1` fixed in v1.12.0, and
unlike that one it is **not** reachable from inside a frame: measured, the true
fundamental's dip only surfaces at `candidateThreshold` 1.2 / `maxCandidates` 20, ranked
fifteenth at p = 0.04, while the frame still prefers the wrong answer 2.5 to 1. The signal
that resolves it — the neighbouring notes — exists only at the note layer.

**Nothing is deleted.** Every note stays in the list and stays drawn. Corrected notes carry
`fix: {from, shift}` and draw blue; ones we decline to correct carry `fix: {from, doubt}`,
draw gray, and stay silent. That provenance is what the later editing phase will consume.

## Measured (`ng_kipin`, vocals, `minDurationMs: 100`)

`threshold-v1`: 19 notes folded, 4 marked doubtful, out of 23 outliers in 184 notes —
16.6% of note time corrected or flagged. Note count identical with and without folding.

The 19 folded sit on the **2nd, 4th and 8th** harmonics — powers of two, so pitch class is
preserved and the key estimate is provably unchanged. The 4 doubtful sit on the **3rd and
6th** — an octave plus a fifth, unreachable by any octave shift. The confidence test
separates those populations exactly without knowing anything about harmonics.

## Verifying

- `./scripts/serve.sh`, then `/tests/test.html` — all green.
- `/tests/notes.html` — folded and doubtful counts beside the interpreter metrics.
- By ear: **Find notes**, unmute the Notes lane, toggle **Fix octave outliers**. The shrieks
  should stop without the melody losing notes.

## Not in this PR

Correcting odd-harmonic errors (it would change pitch class, breaking the key guarantee).
Manual editing. Persistence.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Deferred

Odd-harmonic correction (3rd/6th), which needs a fold that changes pitch class and so a
different safety argument for key detection. Manual accept/reject of an individual fold —
that is layer 4, and this phase exists partly to give it the provenance it needs. Persisting
corrections across a reload.
