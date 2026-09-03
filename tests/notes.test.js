import { test, assert, assertClose, assertEq } from './assert.js';
import { interpret } from '../lib/pitch.js';

const SR = 44100;

function sine(hz, seconds, sampleRate, amp = 0.5) {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

function clickTrain(sampleRate, periodSec, totalSec, clickSec = 0.02, amp = 1) {
  const n = Math.round(sampleRate * totalSec);
  const out = new Float32Array(n);
  const period = Math.round(sampleRate * periodSec);
  const clickLen = Math.round(sampleRate * clickSec);
  for (let start = 0; start < n; start += period) {
    for (let i = 0; i < clickLen && start + i < n; i++) out[start + i] = amp;
  }
  return out;
}

// Unlike analyse(), resolves the WHOLE message — needed to see `tempo` alongside `frames`,
// or to see a standalone `{ type: 'tempo' }` reply that carries no `frames` at all.
function roundTrip(message) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../notes.worker.js', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => { w.terminate(); reject(new Error('worker never answered')); }, 20000);
    w.onmessage = (e) => { clearTimeout(timer); w.terminate(); resolve(e.data); };
    w.onerror = (e) => { clearTimeout(timer); w.terminate(); reject(new Error(e.message)); };
    w.postMessage(message);
  });
}

function analyse(channels, sampleRate) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../notes.worker.js', import.meta.url), { type: 'module' });
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

/* The worker builds its message from an explicit field list, so every array the
 * interpreters need has to be named there. `candidates` was missing at first and
 * hmm-v1 threw on `undefined.length` in the app while every unit test stayed green —
 * the pure functions never crossed the postMessage boundary. */
test('notes: the worker carries candidates across postMessage', async () => {
  const frames = await analyse([sine(220, 1.5, SR)], SR);
  assert(Array.isArray(frames.candidates), 'candidates survive the structured clone');
  assert(frames.candidates.length === frames.cents.length, 'one entry per frame');
  const voicedIdx = [...frames.cents].findIndex((c) => c !== 0);
  const c = frames.candidates[voicedIdx][0];
  assert(c && typeof c.cents === 'number' && typeof c.p === 'number',
    'a candidate arrives as a usable {cents, p} object, not a stringified husk');
});

import { BASS_RANGE } from '../lib/pitch.js';

test('notes: analyse threads an optional range into f0Track', async () => {
  const hz = 41.2;   // open E1 - below YIN_DEFAULTS' 79.9 Hz floor
  const withoutRange = await analyse([sine(hz, 1.5, SR)], SR);
  const data = await roundTrip({
    type: 'analyse', channels: [sine(hz, 1.5, SR)], sampleRate: SR, range: BASS_RANGE,
  });
  const voicedWithout = [...withoutRange.cents].filter((c) => c !== 0).length;
  const voicedWith = [...data.frames.cents].filter((c) => c !== 0).length;
  assert(voicedWith > voicedWithout,
    `a wider range finds far more voiced frames for a low tone the default misses (${voicedWith} vs ${voicedWithout})`);
});

test('notes: analyse with a drums buffer returns tempo alongside frames', async () => {
  const bpm = 120;
  const period = 60 / bpm;
  const data = await roundTrip({
    type: 'analyse',
    channels: [sine(220, 1, SR)],
    sampleRate: SR,
    drums: { channels: [clickTrain(SR, period, 4)], sampleRate: SR },
  });
  assert(data.frames, 'vocals frames still come back');
  assert(data.tempo, 'tempo comes back alongside frames');
  const ratio = data.tempo.bpmValue / bpm;
  assert([0.5, 1, 2].some((k) => Math.abs(ratio - k) < 0.05),
    `tempo is a clean multiple of ${bpm} (got ${data.tempo.bpmValue.toFixed(1)})`);
});

test('notes: analyse without a drums buffer returns tempo: null', async () => {
  const data = await roundTrip({ type: 'analyse', channels: [sine(220, 1, SR)], sampleRate: SR });
  assert(data.frames, 'vocals frames still come back');
  assertEq(data.tempo, null, 'no drums, no tempo');
});

test('notes: a standalone tempo request answers without running vocals analysis', async () => {
  const bpm = 100;
  const period = 60 / bpm;
  const data = await roundTrip({
    type: 'tempo', channels: [clickTrain(SR, period, 4)], sampleRate: SR,
  });
  assertEq(data.type, 'tempo', 'a dedicated tempo reply, not frames');
  assert(!('frames' in data), 'no vocals analysis ran');
  const ratio = data.tempo.bpmValue / bpm;
  assert([0.5, 1, 2].some((k) => Math.abs(ratio - k) < 0.05),
    `tempo is a clean multiple of ${bpm} (got ${data.tempo.bpmValue.toFixed(1)})`);
});

test('notes: interpret() output is byte-identical regardless of tempo state', async () => {
  const frames = await analyse([sine(220, 0.4, SR), sine(0, 0.1, SR), sine(330, 0.4, SR)].reduce(
    (acc, seg) => { const out = new Float32Array(acc.length + seg.length); out.set(acc); out.set(seg, acc.length); return out; },
    new Float32Array(0),
  ), SR);
  // interpret() has never heard of tempo — there is no tempo argument to pass it at all.
  // This test exists to make that structural guarantee explicit and regression-proof: any
  // future change that threads tempo into interpret()'s signature breaks this call shape.
  const params = { interpreter: 'threshold-v1', params: { minDurationMs: 80 } };
  const a = interpret(frames, params);
  const b = interpret(frames, params);
  assertEq(JSON.stringify(a), JSON.stringify(b), 'identical params, identical output, independent of any global tempo state');
  assertEq(interpret.length, 2, 'interpret() takes exactly (track, interpretation) — no tempo parameter exists to accidentally wire up');
});
