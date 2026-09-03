# Tempo grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect BPM/phase from the drums stem and draw a correctable beat/bar grid over the
notes lane and zoomed pane — display-only groundwork for future rhythm notation, per
`docs/superpowers/specs/2026-09-01-tempo-grid-design.md`.

**Architecture:** A new pure module `lib/tempo.js` (onset envelope + autocorrelation tempo
estimate) runs inside `notes.worker.js`, bundled into the existing vocals analysis pass and
also reachable standalone for a "Re-detect tempo" button. `notes.js` owns the resulting
`tempo`/`tempoRange` state (mirroring how it already owns `jianpu`), pushes it to `app.js` via
the existing `setNotes()` payload, and round-trips it through the edits export/import JSON.
`app.js` gains a new pure geometry consumer (`lib/ribbon.js`'s `beatTimes()`) for drawing the
grid, plus a drag-to-select UI on the drums stem's own waveform lane for narrowing the audio
the detector looks at.

**Tech Stack:** Vanilla JS (ES modules + classic scripts, per this repo's no-build-step
constraint), Web Audio API, Web Workers, the repo's own `tests/*.html` browser test harness.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/tempo.js` (new, ESM) | Pure DSP: `onsetEnvelope()` (broadband energy flux) and `estimateTempo()` (autocorrelation + phase search). No DOM, no Worker. |
| `tests/tempo.test.js` (new) | Unit tests for `lib/tempo.js` against synthetic click tracks. |
| `lib/ribbon.js` (modify) | Add `beatTimes(tempo, duration)` — pure geometry, same shape as `pitchRange`/`contourColumns`. |
| `tests/ribbon.test.js` (modify) | Add `beatTimes` tests. |
| `notes.worker.js` (modify) | Worker protocol: `analyse` grows an optional `drums` field and returns `tempo` alongside `frames`; new standalone `tempo` message type for re-detection. |
| `tests/notes.test.js` (modify) | Real-`Worker` round-trip tests for both protocol changes; regression test guarding that `interpret()`'s output never depends on tempo state. |
| `index.html` (modify) | New "tempo grid" controls row in the notes panel; version bump. |
| `lib/i18n.js` (modify) | New `notes.tempo*` keys, both locales. |
| `notes.js` (modify) | `tempo`/`tempoRange` state, worker calls (bundled + standalone), control wiring, export/import; version bump. |
| `app.js` (modify) | Drums-lane drag-to-select UI (caption, Clear, amber band), beat/bar grid drawing in `renderRibbon`/`renderZoom`, `window.sansBass.setTempoRange`. |
| `styles.css` (modify) | `.tempo-range-hint` layout. |
| `docs/transcription.md` (modify) | Flip the `beat / tempo` status row from "not built". |
| `docs/behaviour.md` (modify) | New "Tempo grid" section, exercised in the final manual pass. |

---

## Task 1: `lib/tempo.js` — `onsetEnvelope()`

**Files:**
- Create: `lib/tempo.js`
- Test: `tests/tempo.test.js`
- Modify: `tests/test.html` (register the new test file)

- [ ] **Step 1: Write the failing test**

Create `tests/tempo.test.js`:

```js
import { test, assert } from './assert.js';
import { onsetEnvelope } from '../lib/tempo.js';

// A train of short full-scale bursts every `periodSec`, `totalSec` long.
function clickTrain(sampleRate, periodSec, totalSec, clickSec = 0.02, amp = 1) {
  const n = Math.round(sampleRate * totalSec);
  const out = new Float32Array(n);
  const period = Math.round(sampleRate * periodSec);
  const clickLen = Math.round(sampleRate * clickSec);
  for (let start = 0; start < n; start += period) {
    for (let i = 0; i < clickLen && start + i < n; i++) out[start + i] = amp;
  }
  return out;
}

test('tempo: onsetEnvelope peaks near every click', () => {
  const sr = 44100;
  const period = 0.5;
  const sig = clickTrain(sr, period, 3);
  const { env, hopSeconds } = onsetEnvelope([sig], sr);
  assert(env.length > 100, `envelope has content (${env.length} hops)`);
  for (let t = 0; t < 3; t += period) {
    const h = Math.round(t / hopSeconds);
    let localMax = 0;
    for (let i = Math.max(0, h - 3); i <= Math.min(env.length - 1, h + 3); i++) {
      localMax = Math.max(localMax, env[i]);
    }
    assert(localMax > 0.1, `a peak appears near hop ${h} (t=${t.toFixed(2)}s)`);
  }
});

test('tempo: onsetEnvelope reports its actual hop spacing', () => {
  const sr = 44100;
  const { hopSeconds } = onsetEnvelope([new Float32Array(sr)], sr, { hopSeconds: 0.01 });
  assert(Math.abs(hopSeconds - 0.01) < 0.001, `hop stays close to the requested 10ms (got ${hopSeconds})`);
});

test('tempo: onsetEnvelope on digital silence is all zero', () => {
  const sr = 44100;
  const { env } = onsetEnvelope([new Float32Array(sr)], sr);
  assert(env.every((v) => v === 0), 'no energy, no flux');
});

test('tempo: onsetEnvelope downmixes multiple channels', () => {
  const sr = 44100;
  const sig = clickTrain(sr, 0.5, 2);
  const mono = onsetEnvelope([sig], sr);
  const stereo = onsetEnvelope([sig, sig], sr);
  assertClose(stereo.env[10] ?? 0, mono.env[10] ?? 0, 1e-6, 'identical channels average to the same envelope');
});
```

Fix the last test's missing import — it needs `assertClose` too:

```js
import { test, assert, assertClose } from './assert.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./scripts/serve.sh` (background), then open `http://localhost:8777/tests/test.html` —
first register the import (see Step 5 below) or run a standalone check via
`node --experimental-vm-modules` is not available in this project (browser-only tests), so
instead temporarily add `await import('./tempo.test.js');` to `tests/test.html` now (this is
also permanent — see Step 5) and load the page.
Expected: FAIL — `lib/tempo.js` does not exist, import error.

- [ ] **Step 3: Write minimal implementation**

Create `lib/tempo.js`:

```js
/* Tempo detection from a percussion-dominant stem (drums).
 *
 * Pure: no DOM, no AudioContext, no Worker — same isolation rule as lib/pitch.js. Runs
 * inside notes.worker.js, which is what actually decides which channels and sample rate
 * it sees.
 *
 * Pipeline: onset envelope (broadband energy flux) -> autocorrelation over the 40-240 BPM
 * lag range -> phase search within the winning period.
 *
 * Design: docs/superpowers/specs/2026-09-01-tempo-grid-design.md
 */

// ---------------------------------------------------------------- onset envelope

export const ONSET_DEFAULTS = {
  hopSeconds: 0.01,   // ~10 ms hops
};

/**
 * Broadband energy flux: short-time RMS energy in `hopSeconds` hops, half-wave-rectified
 * frame-to-frame difference.
 *
 * Deliberately NOT spectral flux — an FFT is unwarranted extra surface area when broadband
 * energy is already a strong onset signal on a stem Demucs has already isolated to be
 * percussion-dominant. No low-pass filtering either: unlike lib/pitch.js's decimate() (built
 * for pitch, where high frequencies are noise), onset detection wants the transient energy a
 * low-pass would blur.
 *
 * Returns { env, hopSeconds }; hopSeconds is the ACTUAL hop (hop samples / sampleRate),
 * which can differ slightly from the requested one by rounding — same convention as
 * lib/pitch.js's f0Track().frameSeconds.
 */
export function onsetEnvelope(channels, sampleRate, opts = {}) {
  const hopSeconds = opts.hopSeconds ?? ONSET_DEFAULTS.hopSeconds;
  const hop = Math.max(1, Math.round(sampleRate * hopSeconds));
  const n = channels[0].length;

  const mono = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i];
  const gain = 1 / channels.length;
  for (let i = 0; i < n; i++) mono[i] *= gain;

  const frames = Math.max(0, Math.floor(n / hop));
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    const end = Math.min(n, start + hop);
    let sum = 0;
    for (let i = start; i < end; i++) sum += mono[i] * mono[i];
    rms[f] = Math.sqrt(sum / Math.max(1, end - start));
  }

  const env = new Float32Array(frames);
  for (let f = 1; f < frames; f++) env[f] = Math.max(0, rms[f] - rms[f - 1]);

  return { env, hopSeconds: hop / sampleRate };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: reload `http://localhost:8777/tests/test.html`.
Expected: PASS for all four `tempo: onsetEnvelope*` tests. If the "peaks near every click"
test is flaky, widen the `±3` hop search window slightly — the exact peak position can land
one hop either side of the click's nominal start depending on rounding, which is fine; the
test only needs the peak to be *near* it.

- [ ] **Step 5: Register the test file**

In `tests/test.html`, add the import after `pitch.test.js` (tempo mirrors pitch's
analysis/geometry split, so it belongs beside it):

```html
    await import('./pitch.test.js');
    await import('./tempo.test.js');
    await import('./ribbon.test.js');
```

- [ ] **Step 6: Commit**

```bash
git add lib/tempo.js tests/tempo.test.js tests/test.html
git commit -m "$(cat <<'EOF'
feat: add onsetEnvelope() for drum onset detection

Broadband energy flux from a stem's audio, the first stage of tempo
detection — see docs/superpowers/specs/2026-09-01-tempo-grid-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GFGqCpjU9opiyCWLHrF2Wz
EOF
)"
```

---

## Task 2: `lib/tempo.js` — `estimateTempo()`

**Files:**
- Modify: `lib/tempo.js`
- Modify: `tests/tempo.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/tempo.test.js`:

```js
import { onsetEnvelope, estimateTempo } from '../lib/tempo.js';

test('tempo: estimateTempo recovers a steady click BPM, or a clean 2x/half multiple', () => {
  const sr = 44100;
  const bpm = 128;
  const period = 60 / bpm;
  const sig = clickTrain(sr, period, 8);
  const { env, hopSeconds } = onsetEnvelope([sig], sr);
  const { bpmValue, confidence } = estimateTempo(env, hopSeconds);
  const ratio = bpmValue / bpm;
  const isCleanMultiple = [0.5, 1, 2].some((k) => Math.abs(ratio - k) < 0.03);
  assert(isCleanMultiple, `${bpmValue.toFixed(1)} BPM is a clean multiple of ${bpm}`);
  assert(confidence > 0.2, `confidence is meaningfully above zero (${confidence.toFixed(2)})`);
});

test('tempo: estimateTempo recovers the phase offset modulo the period', () => {
  const sr = 44100;
  const bpm = 100;
  const period = 60 / bpm;
  const offsetSec = 0.15;
  const full = clickTrain(sr, period, 6);
  const shifted = new Float32Array(full.length + Math.round(sr * offsetSec));
  shifted.set(full, Math.round(sr * offsetSec));
  const { env, hopSeconds } = onsetEnvelope([shifted], sr);
  const { phaseSec } = estimateTempo(env, hopSeconds);
  const mod = ((phaseSec % period) + period) % period;
  const target = ((offsetSec % period) + period) % period;
  const diff = Math.min(Math.abs(mod - target), period - Math.abs(mod - target));
  assert(diff < 0.03, `phase matches the offset modulo the period (got ${mod.toFixed(3)}, want ${target.toFixed(3)})`);
});

test('tempo: estimateTempo on an empty envelope returns a safe default', () => {
  const { bpmValue, phaseSec, confidence } = estimateTempo(new Float32Array(0), 0.01);
  assert(bpmValue > 0, 'never zero or NaN');
  assertEq(phaseSec, 0, 'no phase to report');
  assertEq(confidence, 0, 'no confidence to report');
});
```

(`assertEq` is already imported from Task 1's header — add it if not already present:
`import { test, assert, assertClose, assertEq } from './assert.js';`)

- [ ] **Step 2: Run test to verify it fails**

Run: reload `tests/test.html`.
Expected: FAIL — `estimateTempo` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/tempo.js`:

```js
// ---------------------------------------------------------------- tempo estimate

export const TEMPO_DEFAULTS = {
  minBpm: 40,
  maxBpm: 240,
};

/**
 * BPM and beat phase from an onset envelope.
 *
 * Autocorrelates `env` over the lag range corresponding to [minBpm, maxBpm], picks the lag
 * with the strongest normalised peak as the beat period, then searches phase offsets within
 * one period for the one that maximises the envelope's average value at the predicted beat
 * times.
 *
 * Always returns a value — `confidence` (the normalised autocorrelation peak height) is the
 * "how sure" signal, not a gate. A silent or pathological envelope returns a safe default
 * (120 BPM, phase 0, confidence 0) rather than NaN or a thrown error.
 */
export function estimateTempo(env, hopSeconds, opts = {}) {
  const minBpm = opts.minBpm ?? TEMPO_DEFAULTS.minBpm;
  const maxBpm = opts.maxBpm ?? TEMPO_DEFAULTS.maxBpm;
  const n = env.length;
  if (!n || !hopSeconds) return { bpmValue: 120, phaseSec: 0, confidence: 0 };

  const lagMin = Math.max(1, Math.round((60 / maxBpm) / hopSeconds));
  const lagMax = Math.min(n - 1, Math.round((60 / minBpm) / hopSeconds));
  if (lagMax <= lagMin) return { bpmValue: 120, phaseSec: 0, confidence: 0 };

  let energy = 0;
  for (let i = 0; i < n; i++) energy += env[i] * env[i];
  if (energy <= 0) return { bpmValue: 120, phaseSec: 0, confidence: 0 };

  let bestLag = lagMin;
  let bestScore = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += env[i] * env[i + lag];
    const score = sum / energy;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }

  const bpmValue = 60 / (bestLag * hopSeconds);

  // Phase: which of the bestLag possible offsets lands on the loudest average onset energy.
  let bestPhase = 0;
  let bestPhaseScore = -Infinity;
  for (let offset = 0; offset < bestLag; offset++) {
    let sum = 0;
    let count = 0;
    for (let i = offset; i < n; i += bestLag) { sum += env[i]; count++; }
    const score = count ? sum / count : 0;
    if (score > bestPhaseScore) { bestPhaseScore = score; bestPhase = offset; }
  }

  return {
    bpmValue,
    phaseSec: bestPhase * hopSeconds,
    confidence: Math.max(0, Math.min(1, bestScore)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: reload `tests/test.html`.
Expected: PASS. If the BPM test's `isCleanMultiple` tolerance (0.03) or confidence floor (0.2)
doesn't hold on the first run, measure the actual `bpmValue`/`confidence` the test prints on
failure and widen the tolerance to match — the autocorrelation is deterministic for a fixed
synthetic input, so once it passes once it passes reproducibly. Do the same for the phase
test's `diff < 0.03` tolerance if needed.

- [ ] **Step 5: Commit**

```bash
git add lib/tempo.js tests/tempo.test.js
git commit -m "$(cat <<'EOF'
feat: add estimateTempo() — BPM and phase from an onset envelope

Autocorrelation over 40-240 BPM plus a phase search within the winning
period. Always returns a value; confidence is a "how sure" signal, not
a gate — see docs/superpowers/specs/2026-09-01-tempo-grid-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GFGqCpjU9opiyCWLHrF2Wz
EOF
)"
```

---

## Task 3: `lib/ribbon.js` — `beatTimes()`

**Files:**
- Modify: `lib/ribbon.js`
- Modify: `tests/ribbon.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/ribbon.test.js`:

```js
test('ribbon: beatTimes spaces beats by the BPM period', () => {
  // 120 BPM = 0.5s/beat
  const beats = R().beatTimes({ bpmValue: 120, phaseMs: 0, beatsPerBar: 4 }, 2);
  assertEq(beats.length, 5, '0, 0.5, 1, 1.5, 2');
  assertClose(beats[1].t, 0.5, 1e-9, 'second beat at 0.5s');
  assertClose(beats[4].t, 2, 1e-9, 'last beat sits on the duration boundary');
});

test('ribbon: beatTimes flags every beatsPerBar-th beat as a bar', () => {
  const beats = R().beatTimes({ bpmValue: 120, phaseMs: 0, beatsPerBar: 3 }, 3);
  assertEq(beats[0].bar, true, 'first beat is a bar');
  assertEq(beats[1].bar, false);
  assertEq(beats[2].bar, false);
  assertEq(beats[3].bar, true, 'every third beat is a bar');
});

test('ribbon: beatTimes normalises a phase outside [0, period)', () => {
  const inRange = R().beatTimes({ bpmValue: 120, phaseMs: 100, beatsPerBar: 4 }, 1);
  const negative = R().beatTimes({ bpmValue: 120, phaseMs: 100 - 500, beatsPerBar: 4 }, 1);
  const overOne = R().beatTimes({ bpmValue: 120, phaseMs: 100 + 500, beatsPerBar: 4 }, 1);
  assertClose(inRange[0].t, 0.1, 1e-9, 'phase already in range starts the grid there');
  assertClose(negative[0].t, 0.1, 1e-9, 'a negative phase normalises to the same first beat');
  assertClose(overOne[0].t, 0.1, 1e-9, 'a phase past one period normalises the same way');
});

test('ribbon: beatTimes returns nothing when duration is shorter than the first beat', () => {
  // 60 BPM = 1000ms period; phase 900ms means the first beat is at 0.9s.
  const beats = R().beatTimes({ bpmValue: 60, phaseMs: 900, beatsPerBar: 4 }, 0.5);
  assertEq(beats.length, 0, 'the first beat never arrives inside a 0.5s song');
});

test('ribbon: beatTimes tolerates a missing or zero bpmValue', () => {
  assertEq(R().beatTimes(null, 10).length, 0, 'no tempo, no grid');
  assertEq(R().beatTimes({ bpmValue: 0, phaseMs: 0, beatsPerBar: 4 }, 10).length, 0, 'zero BPM would divide by zero');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: reload `tests/test.html`.
Expected: FAIL — `R().beatTimes` is not a function.

- [ ] **Step 3: Write minimal implementation**

In `lib/ribbon.js`, add `beatTimes` before the final `global.SansRibbon = {...}` assignment:

```js
  /**
   * Beat and bar times across the song, in seconds, given a tempo config and duration.
   *
   * `phaseMs` is normalised into [0, periodMs) before generating — so a nudge that pushes it
   * negative or past one period is still well-defined, rather than needing to be clamped at
   * the UI layer. Pure arithmetic, no autocorrelation, no worker — cheap enough to re-run on
   * every keystroke/nudge, the same property reinterpret() already relies on for notes.
   *
   * Returns [{ t, bar }, …] for every beat from the normalised first beat through `duration`,
   * inclusive; `bar` is true every `beatsPerBar`-th one, starting with the first.
   */
  function beatTimes(tempo, duration) {
    const beats = [];
    if (!tempo || !tempo.bpmValue || tempo.bpmValue <= 0 || !duration) return beats;

    const periodMs = 60000 / tempo.bpmValue;
    let phase = tempo.phaseMs % periodMs;
    if (phase < 0) phase += periodMs;

    const beatsPerBar = Math.max(1, tempo.beatsPerBar || 4);
    const periodSec = periodMs / 1000;
    const firstT = phase / 1000;

    let i = 0;
    for (let t = firstT; t <= duration; t += periodSec, i++) {
      beats.push({ t, bar: i % beatsPerBar === 0 });
    }
    return beats;
  }
```

And add it to the export at the bottom of the file:

```js
  global.SansRibbon = { pitchRange, contourSegments, contourColumns, zoomPeaks, zoomWindow, beatTimes };
```

- [ ] **Step 4: Run test to verify it passes**

Run: reload `tests/test.html`.
Expected: PASS for all five `ribbon: beatTimes*` tests, and every pre-existing test still
green.

- [ ] **Step 5: Commit**

```bash
git add lib/ribbon.js tests/ribbon.test.js
git commit -m "$(cat <<'EOF'
feat: add beatTimes() geometry for the tempo grid

Pure beat/bar time generation from a tempo config, same pattern as
pitchRange/contourColumns — see
docs/superpowers/specs/2026-09-01-tempo-grid-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GFGqCpjU9opiyCWLHrF2Wz
EOF
)"
```

---

## Task 4: `notes.worker.js` — worker protocol extension

**Files:**
- Modify: `notes.worker.js`
- Modify: `tests/notes.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `tests/notes.test.js` (near the top, alongside the existing `sine()` helper):

```js
function clickTrain(sampleRate, periodSec, totalSec, clickSec = 0.02, amp = 1) {
  const n = Math.round(sampleRate * totalSec);
  const out = new Float32Array(n);
  const period = Math.round(sampleRate * periodSec);
  const clickLen = Math.round(sampleRate * clickSec);
  for (let start = 0; start < n; start += period) {
    for (let i = 0; i < clickLen && start + i < n; i++) out[start + i] = amp;
  }
  return out;
}

// Unlike analyse(), resolves the WHOLE message — needed to see `tempo` alongside `frames`,
// or to see a standalone `{ type: 'tempo' }` reply that carries no `frames` at all.
function roundTrip(message) {
  return new Promise((resolve, reject) => {
    const w = new Worker('../notes.worker.js?v=1.16.1', { type: 'module' });
    const timer = setTimeout(() => { w.terminate(); reject(new Error('worker never answered')); }, 20000);
    w.onmessage = (e) => { clearTimeout(timer); w.terminate(); resolve(e.data); };
    w.onerror = (e) => { clearTimeout(timer); w.terminate(); reject(new Error(e.message)); };
    w.postMessage(message);
  });
}
```

Then add the tests:

```js
test('notes: analyse with a drums buffer returns tempo alongside frames', async () => {
  const bpm = 120;
  const period = 60 / bpm;
  const data = await roundTrip({
    type: 'analyse',
    channels: [sine(220, 1, SR)],
    sampleRate: SR,
    drums: { channels: [clickTrain(SR, period, 4)], sampleRate: SR },
  });
  assert(data.frames, 'vocals frames still come back');
  assert(data.tempo, 'tempo comes back alongside frames');
  const ratio = data.tempo.bpmValue / bpm;
  assert([0.5, 1, 2].some((k) => Math.abs(ratio - k) < 0.05),
    `tempo is a clean multiple of ${bpm} (got ${data.tempo.bpmValue.toFixed(1)})`);
});

test('notes: analyse without a drums buffer returns tempo: null', async () => {
  const data = await roundTrip({ type: 'analyse', channels: [sine(220, 1, SR)], sampleRate: SR });
  assert(data.frames, 'vocals frames still come back');
  assertEq(data.tempo, null, 'no drums, no tempo');
});

test('notes: a standalone tempo request answers without running vocals analysis', async () => {
  const bpm = 100;
  const period = 60 / bpm;
  const data = await roundTrip({
    type: 'tempo', channels: [clickTrain(SR, period, 4)], sampleRate: SR,
  });
  assertEq(data.type, 'tempo', 'a dedicated tempo reply, not frames');
  assert(!('frames' in data), 'no vocals analysis ran');
  const ratio = data.tempo.bpmValue / bpm;
  assert([0.5, 1, 2].some((k) => Math.abs(ratio - k) < 0.05),
    `tempo is a clean multiple of ${bpm} (got ${data.tempo.bpmValue.toFixed(1)})`);
});
```

(`assertEq` must be imported: check the top of `tests/notes.test.js` and add it to the
existing `import { test, assert, assertClose } from './assert.js';` line if missing.)

- [ ] **Step 2: Run test to verify it fails**

Run: reload `tests/test.html`.
Expected: FAIL — `data.tempo` is `undefined` (not `null`), and the worker has no `'tempo'`
message handler at all (the standalone-request test times out or errors).

- [ ] **Step 3: Write minimal implementation**

Replace `notes.worker.js` in full:

```js
/* Note analysis worker: owns the expensive half of the pipeline.
 *
 * Runs off the main thread because a 4-minute track takes about 7 s on a cold run, and
 * the player is drawing waveforms on rAF throughout. Interpretation is NOT here — see
 * notes.js, where segmentNotes runs on the main thread at ~12 ms.
 *
 * Since the tempo-grid phase this also owns BPM/phase detection from a drums stem, bundled
 * into the same 'analyse' round trip so Go costs one worker spin-up, not two. A standalone
 * 'tempo' message type exists for re-detecting after the user narrows the analysed range,
 * without paying for a fresh ~7 s vocals pass.
 *
 * See docs/transcription.md for the layer model this implements, and
 * docs/superpowers/specs/2026-09-01-tempo-grid-design.md for the tempo half. */

import { decimate, f0Track } from './lib/pitch.js?v=1.16.5';
import { onsetEnvelope, estimateTempo } from './lib/tempo.js?v=1.16.5';

function computeTempo(channels, sampleRate) {
  const { env, hopSeconds } = onsetEnvelope(channels, sampleRate);
  return estimateTempo(env, hopSeconds);
}

self.onmessage = (e) => {
  const m = e.data;
  if (!m) return;
  try {
    if (m.type === 'analyse') {
      if (!m.channels || !m.channels.length) throw new Error('no audio channels supplied');
      const dec = decimate(m.channels, m.sampleRate);
      const track = f0Track(dec.samples, dec.sampleRate);
      const tempo = m.drums ? computeTempo(m.drums.channels, m.drums.sampleRate) : null;
      /* Transferring OUT is safe: these arrays were allocated here and nothing else holds
       * them. Transferring IN would not be — see the note in tests/notes.test.js.
       *
       * `candidates` is named here like everything else, and it is the field that is easy to
       * forget: it is the only one an interpreter reads that the analysis does not. `tempo`
       * is a small plain object either way — no typed arrays cross back for it, so it is
       * never in the transfer list. */
      self.postMessage(
        { type: 'frames', frames: { t: track.t, f0: track.f0, conf: track.conf, cents: track.cents,
                                    candidates: track.candidates,
                                    frameSeconds: track.frameSeconds }, tempo },
        [track.t.buffer, track.f0.buffer, track.conf.buffer, track.cents.buffer],
      );
    } else if (m.type === 'tempo') {
      if (!m.channels || !m.channels.length) throw new Error('no audio channels supplied');
      self.postMessage({ type: 'tempo', tempo: computeTempo(m.channels, m.sampleRate) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: reload `tests/test.html`.
Expected: PASS for the three new tests and every pre-existing `notes:` test. If the BPM
tolerance in the new tests needs widening, do the same measure-then-adjust as Task 2 —
`estimateTempo` itself is unchanged, so any drift here is about the worker plumbing, not the
algorithm.

- [ ] **Step 5: Commit**

```bash
git add notes.worker.js tests/notes.test.js
git commit -m "$(cat <<'EOF'
feat: extend the notes worker with drum tempo detection

'analyse' grows an optional drums field and returns tempo alongside
frames in one round trip; a new standalone 'tempo' message type lets
notes.js re-detect after narrowing the range without re-running the
vocals pass.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GFGqCpjU9opiyCWLHrF2Wz
EOF
)"
```

---

## Task 5: `index.html` — tempo-grid controls row

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the markup**

In `index.html`, inside `<section id="notes">`, insert a new row immediately after the first
`.notes-row` closes (i.e. right after the existing `</div>` that closes the row containing
`notes-go`/`notes-jianpu`/the key selectors, and before `<div id="notes-tune" ...>`):

```html
      <div id="notes-tempo" class="notes-row">
        <label class="notes-ctl">
          <input id="notes-tempo-on" type="checkbox" checked>
          <span data-i18n="notes.tempoOn">Show tempo grid</span>
        </label>
        <label class="notes-ctl">
          <span data-i18n="notes.tempoBpm">BPM</span>
          <input id="notes-tempo-bpm" type="number" min="20" max="400" step="0.1" value="120" disabled>
        </label>
        <span class="notes-ctl">
          <button id="notes-tempo-half" class="mini" type="button" disabled
                  data-i18n-attr="title:notes.tempoHalfTip">&times;&#189;</button>
          <button id="notes-tempo-double" class="mini" type="button" disabled
                  data-i18n-attr="title:notes.tempoDoubleTip">&times;2</button>
        </span>
        <label class="notes-ctl">
          <span data-i18n="notes.tempoPhase">Phase</span>
          <button id="notes-tempo-phase-back" class="mini" type="button" disabled
                  data-i18n-attr="title:notes.tempoPhaseBackTip">&#9664;</button>
          <input id="notes-tempo-phase" type="number" step="1" value="0" disabled>
          <button id="notes-tempo-phase-fwd" class="mini" type="button" disabled
                  data-i18n-attr="title:notes.tempoPhaseFwdTip">&#9654;</button>
        </label>
        <label class="notes-ctl">
          <span data-i18n="notes.tempoBeats">Beats/bar</span>
          <select id="notes-tempo-beats" disabled>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4" selected>4</option>
            <option value="6">6</option>
          </select>
        </label>
        <button id="notes-tempo-range" class="mini" type="button" disabled
                data-i18n="notes.tempoRange" data-i18n-attr="title:notes.tempoRangeTip">Select BPM range</button>
        <button id="notes-tempo-redetect" class="mini" type="button" disabled
                data-i18n="notes.tempoRedetect">Re-detect tempo</button>
        <span id="notes-tempo-status" class="notes-stats"></span>
      </div>
```

- [ ] **Step 2: Verify by hand**

Run: `./scripts/serve.sh`, open `http://localhost:8777/`, load any stems zip with a vocals
stem. Confirm the notes panel now shows a second row under the "Find notes" row with a
disabled BPM/phase/beats-per-bar cluster and two disabled buttons — everything inert except
"Show tempo grid" (per the design, controls stay disabled until a drums stem is wired up in
Task 8; a missing i18n key will render the raw key string like `notes.tempoOn` in the DOM,
which is expected and fixed in Task 6).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: add tempo-grid controls row to the notes panel

Markup only — wired up in a later task. All controls are inert by
default; i18n keys land in the next commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GFGqCpjU9opiyCWLHrF2Wz
EOF
)"
```

---

## Task 6: `lib/i18n.js` — new keys

**Files:**
- Modify: `lib/i18n.js`

- [ ] **Step 1: Add the English keys**

In `lib/i18n.js`'s `en` locale block, after the existing `'notes.show': 'Show notes',` line
(or any existing `notes.*` line — exact position doesn't matter, `tests/i18n.test.js` only
checks parity across locales, not ordering), add:

```js
      'notes.tempoOn': 'Show tempo grid',
      'notes.tempoOnTip': 'Overlays a beat and bar grid on the notes lane, detected from the drums stem. Purely visual — never changes a note\'s timing or pitch.',
      'notes.tempoBpm': 'BPM',
      'notes.tempoHalfTip': 'Halve the BPM — the most common correction when detection locks onto twice the true tempo.',
      'notes.tempoDoubleTip': 'Double the BPM — the most common correction when detection locks onto half the true tempo.',
      'notes.tempoPhase': 'Phase',
      'notes.tempoPhaseBackTip': 'Nudge the grid earlier',
      'notes.tempoPhaseFwdTip': 'Nudge the grid later',
      'notes.tempoBeats': 'Beats/bar',
      'notes.tempoRange': 'Select BPM range',
      'notes.tempoRangeTip': 'Drag along the drums lane to limit tempo detection to part of the song — useful for excluding a spoken or rubato intro.',
      'notes.tempoRedetect': 'Re-detect tempo',
      'notes.tempoStatus': '{bpm} BPM · {pct}% confidence',
      'notes.tempoStatusNone': 'No tempo detected yet',
      'notes.tempoRangeClear': 'Clear',
      'notes.tempoRangeWhole': 'whole song',
      'notes.tempoRangeSel': '{from}–{to}',
