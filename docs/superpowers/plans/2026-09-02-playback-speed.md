# Playback Speed Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user slow down or speed up playback (50%–150%, pitch held constant) while
practising, with zero regression to today's playback at exactly 100%.

**Architecture:** Two playback paths selected by whether the rate is 100%. At 100%, `play()`
builds native `BufferSource`s exactly as it does today. Away from 100%, each stem's source is
a custom `AudioWorkletNode` ("stretch node") wrapping a vendored, pure-JS pitch-preserving
time-stretch core (SoundTouchJS), fed a copy of the stem's decoded PCM and driven by the same
`t0`/`LOOKAHEAD` scheduling the native path already uses, so all six stems stay sample-locked
either way. Crossing the 100% boundary rebuilds the audio graph (`stop()` → `play()`, the same
pattern `seek()`/`refreshLoop()` already use); changing rate while already stretched rebases
the clock and pushes a live message to the running nodes instead — no audible restart.

**Tech Stack:** Vanilla JS, Web Audio API (`AudioWorkletNode`/`AudioWorkletProcessor`),
vendored SoundTouchJS DSP core (LGPL-2.1, static file — no npm). No build step.

**Spec:** [`docs/superpowers/specs/2026-09-02-playback-speed-design.md`](../specs/2026-09-02-playback-speed-design.md)

## Global Constraints

- No build step, no bundler, no npm. The vendored SoundTouch core and the worklet processor
  are static files loaded the same way `separate.js` already loads the ONNX runtime.
- No audio egress. This feature adds no new analytics events.
- No `SharedArrayBuffer` (GitHub Pages cannot set COOP/COEP) — the worklet gets a **copy** of
  each stem's decoded channel data, not a shared view. This is accepted, not avoided (see the
  spec's "Memory cost" section).
- `AudioContext` stays at 44100 Hz — unchanged, still relied on.
- Rate range is 50–150%, step 5. It is **never persisted**: always 100% the moment a song
  loads, in both `loadFiles()` and `loadSeparated()`.
- Version target for this feature is **v1.19.0** (a main release per this project's semver
  convention — three-part, `vX.Y.0` for a new feature). Every `?v=` reference in the whole
  site must read `1.19.0` when Task 10 is done; `tests/versions.test.js` enforces it.
- `lib/i18n.js` needs every new string in **both** `en` and `zh-TW`, in the same commit
  (`tests/i18n.test.js` enforces parity). Stem ids and filenames still never translate — not
  touched by this feature.
- Manual/browser verification is **one** consolidated task at the end (Task 12), not embedded
  per-task. Every other task is verified with a unit test only, per this project's convention.

## File structure

New files:
- `lib/vendor/soundtouch-core.js` — vendored DSP classes only (`SoundTouch`, `SimpleFilter`,
  and whatever they depend on), adapted to ES module exports.
- `lib/vendor/LICENSE-soundtouchjs` — LGPL-2.1 license text + source URL.
- `lib/stretch-processor.js` — the `AudioWorkletProcessor` (`registerProcessor`), our own code,
  importing the vendored core.
- `lib/transport-math.js` — new classic-script module (`window.SansTransportMath`) holding the
  playback-speed **pure functions** factored out of `app.js`, the same pattern `lib/ribbon.js`
  and `lib/jianpu.js` already use for testable math. This is what makes `currentTime()`'s
  rate-scaling and the rate-clamping logic unit-testable at all, since `app.js` itself is a
  classic script with no test harness of its own.
- `tests/soundtouch.test.js`, `tests/transport-math.test.js` — new test files.

Modified files: `app.js`, `index.html`, `lib/i18n.js`, `lib/sonify.js`, `notes.js`,
`tests/sonify.test.js`, `tests/test.html`, `tests/versions.test.js`, `README.md`,
`docs/behaviour.md`, `CLAUDE.md`.

The per-stem stretch-node wrapper lives as a section of `app.js`, not a separate module.
`app.js` already owns `tracks`/`sources`/gain routing and is tightly coupled to this feature's
`play()`/`stop()` branching; a separate ES module would need a `window.sansBass`-style bridge
for state that changes every render quantum, for no benefit — `lib/ribbon.js`-style extraction
is for genuinely pure, stateless math (which is exactly what `lib/transport-math.js` is for).

---

### Task 1: Vendor the SoundTouch DSP core

**Files:**
- Create: `lib/vendor/soundtouch-core.js`
- Create: `lib/vendor/LICENSE-soundtouchjs`
- Test: `tests/soundtouch.test.js`

**Interfaces:**
- Produces: `export class SoundTouch` with a settable `.tempo` property (a ratio; `1` = normal
  speed, `0.5` = half speed, `1.5` = 1.5×) that time-stretches **without** shifting pitch —
  never set `.rate` or `.pitch`, either of which changes pitch, defeating the entire feature.
  `export class SimpleFilter`, constructed as `new SimpleFilter(source, pipe)` where `source`
  implements `extract(target: Float32Array, numFrames: number, position: number): number`
  (`target` is interleaved stereo, `[L0, R0, L1, R1, ...]`; return value is frames actually
  written) and `pipe` is a `SoundTouch` instance. `filter.extract(target, numFrames)` pulls
  `numFrames` of **stretched** interleaved stereo output, calling `source.extract()` as needed
  to keep itself fed. Used by Task 3.

- [ ] **Step 1: Fetch the upstream source**

  SoundTouchJS (github.com/cutterbl/SoundTouchJS) is LGPL-2.1 licensed. Use WebSearch/WebFetch to
  find the repository and locate its DSP-core source files under `src/` — the ones that
  implement `SoundTouch`, `SimpleFilter`, `RateTransposer`, `Stretch`, `FifoSampleBuffer`, and
  `AbstractFifoSamplePipe`. Do **not** pull in the library's `getWebAudioNode`/
  `WebAudioBufferSource` wrapper (a `ScriptProcessorNode` shim) — the spec is explicit that
  only the pure algorithm is vendored; `lib/stretch-processor.js` (Task 3) is our own
  replacement for that wrapper, built on `AudioWorkletProcessor` instead.

- [ ] **Step 2: Combine and adapt into one file**

  Concatenate the fetched classes into `lib/vendor/soundtouch-core.js`, in dependency order
  (lowest-level buffer/pipe classes first). Keep each file's exports as ES module `export
  class ...` (adapt import/export syntax as needed — the upstream source may already be ESM).
  End the file with:
  ```js
  export { SoundTouch, SimpleFilter };
  ```
  Keep the LGPL-2.1 license header comment from the upstream source at the top of the file, and
  add a one-line project comment above it:
  ```js
  /* Vendored from SoundTouchJS (github.com/cutterbl/SoundTouchJS), LGPL-2.1 licensed. DSP
   * core only — no ScriptProcessorNode wrapper; lib/stretch-processor.js is this project's own
   * AudioWorkletProcessor built on top of it. See lib/vendor/LICENSE-soundtouchjs. */
  ```

- [ ] **Step 3: Add the license file**

  Create `lib/vendor/LICENSE-soundtouchjs` containing the LGPL-2.1 license text as published in the
  SoundTouchJS repository, plus a line recording the source URL
  (`https://github.com/cutterbl/SoundTouchJS`) and the date vendored.

