# In-Browser Stem Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate a song into six stems entirely in the browser, load them straight into the player's lanes, and offer the result as one ZIP of WAVs.

**Architecture:** A Web Worker owns ONNX Runtime and the `htdemucs_6s` model and runs a windowed overlap-add loop; the main thread owns UI, WAV/ZIP writing, and handing buffers to the existing player. Pure logic (WAV, ZIP, overlap windows, stem assignment) lives in small standalone modules that are unit-tested in a browser harness. `app.js` stays a **classic script** so the player keeps working from `file://`; the separation code is ES modules injected only when served over HTTP.

**Tech Stack:** Vanilla ES2022, `onnxruntime-web@1.27.0` (WebGPU, jsDelivr ESM), `kramp/htdemucs-6s-webgpu-onnx` (285 MB, MIT), Web Workers, Cache Storage, Web Audio. No build step, no bundler, no npm.

**Spec:** [`docs/superpowers/specs/2026-08-20-in-browser-separation-design.md`](../specs/2026-08-20-in-browser-separation-design.md)

---

## Before you start

**Branch off `main`** (which is at `v1.1.0` plus the spec):

```bash
git checkout main && git checkout -b feat/in-browser-separation
```

**Everything is verified in a real browser.** There is no npm, no jest, no build step, and none may be added. The test harness is a page you serve and read results from:

```bash
./scripts/serve.sh 8777     # leave running in a second terminal
```

Then open `http://localhost:8777/tests/test.html`. Results are rendered to the page, logged to the console as `[tests] {...}`, and left on `window.__testResults` as `{ total, failed, results }` for automation to read.

**Definition of "tests pass":** `window.__testResults.failed === 0`. Never claim a task is done without reading that value.

### File structure this plan creates

```
lib/stems.js          classic script — stem identity assignment (shared by app.js and tests)
lib/wav.js            ESM — Float32 -> 16-bit PCM WAV bytes
lib/zip.js            ESM — CRC-32 + store-method ZIP writer
lib/overlap.js        ESM — segment planning + overlap-add windows
separate.worker.js    ESM worker — ORT, model lifecycle, inference loop
separate.js           ESM — separation panel UI, worker lifecycle, save flow
tests/assert.js       ESM — 40-line assertion runner
tests/test.html       unit harness (wav, zip, overlap, stems)
tests/parity.html     integration harness — browser output vs native stems
app.js                MODIFIED — 44.1 kHz context, buildTracks/loadSeparated, uses SansStems
index.html            MODIFIED — panel markup, conditional module injection
styles.css            MODIFIED — panel styling
```

**Why `lib/stems.js` is a classic script and the rest are ESM:** `app.js` must remain a classic script, because Chrome refuses `<script type="module">` on `file://` and the player must keep working when double-clicked. `lib/stems.js` is shared between `app.js` and the tests, so it exposes `window.SansStems` instead of exporting. Everything reachable only from the separation feature can be ESM, because separation already requires HTTP.

---

## Task 1: Test harness

**Files:**
- Create: `tests/assert.js`
- Create: `tests/test.html`

- [ ] **Step 1: Write the assertion runner**

Create `tests/assert.js`:

```js
/* Minimal browser test runner. No dependencies — this project has no build step. */

const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

export function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEq'}: expected ${expected}, got ${actual}`);
  }
}

export function assertClose(actual, expected, tol, msg) {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(`${msg || 'assertClose'}: expected ${expected} +/- ${tol}, got ${actual}`);
  }
}

export async function runAll(outEl) {
  const results = [];
  for (const t of tests) {
    try {
      await t.fn();
      results.push({ name: t.name, ok: true });
    } catch (e) {
      results.push({ name: t.name, ok: false, error: e.message });
    }
  }
  const failed = results.filter((r) => !r.ok);
  outEl.textContent =
    results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '\n      ' + r.error}`).join('\n') +
    `\n\n${results.length - failed.length}/${results.length} passed`;
  window.__testResults = { total: results.length, failed: failed.length, results };
  console.log('[tests]', JSON.stringify(window.__testResults));
  return window.__testResults;
}
```

- [ ] **Step 2: Write the harness page**

Create `tests/test.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>sans_bass — unit tests</title>
<style>
  body { background:#0d0d10; color:#e9e9ef; font:13px ui-monospace,Menlo,monospace; padding:24px; }
  pre { background:#141419; padding:14px; border-radius:8px; line-height:1.6; white-space:pre-wrap; }
</style>
</head>
<body>
  <h1>unit tests</h1>
  <pre id="out">running…</pre>
  <script src="../lib/stems.js"></script>
  <script type="module">
    import { runAll } from './assert.js';
    await import('./wav.test.js');
    await import('./zip.test.js');
    await import('./overlap.test.js');
    await import('./stems.test.js');
    await runAll(document.getElementById('out'));
  </script>
</body>
</html>
```

- [ ] **Step 3: Create empty test modules so the page loads**

```bash
cd /Users/sansword/Source/github/sans_bass
for f in wav zip overlap stems; do echo "// filled in by a later task" > "tests/$f.test.js"; done
```

- [ ] **Step 4: Verify the harness runs**

Start the server if it is not running (`./scripts/serve.sh 8777`), open `http://localhost:8777/tests/test.html`, and read `window.__testResults`.

Expected: `{ total: 0, failed: 0, results: [] }` and the page shows `0/0 passed`.

- [ ] **Step 5: Commit**

```bash
git add tests/
git commit -m "test: add dependency-free browser test harness

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: WAV encoder

**Files:**
- Create: `lib/wav.js`
- Test: `tests/wav.test.js`

- [ ] **Step 1: Write the failing tests**

Replace `tests/wav.test.js`:

```js
import { test, assert, assertEq } from './assert.js';
import { encodeWav } from '../lib/wav.js';

const str = (bytes, off, len) =>
  String.fromCharCode(...bytes.subarray(off, off + len));

test('wav: RIFF/WAVE/data magic', () => {
  const b = encodeWav(new Float32Array(4), new Float32Array(4));
  assertEq(str(b, 0, 4), 'RIFF', 'RIFF magic');
  assertEq(str(b, 8, 4), 'WAVE', 'WAVE magic');
  assertEq(str(b, 12, 4), 'fmt ', 'fmt chunk');
  assertEq(str(b, 36, 4), 'data', 'data chunk');
});

test('wav: length is 44 + frames*4', () => {
  const b = encodeWav(new Float32Array(100), new Float32Array(100));
  assertEq(b.length, 44 + 400, 'total byte length');
});

test('wav: header fields describe 16-bit stereo 44.1k', () => {
  const b = encodeWav(new Float32Array(10), new Float32Array(10), 44100);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  assertEq(dv.getUint32(4, true), 36 + 40, 'RIFF size');
  assertEq(dv.getUint16(20, true), 1, 'PCM format tag');
  assertEq(dv.getUint16(22, true), 2, 'channel count');
  assertEq(dv.getUint32(24, true), 44100, 'sample rate');
  assertEq(dv.getUint32(28, true), 44100 * 4, 'byte rate');
  assertEq(dv.getUint16(32, true), 4, 'block align');
  assertEq(dv.getUint16(34, true), 16, 'bits per sample');
  assertEq(dv.getUint32(40, true), 40, 'data chunk size');
});

test('wav: channels are interleaved left-then-right', () => {
  const b = encodeWav(new Float32Array([1, 0]), new Float32Array([-1, 0]));
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  assertEq(dv.getInt16(44, true), 32767, 'first left sample');
  assertEq(dv.getInt16(46, true), -32767, 'first right sample');
});

test('wav: out-of-range input clamps instead of wrapping', () => {
  // Demucs output can exceed unity. Unclamped conversion wraps to loud noise.
  const b = encodeWav(new Float32Array([5, -5]), new Float32Array([2, -2]));
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  assert(dv.getInt16(44, true) === 32767, 'positive overshoot clamps high');
  assert(dv.getInt16(46, true) === 32767, 'positive overshoot clamps high (right)');
  assert(dv.getInt16(48, true) === -32767, 'negative overshoot clamps low');
});

