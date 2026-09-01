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

import { N_SAMPLES, STRIDE, segmentStarts, trapezoidWindow, raisedCosineWindow } from './lib/overlap.js?v=1.16.1';

const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.webgpu.bundle.min.mjs';
const MODEL_URL = 'https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx/resolve/main/htdemucs_6s.onnx';
const MODEL_CACHE = 'sans-bass-htdemucs6s-v1';

/** Model output order. Never index these positionally from outside — map by name. */
const SOURCES = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'];

let ort = null;
let session = null;
let cancelled = false;
let modelFromCache = null;   // true/false once the model has been obtained; null if supplied

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
      modelFromCache = true;
      return await hit.arrayBuffer();
    }
  } catch {
    /* Cache Storage unavailable (private window, quota) — download instead. */
  }

  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
  modelFromCache = false;
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
  post({ type: 'ready', backend, cached: modelFromCache });
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
