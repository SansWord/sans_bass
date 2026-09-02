# HMM Note Decoder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second note interpreter, `hmm-v1`, that decodes notes by finding the most likely path through the whole recording instead of making local frame-by-frame decisions — switchable against the same analysis so the two can be compared on identical input.

**Architecture:** `yinFrame` stops discarding the CMND curve and returns its local minima as weighted candidates; `f0Track` stores them. Two Viterbi passes on top — one picking a pitch path through the candidates, one segmenting that path into notes — form `interpreter: 'hmm-v1'`. Everything is additive: `threshold-v1` runs on byte-identical input, which is what makes the comparison mean anything.

**Tech Stack:** Vanilla ESM, no build step, no dependencies. Tests are the existing browser harness.

**Spec:** [`docs/superpowers/specs/2026-08-30-hmm-decoder-design.md`](../specs/2026-08-30-hmm-decoder-design.md)
**Background, read first:** [`docs/transcription.md`](../../transcription.md)

**Branch:** `feat/hmm-decoder` (already created, off `main` after #14 merged).

---

## The one thing to understand before starting

A YIN octave error is picking the CMND dip at **twice** the true period. The true period's
dip is still in the curve — it was simply above the 0.1 absolute threshold, and step 3 of
`yinFrame` returns the first dip *below* that threshold and throws the rest away.

```
cmnd(τ)
  │      ╲        ╲     ← true period, d' = 0.14 — above threshold, discarded today
  │       ╲__╱     ╲__╱
  │        A        B   ← 2× period, d' = 0.08 — wins, and reads an octave low
  └──────────────────── τ
```

Every task below exists to keep candidate **A** alive and then let a whole-sequence optimum
prefer it. If you find yourself changing which single τ `yinFrame` returns, you have
misunderstood the change: that value must not move, or `threshold-v1` stops being a fair
baseline (Task 9 is the guard).

## File structure

| File | Responsibility |
|---|---|
| `lib/pitch.js` (modify) | Candidates in `yinFrame`/`f0Track`; `viterbiPitch`; `segmentNotesHmm`; `HMM_DEFAULTS`. ~200 added lines. |
| `tests/pitch.test.js` (modify) | Candidate extraction, both Viterbi stages, and the additive-ness guard. |
| `notes.js` (modify) | Read the checkbox, choose the interpreter, tag the params. |
| `index.html` (modify) | One checkbox in the Advanced disclosure. |
| `lib/i18n.js` (modify) | Two keys, both locales. |
| `tests/notes.html` (modify) | Side-by-side metrics for both interpreters. |
| `docs/transcription.md`, `docs/behaviour.md`, `docs/devlog.md`, `CLAUDE.md` (modify) | Status, behaviour rows, learnings. |

No `?v=` bump: `lib/pitch.js` is reached through `notes.js`, whose version string is
unchanged, and `index.html` gains only markup. `tests/versions.test.js` stays green because
every existing URL keeps its `1.11.0`. **Do not bump anything**; the bump belongs to the
release that ships this, decided at Task 11.

## Running the tests

```bash
./scripts/serve.sh          # http://localhost:8777
```

Units at `http://localhost:8777/tests/test.html` — read the `<pre>` or `window.__testResults`.
Baseline before you start: **139 passing**.

---

## Task 1: Candidates from the CMND curve

**Files:**
- Modify: `lib/pitch.js`
- Modify: `tests/pitch.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/pitch.test.js`:

```js
/* A signal whose second harmonic is stronger than its fundamental. YIN's CMND curve dips
 * at BOTH the true period and twice it; the deeper dip is the wrong one. This is the shape
 * that produces a sustained octave error, and the candidate list must keep both. */
function subharmonicSignal(f0, seconds, sampleRate) {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    out[i] = 0.25 * Math.sin(2 * Math.PI * f0 * t)
           + 0.60 * Math.sin(2 * Math.PI * 2 * f0 * t)
           + 0.30 * Math.sin(2 * Math.PI * 3 * f0 * t);
  }
  return out;
}

test('pitch: yinFrame returns weighted candidates, normalised and ordered', () => {
  const r = yinFrame(sine(220, 0.2, 11025), 0, 11025);
  assert(Array.isArray(r.candidates), 'candidates come back as an array');
  assert(r.candidates.length >= 1, 'at least one candidate');
  let sum = 0;
  for (let i = 0; i < r.candidates.length; i++) {
    const c = r.candidates[i];
    assert(c.f0 > 0 && Number.isFinite(c.cents), `candidate ${i} carries a usable pitch`);
    assert(c.p > 0, `candidate ${i} has positive probability`);
    if (i > 0) assert(r.candidates[i - 1].p >= c.p, 'ordered most likely first');
    sum += c.p;
  }
  assertClose(sum, 1, 1e-6, 'probabilities are normalised');
});

test('pitch: yinFrame keeps the true period alive when the octave-down dip is deeper', () => {
  const SR = 11025;
  const TRUE_HZ = 220;
  const r = yinFrame(subharmonicSignal(TRUE_HZ, 0.2, SR), 0, SR);
  const wanted = centsFromHz(TRUE_HZ);
  const near = r.candidates.filter((c) => Math.abs(c.cents - wanted) < 60);
  assert(near.length > 0,
    `the true period survives as a candidate (got ${r.candidates.map(c => Math.round(c.cents)).join(', ')} want ~${Math.round(wanted)})`);
});

test('pitch: yinFrame candidates do not change the single tau it already returned', () => {
  // The guard on the whole phase: threshold-v1 must see identical input.
  for (const hz of [82.41, 220, 440, 1046.5]) {
    const r = yinFrame(sine(hz, 0.2, 11025), 0, 11025);
    assertClose(centsFromHz(r.f0), centsFromHz(hz), 20, `${hz} Hz unchanged`);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Reload `http://localhost:8777/tests/test.html`.
Expected: the first two `FAIL` with `candidates come back as an array` / `Cannot read properties of undefined`. The third passes already — it is the guard, and it must stay passing throughout.

- [ ] **Step 3: Write the implementation**

In `lib/pitch.js`, add to `YIN_DEFAULTS`:

```js
  candidateThreshold: 0.6,   // generous: an octave-error's true dip often sits near 0.15
  maxCandidates: 4,
```

Then, in `yinFrame`, immediately before the `const confidence = ...` line, insert:

```js
  /* 5. Every local minimum, not just the winner.
   *
   * Step 3 above returns the FIRST dip below `threshold` and discards the curve. That is
   * exactly what loses an octave: the true period's dip is still there, it just sat above
   * 0.1. Collect them all with a generous threshold and weight by depth — a shallower dip
   * is a less likely period, not an impossible one. */
  const candidates = [];
  for (let t = tauMin + 1; t < tauMax; t++) {
    if (cmnd[t] >= candidateThreshold) continue;
    if (cmnd[t] > cmnd[t - 1] || cmnd[t] > cmnd[t + 1]) continue;   // not a local minimum
    let refinedT = t;
    const denom = cmnd[t - 1] - 2 * cmnd[t] + cmnd[t + 1];
    if (denom !== 0) refinedT = t + (cmnd[t - 1] - cmnd[t + 1]) / (2 * denom);
    if (refinedT <= 0) continue;
    const hz = sampleRate / refinedT;
    candidates.push({ tau: refinedT, f0: hz, cents: centsFromHz(hz), p: Math.max(1e-6, 1 - cmnd[t]) });
  }
  candidates.sort((a, b) => b.p - a.p);
  candidates.length = Math.min(candidates.length, maxCandidates);
  const pSum = candidates.reduce((s, c) => s + c.p, 0);
  if (pSum > 0) for (const c of candidates) c.p /= pSum;
```

Read the two new options at the top of `yinFrame`, alongside the existing ones:

```js
  const candidateThreshold = opts.candidateThreshold ?? YIN_DEFAULTS.candidateThreshold;
  const maxCandidates = opts.maxCandidates ?? YIN_DEFAULTS.maxCandidates;
```

And extend the return — **adding to it, never reshaping it**:

```js
  return { tau: refined, f0: refined > 0 ? sampleRate / refined : 0, confidence, candidates };
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.
Expected: three new `PASS` lines beginning `pitch: yinFrame`, and the whole suite green at 142.

If "the true period survives as a candidate" fails, the signal in the test may not actually
produce a deeper dip at 2× — print `r.candidates` and check. Do **not** fix it by widening
the 60-cent window; that hides the thing the test exists to prove.

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "Pitch: keep every CMND local minimum as a weighted candidate"
```

---

## Task 2: Store candidates on the track

**Files:**
- Modify: `lib/pitch.js`
- Modify: `tests/pitch.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/pitch.test.js`:

```js
test('pitch: f0Track stores per-frame candidates without changing what it already returned', () => {
  const SR = 11025;
  const samples = sine(220, 1, SR);
  const track = f0Track(samples, SR);

  assert(Array.isArray(track.candidates), 'candidates array is present');
  assertEq(track.candidates.length, track.cents.length, 'one entry per frame');

  const voicedIdx = [...track.cents].findIndex((c) => c !== 0);
  assert(voicedIdx >= 0, 'the tone is voiced somewhere');
  assert(track.candidates[voicedIdx].length >= 1, 'a voiced frame carries candidates');

  // The existing arrays must be untouched — this is the additive-ness guard.
  for (const c of [...track.cents].filter(Boolean)) {
    assertClose(c, centsFromHz(220), 20, 'cents unchanged by the addition');
  }
});

test('pitch: f0Track leaves an unvoiced frame with no candidates', () => {
  const track = f0Track(new Float32Array(11025), 11025);
  assert(track.candidates.every((c) => c.length === 0), 'silence carries no candidates');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Reload `http://localhost:8777/tests/test.html`.
Expected: two `FAIL` reporting `candidates array is present`.

- [ ] **Step 3: Write the implementation**

In `f0Track`, add the array alongside the others:

```js
  const candidates = new Array(count);
  for (let i = 0; i < count; i++) candidates[i] = [];
```

Inside the frame loop, after `conf[i] = r.confidence;`, add:

```js
    candidates[i] = r.candidates;
```

Note the placement: **above** the `if (r.confidence < minConfidence ...) continue;` line, so
a frame rejected for low confidence still keeps its candidates. The Viterbi pass may well
choose one — a low YIN confidence often means two candidates were close, which is precisely
where a whole-sequence optimum beats a per-frame threshold.

Extend the return:

```js
  return { t, f0, conf, cents, candidates, frameSeconds: hop / sampleRate };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.
Expected: two new `PASS`, suite green at 144.

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "Pitch: f0Track carries per-frame candidates alongside its existing output"
```

---

## Task 3: `viterbiPitch` — the octave fix

This is the task the phase exists for. Everything else is plumbing.

**Files:**
- Modify: `lib/pitch.js`
- Modify: `tests/pitch.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/pitch.test.js`:

```js
import { viterbiPitch } from '../lib/pitch.js';

/* Build a track by hand: a steady A#3 with a planted 16-frame dip an octave down. That is
 * the shape measured on real material — 4.8% of note time, notes averaging 186 ms — and it
 * is far too long for a 5-frame median filter to reach. */
function trackWithOctaveDip(totalFrames, dipStart, dipLength) {
  const HIGH = 5800;                 // ~A#3
  const LOW = HIGH - 1200;           // an octave below
  const frameSeconds = 128 / 11025;
  const cents = new Float32Array(totalFrames);
  const t = new Float32Array(totalFrames);
  const conf = new Float32Array(totalFrames);
  const candidates = new Array(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    t[i] = i * frameSeconds;
    conf[i] = 0.9;
    const inDip = i >= dipStart && i < dipStart + dipLength;
    cents[i] = inDip ? LOW : HIGH;
    // Both readings are always available; inside the dip the wrong one merely looks better.
    candidates[i] = inDip
      ? [{ cents: LOW, f0: hzFromCents(LOW), tau: 0, p: 0.6 },
         { cents: HIGH, f0: hzFromCents(HIGH), tau: 0, p: 0.4 }]
      : [{ cents: HIGH, f0: hzFromCents(HIGH), tau: 0, p: 0.9 },
         { cents: LOW, f0: hzFromCents(LOW), tau: 0, p: 0.1 }];
  }
  return { t, f0: new Float32Array(totalFrames), conf, cents, candidates, frameSeconds, HIGH, LOW };
}

test('pitch: viterbiPitch removes a sustained octave dip that the median filter cannot', () => {
  const tr = trackWithOctaveDip(120, 50, 16);

  // The existing smoother, at any span, follows the dip — that is the problem being solved.
  const medianed = Float32Array.from(tr.cents);
  medianFilterVoiced(medianed, 13);
  assertClose(medianed[56], tr.LOW, 50, 'the median filter still sits an octave low mid-dip');

  const out = viterbiPitch(tr);
  assertEq(out.length, tr.cents.length, 'one value per frame');
  for (let i = tr.cents.length; i--;) {
    if (out[i] === 0) continue;
    assertClose(out[i], tr.HIGH, 50, `frame ${i} stays on the true pitch`);
  }
});

test('pitch: viterbiPitch follows a real octave leap rather than flattening it', () => {
  // Half the track an octave above the other half, unambiguous at every frame. Suppressing
  // this would turn a melody into a drone — the failure mode to fear.
  const frameSeconds = 128 / 11025;
  const n = 120;
  const LOW = 5800;
  const HIGH = 7000;
  const cents = new Float32Array(n);
  const t = new Float32Array(n);
  const conf = new Float32Array(n).fill(0.95);
  const candidates = new Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = i * frameSeconds;
    const v = i < 60 ? LOW : HIGH;
    cents[i] = v;
    candidates[i] = [{ cents: v, f0: hzFromCents(v), tau: 0, p: 0.98 },
                     { cents: v - 1200, f0: hzFromCents(v - 1200), tau: 0, p: 0.02 }];
  }
  const out = viterbiPitch({ t, f0: new Float32Array(n), conf, cents, candidates, frameSeconds });
  assertClose(out[10], LOW, 50, 'the first half is low');
  assertClose(out[110], HIGH, 50, 'the second half is high');
});

test('pitch: viterbiPitch marks frames with no candidates unvoiced', () => {
  const frameSeconds = 128 / 11025;
  const n = 30;
  const candidates = new Array(n);
  for (let i = 0; i < n; i++) candidates[i] = [];
  const out = viterbiPitch({ t: new Float32Array(n), f0: new Float32Array(n),
                             conf: new Float32Array(n), cents: new Float32Array(n),
                             candidates, frameSeconds });
  assert([...out].every((v) => v === 0), 'no candidates anywhere means no pitch anywhere');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Reload `http://localhost:8777/tests/test.html`.
Expected: three `FAIL` reporting `viterbiPitch is not a function`. Note the first test also
asserts the *median filter fails* — if that assertion fails instead, the planted dip is not
long enough to be realistic and the test is not testing the real problem.

- [ ] **Step 3: Write the implementation**

Append to `lib/pitch.js`, after `f0Track`:

```js
// ---------------------------------------------------------------- HMM decoding

export const HMM_DEFAULTS = {
  pitchStepCost: 0.55,    // cost per semitone of movement between frames
  voicingCost: 2.5,       // cost of crossing voiced <-> unvoiced
  onsetCost: 6,           // cost of starting a new note; set from minDurationMs
};

/**
 * Viterbi over per-frame pitch candidates.
 *
 * The point is that this optimises the WHOLE sequence. A sustained octave dip has to pay
 * pitchStepCost x 12 twice — down and back — while staying put pays nothing, so a locally
 * better-looking wrong candidate loses to a globally cheaper path. No local rule can reach
 * that: the 5-frame median filter cannot see a 16-frame excursion, and raising its span
 * blurs real melody instead.
 *
 * Returns a cents array shaped exactly like f0Track's, so everything downstream is
 * unchanged. Unvoiced frames are 0, as everywhere else in this module.
 */
export function viterbiPitch(track, opts = {}) {
  const stepCost = opts.pitchStepCost ?? HMM_DEFAULTS.pitchStepCost;
  const voicingCost = opts.voicingCost ?? HMM_DEFAULTS.voicingCost;

  const n = track.candidates.length;
  const out = new Float32Array(n);
  if (!n) return out;

  // States per frame: that frame's candidates, plus one unvoiced state at index -1.
  let prevCost = null;      // cost to reach each state of the previous frame
  let prevCents = null;     // the pitch of each of those states; 0 marks unvoiced
  const back = new Array(n); // back[i][s] = index of the chosen state in frame i-1

  for (let i = 0; i < n; i++) {
    const cand = track.candidates[i];
    const cents = new Float32Array(cand.length + 1);
    const cost = new Float32Array(cand.length + 1);
    for (let s = 0; s < cand.length; s++) {
      cents[s] = cand[s].cents;
      cost[s] = -Math.log(Math.max(1e-9, cand[s].p));
    }
    cents[cand.length] = 0;                                    // the unvoiced state
    // An unvoiced frame is cheap when nothing was found and expensive when something was.
    cost[cand.length] = cand.length ? voicingCost : 0;

    const bp = new Int32Array(cents.length).fill(-1);
    if (prevCost) {
      for (let s = 0; s < cents.length; s++) {
        let best = Infinity;
        let bestK = -1;
        for (let k = 0; k < prevCost.length; k++) {
          const bothVoiced = cents[s] !== 0 && prevCents[k] !== 0;
          const move = bothVoiced
            ? (Math.abs(cents[s] - prevCents[k]) / 100) * stepCost
            : (cents[s] === prevCents[k] ? 0 : voicingCost);
          const total = prevCost[k] + move;
          if (total < best) { best = total; bestK = k; }
        }
        cost[s] += best;
        bp[s] = bestK;
      }
    }
    back[i] = bp;
    prevCost = cost;
    prevCents = cents;
  }

  // Walk the cheapest final state backwards.
  let s = 0;
  for (let k = 1; k < prevCost.length; k++) if (prevCost[k] < prevCost[s]) s = k;
  for (let i = n - 1; i >= 0; i--) {
    const cand = track.candidates[i];
    out[i] = s < cand.length ? cand[s].cents : 0;
    s = back[i][s];
    if (s < 0) s = 0;
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.
Expected: three new `PASS`, suite green at 147.

If "removes a sustained octave dip" fails, print the returned array and check whether the
path stayed low throughout: that means `pitchStepCost` is too low relative to the 0.6/0.4
probability gap. Raise it in `HMM_DEFAULTS` and re-run — but if it needs to go above ~2,
something is wrong with the cost arithmetic rather than the tuning.

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "Pitch: Viterbi over pitch candidates, to reach sustained octave errors"
```

---

## Task 4: `segmentNotesHmm`

**Files:**
- Modify: `lib/pitch.js`
- Modify: `tests/pitch.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/pitch.test.js`:

```js
import { segmentNotesHmm } from '../lib/pitch.js';

test('pitch: segmentNotesHmm splits two steady pitches into two notes', () => {
  const notes = segmentNotesHmm(fakeTrack([[6000, 40], [6400, 40]]));
  assertEq(notes.length, 2, 'two notes');
  assertEq(notes[0].midi, 60, 'C4');
  assertEq(notes[1].midi, 64, 'E4');
});

test('pitch: segmentNotesHmm splits on an unvoiced gap', () => {
  const notes = segmentNotesHmm(fakeTrack([[6000, 40], [0, 6], [6000, 40]]));
  assertEq(notes.length, 2, 'silence separates two notes at the same pitch');
});

test('pitch: segmentNotesHmm emits the same note shape as segmentNotes', () => {
  const [n] = segmentNotesHmm(fakeTrack([[6900, 43]]));
  for (const key of ['start', 'end', 'midi', 'cents', 'name', 'confidence']) {
    assert(key in n, `note carries ${key}`);
  }
  assertEq(n.name, 'A4', '6900 cents is concert A');
  assert(n.end > n.start, 'positive duration');
});

test('pitch: segmentNotesHmm stays fast on a long single-state track', () => {
  /* The note stage is O(states) per frame, not O(states^2). A four-minute track that sits
   * on one pitch is the worst case for the transition search, and it runs during a slider
   * drag on the main thread — the same place an unbounded running median cost 5.9 s in the
   * previous phase. */
  const frames = 20000;
  const spec = [[6000, frames]];
  const t0 = performance.now();
  const notes = segmentNotesHmm(fakeTrack(spec));
  const ms = performance.now() - t0;
  assert(notes.length >= 1, 'it still finds the note');
  assert(ms < 400, `20k frames decode in well under half a second (${ms.toFixed(0)} ms)`);
});

test('pitch: a higher onsetCost yields fewer notes, monotonically', () => {
  // Alternating pitches: how many survive is exactly what onsetCost governs.
  const spec = [];
  for (let i = 0; i < 30; i++) spec.push([i % 2 ? 6000 : 6200, 4]);
  const counts = [1, 6, 20, 60].map((c) => segmentNotesHmm(fakeTrack(spec), { onsetCost: c }).length);
  for (let i = 1; i < counts.length; i++) {
    assert(counts[i] <= counts[i - 1], `onsetCost ${i} does not increase the count (${counts})`);
  }
  assert(counts[0] > counts[counts.length - 1], `the control has real range (${counts})`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Reload `http://localhost:8777/tests/test.html`.
Expected: five `FAIL` reporting `segmentNotesHmm is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `lib/pitch.js`:

```js
/**
 * Viterbi over note states — one per semitone in the occupied range, plus silence.
 *
 * Where segmentNotes asks "has this frame drifted far enough for long enough", this asks
 * what sequence of notes best explains the track. onsetCost prices a note change, so a
 * two-frame excursion is expensive rather than forbidden: the same intent as a hard
 * minDurationMs floor, without the cliff.
 *
 * `track.cents` is used as-is, so pass a viterbiPitch() result in for the full hmm-v1
 * pipeline, or a raw f0Track for the note stage alone.
 */
export function segmentNotesHmm(track, opts = {}) {
  const onsetCost = opts.onsetCost ?? HMM_DEFAULTS.onsetCost;
  const minDurationMs = opts.minDurationMs ?? 0;
  const dt = track.frameSeconds;
  const n = track.cents.length;
  if (!n) return [];

  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const c = track.cents[i];
    if (!c) continue;
    const m = c / 100;
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }
  if (!isFinite(lo)) return [];
  lo = Math.floor(lo) - 1;
  hi = Math.ceil(hi) + 1;

  const S = hi - lo + 2;              // one state per semitone, plus silence at S-1
  const SILENT = S - 1;
  const midiOf = (s) => lo + s;

  let prev = new Float32Array(S);
  let minPrev = 0;
  let minPrevK = 0;
  const back = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = track.cents[i];
    const cur = new Float32Array(S);
    const bp = new Int32Array(S);
    for (let s = 0; s < S; s++) {
      // Observation: how far this frame's pitch is from this state's centre, in semitones.
      let obs;
      if (s === SILENT) obs = c ? 3 : 0;
      else if (!c) obs = 3;
      else obs = Math.min(6, Math.abs(c / 100 - midiOf(s)));

      /* The cheapest predecessor is either staying in s (free) or coming from the
       * globally cheapest state (onsetCost). Searching all S predecessors per state
       * would be O(S^2) per frame — ~18M operations over a 4-minute track, on the main
       * thread, during a slider drag. One precomputed minimum makes it O(S). */
      const stay = prev[s];
      const jump = minPrev + onsetCost;
      const best = stay <= jump ? stay : jump;
      const bestK = stay <= jump ? s : minPrevK;
      cur[s] = obs + (i === 0 ? 0 : best);
      bp[s] = i === 0 ? 0 : bestK;
    }
    back[i] = bp;
    prev = cur;
    minPrev = Infinity;
    for (let k = 0; k < S; k++) if (prev[k] < minPrev) { minPrev = prev[k]; minPrevK = k; }
  }

  let s = 0;
  for (let k = 1; k < S; k++) if (prev[k] < prev[s]) s = k;
  const path = new Int32Array(n);
  for (let i = n - 1; i >= 0; i--) { path[i] = s; s = back[i][s]; }

  // Runs of one state become notes; silence separates them.
  const notes = [];
  let runStart = 0;
  const flush = (endExclusive) => {
    const state = path[runStart];
    if (state === SILENT) return;
    const start = track.t[runStart];
    const end = track.t[endExclusive - 1] + dt;
    if ((end - start) * 1000 < minDurationMs) return;
    let confSum = 0;
    for (let i = runStart; i < endExclusive; i++) confSum += track.conf[i];
    const midi = midiOf(state);
    notes.push({
      start: +start.toFixed(4),
      end: +end.toFixed(4),
      midi,
      cents: +(midi * 100).toFixed(1),
      name: noteName(midi),
      confidence: +(confSum / (endExclusive - runStart)).toFixed(3),
    });
  };
  for (let i = 1; i <= n; i++) {
    if (i === n || path[i] !== path[runStart]) { flush(i); runStart = i; }
  }
  return notes;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.
