# ESM modules: app.js + classic-script lib/*.js → real import/export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `app.js` and 8 classic-script `lib/*.js` files (`stems.js`, `i18n.js`,
`platform.js`, `unzip.js`, `ribbon.js`, `jianpu.js`, `transport-math.js`, `analytics.js`)
from `(function (global) {...})(window)` IIFEs assigning `window.SansX` into real ES modules
with `import`/`export`, with zero change to app behavior.

**Architecture:** Each of the 8 lib files gets real `export` statements added around its
existing declarations, with the IIFE wrapper removed. Four of them (`i18n.js`,
`platform.js`, `analytics.js`, `jianpu.js`) keep a permanent, documented `window.SansX`
bridge because `separate.js`/`notes.js` (already ESM, out of scope) still read them that
way. The other four (`stems.js`, `unzip.js`, `ribbon.js`, `transport-math.js`) lose the
global entirely — but only after every remaining consumer (`app.js`, the test files) has
switched to importing them directly, which is why this plan converts those four lib files
first with a **temporary** bridge still in place, converts `app.js` and the tests next, and
only then removes the temporary bridge. `index.html` does not change at all: the 8
`<script type="module" src="lib/*.js">` tags already there keep working unchanged because ES
modules are singletons keyed by resolved URL — `app.js` importing the same files those tags
load causes no duplicate evaluation.

**Tech Stack:** Vanilla JS ES modules, Vite (`npm run dev` / `npm run build` / `npm run
preview`), the project's own browser-page test harness (`tests/test.html`,
`window.__testResults`).

**Spec:**
[`docs/superpowers/specs/2026-09-02-esm-modules-design.md`](../specs/2026-09-02-esm-modules-design.md)

## Global Constraints

- **No behavior change.** Every call site's arguments, return values, and side effects stay
  byte-identical — this is a pure structural conversion, never a rewrite of what a function
  does.
- **`index.html` gets no changes.** Not the 8 `<script type="module" src="lib/*.js">` tags in
  `<body>`, not the `<script type="module">window.SansI18n.init();</script>` in `<head>`.
- **Out of scope, do not touch:** `separate.js`, `notes.js`, `lib/wav.js`, `lib/zip.js`,
  `lib/overlap.js`, `lib/pitch.js`, `lib/sonify.js`, `lib/tempo.js`,
  `lib/stretch-processor.js` — already real ESM. `window.sansBass` (app.js's export, read by
  those two files) and `window.SansPitch` (`lib/pitch.js`'s export, read by app.js) are
  untouched boundaries.
- **Four files keep a permanent, documented `window.SansX` bridge:** `lib/i18n.js`,
  `lib/platform.js`, `lib/analytics.js`, `lib/jianpu.js` — because `separate.js`/`notes.js`
  read them via `window` and are out of scope for this refactor. The bridge comment is:
  ```js
  // Bridge for separate.js/notes.js (out of scope for this refactor, already ESM, still read
  // this via window) — not part of this module's own design.
  ```
- **Four files lose the global entirely, eventually:** `lib/stems.js`, `lib/unzip.js`,
  `lib/ribbon.js`, `lib/transport-math.js`. Tasks 1–4 give them real exports while
  temporarily keeping their existing `window.SansX` assignment (needed because `app.js`
  and some tests still read it via `window` until Tasks 9–11 land); Task 12 removes that
  temporary assignment once nothing reads it anymore.
- **Namespace imports for anything with more than one member**, to keep every call site a
  mechanical `window.SansX.` → `SansX.` find-replace and avoid `lib/i18n.js`'s exported `t`
  colliding by name with app.js's loop variable `t` (tracks). Named imports only for
  `lib/stems.js` (matches the existing destructure) and `lib/unzip.js`'s single `extract`.
- **Branch:** already on `refactor/esm-modules` — no new branch needed. Land through a PR to
  `main` as usual; never commit to `main` directly.
- **Verification is consolidated into one task at the end** (Task 14), not repeated per
  task. Per-task verification is the automated browser test suite
  (`tests/test.html` → `window.__testResults`) plus `npm run build` — fast, cheap, rerunnable.

---

## Task 1: `lib/stems.js` → ESM (temporary bridge)

**Files:**
- Modify: `lib/stems.js`

**Interfaces:**
- Produces: `export { STEMS, EXTRA_COLORS, AUDIO_RE, detectStem, assignStems,
  hasMixPlusStems }` — consumed later by `lib/unzip.js` (Task 2, `AUDIO_RE`), `app.js`
  (Task 9), and `tests/stems.test.js`/`tests/i18n.test.js` (Task 10).
- `window.SansStems` keeps working identically in the meantime (temporary; removed Task 12).

- [ ] **Step 1: Rewrite the file**

Read the current file first, then replace its full content with:

```js
/* Stem identity: which lane does a given file belong to? */

const STEMS = {
  vocals: { label: 'Vocals',    color: '#ff2e63', order: 0 },
  guitar: { label: 'Guitar',    color: '#ffb703', order: 1 },
  bass:   { label: 'Bass',      color: '#3ddc97', order: 2 },
  drums:  { label: 'Drums',     color: '#4cc9f0', order: 3 },
  piano:  { label: 'Piano',     color: '#b388ff', order: 4 },
  other:  { label: 'Other',     color: '#8d99ae', order: 5 },
  mix:    { label: 'Full mix',  color: '#e9e9ef', order: 6 },
};

const EXTRA_COLORS = ['#f77f00', '#00b4d8', '#c77dff', '#90be6d', '#f9c74f'];
const AUDIO_RE = /\.(wav|wave|flac|m4a|mp4|aac|mp3|opus|ogg|oga|aif|aiff|caf|webm)$/i;

/** Guess which instrument a file holds from its name. */
function detectStem(filename) {
  const n = filename.toLowerCase().replace(AUDIO_RE, '');
  if (/no[-_ ]?vocals?|instrumental|karaoke|backing/.test(n)) return 'other';
  if (/vocal|vox|voice|sing|lead[-_ ]?v/.test(n)) return 'vocals';
  if (/guitar|gtr|gitaa?r|rhythm|riff/.test(n)) return 'guitar';
  if (/\bbass\b|bassline|bs\b/.test(n)) return 'bass';
  if (/drum|percussion|kick|snare|beat/.test(n)) return 'drums';
  if (/piano|keys|keyboard|synth|organ/.test(n)) return 'piano';
  if (/other|residual|accomp/.test(n)) return 'other';
  // Deliberately narrow: a generic word like "track" must not claim the mix slot,
  // because the mix slot suppresses every other track when it is filled.
  if (/\bmix\b|\bfull\b|\bmaster\b|\boriginal\b/.test(n)) return 'mix';
  return null;
}

/**
 * Resolve lane identity for a set of items.
 * @param {{name: string, stem?: string}[]} items — `stem` wins over filename detection
 * @returns {{name, stem, label, color, order}[]}
 */
function assignStems(items) {
  const used = new Set();
  const out = items.map((item, i) => {
    let stem = item.stem ?? detectStem(item.name);
    if (stem && used.has(stem)) stem = null;      // no duplicate stem slots
    if (stem) used.add(stem);
    const meta = stem ? STEMS[stem] : null;
    return {
      ...item,
      stem,
      label: meta ? meta.label : item.name.replace(AUDIO_RE, ''),
      color: meta ? meta.color : EXTRA_COLORS[i % EXTRA_COLORS.length],
      order: meta ? meta.order : 10 + i,
    };
  });

  // A single unlabelled file is simply the whole song.
  if (out.length === 1 && !items[0].stem) {
    out[0].stem = 'mix';
    out[0].label = STEMS.mix.label;
    out[0].color = STEMS.mix.color;
    out[0].order = STEMS.mix.order;
  }
  return out;
}

/**
 * True when a full-mix track sits alongside real stems. The player uses this to play the
 * mix file for "Full mix" and switch to the stems when soloing — without it, the mix would
 * be summed on top of the stems it was separated from.
 */
function hasMixPlusStems(assigned) {
  return assigned.some((t) => t.stem !== 'mix') && assigned.some((t) => t.stem === 'mix');
}

export { STEMS, EXTRA_COLORS, AUDIO_RE, detectStem, assignStems, hasMixPlusStems };

window.SansStems = { STEMS, EXTRA_COLORS, AUDIO_RE, detectStem, assignStems, hasMixPlusStems };
```

- [ ] **Step 2: Verify**

Run `npm run dev` (if not already running), open `http://localhost:8777/tests/test.html`,
read `window.__testResults` in the console. Expected: `{ total: 265, failed: 0, ... }`
(unchanged from before this task — the exported object's shape and every function body are
byte-identical to before).

Also run `npm run build` — expected: succeeds with no errors (catches a stray syntax
mistake in the rewrite).

- [ ] **Step 3: Commit**

```bash
git add lib/stems.js
git commit -m "$(cat <<'EOF'
refactor: lib/stems.js real ES module exports

Adds real export statements alongside the existing window.SansStems assignment, which
stays temporarily until app.js and the tests switch to importing directly (later tasks in
this plan). No behavior change — same functions, same object shape.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bvqufews8V2NGpiddxj95w
EOF
)"
```

---

## Task 2: `lib/unzip.js` → ESM (temporary bridge), imports `AUDIO_RE` from `stems.js`

**Files:**
- Modify: `lib/unzip.js`

**Interfaces:**
- Consumes: `AUDIO_RE` from `lib/stems.js` (Task 1).
- Produces: `export { extract }` — consumed later by `app.js` (Task 9) and
  `tests/unzip.test.js` (Task 10).
- `window.SansUnzip` keeps working identically in the meantime (temporary; removed Task 12).

- [ ] **Step 1: Rewrite the file**

Read the current file first, then replace its full content with:

```js
/* Zip reading: pull audio entries out of a .zip without reading the whole file into memory.
 *
 * Shares no code with lib/zip.js, which writes zips. tests/unzip.test.js round-trips the
 * two against each other to keep them agreeing.
 *
 * Memory: a File from <input type="file"> is disk-backed. blob.slice() is free and reads
 * nothing; only awaiting .arrayBuffer() on a slice touches the disk. So the whole zip is
 * never resident — for a six-stem WAV zip that is the difference between ~636 MB and
 * ~848 MB of peak heap, which is close enough to Chrome's ceiling to matter. */
import { AUDIO_RE } from './stems.js';

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 65535;

const ZIP64 = 'This zip uses Zip64, which is not supported. Re-zip it with Finder’s Compress, or `zip -r`.';

/** An Error carrying a stable `code` for the tests and a user-ready `message` for the UI. */
function zipError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const basename = (path) => path.slice(path.lastIndexOf('/') + 1);

/* Names are decoded as UTF-8 whether or not general purpose bit 11 is set. The spec says
 * an unset bit means CP437, but real zips are either UTF-8 or plain ASCII, and a CP437
 * table would be a hundred lines to fix names that do not occur. */
const decodeName = (bytes) => new TextDecoder('utf-8').decode(bytes);

/** Scan backwards for the EOCD signature. Returns its offset in `dv`, or -1. */
function findEocd(dv) {
  for (let i = dv.byteLength - EOCD_MIN; i >= 0; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

/** Entries worth reading: real files, not Finder noise, with an audio extension. */
function keep(path) {
  if (path.endsWith('/')) return false;                  // directory entry
  if (path.startsWith('__MACOSX/')) return false;        // Finder's resource-fork sidecar
  const base = basename(path);
  if (base.startsWith('._')) return false;               // AppleDouble
  return AUDIO_RE.test(base);
}

/**
 * Read the audio entries out of a zip.
 * @param {Blob} blob
 * @returns {Promise<{name: string, webkitRelativePath: string, bytes: Uint8Array}[]>}
 *
 * Each `bytes` is backed by its own exact-size ArrayBuffer, never a view into a shared
 * allocation: decodeAudioData detaches what it is handed, and a shared buffer would take
 * its neighbours down with it. The result is therefore ONE-SHOT — once an entry has been
 * decoded, its buffer is detached and cannot be read again.
 */
async function extract(blob) {
  const tailLen = Math.min(blob.size, MAX_COMMENT + EOCD_MIN);
  const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
  const e = findEocd(tail);
  if (e < 0) throw zipError('not-zip', 'That file is not a zip.');

  const total = tail.getUint16(e + 10, true);
  const cdSize = tail.getUint32(e + 12, true);
  const cdOff = tail.getUint32(e + 16, true);
  if (total === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
    throw zipError('zip64', ZIP64);
  }

  const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const wanted = [];
  let p = 0;
  for (let i = 0; i < total; i++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== CD_SIG) {
      throw zipError('not-zip', 'That zip’s directory is damaged.');
    }
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    const cSize = cd.getUint32(p + 20, true);
    const lhOff = cd.getUint32(p + 42, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const cmtLen = cd.getUint16(p + 32, true);
    // Without this the Uint8Array constructor throws a raw RangeError, and the user is
    // shown "Invalid typed array length: 60000" instead of being told the zip is damaged.
    if (p + 46 + nameLen > cd.byteLength) {
      throw zipError('not-zip', 'That zip’s directory is damaged.');
    }
    const path = decodeName(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    p += 46 + nameLen + extraLen + cmtLen;

    if (!keep(path)) continue;
    if (flags & 0x1) throw zipError('encrypted', 'That zip is encrypted.');
    if (cSize === 0xffffffff || lhOff === 0xffffffff) throw zipError('zip64', ZIP64);
    wanted.push({ path, method, cSize, lhOff });
  }

  const out = [];
  for (const w of wanted) {
    out.push({
      name: basename(w.path),
      webkitRelativePath: w.path,
      bytes: await readEntry(blob, w),
    });
  }
  return out;
}

async function readEntry(blob, w) {
  const head = new DataView(await blob.slice(w.lhOff, w.lhOff + 30).arrayBuffer());
  if (head.byteLength < 30 || head.getUint32(0, true) !== LFH_SIG) {
    throw zipError('not-zip', `Could not find ${basename(w.path)} inside the zip.`);
  }
  /* The LOCAL header's own name and extra lengths — they are allowed to differ from the
   * central directory's, and using the CD's extra length lands mid-file. Sizes, though,
   * come from the central directory: when general purpose bit 3 is set the local sizes
   * are zero and the real ones trail the data in a descriptor. */
  const dataStart = w.lhOff + 30 + head.getUint16(26, true) + head.getUint16(28, true);

  const short = () => zipError('read',
    `Could not read ${basename(w.path)} from the zip — the file may be truncated, ` +
    `or it changed on disk.`);

  let raw;
  try {
    raw = await blob.slice(dataStart, dataStart + w.cSize).arrayBuffer();
  } catch (err) {
    throw short();
  }
  /* blob.slice() CLAMPS an out-of-range end instead of throwing, so a truncated archive
   * resolves here with fewer bytes than the central directory promised — and, unchecked,
   * hands decodeAudioData the central directory glued onto the payload. That surfaces as
   * "codec not supported", which sends the user off diagnosing the wrong thing. */
  if (raw.byteLength !== w.cSize) throw short();

  if (w.method === 0) return new Uint8Array(raw);
  if (w.method === 8) return inflateRaw(raw, w.path);
  throw zipError('method',
    `Unsupported compression in ${basename(w.path)}. Re-zip with Finder or \`zip\`.`);
}

