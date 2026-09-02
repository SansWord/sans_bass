# GoatCounter Usage Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship anonymous, cookieless usage analytics so the project can tell whether anyone uses the site and which parts of it they reach.

**Architecture:** A new classic script `lib/analytics.js` exposes `window.SansAnalytics` with three verbs — `track` (every occurrence), `once` (first time per page load), and `bump` (power-of-two buckets). It owns its own queue, because GoatCounter has none for calls made before its async script loads. Call sites in `app.js`, `separate.js` and `separate.worker.js` go through null-safe wrappers so a blocked or missing analytics script can never break the player.

**Tech Stack:** Vanilla JS, no build step, no dependencies, no npm. Classic script (not ESM) so `tests/test.html` can load it the same way it loads `lib/stems.js`. Tests are browser pages read via `window.__testResults`.

**Spec:** [`docs/superpowers/specs/2026-08-21-analytics-design.md`](../specs/2026-08-21-analytics-design.md)

**Branch:** `feat/analytics` (already checked out; the spec commits live here). Land on `main` via PR.

---

## Corrections to the spec

Three things the spec states are wrong or incomplete. The plan below is correct; fix the spec in Task 9.

1. **`tests/versions.test.js` needs no change.** The spec says it "asserts the count of tagged URLs." It does not — it asserts that every local asset URL carries a `?v=` and that all versions agree. A new `lib/analytics.js?v=1.7.0` is picked up automatically.
2. **The GoatCounter script tag must use `https://gc.zgo.at/count.js`, not the protocol-relative `//gc.zgo.at/count.js` from GoatCounter's docs.** `versions.test.js` skips external URLs with `if (url.startsWith('http')) continue;`. A protocol-relative URL fails that check, gets treated as a local asset with no `?v=`, and fails the suite.
3. **`play` is instrumented in `toggle()`, not `play()`.** `play()` is re-entered internally by `seek()` (app.js:609) and `refreshLoop()` (app.js:644), so it is not a user-gesture boundary. `toggle()` (app.js:607) is the single entry point for both the button and the spacebar.

Also: `index.html` carries **6** version tags, not 5 — `styles.css?v=1.6.0` on line 7 counts. It becomes 7 with `lib/analytics.js`.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/analytics.js` (create) | The whole analytics module: counting rules, queue, GoatCounter transport. Exposes `window.SansAnalytics`. Classic script. |
| `tests/analytics.test.js` (create) | Unit tests for the counting rules and the queue, against an injected sink. |
| `tests/test.html` (modify) | Load `lib/analytics.js` and import the new test module. |
| `index.html` (modify) | GoatCounter snippet, `lib/analytics.js` tag, version bump to `v1.7.0`. |
| `app.js` (modify) | Three null-safe wrappers plus call sites for load and interaction events. |
| `separate.js` (modify) | Call sites for the separation lifecycle; version bump. |
| `separate.worker.js` (modify) | Report cache-vs-network on the `ready` message; version bump. |
| `CLAUDE.md` (modify) | Constraint line, version-tag count, analytics gotchas. |
| `docs/behaviour.md` (modify) | Observable analytics behaviour and the verification recipe. |
| `docs/devlog.md` (modify) | `v1.7.0` entry, TL;DR row. |

---

### Task 1: `lib/analytics.js` — `track`, `once`, the queue, `setSink`, `reset`

**Files:**
- Create: `lib/analytics.js`
- Create: `tests/analytics.test.js`
- Modify: `tests/test.html:16` (script tags) and `tests/test.html:24` (imports)

- [ ] **Step 1: Register the new files in the test harness**

In `tests/test.html`, add the analytics script after `lib/i18n.js`:

```html
  <script src="../lib/stems.js"></script>
  <script src="../lib/unzip.js"></script>
  <script src="../lib/i18n.js"></script>
  <script src="../lib/analytics.js"></script>
```

And add the import after `i18n.test.js`:

```js
    await import('./i18n.test.js');
    await import('./analytics.test.js');
    await runAll(document.getElementById('out'));
```

- [ ] **Step 2: Write the failing tests**

Create `tests/analytics.test.js`:

```js
import { test, assert, assertEq } from './assert.js';

const A = () => window.SansAnalytics;

/** Fresh state plus a recording sink. Returns the array the sink writes into. */
function collect() {
  A().reset();
  const seen = [];
  A().setSink((name) => seen.push(name));
  return seen;
}

test('analytics: track fires on every call', () => {
  const seen = collect();
  A().track('song-load');
  A().track('song-load');
  assertEq(seen.join(','), 'song-load,song-load');
});

test('analytics: once fires only the first time', () => {
  const seen = collect();
  A().once('play');
  A().once('play');
  A().once('play');
  assertEq(seen.join(','), 'play');
});

test('analytics: once tracks each name separately', () => {
  const seen = collect();
  A().once('play');
  A().once('lang-en');
  A().once('play');
  assertEq(seen.join(','), 'play,lang-en');
});

test('analytics: events fired before a sink exists are queued and drained in order', () => {
  A().reset();                       // reset clears the sink too
  A().track('early-one');
  A().track('early-two');
  const seen = [];
  A().setSink((name) => seen.push(name));
  assertEq(seen.join(','), 'early-one,early-two');
});