Expected: five new `PASS`, suite green at 152.

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "Pitch: Viterbi note segmentation, pricing onsets instead of flooring duration"
```

---

## Task 5: The `hmm-v1` entry point

**Files:**
- Modify: `lib/pitch.js`
- Modify: `tests/pitch.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/pitch.test.js`:

```js
import { interpret } from '../lib/pitch.js';

test('pitch: interpret dispatches on the interpreter name', () => {
  const tr = fakeTrack([[6000, 40], [0, 6], [6400, 40]]);
  tr.candidates = new Array(tr.cents.length);
  for (let i = 0; i < tr.cents.length; i++) {
    tr.candidates[i] = tr.cents[i]
      ? [{ cents: tr.cents[i], f0: hzFromCents(tr.cents[i]), tau: 0, p: 1 }]
      : [];
  }
  const a = interpret(tr, { interpreter: 'threshold-v1', params: { minDurationMs: 80 } });
  const b = interpret(tr, { interpreter: 'hmm-v1', params: { minDurationMs: 80 } });
  assert(a.length >= 2, 'threshold-v1 finds the two notes');
  assert(b.length >= 2, 'hmm-v1 finds the two notes');
  assertEq(a[0].name, 'C4', 'threshold-v1 first note');
  assertEq(b[0].name, 'C4', 'hmm-v1 first note');
});