- [ ] **Step 4: Write the smoke test**

  Create `tests/soundtouch.test.js`:
  ```js
  import { test, assert } from './assert.js';
  import { SoundTouch, SimpleFilter } from '../lib/vendor/soundtouch-core.js';

  const SR = 44100;

  function makeSineSource(freqHz, totalFrames) {
    return {
      extract(target, numFrames, position) {
        let n = 0;
        for (; n < numFrames; n++) {
          const idx = position + n;
          if (idx >= totalFrames) break;
          const t = idx / SR;
          const v = Math.sin(2 * Math.PI * freqHz * t) * 0.5;
          target[n * 2] = v;
          target[n * 2 + 1] = v;
        }
        return n;
      },
    };
  }

  function magnitudeAt(interleaved, hz, frames) {
    let re = 0, im = 0;
    for (let i = 0; i < frames; i++) {
      const s = interleaved[i * 2];
      const t = i / SR;
      re += s * Math.cos(2 * Math.PI * hz * t);
      im += s * Math.sin(2 * Math.PI * hz * t);
    }
    return Math.sqrt(re * re + im * im) / frames;
  }

  test('soundtouch: tempo 0.5 preserves pitch while roughly doubling the frames produced', () => {
    const freq = 440;
    const totalFrames = SR * 1;   // 1 second of a 440 Hz tone
    const soundtouch = new SoundTouch();
    soundtouch.tempo = 0.5;
    const filter = new SimpleFilter(makeSineSource(freq, totalFrames), soundtouch);

    const chunk = 1024;
    const collected = [];
    let framesOut = 0;
    for (let guard = 0; guard < (SR * 4) / chunk; guard++) {
      const buf = new Float32Array(chunk * 2);
      const n = filter.extract(buf, chunk);
      if (n === 0) break;
      collected.push(buf.subarray(0, n * 2));
      framesOut += n;
    }
    assert(framesOut > totalFrames * 1.6,
      `half tempo roughly doubles output frames (got ${framesOut} from ${totalFrames} input frames)`);

    const merged = new Float32Array(framesOut * 2);
    let off = 0;
    for (const c of collected) { merged.set(c, off); off += c.length; }
    const mag440 = magnitudeAt(merged, 440, framesOut);
    const mag220 = magnitudeAt(merged, 220, framesOut);   // an octave down — naive slowdown
    assert(mag440 > 3 * mag220,
      `stretched output stays at 440 Hz, not pitched down to 220 Hz (${mag440.toFixed(4)} vs ${mag220.toFixed(4)})`);
  });

  test('soundtouch: tempo 1 leaves pitch and roughly the input length alone', () => {
    const freq = 440;
    const totalFrames = SR * 1;
    const soundtouch = new SoundTouch();
    soundtouch.tempo = 1;
    const filter = new SimpleFilter(makeSineSource(freq, totalFrames), soundtouch);

    const chunk = 1024;
    const collected = [];
    let framesOut = 0;
    for (let guard = 0; guard < (SR * 2) / chunk; guard++) {
      const buf = new Float32Array(chunk * 2);
      const n = filter.extract(buf, chunk);
      if (n === 0) break;
      collected.push(buf.subarray(0, n * 2));
      framesOut += n;
    }
    assert(Math.abs(framesOut - totalFrames) < totalFrames * 0.15,
      `tempo 1 output length tracks input length (got ${framesOut} from ${totalFrames})`);

    const merged = new Float32Array(framesOut * 2);
    let off = 0;
    for (const c of collected) { merged.set(c, off); off += c.length; }
    const mag440 = magnitudeAt(merged, 440, framesOut);
    const mag220 = magnitudeAt(merged, 220, framesOut);
    assert(mag440 > 3 * mag220, 'pitch is unchanged at tempo 1');
  });
  ```
  If the vendored source exposes `SoundTouch`/`SimpleFilter` under different property or
  method names than `.tempo` / `.extract(target, numFrames)`, adjust this test (and the
  class names/usage above) to match what was actually fetched — the assertions ("pitch stays
  put, output length scales with tempo") are the real contract; the exact accessor names are
  whatever upstream calls them.

- [ ] **Step 5: Wire the test into the suite**

  In `tests/test.html`, add:
  ```html
  await import('./soundtouch.test.js');
  ```
  next to the other `await import(...)` lines.

- [ ] **Step 6: Run and verify**

  Start `./scripts/serve.sh` if it isn't running, open
  `http://localhost:8777/tests/test.html`, and confirm the output shows both new
  `soundtouch:` tests passing with no `FAIL` lines anywhere on the page.

- [ ] **Step 7: Commit**

  ```bash
  git add lib/vendor/soundtouch-core.js lib/vendor/LICENSE-soundtouchjs \
          tests/soundtouch.test.js tests/test.html
  git commit -m "feat: vendor SoundTouchJS DSP core for pitch-preserving time-stretch"
  ```

---

### Task 2: `lib/transport-math.js` — pure rate/time math

**Files:**
- Create: `lib/transport-math.js`
- Test: `tests/transport-math.test.js`
- Modify: `tests/test.html`

**Interfaces:**
- Produces: `window.SansTransportMath` with `RATE_MIN` (50), `RATE_MAX` (150), `RATE_STEP`
  (5), `RATE_DEFAULT` (100), `clampRatePercent(n)`, `nudgeRatePercent(ratePercent,
  deltaPercent)`, `currentTimeAtRate({ offset, elapsed, ratePercent, loopA, loopB, duration })`.
  Consumed by `app.js` in Task 6 (`currentTime()`) and Task 7 (`setRate()`, keyboard nudges).

- [ ] **Step 1: Write the module**

  Create `lib/transport-math.js`:
  ```js
  /* Pure playback-speed math, factored out of app.js so it is unit-testable — app.js is a
   * classic script with no test harness of its own, the same reason lib/ribbon.js and
   * lib/jianpu.js exist. Loaded as a classic script, exactly like those two. */
  window.SansTransportMath = (function () {
    const RATE_MIN = 50;
    const RATE_MAX = 150;
    const RATE_STEP = 5;
    const RATE_DEFAULT = 100;

    /** Clamp to [RATE_MIN, RATE_MAX] and snap to the nearest RATE_STEP. */
    function clampRatePercent(n) {
      const snapped = Math.round(n / RATE_STEP) * RATE_STEP;
      return Math.max(RATE_MIN, Math.min(RATE_MAX, snapped));
    }

    /** ratePercent nudged by deltaPercent (e.g. ±5 for [ / ]), clamped and snapped. */
    function nudgeRatePercent(ratePercent, deltaPercent) {
      return clampRatePercent(ratePercent + deltaPercent);
    }

    /** Mirrors app.js's currentTime(), with the rate applied to elapsed real time. At
     *  ratePercent === 100 this is exactly the pre-existing (unscaled) formula — no branch
     *  needed, the same way the design spec describes it. */
    function currentTimeAtRate({ offset, elapsed, ratePercent, loopA, loopB, duration }) {
      const scaled = elapsed * (ratePercent / 100);
      if (loopA !== null && loopB !== null) {
        const span = loopB - loopA;
        return loopA + ((offset - loopA + scaled) % span);
      }
      return Math.min(duration, offset + scaled);
    }

    return { RATE_MIN, RATE_MAX, RATE_STEP, RATE_DEFAULT,
             clampRatePercent, nudgeRatePercent, currentTimeAtRate };
  })();
  ```

- [ ] **Step 2: Write the failing tests**

  Create `tests/transport-math.test.js`:
  ```js
  import { test, assertEq, assertClose } from './assert.js';
  const M = window.SansTransportMath;

  test('transport-math: clampRatePercent snaps to the nearest step and clamps to range', () => {
    assertEq(M.clampRatePercent(100), 100);
    assertEq(M.clampRatePercent(103), 105, 'snaps to the nearest 5');
    assertEq(M.clampRatePercent(102), 100, 'snaps down when closer to the lower step');
    assertEq(M.clampRatePercent(200), 150, 'clamped to the max');
    assertEq(M.clampRatePercent(0), 50, 'clamped to the min');
  });

  test('transport-math: nudgeRatePercent moves by exactly one step and stays in range', () => {
    assertEq(M.nudgeRatePercent(100, 5), 105);
    assertEq(M.nudgeRatePercent(100, -5), 95);
    assertEq(M.nudgeRatePercent(150, 5), 150, 'does not overshoot the max');
    assertEq(M.nudgeRatePercent(50, -5), 50, 'does not undershoot the min');
  });

  test('transport-math: currentTimeAtRate at 100% matches the un-rate-scaled formula', () => {
    const t = M.currentTimeAtRate({ offset: 10, elapsed: 2, ratePercent: 100, loopA: null, loopB: null, duration: 300 });
    assertClose(t, 12, 1e-9);
  });

  test('transport-math: currentTimeAtRate at 50% advances the song at half speed', () => {
    const t = M.currentTimeAtRate({ offset: 10, elapsed: 2, ratePercent: 50, loopA: null, loopB: null, duration: 300 });
    assertClose(t, 11, 1e-9, '2s of real time at half speed is 1s of song time');
  });

  test('transport-math: currentTimeAtRate at 150% advances the song at 1.5x', () => {
    const t = M.currentTimeAtRate({ offset: 0, elapsed: 2, ratePercent: 150, loopA: null, loopB: null, duration: 300 });
    assertClose(t, 3, 1e-9);
  });

  test('transport-math: currentTimeAtRate is capped at duration when not looping', () => {
    const t = M.currentTimeAtRate({ offset: 295, elapsed: 10, ratePercent: 100, loopA: null, loopB: null, duration: 300 });
    assertEq(t, 300);
  });

  test('transport-math: currentTimeAtRate wraps inside the loop at a scaled pace', () => {
    // loop [10,12): offset 11, 3s real elapsed at 50% = 1.5s song time -> 12.5, wraps to 10.5.
    const t = M.currentTimeAtRate({ offset: 11, elapsed: 3, ratePercent: 50, loopA: 10, loopB: 12, duration: 300 });
    assertClose(t, 10.5, 1e-9);
  });
  ```

- [ ] **Step 3: Wire it into the suite**

  Add `<script src="../lib/transport-math.js"></script>` to `tests/test.html` next to the
  other classic-script `<script>` tags, and `await import('./transport-math.test.js');` next
  to the other `await import(...)` lines.

- [ ] **Step 4: Run and verify**

  Open `http://localhost:8777/tests/test.html` and confirm all `transport-math:` tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add lib/transport-math.js tests/transport-math.test.js tests/test.html
  git commit -m "feat: add pure rate/time math for playback speed"
  ```

---

### Task 3: `lib/stretch-processor.js` — the AudioWorkletProcessor

**Files:**
- Create: `lib/stretch-processor.js`

**Interfaces:**
- Consumes: `SoundTouch`, `SimpleFilter` from `lib/vendor/soundtouch-core.js` (Task 1).
- Produces: a processor registered as `'stretch-processor'`, driven by `port.postMessage`
  with three message shapes, consumed by `app.js` in Task 5:
  - `{ type: 'load', channels: Float32Array[] }` — one array per audio channel, sent once.
  - `{ type: 'start', t0: number, offsetSample: number, loopASample: number|null,
    loopBSample: number|null, rate: number }` — `t0` is an `AudioContext.currentTime` in the
    future (mirrors native `BufferSource.start(t0, offset)`); the node stays silent until
    `currentTime >= t0`, then starts reading from `offsetSample`.
  - `{ type: 'setRate', rate: number }` — live rate change, no restart.
  - The node posts `{ type: 'ended' }` back exactly once, when its input is exhausted and it
    is not looping — the stretched-path equivalent of native `BufferSource.onended`.

No automated test for this task: per the spec's "Testing" section, the worklet's actual audio
behavior is covered by the consolidated manual pass (Task 12), not a unit test — an
`AudioWorkletProcessor` runs on the audio thread and there is no meaningful way to assert on
its output from a pure-function test the way Task 1's smoke test could for the DSP core alone.

- [ ] **Step 1: Write the processor**

  Create `lib/stretch-processor.js`:
  ```js
  /* AudioWorkletProcessor wrapping the vendored SoundTouch DSP core (lib/vendor/
   * soundtouch-core.js) — this project's own replacement for that library's
   * ScriptProcessorNode wrapper, which is not vendored. One instance per stem; app.js
   * creates one per track when the active rate is not 100%. See the design spec's
   * "Architecture" and "Loop wrap inside the worklet" sections. */
  import { SoundTouch, SimpleFilter } from './vendor/soundtouch-core.js?v=1.19.0';

  class StretchProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.channels = null;       // Float32Array[] — this stem's own copy of its PCM
      this.totalSamples = 0;
      this.loopASample = null;
      this.loopBSample = null;
      this.exhausted = false;     // input ran past totalSamples with no loop configured
      this.endedPosted = false;
      this.playing = false;
      this.startAt = 0;           // AudioContext time to begin producing sound

      this.soundtouch = new SoundTouch();
      this.soundtouch.tempo = 1;
      this.filter = null;

      this.port.onmessage = (e) => this.handleMessage(e.data);
    }

    /** Maps an ever-increasing virtual read position onto the fixed PCM copy, wrapping
     *  [loopASample, loopBSample) the way native BufferSource.loop does — on the INPUT side
     *  of the stretch pipeline, since the pipeline itself has no notion of the song looping. */
    readAt(idx) {
      if (this.loopBSample !== null && idx >= this.loopBSample) {
        const span = this.loopBSample - this.loopASample;
        idx = this.loopASample + ((idx - this.loopBSample) % span);
      }
      return idx;
    }

    handleMessage(msg) {
      if (msg.type === 'load') {
        this.channels = msg.channels;
        this.totalSamples = this.channels[0].length;
        const self = this;
        this.filter = new SimpleFilter({
          extract(target, numFrames, position) {
            let n = 0;
            for (; n < numFrames; n++) {
              const idx = self.readAt(position + n);
              if (idx >= self.totalSamples) { self.exhausted = true; break; }
              target[n * 2] = self.channels[0][idx];
              target[n * 2 + 1] = (self.channels[1] || self.channels[0])[idx];
            }
            return n;
          },
        }, this.soundtouch);
      } else if (msg.type === 'start') {
        this.loopASample = msg.loopASample;
        this.loopBSample = msg.loopBSample;
        this.soundtouch.tempo = msg.rate;
        // NOTE: verify `sourcePosition` against the vendored source (Task 1) — SoundTouchJS
        // documents SimpleFilter exposing a settable sourcePosition for seeking. If the
        // vendored file names it differently, use that name instead; the requirement is
        // "the next extract() call starts reading from offsetSample".
        this.filter.sourcePosition = msg.offsetSample;
        this.startAt = msg.t0;
        this.exhausted = false;
        this.endedPosted = false;
        this.playing = true;
      } else if (msg.type === 'setRate') {
        this.soundtouch.tempo = msg.rate;
      }
    }

    process(inputs, outputs) {
      const output = outputs[0];
      const numOut = output.length;
      const frames = output[0].length;

      if (!this.playing || !this.filter || currentTime < this.startAt) {
        for (let ch = 0; ch < numOut; ch++) output[ch].fill(0);
        return true;
      }

      const target = new Float32Array(frames * 2);
      const n = this.filter.extract(target, frames);
      for (let i = 0; i < frames; i++) {
        output[0][i] = i < n ? target[i * 2] : 0;
        if (numOut > 1) output[1][i] = i < n ? target[i * 2 + 1] : 0;
      }

      if (n < frames && this.exhausted && !this.endedPosted) {
        this.endedPosted = true;
        this.port.postMessage({ type: 'ended' });
        return false;   // nothing left to produce; let the node be collected
      }
      return true;
    }
  }

  registerProcessor('stretch-processor', StretchProcessor);
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add lib/stretch-processor.js
  git commit -m "feat: add the pitch-preserving stretch AudioWorkletProcessor"
  ```

---

### Task 4: Load the worklet module in `ensureAudio()`

**Files:**
- Modify: `app.js:169-183` (`ensureAudio()`)

**Interfaces:**
- Produces: module-scope `workletReady` (a `Promise`, resolved once `'stretch-processor'` is
  registered), consumed by `play()` in Task 5.

- [ ] **Step 1: Add the state variable**

  Near the other transport state (`app.js:101-111`), add:
  ```js
  let workletReady = null;   // Promise: resolves once lib/stretch-processor.js is registered
  ```

- [ ] **Step 2: Kick off the module load**

  In `ensureAudio()` (`app.js:169-183`), inside the `if (!audio) { ... }` block, after
  `master.connect(audio.destination);`, add:
  ```js
    workletReady = audio.audioWorklet.addModule('lib/stretch-processor.js?v=1.19.0');
  ```
  This starts loading as soon as the `AudioContext` exists (on first user gesture / first song
  load) — well before the rate control is ever touched, so by the time a user drags the speed
  slider away from 100% the module is very likely already registered.

- [ ] **Step 3: Manual smoke check**

  No unit test — `audioWorklet.addModule` requires a real `AudioContext`. Start
  `./scripts/serve.sh`, open `index.html` in a browser, load any song, and check the console
  for a load error on `lib/stretch-processor.js` (a 404 or import error here would otherwise
  surface much later, in Task 5, as a silent failure to enter the stretched path at all).

- [ ] **Step 4: Commit**

  ```bash
  git add app.js
  git commit -m "feat: load the stretch worklet module in ensureAudio()"
  ```

---

### Task 5: Playback-speed state and per-stem stretch-node lifecycle

**Files:**
- Modify: `app.js:101-111` (transport state)
- Modify: `app.js:1956-2031` (`play()`, `stop()`)

**Interfaces:**
- Consumes: `workletReady` (Task 4); `'stretch-processor'` node contract (Task 3).
- Produces: module-scope `ratePercent` (number, 50–150, default 100) and `stretchNodes`
  (`AudioWorkletNode[]`), consumed by Task 6 (`currentTime()`) and Task 7 (`setRate()`,
  keyboard shortcuts, UI).

This task has no dedicated unit test of its own — `play()`/`stop()` require a real
`AudioContext` and `AudioWorkletNode`, which `tests/test.html` cannot construct meaningfully
(same reasoning as Task 3). It is covered by the consolidated manual pass, Task 12.

- [ ] **Step 1: Add state**

  In `app.js`, near `let sources = [];` (`app.js:105`), add:
  ```js
  let stretchNodes = [];     // AudioWorkletNodes, one per stem — populated only while
                              // ratePercent !== 100 and playing; empty otherwise
  let ratePercent = 100;     // 50-150, step 5; never persisted — see loadFiles/loadSeparated
  let playGen = 0;           // bumped by play()/stop() so a stale in-flight play() can bail
  ```

- [ ] **Step 2: Add the per-stem node constructor**

  Add this new function near `play()` (just above it, `app.js:1956`):
  ```js
  /** One AudioWorkletNode per stem, fed a COPY of its decoded PCM (the worklet cannot read
   *  the main-thread AudioBuffer directly — see the design spec's "Memory cost" section) and
   *  started at the same t0/LOOKAHEAD scheduling the native path uses, so every stretch node
   *  stays sample-locked to its siblings the same way native BufferSources do today. */
  function createStretchNode(t, willLoop, t0) {
    const node = new AudioWorkletNode(audio, 'stretch-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [t.buffer.numberOfChannels],
    });
    const channels = [];
    for (let ch = 0; ch < t.buffer.numberOfChannels; ch++) {
      channels.push(new Float32Array(t.buffer.getChannelData(ch)));
    }
    node.port.postMessage({ type: 'load', channels }, channels.map(c => c.buffer));
    node.port.postMessage({
      type: 'start',
      t0,
      offsetSample: Math.round(offset * audio.sampleRate),
      loopASample: willLoop ? Math.round(loopA * audio.sampleRate) : null,
      loopBSample: willLoop ? Math.round(loopB * audio.sampleRate) : null,
      rate: ratePercent / 100,
    });
    node.connect(t.gain);
    return node;
  }
  ```

- [ ] **Step 3: Branch `play()` on the active rate**

  Replace `play()` (`app.js:1956-2002`) with:
  ```js
  async function play() {
    if (!tracks.length) return;
    ensureAudio();
    const myGen = ++playGen;

    const looping = loopOn();
    if (looping) {
      if (offset < loopA || offset >= loopB) offset = loopA;
    } else if (offset >= duration - 0.01) {
      offset = 0;
    }

    const stretched = ratePercent !== 100;
    if (stretched) {
      try { await workletReady; } catch (err) {
        console.error('sans_bass: stretch worklet failed to load', err);
        return;
      }
      if (myGen !== playGen) return;   // stopped or replaced while the module was loading
    }

    const t0 = audio.currentTime + LOOKAHEAD;
    const longest = tracks.reduce((a, b) => (b.buffer.duration > a.buffer.duration ? b : a));

    if (stretched) {
      stretchNodes = tracks.map(t => {
        if (offset >= t.buffer.duration) return null;
        const willLoop = looping && t.buffer.duration >= loopB;
        const node = createStretchNode(t, willLoop, t0);
        if (t === longest && !willLoop) {
          node.port.onmessage = (e) => { if (e.data.type === 'ended' && playing) stop(false); };
        }
        return node;
      }).filter(Boolean);
      sources = [];
    } else {
      sources = tracks.map(t => {
        if (offset >= t.buffer.duration) return null;
        const src = audio.createBufferSource();
        src.buffer = t.buffer;
        src.connect(t.gain);
        if (looping && t.buffer.duration >= loopB) {
          src.loop = true;
          src.loopStart = loopA;
          src.loopEnd = loopB;
        }
        if (t === longest && !src.loop) src.onended = () => { if (playing) stop(false); };
        src.start(t0, offset);
        return src;
      }).filter(Boolean);
      stretchNodes = [];
    }

    startedAt = t0;
    playing = true;
    el.play.classList.add('playing');
    applyGains();
    announceTransport(t0);
    tick();
  }
  ```
  At `ratePercent === 100` this never awaits (the `if (stretched)` branch is skipped
  entirely), so the function still runs to completion synchronously within the same
  microtask, exactly as before — zero behavior change for the existing path.

- [ ] **Step 4: Tear down stretch nodes in `stop()`**

  Replace `stop()` (`app.js:2020-2031`) with:
  ```js
  function stop(keepPosition) {
    if (playing) offset = currentTime();
    playGen++;   // invalidate any play() still awaiting the worklet module
    // Detach onended first so our own stop() doesn't re-enter through it.
    sources.forEach(s => { s.onended = null; try { s.stop(); } catch (_) {} s.disconnect(); });
    sources = [];
    stretchNodes.forEach(n => { n.port.onmessage = null; n.disconnect(); });
    stretchNodes = [];
    playing = false;
    el.play.classList.remove('playing');
    cancelAnimationFrame(raf);
    if (!keepPosition) offset = 0;
    announceTransport(0);
    draw();
  }
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add app.js
  git commit -m "feat: branch play()/stop() between native and pitch-preserving stretch paths"
  ```

---

### Task 6: `currentTime()` rate-scaling

**Files:**
- Modify: `app.js:1944-1954` (`currentTime()`)

**Interfaces:**
- Consumes: `window.SansTransportMath.currentTimeAtRate` (Task 2); `ratePercent` (Task 5).

- [ ] **Step 1: Replace `currentTime()`**

  ```js
  function currentTime() {
    if (!playing) return offset;
    const elapsed = audio.currentTime - startedAt;
    if (elapsed <= 0) return offset;
    return window.SansTransportMath.currentTimeAtRate({
      offset, elapsed, ratePercent,
      loopA: loopOn() ? loopA : null, loopB: loopOn() ? loopB : null, duration,
    });
  }
  ```
  Every other transport function (`seek()`, `setLoopPoint()`, arrow-key seeking, `stop()`,
  `zoomCenter` tracking, etc.) calls `currentTime()` with no arguments and needs no change —
  they inherit the rate scaling automatically. `seek()` and `refreshLoop()` both already
  rebuild via `stop(true); play();`, which Task 5's `play()` now branches on `ratePercent`
  internally, so they need no code changes either to pick up stretch-node rebuilding at a new
  position — confirmed by inspection of `app.js:2038-2088`.

- [ ] **Step 2: Run the transport-math tests again**

  Open `http://localhost:8777/tests/test.html` and confirm the Task 2 tests still pass
  (they test the pure function directly, so this step is really "nothing regressed" —
  `currentTime()` itself has no automated coverage since it needs a real `AudioContext`,
  covered instead in Task 12).