test('analytics: the queue is capped so a blocked transport cannot grow it without bound', () => {
  A().reset();
  for (let i = 0; i < 100; i++) A().track(`e${i}`);
  const seen = [];
  A().setSink((name) => seen.push(name));
  assertEq(seen.length, 50, 'queue should cap at 50');
  assertEq(seen[0], 'e0', 'the oldest events are the ones kept');
});

test('analytics: a throwing sink never propagates to the caller', () => {
  A().reset();
  A().setSink(() => { throw new Error('blocked by an extension'); });
  A().track('song-load');
  A().once('play');
  assert(true, 'no exception escaped');
});

test('analytics: reset clears fired names', () => {
  collect();
  A().once('play');
  const again = collect();
  A().once('play');
  assertEq(again.join(','), 'play');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Start the server if it is not already running:

```bash
./scripts/serve.sh
```

Open `http://localhost:8777/tests/test.html` and read the page, or read `window.__testResults` in the console.

Expected: every `analytics:` test FAILs with something like `Cannot read properties of undefined (reading 'reset')`, because `window.SansAnalytics` does not exist yet. The pre-existing tests must still PASS.

- [ ] **Step 4: Write the minimal implementation**

Create `lib/analytics.js`:

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
 * Classic script, not ESM, for the same reason lib/stems.js is: tests/test.html and
 * app.js both need it, and the ESM migration is a separate change. */
(function (global) {
  'use strict';

  const QUEUE_MAX = 50;   // an ad blocker means the sink never arrives; do not grow for ever

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

  /** Install the transport and flush anything that arrived before it existed. */
  function setSink(fn) {
    sink = fn;
    drain();
  }

  /** Test seam. Clears the sink too, so a test can exercise the queue. */
  function reset() {
    fired.clear();
    counts.clear();
    queue.length = 0;
    sink = null;
  }

  global.SansAnalytics = { track, once, setSink, reset };
})(window);
```

- [ ] **Step 5: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.

Expected: every `analytics:` test PASSes, and the pre-existing tests still pass. `window.__testResults.failed` is `0`.

- [ ] **Step 6: Commit**

```bash
git add lib/analytics.js tests/analytics.test.js tests/test.html
git commit -m "Analytics: track, once, and a queue for the sink that has not arrived yet

GoatCounter has no queue for calls made before its async script loads
and its docs recommend polling. Own the queue here instead, capped so a
blocked transport cannot grow it without bound.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `bump()` — power-of-two buckets

Cut points are deliberately not configurable. The frequency distribution is one of the things this instrumentation exists to discover, so hard-coding thresholds would bake in the guess it is meant to test. See the spec's "Why power-of-two buckets" section.

**Files:**
- Modify: `lib/analytics.js`
- Modify: `tests/analytics.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/analytics.test.js`:

```js
test('analytics: bump fires the base event on the first occurrence', () => {
  const seen = collect();
  A().bump('seek');
  assertEq(seen.join(','), 'seek');
});

test('analytics: bump fires a bucket at each power of two', () => {
  const seen = collect();
  for (let i = 0; i < 8; i++) A().bump('seek');
  assertEq(seen.join(','), 'seek,seek-2,seek-4,seek-8');
});

test('analytics: bump is silent on counts that are not powers of two', () => {
  const seen = collect();
  for (let i = 0; i < 7; i++) A().bump('seek');   // counts 1..7
  assertEq(seen.join(','), 'seek,seek-2,seek-4');
});

test('analytics: bump counts each name independently', () => {
  const seen = collect();
  A().bump('seek');
  A().bump('toggle');
  A().bump('seek');
  assertEq(seen.join(','), 'seek,toggle,seek-2');
});

test('analytics: bump stops at the 4096 cap', () => {
  const seen = collect();
  for (let i = 0; i < 8192; i++) A().bump('seek');
  assertEq(seen[seen.length - 1], 'seek-4096', 'the last bucket is 4096');
  assertEq(seen.length, 13, 'base plus twelve buckets: 2,4,...,4096');
});

test('analytics: reset clears bump counters', () => {
  collect();
  for (let i = 0; i < 4; i++) A().bump('seek');
  const again = collect();
  A().bump('seek');
  assertEq(again.join(','), 'seek', 'the counter restarted, so the base fires again');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Reload `http://localhost:8777/tests/test.html`.

Expected: the six new `bump` tests FAIL with `A(...).bump is not a function`. Everything else still passes.

- [ ] **Step 3: Write the minimal implementation**

In `lib/analytics.js`, add the constant next to `QUEUE_MAX`:

```js
  const QUEUE_MAX = 50;   // an ad blocker means the sink never arrives; do not grow for ever
  const MAX_BUCKET = 4096;  // bounds the name set no matter how long a session runs
```

Add the function after `once`:

```js
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
```

And add it to the export:

```js
  global.SansAnalytics = { track, once, bump, setSink, reset };
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.

Expected: all tests PASS, `window.__testResults.failed === 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/analytics.js tests/analytics.test.js
git commit -m "Analytics: power-of-two buckets for interaction intensity

Fires the base event at 1 and one event per power-of-two crossing,
capped at 4096. Each row is a session count, so the rows read as a
survival curve -- the distribution itself rather than a summary of it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The GoatCounter transport and its poller

**Files:**
- Modify: `lib/analytics.js`
- Modify: `tests/analytics.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/analytics.test.js`:

```js
test('analytics: watch() installs the GoatCounter sink and drains the queue', async () => {
  A().reset();
  A().track('queued-before-load');

  const got = [];
  window.goatcounter = { count: (vars) => got.push(vars) };
  A().watch();
  await new Promise((r) => setTimeout(r, 500));
  delete window.goatcounter;

  assertEq(got.length, 1, 'the queued event reached GoatCounter');
  assertEq(got[0].path, 'queued-before-load');
  assertEq(got[0].event, true, 'must be sent as an event, not a pageview');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Reload `http://localhost:8777/tests/test.html`.

Expected: FAIL with `A(...).watch is not a function`.

- [ ] **Step 3: Write the minimal implementation**

In `lib/analytics.js`, add the two timing constants:

```js
  const MAX_BUCKET = 4096;  // bounds the name set no matter how long a session runs
  const POLL_MS = 250;      // GoatCounter's docs recommend polling for count()
  const POLL_LIMIT_MS = 10000;   // give up: an ad blocker means it is never coming
```

Add the transport and poller after `setSink`:

```js
  /** The real transport. `title` is empty on purpose. GoatCounter fills it from the
   *  surrounding element or the document title when it is omitted. That is harmless
   *  today — document.title is always the static app.title string — but it would start
   *  leaking the moment someone makes the title dynamic ("<song> — sans_bass" is the
   *  obvious future change). Pinning it to '' means the payload cannot acquire content
   *  by accident. */
  function goatcounterSink(name) {
    global.goatcounter.count({ path: name, title: '', event: true });
  }

  /** Wait for GoatCounter's async script, then hand it the queue.
   *  Restartable, and bounded — a forever-polling interval is a leak on a page that
   *  already holds six AudioBuffers. */
  function watch() {
    if (poller) clearInterval(poller);
    waited = 0;
    poller = setInterval(() => {
      if (global.goatcounter && typeof global.goatcounter.count === 'function') {
        clearInterval(poller);
        poller = 0;
        setSink(goatcounterSink);
        return;
      }
      waited += POLL_MS;
      if (waited >= POLL_LIMIT_MS) { clearInterval(poller); poller = 0; }
    }, POLL_MS);
  }
```

`setSink` must stop a running poller, or a later `watch()` result would overwrite a sink a test installed. Replace `setSink` with:

```js
  /** Install the transport and flush anything that arrived before it existed. */
  function setSink(fn) {
    if (poller) { clearInterval(poller); poller = 0; }
    sink = fn;
    drain();
  }
```

Export `watch` and start it at load:

```js
  global.SansAnalytics = { track, once, bump, setSink, reset, watch };
  watch();
})(window);
```

- [ ] **Step 4: Run the tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`.

Expected: all tests PASS. The load-time `watch()` finds no `window.goatcounter` on the test page and gives up silently after 10 s, which is correct and affects nothing.

- [ ] **Step 5: Commit**

```bash
git add lib/analytics.js tests/analytics.test.js
git commit -m "Analytics: GoatCounter transport with a bounded poller

Sends title:'' explicitly. GoatCounter fills that field from the
surrounding element or the document title when it is omitted -- safe
today, since document.title is a static string, but pinning it means the
payload cannot acquire song names if the title ever becomes dynamic.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Wire into `index.html` and bump to `v1.7.0`

**Files:**
- Modify: `index.html:7,13,131-134`

- [ ] **Step 1: Add the GoatCounter snippet**

In `index.html`, immediately after the `window.SansI18n.init();` script on line 14:

```html
<script>window.SansI18n.init();</script>
<!-- Anonymous, cookieless usage counts. External, so no ?v= -- and https:// rather than
     the protocol-relative //gc.zgo.at from GoatCounter's docs, because versions.test.js
     only skips external URLs that start with "http". -->
<script data-goatcounter="https://sansword.goatcounter.com/count"
        async src="https://gc.zgo.at/count.js"></script>
```

- [ ] **Step 2: Add the analytics script and bump every version tag**

Replace lines 131-134 with:

```html
<script src="lib/stems.js?v=1.7.0"></script>
<script src="lib/unzip.js?v=1.7.0"></script>
<script src="lib/analytics.js?v=1.7.0"></script>
<script src="app.js?v=1.7.0"></script>
<script type="module" src="separate.js?v=1.7.0"></script>
```

Then bump the two remaining tags:

- Line 7: `<link rel="stylesheet" href="styles.css?v=1.7.0">`
- Line 13: `<script src="lib/i18n.js?v=1.7.0"></script>`

- [ ] **Step 3: Bump the other two files**

In `separate.js`, lines 4, 5 and 62:

```js
import { encodeWav } from './lib/wav.js?v=1.7.0';
import { buildZip } from './lib/zip.js?v=1.7.0';
```

```js
  worker = new Worker('separate.worker.js?v=1.7.0', { type: 'module' });
```

In `separate.worker.js`, line 12:

```js
import { N_SAMPLES, STRIDE, segmentStarts, trapezoidWindow, raisedCosineWindow } from './lib/overlap.js?v=1.7.0';
```

- [ ] **Step 4: Verify no version drift remains**

```bash
grep -rn "v=1\.6\.0" index.html separate.js separate.worker.js
```

Expected: no output.

```bash
grep -rn "v=1\.7\.0" index.html separate.js separate.worker.js | wc -l
```

Expected: `11` (7 in `index.html`, 3 in `separate.js`, 1 in `separate.worker.js`).

- [ ] **Step 5: Run the test suite**

Reload `http://localhost:8777/tests/test.html`.

Expected: all tests PASS. In particular `versions: every local asset URL carries a ?v=` and `versions: all three files agree on one version` must pass — if the second fails, a tag was missed; if the first fails, the GoatCounter URL is protocol-relative rather than `https://`.

- [ ] **Step 6: Commit**

```bash
git add index.html separate.js separate.worker.js
git commit -m "Analytics: load GoatCounter and lib/analytics.js; bump to v1.7.0

The GoatCounter tag uses https:// rather than the protocol-relative URL
in their docs -- versions.test.js only exempts external URLs starting
with 'http', so //gc.zgo.at would be flagged as an unversioned local
asset.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Report cache-versus-network from the worker

Whether the model came from Cache Storage is currently knowable only by string-matching the log line `'model loaded from cache'`, which is not a contract.

**Files:**
- Modify: `separate.worker.js:36-75` (`loadModelBytes`) and `separate.worker.js:79-100` (`ensureSession`)

- [ ] **Step 1: Make `loadModelBytes` report the cache hit**

In `separate.worker.js`, add a module-level flag next to `let session = null;`:

```js
let ort = null;
let session = null;
let cancelled = false;
let modelFromCache = null;   // true/false once the model has been obtained; null if supplied
```

In `loadModelBytes`, set it on the cache-hit path:

```js
    const hit = await cache.match(modelUrl);
    if (hit) {
      log('model loaded from cache');
      modelFromCache = true;
      return await hit.arrayBuffer();
    }
```

And on the network path, immediately after the `res.ok` check:

```js
  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
  modelFromCache = false;
```

- [ ] **Step 2: Put it on the `ready` message**

In `ensureSession`, replace the `post` call on line 99:

```js
  post({ type: 'ready', backend, cached: modelFromCache });
```

`modelFromCache` stays `null` when a `modelBuffer` is supplied directly, so the message never claims a cache state it does not know. That path is dead today — the local-`.onnx` picker was removed in v1.3.0, see `docs/behaviour.md` S13 — but the contract should not lie.

- [ ] **Step 3: Verify the message shape by hand**

There is no unit test for the worker; it needs a real model and a real GPU. Verify in the browser instead, in Task 10.

For now, confirm the file parses:

```bash
node --input-type=module --eval "await import('./separate.worker.js')" 2>&1 | head -3
```

Expected: an error mentioning `self is not defined` or `Worker`, which proves it parsed and began executing. A `SyntaxError` means a real problem.

- [ ] **Step 4: Commit**

```bash
git add separate.worker.js
git commit -m "Worker: report cache-vs-network on the ready message

Cache state was only knowable by string-matching a log line. Add an
explicit 'cached' field, left null when a modelBuffer is supplied so the
message never claims a state it does not know.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Separation lifecycle events in `separate.js`

**Files:**
- Modify: `separate.js` (top of file, and the `go` / `cancel` / `save` handlers)

- [ ] **Step 1: Add the null-safe wrappers**

`separate.js` is an ES module and cannot share scope with `app.js`, so it needs its own wrappers — the same way it already carries its own `tr`. Add after the `tr` definition (`separate.js:27`):

```js
const tr = (key, params) => window.SansI18n.t(key, params);

/* Analytics must never be able to break separation. A blocked or missing analytics
 * script degrades to a no-op rather than throwing out of an event handler. */
const gcTrack = (n) => { try { window.SansAnalytics?.track(n); } catch (e) { /* never */ } };
```

- [ ] **Step 2: Fire on the start of a run**

In the `el.go` click handler, immediately after the long-track `confirm` guard passes and before `lastName` is computed:

```js
  lastName = mix.name.replace(/\.[^.]+$/, '');   // "1 基隆路.flac" -> "1 基隆路"
```

becomes:

```js
  gcTrack('separate-start');

  lastName = mix.name.replace(/\.[^.]+$/, '');   // "1 基隆路.flac" -> "1 基隆路"
```

Firing after the `confirm` means a user who backs out of an eight-minute track is not counted as having started one.

- [ ] **Step 3: Fire on the worker's `ready`, `result` and `error` messages**

In `w.onerror`, after `busy(false)`:

```js
  w.onerror = (err) => {
    gcTrack('separate-fail');
    busy(false);
```

In `w.onmessage`, extend the `ready` branch:

```js
    } else if (m.type === 'ready') {
      gcTrack(m.backend === 'webgpu' ? 'separate-backend-webgpu' : 'separate-backend-wasm');
      if (m.cached === true) gcTrack('model-cached');
      else if (m.cached === false) gcTrack('model-download');
      status(m.backend === 'webgpu' ? 'sep.gpu' : 'sep.cpu');
      setProgress(0);
```

The explicit `=== true` / `=== false` is what keeps a `null` (model supplied directly) from firing either event.

Extend the `result` branch:

```js
    } else if (m.type === 'result') {
      gcTrack('separate-done');
      lastStems = m.stems;
```

And the `error` branch:

```js
    } else if (m.type === 'error') {
      gcTrack(m.message === 'cancelled' ? 'separate-cancel' : 'separate-fail');
      busy(false);
      setProgress(null);
      status(m.message === 'cancelled' ? 'sep.cancelled' : 'sep.failed', { msg: m.message });
    }
```

- [ ] **Step 4: Fire on a completed save**

In the `el.save` click handler, inside the `try`, after `status('sep.saved', ...)`:

```js
    status('sep.saved', { mb: (blob.size / MB).toFixed(0) });
    gcTrack('stems-save');
```

Placed after the status line so a failed encode falls into `catch` and is not counted.

- [ ] **Step 5: Verify nothing broke**

Reload `http://localhost:8777/tests/test.html`. Expected: all tests still PASS (this task adds no tests; it must not break existing ones).

Then open `http://localhost:8777/` and confirm the page loads with no console errors.

- [ ] **Step 6: Commit**

```bash
git add separate.js
git commit -m "Analytics: separation lifecycle events

start/done/fail/cancel, the WebGPU-vs-wasm backend split, model cache
hit vs download, and a completed stems save. separate-start fires after
the long-track confirm, so backing out is not counted as a run.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Loading events in `app.js`

**Files:**
- Modify: `app.js:49` (wrappers), `app.js:115-157` (`loadFiles`), `app.js:201-217` (`loadAny`, `loadSong`), `app.js:950-960` (drop handler)

- [ ] **Step 1: Add the null-safe wrappers**

`app.js` wires every listener from one flat run of top-level statements, so a throw takes out everything below it — the v1.4.0 drag-and-drop failure. These wrappers are the same defence as the existing `on()`.

Add after the `tr` definition (`app.js:49`):

```js
const tr = (key, params) => window.SansI18n.t(key, params);

/* Analytics must never be able to break the player. Same reasoning as on() above: a
 * missing window.SansAnalytics (script blocked by an extension, 404 after a bad deploy)
 * must degrade to a no-op, not take out every listener below it. */
const gcTrack = (n) => { try { window.SansAnalytics?.track(n); } catch (e) { /* never */ } };
const gcOnce  = (n) => { try { window.SansAnalytics?.once(n);  } catch (e) { /* never */ } };
const gcBump  = (n) => { try { window.SansAnalytics?.bump(n);  } catch (e) { /* never */ } };
```

- [ ] **Step 2: Thread the load source through `loadFiles`**

`loadFiles` is shared by songs and zips, so the two cannot be told apart inside it. Add a third parameter. Change the signature on `app.js:115`:

```js
async function loadFiles(fileList, fallbackName, source) {
```

Add `load-error` to both failure returns:

```js
  const files = [...fileList].filter(f => AUDIO_RE.test(f.name));
  if (!files.length) { gcTrack('load-error'); say('status.noAudioFiles', null, true); return; }
```

```js
  const loaded = settled.filter(Boolean);
  if (!loaded.length) {
    gcTrack('load-error');
    say('status.decodeFailAll', { names: failed.join(', ') }, true);
    return;
  }
```

And fire the success event immediately after `buildTracks`:

```js
  const items = loaded.map((l) => ({ name: l.file.name, buffer: l.buffer }));
  buildTracks(items, commonName(files, fallbackName));
  gcTrack(source === 'zip' ? 'zip-load' : 'song-load');
```

- [ ] **Step 3: Pass the source from both callers**

In `loadSong` (`app.js:211`), add the reject event and the source:

```js
function loadSong(file) {
  if (!file) return;
  if (!AUDIO_RE.test(file.name)) {
    gcTrack('load-error');
    say('status.notAudioFile', { name: file.name }, true);
    return;
  }
  return loadFiles([file], undefined, 'song');
}
```

In `loadZip` (`app.js:189`), both the extract failure and the empty-zip case are load errors, and the tail call carries the source:

```js
  } catch (err) {
    console.error(err);
    gcTrack('load-error');
```

```js
  if (!entries.length) {
    gcTrack('load-error');
    say('status.noAudioInZip', null, true);
    return;
  }
  return loadFiles(entries.map((e) => ({
    name: e.name,
    webkitRelativePath: e.webkitRelativePath,
    arrayBuffer: async () => e.bytes.buffer,
  })), file.name.replace(/\.zip$/i, ''), 'zip');
```

- [ ] **Step 4: Fire `folder-drop`**

In the `drop` handler, in the `looksLikeFolder` branch:

```js
  if (looksLikeFolder) {
    gcTrack('folder-drop');
    say('status.folderDrop', null, true);
  } else if (dropped.length > 1) {
```

Folder drop is deliberately unsupported and the message is the feature. This event is how you learn whether that decision costs real users.

- [ ] **Step 5: Verify**

Reload `http://localhost:8777/tests/test.html` — all tests PASS.

Then at `http://localhost:8777/`, in the console:

```js
SansAnalytics.setSink(console.log)
```

Load a song from disk. Expected: `song-load` logged once. Load a zip of stems: `zip-load` logged once. Drop a folder: `folder-drop` logged once.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "Analytics: load events, and null-safe wrappers for every call site

loadFiles takes a source parameter because songs and zips share it and
cannot otherwise be told apart. The wrappers exist for the same reason
on() does -- a throw in top-level wiring silently kills every listener
below it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Interaction events in `app.js`

**Files:**
- Modify: `app.js:607` (`toggle`), `app.js:609` (`seek`), `app.js:621` (`setLoopPoint`), `app.js:776` (`toggleAllTracks`), `app.js:815` (`toggleTrack`), and the i18n init site

- [ ] **Step 1: Fire `play` from the user gesture, not from `play()`**

`play()` is re-entered by `seek()` and `refreshLoop()`, so it is not a gesture boundary. `toggle()` is — it backs both the button and the spacebar. Replace `app.js:607`:

```js
function toggle() { playing ? stop(true) : play(); }
```

with:

```js
function toggle() {
  if (!playing) gcOnce('play');   // the bounce gate: did this visitor ever start audio?
  playing ? stop(true) : play();
}
```

- [ ] **Step 2: Fire `seek`**

`seek()` is called by the scrub handler, the arrow keys, and internally by nothing else. Add at the top of `app.js:609`:

```js
function seek(seconds) {
  gcBump('seek');
  const wasPlaying = playing;
```

- [ ] **Step 3: Fire `loop`**

In `setLoopPoint`, after the guard so a press with no track loaded is not counted:

```js
function setLoopPoint(which) {
  if (!tracks.length) return;
  gcBump('loop');
  const t = currentTime();
```

- [ ] **Step 4: Fire `toggle` and `toggle-<stem>`**

Stem ids never translate — the same rule as saved zips — so `t.stem` is used and `laneLabel()` is not. A lane with no recognised stem fires only the generic event, never a name derived from its filename.

At the top of `toggleTrack` (`app.js:815`):

```js
function toggleTrack(t) {
  gcBump('toggle');
  if (t.stem) gcOnce(`toggle-${t.stem}`);   // stem ids, never labels — never a filename
  // The mix lane is the exception: a full-mix file must never sound on top of its own
```

- [ ] **Step 5: Fire `unmute-all`**

At the top of `toggleAllTracks` (`app.js:776`):

```js
function toggleAllTracks() {
  gcOnce('unmute-all');
  if (allLanesOn()) {
```

- [ ] **Step 6: Fire the locale once per session**

At the end of the top-level wiring, next to `renderLangToggle()` (`app.js:866`):

```js
renderLangToggle();
gcOnce(`lang-${window.SansI18n.getLocale()}`);
```

This records the locale the visitor actually landed in. A mid-session switch is not counted again; `once` is per page load.

- [ ] **Step 7: Verify each event fires exactly where expected**

Reload `http://localhost:8777/tests/test.html` — all tests PASS.

At `http://localhost:8777/`, in the console:

```js
SansAnalytics.reset(); SansAnalytics.setSink(console.log)
```

Load a song, then:

| Action | Expected console output |
|---|---|
| press space (start) | `play` |
| press space again (stop), then space again | nothing — `once` |
| click a lane's mute button | `toggle`, then `toggle-bass` (or whichever stem) |
| click the same lane 3 more times | `toggle-2`, `toggle-4` only |
| drag the waveform once | `seek` |
| press `a` then `b` | `loop`, `loop-2` |
| press `0` | `unmute-all` |

Critically: **while playing, drag the waveform.** Expected: `seek` bucket events only, and **no** second `play`. If `play` reappears, the event was attached to `play()` instead of `toggle()`.

- [ ] **Step 8: Commit**

```bash
git add app.js
git commit -m "Analytics: interaction events

play fires from toggle(), not play() -- play() is re-entered by seek()
and refreshLoop(), so it is not a user-gesture boundary. Stem names come
from t.stem and never from laneLabel(), so no filename can reach an
event name.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Documentation

**Files:**
- Modify: `CLAUDE.md` (constraints, gotchas, version count)
- Modify: `docs/behaviour.md`
- Modify: `docs/superpowers/specs/2026-08-21-analytics-design.md` (the three corrections)

- [ ] **Step 1: Amend the constraint in `CLAUDE.md`**

Replace the "Nothing leaves the machine" bullet:

```markdown
- **Nothing leaves the machine.** No audio egress ever. No uploads of user content. One
  cookieless, anonymous usage beacon (GoatCounter) reports **event names only** — never
  audio, never filenames, never song titles. Every event name is a compile-time constant
  or a stem id from a fixed set of seven; see `lib/analytics.js`. Inbound fetches are
  allowed and necessary: the ONNX runtime from jsDelivr and the ~285 MB model from
  Hugging Face. Keep the distinction — "no outbound audio", not "no network calls".
```

- [ ] **Step 2: Fix the version-tag count in `CLAUDE.md`**

In the `?v=<version>` gotcha, the counts are now seven and the version is `v1.7.0`:

```markdown
  Bump the version in `index.html` (7), `separate.js` (3)
  and `separate.worker.js` (1); `tests/versions.test.js` fails if they drift. Currently
  `v1.7.0`.
```

- [ ] **Step 3: Add the analytics gotchas to `CLAUDE.md`**

Add to "Gotchas that will bite again":

```markdown
- **GoatCounter's script tag must be `https://`, not protocol-relative.** Their docs give
  `//gc.zgo.at/count.js`. `tests/versions.test.js` exempts external URLs with
  `url.startsWith('http')`, so a protocol-relative URL is treated as a local asset missing
  its `?v=` and fails the suite.
- **`allow_local` is deliberately not set.** GoatCounter filters localhost and private-IP
  requests, so events fired from `scripts/serve.sh` silently vanish — which looks exactly
  like broken instrumentation. Verify with `SansAnalytics.setSink(console.log)` instead;
  flip `allow_local` only if the network leg itself needs proving, and never commit it.
- **`play` is instrumented in `toggle()`, not `play()`.** `play()` is re-entered by `seek()`
  and `refreshLoop()`, so counting there would fire on every scrub during playback.
- **No event name may carry user content.** Stem ids come from `t.stem`, never
  `laneLabel()`. `title: ''` is passed to GoatCounter explicitly: it fills that field from
  the surrounding element or the document title when omitted. Harmless today, because
  `document.title` is always the static `app.title` string — but making the title dynamic
  (`"<song> — sans_bass"`) is an obvious future change, and it would silently start putting
  song names in the payload. Pin the field rather than relying on the title staying static.
```

- [ ] **Step 4: Document the observable behaviour in `docs/behaviour.md`**

Add a section following the file's existing table format:

```markdown
## Analytics

| # | Behaviour | How to observe |
|---|---|---|
| A1 | Analytics never breaks the player. With `window.SansAnalytics` deleted, every control still works. | `delete window.SansAnalytics` in the console, then load a song, play, seek, toggle a lane. No console errors, no dead listeners. |
| A2 | `play` fires once per page load, from the user gesture only. | `SansAnalytics.reset(); SansAnalytics.setSink(console.log)`, then press space twice and scrub while playing. Exactly one `play`. |
| A3 | Interaction counts emit power-of-two buckets. | Toggle one lane eight times: `toggle`, `toggle-2`, `toggle-4`, `toggle-8` and nothing else. |
| A4 | No event name carries user content. | Load a song with a distinctive filename, exercise every control, and confirm no logged name contains any part of it. |
| A5 | Events fired before GoatCounter loads are not lost. | `SansAnalytics.reset()` (clears the sink), fire events, then `SansAnalytics.setSink(console.log)`. The queued names appear in order. |
| A6 | Events do not reach GoatCounter from localhost. | Expected and deliberate — `allow_local` is not set. Use the sink recipe above to verify locally. |
```

- [ ] **Step 5: Correct the spec**

In `docs/superpowers/specs/2026-08-21-analytics-design.md`, under "Everything that moves in the same commit", replace the `versions.test.js` claim:

```markdown
- **Version bump to `v1.7.0`** across `index.html` (7 tags, including `styles.css`),
  `separate.js` (3) and `separate.worker.js` (1), plus the new `lib/analytics.js?v=1.7.0`.
  `tests/versions.test.js` needs no change: it asserts that every local asset carries a
  `?v=` and that all versions agree, so a new script is picked up automatically. The
  GoatCounter tag must use `https://`, not the protocol-relative URL in GoatCounter's
  docs, or that test treats it as an unversioned local asset.
```

And in the transport section, replace the snippet with the `https://` form and note that `play` is fired from `toggle()`.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/behaviour.md docs/superpowers/specs/2026-08-21-analytics-design.md
git commit -m "Docs: analytics constraints, gotchas, and observable behaviour

Amends the 'nothing leaves the machine' constraint to say what is now
true, and records the four traps: the protocol-relative script tag, the
missing allow_local, play() re-entrancy, and the no-user-content rule.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: End-to-end verification and the devlog

**Files:**
- Modify: `docs/devlog.md`

- [ ] **Step 1: Run the full unit suite one more time**

Reload `http://localhost:8777/tests/test.html`.

Expected: `window.__testResults.failed === 0`. Record the total count for the devlog.

- [ ] **Step 2: Verify the separation events against a real run**

This is the only way to check the worker's `cached` field and the backend split, because neither is reachable from a unit test.

At `http://localhost:8777/`, in the console:

```js
SansAnalytics.reset(); SansAnalytics.setSink(console.log)
```

Load a single unseparated song and click Separate. Expected, in order:

1. `separate-start`
2. `separate-backend-webgpu` (or `separate-backend-wasm` on a machine without WebGPU)
3. `model-download` on the very first run of this browser profile, `model-cached` on every run after
4. `separate-done`

Then click Save. Expected: `stems-save`.

To confirm the cache branch specifically, run it twice: the first run must log `model-download` and the second `model-cached`. If both log `model-download`, Cache Storage is not being written — check the browser is not in a private window.

- [ ] **Step 3: Verify the beacon actually reaches GoatCounter**

`allow_local` is not set, so localhost events are filtered by design and cannot be verified here. Confirm the script itself loads and the automatic pageview fires:

Open DevTools → Network, filter for `gc.zgo.at`, and reload. Expected: `count.js` returns 200. If it is blocked, an extension is filtering it — that is the expected real-world attrition, not a bug.

The event leg gets confirmed after merge, from the dashboard at `https://sansword.goatcounter.com`.

- [ ] **Step 4: Write the devlog entry**

Get the timestamp from the final commit:

```bash
git log -1 --format=%cd --date=format:'%Y-%m-%d %H:%M'
```

Add to `docs/devlog.md`, newest-first, using that timestamp:

```markdown
## v1.7.0 — Usage analytics (YYYY-MM-DD HH:MM)

**Review:** not yet

**Design docs:**
- Usage analytics: [Spec](superpowers/specs/2026-08-21-analytics-design.md) [Plan](superpowers/plans/2026-08-21-analytics.md)

**What was built:**
- `lib/analytics.js` — `track` / `once` / `bump`, its own queue, and the GoatCounter transport.
- Events across the whole surface: loads, load errors, folder drops, the separation
  lifecycle, model cache-vs-download, the WebGPU-vs-wasm split, and interaction intensity.
- `separate.worker.js` now reports `cached` on its `ready` message.
- `tests/analytics.test.js` — 14 unit tests against an injected sink.

**Key technical learnings:**
- `[insight]` Power-of-two buckets fired as they are crossed beat both the alternatives.
  Exclusive buckets need a session-end flush, and GoatCounter documents no `sendBeacon`
  support — so a dropped flush loses the whole session, biased toward mobile. Firing every
  occurrence and taking a mean is the statistic one power user distorts most. Buckets need
  no flush and no assumption about what the dashboard displays.
- `[gotcha]` GoatCounter's documented `//gc.zgo.at/count.js` fails `tests/versions.test.js`.
  That test exempts external URLs with `url.startsWith('http')`, and a protocol-relative URL
  fails it — so the tag is read as a local asset missing its `?v=`. Use `https://`.
- `[gotcha]` `play()` is re-entered by `seek()` and `refreshLoop()`. Instrumenting it counts
  every scrub during playback as a play. `toggle()` is the real gesture boundary.
- `[gotcha]` GoatCounter filters localhost by default, so every event fired from
  `serve.sh` silently vanishes. Indistinguishable from broken instrumentation. The fix is
  not `allow_local` — that pollutes the real dashboard with dev reloads — but the injectable
  sink, which was already there for the tests.
- `[note]` GoatCounter has no queue for calls made before its async script loads; its docs
  recommend polling. `lib/analytics.js` owns a capped queue and a bounded poller instead.
- `[insight]` Pin `title: ''` on every GoatCounter call. It fills that field from the
  document title when omitted, which is safe here only because `document.title` is the
  static `app.title` string. The song name lives in `el.title`, not the document title —
  but "`<song> — sans_bass`" is an obvious future change, and it would quietly start
  shipping song names. The defence costs one property and removes a whole class of
  future leak.
```

Then add the TL;DR row at the top of the file, newest-first:

```markdown
| [v1.7.0](#v170--usage-analytics-YYYY-MM-DD-HHMM) | Cookieless GoatCounter events: loads, separations, and interaction intensity in power-of-two buckets. |
```

Match the anchor to the heading using GitHub's rules (lowercase, punctuation stripped, spaces to hyphens).

- [ ] **Step 5: Commit and open the PR**

```bash
git add docs/devlog.md
git commit -m "Devlog: v1.7.0 usage analytics

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push -u origin feat/analytics
gh pr create --title "Usage analytics: cookieless GoatCounter events (v1.7.0)" --body "$(cat <<'EOF'
## What

Anonymous, cookieless usage analytics via GoatCounter, so the project can tell whether
anyone uses the site and which parts they reach.

- `lib/analytics.js` — `track` (every occurrence), `once` (per page load), `bump`
  (power-of-two buckets), with its own queue and a bounded poller.
- Events across loads, load errors, folder drops, the separation lifecycle, model
  cache-vs-download, the WebGPU-vs-wasm split, and interaction intensity.
- `separate.worker.js` reports `cached` on `ready` instead of hiding it in a log line.

## Privacy

No audio, no filenames, no song titles. Every event name is a compile-time constant or a
stem id from a fixed set of seven. `title: ''` is pinned on every call, because GoatCounter
fills that field from the document title when it is omitted — safe today, but it would
start carrying song names the moment the title becomes dynamic.

The user-facing privacy strings are deliberately unchanged — see the spec for the
rationale. `CLAUDE.md`'s constraint line is updated to say what is now true.

## Verify on the preview

Open the preview, then in the console:

```js
SansAnalytics.reset(); SansAnalytics.setSink(console.log)
```

Load a song, press space, scrub, toggle a lane, press `a`/`b`. Events log locally.
Nothing reaches GoatCounter from a preview URL unless `allow_local` is set, which it
deliberately is not.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

**Spec coverage.** Every event in the spec's two catalogues has a task: lifecycle in Tasks 6–7, interaction in Task 8, `model-*` and `separate-backend-*` in Tasks 5–6. The module API is Tasks 1–3, the queue Task 1, the poller Task 3, the isolation rule Tasks 6–8, the worker change Task 5, testing Tasks 1–3, docs Task 9, verification Task 10. The spec's `allow_local` decision is carried into Task 9 and Task 10 Step 3.

**Naming consistency.** `gcTrack` / `gcOnce` / `gcBump` are the wrapper names in both `app.js` (Task 7 Step 1) and `separate.js` (Task 6 Step 1, `gcTrack` only — the module fires no `once` or `bump` events). `SansAnalytics.watch()` is defined in Task 3 and used only there. `modelFromCache` is the worker's flag throughout Task 5.

**Deliberately not tested by unit tests:** the GoatCounter network call, the worker's `cached` field, and every UI call site. These are browser-observable and covered by Task 10 Step 2 and the `docs/behaviour.md` rows added in Task 9 Step 4 — the same split the project already uses.
