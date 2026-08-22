/* iOS separation spike — worker.
 *
 * Deliberately a near-copy of separate.worker.js rather than an import of it: the point is
 * to vary things production hard-codes (the execution provider, whether the model
 * ArrayBuffer is released, whether the accumulators exist at all) without touching a
 * shipped file. Everything the two DO share — MODEL_URL, MODEL_CACHE, numThreads,
 * graphOptimizationLevel, and lib/overlap.js — is identical on purpose, so a number
 * measured here transfers to the real player.
 *
 * Every risky step announces itself with a {type:'stage'} message BEFORE it runs. The page
 * writes each one to localStorage, so a process kill still leaves a record of which step
 * was in flight. That is the whole reason this file is chatty.
 */

import { N_SAMPLES, STRIDE, segmentStarts, trapezoidWindow } from '../lib/overlap.js?v=1.7.0';

const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.webgpu.bundle.min.mjs';
const MODEL_URL = 'https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx/resolve/main/htdemucs_6s.onnx';
const MODEL_CACHE = 'sans-bass-htdemucs6s-v1';   // same key as production: reuse its cached copy
const SOURCES = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'];
const MB = 1 << 20;

let ort = null;
let session = null;
let sessionBackend = null;

const post = (m) => self.postMessage(m);
const stage = (name) => post({ type: 'stage', name });
const log = (message) => post({ type: 'log', message });
const ms = (t) => `${(performance.now() - t).toFixed(0)} ms`;

/* ---------------------------------------------------------------- ORT + model */

async function loadOrt() {
  if (ort) return ort;
  stage('import ORT from jsDelivr');
  const t = performance.now();
  ort = await import(/* @vite-ignore */ ORT_CDN);
  ort.env.wasm.numThreads = 1;               // identical to production — see CLAUDE.md
  log(`ORT imported in ${ms(t)}`);
  return ort;
}

async function loadModelBytes() {
  stage('open Cache Storage');
  let cache = null;
  try {
    cache = await caches.open(MODEL_CACHE);
    stage('cache.match(model)');
    const hit = await cache.match(MODEL_URL);
    if (hit) {
      stage('hit.arrayBuffer() — materialises 285 MB');
      const t = performance.now();
      const buf = await hit.arrayBuffer();
      log(`model from cache: ${(buf.byteLength / MB).toFixed(1)} MB in ${ms(t)}`);
      return buf;
    }
  } catch (e) {
    log(`Cache Storage unavailable (${e.message}) — downloading`);
  }

  stage('fetch model from Hugging Face');
  const res = await fetch(MODEL_URL);
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
  stage('assemble downloaded model');
  const bytes = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }
  chunks.length = 0;
  if (cache) {
    try {
      stage('cache.put(model)');
      await cache.put(MODEL_URL, new Response(bytes, {
        headers: { 'Content-Type': 'application/octet-stream' },
      }));
    } catch (e) {
      log(`could not cache the model (${e.message})`);
    }
  }
  return bytes.buffer;
}

/**
 * @param backend 'webgpu' | 'wasm' — production tries webgpu then falls back. Here it is
 *   forced, because "does the WASM path survive where WebGPU does not" is the question.
 * @param release  drop the 285 MB ArrayBuffer as soon as the session exists.
 */
async function ensureSession(backend, release) {
  if (session && sessionBackend === backend) return session;
  const rt = await loadOrt();
  let bytes = await loadModelBytes();

  const opts = { graphOptimizationLevel: 'disabled' };   // identical to production
  stage(`InferenceSession.create (${backend}) — model live in JS AND wasm heap`);
  const t = performance.now();
  session = await rt.InferenceSession.create(bytes, { ...opts, executionProviders: [backend] });
  sessionBackend = backend;
  log(`session created on ${backend} in ${ms(t)}`);

  if (release) {
    bytes = null;                    // the only reference; ORT has its own copy in wasm memory
    stage('model ArrayBuffer released');
    log('released the JS-side model ArrayBuffer');
  } else {
    self.__heldModel = bytes;        // deliberately keep it reachable, to measure the delta
    stage('model ArrayBuffer deliberately held');
  }
  return session;
}

/* ---------------------------------------------------------------- synthetic audio */

/** Content is irrelevant to memory and speed; only the length matters. */
function synthetic(seconds) {
  stage(`allocate ${seconds}s of synthetic audio`);
  const n = Math.round(seconds * 44100);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = Math.sin(i * 0.01) * 0.3 + Math.sin(i * 0.0007) * 0.2;
    left[i] = v;
    right[i] = v * 0.8;
  }
  return { left, right };
}

/* ---------------------------------------------------------------- probes */

async function probeSession({ backend, release }) {
  await ensureSession(backend, release);
  stage('session idle — read the memory plateau now');
  log('IDLE. Session is up and nothing else is allocated.');
  log('Let the Timelines graph settle, then read the plateau. This is the fixed floor.');
  post({ type: 'done', probe: 'session', backend });
}

async function probeSegment({ backend, release }) {
  const rt = await loadOrt();
  await ensureSession(backend, release);

  stage('allocate one segment input');
  const x = new Float32Array(2 * N_SAMPLES);
  for (let i = 0; i < N_SAMPLES; i++) {
    x[i] = Math.sin(i * 0.01) * 0.3;
    x[N_SAMPLES + i] = x[i] * 0.8;
  }

  stage('FIRST session.run — compiles every shader, allocates every intermediate');
  const t = performance.now();
  const out = await session.run({
    [session.inputNames[0]]: new rt.Tensor('float32', x, [1, 2, N_SAMPLES]),
  });
  const first = performance.now() - t;
  log(`first run: ${first.toFixed(0)} ms, output ${out[session.outputNames[0]].data.length} floats`);

  stage('SECOND session.run — shaders now cached');
  const t2 = performance.now();
  await session.run({
    [session.inputNames[0]]: new rt.Tensor('float32', x, [1, 2, N_SAMPLES]),
  });
  const second = performance.now() - t2;
  log(`second run: ${second.toFixed(0)} ms  (first run carried ${(first - second).toFixed(0)} ms of compile)`);
  log(`steady-state: ${(N_SAMPLES / 44100 / (second / 1000)).toFixed(2)}x realtime on ${backend}`);
  post({ type: 'done', probe: 'segment', backend, first, second });
}