- [ ] **Step 3: Commit**

  ```bash
  git add app.js
  git commit -m "feat: scale currentTime() by the active playback rate"
  ```

---

### Task 7: Speed UI control, keyboard shortcuts, and the rate-change dispatcher

**Files:**
- Modify: `index.html:91-114` (controls bar), `:114` (`el` object at `app.js:114-122`)
- Modify: `app.js` (new `setRate()`/`syncSpeedUI()`, keyboard handler, `loadFiles()`/
  `loadSeparated()` reset)
- Modify: `lib/i18n.js` (both locales)

**Interfaces:**
- Consumes: `window.SansTransportMath` (Task 2); `ratePercent`, `stretchNodes`, `play()`,
  `stop()`, `currentTime()`, `announceTransport()` (Task 5/6).
- Produces: `setRate(newPercent)`, called by the UI (this task) and reusable by any future
  caller; `syncSpeedUI()`.

- [ ] **Step 1: Add the markup**

  In `index.html`, after the Volume `.ctl` label (`index.html:97-100`) and before the loop
  badge (`index.html:101`), add:
  ```html
        <label class="ctl">
          <span data-i18n="ctl.speed">Speed</span>
          <input type="range" id="speed" min="50" max="150" step="5" value="100">
          <span id="speed-val" class="dim">100%</span>
        </label>
  ```