test('wav: decodes back through the browser', async () => {
  const n = 4410;
  const left = new Float32Array(n);
  for (let i = 0; i < n; i++) left[i] = Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.5;
  const bytes = encodeWav(left, left);
  const ctx = new AudioContext({ sampleRate: 44100 });
  const buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
  await ctx.close();
  assertEq(buf.numberOfChannels, 2, 'channels survive the round trip');
  assertEq(buf.sampleRate, 44100, 'sample rate survives');
  assertEq(buf.length, n, 'frame count survives');
  const back = buf.getChannelData(0);
  let maxErr = 0;
  for (let i = 0; i < n; i++) maxErr = Math.max(maxErr, Math.abs(back[i] - left[i]));
  assert(maxErr < 1 / 3000, `16-bit round trip error too large: ${maxErr}`);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Reload `http://localhost:8777/tests/test.html`.
Expected: the page fails to load the module and the console shows a 404 for `../lib/wav.js`.

- [ ] **Step 3: Write the implementation**

Create `lib/wav.js`:

```js
/* 16-bit PCM WAV encoding. Pure and synchronous — no Web Audio involvement. */

/** Demucs output can exceed +/-1.0; clamp first or the Int16 conversion wraps into loud noise. */
function toInt16(x) {
  const c = x < -1 ? -1 : x > 1 ? 1 : x;
  return Math.round(c * 32767);
}

/**
 * Encode two Float32 channels as a 16-bit stereo WAV file.
 * @returns {Uint8Array} the complete file, header included
 */
export function encodeWav(left, right, sampleRate = 44100) {
  const frames = Math.min(left.length, right.length);
  const blockAlign = 4;                    // 2 channels * 2 bytes
  const dataBytes = frames * blockAlign;
  const bytes = new Uint8Array(44 + dataBytes);
  const dv = new DataView(bytes.buffer);

  const ascii = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };

  ascii(0, 'RIFF');
  dv.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  dv.setUint32(16, 16, true);              // fmt chunk length
  dv.setUint16(20, 1, true);               // 1 = PCM
  dv.setUint16(22, 2, true);               // channels
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 16, true);              // bits per sample
  ascii(36, 'data');
  dv.setUint32(40, dataBytes, true);

  let off = 44;
  for (let i = 0; i < frames; i++) {
    dv.setInt16(off, toInt16(left[i]), true); off += 2;
    dv.setInt16(off, toInt16(right[i]), true); off += 2;
  }
  return bytes;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Reload the harness. Expected: `window.__testResults.failed === 0`, 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/wav.js tests/wav.test.js
git commit -m "feat: add 16-bit WAV encoder with clamping

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: ZIP writer

**Files:**
- Create: `lib/zip.js`
- Test: `tests/zip.test.js`

- [ ] **Step 1: Write the failing tests**

Replace `tests/zip.test.js`:

```js
import { test, assert, assertEq } from './assert.js';
import { crc32, buildZip } from '../lib/zip.js';

test('zip: crc32 matches the standard check vector', () => {
  const bytes = new TextEncoder().encode('123456789');
  assertEq(crc32(bytes) >>> 0, 0xcbf43926, 'crc32("123456789")');
});

test('zip: crc32 of empty input is 0', () => {
  assertEq(crc32(new Uint8Array(0)) >>> 0, 0, 'crc32 of empty');
});

test('zip: builds a blob with the right signatures', async () => {
  const blob = buildZip([{ name: 'a/one.txt', bytes: new TextEncoder().encode('hello') }]);
  const b = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(b.buffer);
  assertEq(dv.getUint32(0, true), 0x04034b50, 'local file header signature');
  // EOCD is the last 22 bytes when there is no archive comment.
  const eocd = b.length - 22;
  assertEq(dv.getUint32(eocd, true), 0x06054b50, 'end of central directory signature');
  assertEq(dv.getUint16(eocd + 8, true), 1, 'entry count on this disk');
  assertEq(dv.getUint16(eocd + 10, true), 1, 'total entry count');
});

test('zip: stored entries embed name, sizes and crc', async () => {
  const payload = new TextEncoder().encode('hello');
  const blob = buildZip([{ name: 'a/one.txt', bytes: payload }]);
  const b = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(b.buffer);
  assertEq(dv.getUint16(8, true), 0, 'method 0 = store');
  assertEq(dv.getUint32(14, true) >>> 0, crc32(payload) >>> 0, 'crc in local header');
  assertEq(dv.getUint32(18, true), payload.length, 'compressed size');
  assertEq(dv.getUint32(22, true), payload.length, 'uncompressed size');
  assertEq(dv.getUint16(26, true), 'a/one.txt'.length, 'name length');
  assertEq(String.fromCharCode(...b.subarray(30, 39)), 'a/one.txt', 'name bytes');
  assertEq(String.fromCharCode(...b.subarray(39, 44)), 'hello', 'payload follows the header');
});

test('zip: multiple entries each get a central directory record', async () => {
  const enc = new TextEncoder();
  const blob = buildZip([
    { name: 's/one.txt', bytes: enc.encode('one') },
    { name: 's/two.txt', bytes: enc.encode('twotwo') },
  ]);
  const b = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(b.buffer);
  const eocd = b.length - 22;
  assertEq(dv.getUint16(eocd + 10, true), 2, 'two entries recorded');
  let found = 0;
  for (let i = 0; i < b.length - 4; i++) if (dv.getUint32(i, true) === 0x02014b50) found++;
  assertEq(found, 2, 'two central directory headers');
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Reload the harness. Expected: console 404 for `../lib/zip.js`.

- [ ] **Step 3: Write the implementation**

Create `lib/zip.js`:

```js
/* Store-method (uncompressed) ZIP writer.
 *
 * WAV audio is incompressible, so deflate would cost a lot of complexity for almost no
 * saving. Returning a Blob rather than one big Uint8Array matters: a song's worth of
 * stems is ~210 MB, and a Blob lets the browser spill to disk instead of pinning it all
 * in the JS heap. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {{name: string, bytes: Uint8Array}[]} entries
 * @returns {Blob} a valid .zip
 */
export function buildZip(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, bytes } of entries) {
    const nameBytes = enc.encode(name);
    const crc = crc32(bytes);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);          // local file header signature
    lv.setUint16(4, 20, true);                  // version needed to extract (2.0)
    lv.setUint16(6, 0, true);                   // general purpose flags
    lv.setUint16(8, 0, true);                   // compression method: 0 = store
    lv.setUint16(10, 0, true);                  // last mod time
    lv.setUint16(12, 0x21, true);               // last mod date = 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, bytes.length, true);       // compressed size
    lv.setUint32(22, bytes.length, true);       // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);                  // extra field length
    local.set(nameBytes, 30);
    parts.push(local, bytes);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);          // central directory signature
    cv.setUint16(4, 20, true);                  // version made by
    cv.setUint16(6, 20, true);                  // version needed
    cv.setUint16(8, 0, true);                   // flags
    cv.setUint16(10, 0, true);                  // method: store
    cv.setUint16(12, 0, true);                  // mod time
    cv.setUint16(14, 0x21, true);               // mod date
    cv.setUint32(16, crc, true);
    cv.setUint32(20, bytes.length, true);
    cv.setUint32(24, bytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);                  // extra length
    cv.setUint16(32, 0, true);                  // comment length
    cv.setUint16(34, 0, true);                  // disk number start
    cv.setUint16(36, 0, true);                  // internal attributes
    cv.setUint32(38, 0, true);                  // external attributes
    cv.setUint32(42, offset, true);             // offset of local header
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + bytes.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);            // EOCD signature
  ev.setUint16(4, 0, true);                     // this disk number
  ev.setUint16(6, 0, true);                     // disk with central directory
  ev.setUint16(8, entries.length, true);        // entries on this disk
  ev.setUint16(10, entries.length, true);       // entries total
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);               // central directory offset
  ev.setUint16(20, 0, true);                    // comment length

  return new Blob([...parts, ...central, eocd], { type: 'application/zip' });
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Reload the harness. Expected: `failed === 0`, 11 tests total.

- [ ] **Step 5: Verify against a real unzip implementation**

In-browser structural assertions are not proof the format is right. Generate a file and check it with the system tool:

```bash
cd /Users/sansword/Source/github/sans_bass
node --input-type=module -e "
import { buildZip } from './lib/zip.js';
const enc = new TextEncoder();
const blob = buildZip([
  { name: 'song/vocals.txt', bytes: enc.encode('hello vocals') },
  { name: 'song/guitar.txt', bytes: enc.encode('hello guitar') },
]);
const buf = Buffer.from(await blob.arrayBuffer());
require('fs').writeFileSync('/tmp/ziptest.zip', buf);
" 2>/dev/null || echo "node unavailable — use the browser fallback below"
unzip -t /tmp/ziptest.zip && unzip -l /tmp/ziptest.zip
```

Expected: `No errors detected in compressed data` and both entries listed.

If `node` is unavailable, add a temporary button to `tests/test.html` that downloads `buildZip(...)` output, click it, then run `unzip -t ~/Downloads/ziptest.zip`. Remove the button afterwards.

- [ ] **Step 6: Commit**

```bash
git add lib/zip.js tests/zip.test.js
git commit -m "feat: add store-method ZIP writer

Returns a Blob so a ~210MB archive can spill to disk rather than
pinning the JS heap.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Overlap-add windows and segment planning

**Files:**
- Create: `lib/overlap.js`
- Test: `tests/overlap.test.js`

The spike logged `segment 35/34` — an off-by-one from computing the segment count with a formula separate from the loop. This task removes that class of bug by making the loop iterate over a planned list.

- [ ] **Step 1: Write the failing tests**

Replace `tests/overlap.test.js`:

```js
import { test, assert, assertEq, assertClose } from './assert.js';
import { N_SAMPLES, OVERLAP, STRIDE, segmentStarts, trapezoidWindow, raisedCosineWindow }
  from '../lib/overlap.js';

test('overlap: model constants', () => {
  assertEq(N_SAMPLES, 343980, 'segment length fixed by the model');
  assertEq(OVERLAP, 85995, 'quarter-segment overlap');
  assertEq(STRIDE, 257985, 'stride = length - overlap');
});

test('overlap: segment count matches the number of starts', () => {
  // The spike reported "segment 35/34" because the count and the loop disagreed.
  for (const total of [1, N_SAMPLES - 1, N_SAMPLES, N_SAMPLES + 1, 8_837_640]) {
    const starts = segmentStarts(total);
    let counted = 0;
    for (let s = 0; s < total; s += STRIDE) counted++;
    assertEq(starts.length, counted, `count agrees for total=${total}`);
    assertEq(starts[0], 0, 'first segment starts at 0');
    assert(starts[starts.length - 1] < total, 'no segment starts past the end');
  }
});

test('overlap: short input yields exactly one segment', () => {
  assertEq(segmentStarts(1000).length, 1, 'one segment for sub-segment input');
});

for (const [name, make] of [['trapezoid', trapezoidWindow], ['raisedCosine', raisedCosineWindow]]) {
  test(`overlap: ${name} window shape`, () => {
    const w = make();
    assertEq(w.length, N_SAMPLES, 'window length');
    assertClose(w[0], 0, 1e-6, 'fades in from zero');
    assertClose(w[w.length - 1], 0, 1e-6, 'fades out to zero');
    assertClose(w[Math.floor(N_SAMPLES / 2)], 1, 1e-6, 'unity through the middle');
    for (let i = 0; i < 500; i++) {
      const j = Math.floor((i / 500) * N_SAMPLES);
      assert(w[j] >= 0 && w[j] <= 1, `window stays in [0,1] at ${j}`);
      assertClose(w[j], w[N_SAMPLES - 1 - j], 1e-6, `symmetric at ${j}`);
    }
  });
}

test('overlap: windows differ from each other', () => {
  const a = trapezoidWindow();
  const b = raisedCosineWindow();
  const q = Math.floor(OVERLAP / 2);
  assert(Math.abs(a[q] - b[q]) > 0.01, 'raised cosine is not the trapezoid');
});
```

Note: `8_837_640` is the sample count of `1 基隆路.flac` (200.4 s at 44.1 kHz).

- [ ] **Step 2: Run the tests and verify they fail**

Reload the harness. Expected: console 404 for `../lib/overlap.js`.

- [ ] **Step 3: Write the implementation**

Create `lib/overlap.js`:

```js
/* Segment planning and overlap-add windows for htdemucs_6s.
 *
 * The model takes exactly N_SAMPLES per call, so a track is processed as overlapping
 * segments that are cross-faded back together. */

export const N_SAMPLES = 343980;                    // 7.8 s @ 44.1 kHz — fixed by the model
export const OVERLAP = Math.floor(N_SAMPLES / 4);   // 85995
export const STRIDE = N_SAMPLES - OVERLAP;          // 257985

/**
 * Start offsets of every segment needed to cover `total` samples.
 * The inference loop MUST iterate this array rather than recomputing a count —
 * two independent formulas is how the spike ended up reporting "segment 35/34".
 */
export function segmentStarts(total) {
  const starts = [];
  for (let s = 0; s < total; s += STRIDE) starts.push(s);
  return starts.length ? starts : [0];
}

/** Linear fade in/out — the window used by the model repo's reference infer.py. */
export function trapezoidWindow(n = N_SAMPLES, overlap = OVERLAP) {
  const w = new Float32Array(n);
  const d = overlap - 1;
  for (let i = 0; i < n; i++) {
    if (i < overlap) w[i] = i / d;
    else if (i >= n - overlap) w[i] = (n - 1 - i) / d;
    else w[i] = 1;
  }
  return w;
}

/**
 * Raised-cosine fade in/out. Native Demucs cross-fades with a cosine transition rather
 * than a straight line; the spike found guitar 1.4 dB hot against native output and this
 * is the leading hypothesis for why.
 */
export function raisedCosineWindow(n = N_SAMPLES, overlap = OVERLAP) {
  const w = new Float32Array(n);
  const d = overlap - 1;
  for (let i = 0; i < n; i++) {
    if (i < overlap) w[i] = 0.5 - 0.5 * Math.cos((Math.PI * i) / d);
    else if (i >= n - overlap) w[i] = 0.5 - 0.5 * Math.cos((Math.PI * (n - 1 - i)) / d);
    else w[i] = 1;
  }
  return w;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Reload the harness. Expected: `failed === 0`, 17 tests total.

- [ ] **Step 5: Commit**

```bash
git add lib/overlap.js tests/overlap.test.js
git commit -m "feat: add segment planning and overlap-add windows

segmentStarts() is the single source of truth for the segment list, so
the loop and the progress count cannot disagree.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Extract stem assignment into `lib/stems.js`

**Files:**
- Create: `lib/stems.js` (classic script)
- Modify: `app.js:6-16` (STEMS table), `app.js:18-19` (constants), `app.js:76-90` (`detectStem`), `app.js:128-162` (assignment block)
- Modify: `index.html:69-70`
- Test: `tests/stems.test.js`

This is where the doubled-audio bug identified during spec review gets caught by a test.

- [ ] **Step 1: Write the failing tests**

Replace `tests/stems.test.js`:

```js
import { test, assert, assertEq } from './assert.js';
const { detectStem, assignStems, hasMixPlusStems } = window.SansStems;

const names = (items) => items.map((i) => i.stem);

test('stems: demucs filenames map to lanes', () => {
  assertEq(detectStem('vocals.m4a'), 'vocals', 'vocals');
  assertEq(detectStem('guitar.m4a'), 'guitar', 'guitar');
  assertEq(detectStem('bass.m4a'), 'bass', 'bass');
  assertEq(detectStem('drums.m4a'), 'drums', 'drums');
  assertEq(detectStem('piano.m4a'), 'piano', 'piano');
  assertEq(detectStem('other.m4a'), 'other', 'other');
});

test('stems: the mix pattern stays deliberately narrow', () => {
  // A broad pattern once matched "track_A.m4a" and silently muted every other file.
  assertEq(detectStem('full mix.wav'), 'mix', 'explicit full mix');
  assertEq(detectStem('track_A.m4a'), null, 'generic track name is not the mix');
  assertEq(detectStem('1 基隆路.flac'), null, 'a song title is not the mix');
});

test('stems: a lone file becomes the full mix', () => {
  const out = assignStems([{ name: '1 基隆路.flac' }]);
  assertEq(out[0].stem, 'mix', 'single file is the mix');
});

test('stems: six demucs files produce six distinct lanes', () => {
  const out = assignStems(
    ['vocals.m4a', 'guitar.m4a', 'bass.m4a', 'drums.m4a', 'piano.m4a', 'other.m4a']
      .map((name) => ({ name }))
  );
  assertEq(new Set(names(out)).size, 6, 'six distinct stems');
  assert(!names(out).includes(null), 'all recognised');
});

test('stems: duplicate stem names do not collide', () => {
  const out = assignStems([{ name: 'vocals.m4a' }, { name: 'vocals-2.m4a' }]);
  assertEq(out[0].stem, 'vocals', 'first claims the slot');
  assertEq(out[1].stem, null, 'second falls back to a generic lane');
});

test('stems: an explicit stem overrides filename detection', () => {
  const out = assignStems([{ name: '1 基隆路.flac', stem: 'mix' }, { name: 'x.wav', stem: 'guitar' }]);
  assertEq(out[0].stem, 'mix', 'explicit mix honoured');
  assertEq(out[1].stem, 'guitar', 'explicit guitar honoured');
});

test('stems: THE DOUBLED-AUDIO TRAP — separation output must tag the original as mix', () => {
  // After separation there are 7 tracks, so the lone-file rule does not fire, and a real
  // song filename matches none of the mix patterns. Without an explicit stem the original
  // becomes a generic extra lane, hasMixPlusStems() is false, and the original plays on
  // top of its own six stems at double volume.
  const stems = ['vocals', 'guitar', 'bass', 'drums', 'piano', 'other'];

  const wrong = assignStems([
    { name: '1 基隆路.flac' },
    ...stems.map((s) => ({ name: `${s}.wav`, stem: s })),
  ]);
  assert(wrong[0].stem !== 'mix', 'without an explicit stem the original is NOT the mix');
  assertEq(hasMixPlusStems(wrong), false, 'so the player would layer it on top');

  const right = assignStems([
    { name: '1 基隆路.flac', stem: 'mix' },
    ...stems.map((s) => ({ name: `${s}.wav`, stem: s })),
  ]);
  assertEq(right[0].stem, 'mix', 'explicit tag fixes it');
  assertEq(hasMixPlusStems(right), true, 'mix now suppressed while soloing');
});

test('stems: unrecognised names still get a lane', () => {
  const out = assignStems([{ name: 'weird thing.wav' }, { name: 'another.wav' }]);
  assertEq(out[0].stem, null, 'no stem identity');
  assertEq(out[0].label, 'weird thing', 'labelled from the filename');
  assert(out[0].color && out[1].color && out[0].color !== out[1].color, 'distinct colours');
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Reload the harness. Expected: `TypeError` — `window.SansStems` is undefined.

- [ ] **Step 3: Write `lib/stems.js`**

Create `lib/stems.js`. Move the `STEMS`, `EXTRA_COLORS` and `AUDIO_RE` constants and `detectStem` out of `app.js` verbatim, and add the assignment logic:

```js
/* Stem identity: which lane does a given file belong to?
 *
 * A CLASSIC script, not an ES module, and deliberately so: app.js is a classic script
 * because Chrome refuses <script type="module"> on file://, and the player must keep
 * working when index.html is double-clicked. */
(function (global) {
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

  global.SansStems = { STEMS, EXTRA_COLORS, AUDIO_RE, detectStem, assignStems, hasMixPlusStems };
})(window);
```

- [ ] **Step 4: Load it from both pages**

In `index.html`, add before the `app.js` tag (line 70):

```html
<script src="lib/stems.js"></script>
<script src="app.js"></script>
```

`tests/test.html` already loads it (Task 1, Step 2).

- [ ] **Step 5: Delete the moved code from `app.js`**

Remove the `STEMS`, `EXTRA_COLORS`, `AUDIO_RE` declarations and the whole `detectStem` function from `app.js`, then add this immediately below the file's opening comment block:

```js
const { STEMS, EXTRA_COLORS, AUDIO_RE, detectStem, assignStems, hasMixPlusStems } = window.SansStems;
```

- [ ] **Step 6: Run the tests and verify they pass**

Reload the harness. Expected: `failed === 0`, 25 tests total.

- [ ] **Step 7: Verify the player still works, including from disk**

```bash
open /Users/sansword/Source/github/sans_bass/index.html
```

Click **Load folder**, choose `stems/reborn/1 基隆路/`. Expected: six labelled lanes, playback works, pressing `2` mutes Guitar. This confirms the extraction did not break `file://`.

- [ ] **Step 8: Commit**

```bash
git add lib/stems.js app.js index.html tests/stems.test.js
git commit -m "refactor: extract stem assignment into lib/stems.js

Kept as a classic script so app.js can stay non-module and the player
keeps working from file://. Adds a test for the doubled-audio trap:
after separation the original must be tagged mix explicitly, because
the lone-file rule no longer applies and a song title matches no mix
pattern.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: `app.js` — 44.1 kHz context and a buffer-based load path

**Files:**
- Modify: `app.js:50-59` (`ensureAudio`), `app.js:94-174` (`loadFiles`), `app.js:176-181` (`commonName`), `app.js:219-221` (`buildUI`)

- [ ] **Step 1: Pin the AudioContext to 44.1 kHz**

In `ensureAudio()`, change the construction line to:

```js
    // MUST be 44100: decodeAudioData resamples to the context rate, and the separation
    // model requires 44.1 kHz. A default 48 kHz context on macOS would feed it stretched
    // audio and produce quietly wrong stems with no error anywhere.
    audio = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
```

- [ ] **Step 2: Split `loadFiles` into decode and build**

Replace the body of `loadFiles` from the `// Assign stem identities` comment to the end of the function, and add two new functions after it:

```js
  const items = loaded.map((l) => ({ name: l.file.name, buffer: l.buffer }));
  buildTracks(items, commonName(files));

  if (failed.length) {
    say(`Skipped ${failed.join(', ')} — codec not supported by this browser. Re-encode as .m4a.`, true);
  } else if (tracks.length > 1 && tracks.every((t) => !t.stem)) {
    say('None of these filenames looked like stems, so they are all playing layered on top of ' +
        'each other. Rename them vocals / guitar / bass / drums to get labelled lanes.');
  } else {
    say('');
  }
}

/**
 * Build lanes from decoded audio, whatever its origin.
 * @param {{name: string, buffer: AudioBuffer, stem?: string}[]} items
 * @param {string} title
 */
function buildTracks(items, title) {
  tracks = assignStems(items).map((t) => ({
    name: t.name,          // source filename — the ZIP folder name is derived from it
    stem: t.stem,
    label: t.label,
    color: t.color,
    order: t.order,
    buffer: t.buffer,
    muted: false,
    volume: 1,
    gain: null, peaks: null, canvas: null, laneEl: null, layers: null,
  }));

  tracks.sort((a, b) => a.order - b.order);
  duration = Math.max(...tracks.map((t) => t.buffer.duration));
  offset = 0;

  tracks.forEach((t) => {
    t.gain = audio.createGain();
    t.gain.connect(master);
    t.peaks = computePeaks(t.buffer, duration);
  });

  window.__hasStems = hasMixPlusStems(tracks);

  buildUI(title);
  setMode('mix');
}

/**
 * Entry point for stems produced in-browser rather than loaded from disk.
 * @param {{name: string, buffer: AudioBuffer}} original
 * @param {Object<string, {left: Float32Array, right: Float32Array}>} stems
 */
function loadSeparated(original, stems) {
  // The original MUST be tagged 'mix' explicitly. With seven tracks the lone-file rule
  // does not fire, and a song filename matches none of detectStem's mix patterns — so
  // without this it would be summed on top of its own stems at double volume.
  const items = [{ name: original.name, buffer: original.buffer, stem: 'mix' }];

  for (const [stem, ch] of Object.entries(stems)) {
    const buf = audio.createBuffer(2, ch.left.length, audio.sampleRate);
    buf.copyToChannel(ch.left, 0);
    buf.copyToChannel(ch.right, 1);
    items.push({ name: `${stem}.wav`, buffer: buf, stem });
  }

  loopA = loopB = null;
  renderLoopBadge();
  buildTracks(items, original.name.replace(AUDIO_RE, ''));
  say('');
}
```

- [ ] **Step 3: Make `buildUI` take a title**

Change the signature and the title line:

```js
function buildUI(title) {
  el.dropzone.hidden = true;
  el.player.hidden = false;
  el.title.textContent = title;
```

`commonName(files)` stays as-is and is now called only from `loadFiles`.

- [ ] **Step 4: Expose the hook for the separation module**

At the very end of `app.js`, add:

```js
/* Interface for separate.js, which is an ES module and cannot share scope with this
 * classic script. Kept deliberately small. */
window.sansBass = {
  loadSeparated,
  /** The currently loaded full-mix track, or null. */
  currentMix: () => {
    const t = tracks.find((x) => x.stem === 'mix');
    // t.name, not t.label: assignStems relabels a lone file to "Full mix", which would
    // then become the ZIP's folder name.
    return t ? { name: t.name, buffer: t.buffer } : null;
  },
  /** True when exactly one track is loaded — i.e. an unseparated song. */
  isSingleTrack: () => tracks.length === 1,
  say,
};
```

- [ ] **Step 5: Verify no behaviour changed**

Reload the harness first: `http://localhost:8777/tests/test.html` must still show `failed === 0`.

Then `open index.html`, load `stems/reborn/1 基隆路/`, and confirm:
- six lanes, correct labels and colours
- space plays, `2` mutes Guitar, `0` restores the mix
- `a` then `b` a few seconds later arms a loop that audibly repeats

Then load a **single** file (`rips/reborn/1 基隆路.flac`) and confirm one "Full mix" lane that plays normally.

- [ ] **Step 6: Verify the sample rate actually changed**

With a song loaded, run in the console:

```js
document.querySelector('canvas') && (new AudioContext({sampleRate:44100})).sampleRate
```

Better, add a temporary log in `ensureAudio` (`console.log('ctx rate', audio.sampleRate)`) and confirm it prints `44100`. Remove the log before committing.

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "refactor: buffer-based track loading, 44.1kHz context

buildTracks() accepts decoded buffers from any source, so separation
output no longer has to fake File objects. The context is pinned to
44100 because decodeAudioData resamples to the context rate and the
model requires 44.1kHz.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: The separation worker

**Files:**
- Create: `separate.worker.js`

- [ ] **Step 1: Write the worker**

Create `separate.worker.js`:

```js
/* Separation worker: owns ONNX Runtime, the model, and the inference loop.
 *
 * Runs off the main thread for two reasons: separation takes ~24 s and the player draws
 * waveforms on rAF throughout, and the model plus its allocations are large enough that
 * keeping them off the main heap matters.
 *
 * Model contract (kramp/htdemucs-6s-webgpu-onnx):
 *   input  mix   [1, 2, 343980]
 *   output stems [1, 6, 2, 343980]  in the order below — STFT is baked into the graph.
 */

import { N_SAMPLES, STRIDE, segmentStarts, trapezoidWindow, raisedCosineWindow } from './lib/overlap.js';

const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.webgpu.bundle.min.mjs';
const MODEL_URL = 'https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx/resolve/main/htdemucs_6s.onnx';
const MODEL_CACHE = 'sans-bass-htdemucs6s-v1';

/** Model output order. Never index these positionally from outside — map by name. */
const SOURCES = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'];

let ort = null;
let session = null;
let cancelled = false;

const post = (msg, transfer) => self.postMessage(msg, transfer || []);
const log = (message) => post({ type: 'log', message });

async function loadOrt() {
  if (ort) return ort;
  ort = await import(/* @vite-ignore */ ORT_CDN);
  // Single-threaded: no SharedArrayBuffer, therefore no COOP/COEP headers, therefore
  // this works on GitHub Pages and any plain static host.
  ort.env.wasm.numThreads = 1;
  return ort;
}

async function loadModelBytes(modelUrl) {
  let cache = null;
  try {
    cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(modelUrl);
    if (hit) {
      log('model loaded from cache');
      return await hit.arrayBuffer();
    }
  } catch {
    /* Cache Storage unavailable (private window, quota) — download instead. */
  }

  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
  const total = +res.headers.get('content-length') || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    post({ type: 'download', loaded, total });
  }
  const bytes = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }

  if (cache) {
    try {
      await cache.put(modelUrl, new Response(bytes.slice(0), {
        headers: { 'Content-Type': 'application/octet-stream' },
      }));
    } catch (e) {
      log(`could not cache the model (${e.message}) — it will download again next time`);
    }
  }
  return bytes.buffer;
}

async function ensureSession(modelUrl, modelBuffer) {
  if (session) return session;
  const rt = await loadOrt();
  const bytes = modelBuffer || (await loadModelBytes(modelUrl || MODEL_URL));

  // graphOptimizationLevel 'disabled': the model is already optimized offline, and
  // re-optimizing it in the browser causes a large memory spike.
  const opts = { graphOptimizationLevel: 'disabled' };
  let backend = 'wasm';
  if (self.navigator?.gpu) {
    try {
      session = await rt.InferenceSession.create(bytes, { ...opts, executionProviders: ['webgpu'] });
      backend = 'webgpu';
    } catch (e) {
      log(`WebGPU unavailable (${String(e?.message || e).slice(0, 80)}) — falling back to CPU`);
    }
  }
  if (!session) {
    session = await rt.InferenceSession.create(bytes, { ...opts, executionProviders: ['wasm'] });
  }
  post({ type: 'ready', backend });
  return session;
}

async function separate(left, right, windowKind) {
  const rt = await loadOrt();
  const total = left.length;
  const starts = segmentStarts(total);
  const window = windowKind === 'raisedCosine' ? raisedCosineWindow() : trapezoidWindow();

  const acc = {};
  for (const s of SOURCES) {
    acc[s] = { left: new Float32Array(total), right: new Float32Array(total) };
  }
  const weights = new Float32Array(total);
  const x = new Float32Array(2 * N_SAMPLES);   // reused every segment
  const times = [];

  for (let seg = 0; seg < starts.length; seg++) {
    if (cancelled) throw new Error('cancelled');
    const start = starts[seg];
    const clen = Math.min(N_SAMPLES, total - start);

    x.fill(0);                                  // zero-pad the tail of the last segment
    for (let i = 0; i < clen; i++) {
      x[i] = left[start + i];
      x[N_SAMPLES + i] = right[start + i];
    }

    const t0 = performance.now();
    const out = await session.run({
      [session.inputNames[0]]: new rt.Tensor('float32', x, [1, 2, N_SAMPLES]),
    });
    const stems = out[session.outputNames[0]].data;
    times.push(performance.now() - t0);

    for (let s = 0; s < SOURCES.length; s++) {
      const dst = acc[SOURCES[s]];
      const bL = (s * 2 + 0) * N_SAMPLES;
      const bR = (s * 2 + 1) * N_SAMPLES;
      for (let i = 0; i < clen; i++) {
        const w = window[i];
        dst.left[start + i] += stems[bL + i] * w;
        dst.right[start + i] += stems[bR + i] * w;
      }
    }
    for (let i = 0; i < clen; i++) weights[start + i] += window[i];

    const median = times.slice().sort((a, b) => a - b)[Math.floor(times.length / 2)];
    post({
      type: 'progress',
      segment: seg + 1,
      total: starts.length,
      etaSec: ((starts.length - seg - 1) * median) / 1000,
    });
  }

  for (const s of SOURCES) {
    const dst = acc[s];
    for (let i = 0; i < total; i++) {
      const w = weights[i];
      if (w > 1e-8) { dst.left[i] /= w; dst.right[i] /= w; }
    }
  }
  return acc;
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === 'cancel') { cancelled = true; return; }

    if (msg.type === 'init') {
      await ensureSession(msg.modelUrl, msg.modelBuffer);
      return;
    }

    if (msg.type === 'separate') {
      cancelled = false;
      await ensureSession(msg.modelUrl, msg.modelBuffer);
      const stems = await separate(msg.left, msg.right, msg.window);
      const transfer = [];
      for (const s of SOURCES) transfer.push(stems[s].left.buffer, stems[s].right.buffer);
      post({ type: 'result', stems }, transfer);
    }
  } catch (err) {
    post({ type: 'error', message: err?.message || String(err) });
  }
};
```

- [ ] **Step 2: Smoke-test the worker in isolation**

Create a scratch page `tests/worker-smoke.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>worker smoke</title></head>
<body><pre id="out">running…</pre>
<script type="module">
const out = document.getElementById('out');
const w = new Worker('../separate.worker.js', { type: 'module' });
const seen = [];
w.onmessage = (e) => {
  seen.push(e.data.type);
  out.textContent = JSON.stringify(e.data).slice(0, 300) + '\n\n' + seen.join(', ');
  if (e.data.type === 'ready') { window.__ready = e.data.backend; }
  if (e.data.type === 'error') { window.__error = e.data.message; }
};
w.postMessage({ type: 'init' });
</script></body></html>
```

Open `http://localhost:8777/tests/worker-smoke.html`. First run downloads 285 MB.

Expected: `window.__ready === 'webgpu'` and no `window.__error`. On a machine without WebGPU, `'wasm'` is an acceptable pass.

- [ ] **Step 3: Verify the model comes from cache on reload**

Reload the page. Expected: a `log` message reading `model loaded from cache`, and `__ready` set within a few seconds with no download messages.

- [ ] **Step 4: Commit**

```bash
git add separate.worker.js tests/worker-smoke.html
git commit -m "feat: add separation worker (ORT + htdemucs_6s)

Single-threaded WASM config means no SharedArrayBuffer and therefore no
COOP/COEP, so this runs on any static host including GitHub Pages.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Separation panel and player wiring

**Files:**
- Create: `separate.js`
- Modify: `index.html` (panel markup + conditional module injection)
- Modify: `styles.css` (append)

- [ ] **Step 1: Add the panel markup**

In `index.html`, insert directly after the closing `</div>` of `<div class="controls">` and before `<div id="lanes" class="lanes"></div>`:

```html
    <section id="sep" class="sep" hidden>
      <div class="sep-row">
        <button id="sep-go" class="btn">Separate into 6 stems</button>
        <span id="sep-status" class="dim"></span>
      </div>
      <div id="sep-bar" class="sep-bar" hidden><div id="sep-fill"></div></div>
      <div class="sep-row">
        <button id="sep-save" class="btn ghost" hidden>Save stems (.zip)</button>
        <button id="sep-cancel" class="btn ghost" hidden>Cancel</button>
        <label class="btn ghost">
          Use a local .onnx
          <input type="file" id="sep-model" accept=".onnx" hidden>
        </label>
      </div>
    </section>
```

- [ ] **Step 2: Inject the module only when served over HTTP**

Replace line 70 of `index.html` (`<script src="app.js"></script>`) with:

```html
<script src="lib/stems.js"></script>
<script src="app.js"></script>
<script>
  // separate.js is an ES module and Chrome blocks module scripts on file://. Injecting it
  // conditionally keeps the player working when index.html is opened straight from disk.
  if (location.protocol !== 'file:') {
    const s = document.createElement('script');
    s.type = 'module';
    s.src = 'separate.js';
    document.body.appendChild(s);
  }
</script>
```

- [ ] **Step 3: Write the panel module**

Create `separate.js`:

```js
/* Separation panel: owns the worker's lifecycle and the UI around it.
 * Loaded only over HTTP — see the injection guard in index.html. */

import { encodeWav } from './lib/wav.js';
import { buildZip } from './lib/zip.js';

const el = {
  panel:  document.getElementById('sep'),
  go:     document.getElementById('sep-go'),
  save:   document.getElementById('sep-save'),
  cancel: document.getElementById('sep-cancel'),
  status: document.getElementById('sep-status'),
  bar:    document.getElementById('sep-bar'),
  fill:   document.getElementById('sep-fill'),
  model:  document.getElementById('sep-model'),
};

const MB = 1e6;
let worker = null;
let lastStems = null;
let lastName = 'song';
let localModel = null;   // ArrayBuffer from the "use a local .onnx" picker

function setProgress(frac) {
  el.bar.hidden = frac === null;
  if (frac !== null) el.fill.style.width = `${Math.round(frac * 100)}%`;
}

function status(msg) { el.status.textContent = msg; }

function busy(on) {
  el.go.disabled = on;
  el.cancel.hidden = !on;
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker('separate.worker.js', { type: 'module' });
  return worker;
}

/**
 * The panel is for a single unseparated track — but it must stay up after a successful
 * run, or the Save button vanishes 400 ms after the stems appear.
 */
function refresh() {
  const single = window.sansBass?.isSingleTrack?.();
  if (single) {
    el.panel.hidden = false;
    el.save.hidden = true;
    lastStems = null;                 // a newly loaded song invalidates old results
  } else if (!lastStems) {
    el.panel.hidden = true;           // a stems folder was loaded directly
  }
}

el.go.addEventListener('click', () => {
  const mix = window.sansBass.currentMix();
  if (!mix) return;

  const dur = mix.buffer.duration;
  if (dur > 8 * 60 &&
      !confirm(`This track is ${Math.round(dur / 60)} minutes long. Separation holds every ` +
               `stem in memory and may exhaust it. Continue?`)) {
    return;
  }

  lastName = mix.name.replace(/\.[^.]+$/, '');   // "1 基隆路.flac" -> "1 基隆路"
  const left = mix.buffer.getChannelData(0).slice();
  const right = (mix.buffer.numberOfChannels > 1
    ? mix.buffer.getChannelData(1)
    : mix.buffer.getChannelData(0)).slice();

  const w = getWorker();
  busy(true);
  status('loading model…');
  setProgress(0);

  // A worker killed by the OOM reaper never posts anything. Without this the UI
  // would sit on a progress bar for ever.
  w.onerror = (err) => {
    busy(false);
    setProgress(null);
    status(`worker failed: ${err.message || 'out of memory?'} — try a shorter track`);
    worker = null;
  };

  w.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'download') {
      status(`downloading model ${(m.loaded / MB).toFixed(0)} / ${(m.total / MB).toFixed(0)} MB`);
      setProgress(m.total ? m.loaded / m.total : 0);
    } else if (m.type === 'ready') {
      status(m.backend === 'webgpu'
        ? 'separating on GPU…'
        : 'separating on CPU — no WebGPU here, so this will take many minutes');
      setProgress(0);
    } else if (m.type === 'progress') {
      status(`segment ${m.segment}/${m.total} — about ${Math.ceil(m.etaSec)}s left`);
      setProgress(m.segment / m.total);
    } else if (m.type === 'log') {
      console.log('[separate]', m.message);
    } else if (m.type === 'result') {
      lastStems = m.stems;
      busy(false);
      setProgress(null);
      status('done');
      el.save.hidden = false;
      window.sansBass.loadSeparated({ name: lastName, buffer: mix.buffer }, m.stems);
      el.panel.hidden = false;         // keep the panel up so Save stays reachable
    } else if (m.type === 'error') {
      busy(false);
      setProgress(null);
      status(m.message === 'cancelled' ? 'cancelled' : `failed: ${m.message}`);
    }
  };

  w.postMessage(
    { type: 'separate', left, right, modelBuffer: localModel || undefined },
    [left.buffer, right.buffer]
  );
});

// Lets the 285 MB model be supplied from disk, so the feature works fully offline.
el.model.addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  status(`reading ${f.name}…`);
  localModel = await f.arrayBuffer();
  status(`using local model (${(localModel.byteLength / MB).toFixed(0)} MB)`);
});

