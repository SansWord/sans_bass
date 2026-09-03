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
 * ESM, no window bridge — separate.js and app.js both import it directly. */
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
