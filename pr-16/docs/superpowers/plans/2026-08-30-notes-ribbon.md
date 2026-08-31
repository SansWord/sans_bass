# Notes Ribbon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A notes lane in the player showing detected notes over the pitch contour they came from, on the same time grid as the waveforms, with the interpretation re-derivable live.

**Architecture:** Analysis runs once in `notes.worker.js` and its output is immutable. Interpretation (`segmentNotes`) re-runs on the main thread in `notes.js` — 11.9 ms, so it updates during a slider drag. `app.js` is a classic script and cannot import ESM, so `notes.js` talks to it through `window.sansBass` exactly as `separate.js` already does, and the pure geometry lives in `lib/ribbon.js` as a **classic** script alongside `lib/stems.js` and `lib/platform.js`.

**Tech Stack:** Vanilla ESM + classic scripts. No build step, no dependencies. Tests are the existing browser harness.

**Spec:** [`docs/superpowers/specs/2026-08-30-notes-ribbon-design.md`](../specs/2026-08-30-notes-ribbon-design.md)
**Background, read first:** [`docs/transcription.md`](../../transcription.md)

**Branch:** `ui/notes-ribbon` (already created). It sits on top of PR #13; that must merge first.

**Version:** this phase bumps `?v=` from **v1.9.0 to v1.11.0**. v1.10.0 never appears in an asset URL because that release changed no file `index.html` loads.

---

## Two decisions the spec left to the plan

1. **The ribbon lane is built inside `buildUI()`**, not parked in `index.html`. `app.js:387` does `el.lanes.innerHTML = ''` on every load, so any element living inside `#lanes` is destroyed on the next song. Building it with the other lanes makes it survive by construction and puts it directly after the vocals lane, which is where the spec wants it.
2. **`lib/ribbon.js` is a classic script**, not ESM. `app.js` does the canvas work and cannot import a module. This matches the existing precedent — `lib/stems.js`, `lib/i18n.js` and `lib/platform.js` are classic for exactly this reason.

## File structure

| File | Responsibility |
|---|---|
| `lib/ribbon.js` (create) | Pure geometry: vertical range, contour segmentation. Classic script, `window.SansRibbon`. ~60 lines. |
| `notes.worker.js` (create) | ESM. Imports `lib/pitch.js`, runs `decimate` + `f0Track`, posts frames back. ~30 lines. |
| `notes.js` (create) | ESM. Button, worker lifecycle, live re-derivation, hands results to the player. ~140 lines. |
| `app.js` (modify) | Ribbon lane in `buildUI`, `renderRibbon`, `draw`/`renderAll` wiring, two new `window.sansBass` members. |
| `index.html` (modify) | `#notes` controls between `#sep` and `#lanes`; two script tags; `?v=` bump. |
| `styles.css` (modify) | `.lane.ribbon` reusing the lane grid so the canvas aligns. |
| `lib/i18n.js` (modify) | Eight keys, both locales. |
| `tests/ribbon.test.js` (create) | Units for the pure geometry. |
| `tests/notes.test.js` (create) | Worker integration test. |
| `tests/versions.test.js` (modify) | `notes.js` and `notes.worker.js` added to `FILES`, or they drift unchecked. |
| `tests/test.html` (modify) | Two import lines; one script tag for `lib/ribbon.js`. |
| `docs/behaviour.md` (modify) | Part of the diff — this changes observable behaviour. |

## Running the tests

```bash
./scripts/serve.sh          # http://localhost:8777
```

Units at `http://localhost:8777/tests/test.html` — read the `<pre>` or `window.__testResults`.

---

## Task 1: Vertical range

Octave errors sit 12+ semitones from the melody, so a min-to-max range lets one bad note squash the lane. This computes a duration-weighted percentile band instead.

**Files:**
- Create: `lib/ribbon.js`
- Create: `tests/ribbon.test.js`
- Modify: `tests/test.html`

- [ ] **Step 1: Write the failing test**

Create `tests/ribbon.test.js`:

```js
import { test, assert, assertEq, assertClose } from './assert.js';

const R = () => window.SansRibbon;

// A melody sitting in C4..G4, plus one 100 ms octave error far below it.
function melodyWithOutlier() {
  const notes = [];
  for (let i = 0; i < 20; i++) {
    notes.push({ start: i * 0.5, end: i * 0.5 + 0.4, midi: 60 + (i % 8), cents: 0, name: '', confidence: 1 });
  }
  notes.push({ start: 10, end: 10.1, midi: 46, cents: 0, name: 'A#2', confidence: 1 });
  return notes;
}

test('ribbon: the range excludes a short octave outlier by default', () => {
  const [lo, hi] = R().pitchRange(melodyWithOutlier());
  assert(lo > 46, `the A#2 blip is outside the range (lo=${lo})`);
  assert(lo <= 60, `the melody's lowest note is inside it (lo=${lo})`);
  assert(hi >= 67, `the melody's highest note is inside it (hi=${hi})`);
});

test('ribbon: clip:false widens the range to hold everything', () => {
  const [lo, hi] = R().pitchRange(melodyWithOutlier(), { clip: false });
  assert(lo < 46, `the outlier is now inside the range (lo=${lo})`);
  assert(hi > 67, `and so is the top (hi=${hi})`);
});

