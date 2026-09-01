import { test, assert, assertClose } from './assert.js';
import { onsetEnvelope } from '../lib/tempo.js';

// A train of short full-scale bursts every `periodSec`, `totalSec` long.
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

test('tempo: onsetEnvelope peaks near every click', () => {
  const sr = 44100;
  const period = 0.5;
  const sig = clickTrain(sr, period, 3);
  const { env, hopSeconds } = onsetEnvelope([sig], sr);
  assert(env.length > 100, `envelope has content (${env.length} hops)`);
  for (let t = 0; t < 3; t += period) {
    const h = Math.round(t / hopSeconds);
    let localMax = 0;
    for (let i = Math.max(0, h - 3); i <= Math.min(env.length - 1, h + 3); i++) {
      localMax = Math.max(localMax, env[i]);
    }
    assert(localMax > 0.1, `a peak appears near hop ${h} (t=${t.toFixed(2)}s)`);
  }
});

test('tempo: onsetEnvelope reports its actual hop spacing', () => {
  const sr = 44100;
  const { hopSeconds } = onsetEnvelope([new Float32Array(sr)], sr, { hopSeconds: 0.01 });
  assert(Math.abs(hopSeconds - 0.01) < 0.001, `hop stays close to the requested 10ms (got ${hopSeconds})`);
});

test('tempo: onsetEnvelope on digital silence is all zero', () => {
  const sr = 44100;
  const { env } = onsetEnvelope([new Float32Array(sr)], sr);
  assert(env.every((v) => v === 0), 'no energy, no flux');
});

test('tempo: onsetEnvelope downmixes multiple channels', () => {
  const sr = 44100;
  const sig = clickTrain(sr, 0.5, 2);
  const mono = onsetEnvelope([sig], sr);
  const stereo = onsetEnvelope([sig, sig], sr);
  assertClose(stereo.env[10] ?? 0, mono.env[10] ?? 0, 1e-6, 'identical channels average to the same envelope');
});