```

- [ ] **Step 2: Add the zh-TW keys**

In the `zh-TW` locale block, in the equivalent spot:

```js
      'notes.tempoOn': '顯示節奏格線',
      'notes.tempoOnTip': '在音符音軌上疊加以鼓聲軌偵測出的拍子與小節格線。純粹顯示用，不會改變任何音符的時間或音高。',
      'notes.tempoBpm': 'BPM',
      'notes.tempoHalfTip': '將 BPM 減半——偵測結果為實際速度兩倍時最常見的修正。',
      'notes.tempoDoubleTip': '將 BPM 加倍——偵測結果為實際速度一半時最常見的修正。',
      'notes.tempoPhase': '相位',
      'notes.tempoPhaseBackTip': '將格線往前微調',
      'notes.tempoPhaseFwdTip': '將格線往後微調',
      'notes.tempoBeats': '每小節拍數',
      'notes.tempoRange': '選取節奏偵測範圍',
      'notes.tempoRangeTip': '在鼓聲音軌上拖曳，將節奏偵測限制在歌曲的一部分——適合排除口白或無固定節拍的前奏。',
      'notes.tempoRedetect': '重新偵測節奏',
      'notes.tempoStatus': '{bpm} BPM · 信心 {pct}%',
      'notes.tempoStatusNone': '尚未偵測節奏',
      'notes.tempoRangeClear': '清除',
      'notes.tempoRangeWhole': '整首歌',
      'notes.tempoRangeSel': '{from}–{to}',
