# Pitch Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract note events and a key estimate from an isolated vocal stem, and expose both on a bench page that can be checked by hand against a guitar.

**Architecture:** One pure ESM module, `lib/pitch.js`, holding a decimating anti-alias filter, a YIN pitch tracker, note segmentation, and Krumhansl-Schmuckler key estimation. It touches no DOM, no `AudioContext`, and no Worker — it takes `Float32Array`s and returns data, so the bench page can call it on the main thread today and the app can wrap the same module in a Worker later. A second file, `tests/notes.html`, drives it against real stems.

**Tech Stack:** Vanilla ESM. No build step, no dependencies, no network. Tests are the existing browser harness (`tests/assert.js`, `tests/test.html`).

**Spec:** [`docs/superpowers/specs/2026-08-30-pitch-detection-design.md`](../specs/2026-08-30-pitch-detection-design.md)

**Branch:** `spike/pitch-detection` (already created; the repo uses branches rather than worktrees).

---

## Three deliberate deviations from the spec

Flagged here so the reviewer sees them rather than discovering them in a diff.

1. **`detectNotes` takes an array of channels, not one `samples` array.** The spec's algorithm §1 begins "downmix to mono by averaging channels", so the downmix belongs inside the module. The signature becomes `detectNotes(channels, sampleRate, opts)` where `channels` is `[Float32Array, …]`.
2. **YIN accuracy is asserted at 20 cents, not 1 cent.** Parabolic interpolation over the CMND curve carries a small systematic bias, and at the top of the range (1046.5 Hz is only ~10.5 samples per period) that bias is worth several cents. 20 cents is a fifth of a semitone — tight enough to prove the correct pitch and octave, loose enough not to be a flaky test. If measured error turns out far smaller, tighten it.
3. **`detectKey` returns `score` and `relative` alongside the spec's fields.** The spec asks for the relative major/minor caveat to be printed; returning it from the function rather than recomputing it in the page keeps that logic in one place.

## File structure

| File | Responsibility |
|---|---|
| `lib/pitch.js` (create) | The entire DSP pipeline. Pure ESM, ~370 lines, sectioned by comment banner: helpers / decimation / YIN / track / segmentation / key. |
| `tests/pitch.test.js` (create) | Unit tests over synthesised input. No audio files, no network. |
| `tests/notes.html` (create) | Bench page. Fetches a real stem, runs the module, prints key + phrases + note table, publishes `window.__notes`. |
| `tests/test.html` (modify) | One added `import` line. |
| `docs/devlog.md` (modify) | v1.10.0 entry + TL;DR row. |
| `CLAUDE.md` (modify) | Repo-layout lines for the two new files. |

`docs/behaviour.md` is deliberately **not** modified: nothing in this plan changes observable player behaviour. It gets updated when the module is wired into the UI, which is out of scope here.

## Running the tests

Everything needs the local server, because ESM and `fetch` both need http.

```bash
./scripts/serve.sh          # http://localhost:8777
```

Unit tests: open `http://localhost:8777/tests/test.html`. Read the `<pre>`, or read `window.__testResults` in the console. Bench page: `http://localhost:8777/tests/notes.html`.

---

## Task 1: Module scaffold and pitch helpers

Establishes the file, the test file, and the harness wiring, so every later task has somewhere to land.

**Files:**
- Create: `lib/pitch.js`
- Create: `tests/pitch.test.js`
- Modify: `tests/test.html`

- [ ] **Step 1: Write the failing test**

Create `tests/pitch.test.js`:

```js
import { test, assertEq, assertClose } from './assert.js';
import { centsFromHz, hzFromCents, midiFromCents, noteName } from '../lib/pitch.js';

test('pitch: cents anchor on A4 = 440 Hz = MIDI 69', () => {
  assertClose(centsFromHz(440), 6900, 1e-6, 'A4');
  assertClose(centsFromHz(880), 8100, 1e-6, 'an octave up is +1200 cents');
  assertClose(centsFromHz(220), 5700, 1e-6, 'an octave down is -1200 cents');
});

test('pitch: hzFromCents inverts centsFromHz', () => {
  for (const hz of [82.41, 220, 440, 1046.5]) {
    assertClose(hzFromCents(centsFromHz(hz)), hz, 1e-6, `round trip ${hz}`);
  }
});

test('pitch: midiFromCents rounds to the nearest semitone', () => {
  assertEq(midiFromCents(6900), 69, 'exactly A4');
  assertEq(midiFromCents(6949), 69, '49 cents sharp is still A4');
  assertEq(midiFromCents(6951), 70, '51 cents sharp rounds up');
});

test('pitch: noteName spells MIDI numbers with octaves', () => {
  assertEq(noteName(69), 'A4', 'concert A');
  assertEq(noteName(60), 'C4', 'middle C');
  assertEq(noteName(40), 'E2', 'guitar low E');
  assertEq(noteName(61), 'C#4', 'sharps, never flats');
});
```

- [ ] **Step 2: Register the test file in the harness**

In `tests/test.html`, add one line to the dynamic-import list, after `./overlap.test.js`:

```js
    await import('./pitch.test.js');
```

- [ ] **Step 3: Run the tests to verify they fail**

Run `./scripts/serve.sh`, open `http://localhost:8777/tests/test.html`.
Expected: the page shows `running…` and the console carries a module-resolution error for `../lib/pitch.js` — the file does not exist yet.

- [ ] **Step 4: Write the minimal implementation**

Create `lib/pitch.js`:

```js
/* Note and key detection from a monophonic stem.
 *
 * Pure: no DOM, no AudioContext, no Worker. Takes Float32Arrays, returns data — so the
 * bench page can call it on the main thread and the app can put it in a Worker later
 * without the module changing.
 *
 * Pipeline: decimate 4:1 -> YIN per frame -> voicing gate + median filter -> segment into
 * notes -> duration-weighted chroma -> Krumhansl-Schmuckler key.
 *
 * Design: docs/superpowers/specs/2026-08-30-pitch-detection-design.md
 */

// ---------------------------------------------------------------- helpers

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Hz -> absolute cents, anchored so MIDI 69 (A4, 440 Hz) is 6900. */
export function centsFromHz(hz) {
  return 1200 * Math.log2(hz / 440) + 6900;
}

/** Inverse of centsFromHz. */
export function hzFromCents(cents) {
  return 440 * Math.pow(2, (cents - 6900) / 1200);
}

/** Absolute cents -> nearest MIDI note number. */
export function midiFromCents(cents) {
  return Math.round(cents / 100);
}

/** MIDI note number -> scientific pitch name, sharps only ("C#4", never "Db4"). */
export function noteName(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.
Expected: four new `PASS` lines beginning `pitch:`, and the trailing count reads `N/N passed` with zero failures.

- [ ] **Step 6: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js tests/test.html
git commit -m "Pitch: cents, MIDI and note-name helpers"
```