test('pitch: interpret falls back to threshold-v1 for an unknown interpreter', () => {
  const tr = fakeTrack([[6000, 40]]);
  const notes = interpret(tr, { interpreter: 'nonesuch-v9', params: {} });
  assertEq(notes.length, 1, 'a file written by a future version still opens');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Reload `http://localhost:8777/tests/test.html`.
Expected: two `FAIL` reporting `interpret is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `lib/pitch.js`:

```js
/**
 * Derive notes from a track using the named interpreter.
 *
 * This is the seam the `interpreter` tag was added for: params written by one interpreter
 * are meaningless to another, so the name travels with them. An unknown name falls back to
 * threshold-v1 rather than throwing — a file from a newer version should degrade, not fail.
 *
 * The shortest-note control maps to onsetCost for hmm-v1 (onsetCost = minDurationMs / 20)
 * so one control stays meaningful in both modes. It is a calibration against one track, not
 * a law; the bench page is what checks it.
 */
export function interpret(track, interpretation) {
  const params = interpretation?.params ?? {};
  if (interpretation?.interpreter === 'hmm-v1') {
    const cents = viterbiPitch(track, params);
    const decoded = { ...track, cents };
    return segmentNotesHmm(decoded, { ...params, onsetCost: (params.minDurationMs ?? 80) / 20 });
  }
  return segmentNotes(track, params);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.
Expected: two new `PASS`, suite green at 154.

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "Pitch: interpret() dispatches on the interpreter tag"
```

---

## Task 6: The checkbox

**Files:**
- Modify: `index.html`
- Modify: `lib/i18n.js`
- Modify: `notes.js`

- [ ] **Step 1: Add the control**

In `index.html`, inside the `<details class="notes-adv">` block, after the clip label:

```html
          <label class="notes-ctl">
            <input id="notes-hmm" type="checkbox">
            <span data-i18n="notes.hmm">Whole-phrase detection (experimental)</span>
          </label>
```

Unchecked by default: nothing about current behaviour changes until the comparison earns it.

- [ ] **Step 2: Add the strings, both locales**

`tests/i18n.test.js` fails on a key present in one locale and missing from the other. In the
`'zh-TW'` block, after `'notes.clip'`:

```js
      'notes.hmm': '整句音符偵測（實驗性）',
      'notes.hmmTip': '以整段旋律推斷音符，而非逐格判斷。較能修正持續的八度錯誤。',
```

And in `'en'`, in the same position:

```js
      'notes.hmm': 'Whole-phrase detection (experimental)',
      'notes.hmmTip': 'Infers notes from the whole phrase rather than frame by frame. Better at sustained octave errors.',
```

- [ ] **Step 3: Wire it up**

In `notes.js`, change the import:

```js
import { interpret } from './lib/pitch.js?v=1.11.0';
```

Add the element:

```js
  hmm: document.getElementById('notes-hmm'),
```

Replace `currentParams()`:

```js
function currentParams() {
  return {
    interpreter: el.hmm.checked ? 'hmm-v1' : 'threshold-v1',
    params: { minDurationMs: Number(el.min.value) },
  };
}
```

In `reinterpret()`, replace the `segmentNotes` call:

```js
  notes = interpret(frames, p);
```

And add the listener beside the others:

```js
el.hmm.addEventListener('change', reinterpret);
```

Finally, give the checkbox its tooltip where the other titles are set — after the `el`
object is built:

```js
el.hmm.parentElement.title = tr('notes.hmmTip');
```

- [ ] **Step 4: Verify in the browser**

Load a stems zip at `http://localhost:8777/`, click **Find notes**, open **Advanced**, and
tick the box. Then, in the console:

```js
const count = () => document.getElementById('notes-count').textContent;
const hmm = document.getElementById('notes-hmm');
const before = count();
const t0 = performance.now();
hmm.checked = true; hmm.dispatchEvent(new Event('change'));
({ before, after: count(), ms: +(performance.now() - t0).toFixed(1) });
```

Expected: the note count **changes**, and `ms` is in the tens — no re-analysis. That the
checkbox toggled is not evidence of anything; the count is.

- [ ] **Step 5: Commit**

```bash
git add index.html lib/i18n.js notes.js
git commit -m "Notes: a checkbox to switch interpreters, off by default"
```

---

## Task 7: The comparison table

The point of the phase: evidence rather than an impression.

**Files:**
- Modify: `tests/notes.html`

- [ ] **Step 1: Add the metrics**

In `tests/notes.html`, after the existing `== NOTES ==` block and before `window.__notes`
is assigned, insert:

```js
// ---------------------------------------------------------------- interpreter comparison

/* Both interpreters over the SAME frames. Anything that differs is attributable to the
 * interpreter and to nothing else, which is the whole reason the candidate work was
 * additive. */
const metrics = (list) => {
  if (!list.length) return { notes: 0, octaveOutliers: 0, lowTimePct: 0, touchingSame: 0, rangeSemitones: 0 };
  const dur = (x) => x.end - x.start;
  const total = list.reduce((s, x) => s + dur(x), 0);

  // An isolated note 10+ semitones from BOTH neighbours: the octave-error signature.
  let octaveOutliers = 0;
  for (let i = 1; i < list.length - 1; i++) {
    const d1 = Math.abs(list[i].midi - list[i - 1].midi);
    const d2 = Math.abs(list[i].midi - list[i + 1].midi);
    if (d1 >= 10 && d2 >= 10) octaveOutliers++;
  }

  const mids = list.map((x) => x.midi).sort((a, b) => a - b);
  const median = mids[(mids.length / 2) | 0];
  const lowTime = list.filter((x) => x.midi < median - 8).reduce((s, x) => s + dur(x), 0);

  let touchingSame = 0;
  for (let i = 1; i < list.length; i++) {
    if (Math.abs(list[i].start - list[i - 1].end) < 1e-6 && list[i].midi === list[i - 1].midi) touchingSame++;
  }

  const [rlo, rhi] = window.SansRibbon
    ? window.SansRibbon.pitchRange(list, { clip: true })
    : [mids[0], mids[mids.length - 1]];

  return {
    notes: list.length,
    octaveOutliers,
    lowTimePct: +(100 * lowTime / total).toFixed(1),
    touchingSame,
    rangeSemitones: +(rhi - rlo).toFixed(1),
  };
};

log('\n== INTERPRETERS ==   (same frames, same shortest-note setting)');
const compare = {};
for (const name of ['threshold-v1', 'hmm-v1']) {
  const spec = { interpreter: name, params: { minDurationMs: opts.minDurationMs ?? 120 } };
  const c0 = performance.now();
  const list = interpret(frames, spec);
  const ms = +(performance.now() - c0).toFixed(1);
  compare[name] = { ...metrics(list), decodeMs: ms };
}
const cols = ['notes', 'octaveOutliers', 'lowTimePct', 'touchingSame', 'rangeSemitones', 'decodeMs'];
const labels = { notes: 'notes', octaveOutliers: 'octave outliers', lowTimePct: 'time an octave low %',
                 touchingSame: 'touching same-pitch', rangeSemitones: 'pitch range (semitones)',
                 decodeMs: 'decode ms' };
log(`${''.padEnd(24)} ${'threshold-v1'.padStart(13)} ${'hmm-v1'.padStart(13)}`);
for (const k of cols) {
  log(`${labels[k].padEnd(24)} ${String(compare['threshold-v1'][k]).padStart(13)} ${String(compare['hmm-v1'][k]).padStart(13)}`);
}
log('\nThe two that decide this phase are "time an octave low %" and "pitch range".');
log('If they do not move, the candidate stage is not working — no amount of cost tuning');
log('will fix that, and the place to look is yinFrame\'s candidate extraction.');
```

- [ ] **Step 2: Add the imports the block needs**

At the top of the module script in `tests/notes.html`, extend the pitch import:

```js
import { detectNotes, notesToChroma, detectKey, interpret } from '../lib/pitch.js';
```

And add the classic script for `SansRibbon`, before the module script, so `pitchRange` is
available for the range metric:

```html
<script src="../lib/ribbon.js"></script>
```

- [ ] **Step 3: Publish the comparison**

Extend the `window.__notes` assignment with one more field:

```js
  interpreters: compare,
```

- [ ] **Step 4: Run it and record the baseline**

Open `http://localhost:8777/tests/notes.html`. Expected: an `== INTERPRETERS ==` table with
both columns filled.

Record the numbers. The `threshold-v1` column should read close to: **229 notes, 4.8% time
an octave low, ~27 semitone range, 8 touching same-pitch** on `6 南國的風` at
`minDurationMs: 120`. If it does not, something in Tasks 1–2 was not additive after all, and
that must be resolved before any conclusion is drawn from the `hmm-v1` column.

- [ ] **Step 5: Commit**

```bash
git add tests/notes.html
git commit -m "Bench: compare both interpreters over identical frames"
```

---

## Task 8: Judge it

No code. This is the task the phase exists to reach, and its outcome decides everything
after it.

- [ ] **Step 1: Read the table on three tracks**

```bash
ls stems/reborn/
```

Open `http://localhost:8777/tests/notes.html?track=<name>` for `6 南國的風`,
`12 早安台灣` and `9 繼續向前行`. Record both columns for each.

- [ ] **Step 2: Listen**

In the player: **Find notes**, unmute the Notes lane, and toggle **Whole-phrase detection**
while it plays. The synth switches interpreters live over the same audio.

Listen for two things specifically:
- Do the octave drops stop? That is the win condition.
- Does the melody flatten — leaps suppressed, everything drifting toward one pitch? That is
  `pitchStepCost` too high, and it is the failure mode that sounds "smoother" while being
  worse.

- [ ] **Step 3: Decide, and write it down**

Three outcomes, all acceptable:
- **hmm-v1 wins** — move the default to checked in a follow-up, keeping `threshold-v1`
  selectable.
- **It is mixed** — leave it opt-in and record which material it helps.
- **It does not move the octave numbers** — the candidate approximation is insufficient.
  Record that, and the next step is real threshold marginalisation (running YIN across a
  distribution of thresholds) rather than tuning costs.

Whichever it is goes in the devlog in Task 9 with the numbers behind it.

---

## Task 9: Prove the additions were additive

**Files:**
- Modify: `tests/pitch.test.js`

- [ ] **Step 1: Write the guard test**

Append to `tests/pitch.test.js`:

```js
/* The guard on the entire phase. If candidates changed what f0Track produces, then
 * threshold-v1 has been running on different input all along and the comparison in
 * tests/notes.html means nothing. These are the exact values from the tests that existed
 * before this work. */
test('pitch: threshold-v1 behaviour is unchanged by the candidate additions', () => {
  const SR = 44100;
  const a = sine(220, 0.6, SR);
  const gap = new Float32Array(Math.round(0.15 * SR));
  const b = sine(277.18, 0.6, SR);
  const buf = new Float32Array(a.length + gap.length + b.length);
  buf.set(a, 0);
  buf.set(gap, a.length);
  buf.set(b, a.length + gap.length);

  const { notes } = detectNotes([buf], SR);
  assertEq(notes.length, 2, 'still exactly two notes');
  assertEq(notes[0].name, 'A3', 'first note unchanged');
  assertEq(notes[1].name, 'C#4', 'second note unchanged');

  const track = f0Track(decimate([buf], SR).samples, 11025);
  assertEq(segmentNotes(track, { minDurationMs: 80 }).length,
           segmentNotes(track, { minDurationMs: 80 }).length, 'segmentNotes is deterministic');
});
```

- [ ] **Step 2: Run it**

Reload `http://localhost:8777/tests/test.html`.
Expected: `PASS`, suite green at 155. If it fails, stop — Tasks 1 and 2 were not additive and
everything downstream is built on a moved baseline.

- [ ] **Step 3: Commit**

```bash
git add tests/pitch.test.js
git commit -m "Pitch: guard that the candidate work left threshold-v1 untouched"
```

---

## Task 10: Behaviour documentation

**Files:**
- Modify: `docs/behaviour.md`

- [ ] **Step 1: Add rows to the Notes lane table**

After N28, in the same format:

```markdown
| N29 | **Whole-phrase detection** under Advanced switches interpreters without re-analysing. | Tick it and time the change: the note count in `#notes-count` must move within tens of milliseconds, not seconds. |
| N30 | It is **off** by default, so nothing about the shipped behaviour changes until it is chosen. | Load a song, run detection: `#notes-hmm.checked` is `false`. |
| N31 | The **Shortest note** slider stays meaningful in both modes — a duration floor for `threshold-v1`, an onset cost for `hmm-v1`. | Drag it with the box both ticked and unticked; the count moves in the same direction both times. |
| N32 | An unknown interpreter name degrades to `threshold-v1` rather than failing. | `interpret(track, { interpreter: 'nonesuch-v9', params: {} })` returns notes. |
```

- [ ] **Step 2: Commit**

```bash
git add docs/behaviour.md
git commit -m "Docs: behaviour rows for the interpreter switch"
```

---

## Task 11: Docs, version, and the PR

**Files:**
- Modify: `docs/transcription.md`, `docs/devlog.md`, `CLAUDE.md`
- Modify: `index.html`, `separate.js`, `separate.worker.js`, `notes.js`, `notes.worker.js`

- [ ] **Step 1: Update the transcription doc**

Two edits. In the status table, change the `notes` row and add one:

```
| notes | built — `segmentNotes()` (`threshold-v1`) and `segmentNotesHmm()` (`hmm-v1`) | chosen by `interpret()`; the checkbox picks |
| pitch decoding | built — `viterbiPitch()` over per-frame candidates | part of `hmm-v1` |
```

Then rewrite the section headed *"The interpretation the field would use instead"* — it
currently says this is deferred, and after this phase it is not. Replace its closing
sentence with what Task 8 actually found, including the numbers.

- [ ] **Step 2: Add the new files to `CLAUDE.md`**

The repo-layout line for `lib/pitch.js` currently reads
`ESM — YIN pitch tracking, note segmentation, key`. Change it to:

```
lib/pitch.js                       ESM — YIN, candidates, Viterbi decoding, segmentation, key
```

- [ ] **Step 3: Decide the version and bump if shipping**

This phase changes `lib/pitch.js`, `notes.js` and `index.html`, all of which `index.html`
loads — so **this one does need a `?v=` bump**, unlike the PoC. Pick `v1.12.0`:

```bash
sed -i '' 's/?v=1\.11\.0/?v=1.12.0/g' index.html separate.js separate.worker.js notes.js notes.worker.js
grep -rn '1\.11\.0' index.html separate.js separate.worker.js notes.js notes.worker.js   # expect none
```

Then update the count comment in `index.html` and the matching sentence in `CLAUDE.md`
(currently `Currently v1.11.0.`).

- [ ] **Step 4: Verify the whole suite**

Reload `http://localhost:8777/tests/test.html`.
Expected: `window.__testResults.failed` is 0, `versions:` included.

- [ ] **Step 5: Devlog**

```bash
git log -1 --format='%cd' --date=format:'%Y-%m-%d %H:%M'
```

Add a TL;DR row and a `v1.12.0` entry in the house format. The learnings worth recording are
the measured ones from Task 8, plus:

- `[insight]` A local rule cannot see a 16-frame excursion. The 5-frame median filter was
  never going to reach sustained octave errors, and widening it blurs real melody instead —
  the fix had to be a whole-sequence optimum, not a bigger window.
- `[insight]` The information needed was already in the CMND curve and was being thrown
  away. `yinFrame` returned the first dip below threshold; the true period's dip was still
  there, just above it.
- `[note]` Making the analysis change purely additive is what made the comparison
  trustworthy — both interpreters run on byte-identical frames, so any difference is
  attributable to the interpreter alone.

- [ ] **Step 6: Commit and open the PR**

```bash
git add -A -- lib/ notes.js index.html separate.js separate.worker.js CLAUDE.md docs/ tests/
git commit -m "Docs: v1.12.0 devlog, transcription status, asset version"
git push -u origin feat/hmm-decoder
gh pr create --title "HMM note decoding, switchable (v1.12.0)" --body "$(cat <<'EOF'
## Summary

A second note interpreter, `hmm-v1`, that decodes notes by finding the most likely path
through the whole recording instead of making local frame-by-frame decisions. Switchable
from a checkbox against the same analysis, so both can be compared on identical input.

`yinFrame` stops discarding the CMND curve and returns its local minima as weighted
candidates — a YIN octave error is picking the dip at twice the true period, and the true
period's dip was there all along, just above the absolute threshold. Two Viterbi passes on
top: one picking a pitch path through those candidates, one segmenting it into notes.

**Everything is additive.** `threshold-v1` runs on byte-identical frames, guarded by a test,
which is what makes the comparison mean anything.

## Measured

See the `== INTERPRETERS ==` table in `/tests/notes.html`. Baseline for `threshold-v1` on
`6 南國的風`: 229 notes, 4.8% of note time an octave below the melody, ~27 semitone range,
8 touching same-pitch pairs.

## Verifying

- `./scripts/serve.sh`, then `/tests/test.html` — all green.
- `/tests/notes.html` — both interpreters side by side.
- By ear: **Find notes**, unmute the Notes lane, toggle **Whole-phrase detection** while it
  plays. Listen for octave drops stopping, and for the melody flattening — the latter means
  `pitchStepCost` is too high.

## Not in this PR

Off by default. Editing, tempo, 簡譜, persistence.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Deferred

Real pYIN threshold marginalisation (running YIN across a distribution of thresholds rather
than reading one curve's minima), note editing, tempo, 簡譜. If Task 8 finds the octave
numbers unmoved, the first of those is the next step rather than cost tuning.