- [ ] **Step 2: Add `<script src="lib/transport-math.js">`**

  In `index.html`, add a script tag next to the other classic-script `lib/` tags
  (`index.html:375-380`):
  ```html
  <script src="lib/transport-math.js?v=1.19.0"></script>
  ```

- [ ] **Step 3: Wire the elements**

  In `app.js`'s `el` object (`app.js:114-122`), add:
  ```js
    speed: $('speed'), speedVal: $('speed-val'),
  ```

- [ ] **Step 4: Add i18n strings**

  In `lib/i18n.js`, English locale (after `'ctl.volume': 'Volume',` at line 225):
  ```js
      'ctl.speed': 'Speed',
  ```
  zh-TW locale (after `'ctl.volume': '音量',` at line 39):
  ```js
      'ctl.speed': '速度',
  ```
  Extend `hint.keys` in both locales. English (`lib/i18n.js:228`), change:
  ```js
      'hint.keys': 'space play · ←→ seek 5s · 1-6 stem · 0 mute/unmute all · <strong>a</strong>/<strong>b</strong> loop · <strong>c</strong> clear the A–B loop',
  ```
  to:
  ```js
      'hint.keys': 'space play · ←→ seek 5s · 1-6 stem · 0 mute/unmute all · <strong>a</strong>/<strong>b</strong> loop · <strong>c</strong> clear the A–B loop · <strong>[</strong>/<strong>]</strong> speed ±5% · <strong>\\</strong> reset speed',
  ```
  zh-TW (`lib/i18n.js:42`), change:
  ```js
      'hint.keys': '空白鍵播放 · ←→ 前後 5 秒 · 1-6 選軌 · 0 全部靜音／取消靜音 · <strong>a</strong>/<strong>b</strong> 循環 · <strong>c</strong> 清除 A–B 循環',
  ```
  to:
  ```js
      'hint.keys': '空白鍵播放 · ←→ 前後 5 秒 · 1-6 選軌 · 0 全部靜音／取消靜音 · <strong>a</strong>/<strong>b</strong> 循環 · <strong>c</strong> 清除 A–B 循環 · <strong>[</strong>/<strong>]</strong> 調整速度 ±5% · <strong>\\</strong> 重設速度',
  ```

