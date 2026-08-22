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