async function inflateRaw(raw, path) {
  let ds;
  try {
    ds = new DecompressionStream('deflate-raw');
  } catch (err) {
    throw zipError('no-deflate',
      'This browser cannot read compressed zips. Re-zip it uncompressed with `zip -0 -r`.');
  }
  /* A broken deflate stream rejects with a platform error whose message may be empty,
   * and say() HIDES the status bar when handed an empty string — so letting this escape
   * turns a corrupt zip into a drop that visibly does nothing at all. */
  try {
    const stream = new Blob([raw]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (err) {
    throw zipError('corrupt',
      `${basename(path)} is corrupt inside the zip and could not be decompressed.`);
  }
}

export { extract };

window.SansUnzip = { extract };
```

- [ ] **Step 2: Verify**

`npm run dev` (if not already running) → `http://localhost:8777/tests/test.html` →
`window.__testResults` → expected `{ total: 265, failed: 0, ... }`. Then `npm run build` →
expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/unzip.js
git commit -m "$(cat <<'EOF'
refactor: lib/unzip.js real ES module exports

Imports AUDIO_RE from lib/stems.js's new real export instead of reading it off
window.SansStems, and adds a real export for extract() alongside the existing
window.SansUnzip assignment (temporary; removed later in this branch). No behavior change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bvqufews8V2NGpiddxj95w
EOF
)"
```

---

## Task 3: `lib/ribbon.js` → ESM (temporary bridge)

**Files:**
- Modify: `lib/ribbon.js`

**Interfaces:**
- Produces: `export { pitchRange, contourSegments, contourColumns, zoomPeaks, zoomWindow,
  beatTimes, subdivisionTimes }` — consumed later by `app.js` (Task 9),
  `tests/ribbon.test.js` (Task 10), `tests/notes.html` (Task 11).
- `window.SansRibbon` keeps working identically in the meantime (temporary; removed Task 12).

- [ ] **Step 1: Rewrite the file**

Read the current file first, then replace its full content with:

```js
/* Ribbon geometry — the pure parts of drawing a notes lane.
 *
 * Nothing here touches the DOM or a canvas: it maps notes and frames to numbers, and
 * app.js turns those into pixels.
 */
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
 *
 * This is the ONLY thing clip does. It is a display choice about the vertical scale: it
 * never reaches `interpret()`, so the note list is the same either way, and a clipped
 * note still sounds at its detected pitch. To change which notes exist, move the
 * shortest-note control or the interpreter.
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


/**
 * The pitch contour as a list of polylines, each point [timeFraction, midi].
 *
 * NOT used by the player: the full-width lane uses contourColumns, and the zoomed pane
 * draws its line inline because it already walks the frames in its window. Kept because
 * it is the correct primitive for any consumer drawing at a width where a column is one
 * frame or less, and it is covered by tests.
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


/**
 * The contour reduced to one [lo, hi] band per pixel column, or null where a column
 * holds no voiced frame.
 *
 * At whole-song width a column spans ~26 frames. Joining those with a polyline draws
 * near-vertical strokes between unrelated pitches and fills the lane with noise; the
 * band says what the waveform lanes say — the range covered here — and stays honest
 * about an octave error instead of hiding it in a smear.
 */
function contourColumns(frames, duration, width) {
  const cols = new Array(Math.max(1, Math.floor(width))).fill(null);
  if (!duration) return cols;
  for (let i = 0; i < frames.cents.length; i++) {
    const cents = frames.cents[i];
    if (!cents) continue;
    const x = Math.floor((frames.t[i] / duration) * cols.length);
    if (x < 0 || x >= cols.length) continue;
    const midi = cents / 100;
    const c = cols[x];
    if (!c) cols[x] = { lo: midi, hi: midi };
    else { if (midi < c.lo) c.lo = midi; if (midi > c.hi) c.hi = midi; }
  }
  return cols;
}


/**
 * Peak envelope at a fixed resolution in TIME, for the zoomed view.
 *
 * The lane waveforms use a fixed bucket COUNT across the whole song, which is right for
 * a view that always shows everything and useless for one that shows ten seconds. This
 * is computed once per stem and sliced per window.
 */
function zoomPeaks(channel, sampleRate, bucketsPerSecond) {
  const bps = bucketsPerSecond;
  const per = sampleRate / bps;
  const n = Math.max(1, Math.floor(channel.length / per));
  const mins = new Float32Array(n);
  const maxs = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(channel.length, Math.floor((b + 1) * per));
    let lo = 0;
    let hi = 0;
    for (let i = start; i < end; i++) {
      const v = channel[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    mins[b] = lo;
    maxs[b] = hi;
  }
  return { mins, maxs, bps };
}

/**
 * The visible window for a zoomed view, as { from, to }.
 *
 * Clamping slides the window rather than shrinking it: a window that narrows at the
 * ends would change the time scale exactly where the user is trying to read it.
 */
function zoomWindow(center, seconds, duration) {
  const width = Math.min(seconds, duration);
  let from = center - width / 2;
  if (from < 0) from = 0;
  if (from + width > duration) from = duration - width;
  return { from, to: from + width };
}

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

/**
 * Sub-beat grid times, in seconds — the points strictly between beats at 1/`divisionsPerBeat`
 * resolution. `divisionsPerBeat: 2` gives the half-beat midpoint; `4` gives every quarter-beat
 * (which includes that same midpoint alongside the two true quarters). On-beat points are
 * excluded — those are `beatTimes`'s job, and drawing both would double a line. Same
 * phase-normalisation and edge behaviour as `beatTimes`, since it shares that math.
 */
function subdivisionTimes(tempo, duration, divisionsPerBeat) {
  const out = [];
  if (!tempo || !tempo.bpmValue || tempo.bpmValue <= 0 || !duration) return out;
  if (!divisionsPerBeat || divisionsPerBeat < 2) return out;

  const periodMs = 60000 / tempo.bpmValue;
  let phase = tempo.phaseMs % periodMs;
  if (phase < 0) phase += periodMs;

  const periodSec = periodMs / 1000;
  const firstT = phase / 1000;
  const step = periodSec / divisionsPerBeat;

  let i = 0;
  for (let t = firstT; t <= duration; t += step, i++) {
    if (i % divisionsPerBeat === 0) continue;
    out.push(t);
  }
  return out;
}

export { pitchRange, contourSegments, contourColumns, zoomPeaks, zoomWindow, beatTimes, subdivisionTimes };

window.SansRibbon = {
  pitchRange, contourSegments, contourColumns, zoomPeaks, zoomWindow, beatTimes, subdivisionTimes,
};
```

- [ ] **Step 2: Verify**

`npm run dev` → `http://localhost:8777/tests/test.html` → `window.__testResults` →
expected `{ total: 265, failed: 0, ... }`. Then `npm run build` → expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/ribbon.js
git commit -m "$(cat <<'EOF'
refactor: lib/ribbon.js real ES module exports

Adds real export statements alongside the existing window.SansRibbon assignment
(temporary; removed later in this branch). No behavior change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bvqufews8V2NGpiddxj95w
EOF
)"
```

---

## Task 4: `lib/transport-math.js` → ESM (temporary bridge)

**Files:**
- Modify: `lib/transport-math.js`

**Interfaces:**
- Produces: `export { RATE_MIN, RATE_MAX, RATE_STEP, RATE_FINE_STEP, RATE_DEFAULT,
  clampRatePercent, nudgeRatePercent, currentTimeAtRate }` — consumed later by `app.js`
  (Task 9) and `tests/transport-math.test.js` (Task 10).
- `window.SansTransportMath` keeps working identically in the meantime (temporary; removed
  Task 12).

- [ ] **Step 1: Rewrite the file**

Read the current file first, then replace its full content with:

```js
/* Pure playback-speed math, factored out of app.js so it is unit-testable. */
const RATE_MIN = 10;
const RATE_MAX = 150;
const RATE_STEP = 5;       // coarse step: the slider (native HTML step) and plain [ / ]
const RATE_FINE_STEP = 1;  // fine step: Shift+[ / Shift+], for landing between multiples of 5
const RATE_DEFAULT = 100;

/** Clamp to [RATE_MIN, RATE_MAX], rounded to a whole percent. Deliberately does NOT snap
 *  to RATE_STEP — Shift+[ / Shift+] relies on this to land on values like 97 or 101 that
 *  a coarse round-to-5 would erase. The slider's own multiples-of-5 come from its native
 *  HTML `step` attribute at drag time, not from this function re-snapping afterward. */
function clampRatePercent(n) {
  return Math.max(RATE_MIN, Math.min(RATE_MAX, Math.round(n)));
}

/** ratePercent nudged by deltaPercent (±RATE_STEP for [ / ], ±RATE_FINE_STEP for the
 *  Shift-held fine variant), clamped to range. */
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

export { RATE_MIN, RATE_MAX, RATE_STEP, RATE_FINE_STEP, RATE_DEFAULT,
         clampRatePercent, nudgeRatePercent, currentTimeAtRate };

window.SansTransportMath = { RATE_MIN, RATE_MAX, RATE_STEP, RATE_FINE_STEP, RATE_DEFAULT,
         clampRatePercent, nudgeRatePercent, currentTimeAtRate };
```

- [ ] **Step 2: Verify**

`npm run dev` → `http://localhost:8777/tests/test.html` → `window.__testResults` →
expected `{ total: 265, failed: 0, ... }`. Then `npm run build` → expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/transport-math.js
git commit -m "$(cat <<'EOF'
refactor: lib/transport-math.js real ES module exports

Adds real export statements alongside the existing window.SansTransportMath assignment
(temporary; removed later in this branch). No behavior change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bvqufews8V2NGpiddxj95w
EOF
)"
```

---

## Task 5: `lib/i18n.js` → ESM (permanent bridge)

**Files:**
- Modify: `lib/i18n.js`

**Interfaces:**
- Produces: `export { LOCALES, DICT, t, has, apply, init, detectLocale, storedLocale,
  getLocale, setLocale }` — consumed later by `app.js` (Task 9) and `tests/i18n.test.js`
  (Task 10). `window.SansI18n` is a **permanent** bridge (read by `separate.js`, `notes.js`,
  and `index.html`'s head `init()` call) — not removed by any later task.

- [ ] **Step 1: Edit the header comment**

Read the file first. Replace:

```js
/* Interface i18n: one dictionary, two locales, no dependencies.
 *
 * A CLASSIC script, matching lib/stems.js and lib/unzip.js. It no longer *has* to be —
 * file:// support was dropped in v1.5.0 — but the ESM migration is a separate change
 * (see docs/superpowers/specs/2026-08-21-i18n-design.md, "Deferred").
 *
 * separate.js is an ES module and cannot share scope with app.js, so both read this
 * through window.SansI18n. That is the whole reason there is exactly one dictionary. */