async function probeLoop({ backend, release, seconds, accumulate }) {
  const rt = await loadOrt();
  await ensureSession(backend, release);

  const { left, right } = synthetic(seconds);
  const total = left.length;
  const starts = segmentStarts(total);
  const window = trapezoidWindow();

  /* accumulate:true reproduces production — 13 full-length fp32 arrays, 2.29 MB per second
   * of song. accumulate:false throws every result away, which is the only way to see the
   * inference cost on its own. */
  let acc = null;
  let weights = null;
  if (accumulate) {
    stage(`allocate accumulators (${((13 * total * 4) / MB).toFixed(0)} MB)`);
    acc = {};
    for (const s of SOURCES) {
      acc[s] = { left: new Float32Array(total), right: new Float32Array(total) };
    }
    weights = new Float32Array(total);
  }

  const x = new Float32Array(2 * N_SAMPLES);
  const times = [];

  for (let seg = 0; seg < starts.length; seg++) {
    const start = starts[seg];
    const clen = Math.min(N_SAMPLES, total - start);
    x.fill(0);
    for (let i = 0; i < clen; i++) {
      x[i] = left[start + i];
      x[N_SAMPLES + i] = right[start + i];
    }

    stage(`session.run segment ${seg + 1}/${starts.length}`);
    const t = performance.now();
    const out = await session.run({
      [session.inputNames[0]]: new rt.Tensor('float32', x, [1, 2, N_SAMPLES]),
    });
    times.push(performance.now() - t);

    if (accumulate) {
      const stems = out[session.outputNames[0]].data;
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
    }

    post({ type: 'progress', segment: seg + 1, total: starts.length, ms: times[times.length - 1] });
  }

  const sum = times.reduce((a, b) => a + b, 0);
  log(`${starts.length} segments in ${(sum / 1000).toFixed(1)}s — ${(seconds / (sum / 1000)).toFixed(2)}x realtime`);
  log(`a 4-minute song would take about ${((240 / seconds) * (sum / 1000) / 60).toFixed(1)} minutes`);
  post({ type: 'done', probe: 'loop', backend, seconds, seconds_taken: sum / 1000 });
}

/* ---------------------------------------------------------------- WebGPU capability */

async function probeGpuLimits() {
  if (!self.navigator?.gpu) { log('navigator.gpu is UNDEFINED — no WebGPU here'); post({ type: 'done', probe: 'gpu-limits' }); return; }
  stage('requestAdapter');
  const adapter = await self.navigator.gpu.requestAdapter();
  if (!adapter) { log('requestAdapter returned null'); post({ type: 'done', probe: 'gpu-limits' }); return; }

  const info = adapter.info || {};
  log(`adapter: vendor=${info.vendor || '?'} arch=${info.architecture || '?'} device=${info.device || '?'}`);
  const keys = ['maxBufferSize', 'maxStorageBufferBindingSize', 'maxUniformBufferBindingSize',
    'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup', 'maxBindGroups'];
  for (const k of keys) {
    const v = adapter.limits[k];
    if (v === undefined) continue;
    log(`  ${k} = ${v > MB ? `${(v / MB).toFixed(0)} MiB` : v}`);
  }
  post({ type: 'done', probe: 'gpu-limits' });
}

/**
 * How much GPU memory will iOS actually hand over? Uses the 'out-of-memory' error scope,
 * which is the sanctioned way to ask — createBuffer itself does not throw for OOM.
 * Still capable of taking the GPU process down, hence its own button and its own stage
 * breadcrumb per step.
 */
async function probeGpuLadder() {
  if (!self.navigator?.gpu) { log('no WebGPU'); post({ type: 'done', probe: 'gpu-ladder' }); return; }
  const adapter = await self.navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const CHUNK = 128 * MB;
  const held = [];
  for (let i = 1; i <= 32; i++) {
    stage(`GPU ladder: allocating buffer ${i} (${i * 128} MiB total)`);
    device.pushErrorScope('out-of-memory');
    const buf = device.createBuffer({ size: CHUNK, usage: GPUBufferUsage.STORAGE });
    const err = await device.popErrorScope();
    if (err) { log(`OOM at ${i * 128} MiB (${err.message || 'GPUOutOfMemoryError'})`); break; }
    held.push(buf);
    log(`  ok: ${i * 128} MiB held`);
  }
  log(`largest total GPU allocation reached: ${held.length * 128} MiB`);
  for (const b of held) b.destroy();
  post({ type: 'done', probe: 'gpu-ladder', mib: held.length * 128 });
}

/* ---------------------------------------------------------------- dispatch */

self.onmessage = async (e) => {
  const m = e.data || {};
  try {
    if (m.probe === 'session') await probeSession(m);
    else if (m.probe === 'segment') await probeSegment(m);
    else if (m.probe === 'loop') await probeLoop(m);
    else if (m.probe === 'gpu-limits') await probeGpuLimits();
    else if (m.probe === 'gpu-ladder') await probeGpuLadder();
    else throw new Error(`unknown probe ${m.probe}`);
  } catch (err) {
    post({ type: 'error', message: err?.message || String(err), stack: String(err?.stack || '').slice(0, 400) });
  }
};
