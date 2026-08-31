import { test, assert, assertClose } from './assert.js';

const SR = 44100;

function sine(hz, seconds, sampleRate, amp = 0.5) {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

function analyse(channels, sampleRate) {
  return new Promise((resolve, reject) => {
    const w = new Worker('../notes.worker.js?v=1.12.0', { type: 'module' });
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