---

## Task 2: Anti-aliased 4:1 decimation

Cuts the YIN lag search 16-fold. The lowpass is load-bearing: decimating without it folds content above 5512 Hz straight into the f0 search range, where it is indistinguishable from a real fundamental.

**Files:**
- Modify: `lib/pitch.js`
- Modify: `tests/pitch.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/pitch.test.js`:

```js
import { lowpassKernel, decimate } from '../lib/pitch.js';

// RMS over the interior only — an FIR's first and last taps see zero-padding, and those
// edge samples would otherwise drag the measured level down and fail a correct filter.
function interiorRms(a, skip) {
  let s = 0;
  let n = 0;
  for (let i = skip; i < a.length - skip; i++) { s += a[i] * a[i]; n++; }
  return Math.sqrt(s / n);
}

function sine(hz, seconds, sampleRate, amp = 0.5) {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

test('pitch: lowpass kernel has unity DC gain and is symmetric', () => {
  const k = lowpassKernel(63, 5000, 44100);
  assertEq(k.length, 63, 'tap count');
  let sum = 0;
  for (let i = 0; i < k.length; i++) sum += k[i];
  assertClose(sum, 1, 1e-5, 'taps sum to 1, so DC passes at unity');
  for (let i = 0; i < 31; i++) assertClose(k[i], k[62 - i], 1e-9, `symmetric at ${i}`);
});

test('pitch: decimate reports the decimated rate and length', () => {
  const { samples, sampleRate } = decimate([sine(300, 1, 44100)], 44100);
  assertEq(sampleRate, 11025, 'four times down from 44.1 kHz');
  assertEq(samples.length, Math.floor(44100 / 4), 'one output sample per four input');
});

test('pitch: decimate passes 300 Hz and rejects 8 kHz', () => {
  const pass = decimate([sine(300, 1, 44100)], 44100).samples;
  const stop = decimate([sine(8000, 1, 44100)], 44100).samples;
  // 0.5-amplitude sine has RMS 0.3536.
  assertClose(interiorRms(pass, 200), 0.3536, 0.02, '300 Hz survives the passband');
  assert(interiorRms(stop, 200) < 0.035, '8 kHz is attenuated by at least 20 dB');
});

test('pitch: decimate averages channels to mono', () => {
  const n = 44100;
  const left = sine(300, 1, 44100, 0.5);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) right[i] = -left[i];   // exact anti-phase
  const { samples } = decimate([left, right], 44100);
  assert(interiorRms(samples, 200) < 1e-6, 'anti-phase channels cancel to silence');
});
```

Add `assert` to the existing import at the top of the file so it reads:

```js
import { test, assert, assertEq, assertClose } from './assert.js';
```

- [ ] **Step 2: Run the tests to verify they fail**

Reload `http://localhost:8777/tests/test.html`.
Expected: a module error naming `lowpassKernel` / `decimate` as missing exports.

- [ ] **Step 3: Write the implementation**

Append to `lib/pitch.js`:

```js
// ---------------------------------------------------------------- decimation

export const DECIMATION = 4;          // 44100 -> 11025 Hz
const LOWPASS_TAPS = 63;
const CUTOFF_FRACTION = 0.9;          // of the decimated Nyquist

/**
 * Hamming-windowed sinc lowpass. `taps` must be odd; `cutoffHz` is the -6 dB point.
 * Normalised to unity DC gain so decimation does not change level.
 */
export function lowpassKernel(taps, cutoffHz, sampleRate) {
  const k = new Float32Array(taps);
  const mid = (taps - 1) / 2;
  const fc = cutoffHz / sampleRate;          // cycles per sample
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const n = i - mid;
    const sinc = n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n);
    const win = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1));
    k[i] = sinc * win;
    sum += k[i];
  }
  for (let i = 0; i < taps; i++) k[i] /= sum;
  return k;
}

/**
 * Downmix to mono, anti-alias filter, and keep every `factor`-th sample.
 *
 * The filter is evaluated only at output positions — the standard decimating FIR — so the
 * discarded samples cost nothing.
 */
export function decimate(channels, sampleRate, factor = DECIMATION) {
  const n = channels[0].length;
  const mono = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i];
  const gain = 1 / channels.length;
  for (let i = 0; i < n; i++) mono[i] *= gain;

  const cutoff = (sampleRate / (2 * factor)) * CUTOFF_FRACTION;
  const kernel = lowpassKernel(LOWPASS_TAPS, cutoff, sampleRate);
  const mid = (LOWPASS_TAPS - 1) / 2;

  const outLen = Math.floor(n / factor);
  const out = new Float32Array(outLen);
  for (let o = 0; o < outLen; o++) {
    const centre = o * factor;
    let acc = 0;
    for (let t = 0; t < LOWPASS_TAPS; t++) {
      const j = centre + t - mid;
      if (j >= 0 && j < n) acc += mono[j] * kernel[t];
    }
    out[o] = acc;
  }
  return { samples: out, sampleRate: sampleRate / factor };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.
Expected: four new `PASS` lines, zero failures.

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "Pitch: anti-aliased 4:1 decimation to 11025 Hz"
```

---

## Task 3: YIN on a single frame

**Files:**
- Modify: `lib/pitch.js`
- Modify: `tests/pitch.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/pitch.test.js`:

```js
import { yinFrame } from '../lib/pitch.js';

test('pitch: yinFrame resolves sines across the whole search range', () => {
  const SR = 11025;
  // 20 cents is a fifth of a semitone. Parabolic interpolation over the CMND curve has a
  // small systematic bias, worst at the top of the range where a period is only ~10
  // samples, so a 1-cent assertion would be flaky without being any more convincing.
  for (const hz of [82.41, 220, 440, 1046.5]) {
    const buf = sine(hz, 0.2, SR);
    const r = yinFrame(buf, 0, SR);
    assertClose(centsFromHz(r.f0), centsFromHz(hz), 20, `${hz} Hz within 20 cents`);
    assert(r.confidence > 0.9, `${hz} Hz reads as strongly periodic (${r.confidence})`);
  }
});

test('pitch: yinFrame reports low confidence on noise', () => {
  const buf = new Float32Array(1024);
  let seed = 12345;
  for (let i = 0; i < buf.length; i++) {
    // Math.imul, not *: a 32-bit LCG product exceeds 2^53 and loses precision as a double.
    // Deterministic on purpose — a Math.random() buffer would make this test able to flake.
    seed = (Math.imul(seed, 1103515245) + 12345) | 0;
    buf[i] = ((seed >>> 8) / 0x800000) - 1;
  }
  assert(yinFrame(buf, 0, 11025).confidence < 0.5, 'white noise is not periodic');
});

test('pitch: yinFrame reports zero confidence on silence', () => {
  const r = yinFrame(new Float32Array(1024), 0, 11025);
  assertClose(r.confidence, 0, 1e-6, 'digital silence has no periodicity to find');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Reload `http://localhost:8777/tests/test.html`.
Expected: a module error naming `yinFrame` as a missing export.

- [ ] **Step 3: Write the implementation**

Append to `lib/pitch.js`:

```js
// ---------------------------------------------------------------- YIN

export const YIN_DEFAULTS = {
  window: 512,        // 46 ms at 11025 Hz
  hop: 128,           // 11.6 ms -> 86 frames/sec
  tauMin: 10,         // 1102 Hz
  tauMax: 138,        //   79.9 Hz
  threshold: 0.1,     // YIN's absolute threshold on the normalised difference
};

/**
 * YIN (de Cheveigne & Kawahara 2002) on one frame.
 *
 * `buf` must hold at least `window + tauMax` samples from `offset`. Returns
 * { tau, f0, confidence }; confidence is 1 - d'(tau), clamped to [0, 1].
 *
 * The difference function is computed from tau = 1 even though the search starts at
 * tauMin, because the cumulative mean in step 2 is defined over every lag below tau.
 * Starting the running mean at tauMin instead would change the normalisation and shift
 * the threshold comparison.
 */
export function yinFrame(buf, offset, sampleRate, opts = {}) {
  const W = opts.window ?? YIN_DEFAULTS.window;
  const tauMin = opts.tauMin ?? YIN_DEFAULTS.tauMin;
  const tauMax = opts.tauMax ?? YIN_DEFAULTS.tauMax;
  const threshold = opts.threshold ?? YIN_DEFAULTS.threshold;

  // 1. difference function
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < W; j++) {
      const diff = buf[offset + j] - buf[offset + j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // 2. cumulative mean normalised difference
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  // 3. absolute threshold: the first dip below it, descended to its local minimum
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    let best = tauMin;
    for (let t = tauMin + 1; t <= tauMax; t++) if (cmnd[t] < cmnd[best]) best = t;
    tau = best;
  }

  // 4. parabolic interpolation for sub-sample precision
  let refined = tau;
  if (tau > tauMin && tau < tauMax) {
    const a = cmnd[tau - 1];
    const b = cmnd[tau];
    const c = cmnd[tau + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) refined = tau + (a - c) / (2 * denom);
  }

  const confidence = Math.max(0, Math.min(1, 1 - cmnd[tau]));
  return { tau: refined, f0: refined > 0 ? sampleRate / refined : 0, confidence };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.
Expected: three new `PASS` lines, zero failures.

Note the silence case: with an all-zero buffer every `d[tau]` is 0, so `running` stays 0 and `cmnd[tau]` is forced to 1, giving confidence 0. That is why the `running > 0` guard exists rather than a division that would produce `NaN`.

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "Pitch: YIN fundamental estimation on a single frame"
```

---

## Task 4: The f0 track — frame loop, voicing gate, median filter

**Files:**
- Modify: `lib/pitch.js`
- Modify: `tests/pitch.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/pitch.test.js`:

```js
import { f0Track, medianFilterVoiced } from '../lib/pitch.js';

test('pitch: medianFilterVoiced removes an isolated outlier', () => {
  const cents = Float32Array.from([5000, 5000, 6200, 5000, 5000]);
  medianFilterVoiced(cents, 5);
  assertClose(cents[2], 5000, 1e-6, 'the octave jump is replaced by its neighbours');
});

test('pitch: medianFilterVoiced leaves unvoiced frames unvoiced', () => {
  const cents = Float32Array.from([5000, 0, 5000, 5000, 5000]);
  medianFilterVoiced(cents, 5);
  assertClose(cents[1], 0, 1e-6, 'zero is the unvoiced sentinel and must survive');
});

test('pitch: f0Track tracks a steady tone', () => {
  const SR = 11025;
  const track = f0Track(sine(220, 1, SR), SR);
  assert(track.cents.length > 60, `enough frames for one second (${track.cents.length})`);
  assertClose(track.frameSeconds, 128 / SR, 1e-9, 'frame spacing is hop / rate');
  const voiced = [...track.cents].filter((c) => c !== 0);
  assert(voiced.length > track.cents.length * 0.9, 'a pure tone is voiced nearly everywhere');
  for (const c of voiced) assertClose(c, centsFromHz(220), 20, 'every voiced frame reads A3');
});

test('pitch: f0Track marks silence unvoiced', () => {
  const track = f0Track(new Float32Array(11025), 11025);
  assert([...track.cents].every((c) => c === 0), 'nothing in silence is voiced');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Reload `http://localhost:8777/tests/test.html`.
Expected: a module error naming `f0Track` / `medianFilterVoiced` as missing exports.

- [ ] **Step 3: Write the implementation**

Append to `lib/pitch.js`:

```js
// ---------------------------------------------------------------- f0 track

export const TRACK_DEFAULTS = {
  minConfidence: 0.5,   // below this a frame is unvoiced
  silenceDb: -50,       // frame RMS floor, for the gaps between phrases
  medianSpan: 5,        // frames, odd
};

/**
 * Median-filter a cents array in place, skipping unvoiced frames.
 *
 * Zero is the unvoiced sentinel. That is safe because real sung cents run roughly
 * 2000-9000 and can never legitimately be 0 (which would be 8.2 Hz).
 */
export function medianFilterVoiced(cents, span) {
  const half = Math.floor(span / 2);
  const src = Float32Array.from(cents);
  const win = [];
  for (let i = 0; i < cents.length; i++) {
    if (src[i] === 0) continue;
    win.length = 0;
    const lo = Math.max(0, i - half);
    const hi = Math.min(src.length - 1, i + half);
    for (let j = lo; j <= hi; j++) if (src[j] !== 0) win.push(src[j]);
    win.sort((a, b) => a - b);
    cents[i] = win[(win.length - 1) >> 1];
  }
  return cents;
}

/**
 * Run YIN across the whole signal.
 *
 * Returns parallel arrays { t, f0, conf, cents } plus frameSeconds. An unvoiced frame has
 * f0 = 0 and cents = 0; conf is still reported, so a frame rejected for low confidence can
 * be told apart from one rejected for silence.
 */
export function f0Track(samples, sampleRate, opts = {}) {
  const W = opts.window ?? YIN_DEFAULTS.window;
  const hop = opts.hop ?? YIN_DEFAULTS.hop;
  const tauMax = opts.tauMax ?? YIN_DEFAULTS.tauMax;
  const minConfidence = opts.minConfidence ?? TRACK_DEFAULTS.minConfidence;
  const silenceDb = opts.silenceDb ?? TRACK_DEFAULTS.silenceDb;
  const medianSpan = opts.medianSpan ?? TRACK_DEFAULTS.medianSpan;

  const need = W + tauMax;
  const count = Math.max(0, Math.floor((samples.length - need) / hop) + 1);
  const t = new Float32Array(count);
  const f0 = new Float32Array(count);
  const conf = new Float32Array(count);
  const cents = new Float32Array(count);
  const silenceRms = Math.pow(10, silenceDb / 20);

  for (let i = 0; i < count; i++) {
    const off = i * hop;
    t[i] = off / sampleRate;

    let energy = 0;
    for (let j = 0; j < W; j++) { const s = samples[off + j]; energy += s * s; }
    if (Math.sqrt(energy / W) < silenceRms) continue;      // f0, conf, cents stay 0

    const r = yinFrame(samples, off, sampleRate, opts);
    conf[i] = r.confidence;
    if (r.confidence < minConfidence || r.f0 <= 0) continue;
    f0[i] = r.f0;
    cents[i] = centsFromHz(r.f0);
  }

  medianFilterVoiced(cents, medianSpan);
  return { t, f0, conf, cents, frameSeconds: hop / sampleRate };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.
Expected: four new `PASS` lines, zero failures.

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "Pitch: f0 track with voicing gate and median smoothing"
```

---

## Task 5: Note segmentation

**Files:**
- Modify: `lib/pitch.js`
- Modify: `tests/pitch.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/pitch.test.js`:

```js
import { segmentNotes } from '../lib/pitch.js';

// Build a track by hand so segmentation is tested without YIN in the way.
// `spec` is a list of [centsOrZero, frameCount].
function fakeTrack(spec, frameSeconds = 128 / 11025) {
  const cents = [];
  for (const [c, n] of spec) for (let i = 0; i < n; i++) cents.push(c);
  const arr = Float32Array.from(cents);
  const t = new Float32Array(arr.length);
  const conf = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) { t[i] = i * frameSeconds; conf[i] = arr[i] ? 0.9 : 0; }
  return { t, f0: new Float32Array(arr.length), conf, cents: arr, frameSeconds };
}

test('pitch: segmentNotes splits on an unvoiced gap', () => {
  const notes = segmentNotes(fakeTrack([[6000, 40], [0, 5], [6400, 40]]));
  assertEq(notes.length, 2, 'two notes');
  assertEq(notes[0].name, 'C4', 'first note');
  assertEq(notes[1].name, 'E4', 'second note');
  assert(notes[0].end <= notes[1].start, 'notes do not overlap');
});

test('pitch: segmentNotes splits on a sustained pitch change with no gap', () => {
  const notes = segmentNotes(fakeTrack([[6000, 40], [6400, 40]]));
  assertEq(notes.length, 2, 'a 400-cent step is well past the 60-cent threshold');
  assertEq(notes[0].midi, 60, 'C4');
  assertEq(notes[1].midi, 64, 'E4');
});

test('pitch: segmentNotes ignores a one-frame excursion', () => {
  const notes = segmentNotes(fakeTrack([[6000, 20], [6400, 1], [6000, 20]]));
  assertEq(notes.length, 1, 'one frame off pitch is not a new note');
  assertEq(notes[0].midi, 60, 'the median holds it at C4');
});

test('pitch: segmentNotes drops notes shorter than the floor', () => {
  // 3 frames is ~35 ms, under the 80 ms default.
  const notes = segmentNotes(fakeTrack([[6000, 40], [0, 5], [6400, 3], [0, 5], [6000, 40]]));
  assertEq(notes.length, 2, 'the blip between the two long notes is discarded');
});

test('pitch: segmentNotes reports duration, name and confidence', () => {
  const notes = segmentNotes(fakeTrack([[6900, 43]]));
  assertEq(notes.length, 1, 'one note');
  assertEq(notes[0].name, 'A4', '6900 cents is concert A');
  assertClose(notes[0].end - notes[0].start, 43 * (128 / 11025), 1e-3, 'duration covers every frame');
  assertClose(notes[0].confidence, 0.9, 1e-3, 'mean frame confidence');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Reload `http://localhost:8777/tests/test.html`.
Expected: a module error naming `segmentNotes` as a missing export.

- [ ] **Step 3: Write the implementation**

Append to `lib/pitch.js`:

```js
// ---------------------------------------------------------------- segmentation

export const SEGMENT_DEFAULTS = {
  gapFrames: 2,         // unvoiced frames that end a note
  driftCents: 60,       // departure from the running median that counts as drift
  driftFrames: 3,       // consecutive drifted frames that start a new note
  minDurationMs: 80,    // anything shorter is discarded
};

const medianOf = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s[(s.length - 1) >> 1];
};

/**
 * Turn an f0 track into note events.
 *
 * A note closes on an unvoiced gap of `gapFrames`, or when `driftFrames` consecutive frames
 * sit more than `driftCents` from the running median. Drifted frames are held in a pending
 * buffer rather than pushed into the open note, so a brief excursion that turns out to be a
 * blip can be folded back in without ever having skewed the median.
 */
export function segmentNotes(track, opts = {}) {
  const gapFrames = opts.gapFrames ?? SEGMENT_DEFAULTS.gapFrames;
  const driftCents = opts.driftCents ?? SEGMENT_DEFAULTS.driftCents;
  const driftFrames = opts.driftFrames ?? SEGMENT_DEFAULTS.driftFrames;
  const minDurationMs = opts.minDurationMs ?? SEGMENT_DEFAULTS.minDurationMs;
  const dt = track.frameSeconds;

  const notes = [];
  let open = [];        // [{ c, conf, i }] frames belonging to the note being built
  let pending = [];     // frames that have drifted but not yet long enough to split
  let unvoiced = 0;

  function close() {
    if (!open.length) { pending = []; return; }
    const start = track.t[open[0].i];
    const end = track.t[open[open.length - 1].i] + dt;
    if ((end - start) * 1000 >= minDurationMs) {
      const cents = medianOf(open.map((f) => f.c));
      const midi = midiFromCents(cents);
      const conf = open.reduce((s, f) => s + f.conf, 0) / open.length;
      notes.push({
        start: +start.toFixed(4),
        end: +end.toFixed(4),
        midi,
        cents: +cents.toFixed(1),
        name: noteName(midi),
        confidence: +conf.toFixed(3),
      });
    }
    open = [];
  }

  for (let i = 0; i < track.cents.length; i++) {
    const c = track.cents[i];

    if (c === 0) {
      unvoiced++;
      if (open.length && unvoiced >= gapFrames) { close(); pending = []; }
      continue;
    }
    unvoiced = 0;

    const frame = { c, conf: track.conf[i], i };
    if (!open.length) { open = [frame]; pending = []; continue; }

    if (Math.abs(c - medianOf(open.map((f) => f.c))) > driftCents) {
      pending.push(frame);
      if (pending.length >= driftFrames) {
        close();                 // the old note ends at its own last frame
        open = pending;          // the drifted run becomes the new note
        pending = [];
      }
    } else {
      if (pending.length) { open.push(...pending); pending = []; }   // it was a blip
      open.push(frame);
    }
  }
  close();
  return notes;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.
Expected: five new `PASS` lines, zero failures.

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "Pitch: segment an f0 track into note events"
```

---

## Task 6: `detectNotes` — the public entry point

**Files:**
- Modify: `lib/pitch.js`
- Modify: `tests/pitch.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/pitch.test.js`:

```js
import { detectNotes } from '../lib/pitch.js';

test('pitch: detectNotes finds two notes in synthesised audio at 44.1 kHz', () => {
  const SR = 44100;
  // A3 (220 Hz), a short silence, then C#4 (277.18 Hz).
  const a = sine(220, 0.6, SR);
  // 150 ms, not 80: the 46 ms analysis window means only (gap - window) worth of frames
  // fall entirely inside the silence. An 80 ms gap yields ~2 of them, exactly gapFrames,
  // so the split would sit right on the threshold.
  const gap = new Float32Array(Math.round(0.15 * SR));
  const b = sine(277.18, 0.6, SR);
  const buf = new Float32Array(a.length + gap.length + b.length);
  buf.set(a, 0);
  buf.set(gap, a.length);
  buf.set(b, a.length + gap.length);

  const { notes, frames } = detectNotes([buf], SR);
  assertEq(notes.length, 2, `two notes, got ${notes.map((n) => n.name).join(',')}`);
  assertEq(notes[0].name, 'A3', 'first note');
  assertEq(notes[1].name, 'C#4', 'second note');
  assert(notes[0].end < notes[1].start, 'the silence separates them');
  assert(frames.cents.length > 0, 'diagnostic frames come back too');
});

test('pitch: detectNotes finds nothing in silence', () => {
  const { notes } = detectNotes([new Float32Array(44100)], 44100);
  assertEq(notes.length, 0, 'no notes in silence');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Reload `http://localhost:8777/tests/test.html`.
Expected: a module error naming `detectNotes` as a missing export.

- [ ] **Step 3: Write the implementation**

Append to `lib/pitch.js`:

```js
// ---------------------------------------------------------------- public entry point

/**
 * Notes from a stem.
 *
 * `channels` is an array of Float32Arrays straight off an AudioBuffer; they are averaged to
 * mono inside. `sampleRate` must be the buffer's own rate — the decimation ratio is applied
 * to it rather than assumed, but the tau range is tuned for 44100 in.
 *
 * Every option in YIN_DEFAULTS, TRACK_DEFAULTS and SEGMENT_DEFAULTS can be overridden
 * through `opts`.
 */
export function detectNotes(channels, sampleRate, opts = {}) {
  const dec = decimate(channels, sampleRate, opts.decimation ?? DECIMATION);
  const track = f0Track(dec.samples, dec.sampleRate, opts);
  const notes = segmentNotes(track, opts);
  return { notes, frames: track, sampleRate: dec.sampleRate };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.
Expected: two new `PASS` lines, zero failures.

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "Pitch: detectNotes end-to-end entry point"
```

---

## Task 7: Duration-weighted chroma

**Files:**
- Modify: `lib/pitch.js`
- Modify: `tests/pitch.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/pitch.test.js`:

```js
import { notesToChroma } from '../lib/pitch.js';

test('pitch: notesToChroma weights by duration, not by note count', () => {
  const notes = [
    { start: 0, end: 1, midi: 60, cents: 6000, name: 'C4', confidence: 1 },   // 1 s of C
    { start: 1, end: 4, midi: 67, cents: 6700, name: 'G4', confidence: 1 },   // 3 s of G
  ];
  const chroma = notesToChroma(notes);
  assertEq(chroma.length, 12, 'twelve pitch classes');
  assertClose(chroma[0], 0.25, 1e-6, 'C holds a quarter of the time');
  assertClose(chroma[7], 0.75, 1e-6, 'G holds three quarters');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i];
  assertClose(sum, 1, 1e-6, 'normalised');
});

test('pitch: notesToChroma folds octaves together', () => {
  const notes = [
    { start: 0, end: 1, midi: 60, cents: 6000, name: 'C4', confidence: 1 },
    { start: 1, end: 2, midi: 72, cents: 7200, name: 'C5', confidence: 1 },
  ];
  assertClose(notesToChroma(notes)[0], 1, 1e-6, 'C4 and C5 land in the same bin');
});

test('pitch: notesToChroma survives an empty note list', () => {
  const chroma = notesToChroma([]);
  assertEq(chroma.length, 12, 'still twelve bins');
  for (let i = 0; i < 12; i++) assertClose(chroma[i], 0, 1e-9, 'all zero, no NaN');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Reload `http://localhost:8777/tests/test.html`.