- [ ] **Step 5: Add `syncSpeedUI()` and `setRate()`**

  In `app.js`, near `refreshLoop()`/`renderLoopBadge()` (`app.js:2085-2103`), add:
  ```js
  function syncSpeedUI() {
    if (el.speed) el.speed.value = ratePercent;
    if (el.speedVal) el.speedVal.textContent = `${ratePercent}%`;
  }

  /** Change the active playback rate. Crossing the 100% <-> non-100% boundary rebuilds the
   *  audio graph, same as seek()/refreshLoop(); staying on one side of it rebases the clock
   *  and live-messages the running stretch nodes instead, so dragging the slider mid-song
   *  has no audible restart. See the design spec's "Architecture" and "Live rate changes". */
  function setRate(newPercent) {
    const clamped = window.SansTransportMath.clampRatePercent(newPercent);
    if (clamped === ratePercent) { syncSpeedUI(); return; }

    if (!playing) {
      ratePercent = clamped;
      syncSpeedUI();
      return;
    }

    const crossingBoundary = (ratePercent === 100) !== (clamped === 100);
    if (crossingBoundary) {
      stop(true);          // captures offset under the OLD rate
      ratePercent = clamped;
      play();
    } else {
      const rebased = currentTime();   // under the OLD rate, before it changes
      ratePercent = clamped;
      offset = rebased;
      startedAt = audio.currentTime;
      stretchNodes.forEach(n => n.port.postMessage({ type: 'setRate', rate: ratePercent / 100 }));
      announceTransport(startedAt);
    }
    syncSpeedUI();
  }
  ```

- [ ] **Step 6: Wire the slider**

  Near `on(el.masterVol, 'input', ...)` (`app.js:2976-2980`), add:
  ```js
  on(el.speed, 'input', () => setRate(parseInt(el.speed.value, 10)));
  ```

- [ ] **Step 7: Add keyboard shortcuts**

  In the `keydown` handler, after the `c`/`Escape` case (`app.js:3014`), add:
  ```js
    else if (e.key === '[') { e.preventDefault(); setRate(window.SansTransportMath.nudgeRatePercent(ratePercent, -window.SansTransportMath.RATE_STEP)); }
    else if (e.key === ']') { e.preventDefault(); setRate(window.SansTransportMath.nudgeRatePercent(ratePercent, window.SansTransportMath.RATE_STEP)); }
    else if (e.key === '\\') { e.preventDefault(); setRate(window.SansTransportMath.RATE_DEFAULT); }
  ```

- [ ] **Step 8: Reset on load**

  In `loadFiles()`, after `loopA = loopB = null; renderLoopBadge();` (`app.js:296-297`), add:
  ```js
    ratePercent = window.SansTransportMath.RATE_DEFAULT;
    syncSpeedUI();
  ```
  In `loadSeparated()`, after `loopA = loopB = null; renderLoopBadge();` (`app.js:459-460`),
  add the same two lines.

- [ ] **Step 9: Run the i18n test**

  Open `http://localhost:8777/tests/test.html` and confirm `tests/i18n.test.js` still passes
  (it checks both locales carry the same key set and the same `{placeholder}`s — this task
  added `ctl.speed` and extended `hint.keys` in both, so it should be unaffected).