test('ribbon: the range is weighted by duration, not by note count', () => {
  // Forty brief high notes against one long low one. By count the high notes dominate;
  // by time the low note holds the lane for as long as all of them together.
  const notes = [{ start: 0, end: 4, midi: 50, cents: 0, name: '', confidence: 1 }];
  for (let i = 0; i < 40; i++) {
    notes.push({ start: 4 + i * 0.1, end: 4 + i * 0.1 + 0.09, midi: 72, cents: 0, name: '', confidence: 1 });
  }
  const [lo] = R().pitchRange(notes);
  assert(lo <= 50, `the sustained low note stays in range (lo=${lo})`);
});

test('ribbon: an empty note list still yields a usable range', () => {
  const [lo, hi] = R().pitchRange([]);
  assert(hi > lo, 'the range is not degenerate');
  assert(hi - lo >= 6, 'and it is wide enough to draw into');
});

test('ribbon: a single repeated pitch yields a range around it', () => {
  const notes = [{ start: 0, end: 1, midi: 64, cents: 0, name: 'E4', confidence: 1 }];
  const [lo, hi] = R().pitchRange(notes);
  assert(lo < 64 && hi > 64, 'the note sits strictly inside its own range');
});
```

- [ ] **Step 2: Register the test and the library in the harness**

In `tests/test.html`, add the classic script alongside the others (after the `lib/platform.js` line):

```html
  <script src="../lib/ribbon.js"></script>
```

And in the dynamic-import list, after `./pitch.test.js`:

```js
    await import('./ribbon.test.js');
```

- [ ] **Step 3: Run the tests to verify they fail**

Run `./scripts/serve.sh`, open `http://localhost:8777/tests/test.html`.
Expected: five `FAIL` lines beginning `ribbon:`, each reporting that it cannot read `pitchRange` of undefined — `window.SansRibbon` does not exist yet.

- [ ] **Step 4: Write the implementation**

Create `lib/ribbon.js`:

```js
/* Ribbon geometry — the pure parts of drawing a notes lane.
 *
 * A CLASSIC script, matching lib/stems.js and lib/platform.js. app.js does the canvas
 * work and is a classic script itself, so it cannot import an ES module; this is the same
 * reason the stem and platform helpers are classic. The tests read it the same way.
 *
 * Nothing here touches the DOM or a canvas: it maps notes and frames to numbers, and
 * app.js turns those into pixels.
 */
(function (global) {
  /* Percentile band, weighted by note DURATION rather than note count. A held tonic should
   * define the lane; forty passing sixteenths should not. */
  const LOW_PCT = 0.03;
  const HIGH_PCT = 0.97;
  const PAD_SEMITONES = 1.5;
  const WEIGHT_PER_SECOND = 40;      // sample resolution for the weighting, not a tuning knob

  /**
   * Vertical range of the lane, in MIDI note numbers, as [lo, hi].
   *
   * With `clip` (the default) the band covers the middle ~94% of note time and octave
   * errors fall outside it — app.js draws those clipped to the lane edge. With clip:false
   * the range spans every note, which is what one bad note does to the scale.
   */
  function pitchRange(notes, opts) {
    const clip = opts && 'clip' in opts ? !!opts.clip : true;
    if (!notes || !notes.length) return [59, 71];        // an octave around middle C

    if (!clip) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const n of notes) { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); }
      return [lo - PAD_SEMITONES, hi + PAD_SEMITONES];
    }

    const weighted = [];
    for (const n of notes) {
      const reps = Math.max(1, Math.round((n.end - n.start) * WEIGHT_PER_SECOND));
      for (let i = 0; i < reps; i++) weighted.push(n.midi);
    }
    weighted.sort((a, b) => a - b);
    const lo = weighted[Math.floor(weighted.length * LOW_PCT)];
    const hi = weighted[Math.floor(weighted.length * HIGH_PCT)];
    return [lo - PAD_SEMITONES, hi + PAD_SEMITONES];
  }

  global.SansRibbon = { pitchRange };
})(window);
```

- [ ] **Step 5: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.
Expected: five `PASS` lines beginning `ribbon:`, zero failures overall.

- [ ] **Step 6: Commit**

```bash
git add lib/ribbon.js tests/ribbon.test.js tests/test.html
git commit -m "Ribbon: duration-weighted vertical range with octave clipping"
```

---

## Task 2: Contour segmentation

The pitch line must break at every unvoiced run. A line drawn straight through a rest claims the singer held a note through a silence.

**Files:**
- Modify: `lib/ribbon.js`
- Modify: `tests/ribbon.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/ribbon.test.js`:

```js
// A frames object shaped like f0Track's output. `spec` is [centsOrZero, frameCount] pairs.
function fakeFrames(spec, frameSeconds = 128 / 11025) {
  const cents = [];
  for (const [c, n] of spec) for (let i = 0; i < n; i++) cents.push(c);
  const arr = Float32Array.from(cents);
  const t = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) t[i] = i * frameSeconds;
  return { t, f0: new Float32Array(arr.length), conf: new Float32Array(arr.length), cents: arr, frameSeconds };
}

test('ribbon: the contour breaks at an unvoiced run instead of bridging it', () => {
  const segs = R().contourSegments(fakeFrames([[6000, 10], [0, 4], [6400, 10]]), 10);
  assertEq(segs.length, 2, 'one segment either side of the silence');
  assertEq(segs[0].length, 10, 'first run');
  assertEq(segs[1].length, 10, 'second run');
});

test('ribbon: contour points are [timeFraction, midi]', () => {
  const frames = fakeFrames([[6900, 4]]);
  const duration = frames.t[3] + frames.frameSeconds;
  const segs = R().contourSegments(frames, duration);
  assertEq(segs.length, 1, 'one continuous run');
  const [tf, midi] = segs[0][0];
  assertClose(tf, 0, 1e-9, 'the first frame sits at the start of the lane');
  assertClose(midi, 69, 1e-6, '6900 cents is MIDI 69');
  assert(segs[0][3][0] > 0 && segs[0][3][0] <= 1, 'later frames stay within the lane');
});

test('ribbon: an all-unvoiced track yields no segments', () => {
  assertEq(R().contourSegments(fakeFrames([[0, 20]]), 10).length, 0, 'nothing to draw');
});

test('ribbon: a leading silence does not produce an empty segment', () => {
  const segs = R().contourSegments(fakeFrames([[0, 5], [6000, 5]]), 10);
  assertEq(segs.length, 1, 'exactly one segment');
  assert(segs[0].length > 0, 'and it is not empty');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Reload `http://localhost:8777/tests/test.html`.
