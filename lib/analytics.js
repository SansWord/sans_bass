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