Expected: a module error naming `notesToChroma` as a missing export.

- [ ] **Step 3: Write the implementation**

Append to `lib/pitch.js`:

```js
// ---------------------------------------------------------------- key

/**
 * Duration-weighted pitch-class profile, normalised to sum 1.
 *
 * Weighting by duration rather than by note count is what makes a held tonic outrank a
 * flurry of passing notes. An empty list returns all zeros rather than NaN.
 */
export function notesToChroma(notes) {
  const chroma = new Float32Array(12);
  for (const n of notes) chroma[((n.midi % 12) + 12) % 12] += n.end - n.start;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i];
  if (sum > 0) for (let i = 0; i < 12; i++) chroma[i] /= sum;
  return chroma;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.
Expected: three new `PASS` lines, zero failures.

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "Pitch: duration-weighted chroma from note events"
```

---

## Task 8: Krumhansl-Schmuckler key detection

**Files:**
- Modify: `lib/pitch.js`
- Modify: `tests/pitch.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/pitch.test.js`:

```js
import { detectKey, relativeKey, KS_MAJOR, KS_MINOR } from '../lib/pitch.js';

function rotate(profile, tonic) {
  const out = new Float32Array(12);
  for (let i = 0; i < 12; i++) out[i] = profile[(i - tonic + 12) % 12];
  return out;
}

test('pitch: relativeKey pairs each key with its relative', () => {
  assertEq(relativeKey(0, 'major').tonic, 9, 'C major -> A minor');
  assertEq(relativeKey(0, 'major').mode, 'minor', 'mode flips');
  assertEq(relativeKey(9, 'minor').tonic, 0, 'A minor -> C major');
  assertEq(relativeKey(7, 'major').tonic, 4, 'G major -> E minor');
});

test('pitch: detectKey recovers the profile it was built from', () => {
  assertEq(detectKey(rotate(KS_MAJOR, 0)).key, 'C major', 'C major profile');
  assertEq(detectKey(rotate(KS_MINOR, 9)).key, 'A minor', 'A minor profile');
  assertEq(detectKey(rotate(KS_MAJOR, 7)).key, 'G major', 'G major profile');
});

test('pitch: detectKey reports its relative and a positive margin', () => {
  const r = detectKey(rotate(KS_MAJOR, 0));
  assertEq(r.relative, 'A minor', 'the caveat names the relative minor');
  assertEq(r.tonic, 0, 'tonic pitch class');
  assertEq(r.mode, 'major', 'mode');
  assert(r.margin > 0, 'the winner beats the runner-up');
});

test('pitch: detectKey ranks descending and returns five candidates', () => {
  const r = detectKey(rotate(KS_MINOR, 9));
  assertEq(r.ranked.length, 5, 'top five');
  for (let i = 1; i < r.ranked.length; i++) {
    assert(r.ranked[i - 1].score >= r.ranked[i].score, `ranked descending at ${i}`);
  }
  assertClose(r.margin, r.ranked[0].score - r.ranked[1].score, 1e-6, 'margin is the gap to second');
});

test('pitch: detectKey survives an all-zero chroma', () => {
  const r = detectKey(new Float32Array(12));
  assertEq(typeof r.key, 'string', 'still returns a key rather than throwing');
  assertClose(r.ranked[0].score, 0, 1e-6, 'a flat profile correlates with nothing');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Reload `http://localhost:8777/tests/test.html`.
Expected: a module error naming `detectKey` / `relativeKey` / `KS_MAJOR` as missing exports.

- [ ] **Step 3: Write the implementation**

Append to `lib/pitch.js`:

```js
/* Krumhansl-Kessler profiles: the perceived stability of each scale degree, indexed from
 * the tonic. Correlating a piece's pitch-class profile against all 24 rotations is the
 * standard Krumhansl-Schmuckler key-finding algorithm. */
export const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
export const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const PITCH_CLASS_NAMES = NOTE_NAMES;

function pearson(a, b) {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; }
  ma /= 12;
  mb /= 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** The relative major of a minor key, or the relative minor of a major one. */
export function relativeKey(tonic, mode) {
  return mode === 'major'
    ? { tonic: (tonic + 9) % 12, mode: 'minor' }
    : { tonic: (tonic + 3) % 12, mode: 'major' };
}

/**
 * Krumhansl-Schmuckler key estimation from a 12-bin pitch-class profile.
 *
 * The input is a bare 12-vector on purpose: it does not matter whether it came from
 * notesToChroma over a vocal or, later, from a chromagram over the bass stem.
 *
 * `margin` is the gap to the runner-up and is the number to read before trusting the
 * answer. A key and its relative share all seven pitch classes, so they are separated only
 * by which degrees carry weight — `relative` names the one most likely to have been
 * confused with the winner.
 */
export function detectKey(chroma) {
  const ranked = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, profile] of [['major', KS_MAJOR], ['minor', KS_MINOR]]) {
      const rotated = new Float32Array(12);
      for (let i = 0; i < 12; i++) rotated[i] = profile[(i - tonic + 12) % 12];
      ranked.push({
        tonic,
        mode,
        key: `${PITCH_CLASS_NAMES[tonic]} ${mode}`,
        score: +pearson(chroma, rotated).toFixed(4),
      });
    }
  }
  ranked.sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const rel = relativeKey(top.tonic, top.mode);
  return {
    key: top.key,
    tonic: top.tonic,
    mode: top.mode,
    score: top.score,
    margin: +(top.score - ranked[1].score).toFixed(4),
    relative: `${PITCH_CLASS_NAMES[rel.tonic]} ${rel.mode}`,
    ranked: ranked.slice(0, 5),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.
Expected: five new `PASS` lines. The whole suite is green — `window.__testResults.failed` is 0.

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "Pitch: Krumhansl-Schmuckler key detection with a confidence margin"
```

---

## Task 9: The bench page

**Files:**
- Create: `tests/notes.html`

- [ ] **Step 1: Write the page**