Expected: four `FAIL` lines reporting `contourSegments is not a function`.

- [ ] **Step 3: Write the implementation**

In `lib/ribbon.js`, add this function above the `global.SansRibbon` line:

```js
  /**
   * The pitch contour as a list of polylines, each point [timeFraction, midi].
   *
   * A new polyline starts after every unvoiced frame. Never join across one: a line drawn
   * through a rest says the singer held a note through a silence, which is exactly the
   * kind of quiet lie that makes a visualisation untrustworthy.
   */
  function contourSegments(frames, duration) {
    const segs = [];
    let cur = null;
    for (let i = 0; i < frames.cents.length; i++) {
      const cents = frames.cents[i];
      if (!cents) { cur = null; continue; }
      if (!cur) { cur = []; segs.push(cur); }
      cur.push([duration ? frames.t[i] / duration : 0, cents / 100]);
    }
    return segs;
  }
```

And change the export line to:

```js
  global.SansRibbon = { pitchRange, contourSegments };
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.
Expected: four new `PASS` lines, zero failures.

- [ ] **Step 5: Commit**

```bash
git add lib/ribbon.js tests/ribbon.test.js
git commit -m "Ribbon: contour polylines that break at unvoiced frames"
```

---

## Task 3: The analysis worker

**Files:**
- Create: `notes.worker.js`
- Create: `tests/notes.test.js`
- Modify: `tests/test.html`

- [ ] **Step 1: Write the failing test**

Create `tests/notes.test.js`:

```js
import { test, assert, assertClose } from './assert.js';

const SR = 44100;