(function (global) {
```

with:

```js
/* Interface i18n: one dictionary, two locales, no dependencies.
 *
 * separate.js and notes.js are ES modules that cannot share scope with app.js's own
 * module graph without an explicit bridge, so both still read this through
 * window.SansI18n. That is the whole reason there is exactly one dictionary. app.js
 * imports it directly. */
```

- [ ] **Step 2: Add `export` to each publicly-read declaration**

Six targeted edits (each `old_string` is unique in the file):

```
old: "  const LOCALES = ['zh-TW', 'en'];"
new: "  export const LOCALES = ['zh-TW', 'en'];"
```

Wait — the file is still indented two spaces from the old IIFE body; since Step 1 removed
the IIFE wrapper, de-indent the whole body by 2 spaces as part of these edits (each
`old_string`/`new_string` pair below shows the original 2-space-indented line becoming an
unindented top-level line — apply this de-indentation to literally every line in the file
as you touch it, not just the ones shown; the file has no other structure than this one
former IIFE body, so the result is the entire file at 0-indent, matching Task 1–4's style).

Declarations to prefix with `export` (all become 0-indented, matching the rest of the
de-indented file):

```js
export const LOCALES = ['zh-TW', 'en'];
```
```js
export const DICT = {
```
(the `DICT` object's ~400 lines of content and its closing `};` are otherwise untouched —
only the declaration line gains `export` and loses its 2-space indent)
```js
export function has(key) {
```
```js
export function t(key, params) {
```
```js
export function apply(root) {
```
```js
export function init() {
```
```js
export function detectLocale(langs) {
```
```js
export function storedLocale() {
```
```js
export function getLocale() { return locale; }
```
```js
export function setLocale(loc, opts) {
```

`DEFAULT_LOCALE`, `STORAGE_KEY`, `locale`, `booted`, and `isTraditionalChinese` stay plain
(unexported) declarations — nothing outside this file reads them.

- [ ] **Step 3: Replace every `global.` with `window.`**

The IIFE parameter `global` no longer exists. Five internal reads plus the closing bridge
line:

```
old: "      (global.navigator && navigator.languages) ||"
new: "      (window.navigator && navigator.languages) ||"
```
```
old: "      (global.navigator && navigator.language ? [navigator.language] : []) ||"
new: "      (window.navigator && navigator.language ? [navigator.language] : []) ||"
```
```
old: "      const v = global.localStorage.getItem(STORAGE_KEY);"
new: "      const v = window.localStorage.getItem(STORAGE_KEY);"
```
```
old: "      try { global.localStorage.setItem(STORAGE_KEY, locale); } catch (e) { /* see above */ }"
new: "      try { window.localStorage.setItem(STORAGE_KEY, locale); } catch (e) { /* see above */ }"
```
```
old: "    if (global.document) {"
new: "    if (window.document) {"
```
```
old: "    global.dispatchEvent(new CustomEvent('sansbass:langchange', { detail: { locale } }));"
new: "    window.dispatchEvent(new CustomEvent('sansbass:langchange', { detail: { locale } }));"
```

- [ ] **Step 4: Replace the closing bridge + remove the IIFE close**

```
old:
"  global.SansI18n = {
    LOCALES, DICT, t, has, apply, init,
    detectLocale, storedLocale, getLocale, setLocale,
  };
})(window);"

new:
"// Bridge for separate.js/notes.js (out of scope for this refactor, already ESM, still read
// this via window) — not part of this module's own design.
window.SansI18n = {
  LOCALES, DICT, t, has, apply, init,
  detectLocale, storedLocale, getLocale, setLocale,
};"
```

- [ ] **Step 5: De-indent the whole file by 2 spaces**

The original file's whole body sat inside `(function (global) { ... })(window);` at a
uniform 2-space indent. After Steps 1–4 remove the wrapper, every line in the file — the
`DICT` object's ~400 lines included — should shift left by exactly 2 spaces so indentation
stays consistent with the rest of the codebase. Do this as one pass: open the file, verify
the wrapper is gone (Steps 1 and 4 already removed the `(function (global) {` and
`})(window);` lines), then re-indent every remaining line by removing its leading 2 spaces.
Since editors and `sed` handle this uniformly, a safe mechanical approach:

```bash
sed -i '' 's/^  //' lib/i18n.js
```

Run this **only if** the file no longer contains the IIFE wrapper (Steps 1–4 done first) —
it blindly strips the first 2 leading spaces from every line, which is exactly the
uniform indent the wrapper body had. Read the file afterward to confirm it looks right
(the `DICT` entries' own internal alignment — e.g. multi-line strings — should be
unaffected, since none of them have leading spaces of their own beyond the wrapper indent).

- [ ] **Step 6: Verify**

`npm run dev` → `http://localhost:8777/tests/test.html` → `window.__testResults` →
expected `{ total: 265, failed: 0, ... }` (this file's exports aren't consumed by any test
yet — that's Task 10 — so this only proves the file still parses and `window.SansI18n`
still works identically for `index.html`'s `init()` call and the rest of the suite). Then
`npm run build` → expected: succeeds. Also load `http://localhost:8777/` directly and
confirm the page boots with translated text visible (proves `init()` still runs correctly
against the converted file).

- [ ] **Step 7: Commit**

```bash
git add lib/i18n.js
git commit -m "$(cat <<'EOF'
refactor: lib/i18n.js real ES module exports

Real export statements for everything separate.js/notes.js/app.js/the tests read, plus a
permanent, documented window.SansI18n bridge — separate.js and notes.js are out of scope
for this refactor and can only reach this file through window. No behavior change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bvqufews8V2NGpiddxj95w
EOF
)"
```

---

## Task 6: `lib/platform.js` → ESM (permanent bridge)

**Files:**
- Modify: `lib/platform.js`

**Interfaces:**
- Produces: `export { isHandheld }` — consumed later by `app.js` (Task 9) and
  `tests/platform.test.js` (Task 10). `window.SansPlatform` is a **permanent** bridge (read
  by `separate.js`) — not removed by any later task.

- [ ] **Step 1: Rewrite the file**

Read the current file first, then replace its full content with:

```js
/* Which device class is this? Currently one question: is this a phone or a tablet, where
 * in-browser separation cannot run.
 *
 * Why separation is gated at all: on iOS 26.6 the FIRST session.run() kills the Safari tab
 * on every ORT runtime and execution provider tested, while ~1.9 GiB of WASM heap was
 * still available on the same device. The accumulators, the 285 MB model, the memory
 * floor, iOS's WebGPU backend and asyncify instrumentation were each ruled out by
 * measurement — see spike/RESULTS.md. What remains is the working set of one segment on a
 * fixed [1, 2, 343980] input, and N_SAMPLES is baked into the ONNX graph, so nothing in
 * this repo can shrink it.
 *
 * The test is capability-shaped, not vendor-shaped. Android phones are untested and very
 * likely fail the same way, and iPadOS reports itself as a Mac — any /iPhone|iPad/ test
 * would miss it entirely.
 *
 * separate.js (an ES module) reads this file's window.SansPlatform bridge; app.js imports
 * it directly. */
'use strict';

/**
 * True for a phone or tablet. BOTH conditions are required: a coarse primary pointer
 * alone matches a TV, and maxTouchPoints > 1 alone matches a touchscreen desktop.
 *
 * PURE — it reads the window you hand it, so the whole truth table can be unit-tested
 * without stubbing the real navigator. Same shape as SansI18n.detectLocale(langs).
 * @param {Window} [win] defaults to the real window
 * @returns {boolean}
 */
function isHandheld(win) {
  const w = win || window;
  const coarse = !!(w.matchMedia && w.matchMedia('(pointer: coarse)').matches);
  const touch = !!(w.navigator && w.navigator.maxTouchPoints > 1);
  return coarse && touch;
}

export { isHandheld };

// Bridge for separate.js (out of scope for this refactor, already ESM, still read this via
// window) — not part of this module's own design.
window.SansPlatform = { isHandheld };
```

- [ ] **Step 2: Verify**

`npm run dev` → `http://localhost:8777/tests/test.html` → `window.__testResults` →
expected `{ total: 265, failed: 0, ... }`. Then `npm run build` → expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/platform.js
git commit -m "$(cat <<'EOF'
refactor: lib/platform.js real ES module exports

Real export for isHandheld(), plus a permanent, documented window.SansPlatform bridge —
separate.js is out of scope for this refactor and can only reach this file through window.
No behavior change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bvqufews8V2NGpiddxj95w
EOF
)"
```

---

## Task 7: `lib/analytics.js` → ESM (permanent bridge)

**Files:**
- Modify: `lib/analytics.js`

**Interfaces:**
- Produces: `export { track, once, bump, setSink, reset, watch }` — consumed later by
  `app.js` (Task 9) and `tests/analytics.test.js` (Task 10). `window.SansAnalytics` is a
  **permanent** bridge (read by `separate.js`) — not removed by any later task. `watch()`
  keeps being called once at module evaluation time, same as today.

- [ ] **Step 1: Rewrite the file**

Read the current file first, then replace its full content with:

```js
/* Usage analytics — anonymous, cookieless event counts via GoatCounter.
 *
 * Three verbs, because there are exactly three counting questions worth asking:
 *   track(name)  every occurrence      — one-per-song things like a load or a separation
 *   once(name)   first time per load   — "did this visitor ever reach X"
 *   bump(name)   power-of-two buckets  — how intensively, without guessing at cut points
 *
 * Nothing here may ever break the player, and nothing here may ever carry user content:
 * every name is a constant or a stem id from a fixed set. No filenames, no song titles.
 *
 * separate.js (an ES module) reads this file's window.SansAnalytics bridge; app.js
 * imports it directly. */
'use strict';

const QUEUE_MAX = 50;   // an ad blocker means the sink never arrives; do not grow for ever
const MAX_BUCKET = 4096;  // bounds the name set no matter how long a session runs
const POLL_MS = 250;      // GoatCounter's docs recommend polling for count()
const POLL_LIMIT_MS = 10000;   // give up: an ad blocker means it is never coming

const fired = new Set();     // names already sent by once()
const counts = new Map();    // name -> occurrences, for bump()
const queue = [];            // names waiting for a sink
let sink = null;
let poller = 0;              // interval id while waiting for GoatCounter (Task 3)
let waited = 0;

/** Hand one name to the sink, or hold it. A sink that throws is swallowed: analytics
 *  must never be able to take out the caller. */
function send(name) {
  if (!sink) {
    if (queue.length < QUEUE_MAX) queue.push(name);
    return;
  }
  try { sink(name); } catch (e) { /* never rethrow */ }
}

function drain() {
  while (sink && queue.length) {
    const name = queue.shift();
    try { sink(name); } catch (e) { /* never rethrow */ }
  }
}

function track(name) {
  send(name);
}

function once(name) {
  if (fired.has(name)) return;
  fired.add(name);
  send(name);
}

/**
 * Count an interaction and emit a cumulative survival curve:
 *   1st  -> "seek"
 *   2nd  -> "seek-2"      4th -> "seek-4"      8th -> "seek-8"   ...
 * Each row's count is a session count, so the rows read as a distribution rather than
 * a total. No cut points to guess, and nothing deferred to a flush that might not run.
 */
function bump(name) {
  const n = (counts.get(name) || 0) + 1;
  counts.set(name, n);
  if (n === 1) { send(name); return; }
  if (n > MAX_BUCKET) return;
  if ((n & (n - 1)) === 0) send(`${name}-${n}`);   // n is a power of two
}

/** Install the transport and flush anything that arrived before it existed. */
function setSink(fn) {
  if (poller) { clearInterval(poller); poller = 0; }
  sink = fn;
  drain();
}

/** The real transport. `title` is empty on purpose. GoatCounter fills it from the
 *  surrounding element or the document title when it is omitted. That is harmless
 *  today — document.title is always the static app.title string — but it would start
 *  leaking the moment someone makes the title dynamic ("<song> — sans_bass" is the
 *  obvious future change). Pinning it to '' means the payload cannot acquire content
 *  by accident. */
function goatcounterSink(name) {
  window.goatcounter.count({ path: name, title: '', event: true });
}

/** Wait for GoatCounter's async script, then hand it the queue.
 *  Restartable, and bounded — a forever-polling interval is a leak on a page that
 *  already holds six AudioBuffers. */
function watch() {
  if (poller) clearInterval(poller);
  waited = 0;
  poller = setInterval(() => {
    if (window.goatcounter && typeof window.goatcounter.count === 'function') {
      clearInterval(poller);
      poller = 0;
      setSink(goatcounterSink);
      return;
    }
    waited += POLL_MS;
    if (waited >= POLL_LIMIT_MS) { clearInterval(poller); poller = 0; }
  }, POLL_MS);
}

/** Test seam. Clears the sink too, so a test can exercise the queue. */
function reset() {
  fired.clear();
  counts.clear();
  queue.length = 0;
  sink = null;
}

export { track, once, bump, setSink, reset, watch };

// Bridge for separate.js (out of scope for this refactor, already ESM, still read this via
// window) — not part of this module's own design.
window.SansAnalytics = { track, once, bump, setSink, reset, watch };
watch();
```

- [ ] **Step 2: Verify**

`npm run dev` → `http://localhost:8777/tests/test.html` → `window.__testResults` →
expected `{ total: 265, failed: 0, ... }` (in particular the `analytics: watch() installs
the GoatCounter sink and drains the queue` test, which depends on `watch()` still running
at module load). Then `npm run build` → expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/analytics.js
git commit -m "$(cat <<'EOF'
refactor: lib/analytics.js real ES module exports

Real export statements plus a permanent, documented window.SansAnalytics bridge —
separate.js is out of scope for this refactor and can only reach this file through window.
watch() still runs once at module evaluation, same as before. No behavior change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bvqufews8V2NGpiddxj95w
EOF
)"
```

---

## Task 8: `lib/jianpu.js` → ESM (permanent bridge)

**Files:**
- Modify: `lib/jianpu.js`

**Interfaces:**
- Produces: `export { degreeOf, referenceOctave, degreeToken }` — consumed later by `app.js`
  (Task 9) and `tests/jianpu.test.js` (Task 10). `window.SansJianpu` is a **permanent**
  bridge (read by `notes.js`) — not removed by any later task.

- [ ] **Step 1: Rewrite the file**

Read the current file first, then replace its full content with:

```js
/* 簡譜 — absolute pitches as scale degrees.
 *
 * Nothing here touches the DOM: it maps a MIDI number to a degree, and app.js turns that
 * into pixels. notes.js (an ES module) reads this file's window.SansJianpu bridge; app.js
 * imports it directly.
 */
/* Degree and accidental for each semitone offset above the tonic.
 *
 * The two rows are NOT transpositions of one another, and that is the point of the mode
 * selector. In minor, flat-three, flat-six and flat-seven ARE degrees 3, 6 and 7 — they
 * sit in the scale — so the notes outside it are the raised ones. E flat is `b3` in
 * 1=C major and plain `3` in 1=C minor. */
const MAJOR = [
  ['1', ''], ['1', '#'], ['2', ''], ['3', 'b'], ['3', ''], ['4', ''],
  ['4', '#'], ['5', ''], ['6', 'b'], ['6', ''], ['7', 'b'], ['7', ''],
];
const MINOR = [
  ['1', ''], ['1', '#'], ['2', ''], ['3', ''], ['3', '#'], ['4', ''],
  ['4', '#'], ['5', ''], ['6', ''], ['6', '#'], ['7', ''], ['7', '#'],
];

const WEIGHT_PER_SECOND = 40;   // mirrors lib/ribbon.js and lib/pitch.js

/**
 * A MIDI note as a scale degree in the given key.
 *
 * Returns { digit, accidental, octaveIndex }. `octaveIndex` counts octaves from the
 * TONIC, not from C: a 簡譜 octave runs 1 to 7 and begins again at the next 1, so the
 * boundary sits on the tonic. It is an absolute index; subtract referenceOctave() to get
 * the signed offset the dots are drawn from.
 */
function degreeOf(midi, tonicPc, mode) {
  const table = mode === 'minor' ? MINOR : MAJOR;
  const steps = midi - tonicPc;
  const offset = ((steps % 12) + 12) % 12;
  const [digit, accidental] = table[offset];
  return { digit, accidental, octaveIndex: Math.floor(steps / 12) };
}

/**
 * The octave whose numbers are drawn bare, as an octaveIndex.
 *
 * The one holding the duration-weighted median pitch — the same statistic pitchRange and
 * pitchBand already use, so the unmarked band is where the singer actually sings rather
 * than an arbitrary C-to-B.
 */
function referenceOctave(notes, tonicPc) {
  if (!notes || !notes.length) return 0;
  const weighted = [];
  for (const n of notes) {
    const reps = Math.max(1, Math.round((n.end - n.start) * WEIGHT_PER_SECOND));
    for (let i = 0; i < reps; i++) weighted.push(n.midi);
  }
  if (!weighted.length) return 0;
  weighted.sort((a, b) => a - b);
  return degreeOf(weighted[weighted.length >> 1], tonicPc, 'major').octaveIndex;
}

/**
 * A MIDI note as a printable 簡譜 token: accidental + digit, wrapped with octave marks
 * relative to `refOctaveIndex` — an apostrophe suffix per octave above it, a comma prefix
 * per octave below. Used by the plain-text note-list export in notes.js; the on-screen
 * ribbon draws the same information as dots instead (see drawOctaveDots in app.js) because
 * a rendered dot can't appear in a downloaded text file.
 */
function degreeToken(midi, tonicPc, mode, refOctaveIndex) {
  const d = degreeOf(midi, tonicPc, mode);
  const dots = d.octaveIndex - refOctaveIndex;
  const up = dots > 0 ? "'".repeat(dots) : '';
  const down = dots < 0 ? ','.repeat(-dots) : '';
  return down + d.accidental + d.digit + up;
}

export { degreeOf, referenceOctave, degreeToken };

// Bridge for notes.js (out of scope for this refactor, already ESM, still read this via
// window) — not part of this module's own design.
window.SansJianpu = { degreeOf, referenceOctave, degreeToken };
```

- [ ] **Step 2: Verify**

`npm run dev` → `http://localhost:8777/tests/test.html` → `window.__testResults` →
expected `{ total: 265, failed: 0, ... }`. Then `npm run build` → expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/jianpu.js
git commit -m "$(cat <<'EOF'
refactor: lib/jianpu.js real ES module exports

Real export statements plus a permanent, documented window.SansJianpu bridge — notes.js is
out of scope for this refactor and can only reach this file through window. No behavior
change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bvqufews8V2NGpiddxj95w
EOF
)"
```

---

## Task 9: `app.js` → real imports, every call site, guard cleanup, comment fixes

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: every export from Tasks 1–8 (`lib/stems.js`, `lib/unzip.js`, `lib/i18n.js`,
  `lib/platform.js`, `lib/analytics.js`, `lib/ribbon.js`, `lib/jianpu.js`,
  `lib/transport-math.js`) — all 8 must already have real exports, which Tasks 1–8
  guarantee.
- No new exports; `window.sansBass` (bottom of the file) is untouched.

This task is one file, done as a sequence of edits (not a full rewrite — the file is 3276
lines and only ~60 lines actually change). Do the special/unique edits first (Steps 1–4),
then the mechanical blanket replacements (Steps 5–12), so an early blanket replace can't
interfere with a later special-case match.

- [ ] **Step 1: Add the 8 import statements, remove the old destructure**

```
old:
"/* sans_bass — multitrack stem player
 * All decoding happens locally via Web Audio. Stems stay perfectly in sync
 * because every track is started from one AudioContext clock at the same time.
 */

const { STEMS, EXTRA_COLORS, AUDIO_RE, detectStem, assignStems, hasMixPlusStems } = window.SansStems;

const BUCKETS = 1400;   // waveform resolution"

new:
"/* sans_bass — multitrack stem player
 * All decoding happens locally via Web Audio. Stems stay perfectly in sync
 * because every track is started from one AudioContext clock at the same time.
 */

import { STEMS, EXTRA_COLORS, AUDIO_RE, detectStem, assignStems, hasMixPlusStems } from './lib/stems.js';
import { extract } from './lib/unzip.js';
import * as SansI18n from './lib/i18n.js';
import * as SansPlatform from './lib/platform.js';
import * as SansAnalytics from './lib/analytics.js';
import * as SansRibbon from './lib/ribbon.js';
import * as SansJianpu from './lib/jianpu.js';
import * as SansTransportMath from './lib/transport-math.js';

const BUCKETS = 1400;   // waveform resolution"
```

- [ ] **Step 2: Fix the stale analytics comment**

```
old:
"/* Analytics must never be able to break the player. Same reasoning as on() above: a
 * missing window.SansAnalytics (script blocked by an extension, 404 after a bad deploy)
 * must degrade to a no-op, not take out every listener below it. */"

new:
"/* Analytics must never be able to break the player. try/catch guards against track()
 * itself throwing — a missing or failed lib/analytics.js module now fails app.js's whole
 * import graph instead of degrading here; see the ESM design spec's accepted trade-off. */"
```

- [ ] **Step 3: Fix the stale "classic script" comment**

```
old:
"/* The drop zone promises that a song "can be split into six stems right here in the
 * browser". On a phone that is false — see lib/platform.js. Swap the KEY rather than the
 * text: SansI18n.apply() re-reads data-i18n-html from the element on every run, so the
 * language toggle keeps working for free and t() needs no branch.
 *
 * app.js is a classic script at the end of <body>, so this runs during parse — before
 * DOMContentLoaded, and therefore before apply() first walks the document. */"

new:
"/* The drop zone promises that a song "can be split into six stems right here in the
 * browser". On a phone that is false — see lib/platform.js. Swap the KEY rather than the
 * text: SansI18n.apply() re-reads data-i18n-html from the element on every run, so the
 * language toggle keeps working for free and t() needs no branch.
 *
 * app.js's script tag sits at the end of <body>; as a module script it runs after parsing
 * but still before DOMContentLoaded, so this executes before apply() first walks the
 * document. */"
```

- [ ] **Step 4: Drop the two dead-guard clauses**

```
old: "  if (!jianpu || !jianpu.on || !window.SansJianpu) return n.name;"
new: "  if (!jianpu || !jianpu.on) return n.name;"
```

```
old:
"  /* Guarded on the library, not just on duration. lib/ribbon.js is optional decoration;
   * seeking is core transport. A stale-cache mismatch that drops one script must not take
   * seeking away from users who never open the notes lane. */
  if (duration && window.SansRibbon) {
    const win = window.SansRibbon.zoomWindow(zoomCenter, zoomSeconds, duration);"

new:
"  /* Once a static import, this guard is unreachable-false: if lib/ribbon.js had failed to
   * load, app.js's module would never have evaluated far enough to run this check. */
  if (duration) {
    const win = SansRibbon.zoomWindow(zoomCenter, zoomSeconds, duration);"
```

- [ ] **Step 5: Blanket-replace the remaining `window.SansI18n.` call sites**

Use `replace_all: true`.

```
old: "window.SansI18n."
new: "SansI18n."
```

Expected: 5 occurrences replaced (lines that read `t()`, `has()`, `getLocale()` ×2,
`setLocale()`).

- [ ] **Step 6: Blanket-replace `window.SansAnalytics?.`**

```
old: "window.SansAnalytics?."
new: "SansAnalytics?."
```

Expected: 3 occurrences (`gcTrack`, `gcOnce`, `gcBump`).

- [ ] **Step 7: Blanket-replace `window.SansPlatform?.`**

```
old: "window.SansPlatform?."
new: "SansPlatform?."
```

Expected: 1 occurrence.

- [ ] **Step 8: Blanket-replace `window.SansTransportMath.`**

```
old: "window.SansTransportMath."
new: "SansTransportMath."
```

Expected: 9 lines (some with 2 occurrences each — `replace_all` handles all of them in one
call).

- [ ] **Step 9: Blanket-replace `window.SansUnzip.extract`**

```
old: "window.SansUnzip.extract"
new: "extract"
```

Expected: 1 occurrence.

- [ ] **Step 10: Blanket-replace `window.SansRibbon.`**

```
old: "window.SansRibbon."
new: "SansRibbon."
```

Expected: 14 occurrences (the 15th — the bare truthiness check — was already handled in
Step 4).

- [ ] **Step 11: Blanket-replace `window.SansJianpu.` (dotted form)**

```
old: "window.SansJianpu."
new: "SansJianpu."
```

Expected: 5 occurrences.

- [ ] **Step 12: Blanket-replace remaining bare `window.SansJianpu`**

```
old: "window.SansJianpu"
new: "SansJianpu"
```

Expected: 4 occurrences (the `jp && window.SansJianpu` / `if (jp && window.SansJianpu) {`
truthiness checks at what were originally lines 1346, 1404, 1619, 1641 — these are kept
exactly as-is structurally, only the `window.` prefix drops, because unlike the two guards
removed in Step 4 the spec does not call these dead: `jp` is the real, still-meaningful
guard here, not `SansJianpu`'s truthiness).

- [ ] **Step 13: Confirm nothing was missed**

```bash
grep -n "window\.Sans[A-Z]" app.js
```

Expected: exactly one line — `window.SansPitch.parseNoteName(pitchStr)` — untouched,
out of scope for this refactor.

- [ ] **Step 14: Verify**

`npm run dev` → `http://localhost:8777/tests/test.html` → `window.__testResults` →
expected `{ total: 265, failed: 0, ... }`. Then `npm run build` → expected: succeeds (this
is the first hard proof every one of the 8 imports resolves — a typo'd path or a missing
export throws at build time). Then load `http://localhost:8777/` directly: confirm the
page boots with no console errors, translated text is visible, and playback/mute/A-B loop
work (a quick smoke check now; the full matrix is Task 14).

- [ ] **Step 15: Commit**

```bash
git add app.js
git commit -m "$(cat <<'EOF'
refactor: app.js imports the 8 lib/*.js modules directly

Every window.SansX read becomes a real static import (named for lib/stems.js and
lib/unzip.js, namespace for the rest — SansI18n.t() would otherwise collide with app.js's
own `t` loop variable for tracks). Drops the two window.SansRibbon/window.SansJianpu
truthiness guards that a static import makes unreachable-false, and fixes two comments
that described app.js as a classic script or window.SansAnalytics as independently
missing-tolerant — neither is true once the import is static. No behavior change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bvqufews8V2NGpiddxj95w
EOF
)"
```

---

## Task 10: The 8 named test files → import directly; remove `test.html`'s redundant script tags

**Files:**
- Modify: `tests/stems.test.js`, `tests/unzip.test.js`, `tests/i18n.test.js`,
  `tests/platform.test.js`, `tests/analytics.test.js`, `tests/ribbon.test.js`,
  `tests/jianpu.test.js`, `tests/transport-math.test.js`, `tests/test.html`

**Interfaces:**
- Consumes: every export from Tasks 1–8.

- [ ] **Step 1: `tests/stems.test.js`**

```
old: "import { test, assert, assertEq } from './assert.js';
const { detectStem, assignStems, hasMixPlusStems } = window.SansStems;"

new: "import { test, assert, assertEq } from './assert.js';
import { detectStem, assignStems, hasMixPlusStems } from '../lib/stems.js';"
```

- [ ] **Step 2: `tests/unzip.test.js`**

```
old: "import { test, assert, assertEq } from './assert.js';
import { buildZip } from '../lib/zip.js';

const enc = new TextEncoder();
const { extract } = window.SansUnzip;"

new: "import { test, assert, assertEq } from './assert.js';
import { buildZip } from '../lib/zip.js';
import { extract } from '../lib/unzip.js';

const enc = new TextEncoder();"
```

- [ ] **Step 3: `tests/platform.test.js`**

```
old: "import { test, assertEq } from './assert.js';

const P = window.SansPlatform;"

new: "import { test, assert, assertEq } from './assert.js';
import * as SansPlatform from '../lib/platform.js';

const P = SansPlatform;"
```

Then append one new test at the end of the file (after the existing five `test(...)`
blocks):

```js
test('platform: window.SansPlatform bridge still matches the real exports (regression: separate.js reads this)', () => {
  assertEq(Object.keys(window.SansPlatform).sort().join(','), Object.keys(SansPlatform).sort().join(','),
    'bridge exposes exactly the real exports, nothing more or less');
  assert(window.SansPlatform.isHandheld === SansPlatform.isHandheld, 'same function, not a copy');
});
```

(Note: `assert` was not previously imported by this file — the edit above adds it to the
first line's import list, since the new test uses it.)

- [ ] **Step 4: `tests/analytics.test.js`**

```
old: "import { test, assert, assertEq } from './assert.js';

const A = () => window.SansAnalytics;"

new: "import { test, assert, assertEq } from './assert.js';
import * as SansAnalytics from '../lib/analytics.js';

const A = () => SansAnalytics;"
```

Then append one new test at the end of the file:

```js
test('analytics: window.SansAnalytics bridge still matches the real exports (regression: separate.js reads this)', () => {
  assertEq(Object.keys(window.SansAnalytics).sort().join(','), Object.keys(SansAnalytics).sort().join(','),
    'bridge exposes exactly the real exports, nothing more or less');
  for (const k of Object.keys(SansAnalytics)) {
    assert(window.SansAnalytics[k] === SansAnalytics[k], `window.SansAnalytics.${k} is the same binding`);
  }
});
```

- [ ] **Step 5: `tests/ribbon.test.js`**

```
old: "import { test, assert, assertEq, assertClose } from './assert.js';

const R = () => window.SansRibbon;"

new: "import { test, assert, assertEq, assertClose } from './assert.js';
import * as SansRibbon from '../lib/ribbon.js';

const R = () => SansRibbon;"
```

- [ ] **Step 6: `tests/jianpu.test.js`**

```
old: "import { test, assert, assertEq } from './assert.js';

const J = () => window.SansJianpu;"

new: "import { test, assert, assertEq } from './assert.js';
import * as SansJianpu from '../lib/jianpu.js';

const J = () => SansJianpu;"
```

Then append one new test at the end of the file:

```js
test('jianpu: window.SansJianpu bridge still matches the real exports (regression: notes.js reads this)', () => {
  assertEq(Object.keys(window.SansJianpu).sort().join(','), Object.keys(SansJianpu).sort().join(','),
    'bridge exposes exactly the real exports, nothing more or less');
  for (const k of Object.keys(SansJianpu)) {
    assert(window.SansJianpu[k] === SansJianpu[k], `window.SansJianpu.${k} is the same binding`);
  }
});
```

- [ ] **Step 7: `tests/transport-math.test.js`**

```
old: "import { test, assertEq, assertClose } from './assert.js';
const M = window.SansTransportMath;"

new: "import { test, assertEq, assertClose } from './assert.js';
import * as M from '../lib/transport-math.js';"
```

- [ ] **Step 8: `tests/i18n.test.js`**

```
old: "import { test, assert, assertEq } from './assert.js';
const I18N = window.SansI18n;"

new: "import { test, assert, assertEq } from './assert.js';
import * as SansI18n from '../lib/i18n.js';
import * as SansStems from '../lib/stems.js';

const I18N = SansI18n;"
```

Then, inside the existing `test('i18n: translating labels never renames a stem', ...)`
block, replace every `window.SansStems` read with the imported namespace:

```
old: "  assertEq(window.SansStems.STEMS.bass.label, 'Bass',
    'lib/stems.js keeps the English label as the stable identity');"
new: "  assertEq(SansStems.STEMS.bass.label, 'Bass',
    'lib/stems.js keeps the English label as the stable identity');"
```

```
old: "  const out = window.SansStems.assignStems(ids.map((s) => ({ name: `${s}.wav` })));"
new: "  const out = SansStems.assignStems(ids.map((s) => ({ name: `${s}.wav` })));"
```

```
old: "    assertEq(window.SansStems.detectStem(name), null,
      `a translated filename (${name}) is not recognised as a stem`);"
new: "    assertEq(SansStems.detectStem(name), null,
      `a translated filename (${name}) is not recognised as a stem`);"
```

Then append one new test at the end of the file:

```js
test('i18n: window.SansI18n bridge still matches the real exports (regression: separate.js/notes.js read this)', () => {
  assertEq(Object.keys(window.SansI18n).sort().join(','), Object.keys(SansI18n).sort().join(','),
    'bridge exposes exactly the real exports, nothing more or less');
  for (const k of Object.keys(SansI18n)) {
    assert(window.SansI18n[k] === SansI18n[k], `window.SansI18n.${k} is the same binding`);
  }
});
```

- [ ] **Step 9: Remove `tests/test.html`'s 8 now-redundant script tags**

```
old: "  <pre id="out">running…</pre>
  <script type="module" src="../lib/stems.js"></script>
  <script type="module" src="../lib/unzip.js"></script>
  <script type="module" src="../lib/i18n.js"></script>
  <script type="module" src="../lib/analytics.js"></script>
  <script type="module" src="../lib/platform.js"></script>
  <script type="module" src="../lib/ribbon.js"></script>
  <script type="module" src="../lib/jianpu.js"></script>
  <script type="module" src="../lib/transport-math.js"></script>
  <script type="module">"

new: "  <pre id="out">running…</pre>
  <script type="module">"
```

- [ ] **Step 10: Verify**

`npm run dev` → `http://localhost:8777/tests/test.html` → `window.__testResults` →
expected `{ total: 269, failed: 0, ... }` (265 existing + 4 new bridge-regression tests, for
`i18n`/`platform`/`analytics`/`jianpu`). Then `npm run build` → expected: succeeds.

- [ ] **Step 11: Commit**

```bash
git add tests/stems.test.js tests/unzip.test.js tests/i18n.test.js tests/platform.test.js \
        tests/analytics.test.js tests/ribbon.test.js tests/jianpu.test.js \
        tests/transport-math.test.js tests/test.html
git commit -m "$(cat <<'EOF'
refactor: tests import lib/*.js directly instead of reading window.SansX

The idiomatic choice now that there is something real to import — also stops every test
depending on <script> tag order in tests/test.html, whose 8 now-redundant tags are removed
(module singleton semantics mean each test file's own import is sufficient). Adds a
regression assertion to i18n/platform/analytics/jianpu.test.js: window.SansX still exists
and matches the real exports exactly, cheap protection since separate.js/notes.js have no
test coverage of their own for that bridge.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bvqufews8V2NGpiddxj95w
EOF
)"
```

---

## Task 11: `tests/notes.html` → import `lib/ribbon.js` directly

**Files:**
- Modify: `tests/notes.html`

**Interfaces:**
- Consumes: `SansRibbon.pitchRange` from `lib/ribbon.js` (Task 3).

- [ ] **Step 1: Replace the separate script tag with an import**

```
old: "<script type="module" src="../lib/ribbon.js"></script>
<script type="module">
import { detectNotes, notesToChroma, detectKey, interpret } from '../lib/pitch.js';
import { scheduleNotes, LOOKAHEAD } from '../lib/sonify.js';"

new: "<script type="module">
import { detectNotes, notesToChroma, detectKey, interpret } from '../lib/pitch.js';
import { scheduleNotes, LOOKAHEAD } from '../lib/sonify.js';
import * as SansRibbon from '../lib/ribbon.js';"
```

- [ ] **Step 2: Drop the now-dead `window.SansRibbon` fallback**

`lib/ribbon.js` loses its `window.SansRibbon` global entirely in Task 12, so the ternary's
fallback branch is about to become the only reachable branch if left as `window.SansRibbon`
— fix it to use the import (which is always present, so the ternary itself is now dead too;
drop it, matching how app.js's equivalent dead guard was dropped in Task 9):

```
old: "  const [rlo, rhi] = window.SansRibbon
    ? window.SansRibbon.pitchRange(list, { clip: true })
    : [mids[0], mids[mids.length - 1]];"

new: "  const [rlo, rhi] = SansRibbon.pitchRange(list, { clip: true });"
```

- [ ] **Step 3: Verify**

`npm run dev` → `http://localhost:8777/tests/notes.html` (append `?track=...&stem=...` for
a song present under your local `stems/` if the default doesn't exist on this machine).
Confirm zero console errors and the page's `<pre id="out">` fills in with a report instead
of staying on "running…". (This bench page reads local audio under `/stems/`, which is
machine-specific and gitignored — if none is available, it's enough to confirm no console
error is thrown by the module graph itself; the full behavioral check isn't blocked on
having song data.)

- [ ] **Step 4: Commit**

```bash
git add tests/notes.html
git commit -m "$(cat <<'EOF'
refactor: tests/notes.html imports lib/ribbon.js directly

Matches the same conversion tests/test.html's suite got in the previous commit. Drops the
window.SansRibbon ternary fallback, which becomes dead once the import always resolves.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bvqufews8V2NGpiddxj95w
EOF
)"
```

---

## Task 12: Drop the temporary `window.SansX` bridge from the 4 no-bridge files

**Files:**
- Modify: `lib/stems.js`, `lib/unzip.js`, `lib/ribbon.js`, `lib/transport-math.js`

**Interfaces:**
- None — this only removes dead code. Safe because Tasks 9–11 already moved every
  consumer (`app.js`, the 8 named test files, `tests/notes.html`) onto real imports; no
  file anywhere still reads `window.SansStems`, `window.SansUnzip`, `window.SansRibbon`, or
  `window.SansTransportMath`.

- [ ] **Step 1: Confirm nothing still reads these 4 globals**

```bash
grep -rn "window\.SansStems\|window\.SansUnzip\|window\.SansRibbon\|window\.SansTransportMath" \
  --include="*.js" --include="*.html" . | grep -v node_modules \
  | grep -vE "^\./lib/(stems|unzip|ribbon|transport-math)\.js"
```

Expected: no output. (If anything appears, stop — a consumer was missed in an earlier
task; fix that file's import before continuing here.)

- [ ] **Step 2: Remove the bridge line from each file**

```
old: "export { STEMS, EXTRA_COLORS, AUDIO_RE, detectStem, assignStems, hasMixPlusStems };

window.SansStems = { STEMS, EXTRA_COLORS, AUDIO_RE, detectStem, assignStems, hasMixPlusStems };"
new: "export { STEMS, EXTRA_COLORS, AUDIO_RE, detectStem, assignStems, hasMixPlusStems };"
```
(in `lib/stems.js`)

```
old: "export { extract };

window.SansUnzip = { extract };"
new: "export { extract };"
```
(in `lib/unzip.js`)

```
old: "export { pitchRange, contourSegments, contourColumns, zoomPeaks, zoomWindow, beatTimes, subdivisionTimes };

window.SansRibbon = {
  pitchRange, contourSegments, contourColumns, zoomPeaks, zoomWindow, beatTimes, subdivisionTimes,
};"
new: "export { pitchRange, contourSegments, contourColumns, zoomPeaks, zoomWindow, beatTimes, subdivisionTimes };"
```
(in `lib/ribbon.js`)

```
old: "export { RATE_MIN, RATE_MAX, RATE_STEP, RATE_FINE_STEP, RATE_DEFAULT,
         clampRatePercent, nudgeRatePercent, currentTimeAtRate };

window.SansTransportMath = { RATE_MIN, RATE_MAX, RATE_STEP, RATE_FINE_STEP, RATE_DEFAULT,
         clampRatePercent, nudgeRatePercent, currentTimeAtRate };"
new: "export { RATE_MIN, RATE_MAX, RATE_STEP, RATE_FINE_STEP, RATE_DEFAULT,
         clampRatePercent, nudgeRatePercent, currentTimeAtRate };"
```
(in `lib/transport-math.js`)

- [ ] **Step 3: Verify**

`npm run dev` → `http://localhost:8777/tests/test.html` → `window.__testResults` →
expected `{ total: 269, failed: 0, ... }`. Then `npm run build` → expected: succeeds. Then
load `http://localhost:8777/` directly: boots with no console errors.

- [ ] **Step 4: Commit**

```bash
git add lib/stems.js lib/unzip.js lib/ribbon.js lib/transport-math.js
git commit -m "$(cat <<'EOF'
refactor: drop the temporary window.SansX bridge from stems/unzip/ribbon/transport-math

Nothing reads these via window anymore — app.js and every test import them directly
(previous commits in this branch). A module's public surface is its exports; a global
nobody reads is speculative surface kept on the chance a future consumer wants it, the
same hypothetical-future-requirement this project's conventions rule out for features.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bvqufews8V2NGpiddxj95w
EOF
)"
```

---

## Task 13: Docs — `CLAUDE.md`, `docs/roadmap.md`, `docs/devlog.md`

**Files:**
- Modify: `CLAUDE.md`, `docs/roadmap.md`, `docs/devlog.md`

- [ ] **Step 1: `CLAUDE.md` — the "npm + Vite" hard-constraint bullet**

```
old: "- **npm + Vite build the site; no UI framework.** `npm run dev` for local dev, `npm run
  build` for `dist/`, both CI workflows build before publishing. The player core is
  `index.html`, `styles.css`, `app.js` plus `lib/stems.js` and `lib/unzip.js`. Vanilla JS
  stays the default for code this project writes — React/Vue/etc. are still out. `file://`
  support was dropped in v1.5.0. `app.js` and every classic-script `lib/*.js` file
  (`stems.js`, `i18n.js`, `platform.js`, `unzip.js`, `ribbon.js`, `jianpu.js`,
  `transport-math.js`, `analytics.js`) load with `type="module"` now — Vite's HTML plugin
  only bundles and content-hashes a `<script>` tag that carries that attribute; a plain
  classic `<script src>` is left completely untouched and never copied into `dist/`, so it
  404s in the built output. None of their source changed to make this work — they're still
  self-contained `(function (global) {...})(window)` IIFEs assigning `window.SansX`, not a
  real ES module graph with `import`/`export` — only the `<script>` tag's loading mechanism
  did."

new: "- **npm + Vite build the site; no UI framework.** `npm run dev` for local dev, `npm run
  build` for `dist/`, both CI workflows build before publishing. The player core is
  `index.html`, `styles.css`, `app.js` plus `lib/stems.js` and `lib/unzip.js`. Vanilla JS
  stays the default for code this project writes — React/Vue/etc. are still out. `file://`
  support was dropped in v1.5.0. `app.js` and every `lib/*.js` file (`stems.js`, `i18n.js`,
  `platform.js`, `unzip.js`, `ribbon.js`, `jianpu.js`, `transport-math.js`, `analytics.js`)
  are real ES modules as of v1.21.0 — actual `import`/`export`, not just the
  `type="module"` loading mechanism the npm + Vite migration (v1.20.0) switched them to. See
  the next bullet for the `window.SansX` bridge four of them still carry."
```

- [ ] **Step 2: `CLAUDE.md` — the module-design-preference bullet**

```
old: "- **A module's public surface is its `export`s — a `window.SansX` global is a bridge, never
  a default.** Every ESM file in this repo (`lib/pitch.js`, `lib/wav.js`, `lib/zip.js`,
  `lib/overlap.js`, `lib/sonify.js`, `lib/tempo.js`, and, once converted, the files above)
  exports what it wants read; it does not also assign a global on the chance something might
  want one later — that is designing for a hypothetical future consumer, the same thing this
  project's conventions already rule out for features. The one exception is a **documented,
  named bridge** for a specific consumer that genuinely cannot `import` yet — e.g.
  `lib/pitch.js`'s `window.SansPitch = { parseNoteName }`, which exists only because
  (pre-conversion) `app.js` was a classic script and could not import an ES module; the
  comment there says exactly which caller it is for. Never add a global "for consistency
  with the other files" or "in case something needs it" — if a real consumer shows up later,
  adding the export back is a one-line, fully reversible change. See
  [`docs/superpowers/specs/2026-09-02-esm-modules-design.md`](superpowers/specs/2026-09-02-esm-modules-design.md)
  for how this principle applies to converting `app.js` and the `lib/*.js` files above: four
  of them (`i18n.js`, `platform.js`, `analytics.js`, `jianpu.js`) keep a narrow bridge
  because `separate.js`/`notes.js` still read them via `window`; the rest don't, because
  nothing outside this project's own module graph reads them."

new: "- **A module's public surface is its `export`s — a `window.SansX` global is a bridge, never
  a default.** Every ESM file in this repo (`lib/pitch.js`, `lib/wav.js`, `lib/zip.js`,
  `lib/overlap.js`, `lib/sonify.js`, `lib/tempo.js`, `app.js`, and every `lib/*.js` file)
  exports what it wants read; it does not also assign a global on the chance something might
  want one later — that is designing for a hypothetical future consumer, the same thing this
  project's conventions already rule out for features. The one exception is a **documented,
  named bridge** for a specific consumer that genuinely cannot `import` yet — e.g.
  `lib/pitch.js`'s `window.SansPitch = { parseNoteName }`, needed because `separate.js` is an
  ES module and cannot share scope with `app.js`; the comment there says exactly which caller
  it is for. `lib/i18n.js`, `lib/platform.js`, `lib/analytics.js` and `lib/jianpu.js` carry
  the same kind of bridge, because `separate.js`/`notes.js` (already ESM, out of scope for
  the v1.21.0 conversion) still read them via `window`; `lib/stems.js`, `lib/unzip.js`,
  `lib/ribbon.js` and `lib/transport-math.js` do not, because nothing outside this project's
  own module graph reads them. See
  [`docs/superpowers/specs/2026-09-02-esm-modules-design.md`](superpowers/specs/2026-09-02-esm-modules-design.md)
  for the full design. Never add a global "for consistency with the other files" or "in case
  something needs it" — if a real consumer shows up later, adding the export back is a
  one-line, fully reversible change."
```

- [ ] **Step 3: `CLAUDE.md` — the "In-browser separation" architecture bullet**

```
old: "- **In-browser separation** (`separate.js`, `separate.worker.js`) is additive and optional.
  The worker owns ONNX Runtime and `htdemucs_6s`; `lib/overlap.js` plans the segments;
  `lib/wav.js` and `lib/zip.js` handle saving. It loads as a plain
  `<script type="module">`; the conditional injection that guarded `file://` went with
  `file://` support in v1.5.0. `app.js` stays a classic script, and `lib/stems.js`,
  `lib/i18n.js` and `lib/platform.js` are classic too so both they and the tests can use
  them. Since v1.8.0 the whole panel is **gated to desktop** — see the handheld gotcha below."

new: "- **In-browser separation** (`separate.js`, `separate.worker.js`) is additive and optional.
  The worker owns ONNX Runtime and `htdemucs_6s`; `lib/overlap.js` plans the segments;
  `lib/wav.js` and `lib/zip.js` handle saving. It loads as a plain
  `<script type="module">`; the conditional injection that guarded `file://` went with
  `file://` support in v1.5.0. `app.js` and `lib/stems.js`/`lib/i18n.js`/`lib/platform.js`
  are real ES modules too (since v1.21.0), imported directly by app.js and the tests alike.
  Since v1.8.0 the whole panel is **gated to desktop** — see the handheld gotcha below."
```

- [ ] **Step 4: `CLAUDE.md` — repo-layout table**

```
old: "index.html  styles.css  app.js     the player (classic scripts)
lib/stems.js                       stem identity, classic script, shared with the tests
lib/unzip.js                       zip reading, classic script — window.SansUnzip.extract
lib/i18n.js                        zh-TW/en dictionary + runtime, classic script
lib/platform.js                    isHandheld() device predicate, classic script
lib/{wav,zip,overlap}.js           ESM — WAV encode, ZIP write, segment planning
lib/pitch.js                       ESM — YIN, candidates, Viterbi decoding, segmentation,
                                   octave folding, key
lib/sonify.js                      ESM — plays detected notes back as tones
lib/ribbon.js                      ribbon geometry, classic script — window.SansRibbon
lib/jianpu.js                      簡譜 degrees, classic script — window.SansJianpu"

new: "index.html  styles.css  app.js     the player (app.js: ESM, real import/export)
lib/stems.js                       stem identity — ESM, no window bridge
lib/unzip.js                       zip reading — ESM, no window bridge
lib/i18n.js                        zh-TW/en dictionary + runtime — ESM, window.SansI18n
                                   bridge for separate.js/notes.js
lib/platform.js                    isHandheld() device predicate — ESM, window.SansPlatform
                                   bridge for separate.js
lib/{wav,zip,overlap}.js           ESM — WAV encode, ZIP write, segment planning
lib/pitch.js                       ESM — YIN, candidates, Viterbi decoding, segmentation,
                                   octave folding, key
lib/sonify.js                      ESM — plays detected notes back as tones
lib/ribbon.js                      ribbon geometry — ESM, no window bridge
lib/jianpu.js                      簡譜 degrees — ESM, window.SansJianpu bridge for notes.js"
```

- [ ] **Step 5: `docs/roadmap.md`**

```
old: "**Still wanted:** the ONNX runtime and separation model stay CDN/runtime-fetched by design
(out of scope for this migration — see its spec's non-goals); converting `app.js` and the
classic-script `lib/*.js` files to a real ES module graph (actual `import`/`export`, not
just the `type="module"` loading mechanism) is still separate, deferred work."

new: "**Still wanted:** the ONNX runtime and separation model stay CDN/runtime-fetched by design
(out of scope for this migration — see its spec's non-goals).

**Also built in v1.21.0** — [spec](superpowers/specs/2026-09-02-esm-modules-design.md),
[plan](superpowers/plans/2026-09-02-esm-modules.md): `app.js` and the `lib/*.js` files
converted to a real ES module graph (actual `import`/`export`), closing the item above."
```

- [ ] **Step 6: `docs/devlog.md` — new entry**

Get the actual date/time from `git log` (the final commit of this branch's work), per this
project's devlog convention. Add a new row at the top of the TL;DR table:

```
| [v1.21.0](#v1210--esm-modules-YYYY-MM-DD-HHMM) | `app.js` and the 8 classic-script `lib/*.js` files (`stems.js`, `i18n.js`, `platform.js`, `unzip.js`, `ribbon.js`, `jianpu.js`, `transport-math.js`, `analytics.js`) became real ES modules with `import`/`export`, closing the item the npm + Vite migration (v1.20.0) deliberately deferred. Four of them (`i18n.js`, `platform.js`, `analytics.js`, `jianpu.js`) keep a documented `window.SansX` bridge for `separate.js`/`notes.js`, which are already ESM and out of scope; the other four lose the global entirely. `index.html` needed zero changes — module singletons mean app.js importing the same files its own `<script>` tags load causes no duplicate evaluation, and execution order is spec-guaranteed rather than a document-order coincidence. |
```

(Replace `YYYY-MM-DD-HHMM` in the anchor with the actual date/time from `git log`, matching
the section heading you write next — GitHub's auto-generated anchor lowercases, strips
punctuation except hyphens, and turns spaces into hyphens.)

Add the full entry (newest-first, right after the TL;DR table's closing and before the
first existing `## v1.20.0` section):

```markdown
## v1.21.0 — ESM modules (YYYY-MM-DD HH:MM)

**Review:** not yet

**Design docs:**
- ESM modules: [Spec](superpowers/specs/2026-09-02-esm-modules-design.md) [Plan](superpowers/plans/2026-09-02-esm-modules.md)

**What was built:**
- `app.js` and the 8 classic-script `lib/*.js` files converted to real ES modules — actual
  `import`/`export`, not just the `type="module"` script-tag mechanism the npm + Vite
  migration (v1.20.0) already switched them to.
- Four files (`lib/i18n.js`, `lib/platform.js`, `lib/analytics.js`, `lib/jianpu.js`) keep a
  documented `window.SansX` bridge, because `separate.js`/`notes.js` — already ESM, out of
  scope for this conversion — can only reach them that way.
- The other four (`lib/stems.js`, `lib/unzip.js`, `lib/ribbon.js`, `lib/transport-math.js`)
  lose the global entirely: nothing outside this project's own module graph read them.
- All 8 named test files (`tests/*.test.js`) and `tests/notes.html` import directly instead
  of reading `window.SansX`, and `tests/test.html`'s 8 now-redundant `<script>` tags for
  the lib files are gone.
- `index.html` needed zero changes.

**Key technical learnings:**
- `[insight]` Execution order across `index.html`'s script tags and app.js's new imports is
  spec-guaranteed, not a document-order coincidence this project happened to rely on: a
  module script's dependency subgraph evaluates before its own top-level body runs, and
  independent top-level module scripts still execute in relative document order. Verified
  directly (the page boots with translated text visible before first paint), not just
  reasoned about.
- `[insight]` A static `import` can't be conditional the way `window.SansAnalytics?.track()`
  and `window.SansPlatform?.isHandheld()` used to be — if `lib/analytics.js` or
  `lib/platform.js` failed to load, the whole `app.js` module now fails to evaluate instead
  of degrading to a no-op for just that one feature. Accepted trade-off: production already
  bundles everything into one atomic chunk (since the npm + Vite migration), so this
  scenario was already impossible there; only dev-mode-only robustness for these two files
  was traded away.
- `[note]` A module's public surface is its exports; a `window.SansX` global is a
  deliberate, narrow, commented bridge for a specific out-of-scope consumer that genuinely
  cannot `import` yet — never a default kept "in case something needs it." Four files keep
  one for exactly that reason; the other four don't, because nothing reads them that way.

**Process learnings:**
- `[insight]` Converting a lib file's export shape and switching its consumers to import it
  can't safely happen in the same commit when another *lib* file also reads it via
  `window` (here: `lib/unzip.js` reading `lib/stems.js`'s `AUDIO_RE`). The safe order was:
  add real exports while keeping the `window.SansX` assignment temporarily on every file
  (even the four that ultimately drop it), convert every consumer to import directly, then
  remove the temporary bridge only once nothing reads it anymore — verified with a `grep`
  before deleting each one.
```

- [ ] **Step 7: Verify**

Read back `CLAUDE.md`, `docs/roadmap.md`, and `docs/devlog.md` to confirm every edit landed
and no markdown got mangled (broken table row, unclosed code fence). No automated test
covers prose — this is a manual read.

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md docs/roadmap.md docs/devlog.md
git commit -m "$(cat <<'EOF'
docs: record the ESM modules conversion (v1.21.0)

Updates CLAUDE.md's hard-constraint and architecture prose plus its repo-layout table,
marks docs/roadmap.md's "Migrate to npm + a build step" deferred item as built, and adds
the devlog entry with tagged learnings.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bvqufews8V2NGpiddxj95w
EOF
)"
```

---

## Task 14: Manual verification pass (once, at the end)

**Files:** none — this is a verification-only task, no commit unless it finds a regression
to fix.

Per the spec's own Verification section (§7) and this project's convention of consolidating
manual/browser checks into one pass at the end rather than repeating them per task:

- [ ] **Step 1: `npm run dev`**

Load `http://localhost:8777/`. Confirm:
- The page boots with translated text visible **before first paint** (this proves the
  execution-order guarantee in the spec's §4 — `lib/i18n.js`'s script tag, then its head
  `init()` call, then `app.js`'s imports, all in the order `index.html` already has them).
- Load a whole-song audio file; exactly one lane labelled "Full mix".
- Click a lane's name block; it mutes/dims, nothing else does.
- Set an A–B loop (`a` then `b`); sample the playhead across two laps to confirm it wraps.
- Move the speed slider off 100%; the transport clock keeps advancing.
- Click "Separate into 6 stems" for real; wait for it to finish; exactly six lanes replace
  the one.
- Click "Find notes" for real; both note counts populate.
- Switch language mid-playback; the transport clock keeps advancing across the switch.
- Console stays clean throughout (zero errors).

- [ ] **Step 2: Run the full automated suite in dev mode**

`http://localhost:8777/tests/test.html` → `window.__testResults` → expected
`{ total: 269, failed: 0, ... }`.

- [ ] **Step 3: `npm run build` + `npm run preview`**

```bash
npm run build
npm run preview
```

Repeat every check from Step 1 against `http://localhost:8777/` (now served from `dist/`)
for production-parity — this is the one place the v1.20.0 migration's own two bugs (a
script tag Vite's build silently left unprocessed, and an `AudioWorkletNode` import Vite
silently left unbundled) only showed up in a real build, not in dev.

- [ ] **Step 4: Run the full automated suite against the production build**

`http://localhost:8777/tests/test.html` (now served from `dist/`) → `window.__testResults`
→ expected `{ total: 269, failed: 0, ... }` — **identical** to Step 2's dev-mode result.

- [ ] **Step 5: Report**

If every check in Steps 1–4 passes identically between dev and build/preview, this plan is
complete — no further commit needed. If anything differs, that's a regression: use
superpowers:systematic-debugging to find which task introduced it before fixing it (don't
guess-and-patch).

---

## Post-merge verification (not part of the task-by-task checklist — run when triggered)

These two checks depend on state this plan cannot produce by itself — a PR being open, and
`main` having actually deployed — so they aren't "Task 15/16" in the same sequential sense
as Tasks 1–14. Whoever finishes this branch (`superpowers:finishing-a-development-branch`,
raising the PR in the usual way per this project's convention of landing every branch
through one) should come back and run both, at the two moments described. Both reuse
[`docs/behaviour.md`](../../behaviour.md)'s **Deployment smoke test** section verbatim (9
numbered steps, G1–G4/L1/L7/M1/S1/S4/S5/R1/S7/N1–N4/T1–T2) — do not re-derive or duplicate
that checklist here; read it fresh each time in case it has changed since this plan was
written.

### A. Once the PR is open, against its preview

1. Confirm the PR exists and find its number: `gh pr view --json number,url -q
   '"\(.number) \(.url)"'`.
2. Wait for `pr-preview.yml` to finish — either poll `gh run list --workflow=pr-preview.yml
   --limit 1 --json status,conclusion` until `status` is `completed`, or check the PR for
   its sticky preview-link comment (`pr-preview.yml` posts/updates one in place). Confirm
   `conclusion` is `success`, not just that it ran (a workflow sharing a concurrency group
   can be silently cancelled — see `docs/deployment.md`'s gotchas).
3. Run every step of docs/behaviour.md's Deployment smoke test against
   `https://sansword.github.io/sans_bass/pr-<N>/` (substitute the real PR number).
4. If it finds a regression: fix it on the branch, push (this re-triggers
   `pr-preview.yml` and updates the same preview URL in place), and rerun from step 2.
5. If it's clean, this is what should be reported back as "verified on the PR preview"
   before merging — not just "tests pass locally."

### B. Once the PR is merged to `main`, against production

1. Confirm `deploy-main.yml`'s latest run actually **succeeded** (not just ran):
   `gh run list --workflow=deploy-main.yml --limit 1 --json status,conclusion`. If it
   shows `cancelled` rather than `success`, the site did not update — see
   `docs/deployment.md`'s gotcha on two workflows sharing a concurrency group.
2. Run every step of docs/behaviour.md's Deployment smoke test against
   `https://sansword.github.io/sans_bass/` (production root, not a `/pr-<N>/` path).
3. If it finds a regression, this is now live on production — treat it as urgent: open a
   fix branch immediately rather than batching it with unrelated work.