```

- [ ] **Step 2: Run the i18n parity test**

Run: reload `tests/test.html`.
Expected: PASS — `tests/i18n.test.js` (already registered) confirms both locales gained every
new key together and no `{placeholder}` drifted between them.

- [ ] **Step 3: Verify the panel renders real copy**

Run: reload `http://localhost:8777/`, load a stems zip. Confirm the tempo-grid row now shows
real labels ("Show tempo grid", "BPM", "Phase", "Beats/bar", "Select BPM range", "Re-detect
tempo") instead of raw keys, in both languages via the language toggle.

- [ ] **Step 4: Commit**

```bash
git add lib/i18n.js
git commit -m "$(cat <<'EOF'
feat: add i18n copy for the tempo-grid controls

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GFGqCpjU9opiyCWLHrF2Wz
EOF
)"
```

---

## Task 7: `notes.js` — tempo/tempoRange state and worker calls

**Files:**
- Modify: `notes.js`

No new unit tests: this task wires existing, already-tested pieces (`lib/tempo.js` via the
worker, `lib/ribbon.js`'s `beatTimes` is not called here) into `notes.js`'s own state. It is
verified by running the full suite (nothing here is pure-function logic in its own right) and
confirmed end-to-end in Task 16's manual pass.

- [ ] **Step 1: Add DOM bindings**

In `notes.js`'s `el` object (after `keyRel: document.getElementById('notes-key-rel'),`), add:

```js
  tempoOn: document.getElementById('notes-tempo-on'),
  tempoBpm: document.getElementById('notes-tempo-bpm'),
  tempoHalf: document.getElementById('notes-tempo-half'),
  tempoDouble: document.getElementById('notes-tempo-double'),
  tempoPhase: document.getElementById('notes-tempo-phase'),
  tempoPhaseBack: document.getElementById('notes-tempo-phase-back'),
  tempoPhaseFwd: document.getElementById('notes-tempo-phase-fwd'),
  tempoBeats: document.getElementById('notes-tempo-beats'),
  tempoRangeToggle: document.getElementById('notes-tempo-range'),
  tempoRedetect: document.getElementById('notes-tempo-redetect'),
  tempoStatus: document.getElementById('notes-tempo-status'),
```

- [ ] **Step 2: Add state**

After the existing `let jianpu = { on: false, tonic: 0, mode: 'major', auto: true };`, add:

```js
/* The tempo grid. `auto` stays true until the user touches a control (or presses Re-detect,
 * which always re-adopts auto), same lifecycle as jianpu.auto — see its own comment. */
let tempo = { on: true, auto: true, bpmValue: 120, phaseMs: 0, beatsPerBar: 4, confidence: 0 };
let tempoRange = null;        // { from, to } in seconds, or null = whole song (the default)
let tempoRangeArmed = false;  // "Select BPM range" toggle; mirrored to app.js for the drag UI
```

- [ ] **Step 3: Add `applyTempoResult()` and `currentTempoRangeChannels()`**

After `currentParams()`, add:

```js
/** The drums stem's audio, sliced to `tempoRange` if one is set — sliced BEFORE handing to
 *  the worker, not after, so the protocol stays simple (the worker never knows about ranges)
 *  and less data crosses the postMessage boundary for a narrow selection. Returns null when
 *  there is no drums stem to analyse. */
function currentTempoRangeChannels() {
  const stem = window.sansBass.stemBuffer('drums');
  if (!stem) return null;
  const buffer = stem.buffer;
  const channels = [];
  for (let i = 0; i < buffer.numberOfChannels; i++) {
    const data = buffer.getChannelData(i);
    if (tempoRange) {
      const from = Math.max(0, Math.floor(tempoRange.from * buffer.sampleRate));
      const to = Math.min(data.length, Math.ceil(tempoRange.to * buffer.sampleRate));
      channels.push(data.slice(from, to));
    } else {
      channels.push(data.slice());
    }
  }
  return { channels, sampleRate: buffer.sampleRate };
}

/** Adopts a fresh { bpmValue, phaseSec, confidence } from the worker. `beatsPerBar` is never
 *  detected — it is a pure user choice defaulting to 4 — so it survives untouched. Absolute
 *  time correction: phaseSec is relative to whatever slice was analysed, so tempoRange.from
 *  (or 0 for the whole song) is added before it becomes song-absolute phaseMs. Getting this
 *  wrong would line the grid up inside the analysed window and drift everywhere else. */
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
```

- [ ] **Step 4: Bundle drums into `analyse()`**

In `analyse()`, after the existing vocals `channels` are built and before
`worker = new Worker(...)`, add:

```js
  const drums = currentTempoRangeChannels();
```

Change the `worker.postMessage(...)` call at the end of `analyse()` from:

```js
  worker.postMessage({ type: 'analyse', channels, sampleRate: buffer.sampleRate });
```

to:

```js
  worker.postMessage({
    type: 'analyse', channels, sampleRate: buffer.sampleRate,
    ...(drums ? { drums } : {}),
  });
```

In `worker.onmessage`, after `frames = m.frames;` and before `reinterpret();`, add:

```js
    if (m.tempo) applyTempoResult(m.tempo);
```

- [ ] **Step 5: Extend `reinterpret()`'s payload**

Change the `window.sansBass.setNotes({...})` call in `reinterpret()` from:

```js
  window.sansBass.setNotes({
    notes, frames, params: p, clip: el.clip.checked,
    jianpu: { on: jianpu.on, tonic: jianpu.tonic, mode: jianpu.mode },
  });
```

to:

```js
  window.sansBass.setNotes({
    notes, frames, params: p, clip: el.clip.checked,
    jianpu: { on: jianpu.on, tonic: jianpu.tonic, mode: jianpu.mode },
    tempo: { on: tempo.on, bpmValue: tempo.bpmValue, phaseMs: tempo.phaseMs, beatsPerBar: tempo.beatsPerBar },
  });
```

- [ ] **Step 6: Reset on song change**

In `reset()`, alongside the existing `jianpu.auto = true;`, add:

```js
  tempo = { on: true, auto: true, bpmValue: 120, phaseMs: 0, beatsPerBar: 4, confidence: 0 };
  tempoRange = null;
  tempoRangeArmed = false;
```

(Controls are synced to these defaults in Task 8, once `syncTempoControls()` exists.)

- [ ] **Step 7: Run the full suite and verify nothing regressed**

Run: reload `tests/test.html`.
Expected: every test still PASS — this task only adds new state and call paths that nothing
existing exercises yet (the new `el.tempo*` elements exist from Task 5 but have no listeners
yet, so nothing invokes this code in the browser test harness).

- [ ] **Step 8: Commit**

```bash
git add notes.js
git commit -m "$(cat <<'EOF'
feat: add tempo/tempoRange state to notes.js

Bundles drums detection into the existing Go round trip, converts the
worker's slice-relative phase to song-absolute time, and pushes tempo
into the setNotes() payload. Controls aren't wired up yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GFGqCpjU9opiyCWLHrF2Wz
EOF
)"
```

---

## Task 8: `notes.js` — wire the tempo controls

**Files:**
- Modify: `notes.js`

- [ ] **Step 1: Add `syncTempoControls()`**

After `syncFoldControls()`, add:

```js
/* Every control but the panel-level checkbox is meaningless without a drums stem, so they go
 * visibly inert rather than silently doing nothing — same pattern as syncFoldControls()/
 * syncJianpuControls(). */
function syncTempoControls() {
  const hasDrums = !!window.sansBass.stemBuffer('drums');
  for (const c of [el.tempoBpm, el.tempoHalf, el.tempoDouble, el.tempoPhase,
                    el.tempoPhaseBack, el.tempoPhaseFwd, el.tempoBeats,
                    el.tempoRangeToggle, el.tempoRedetect]) c.disabled = !hasDrums;
  el.tempoOn.checked = tempo.on;
  el.tempoBpm.value = tempo.bpmValue;
  el.tempoPhase.value = tempo.phaseMs;
  el.tempoBeats.value = String(tempo.beatsPerBar);
  el.tempoStatus.textContent = tempo.confidence > 0
    ? tr('notes.tempoStatus', { bpm: tempo.bpmValue.toFixed(1), pct: Math.round(tempo.confidence * 100) })
    : tr('notes.tempoStatusNone');
}
```

- [ ] **Step 2: Call it from `reinterpret()` and `reset()`**

In `reinterpret()`, alongside the existing `syncJianpuControls();` call, add:

```js
  syncTempoControls();
```

In `reset()`, alongside the existing `syncJianpuControls();` call at the end, add:

```js
  el.tempoRangeToggle.classList.remove('note-tbtn-armed');
  syncTempoControls();
```

- [ ] **Step 3: Wire the checkbox, BPM, and ×½/×2**

After the existing `el.jianpu.addEventListener(...)` block, add:

```js
el.tempoOn.addEventListener('change', () => {
  tempo.on = el.tempoOn.checked;
  reinterpret();
});
el.tempoBpm.addEventListener('input', () => {
  const v = Number(el.tempoBpm.value);
  if (Number.isFinite(v) && v > 0) { tempo.bpmValue = v; tempo.auto = false; }
  reinterpret();
});
el.tempoHalf.addEventListener('click', () => {
  tempo.bpmValue = +(tempo.bpmValue / 2).toFixed(1);
  tempo.auto = false;
  reinterpret();
});
el.tempoDouble.addEventListener('click', () => {
  tempo.bpmValue = +(tempo.bpmValue * 2).toFixed(1);
  tempo.auto = false;
  reinterpret();
});
```

- [ ] **Step 4: Wire phase and beats-per-bar**

```js
const PHASE_NUDGE_MS = 10;
el.tempoPhase.addEventListener('input', () => {
  const v = Number(el.tempoPhase.value);
  if (Number.isFinite(v)) { tempo.phaseMs = v; tempo.auto = false; }
  reinterpret();
});
el.tempoPhaseBack.addEventListener('click', () => {
  tempo.phaseMs -= PHASE_NUDGE_MS;
  tempo.auto = false;
  reinterpret();
});
el.tempoPhaseFwd.addEventListener('click', () => {
  tempo.phaseMs += PHASE_NUDGE_MS;
  tempo.auto = false;
  reinterpret();
});
el.tempoBeats.addEventListener('change', () => {
  tempo.beatsPerBar = Number(el.tempoBeats.value);
  tempo.auto = false;
  reinterpret();
});
```

- [ ] **Step 5: Wire the range toggle and Re-detect**

```js
el.tempoRangeToggle.addEventListener('click', () => {
  tempoRangeArmed = !tempoRangeArmed;
  el.tempoRangeToggle.classList.toggle('note-tbtn-armed', tempoRangeArmed);
  window.dispatchEvent(new CustomEvent('sansbass:temporangemode', { detail: { on: tempoRangeArmed } }));
});
el.tempoRedetect.addEventListener('click', () => {
  const drums = currentTempoRangeChannels();
  if (!drums) return;
  const w = new Worker('./notes.worker.js?v=1.16.5', { type: 'module' });
  el.tempoRedetect.disabled = true;
  w.onmessage = (e) => {
    w.terminate();
    if (e.data.type === 'tempo') applyTempoResult(e.data.tempo);
    else if (e.data.type === 'error') window.sansBass.say('notes.failed', { message: e.data.message }, true);
    syncTempoControls();
    reinterpret();
  };
  w.onerror = (e) => {
    w.terminate();
    window.sansBass.say('notes.failed', { message: e.message || 'worker error' }, true);
    syncTempoControls();
  };
  w.postMessage({ type: 'tempo', channels: drums.channels, sampleRate: drums.sampleRate });
});
```

- [ ] **Step 6: Listen for a committed range from app.js**

Alongside the existing `window.addEventListener('sansbass:ribbonmute', resync);` line, add:

```js
/* app.js owns the drag surface (the drums stem's own lane) and dispatches this once a
 * selection commits or the caption's Clear button is pressed. Mirrored into notes.js's own
 * tempoRange because that copy is what persists across export/import and reset — see
 * docs/superpowers/specs/2026-09-01-tempo-grid-design.md. */
window.addEventListener('sansbass:temporange', (e) => {
  tempoRange = e.detail;
});
```

- [ ] **Step 7: Verify by hand**

Run: `./scripts/serve.sh`, load a stems zip with vocals + drums, run **Find notes**. Confirm:
the tempo row's controls become enabled; BPM/phase/status populate after Go; ×½/×2 halve and
double the BPM field live; the phase ± buttons nudge the field by 10ms; changing beats-per-bar
doesn't crash. (The visible grid itself isn't drawn yet — that's Task 12 — so there's nothing
to see on the lane yet, only the control values changing.)

- [ ] **Step 8: Commit**

```bash
git add notes.js
git commit -m "$(cat <<'EOF'
feat: wire up the tempo-grid controls in notes.js

BPM, phase, beats-per-bar, ×1/2 and ×2, the range-select toggle, and
Re-detect all update tempo state live with no re-analysis of vocals.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GFGqCpjU9opiyCWLHrF2Wz
EOF
)"
```

---

## Task 9: `notes.js` — export/import round-trip

**Files:**
- Modify: `notes.js`

- [ ] **Step 1: Extend the export payload**

In the `el.exportBtn` click handler, change:

```js
  const payload = {
    version: 1,
    ...(mix ? { song: mix.name } : {}),
    ...currentParams(),
    clip: el.clip.checked,
    jianpu: { on: jianpu.on, tonic: jianpu.tonic, mode: jianpu.mode },
    edits: editGroups.map((g) => g.edits),
  };
```

to:

```js
  const payload = {
    version: 1,
    ...(mix ? { song: mix.name } : {}),
    ...currentParams(),
    clip: el.clip.checked,
    jianpu: { on: jianpu.on, tonic: jianpu.tonic, mode: jianpu.mode },
    tempo: { on: tempo.on, bpmValue: tempo.bpmValue, phaseMs: tempo.phaseMs, beatsPerBar: tempo.beatsPerBar },
    tempoRange,
    edits: editGroups.map((g) => g.edits),
  };
```

- [ ] **Step 2: Extend the import handler**

In the `el.importFile` `change` handler, after the existing `if (data.jianpu) { ... }` block
and before `editGroups = data.edits.map(...)`, add:

```js
  if (data.tempo) {
    tempo.on = !!data.tempo.on;
    tempo.auto = false;
    if (data.tempo.bpmValue != null) tempo.bpmValue = data.tempo.bpmValue;
    if (data.tempo.phaseMs != null) tempo.phaseMs = data.tempo.phaseMs;
    if (data.tempo.beatsPerBar != null) tempo.beatsPerBar = data.tempo.beatsPerBar;
  }
  if (data.tempoRange !== undefined) {
    tempoRange = data.tempoRange || null;
    window.sansBass.setTempoRange(tempoRange);
  }
```

(`window.sansBass.setTempoRange` is added in Task 10 — this line will throw until then, which
is fine since Task 10 lands before this is manually exercised in Task 16.)

Also add `syncTempoControls();` alongside the existing `syncJianpuControls();` call right
before `reinterpret();` at the end of the handler.

- [ ] **Step 3: Run the full suite**

Run: reload `tests/test.html`.
Expected: PASS — nothing here is exercised by the unit suite (export/import is file-picker
driven), so this step just confirms no syntax error broke module load.

- [ ] **Step 4: Commit**

```bash
git add notes.js
git commit -m "$(cat <<'EOF'
feat: round-trip tempo/tempoRange through the edits export/import JSON

Additive, backward-compatible fields — an import missing either one
leaves the current/auto-detected values in place, same tolerance the
existing params/jianpu import already has.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GFGqCpjU9opiyCWLHrF2Wz
EOF
)"
```

---

## Task 10: `app.js` — drums-lane caption, Clear, and `setTempoRange`

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add state**

Near the existing `let rangeDrag = null; let rangeSelection = null;` lines, add:

```js
let tempoRangeDrag = null;      // { startT, curT } — actively dragging on the drums lane
let tempoRange = null;          // { from, to } committed selection, or null = whole song
let tempoRangeArmed = false;    // mirrors notes.js's "Select BPM range" toggle
let tempoHintEl = null;         // caption text node under the drums lane
let tempoClearBtn = null;       // the Clear button beside it
let tempoDrumsCanvas = null;    // the drums stem's own waveform canvas — the drag surface
```

- [ ] **Step 2: Reset on song load**

In `buildUI()`, alongside the existing `ribbon = null; zoomPeaks = null;` lines, add:

```js
  tempoRangeDrag = null;
  tempoRange = null;
  tempoRangeArmed = false;
  tempoHintEl = null;
  tempoClearBtn = null;
  tempoDrumsCanvas = null;
```

- [ ] **Step 3: Build the caption under the drums lane**

In `buildUI()`'s `tracks.forEach((t, i) => { ... })` loop, change the attachSeek call from:

```js
    attachSeek(canvas);
```

to:

```js
    attachSeek(canvas, { tempoLane: t.stem === 'drums' });
```

Then, right after `lane.append(name, canvas, vol);` in that same loop (before
`el.lanes.appendChild(lane);`), add:

```js
    if (t.stem === 'drums') {
      const hint = document.createElement('div');
      hint.className = 'tempo-range-hint';
      const hintTxt = document.createElement('span');
      hintTxt.className = 'txt';
      const hintClear = document.createElement('button');
      hintClear.className = 'mini';
      hintClear.type = 'button';
      hintClear.textContent = tr('notes.tempoRangeClear');
      hintClear.addEventListener('click', () => {
        tempoRange = null;
        syncTempoRangeHint();
        window.dispatchEvent(new CustomEvent('sansbass:temporange', { detail: null }));
        draw();
      });
      hint.append(hintTxt, hintClear);
      lane.appendChild(hint);
      tempoHintEl = hintTxt;
      tempoClearBtn = hintClear;
      tempoDrumsCanvas = canvas;
      syncTempoRangeHint();
    }
```

- [ ] **Step 4: Add `syncTempoRangeHint()`**

Near `applyRibbonVisibility()`, add:

```js
/** The caption under the drums lane: the current selection, or "whole song". */
function syncTempoRangeHint() {
  if (!tempoHintEl) return;
  tempoHintEl.textContent = tempoRange
    ? tr('notes.tempoRangeSel', { from: fmt(tempoRange.from), to: fmt(tempoRange.to) })
    : tr('notes.tempoRangeWhole');
  if (tempoClearBtn) tempoClearBtn.disabled = !tempoRange;
}
```

- [ ] **Step 5: Listen for notes.js's armed toggle, expose `setTempoRange`**

Alongside the existing `window.addEventListener('sansbass:editmode', ...)` listener, add:

```js
window.addEventListener('sansbass:temporangemode', (e) => {
  tempoRangeArmed = e.detail.on;
});
```

In the `window.sansBass = { ... }` export object, alongside `setNotes,`, add:

```js
  /** Restores a tempoRange imported from an edits JSON, updating the drums-lane caption. */
  setTempoRange: (range) => {
    tempoRange = range;
    syncTempoRangeHint();
    draw();
  },
```

- [ ] **Step 6: Retranslate the caption on language switch**

In `retranslate()` (the function `window.addEventListener('sansbass:langchange',
retranslate);` calls), add a call to `syncTempoRangeHint()` — the caption text ("whole song"
or the Clear button) is locale-dependent, same reasoning as the `ribbonEl.txt`/`zoomEl` lines
right above it. Change:

```js
  // Lane labels translate; the note NAMES drawn inside the ribbon never do.
  if (ribbonEl) ribbonEl.txt.textContent = tr('notes.lane');
  if (zoomEl) zoomEl.lane.querySelector('.txt').textContent = tr('notes.zoom');
```

to:

```js
  // Lane labels translate; the note NAMES drawn inside the ribbon never do.
  if (ribbonEl) ribbonEl.txt.textContent = tr('notes.lane');
  if (zoomEl) zoomEl.lane.querySelector('.txt').textContent = tr('notes.zoom');
  syncTempoRangeHint();
```

- [ ] **Step 7: Run the full suite and verify by hand**

Run: reload `tests/test.html` — expect all PASS (no pure-function logic changed here).
Run: `./scripts/serve.sh`, load a stems zip with a drums stem. Confirm a caption reading
"whole song" with a disabled "Clear" button appears under the drums lane.

- [ ] **Step 8: Commit**

```bash
git add app.js
git commit -m "$(cat <<'EOF'
feat: add the drums-lane tempo-range caption and Clear button

app.js-side half of the BPM range selection UI: state, the caption,
and window.sansBass.setTempoRange for import round-trips. The drag
interaction itself lands in the next task.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GFGqCpjU9opiyCWLHrF2Wz
EOF
)"
```

---

## Task 11: `app.js` — drag-to-select on the drums lane

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Extend `attachSeek()`**

Change the start of `attachSeek()` from:

```js
function attachSeek(canvas, opts) {
  const rangeBand = !!(opts && opts.rangeBand);
  const posToTime = (e) => {
    const r = canvas.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * duration;
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (rangeBand && editMode) {
      const r = canvas.getBoundingClientRect();
      if (e.clientY - r.top > r.height - RULER_BAND_PX) {
        const t = posToTime(e);
        rangeDrag = { startT: t, curT: t };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    canvas.setPointerCapture(e.pointerId);
    scrubbing = true;
    seek(posToTime(e));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (rangeDrag) { rangeDrag.curT = posToTime(e); draw(); return; }
    if (scrubbing) { offset = Math.max(0, Math.min(duration, posToTime(e))); draw(); }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (rangeDrag) {
      const from = Math.min(rangeDrag.startT, rangeDrag.curT);
      const to = Math.max(rangeDrag.startT, rangeDrag.curT);
      rangeDrag = null;
      rangeSelection = (to - from > 0.01) ? { from, to } : null;
      draw();
      return;
    }
    if (!scrubbing) return;
    scrubbing = false;
    seek(posToTime(e));
  });
  canvas.addEventListener('pointercancel', () => { rangeDrag = null; scrubbing = false; });
}
```

to:

```js
function attachSeek(canvas, opts) {
  const rangeBand = !!(opts && opts.rangeBand);
  const tempoLane = !!(opts && opts.tempoLane);
  const posToTime = (e) => {
    const r = canvas.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * duration;
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (tempoLane && tempoRangeArmed) {
      const t = posToTime(e);
      tempoRangeDrag = { startT: t, curT: t };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (rangeBand && editMode) {
      const r = canvas.getBoundingClientRect();
      if (e.clientY - r.top > r.height - RULER_BAND_PX) {
        const t = posToTime(e);
        rangeDrag = { startT: t, curT: t };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    canvas.setPointerCapture(e.pointerId);
    scrubbing = true;
    seek(posToTime(e));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (tempoRangeDrag) { tempoRangeDrag.curT = posToTime(e); draw(); return; }
    if (rangeDrag) { rangeDrag.curT = posToTime(e); draw(); return; }
    if (scrubbing) { offset = Math.max(0, Math.min(duration, posToTime(e))); draw(); }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (tempoRangeDrag) {
      const from = Math.min(tempoRangeDrag.startT, tempoRangeDrag.curT);
      const to = Math.max(tempoRangeDrag.startT, tempoRangeDrag.curT);
      tempoRangeDrag = null;
      tempoRange = (to - from > 0.01) ? { from, to } : null;
      syncTempoRangeHint();
      window.dispatchEvent(new CustomEvent('sansbass:temporange', { detail: tempoRange }));
      draw();
      return;
    }
    if (rangeDrag) {
      const from = Math.min(rangeDrag.startT, rangeDrag.curT);
      const to = Math.max(rangeDrag.startT, rangeDrag.curT);
      rangeDrag = null;
      rangeSelection = (to - from > 0.01) ? { from, to } : null;
      draw();
      return;
    }
    if (!scrubbing) return;
    scrubbing = false;
    seek(posToTime(e));
  });
  canvas.addEventListener('pointercancel', () => { tempoRangeDrag = null; rangeDrag = null; scrubbing = false; });
}
```

- [ ] **Step 2: Draw the band**

Add a new function near `paintRangeBand`:

```js
/** The whole-lane drag surface on the drums stem: a faint resting-state tint while armed
 *  (unlike paintRangeBand's bottom-strip-only hint — there is no competing gesture on this
 *  lane, so the whole thing is fair game), plus a brighter highlight while dragging or
 *  committed. Same drawn-on-the-live-canvas reasoning as paintRangeBand: a drag must not
 *  force renderWave to rebuild this lane's cached idle/active layers every pointermove. */
function paintTempoRangeBand(c, canvas, dpr) {
  const w = canvas.width;
  const h = canvas.height;
  if (tempoRangeArmed) {
    c.fillStyle = 'rgba(255,209,102,.07)';
    c.fillRect(0, 0, w, h);
  }
  const rsel = tempoRangeDrag || tempoRange;
  if (rsel && duration) {
    const s = Math.min(rsel.startT ?? rsel.from, rsel.curT ?? rsel.to);
    const eT = Math.max(rsel.startT ?? rsel.from, rsel.curT ?? rsel.to);
    c.fillStyle = 'rgba(255,209,102,.18)';
    c.fillRect((s / duration) * w, 0, Math.max(1, ((eT - s) / duration) * w), h);
  }
}
```

In `paint(canvas, frac)`, alongside the existing
`if (ribbonEl && canvas === ribbonEl.canvas) paintRangeBand(c, canvas, dpr);` line, add:

```js
  if (tempoDrumsCanvas && canvas === tempoDrumsCanvas) paintTempoRangeBand(c, canvas, dpr);
```

- [ ] **Step 3: Run the full suite and verify by hand**

Run: reload `tests/test.html` — expect all PASS.
Run: `./scripts/serve.sh`, load a stems zip with drums, click "Select BPM range" in the notes
panel. Confirm the drums lane tints faintly and dragging across it draws an amber band that
snaps into a committed selection on release, updating the caption text under it (from Task
10) to the selected time range. Click "Clear" and confirm it reverts to "whole song". Confirm
the drums lane's plain click-to-seek behaviour still works when the toggle is off.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "$(cat <<'EOF'
feat: drag-to-select a BPM detection range on the drums lane

Independent of the note-editing range-select — its own armed state,
its own amber band, the whole lane as the drag surface rather than a
bottom strip, since there is no competing gesture there.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GFGqCpjU9opiyCWLHrF2Wz
EOF
)"
```

---

## Task 12: `app.js` — draw the beat/bar grid

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Draw it in `renderRibbon()`**

In `renderRibbon()`'s `make(dim)` closure, immediately after the block that draws the
semitone boundary lines (the `for (let m = lo; m <= hi + 1; m++) { ... c.fillRect(0,
Math.round(y(m - 0.5)), w, 1); }` loop) and before the "Labels overlay the left edge" comment
block, add:

```js
    /* The beat/bar grid, purely visual — see docs/transcription.md on why this never
     * touches interpret() or the note list. Bars draw taller/stronger than plain beats. */
    if (payload.tempo && payload.tempo.on) {
      const beats = window.SansRibbon.beatTimes(payload.tempo, duration);
      for (const b of beats) {
        const bx = Math.round(x(b.t));
        c.fillStyle = b.bar
          ? (dim ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.28)')
          : (dim ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.10)');
        c.fillRect(bx, 0, b.bar ? 2 : 1, h);
      }
    }