function sine(hz, seconds, sampleRate, amp = 0.5) {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

function analyse(channels, sampleRate) {
  return new Promise((resolve, reject) => {
    const w = new Worker('../notes.worker.js?v=1.11.0', { type: 'module' });
    const timer = setTimeout(() => { w.terminate(); reject(new Error('worker never answered')); }, 20000);
    w.onmessage = (e) => {
      clearTimeout(timer);
      w.terminate();
      if (e.data.type === 'frames') resolve(e.data.frames);
      else reject(new Error(e.data.message || 'unexpected message'));
    };
    w.onerror = (e) => { clearTimeout(timer); w.terminate(); reject(new Error(e.message)); };
    // Structured clone, NOT a transfer. In the app these arrays are live views into an
    // AudioBuffer that is still playing; transferring detaches them and the stem goes
    // silent with no error anywhere. The test copies so it models correct usage.
    w.postMessage({ type: 'analyse', channels, sampleRate });
  });
}

test('notes: the worker returns an f0 track for a steady tone', async () => {
  const frames = await analyse([sine(220, 1.5, SR)], SR);
  assert(frames.cents.length > 100, `frames came back (${frames.cents.length})`);
  assertClose(frames.frameSeconds, 128 / 11025, 1e-6, 'frame spacing survives the round trip');
  const voiced = [...frames.cents].filter((c) => c !== 0);
  assert(voiced.length > frames.cents.length * 0.8, 'a pure tone is voiced nearly everywhere');
  const mean = voiced.reduce((s, c) => s + c, 0) / voiced.length;
  assertClose(mean, 5700, 30, 'and it reads as A3');
});

test('notes: the worker reports an error rather than hanging', async () => {
  let threw = false;
  try {
    await analyse([], SR);          // no channels at all
  } catch (e) {
    threw = true;
    assert(e.message.length > 0, 'the failure carries a message');
  }
  assert(threw, 'an empty channel list is reported, not swallowed');
});
```

- [ ] **Step 2: Register the test**

In `tests/test.html`, after `./ribbon.test.js`:

```js
    await import('./notes.test.js');
```

- [ ] **Step 3: Run the tests to verify they fail**

Reload `http://localhost:8777/tests/test.html`.
Expected: two `FAIL` lines beginning `notes:` — the worker script 404s, so `onerror` fires.

- [ ] **Step 4: Write the implementation**

Create `notes.worker.js`:

```js
/* Note analysis worker: owns the expensive half of the pipeline.
 *
 * Runs off the main thread because a 4-minute track takes about 7 s on a cold run, and
 * the player is drawing waveforms on rAF throughout. Interpretation is NOT here — see
 * notes.js, where segmentNotes runs on the main thread at ~12 ms.
 *
 * See docs/transcription.md for the layer model this implements. */

import { decimate, f0Track } from './lib/pitch.js?v=1.11.0';

self.onmessage = (e) => {
  const m = e.data;
  if (!m || m.type !== 'analyse') return;
  try {
    if (!m.channels || !m.channels.length) throw new Error('no audio channels supplied');
    const dec = decimate(m.channels, m.sampleRate);
    const track = f0Track(dec.samples, dec.sampleRate);
    // Transferring OUT is safe: these arrays were allocated here and nothing else holds
    // them. Transferring IN would not be — see the note in tests/notes.test.js.
    self.postMessage(
      { type: 'frames', frames: { t: track.t, f0: track.f0, conf: track.conf, cents: track.cents,
                                  frameSeconds: track.frameSeconds } },
      [track.t.buffer, track.f0.buffer, track.conf.buffer, track.cents.buffer],
    );
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.
Expected: two new `PASS` lines beginning `notes:`. The first takes a second or two — it runs real YIN over 1.5 s of audio.

- [ ] **Step 6: Commit**

```bash
git add notes.worker.js tests/notes.test.js tests/test.html
git commit -m "Notes: analysis worker wrapping decimate and f0Track"
```

---

## Task 4: Interface strings

Both locales move together or `tests/i18n.test.js` fails — it checks for keys present in one and missing from the other, and for `{placeholder}` drift between them.

**Files:**
- Modify: `lib/i18n.js`

- [ ] **Step 1: Add the zh-TW keys**

In `lib/i18n.js`, inside the `'zh-TW'` block, after the `'sep.*'` group:

```js
      'notes.lane': '音符',
      'notes.find': '偵測音符',
      'notes.working': '偵測音符中…',
      'notes.failed': '音符偵測失敗：{message}',
      'notes.count': '{n} 個音符',
      'notes.shortest': '最短音符',
      'notes.advanced': '進階',
      'notes.clip': '裁切八度異常值',
```

- [ ] **Step 2: Add the matching en keys**

In the `'en'` block, in the same position:

```js
      'notes.lane': 'Notes',
      'notes.find': 'Find notes',
      'notes.working': 'Finding notes…',
      'notes.failed': 'Note detection failed: {message}',
      'notes.count': '{n} notes',
      'notes.shortest': 'Shortest note',
      'notes.advanced': 'Advanced',
      'notes.clip': 'Clip octave outliers',
```

- [ ] **Step 3: Run the tests to verify both locales agree**

Reload `http://localhost:8777/tests/test.html`.
Expected: every `i18n:` test still `PASS`. A key added to one locale only fails here, as does a `{placeholder}` that differs between them.

- [ ] **Step 4: Commit**

```bash
git add lib/i18n.js
git commit -m "i18n: strings for the notes lane, both locales"
```

---

## Task 5: Markup, styles, and the version bump

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `tests/versions.test.js`

- [ ] **Step 1: Add the notes controls**

In `index.html`, between `</section>` closing `#sep` (line 131) and `<div id="lanes">` (line 133):

```html
    <!-- Detection is button-triggered, never automatic: the first run is ~7 s of CPU on a
         4-minute track, and unbidden CPU that size is a surprise rather than a convenience. -->
    <section id="notes" class="notes" hidden>
      <div class="notes-row">
        <button id="notes-go" class="btn" data-i18n="notes.find">Find notes</button>
        <span id="notes-count" class="notes-count"></span>
      </div>
      <div id="notes-tune" class="notes-row" hidden>
        <label class="notes-ctl">
          <span data-i18n="notes.shortest">Shortest note</span>
          <input id="notes-min" type="range" min="60" max="300" step="10" value="120">
          <output id="notes-min-out" class="notes-val">120 ms</output>
        </label>
        <details class="notes-adv">
          <summary data-i18n="notes.advanced">Advanced</summary>
          <label class="notes-ctl">
            <input id="notes-clip" type="checkbox" checked>
            <span data-i18n="notes.clip">Clip octave outliers</span>
          </label>
        </details>
      </div>
    </section>
```

- [ ] **Step 2: Add the script tags and bump every `?v=` to v1.11.0**

Replace the whole script block at the bottom of `index.html` (from `<script src="lib/stems.js...` to the `separate.js` line) with:

```html
<script src="lib/stems.js?v=1.11.0"></script>
<script src="lib/unzip.js?v=1.11.0"></script>
<script src="lib/analytics.js?v=1.11.0"></script>
<script src="lib/platform.js?v=1.11.0"></script>
<script src="lib/ribbon.js?v=1.11.0"></script>
<script src="app.js?v=1.11.0"></script>
<script type="module" src="separate.js?v=1.11.0"></script>
<script type="module" src="notes.js?v=1.11.0"></script>
```

Also update the two remaining `?v=1.9.0` occurrences higher in the file (the `lib/i18n.js` tag at line 21 and the stylesheet), and the comment above the block, which currently reads "index.html (8), separate.js (3), separate.worker.js (1)". It becomes:

```
     Bump the version in ALL of these on release: index.html (10), separate.js (3),
     separate.worker.js (1), notes.js (2), notes.worker.js (1).
     tests/versions.test.js fails if they drift apart.
```

Then bump the imports in `separate.js` (3 occurrences) and `separate.worker.js` (1 occurrence) from `?v=1.9.0` to `?v=1.11.0`:

```bash
sed -i '' 's/?v=1\.9\.0/?v=1.11.0/g' index.html separate.js separate.worker.js
grep -rn '1\.9\.0' index.html separate.js separate.worker.js     # expect no output
```

- [ ] **Step 3: Teach the version test about the new files**

In `tests/versions.test.js`, change the `FILES` constant. Without this the two new modules carry `?v=` strings nothing ever checks, which is precisely the silent drift the test exists to prevent:

```js
const FILES = ['../index.html', '../separate.js', '../separate.worker.js',
               '../notes.js', '../notes.worker.js'];
```

- [ ] **Step 4: Add the styles**

Append to `styles.css`:

```css
/* The ribbon reuses the lane grid exactly — 128px / 1fr / 96px — so its canvas starts and
   ends on the same pixels as every waveform above it. A lane that computes its own
   time-to-x mapping drifts from the others the moment the window is resized. */
.lane.ribbon { cursor: default; }
.lane.ribbon .lane-name { cursor: default; }
.lane.ribbon .lane-name:hover { background: none; }
.lane.ribbon .wave { height: 96px; }

.notes { margin: 10px 0 0; display: flex; flex-direction: column; gap: 8px; }
.notes-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.notes-count { font: 12px var(--mono); color: var(--dim); font-variant-numeric: tabular-nums; }
.notes-ctl { display: flex; align-items: center; gap: 8px; font: 12px var(--mono); color: var(--dim); }
.notes-ctl input[type=range] { width: 150px; }
.notes-val { font-variant-numeric: tabular-nums; min-width: 4.5em; }
.notes-adv summary { font: 12px var(--mono); color: var(--dim); cursor: pointer; }
.notes-adv[open] summary { margin-bottom: 6px; }
```

- [ ] **Step 5: Verify the version tests still pass**

Reload `http://localhost:8777/tests/test.html`.
Expected: both `versions:` tests `PASS`. They now read five files. If "versions have drifted" appears, a `?v=1.9.0` was missed — the grep in Step 2 finds it.

Note: `notes.js` does not exist yet, so the fetch in `versions.test.js` will fail until Task 9. If that blocks you, do Step 3 of this task after Task 9 instead and leave the rest here.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css tests/versions.test.js
git commit -m "Notes: controls markup, lane styles, and the v1.11.0 asset bump"
```

---

## Task 6: The player's side of the seam

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add the ribbon state and element refs**

In `app.js`, in the state section near `let tracks = [];`:

```js
let ribbon = null;         // { notes, frames, params, clip } from notes.js, or null
let ribbonEl = null;       // { lane, canvas, txt } — rebuilt with the lanes on every load
```

- [ ] **Step 2: Build the lane alongside the others**

In `buildUI()`, immediately before the closing `attachSeek(el.mainWave);` line, add:

```js
  /* Built here rather than parked in index.html: el.lanes.innerHTML = '' above destroys
   * anything inside #lanes, so a static element would vanish on the second song. Built
   * with the lanes it survives by construction, and lands directly under vocals. */
  ribbonEl = null;
  const vocals = tracks.find((t) => t.stem === 'vocals');
  if (vocals) {
    const lane = document.createElement('div');
    lane.className = 'lane ribbon';
    lane.hidden = true;

    const name = document.createElement('div');
    name.className = 'lane-name';
    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = tr('notes.lane');
    name.appendChild(txt);

    const canvas = document.createElement('canvas');
    canvas.className = 'wave';

    const spacer = document.createElement('div');

    lane.append(name, canvas, spacer);
    el.lanes.insertBefore(lane, vocals.laneEl.nextSibling);
    attachSeek(canvas);
    ribbonEl = { lane, canvas, txt };
  }
```

- [ ] **Step 3: Add the two `window.sansBass` members**

In the `window.sansBass` object at the bottom of `app.js`, after `isSingleTrack`:

```js
  /** A loaded stem's buffer by name, or null. notes.js reads 'vocals' through this. */
  stemBuffer: (stem) => {
    const t = tracks.find((x) => x.stem === stem);
    return t ? { name: t.name, buffer: t.buffer } : null;
  },
  /** Hand detected notes to the player, or null to clear the lane. */
  setNotes,
```

- [ ] **Step 4: Add `setNotes`**

In `app.js`, in the UI section just after `renderAll()`:

```js
/* The interpretation layer hands its result over here. Called again on every change of a
 * detection parameter — see docs/transcription.md — so it must be cheap and idempotent. */
function setNotes(payload) {
  ribbon = payload && payload.notes && payload.frames ? payload : null;
  if (!ribbonEl) return;
  ribbonEl.lane.hidden = !ribbon;
  if (!ribbon) { ribbonEl.canvas.__layers = null; return; }
  // The canvas's own width, matching renderAll's `t.canvas.clientWidth` for track lanes.
  // NOT parentElement: the parent is the .lane grid, 128px + 96px wider than the canvas.
  renderRibbon(ribbonEl.canvas, ribbon, ribbonEl.canvas.clientWidth);
  draw();
}
```

`clip` rides along in the payload rather than becoming a third member of `window.sansBass`.
The spec asks for that surface to stay at two, and notes.js re-derives in 12 ms anyway, so
there is nothing to gain from a separate entry point for one boolean.

- [ ] **Step 5: Verify nothing regressed**

Reload `http://localhost:8777/tests/test.html`.
Expected: the full suite still passes. `renderRibbon` does not exist yet, but nothing calls `setNotes` until Task 9, so the page must not throw. Open `http://localhost:8777/` and load a stems zip: the lanes must still build and play exactly as before.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "Player: ribbon lane scaffolding and the notes.js seam"
```

---

## Task 7: Rendering the ribbon

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Write `renderRibbon`**

In `app.js`, immediately after `renderWave()`:

```js
const RIBBON_H = 96;

/* Pre-rendered idle/active layers, the same shape renderWave produces, so paint() draws
 * the ribbon with the identical blit-and-clip it uses for every waveform — playhead,
 * A-B shading and all. The layer object must keep the { idle, active, h, w } keys:
 * paint() reads L.w to place the playhead. */
function renderRibbon(canvas, payload, cssWidth) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(cssWidth || canvas.clientWidth || 600));
  const h = RIBBON_H;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + 'px';

  const { notes, frames } = payload;
  const [loM, hiM] = window.SansRibbon.pitchRange(notes, { clip: payload.clip !== false });
  const span = hiM - loM || 1;
  const y = (midi) => h - ((midi - loM) / span) * h;
  // The SAME time-to-x mapping every other lane uses. Anything else drifts on resize.
  const x = (t) => (duration ? t / duration : 0) * w;
  const semi = Math.abs(y(0) - y(1));

  const make = (dim) => {
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const c = off.getContext('2d');
    c.scale(dpr, dpr);

    // Octave stripes at each C, so vertical distance reads as pitch rather than height.
    c.fillStyle = dim ? 'rgba(255,255,255,.030)' : 'rgba(255,255,255,.055)';
    for (let m = Math.ceil(loM); m <= hiM; m++) {
      if (m % 12) continue;
      const top = y(m + 0.5);
      c.fillRect(0, top, w, Math.max(1, y(m - 0.5) - top));
    }

    c.strokeStyle = dim ? '#41566b' : '#7fb2d9';
    c.lineWidth = 1.4;
    c.lineJoin = 'round';
    for (const seg of window.SansRibbon.contourSegments(frames, duration)) {
      c.beginPath();
      for (let i = 0; i < seg.length; i++) {
        const px = seg[i][0] * w;
        const py = y(seg[i][1]);
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.stroke();
    }

    for (const n of notes) {
      const out = n.midi < loM || n.midi > hiM;
      const by = out ? (n.midi < loM ? h - 3 : 0) : y(n.midi + 0.5);
      const bh = out ? 3 : Math.max(3, semi * 0.8);
      // A clipped note keeps its position in time but loses its pitch, so it is drawn in
      // the A-B orange rather than dropped — a hidden note would be a silent lie.
      const bw = Math.max(2, x(n.end) - x(n.start));
      c.fillStyle = out ? (dim ? '#7a5215' : '#ff9f1c') : (dim ? '#39604c' : '#6fbf8e');
      c.fillRect(x(n.start), by, bw, bh);

      /* The name only when it fits. Clipping text to a block narrower than the glyphs
       * produces a smear that reads as corruption rather than as a label — and note names
       * are never translated, in any locale, exactly as stem ids and filenames are not. */
      if (!out && bw > 26 && bh > 9) {
        c.fillStyle = dim ? '#1a1a20' : '#0d0d10';
        c.font = `600 9px ${'ui-monospace, Menlo, monospace'}`;
        c.textBaseline = 'middle';
        c.fillText(n.name, x(n.start) + 3, by + bh / 2 + 0.5);
      }
    }
    return off;
  };

  canvas.__layers = { idle: make(true), active: make(false), h, w };
  return canvas.__layers;
}
```

- [ ] **Step 2: Verify it draws**

Reload `http://localhost:8777/tests/test.html` — the suite must stay green.