- [ ] **Step 10: Commit**

  ```bash
  git add index.html app.js lib/i18n.js
  git commit -m "feat: add the speed slider, keyboard shortcuts, and rate-change dispatcher"
  ```

---

### Task 8: `lib/sonify.js` — rate-aware note scheduling

**Files:**
- Modify: `lib/sonify.js:95-250` (`scheduleNotes`)
- Modify: `tests/sonify.test.js`

**Interfaces:**
- Produces: `scheduleNotes(ctx, destination, notes, { ..., rate = 1 })` — `rate` is a
  fraction (`1` = normal speed), matching the convention `window.sansBass.transport().rate`
  will use in Task 9.

- [ ] **Step 1: Replace `scheduleNotes`**

  Replace the whole function body in `lib/sonify.js:95-250` with:
  ```js
  export function scheduleNotes(ctx, destination, notes, opts = {}) {
    const { timbre = 'piano', when = 0, offset = 0, aheadSeconds = SCHEDULE_AHEAD, gain = 0.5,
            loopA = null, loopB = null, rate = 1 } = opts;
    const looping = loopA !== null && loopB !== null && loopB > loopA;
    /* Every quantity below starts life as a delta on the SONG timeline (note.start, offset,
     * loopA/loopB) and has to become a delta on the REAL audio-clock timeline before it can
     * schedule an oscillator. toReal() is that one conversion, applied everywhere such a
     * delta crosses from one timeline to the other — onset, loop period, and each note's own
     * envelope length — so a slowed-down (rate<1) song stretches every one of them and a
     * sped-up (rate>1) song compresses them, consistently. At rate = 1 this is the identity,
     * matching app.js's currentTime(). */
    const toReal = (songDelta) => songDelta / rate;
    const period = looping ? toReal(loopB - loopA) : 0;
    const spec = TIMBRES[timbre] ?? TIMBRES.piano;
    const wave = timbreWave(ctx, timbre);
    const live = new Set();
    let timer = null;

    const sorted = [...notes].sort((a, b) => a.start - b.start);

    const lap0 = [];
    for (const n of sorted) {
      if (n.fix && n.fix.state === 'doubt') continue;
      if (n.end <= offset) continue;
      if (looping && n.start >= loopB) continue;
      const boundary0 = looping ? loopB : Infinity;
      if (toReal(Math.min(n.end, boundary0) - Math.max(n.start, offset)) < MIN_AUDIBLE) continue;
      lap0.push({
        note: n,
        at: when + toReal(Math.max(0, n.start - offset)),
        skip: toReal(Math.max(0, offset - n.start)),
        until: looping ? when + toReal(loopB - offset) : Infinity,
      });
    }
    const loopBase = [];
    if (looping) {
      const lapStart = when + toReal(loopB - offset);
      for (const n of sorted) {
        if (n.fix && n.fix.state === 'doubt') continue;
        if (n.end <= loopA || n.start >= loopB) continue;
        if (toReal(Math.min(n.end, loopB) - Math.max(n.start, loopA)) < MIN_AUDIBLE) continue;
        loopBase.push({
          note: n,
          at: lapStart + toReal(Math.max(0, n.start - loopA)),
          skip: toReal(Math.max(0, loopA - n.start)),
          until: lapStart + period,
        });
      }
    }

    let lap = 0;
    let events = lap0;
    let next = 0;

    function nextEvent() {
      while (next >= events.length) {
        if (!loopBase.length || lap >= MAX_LAPS) return null;
        lap++;
        events = loopBase.map((e) => ({
          note: e.note,
          at: e.at + (lap - 1) * period,
          skip: e.skip,
          until: e.until + (lap - 1) * period,
        }));
        next = 0;
      }
      return events[next];
    }

    function spawn(note, at, skip = 0, until = Infinity) {
      // The note's own length is a song-timeline quantity too: at rate 0.5 a note takes
      // twice as long in real time, and the reference tone has to take just as long to stay
      // locked to the (equally slowed) stem underneath it.
      const dur = Math.max(0.05, toReal(note.end - note.start));
      const envLen = dur * spec.decay + spec.release;
      const end = Math.min(at + (envLen - skip), until);
      if (end - at < 0.001) return;

      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      osc.frequency.value = midiToHz(note.midi);

      const g = ctx.createGain();
      g.gain.setValueAtTime(envelopeAmplitude(skip, envLen, gain), at);
      if (skip < ATTACK) g.gain.exponentialRampToValueAtTime(gain, at + (ATTACK - skip));
      g.gain.exponentialRampToValueAtTime(FLOOR, end);

      osc.connect(g).connect(destination);
      osc.start(at);
      osc.stop(end + 0.02);
      live.add(osc);
      osc.onended = () => live.delete(osc);
    }

    let exhausted = false;
    const renderEnd = typeof ctx.length === 'number' ? ctx.length / ctx.sampleRate : Infinity;

    function pump() {
      const horizon = Math.min(ctx.currentTime + aheadSeconds, renderEnd);
      for (;;) {
        const e = nextEvent();
        if (!e) { exhausted = true; break; }
        if (e.at > horizon) break;
        if (e.at >= ctx.currentTime) spawn(e.note, e.at, e.skip, e.until);
        next++;
      }
      if (exhausted && timer !== null) { clearInterval(timer); timer = null; }
    }

    pump();
    if (!exhausted) timer = setInterval(pump, TICK_MS);

    return {
      stop() {
        if (timer !== null) { clearInterval(timer); timer = null; }
        next = events.length;
        exhausted = true;
        for (const osc of live) { try { osc.stop(); } catch { /* already stopped */ } }
        live.clear();
      },
    };
  }
  ```
  Every existing call in the file (`when + note.start - offset` etc.) is now expressed through
  `toReal()`; the doc comment above `scheduleNotes` (`lib/sonify.js:71-94`) already says `when`
  is an AudioContext time and `offset` a song position, which is still accurate — add one line
  to it noting the new `rate` option:
  ```
   * `rate` (default 1) is the active playback-speed fraction — 0.5 for half speed, 1.5 for
   * 1.5x. Every song-timeline delta below (onsets, loop period, note length) is divided by
   * it to land on the real audio-clock timeline; at rate = 1 this is the identity.
  ```