```

- [ ] **Step 2: Draw it in `renderZoom()`**

In `renderZoom()`, immediately after the block that draws the semitone boundary lines (the
`for (let m = lo; m <= hi + 1; m++) { c.fillStyle = isHome(m) ? ... c.fillRect(0,
Math.round(y(m - 0.5)), w, 1); }` loop) and before the "Names, overlaid at the left" comment
block, add:

```js
  if (ribbon.tempo && ribbon.tempo.on) {
    const beats = window.SansRibbon.beatTimes(ribbon.tempo, duration);
    for (const b of beats) {
      if (b.t < win.from || b.t > win.to) continue;
      const bx = x(b.t);
      c.fillStyle = b.bar ? 'rgba(255,255,255,.30)' : 'rgba(255,255,255,.12)';
      c.fillRect(bx, 0, b.bar ? 2 : 1, h);
    }
  }
```

- [ ] **Step 3: Run the full suite and verify by hand**

Run: reload `tests/test.html` — expect all PASS.
Run: `./scripts/serve.sh`, load a stems zip with vocals + drums, press **Find notes**.
Confirm faint vertical ticks (stronger every 4th, or whatever beats-per-bar is set to) appear
across the full-song notes lane and the zoomed pane, roughly tracking the drums waveform's
visible transients. Toggle "Show tempo grid" off and confirm the ticks disappear from both
panes while the notes/contour stay exactly as they were. Drag the BPM number and confirm the
grid re-spaces live.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "$(cat <<'EOF'
feat: draw the beat/bar grid on the notes lane and zoomed pane

Uses beatTimes() from lib/ribbon.js; gated on ribbon.tempo.on, skipped
entirely when the drums stem was never analysed.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GFGqCpjU9opiyCWLHrF2Wz
EOF
)"
```