Then, in the browser console on `http://localhost:8777/` with a stems zip loaded, drive it by hand (this is the fastest way to see the lane before `notes.js` exists):

```js
const m = await import('/lib/pitch.js?v=1.11.0');
const { buffer } = window.sansBass.stemBuffer('vocals');
const ch = []; for (let i = 0; i < buffer.numberOfChannels; i++) ch.push(buffer.getChannelData(i));
const r = m.detectNotes(ch, buffer.sampleRate);
window.sansBass.setNotes({ notes: r.notes, frames: r.frames, clip: true,
                           params: { interpreter: 'threshold-v1', params: {} } });
```

Expected: a lane appears under vocals, its blocks and contour aligned with the waveform above it, and clicking it seeks.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "Player: draw the notes ribbon as pre-rendered lane layers"
```

---

## Task 8: Wire the ribbon into the draw loop

Without this the lane renders once and then never updates its playhead, and a window resize leaves it at the old width while every other lane reflows.

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Paint it every frame**

In `draw()`, after the `tracks.forEach(...)` line:

```js
  if (ribbon && ribbonEl) paint(ribbonEl.canvas, frac);
```

- [ ] **Step 2: Re-render it on resize**

At the end of `renderAll()`, after the `tracks.forEach(...)` re-render:

```js
  if (ribbon && ribbonEl) {
    renderRibbon(ribbonEl.canvas, ribbon, ribbonEl.canvas.clientWidth);
  }