- [ ] **Step 2: Add the failing tests**

  Append to `tests/sonify.test.js`:
  ```js
  test('sonify: rate 0.5 halves the onset speed', async () => {
    const ctx = new OfflineAudioContext(1, SR * 3, SR);
    const notes = [{ start: 1.0, end: 1.2, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
    scheduleNotes(ctx, ctx.destination, notes, { when: 0, offset: 0, rate: 0.5, aheadSeconds: Infinity });
    const out = (await ctx.startRendering()).getChannelData(0);
    assert(rms(out, 0, Math.round(1.9 * SR)) < 1e-4, 'silent before the rate-scaled onset');
    assert(rms(out, Math.round(2.02 * SR), Math.round(2.3 * SR)) > 0.01, 'sounds once real time reaches onset/rate');
  });

  test('sonify: rate 2 doubles onset speed and compresses note duration to match', async () => {
    const ctx = new OfflineAudioContext(1, SR * 2, SR);
    const notes = [{ start: 1.0, end: 1.4, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
    scheduleNotes(ctx, ctx.destination, notes, { when: 0, offset: 0, rate: 2, aheadSeconds: Infinity });
    const out = (await ctx.startRendering()).getChannelData(0);
    assert(rms(out, 0, Math.round(0.45 * SR)) < 1e-4, 'silent before the compressed onset');
    assert(rms(out, Math.round(0.52 * SR), Math.round(0.68 * SR)) > 0.01, 'sounds around the compressed onset');
  });

  test('sonify: omitting rate defaults to 1 and matches the pre-existing behaviour', async () => {
    const ctx = new OfflineAudioContext(1, SR * 2, SR);
    const notes = [{ start: 0.5, end: 1.0, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
    scheduleNotes(ctx, ctx.destination, notes, { when: 0, offset: 0, aheadSeconds: Infinity });
    const out = (await ctx.startRendering()).getChannelData(0);
    assert(rms(out, 0, Math.round(0.45 * SR)) < 1e-4, 'silent before the note starts');
    assert(rms(out, Math.round(0.55 * SR), Math.round(0.9 * SR)) > 0.01, 'sounding during the note');
  });

  test('sonify: rate scales the loop period so laps stay locked to a slowed loop', async () => {
    const ctx = new OfflineAudioContext(1, SR * 3, SR);
    // One note at 0.1s inside a 0.5s SONG-timeline loop; at rate 0.5 each real-time lap is 1.0s.
    const notes = [{ start: 0.1, end: 0.25, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
    scheduleNotes(ctx, ctx.destination, notes,
                  { when: 0, offset: 0, loopA: 0, loopB: 0.5, rate: 0.5, aheadSeconds: Infinity });
    const out = (await ctx.startRendering()).getChannelData(0);
    // Lap 0 fires around 0.2s (0.1 / 0.5); lap 1 fires around 0.2 + 1.0 = 1.2s.
    assert(rms(out, Math.round(0.15 * SR), Math.round(0.3 * SR)) > 0.01, 'lap 0 sounds at the rate-scaled onset');
    assert(rms(out, Math.round(1.15 * SR), Math.round(1.3 * SR)) > 0.01, 'lap 1 sounds one rate-scaled period later');
  });
  ```

- [ ] **Step 3: Run and verify**

  Open `http://localhost:8777/tests/test.html` and confirm every `sonify:` test — old and
  new — passes.

- [ ] **Step 4: Commit**

  ```bash
  git add lib/sonify.js tests/sonify.test.js
  git commit -m "feat: scale sonify note scheduling by the active playback rate"
  ```

---

### Task 9: Wire `rate` through the transport broadcast

**Files:**
- Modify: `app.js:2008-2018` (`announceTransport`), `app.js:3121-3123` (`window.sansBass.transport`)
- Modify: `notes.js:394-396` (`resync`)

**Interfaces:**
- Consumes: `scheduleNotes`'s `rate` option (Task 8); `ratePercent` (Task 5).
- Produces: `sansbass:transport` event detail gains `rate`; `window.sansBass.transport()`
  gains `rate` — both as a fraction, matching `scheduleNotes`'s convention.

No new unit test — this is pure wiring between two files whose own pieces (`scheduleNotes`,
`currentTimeAtRate`) are already tested; it is exercised end-to-end in Task 12.

- [ ] **Step 1: Broadcast the rate**

  In `announceTransport()` (`app.js:2008-2018`), add `rate` to the dispatched detail:
  ```js
  function announceTransport(t0) {
    window.dispatchEvent(new CustomEvent('sansbass:transport', {
      detail: {
        playing,
        t0: t0 ?? 0,
        offset,
        loopA: loopOn() ? loopA : null,
        loopB: loopOn() ? loopB : null,
        rate: ratePercent / 100,
      },
    }));
  }
  ```

- [ ] **Step 2: Expose it on `window.sansBass.transport()`**

  In `app.js:3121-3123`:
  ```js
    transport: () => ({ playing, t0: startedAt, offset,
                        loopA: loopOn() ? loopA : null, loopB: loopOn() ? loopB : null,
                        rate: ratePercent / 100 }),
  ```

- [ ] **Step 3: Pass it to `scheduleNotes`**

  In `notes.js`'s `resync()` (`notes.js:394-396`):
  ```js
    sonifier = scheduleNotes(audio.ctx, audio.destination, notes, {
      timbre, when: t.t0, offset: t.offset, loopA: t.loopA, loopB: t.loopB, rate: t.rate,
    });
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add app.js notes.js
  git commit -m "feat: carry the playback rate through the transport broadcast to sonify"
  ```

---

### Task 10: Version bump

**Files:**
- Modify: `index.html`, `app.js`, `lib/stretch-processor.js`, `separate.js`,
  `separate.worker.js`, `notes.js`, `notes.worker.js`, `tests/versions.test.js`, `CLAUDE.md`

**Interfaces:** none — pure bookkeeping, verified by `tests/versions.test.js`.