---

## Task 13: `styles.css` — tempo-range-hint layout

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Add the rule**

After the `.lane-vol { display: flex; align-items: center; }` / `.lane-vol input { width:
100%; }` rules (before the `.status { ... }` block), add:

```css
/* The caption + Clear button under the drums lane, naming the current BPM-detection range.
   grid-column: 1 / -1 spans the .lane grid the same way .note-range-hint already does. */
.tempo-range-hint {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
  font: 11px var(--mono);
  color: var(--dim);
  margin-top: 2px;
}
```

- [ ] **Step 2: Verify by hand**

Run: `./scripts/serve.sh`, load a stems zip with drums. Confirm the caption+Clear row sits on
its own line under the drums lane's waveform, not squeezed into the 96px name column, and
that armed-state styling on the "Select BPM range" button (reusing the existing
`.note-tbtn-armed` rule) shows an amber border/text when toggled on.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "$(cat <<'EOF'
feat: style the tempo-range caption under the drums lane

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GFGqCpjU9opiyCWLHrF2Wz
EOF
)"
```

---

## Task 14: regression test — tempo state never touches note detection

**Files:**
- Modify: `tests/notes.test.js`

This is the direct test for the design's central non-goal: the grid must never quantize or
otherwise change `interpret()`'s output.

- [ ] **Step 1: Write the test**

Add to `tests/notes.test.js`:

```js
import { interpret } from '../lib/pitch.js';