```

- [ ] **Step 3: Clear it when a new song loads**

In `buildUI()`, at the very top — before `el.lanes.innerHTML = ''` — drop the stale result. The frames belong to the previous song's audio and would be drawn against the new song's duration:

```js
  ribbon = null;
```

- [ ] **Step 4: Re-translate the lane label on a language switch**

In `retranslate()`, add:

```js
  if (ribbonEl) ribbonEl.txt.textContent = tr('notes.lane');
```

- [ ] **Step 5: Verify by observing the drawing, not the wiring**

With a stems zip loaded, run the console snippet from Task 7 Step 2 again, then:

```js
// The playhead must advance on the ribbon exactly as it does on the waveforms.
const before = window.getComputedStyle(document.querySelector('.lane.ribbon')).display;
document.querySelector('.lane.ribbon canvas').__layers.w;   // matches the lane width
```

Expected: `before` is not `"none"`, and the reported width equals the waveform canvases' width. Press space to play and watch the playhead cross the ribbon in step with the lanes above it. Resize the window: the ribbon must reflow with the others rather than keeping its old width.

Then load a different song and confirm the ribbon lane disappears rather than showing the previous song's notes.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "Player: ribbon follows the draw loop, resize, and song changes"
```

---

## Task 9: `notes.js` — the interpretation layer