Create `tests/notes.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>sans_bass — notes &amp; key</title>
<style>
  body { background:#0d0d10; color:#e9e9ef; font:13px ui-monospace,Menlo,monospace; padding:24px; }
  pre { background:#141419; padding:14px; border-radius:8px; white-space:pre-wrap; line-height:1.6; }
  code { color:#9ad; }
</style>
</head>
<body>
<h1>notes &amp; key</h1>
<p>Set <code>?track=12 早安台灣</code> for another song, <code>?stem=bass</code> for another stem.
   Any numeric option is overridable, e.g. <code>?driftCents=80&amp;minDurationMs=120</code>.</p>
<pre id="out">running…</pre>
<script type="module">
import { detectNotes, notesToChroma, detectKey } from '../lib/pitch.js';

const out = document.getElementById('out');
const SR = 44100;
const params = new URLSearchParams(location.search);
const TRACK = params.get('track') || '6 南國的風';
const STEM = params.get('stem') || 'vocals';
const URL = `/stems/reborn/${TRACK}/${STEM}.m4a`;

// Sweeping thresholds from the query string beats editing the module between runs.
const TUNABLE = ['window', 'hop', 'tauMin', 'tauMax', 'threshold', 'minConfidence',
                 'silenceDb', 'medianSpan', 'gapFrames', 'driftCents', 'driftFrames',
                 'minDurationMs'];
const opts = {};
for (const k of TUNABLE) if (params.has(k)) opts[k] = Number(params.get(k));

const log = (s = '') => { out.textContent += s + '\n'; };

async function decode(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  // 44.1 kHz explicitly. decodeAudioData resamples to the context rate, and a default
  // context is often 48 kHz on macOS — which would silently shift every detected pitch.
  const ctx = new AudioContext({ sampleRate: SR });
  const buf = await ctx.decodeAudioData(await res.arrayBuffer());
  await ctx.close();
  return buf;
}

const mmss = (t) => {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(3).padStart(6, '0')}`;
};

out.textContent = '';
log(`decoding ${URL}`);
const buf = await decode(URL);
const channels = [];
for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
log(`  ${buf.duration.toFixed(1)}s @ ${buf.sampleRate} Hz, ${buf.numberOfChannels} ch`);
if (Object.keys(opts).length) log(`  options: ${JSON.stringify(opts)}`);

const t0 = performance.now();
const { notes, frames } = detectNotes(channels, buf.sampleRate, opts);
const seconds = (performance.now() - t0) / 1000;

let voiced = 0;
for (const c of frames.cents) if (c !== 0) voiced++;
log(`  ${frames.cents.length} frames, ${voiced} voiced (${Math.round((100 * voiced) / frames.cents.length)}%), ` +
    `${notes.length} notes in ${seconds.toFixed(1)}s`);

const key = detectKey(notesToChroma(notes));

log('\n== KEY ==');
log(`${key.key}    score ${key.score.toFixed(3)}    margin ${key.margin.toFixed(3)} over ${key.ranked[1].key}`);
log(`relative: ${key.relative} — shares all seven pitch classes with ${key.key}.`);
log(`ranked:   ${key.ranked.map((r) => `${r.key} ${r.score.toFixed(3)}`).join('   ')}`);

log('\n== PHRASES ==   (a new line on any gap over 300 ms)');
let line = [];
let prevEnd = null;
for (const n of notes) {
  if (prevEnd !== null && n.start - prevEnd > 0.3) { log('  ' + line.join(' ')); line = []; }
  line.push(n.name);
  prevEnd = n.end;
}
if (line.length) log('  ' + line.join(' '));

log('\n== NOTES ==');
log(['   #', '    start', '   dur', 'note ', ' midi', '  dev', '  conf'].join(' '));
notes.forEach((n, i) => {
  const dev = Math.round(n.cents - n.midi * 100);
  log([
    String(i).padStart(4),
    mmss(n.start).padStart(9),
    String(Math.round((n.end - n.start) * 1000)).padStart(6),
    n.name.padEnd(5),
    String(n.midi).padStart(5),
    ((dev > 0 ? '+' : '') + dev).padStart(5),
    n.confidence.toFixed(2).padStart(6),
  ].join(' '));
});

// A consistent offset across every note means the record sits off A440. Without this line
// the detector takes the blame for what is really a tuning difference.
const meanDev = notes.length
  ? notes.reduce((s, n) => s + (n.cents - n.midi * 100), 0) / notes.length
  : 0;
log(`\nmean deviation ${meanDev > 0 ? '+' : ''}${meanDev.toFixed(1)} cents from equal temperament.`);

window.__notes = {
  track: TRACK, stem: STEM, opts,
  seconds: +seconds.toFixed(1),
  frameCount: frames.cents.length,
  voicedFrames: voiced,
  noteCount: notes.length,
  meanDeviationCents: +meanDev.toFixed(1),
  key,
  notes,
};
console.log('[notes]', JSON.stringify({ ...window.__notes, notes: `${notes.length} notes` }));
</script>
</body>
</html>
```

- [ ] **Step 2: Run it**

With `./scripts/serve.sh` running, open `http://localhost:8777/tests/notes.html`.

Expected: a decode line, a frame/note count, a `== KEY ==` block, a `== PHRASES ==` block of note names, and a `== NOTES ==` table. `window.__notes` is populated.

If the fetch 404s, check the track name against `ls stems/reborn/` — the default is `6 南國的風`.

- [ ] **Step 3: Commit**

```bash
git add tests/notes.html
git commit -m "Pitch: bench page for notes and key against a real stem"
```

---

## Task 10: Manual verification against a guitar

This task has no code. It is the reason the PoC exists, and its outcome decides whether the feature goes further.

**Files:** none. Findings go into the devlog in Task 11.

- [ ] **Step 1: Run the bench page on at least three tracks**

```bash
ls stems/reborn/          # pick three with distinct vocal styles
```

Open `http://localhost:8777/tests/notes.html?track=<name>` for each.

- [ ] **Step 2: Check the key block**

For each track, compare the reported key against the song as you know it. Record the key, the margin, and whether the true key was the reported `relative`. A wrong answer with a margin under ~0.05 is the expected failure and is the case bass chromagram would fix; a wrong answer with a large margin is a different and worse problem.

- [ ] **Step 3: Check the phrase view on the guitar**

Play the first two or three phrase lines. Record which of these you see, since each points at a different fix:

- Notes correct but fragmented into repeats → vibrato is beating the 60-cent threshold. Retry with `?driftCents=100&minDurationMs=150`.
- Extra short notes between real ones → portamento. Retry with `?minDurationMs=150`.
- Notes an octave off → YIN octave error survived the median filter. Retry with `?medianSpan=9`.
- A consistent nonzero mean deviation → the record is off A440; the detector is fine.
- Notes missing entirely in quiet passages → the silence floor is too high. Retry with `?silenceDb=-60`.

- [ ] **Step 4: Record the verdict**

Write down, for the devlog: the three tracks, the key result for each, which failure modes appeared, and which option overrides improved things. If a non-default option was clearly better on all three, change the default in `lib/pitch.js` and commit that separately with the evidence in the commit message.

---

## Task 11: Docs, version, and devlog

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/devlog.md`

`index.html`, `separate.js` and `separate.worker.js` are deliberately **not** touched. See
Step 2.

- [ ] **Step 1: Add the new files to the repo layout in `CLAUDE.md`**

In the "Repo layout" code block, after the `lib/{wav,zip,overlap}.js` line:

```
lib/pitch.js                       ESM — YIN pitch tracking, note segmentation, key
```

And in the same block, after the `tests/parity.html` line:

```
tests/notes.html                   notes+key → window.__notes
```

- [ ] **Step 2: Leave the `?v=` asset version at v1.9.0**

Do not bump it, and do not change `Currently v1.9.0.` in `CLAUDE.md`. This is what the spec calls for, and the reasoning is worth keeping straight: `?v=` exists to stop a returning visitor running a stale `app.js` against fresh markup during the ten minutes GitHub Pages serves cached assets. Nothing `index.html` loads changes in this PR, so a bump would invalidate every visitor's cache to no purpose. `tests/versions.test.js` checks that the asset URLs agree **with each other**, so leaving them all at v1.9.0 keeps it green.

The devlog entry is still v1.10.0. The asset version catches up in the commit that wires the module into the app.

- [ ] **Step 3: Verify the whole suite is still green**

Reload `http://localhost:8777/tests/test.html`.
Expected: `window.__testResults.failed` is 0, `versions` tests included.

- [ ] **Step 4: Add the devlog entry**

Get the timestamp from git:

```bash
git log -1 --format='%cd' --date=format:'%Y-%m-%d %H:%M'
```

Add a TL;DR row at the top of `docs/devlog.md`, above the v1.9.0 row:

```markdown
| [v1.10.0](#v1100--notes-and-key-from-a-vocal-stem-YYYY-MM-DD-HHMM) | Notes and key detection from a stem: decimated YIN, segmentation, Krumhansl-Schmuckler. Bench page only, no UI. |
```

Then the entry itself, newest-first at the top of the entries:

```markdown
## v1.10.0 — Notes and key from a vocal stem (YYYY-MM-DD HH:MM)

**Review:** not yet

**Design docs:**
- Notes and key detection: [Spec](superpowers/specs/2026-08-30-pitch-detection-design.md) [Plan](superpowers/plans/2026-08-30-pitch-detection.md)

**What was built:**
- `lib/pitch.js` — pure ESM: 4:1 anti-aliased decimation, YIN, voicing gate and median
  smoothing, note segmentation, duration-weighted chroma, Krumhansl-Schmuckler key.
- `tests/pitch.test.js` — units over synthesised input, no audio files.
- `tests/notes.html` — bench page: key block, phrase view, note table, `window.__notes`.
- No UI, no app wiring. Separation is unchanged, and the `?v=` asset version stays at
  v1.9.0 because nothing `index.html` loads was touched.

**Key technical learnings:**
- `[insight]` Decimating to 11025 Hz before YIN is what makes pure-DSP pitch tracking
  viable here. The lag search is 16x cheaper, taking a 4-minute track from ~2.1e10
  operations to ~1.3e9 — seconds rather than a minute — so no model download is needed.
- `[gotcha]` Decimating without an anti-alias lowpass folds everything above 5512 Hz into
  the f0 search range, where it is indistinguishable from a real fundamental. The 63-tap
  windowed sinc is load-bearing, not polish.
- `[gotcha]` YIN's cumulative mean must be accumulated from tau = 1 even when the search
  starts at tauMin. Starting the running mean at tauMin changes the normalisation and moves
  the threshold comparison, which shows up as systematically wrong octaves.
- `[insight]` A key and its relative share all seven pitch classes, so a vocal melody alone
  often cannot separate them. Reporting the margin to the runner-up turns a silent wrong
  answer into a visible uncertain one. The real fix is the bass stem, whose notes land on
  chord roots — something only a stem player can reach for.
- `[note]` Duration-weighted chroma, rather than note counts, is what lets a held tonic
  outrank a flurry of passing notes.

<!-- Replace this comment with the Task 10 findings: the three tracks, their key results
     and margins, which failure modes appeared, and any default that changed as a result. -->
```

Fill in the real timestamp in both the heading and the TL;DR anchor, and replace the trailing comment with the Task 10 findings.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/devlog.md
git commit -m "Docs: v1.10.0 devlog entry and repo layout"
```

- [ ] **Step 6: Open the PR**

```bash
git push -u origin spike/pitch-detection
gh pr create --title "Notes and key detection from a stem (v1.10.0)" --body "$(cat <<'EOF'
## Summary

`lib/pitch.js`: a pure ESM module that turns an isolated stem into note events and a key
estimate. Decimated YIN pitch tracking, note segmentation, and Krumhansl-Schmuckler key
detection. No model, no download, no network — roughly 370 lines of DSP over buffers the
app already decodes.

This is the proof of concept from the design doc. **No UI, no app wiring**, so player
behaviour is unchanged and `docs/behaviour.md` is untouched.

## Verifying

- Units: `./scripts/serve.sh`, then `/tests/test.html` — the suite must be fully green.
- By hand: `/tests/notes.html?track=6 南國的風` — read the phrase view against a guitar.

## Docs

- Spec: `docs/superpowers/specs/2026-08-30-pitch-detection-design.md`
- Plan: `docs/superpowers/plans/2026-08-30-pitch-detection.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Deferred

From the spec, kept out of this plan on purpose: sonification, the bass chromagram, beat
tracking on the drums stem, 簡譜 rendering, the pitch ribbon, and export. Each waits on the
Task 10 verdict.