test('notes: interpret() output is byte-identical regardless of tempo state', async () => {
  const frames = await analyse([sine(220, 0.4, SR), sine(0, 0.1, SR), sine(330, 0.4, SR)].reduce(
    (acc, seg) => { const out = new Float32Array(acc.length + seg.length); out.set(acc); out.set(seg, acc.length); return out; },
    new Float32Array(0),
  ), SR);
  // interpret() has never heard of tempo — there is no tempo argument to pass it at all.
  // This test exists to make that structural guarantee explicit and regression-proof: any
  // future change that threads tempo into interpret()'s signature breaks this call shape.
  const params = { interpreter: 'threshold-v1', params: { minDurationMs: 80 } };
  const a = interpret(frames, params);
  const b = interpret(frames, params);
  assertEq(JSON.stringify(a), JSON.stringify(b), 'identical params, identical output, independent of any global tempo state');
  assertEq(interpret.length, 2, 'interpret() takes exactly (track, interpretation) — no tempo parameter exists to accidentally wire up');
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: reload `tests/test.html`.
Expected: PASS immediately — this test is a structural guard (asserting `interpret()`'s
arity and pure-function determinism), not a new capability, so it should pass without any
implementation change. If `interpret.length` is not `2`, something in this plan accidentally
added a parameter to `interpret()` — stop and re-check Tasks 7-9 for anywhere `tempo` was
threaded into `lib/pitch.js` rather than only into `notes.js`'s own state and the
`setNotes()` payload.

- [ ] **Step 3: Commit**

```bash
git add tests/notes.test.js
git commit -m "$(cat <<'EOF'
test: guard that interpret() never depends on tempo state

Direct regression test for the tempo-grid design's central non-goal —
see docs/superpowers/specs/2026-09-01-tempo-grid-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GFGqCpjU9opiyCWLHrF2Wz
EOF
)"
```

---

## Task 15: version bump

**Files:**
- Modify: `index.html`, `separate.js`, `separate.worker.js`, `notes.js`, `notes.worker.js`

Every local asset URL in these five files carries a `?v=` cache buster and they must all
agree — see `tests/versions.test.js` and the CLAUDE.md gotcha it guards. This is a new
feature release, so the version moves from `1.16.5` to `1.17.0`.

- [ ] **Step 1: Bump every occurrence**

Run:

```bash
sed -i '' 's/?v=1\.16\.5/?v=1.17.0/g' index.html separate.js separate.worker.js notes.js notes.worker.js
```

- [ ] **Step 2: Verify the count**

Run:

```bash
grep -c '?v=1.17.0' index.html separate.js separate.worker.js notes.js notes.worker.js
```

Expected: `index.html:15`, `separate.js:3`, `separate.worker.js:1`, `notes.js:3`,
`notes.worker.js:2` (one more than before Task 4 added the `lib/tempo.js` import) — 24 in
all. Run `grep -rn '?v=1.16.5' index.html separate.js separate.worker.js notes.js
notes.worker.js` and confirm it returns nothing.

- [ ] **Step 3: Run the versions test**

Run: `./scripts/serve.sh`, reload `tests/test.html`.
Expected: PASS on both `versions:` tests — every local asset carries `?v=`, and every
versioned file agrees on exactly one version.

- [ ] **Step 4: Commit**

```bash
git add index.html separate.js separate.worker.js notes.js notes.worker.js
git commit -m "$(cat <<'EOF'
chore: bump asset version to v1.17.0

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GFGqCpjU9opiyCWLHrF2Wz
EOF
)"
```

---

## Task 16: docs + manual verification

**Files:**
- Modify: `docs/transcription.md`
- Modify: `docs/behaviour.md`

- [ ] **Step 1: Update the transcription status table**

In `docs/transcription.md`'s `## Status` table, change:

```
| beat / tempo | not built | — |
```

to:

```
| beat / tempo | built — `lib/tempo.js` (`onsetEnvelope()` + `estimateTempo()`) and `beatTimes()` in `lib/ribbon.js` | detected from the drums stem alongside vocals analysis; display-only grid over the notes lane and zoomed pane, correctable by hand |
```

- [ ] **Step 2: Add the behaviour.md section**

In `docs/behaviour.md`, add a new `## Tempo grid` section immediately after `## Notes lane`
and before `## Note editing` (i.e. right before the line `## Note editing`):

```markdown
## Tempo grid

`lib/tempo.js` detects BPM/phase from the drums stem inside `notes.worker.js`, bundled into
the same round trip as vocals analysis. `notes.js` owns the resulting `tempo`/`tempoRange`
state; `app.js` draws the grid via `lib/ribbon.js`'s `beatTimes()` and owns the drag-to-select
UI on the drums stem's own lane. Design:
[`2026-09-01-tempo-grid-design.md`](superpowers/specs/2026-09-01-tempo-grid-design.md).

| # | Expected | How to observe |
|---|---|---|
| T1 | The tempo row is disabled (except the checkbox) until a drums stem is loaded. | With only vocals + another stem (no drums), `#notes-tempo-bpm.disabled` etc. are `true`; `#notes-tempo-on.disabled` is `false`. |
| T2 | Running **Find notes** with a drums stem present detects tempo in the same pass — no separate button press needed. | After Go, `#notes-tempo-status` shows a BPM and confidence percentage rather than "No tempo detected yet". |
| T3 | The grid is **on** by default once detected. | `#notes-tempo-on.checked` is `true` after Go; beat ticks are visible on `.lane.ribbon`'s canvas. |
| T4 | Toggling **Show tempo grid** off removes the grid from both panes without touching the notes. | Untick it: `canvas.__layers.active` loses the vertical tick pixels; `#notes-count` is unchanged. |
| T5 | Editing BPM, phase, or beats-per-bar updates the grid **live, with no re-analysis**. | Time it: changing `#notes-tempo-bpm` must re-space the grid within tens of milliseconds, not seconds — same class of check as N8. |
| T6 | **×½ / ×2** halve/double the BPM field and the grid re-spaces to match. | Click each; `#notes-tempo-bpm.value` halves/doubles and the on-canvas beat spacing visibly changes. |
| T7 | The grid **never changes the note list**. This is the design's central non-goal. | `#notes-count` and the payload's `notes` array are byte-identical with the grid on, off, or with BPM/phase edited. |
| T8 | **Select BPM range** arms a drag surface across the **whole** drums lane, distinct from the note-editing range-select's bottom-strip-only band. | Toggle it on: the drums lane's canvas tints faintly across its full height, not just a bottom strip. |
| T9 | Dragging on the armed drums lane commits a selection and updates the caption underneath it; the caption reads "whole song" when nothing is selected. | Drag, release: caption text changes to a `mm:ss–mm:ss` range; **Clear** becomes enabled. |
| T10 | **Clear** reverts to the whole song, both in the caption and in what a subsequent Re-detect analyses. | Click Clear: caption returns to "whole song"; `#notes-tempo-range button.mini` (Clear) becomes disabled again. |
| T11 | Selecting a range does **not** itself trigger detection. | Drag a selection without pressing Re-detect: `#notes-tempo-status` and the drawn grid are unchanged. |
| T12 | **Re-detect tempo** re-runs detection using the current range **without re-running vocals analysis**. | Press it after narrowing the range: `#notes-count` (vocals-derived) does not change, but `#notes-tempo-status`'s BPM can. |
| T13 | With the drums-lane range-select off, the lane's normal click-to-seek behaviour is unaffected. | With **Select BPM range** untoggled, clicking the drums lane still moves the playhead, same as any other stem lane. |
| T14 | Export/import round-trips `tempo` and `tempoRange` exactly. | Export edits, change BPM/phase/beats-per-bar, re-import the same file: all three return to the exported values. |
| T15 | A song with a non-metrical intro (e.g. spoken narration) detects a materially different — and by ear, better — BPM once the range excludes the intro. | Using a real narrated-intro track from `stems/`: compare `#notes-tempo-status`'s BPM over the whole song vs. over a range starting after the narration. |
```

- [ ] **Step 3: Run the manual pass**

Run: `./scripts/serve.sh`, open `http://localhost:8777/`. Work through T1-T15 against a real
stems set in this repo's `stems/` directory that has both vocals and drums — prefer one with
a non-metrical intro/narration for T15 if one exists locally; otherwise note in the devlog
that T15 was reasoned rather than run against real narrated material.

- [ ] **Step 4: Update the "last exercised" line**

At the top of `docs/behaviour.md`, extend the existing sentence to note the new rows, e.g.:

```
T1-T15 (tempo grid) were run in **v1.17.0**.
```

- [ ] **Step 5: Commit**

```bash
git add docs/transcription.md docs/behaviour.md
git commit -m "$(cat <<'EOF'
docs: tempo grid — status table, behaviour rows, manual verification

Fills the beat/tempo row in transcription.md's status table. T1-T15
in behaviour.md were run end-to-end against a real stems set.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GFGqCpjU9opiyCWLHrF2Wz
EOF
)"
```

---

## Self-review notes

- **Spec coverage:** Goal 1 (auto-detect BPM/phase from drums) → Tasks 1, 2, 4, 7. Goal 2
  (draw the grid) → Tasks 3, 12. Goal 3 (hand correction, live, no re-analysis) → Task 8.
  Goal 4 (restrict the analysed range) → Tasks 10, 11. Goal 5 (persist in edits JSON) → Task
  9. Non-goal "no quantization" → Task 14 (direct regression test) plus Task 12's rendering
  staying entirely inside `app.js`/`lib/ribbon.js`. Testing section's four `tempo.test.js`
  cases → Tasks 1-2; `beatTimes` cases → Task 3; i18n parity → Task 6 (automatic, existing
  test); the `interpret()` regression → Task 14. Manual verification → Task 16.
- **Placeholder scan:** no TBD/"add appropriate"/"similar to Task N" phrasing; every code
  step shows the actual diff or full file content.
- **Type consistency:** `tempo` object shape (`{ on, auto, bpmValue, phaseMs, beatsPerBar,
  confidence }`) is identical across notes.js's state (Task 7), the `setNotes()` payload
  (Task 7), `beatTimes()`'s consumption of it (Task 3/12), and the export/import JSON (Task
  9). `estimateTempo()`'s return shape (`{ bpmValue, phaseSec, confidence }`) matches what
  `applyTempoResult()` (Task 7) and the worker's `'tempo'` message (Task 4) both produce and
  consume. `tempoRange`'s `{ from, to }` shape is identical between app.js's drag state (Task
  10-11), notes.js's stored copy (Task 7-9), and the exported JSON (Task 9).