This feature adds two **new** local asset references that need `?v=` and are not covered by
`tests/versions.test.js`'s current file list: `app.js`'s `audioWorklet.addModule('lib/
stretch-processor.js?v=...')` (Task 4) and `lib/stretch-processor.js`'s own `import ... from
'./vendor/soundtouch-core.js?v=...'` (Task 3) — neither `app.js` nor `lib/stretch-processor.js`
is in the `FILES` array the test scans, so a version drift in either would go undetected. Both
are added to `FILES` in this task.

- [ ] **Step 1: Bump every existing `?v=`**

  Change every `?v=1.18.8` to `?v=1.19.0` in:
  - `index.html` — 16 occurrences after Task 7 added one (icon href ×3, stylesheet, the new
    `lib/transport-math.js` script tag, brand-mark image, and the remaining `lib/*.js`/
    `app.js`/`separate.js`/`notes.js` script tags).
  - `separate.js` — 3 occurrences (`lib/wav.js`, `lib/zip.js`, `separate.worker.js`).
  - `separate.worker.js` — 1 occurrence (`lib/overlap.js`).
  - `notes.js` — 4 occurrences (`lib/pitch.js`, `lib/sonify.js`, `notes.worker.js` ×2).
  - `notes.worker.js` — 2 occurrences (`lib/pitch.js`, `lib/tempo.js`).

- [ ] **Step 2: Confirm the two new references already carry `1.19.0`**

  Task 4's `audio.audioWorklet.addModule('lib/stretch-processor.js?v=1.19.0')` in `app.js`
  and Task 3's `import { SoundTouch, SimpleFilter } from './vendor/soundtouch-core.js?v=1.19.0'`
  in `lib/stretch-processor.js` were already written with the final version number — just
  double-check they still read `1.19.0` after Step 1's bulk change (they should be untouched
  by it, since Step 1 only rewrites `1.18.8` occurrences).

- [ ] **Step 3: Extend `tests/versions.test.js`'s scan**

  In `tests/versions.test.js`, change:
  ```js
  const FILES = ['../index.html', '../separate.js', '../separate.worker.js',
                 '../notes.js', '../notes.worker.js'];
  ```
  to:
  ```js
  const FILES = ['../index.html', '../app.js', '../lib/stretch-processor.js',
                 '../separate.js', '../separate.worker.js',
                 '../notes.js', '../notes.worker.js'];
  ```

- [ ] **Step 4: Update `CLAUDE.md`'s gotcha bullet**

  In `CLAUDE.md`, the "Every local asset URL carries `?v=<version>`" bullet
  (`CLAUDE.md:169-178`) currently reads:
  ```
    the throw silently never registers. Bump the version in `index.html` (15), `separate.js` (3),
    `separate.worker.js` (1), `notes.js` (4) and `notes.worker.js` (2) — 25 in all;
    `tests/versions.test.js` fails if they drift — and it
    covers `.png` and `.svg` as well as `.js`/`.css`, so the icons are included. Currently
    `v1.18.8`.
  ```
  Change it to:
  ```
    the throw silently never registers. Bump the version in `index.html` (16), `app.js` (1),
    `lib/stretch-processor.js` (1), `separate.js` (3), `separate.worker.js` (1), `notes.js` (4)
    and `notes.worker.js` (2) — 28 in all; `tests/versions.test.js` fails if they drift — and
    it covers `.png` and `.svg` as well as `.js`/`.css`, so the icons are included. Currently
    `v1.19.0`.
  ```

- [ ] **Step 5: Run and verify**

  Open `http://localhost:8777/tests/test.html` and confirm both `versions:` tests pass —
  every local asset carries a `?v=`, and every one of them agrees on `1.19.0`.

- [ ] **Step 6: Commit**

  ```bash
  git add index.html app.js lib/stretch-processor.js separate.js separate.worker.js \
          notes.js notes.worker.js tests/versions.test.js CLAUDE.md
  git commit -m "chore: bump asset version to v1.19.0 for playback speed"
  ```

---

### Task 11: Documentation — README.md and docs/behaviour.md

**Files:**
- Modify: `README.md:300-343` (Controls table, A–B repeat section)
- Modify: `docs/behaviour.md` (new section)

**Interfaces:** none.

- [ ] **Step 1: Add the Controls table row**

  In `README.md`'s Controls table (`README.md:302-313`), add a row after "Clear the loop":
  ```
  | Change playback speed | Drag the speed slider, or **[** / **]** / **\\** |
  ```

- [ ] **Step 2: Add the loop-seam caveat**

  In the "Details worth knowing" bullet list under `### A–B repeat` (`README.md:326-334`),
  add a bullet after "Loading a new song clears the points.":
  ```
  - Pitch stays fixed at any playback speed. A time-stretched (non-100%) loop can have a
    faint discontinuity right at the seam, because the stretch pipeline's internal state has
    no way to know the input just jumped back to A — inherent to real-time time-stretching
    across an arbitrary loop point, not specific to this player. Native 100% looping is
    unaffected and stays exactly as glitch-free as always.
  ```

- [ ] **Step 3: Add a `docs/behaviour.md` section**

  After the `## A–B repeat` section (ends `docs/behaviour.md:223`, before `## Separation
  panel`), insert:
  ```markdown
  ## Playback speed

  | # | Expected | How to observe |
  |---|---|---|
  | S1 | A speed control (slider, 50–150%, step 5) is present in the controls bar, alongside Volume. | `#speed` exists with `min=50 max=150 step=5`. |
  | S2 | Always starts at 100% when a song loads — never persisted across songs or reloads. | Set it to e.g. 70%, load a different song: reads 100% again. |
  | S3 | ⚠ Changing speed away from 100% audibly changes tempo while the pitch stays the same. | Play a held note at 70% and at 130%: the tone is slower/faster but not lower/higher — the thing native `playbackRate` cannot do. |
  | S4 | At exactly 100% the native, unprocessed playback path runs — zero behaviour change from before this feature. | No `AudioWorkletNode` is created; `stretchNodes` stays empty. |
  | S5 | ⚠ Crossing the 100% ↔ non-100% boundary rebuilds the audio graph (same `stop()`→`play()` pattern as a loop-bounds change); staying on one side of it while dragging the slider does **not** restart the audio. | Drag the slider between two non-100% values during playback: no audible glitch/restart. Cross 100% itself: a brief rebuild is expected, same as pressing `a`/`b`. |
  | S6 | `[` / `]` nudge the rate ±5%, clamped to [50, 150]; `\` resets to 100%. | Press repeatedly past either bound: it stops at 50 or 150. `\` from any value returns to 100. |
  | S7 | A–B looping and seeking still work at non-100% rates. | Set a loop, change speed, seek inside and outside the loop: behaves like at 100%, aside from the known loop-seam limitation (S9). |
  | S8 | Sonify reference tones (Notes lane) stay locked to the (possibly slowed/sped) stems. | With a Notes lane active, play at 70%: the tone timing tracks the slowed audio rather than the original tempo. |
  | S9 | A time-stretched A–B loop can have a faint discontinuity at the seam — accepted, not fixed by this feature. Native 100% looping is unaffected. | Loop tightly at a non-100% rate and listen at the wrap point; a native 100% loop over the same points stays glitch-free. |
  | S10 | Returning to 100% falls back to native playback with no lingering artifacts. | Play at 70%, then reset to 100% mid-playback: sounds identical to a song that was never rate-changed. |
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add README.md docs/behaviour.md
  git commit -m "docs: document playback speed controls and behaviour"
  ```

---

### Task 12: Manual/browser verification (final, consolidated)

**Files:** none — verification only.

This is the one place per this project's convention (and this user's standing preference)
where the whole feature is exercised together in a real environment, rather than per-task.
Every prior task already has its own automated test; this task is about the things only a
real `AudioContext` + `AudioWorkletNode` can show.

- [ ] **Step 1: Start the server and load a song**

  Run `./scripts/serve.sh` if not already running. Open `http://localhost:8777/index.html`
  in a browser (use `claude-in-chrome` tooling to drive this if running as an agent). Load
  any local audio file — a whole song is enough; separation into stems is not required for
  this feature, though it's fine to use a separated set if one is already at hand.

- [ ] **Step 2: Confirm the native path is untouched**

  Press play at the default 100%. Confirm playback, muting, soloing, seeking, and A–B looping
  all behave exactly as before this feature (S4 in `docs/behaviour.md`).

- [ ] **Step 3: Confirm pitch-preserving speed change**

  Drag the speed slider to 70%. Confirm: the tempo audibly slows, the pitch does **not** drop
  (compare a sustained note or chord against its 100% pitch — it should sound in the same key,
  just slower). Drag to 130%: tempo speeds up, pitch stays put (S3).

- [ ] **Step 4: Confirm no audible restart on a live rate change**

  While playing at a non-100% rate, drag the slider between two non-100% values (e.g. 70% to
  90%). Confirm there's no click, restart, or gap (S5). Cross back through 100% and confirm a
  brief rebuild is acceptable (same as pressing `a`/`b` to set a loop point).

- [ ] **Step 5: Confirm A–B loop and seek at non-100% rates**

  Set a loop with `a`/`b` while at a non-100% rate. Confirm it loops correctly, and that
  seeking inside/outside the loop still works. Listen at the loop seam for the known faint
  discontinuity (S9) — expected, not a bug. Compare against a native 100% loop over the same
  points, which should stay glitch-free (S9).

- [ ] **Step 6: Confirm keyboard shortcuts**

  With focus away from any input/select, press `[` and `]` repeatedly and confirm the
  slider/readout move by 5 each time and clamp at 50/150. Press `\` and confirm it jumps back
  to 100% (S6).

- [ ] **Step 7: Confirm sonify stays locked, if a Notes lane is available**

  If the loaded song has vocals or bass stems, run note detection on one, enable its Notes
  lane, and play at a non-100% rate. Confirm the reference tone's timing tracks the
  slowed/sped audio rather than the original tempo (S8).

- [ ] **Step 8: Confirm reset to 100% has no lingering artifacts**

  While playing at a non-100% rate, reset to 100% (drag the slider back or press `\`).
  Confirm it falls back to native playback and sounds identical to a song that was never
  rate-changed (S10). Load a different song and confirm the speed control reads 100% again
  (S2).

- [ ] **Step 9: Run the full automated suite once more**

  Open `http://localhost:8777/tests/test.html` and confirm every test on the page passes —
  this is the first time all of Tasks 1–11's tests run together after every code change is in
  place.

- [ ] **Step 10: Update the devlog**

  Per this project's convention, add a `docs/devlog.md` entry for `v1.19.0` (newest-first),
  update the TL;DR table with a link to it, and tag each learning bullet `[note]` /
  `[insight]` / `[gotcha]` — in particular anything discovered while wiring the AudioWorklet
  that this plan could not have known in advance (exact vendored-library API names, any
  render-quantum timing subtlety observed in Step 3–5 above).
