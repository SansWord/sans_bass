import { test, assert, assertClose, assertEq } from './assert.js';
import { onsetEnvelope, estimateTempo } from '../lib/tempo.js';

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

test('tempo: estimateTempo recovers a steady click BPM, or a clean 2x/half multiple', () => {
  const sr = 44100;
  const bpm = 128;
  const period = 60 / bpm;
  const sig = clickTrain(sr, period, 8);
  const { env, hopSeconds } = onsetEnvelope([sig], sr);
  const { bpmValue, confidence } = estimateTempo(env, hopSeconds);
  const ratio = bpmValue / bpm;
  const isCleanMultiple = [0.5, 1, 2].some((k) => Math.abs(ratio - k) < 0.03);
  assert(isCleanMultiple, `${bpmValue.toFixed(1)} BPM is a clean multiple of ${bpm}`);
  assert(confidence > 0.2, `confidence is meaningfully above zero (${confidence.toFixed(2)})`);
});

test('tempo: estimateTempo recovers the phase offset modulo the period', () => {
  const sr = 44100;
  const bpm = 100;
  const period = 60 / bpm;
  const offsetSec = 0.15;
  const full = clickTrain(sr, period, 6);
  const shifted = new Float32Array(full.length + Math.round(sr * offsetSec));
  shifted.set(full, Math.round(sr * offsetSec));
  const { env, hopSeconds } = onsetEnvelope([shifted], sr);
  const { phaseSec } = estimateTempo(env, hopSeconds);
  const mod = ((phaseSec % period) + period) % period;
  const target = ((offsetSec % period) + period) % period;
  const diff = Math.min(Math.abs(mod - target), period - Math.abs(mod - target));
  assert(diff < 0.03, `phase matches the offset modulo the period (got ${mod.toFixed(3)}, want ${target.toFixed(3)})`);
});

test('tempo: estimateTempo on an empty envelope returns a safe default', () => {
  const { bpmValue, phaseSec, confidence } = estimateTempo(new Float32Array(0), 0.01);
  assert(bpmValue > 0, 'never zero or NaN');
  assertEq(phaseSec, 0, 'no phase to report');
  assertEq(confidence, 0, 'no confidence to report');
});