el.cancel.addEventListener('click', () => {
  worker?.postMessage({ type: 'cancel' });
  status('cancelling…');
});

el.save.addEventListener('click', async () => {
  if (!lastStems) return;
  el.save.disabled = true;
  status('encoding WAVs…');
  try {
    // Encode one stem at a time and hand each straight to the ZIP builder, so the WAV
    // bytes are never all live at once on top of the stems themselves.
    const entries = [];
    for (const [stem, ch] of Object.entries(lastStems)) {
      entries.push({ name: `${lastName}/${stem}.wav`, bytes: encodeWav(ch.left, ch.right, 44100) });
      await new Promise((r) => setTimeout(r, 0));   // let the UI repaint between stems
    }
    const blob = buildZip(entries);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${lastName}-stems.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    status(`saved ${(blob.size / MB).toFixed(0)} MB`);
  } catch (e) {
    status(`save failed: ${e.message}`);
  } finally {
    el.save.disabled = false;
  }
});

// The player has no load event, so poll for a track appearing. Cheap and avoids
// reaching into app.js internals.
setInterval(refresh, 400);
refresh();
```

- [ ] **Step 4: Style the panel**

Append to `styles.css`:

```css
/* ---- separation panel ---- */
.sep {
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px 16px; margin: 0 0 14px;
  background: #141419; border: 1px solid #23232b; border-radius: 10px;
}
.sep-row { display: flex; align-items: center; gap: 12px; }
.sep-bar { height: 6px; background: #23232b; border-radius: 3px; overflow: hidden; }
.sep-bar > div { height: 100%; width: 0; background: #ff9f1c; transition: width .2s linear; }
.sep .btn[disabled] { opacity: .5; cursor: default; }
```

- [ ] **Step 5: Verify end to end**

Open `http://localhost:8777/index.html`. Click **Load files**, choose `rips/reborn/2 最後兩禮拜.flac` (deliberately a track whose stems we have, but not the one used for the spike).

Expected in order:
1. One "Full mix" lane, and the separation panel visible.
2. Click **Separate into 6 stems** → `separating on GPU…` → segment progress with a falling ETA.
3. After ~25 s, seven lanes: Vocals, Guitar, Bass, Drums, Piano, Other, Full mix.
4. **Press `0`, then play.** It must not sound doubled or distorted — that is the doubled-audio trap. Then click the Guitar lane name to solo it; only guitar should be audible.
5. `a` / `b` arm a loop that repeats cleanly.

Also verify **requirement 5 of the spec — the UI stays responsive**. While the segment
counter is advancing, press space and confirm the loaded mix plays and its playhead animates
smoothly. A frozen playhead means inference is blocking the main thread and the worker is not
doing its job.

- [ ] **Step 6: Verify the file:// guard**

```bash
open /Users/sansword/Source/github/sans_bass/index.html
```

Expected: the player loads and plays a stems folder normally, the separation panel never appears, and the console shows **no** module or CORS errors.

- [ ] **Step 7: Verify the ZIP**

Click **Save stems (.zip)**, then:

```bash
cd ~/Downloads && unzip -t *-stems.zip && unzip -l *-stems.zip
```

Expected: `No errors detected`, six `.wav` entries under one folder. Then unzip it and load that folder with **Load folder** — it must play as six lanes.

- [ ] **Step 8: Commit**

```bash
git add separate.js index.html styles.css
git commit -m "feat: separation panel wired to the player

Module injected only over HTTP so file:// keeps working.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Parity harness and the guitar-level question

**Files:**
- Create: `tests/parity.html`

- [ ] **Step 1: Write the parity harness**

Create `tests/parity.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>sans_bass — separation parity</title>
<style>
  body { background:#0d0d10; color:#e9e9ef; font:13px ui-monospace,Menlo,monospace; padding:24px; }
  pre { background:#141419; padding:14px; border-radius:8px; white-space:pre-wrap; line-height:1.6; }
</style>
</head>
<body>
<h1>parity vs native htdemucs_6s</h1>
<p>Set <code>?window=raisedCosine</code> to try the alternative overlap window.</p>
<pre id="out">running…</pre>
<script type="module">
const out = document.getElementById('out');
const SR = 44100;
const TRACK = '/rips/reborn/2 最後兩禮拜.flac';
const TRUTH = '/stems/reborn/2 最後兩禮拜';
const CHECK = ['vocals', 'bass', 'guitar', 'drums'];
const windowKind = new URLSearchParams(location.search).get('window') || 'trapezoid';

const log = (s) => { out.textContent += s + '\n'; };

async function decode(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const ctx = new AudioContext({ sampleRate: SR });
  const buf = await ctx.decodeAudioData(await res.arrayBuffer());
  await ctx.close();
  return buf;
}

const rms = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / a.length); };
const dB = (x) => (x < 1e-9 ? -Infinity : +(20 * Math.log10(x)).toFixed(1));

function corr(a, b) {
  let ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
  ma /= a.length; mb /= b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

function bestCorr(ours, truth, maxLag = 4096) {
  let best = -1, bestLag = 0;
  for (let lag = -maxLag; lag <= maxLag; lag += 64) {
    const n = Math.min(ours.length, truth.length) - Math.abs(lag) - 1;
    if (n < SR) continue;
    const c = corr(ours.subarray(Math.max(0, -lag), Math.max(0, -lag) + n),
                   truth.subarray(Math.max(0, lag), Math.max(0, lag) + n));
    if (c > best) { best = c; bestLag = lag; }
  }
  return { corr: +best.toFixed(3), lag: bestLag };
}

log(`window: ${windowKind}`);
log(`decoding ${TRACK}`);
const mix = await decode(TRACK);
const left = mix.getChannelData(0).slice();
const right = (mix.numberOfChannels > 1 ? mix.getChannelData(1) : mix.getChannelData(0)).slice();
log(`  ${mix.duration.toFixed(1)}s @ ${mix.sampleRate} Hz`);

const t0 = performance.now();
const stems = await new Promise((resolve, reject) => {
  const w = new Worker('../separate.worker.js', { type: 'module' });
  w.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') out.textContent = out.textContent.replace(/\nsegment.*$/, '') + `\nsegment ${m.segment}/${m.total}`;
    if (m.type === 'ready') log(`backend: ${m.backend}`);
    if (m.type === 'result') { w.terminate(); resolve(m.stems); }
    if (m.type === 'error') { w.terminate(); reject(new Error(m.message)); }
  };
  w.postMessage({ type: 'separate', left, right, window: windowKind }, [left.buffer, right.buffer]);
});
const sec = (performance.now() - t0) / 1000;
log(`\nseparated in ${sec.toFixed(1)}s (${(mix.duration / sec).toFixed(1)}x realtime)\n`);

const results = {};
let worst = 1;
for (const stem of CHECK) {
  const truth = await decode(`${TRUTH}/${stem}.m4a`);
  const edge = 8 * SR;
  const tL = truth.getChannelData(0).subarray(edge, truth.length - edge);
  const oL = stems[stem].left.subarray(edge, stems[stem].left.length - edge);
  const n = Math.min(tL.length, oL.length);
  const r = bestCorr(oL.subarray(0, n), tL.subarray(0, n));
  const deltaDb = +(dB(rms(oL.subarray(0, n))) - dB(rms(tL.subarray(0, n)))).toFixed(1);
  results[stem] = { ...r, deltaDb };
  worst = Math.min(worst, r.corr);
  log(`${stem.padEnd(8)} corr=${r.corr}  lag=${r.lag}  level delta=${deltaDb > 0 ? '+' : ''}${deltaDb} dB`);
}

const pass = worst >= 0.99 && Object.values(results).every((r) => r.lag === 0);
log(`\n${pass ? 'PASS' : 'FAIL'} — worst correlation ${worst}`);
window.__parity = { windowKind, seconds: +sec.toFixed(1), results, pass };
console.log('[parity]', JSON.stringify(window.__parity));
</script>
</body>
</html>
```

- [ ] **Step 2: Run parity with the default trapezoid window**

Open `http://localhost:8777/tests/parity.html` and read `window.__parity`.

Expected: `pass === true`, every `lag === 0`, correlations ≥ 0.99. Record `results.guitar.deltaDb` — the spike measured about `+1.4`.

- [ ] **Step 3: Run parity with the raised-cosine window**

Open `http://localhost:8777/tests/parity.html?window=raisedCosine` and read `window.__parity`.

Compare `results.guitar.deltaDb` against Step 2.

- [ ] **Step 4: Choose the window and record why**

If raised-cosine brings guitar's delta closer to 0 **without** reducing any correlation, make it the default: in `separate.worker.js`, change the `separate()` default so `windowKind === 'trapezoid'` selects the trapezoid and anything else (including `undefined`) selects raised cosine:

```js
  const window = windowKind === 'trapezoid' ? trapezoidWindow() : raisedCosineWindow();
```

If it does not help, leave the trapezoid as the default. Either way, write the measured numbers for both windows into the devlog in Task 10 — the spec logged this as an open question and it must be closed with data, not left dangling.

- [ ] **Step 5: Commit**

```bash
git add tests/parity.html separate.worker.js
git commit -m "test: add parity harness vs native demucs output

Measures correlation, lag and level delta per stem against the native
stems already in the repo, and settles which overlap window to use.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: Documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/devlog.md`

- [ ] **Step 1: Add a README section**

Insert a new `## Step 3b — or skip all that: separate in the browser` section immediately before `## Step 4 — Play`:

```markdown
## Step 3b — or skip all that: separate in the browser

Steps 2 and 3 are the fast path for a whole album. For a single song you can skip Python,
Homebrew and Demucs entirely and let the browser do it.

```bash
./scripts/serve.sh          # http://localhost:8777
```

Open that URL, click **Load files**, pick any audio file, then **Separate into 6 stems**.
You get the same six lanes, and a **Save stems (.zip)** button that writes
`<song>/{vocals,guitar,bass,drums,piano,other}.wav` — unzip it and it loads with
**Load folder**.

It uses [`kramp/htdemucs-6s-webgpu-onnx`](https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx),
the same `htdemucs_6s` weights as the local pipeline, exported to ONNX and run through WebGPU.

Details worth knowing:

- **It is as fast as the native pipeline.** About 24 seconds for a 3-minute song on Apple
  Silicon, measured against 22 seconds for `prep-stems.sh`.
- **It matches the native output.** Correlation 0.993–0.997 against locally produced stems,
  at zero sample lag.
- **First run downloads a 285 MB model**, then caches it in the browser. Later runs start
  immediately.
- **Requires the local server**, not a `file://` page: browsers block module loading and
  Cache Storage from disk. The player itself still works double-clicked; only separation
  needs the server.
- **Needs WebGPU** to be quick. Without it the run falls back to CPU and takes many minutes;
  the page tells you which one you got.
- **Saved stems are WAV, so they are big** — roughly 210 MB per song against 25 MB for the
  `.m4a` files `prep-stems.sh` writes. Re-encode with ffmpeg if that matters.
- **Whole albums still belong in `prep-stems.sh`.** The browser does one song at a time.
```

- [ ] **Step 2: Correct the privacy wording in the README**

The intro currently reads "No server, no upload, no build step — the audio never leaves your Mac." Replace that sentence with:

```markdown
No build step and no upload — your audio never leaves your machine. In-browser separation
fetches a model *in*, but nothing about your audio ever goes *out*.
```

- [ ] **Step 3: Update `CLAUDE.md`**

Under "Hard constraints", replace the "Nothing leaves the machine" bullet with:

```markdown
- **Nothing leaves the machine.** No uploads, no analytics, no audio egress ever. Inbound
  fetches are allowed and necessary: the ONNX runtime from jsDelivr and the ~285 MB model
  from Hugging Face. Keep the distinction — "no outbound audio", not "no network calls".
```

Add to the "Architecture in one pass" section:

```markdown
- **In-browser separation** (`separate.js`, `separate.worker.js`) is additive and optional.
  The worker owns ONNX Runtime and `htdemucs_6s`; `lib/overlap.js` plans the segments;
  `lib/wav.js` and `lib/zip.js` handle saving. It is loaded **only over HTTP** — `index.html`
  injects the module conditionally, because Chrome blocks `<script type="module">` on
  `file://` and the player must survive being double-clicked. `app.js` therefore stays a
  classic script, and `lib/stems.js` is a classic script too so both it and the tests can
  use it.
```

Add to "Gotchas that will bite again":

```markdown
- **The AudioContext must be 44.1 kHz.** `decodeAudioData` resamples to the context rate,
  and the separation model requires 44100. A default context is often 48 kHz on macOS,
  which would feed the model stretched audio and produce wrong stems with no error at all.
- **Separation output must tag the original track `stem: 'mix'` explicitly.** With seven
  tracks the lone-file rule in `assignStems` does not fire, and a real song title matches
  none of the deliberately narrow mix patterns — so the original would be summed on top of
  its own six stems at double volume. Covered by a test in `tests/stems.test.js`.
- **`numThreads = 1` is load-bearing, not a performance tweak.** It avoids SharedArrayBuffer,
  which avoids COOP/COEP, which is what makes static hosting (GitHub Pages) possible at all.
```

Add a testing note under "Working conventions":

```markdown
- **Tests are browser pages, not a runner.** `tests/test.html` for units (read
  `window.__testResults`), `tests/parity.html` for separation accuracy against the native
  stems in the repo (read `window.__parity`). Both need `./scripts/serve.sh`. There is no
  npm and none may be added.
```

- [ ] **Step 4: Write the devlog entry**

Add to `docs/devlog.md` immediately below the `---` that follows the TL;DR table, and add a matching TL;DR row linking to `#v120--in-browser-stem-separation-2026-08-20`.

Fill in the bracketed measurements from the parity runs in Task 9 — do not leave them unfilled.

```markdown
## v1.2.0 — In-browser stem separation (2026-08-20)

**Review:** not yet

**Design docs:**
- In-browser separation: [Spec](superpowers/specs/2026-08-20-in-browser-separation-design.md) [Plan](superpowers/plans/2026-08-20-in-browser-separation.md)

**What was built:**

- Six-stem separation running entirely in the browser via `onnxruntime-web` and
  `kramp/htdemucs-6s-webgpu-onnx`, at parity with the native pipeline on both speed and output.
- `separate.worker.js` (inference), `separate.js` (panel), `lib/overlap.js`, `lib/wav.js`,
  `lib/zip.js`, and `lib/stems.js` extracted from `app.js`.
- Save stems as one ZIP of WAVs, laid out so unzipping gives a folder **Load folder** accepts.
- First dependency-free test harness for the project: `tests/test.html` and `tests/parity.html`.

**Key technical learnings:**

- `[insight]` **Picking the right model mattered more than the integration.** The obvious
  starting point (`timcsy/demucs-web`) strips STFT out of the ONNX graph and reimplements it
  in JS, which locks you to a 4-stem model with no guitar and to a WASM path running at
  0.1–0.3× realtime. A model with STFT baked in as Conv1d — contract `mix [1,2,343980]` →
  `stems [1,6,2,343980]` — deleted the entire spectrogram layer from our code and ran 30×
  faster. Check what the model's I/O contract lets you *delete* before adopting a library.
- `[insight]` `numThreads = 1` is an architectural decision, not a tuning knob. It avoids
  SharedArrayBuffer, which avoids COOP/COEP, which is the only reason this can be hosted on
  GitHub Pages — a host that cannot set response headers.
- `[gotcha]` `decodeAudioData` resamples to the AudioContext's rate. A default 48 kHz context
  on macOS silently feeds the model stretched audio: no error, just subtly wrong stems.
- `[gotcha]` After separation there are seven tracks, so the lone-file "this is the mix" rule
  never fires and a real song title matches none of the mix filename patterns. The original
  would have been summed on top of its own stems at double volume. Caught by spec review
  before any code existed, and now pinned by a test.
- `[insight]` Ground truth we already had made verification trivial. `stems/reborn/` is native
  `htdemucs_6s` output, so correctness became a correlation measurement rather than a
  listening opinion: 0.993–0.997 at zero lag.
- `[note]` The overlap window question — native Demucs cross-fades with a raised cosine, the
  reference `infer.py` with a trapezoid. Measured guitar level delta: trapezoid [FILL],
  raised cosine [FILL]. Chose [FILL].
- `[note]` WebGPU only works here because the model was constant-folded to remove a
  `ConstantOfShape` op that ORT's WebGPU backend cannot run. The same weights unfolded fall
  back to WASM and are ~30× slower.

**Process learnings:**

- `[insight]` The spike was worth more than the estimate it replaced. Published figures said
  10–30 minutes per song; measurement said 24 seconds. Both were "true" — of different
  models on different backends. One afternoon of measurement changed the feature from
  not-worth-building to at-parity-with-native.
- `[gotcha]` Computing a segment count with a formula separate from the loop that consumes it
  produced `segment 35/34` in the spike. `segmentStarts()` is now the single source of truth
  and a test asserts the two agree.
```

- [ ] **Step 5: Document static hosting**

Append to the new README section from Step 1:

```markdown
### Hosting it

The whole thing is static, so GitHub Pages serves it with no backend and no build step —
push the repo and enable Pages. Inference runs on the visitor's GPU.

This works only because `numThreads = 1` avoids SharedArrayBuffer and therefore COOP/COEP,
which Pages cannot set. Do not "optimise" that setting without re-reading
[`CLAUDE.md`](CLAUDE.md).

Two rules for a public deployment:

- **Never commit the model.** GitHub rejects files over 100 MB and it is 285 MB. It is
  fetched from Hugging Face at runtime and cached in the browser.
- **`rips/` and `stems/` stay gitignored.** Publishing the repo must not publish the
  recordings.
```

Add to `CLAUDE.md` under "Hard constraints":

```markdown
- **Deployable as a static site.** GitHub Pages hosts it with no backend. This depends on
  `ort.env.wasm.numThreads = 1` (no SharedArrayBuffer → no COOP/COEP, which Pages cannot
  set). Never commit the 285 MB model; it is fetched at runtime.
```

- [ ] **Step 6: Verify the docs**

```bash
cd /Users/sansword/Source/github/sans_bass
grep -n "FILL" docs/devlog.md && echo "!!! placeholders remain — fill them in" || echo "no placeholders"
grep -n "no network calls" README.md CLAUDE.md && echo "!!! stale privacy wording" || echo "privacy wording updated"
```

Expected: `no placeholders` and `privacy wording updated`.

- [ ] **Step 7: Commit**

```bash
git add README.md CLAUDE.md docs/devlog.md
git commit -m "docs: document in-browser separation (v1.2.0)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: Final verification and tag

- [ ] **Step 1: Run the whole test suite**

With `./scripts/serve.sh` running:

1. `http://localhost:8777/tests/test.html` → `window.__testResults.failed === 0`
2. `http://localhost:8777/tests/parity.html` → `window.__parity.pass === true`

- [ ] **Step 2: Verify the `file://` player one more time**

```bash
open /Users/sansword/Source/github/sans_bass/index.html
```

Load `stems/reborn/1 基隆路/`. Six lanes, playback, solo, and A–B repeat all work; no console errors; no separation panel.

- [ ] **Step 3: Confirm no audio is tracked**

```bash
cd /Users/sansword/Source/github/sans_bass
git status --short
git ls-files | grep -E '\.(flac|m4a|wav|onnx)$' && echo "!!! audio or model tracked" || echo "clean"
```

Expected: `clean`, and a tidy working tree.

- [ ] **Step 4: Remove the scratch smoke page**

```bash
git rm tests/worker-smoke.html
git commit -m "chore: drop the worker smoke page

Superseded by tests/parity.html, which exercises the same path with
assertions.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Merge and tag**

```bash
git checkout main
git merge --no-ff feat/in-browser-separation -m "Merge in-browser stem separation (v1.2.0)"
git tag -a v1.2.0 -m "In-browser 6-stem separation via onnxruntime-web + htdemucs_6s"
git log --oneline -1 && git tag -n1
```

- [ ] **Step 6: Report the outcome**

State plainly: the measured parity numbers, which overlap window was chosen and why, the separation time for a 3-minute song, and anything that did not work. If any step was skipped, say which and why.

---

## Notes for the implementer

- **Do not add npm, a bundler, or any dependency.** The project's identity is that
  `index.html` works when you double-click it. Every design choice here defends that.
- **`app.js` must stay a classic script.** Converting it to a module breaks `file://`.
- **Verify with evidence.** This project's devlog is emphatic about it: parameters being set
  is not proof of behaviour. Read `window.__testResults` and `window.__parity`; do not assert
  success from the absence of an error message.
- **The 285 MB model downloads once per browser profile.** If you clear storage mid-task,
  expect to wait again.
- **If WebGPU is unavailable on the machine you are testing**, separation still works but
  takes many minutes. Say so in the report rather than waiting silently or calling it broken.