**Files:**
- Create: `notes.js`

- [ ] **Step 1: Write the module**

Create `notes.js`:

```js
/* Notes panel: owns the analysis worker and the interpretation on top of it.
 *
 * The split matters and is the whole point of the design — see docs/transcription.md.
 * ANALYSIS (decimate + YIN) runs once in the worker and its result is immutable.
 * INTERPRETATION (segmentNotes) runs here on the main thread, because at ~12 ms it is
 * cheaper to run than to message, and that is what lets a slider re-derive live.
 *
 * A module, so it cannot share scope with app.js. It talks to the player only through
 * window.sansBass, exactly as separate.js does. */

import { segmentNotes } from './lib/pitch.js?v=1.11.0';

const el = {
  panel: document.getElementById('notes'),
  go: document.getElementById('notes-go'),
  count: document.getElementById('notes-count'),
  tune: document.getElementById('notes-tune'),
  min: document.getElementById('notes-min'),
  minOut: document.getElementById('notes-min-out'),
  clip: document.getElementById('notes-clip'),
};

const tr = (key, params) => window.SansI18n.t(key, params);

let worker = null;
let frames = null;        // the immutable analysis result
let notes = [];
let analysedBuffer = null;   // identity of the AudioBuffer `frames` was computed from

/* Parameters carry the interpreter that understands them. Nothing reads this yet; it
 * exists so a file written today survives the segmenter being replaced by an HMM decoder,
 * whose parameters are transition costs rather than thresholds. */
function currentParams() {
  return { interpreter: 'threshold-v1', params: { minDurationMs: Number(el.min.value) } };
}

/** Re-derive notes from the existing frames. No worker, no re-analysis. */
function reinterpret() {
  if (!frames) return;
  const p = currentParams();
  notes = segmentNotes(frames, p.params);
  el.count.textContent = tr('notes.count', { n: notes.length });
  el.minOut.textContent = `${el.min.value} ms`;
  window.sansBass.setNotes({ notes, frames, params: p, clip: el.clip.checked });
}

function reset() {
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

  worker = new Worker('./notes.worker.js?v=1.11.0', { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    worker.terminate();
    worker = null;
    el.go.disabled = false;
    if (m.type === 'error') {
      window.sansBass.say('notes.failed', { message: m.message }, true);
      return;
    }
    window.sansBass.say(null);
    frames = m.frames;
    el.tune.hidden = false;
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

el.go.addEventListener('click', analyse);
el.min.addEventListener('input', reinterpret);
el.clip.addEventListener('change', reinterpret);   // clip rides in the payload
window.addEventListener('sansbass:langchange', () => {
  if (frames) el.count.textContent = tr('notes.count', { n: notes.length });
});
```

- [ ] **Step 2: Confirm `say` accepts the arguments used above**

`window.sansBass.say` is `app.js`'s `say(key, params, isErr)`. Verify at `app.js:116` that the signature matches; the error path above relies on the third argument.

- [ ] **Step 3: Run the full suite**

Reload `http://localhost:8777/tests/test.html`.
Expected: everything passes, `versions:` included — `notes.js` now exists, so the fetch that Task 5 Step 3 added resolves.

- [ ] **Step 4: Verify the layer split by observing notes, not parameters**

Load a stems zip at `http://localhost:8777/`, click **Find notes**, wait for the lane, then:

```js
const count = () => document.getElementById('notes-count').textContent;
const slider = document.getElementById('notes-min');
count();                                    // e.g. "228 notes"
const t0 = performance.now();
slider.value = 200; slider.dispatchEvent(new Event('input'));
({ elapsedMs: performance.now() - t0, now: count() });
```

Expected: the note count drops substantially (roughly 228 → 99 on a typical track) and `elapsedMs` is in the tens of milliseconds. **That the slider moved is not evidence anything re-derived** — the note count changing is. If elapsed time is in the thousands, analysis is being re-run and the split has been broken.

Also confirm the ribbon visibly redraws with fewer blocks, and that unticking **Clip octave outliers** under Advanced widens the lane.

Then check the interpreter tag survives to the player, which the spec calls for and which no
unit test can reach — `currentParams()` is module-private:

```js
// Re-derive once, then read what the player was actually handed.
document.getElementById('notes-min').dispatchEvent(new Event('input'));
// In app.js scope this is `ribbon`; from the console, confirm via the next render instead:
window.sansBass.stemBuffer('vocals') !== null;   // sanity: the seam is live
```

Expected: the payload passed to `setNotes` carries
`params.interpreter === 'threshold-v1'`. Add a temporary `console.log` in `setNotes` if you
need to see it, and remove it before committing.

- [ ] **Step 5: Commit**

```bash
git add notes.js
git commit -m "Notes: worker lifecycle and live re-interpretation"
```

---

## Task 10: Behaviour documentation

`docs/behaviour.md` is what the next session trusts. A behaviour change that does not update it leaves the two disagreeing.

**Files:**
- Modify: `docs/behaviour.md`

- [ ] **Step 1: Read the existing structure**

```bash
head -60 docs/behaviour.md
```

Match its existing format — each entry is an observable outcome paired with a way to observe it.

- [ ] **Step 2: Add the notes-lane behaviours**

Add a section in that established format covering:

- The **Find notes** button appears only when a vocals stem is loaded, and disappears for a single unseparated song. *Observe:* `getComputedStyle(document.getElementById('notes')).display` is `none` with one track loaded and not `none` after loading a stems zip containing vocals.
- Detection never starts on its own. *Observe:* load a stems zip, wait 10 s, and confirm `document.querySelector('.lane.ribbon').hidden` is still `true`.
- The ribbon lane appears directly under the vocals lane. *Observe:* `document.querySelector('.lane.ribbon').previousElementSibling` is the vocals lane.
- Clicking the ribbon seeks, like every other lane. *Observe:* click at the midpoint and read the transport clock.
- Moving **Shortest note** changes the note count without re-running analysis. *Observe:* the Task 9 Step 4 snippet — the count changes and elapsed time is in the tens of milliseconds.
- The ribbon clears when a new song loads. *Observe:* load a second zip; `document.querySelector('.lane.ribbon')` is absent or hidden.
- A clipped octave outlier is drawn at the lane edge rather than dropped. *Observe:* untick **Clip octave outliers**; the vertical range widens and the orange edge marks disappear.

Note in the doc that the lane has **no** mute, volume or number-key binding, and is absent from `tracks` — so mute-all, solo and the stem count ignore it entirely.

- [ ] **Step 3: Commit**

```bash
git add docs/behaviour.md
git commit -m "Docs: notes lane behaviour and how to observe it"
```

---

## Task 11: Devlog, status, and the PR

**Files:**
- Modify: `docs/devlog.md`
- Modify: `docs/transcription.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Flip the status table in `docs/transcription.md`**

The row currently reads `| notes lane in the app | designed, not built — see the Phase B2 spec |`. Change it to:

```
| notes lane in the app | built — `notes.js`, `notes.worker.js`, `lib/ribbon.js` |
```

- [ ] **Step 2: Add the new files to the repo layout in `CLAUDE.md`**

After the `lib/sonify.js` line:

```
lib/ribbon.js                      ribbon geometry, classic script — window.SansRibbon
```

And after the `separate.js  separate.worker.js` line:

```
notes.js  notes.worker.js          ESM — notes panel and the analysis worker
```

Also update the `?v=` gotcha's trailing sentence from `Currently v1.9.0.` to `Currently v1.11.0.`, and its file list to name `notes.js` (2) and `notes.worker.js` (1).

- [ ] **Step 3: Add the devlog entry**

Get the timestamp:

```bash
git log -1 --format='%cd' --date=format:'%Y-%m-%d %H:%M'
```

Add a TL;DR row above the v1.10.0 row, then the entry itself above the v1.10.0 section, following the house format: `**Review:** not yet`, a `**Design docs:**` block linking the spec and this plan, `**What was built:**`, and `**Key technical learnings:**` with every bullet tagged `[note]` / `[insight]` / `[gotcha]`.

Learnings worth recording, each of which cost real time this phase:

- `[gotcha]` `el.lanes.innerHTML = ''` destroys anything parked inside `#lanes`, so the ribbon lane is built in `buildUI()` rather than declared in `index.html`. A static element would have worked for exactly one song.
- `[gotcha]` `getChannelData()` returns a live view into the `AudioBuffer`. Passing it to the worker as a *transferable* detaches the backing store and the stem goes silent mid-playback with no error anywhere. `.slice()` first.
- `[gotcha]` `tests/versions.test.js` reads a hardcoded `FILES` list. Adding a versioned file without adding it there leaves its `?v=` unchecked — the exact drift the test exists to catch.
- `[insight]` Reusing `paint()` for the ribbon costs nothing but keeping the `{ idle, active, h, w }` layer shape, and buys the playhead, the A-B shading and the clip behaviour for free. Matching an existing contract beat writing a second draw path.
- `[insight]` Analysis and interpretation being separate functions in `lib/pitch.js` — a boundary drawn during the PoC for testability — is what made a live slider possible at all. Re-deriving is 92× cheaper than re-analysing.

- [ ] **Step 4: Run the whole suite one last time**

Reload `http://localhost:8777/tests/test.html`.
Expected: `window.__testResults.failed` is 0.

- [ ] **Step 5: Commit and open the PR**

```bash
git add docs/devlog.md docs/transcription.md CLAUDE.md
git commit -m "Docs: v1.11.0 devlog, transcription status, repo layout"
git push -u origin ui/notes-ribbon
gh pr create --title "Notes ribbon in the player (v1.11.0)" --body "$(cat <<'EOF'
## Summary

A notes lane under the vocals stem, showing detected notes over the pitch contour they were
segmented from, on the same time grid as every waveform and seekable like any other lane.

Analysis runs once in `notes.worker.js` and is immutable. Interpretation re-runs on the main
thread whenever the **Shortest note** control moves — 11.9 ms against 7 s, so it re-derives
live rather than re-analysing.

## Verifying

- Units: `./scripts/serve.sh`, then `/tests/test.html` — fully green.
- By hand: load a stems zip, click **Find notes**, drag **Shortest note**. The note count
  must change in tens of milliseconds. That the slider moved is not evidence of anything;
  the count is.

## Docs

- [`docs/transcription.md`](docs/transcription.md) — the layer model this implements
- Spec: `docs/superpowers/specs/2026-08-30-notes-ribbon-design.md`
- Plan: `docs/superpowers/plans/2026-08-30-notes-ribbon.md`

## Not in this PR

Editing, tempo and the beat grid, persistence, 簡譜. See the spec's non-goals.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_016b58xDRAXw7GsdpSf2xPF5
EOF
)"
```

---

## Deferred

Note editing (Phase C), tempo and the beat grid, an HMM/Viterbi interpreter to replace
`threshold-v1`, persistence into the stems zip, and 簡譜. `docs/transcription.md` explains
why the Viterbi decoder is the highest-value of these for note quality and why beat tracking
is not.
