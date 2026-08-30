import { test, assert, assertEq, assertClose } from './assert.js';
import { centsFromHz, hzFromCents, midiFromCents, noteName } from '../lib/pitch.js';

test('pitch: cents anchor on A4 = 440 Hz = MIDI 69', () => {
  assertClose(centsFromHz(440), 6900, 1e-6, 'A4');
  assertClose(centsFromHz(880), 8100, 1e-6, 'an octave up is +1200 cents');
  assertClose(centsFromHz(220), 5700, 1e-6, 'an octave down is -1200 cents');
});

test('pitch: hzFromCents inverts centsFromHz', () => {
  for (const hz of [82.41, 220, 440, 1046.5]) {
    assertClose(hzFromCents(centsFromHz(hz)), hz, 1e-6, `round trip ${hz}`);
  }
});

test('pitch: midiFromCents rounds to the nearest semitone', () => {
  assertEq(midiFromCents(6900), 69, 'exactly A4');
  assertEq(midiFromCents(6949), 69, '49 cents sharp is still A4');
  assertEq(midiFromCents(6951), 70, '51 cents sharp rounds up');
});

test('pitch: noteName spells MIDI numbers with octaves', () => {
  assertEq(noteName(69), 'A4', 'concert A');
  assertEq(noteName(60), 'C4', 'middle C');
  assertEq(noteName(40), 'E2', 'guitar low E');
  assertEq(noteName(61), 'C#4', 'sharps, never flats');
});

import { lowpassKernel, decimate } from '../lib/pitch.js';

// RMS over the interior only — an FIR's first and last taps see zero-padding, and those
// edge samples would otherwise drag the measured level down and fail a correct filter.
function interiorRms(a, skip) {
  let s = 0;
  let n = 0;
  for (let i = skip; i < a.length - skip; i++) { s += a[i] * a[i]; n++; }
  return Math.sqrt(s / n);
}

function sine(hz, seconds, sampleRate, amp = 0.5) {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

test('pitch: lowpass kernel has unity DC gain and is symmetric', () => {
  const k = lowpassKernel(63, 5000, 44100);
  assertEq(k.length, 63, 'tap count');
  let sum = 0;
  for (let i = 0; i < k.length; i++) sum += k[i];
  assertClose(sum, 1, 1e-5, 'taps sum to 1, so DC passes at unity');
  for (let i = 0; i < 31; i++) assertClose(k[i], k[62 - i], 1e-9, `symmetric at ${i}`);
});

test('pitch: decimate reports the decimated rate and length', () => {
  const { samples, sampleRate } = decimate([sine(300, 1, 44100)], 44100);
  assertEq(sampleRate, 11025, 'four times down from 44.1 kHz');
  assertEq(samples.length, Math.floor(44100 / 4), 'one output sample per four input');
});

test('pitch: decimate passes 300 Hz and rejects 8 kHz', () => {
  const pass = decimate([sine(300, 1, 44100)], 44100).samples;
  const stop = decimate([sine(8000, 1, 44100)], 44100).samples;
  // 0.5-amplitude sine has RMS 0.3536.
  assertClose(interiorRms(pass, 200), 0.3536, 0.02, '300 Hz survives the passband');
  assert(interiorRms(stop, 200) < 0.035, '8 kHz is attenuated by at least 20 dB');
});

test('pitch: decimate averages channels to mono', () => {
  const n = 44100;
  const left = sine(300, 1, 44100, 0.5);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) right[i] = -left[i];   // exact anti-phase
  const { samples } = decimate([left, right], 44100);
  assert(interiorRms(samples, 200) < 1e-6, 'anti-phase channels cancel to silence');
});

import { yinFrame } from '../lib/pitch.js';

test('pitch: yinFrame resolves sines across the whole search range', () => {
  const SR = 11025;
  // 20 cents is a fifth of a semitone. Parabolic interpolation over the CMND curve has a
  // small systematic bias, worst at the top of the range where a period is only ~10
  // samples, so a 1-cent assertion would be flaky without being any more convincing.
  for (const hz of [82.41, 220, 440, 1046.5]) {
    const buf = sine(hz, 0.2, SR);
    const r = yinFrame(buf, 0, SR);
    assertClose(centsFromHz(r.f0), centsFromHz(hz), 20, `${hz} Hz within 20 cents`);
    assert(r.confidence > 0.9, `${hz} Hz reads as strongly periodic (${r.confidence})`);
  }
});

test('pitch: yinFrame reports low confidence on noise', () => {
  const buf = new Float32Array(1024);
  let seed = 12345;
  for (let i = 0; i < buf.length; i++) {
    // Math.imul, not *: a 32-bit LCG product exceeds 2^53 and loses precision as a double.
    // Deterministic on purpose — a Math.random() buffer would make this test able to flake.
    seed = (Math.imul(seed, 1103515245) + 12345) | 0;
    buf[i] = ((seed >>> 8) / 0x800000) - 1;
  }
  assert(yinFrame(buf, 0, 11025).confidence < 0.5, 'white noise is not periodic');
});

test('pitch: yinFrame reports zero confidence on silence', () => {
  const r = yinFrame(new Float32Array(1024), 0, 11025);
  assertClose(r.confidence, 0, 1e-6, 'digital silence has no periodicity to find');
});

import { f0Track, medianFilterVoiced } from '../lib/pitch.js';

test('pitch: medianFilterVoiced removes an isolated outlier', () => {
  const cents = Float32Array.from([5000, 5000, 6200, 5000, 5000]);
  medianFilterVoiced(cents, 5);
  assertClose(cents[2], 5000, 1e-6, 'the octave jump is replaced by its neighbours');
});

test('pitch: medianFilterVoiced leaves unvoiced frames unvoiced', () => {
  const cents = Float32Array.from([5000, 0, 5000, 5000, 5000]);
  medianFilterVoiced(cents, 5);
  assertClose(cents[1], 0, 1e-6, 'zero is the unvoiced sentinel and must survive');
});

test('pitch: f0Track tracks a steady tone', () => {
  const SR = 11025;
  const track = f0Track(sine(220, 1, SR), SR);
  assert(track.cents.length > 60, `enough frames for one second (${track.cents.length})`);
  assertClose(track.frameSeconds, 128 / SR, 1e-9, 'frame spacing is hop / rate');
  const voiced = [...track.cents].filter((c) => c !== 0);
  assert(voiced.length > track.cents.length * 0.9, 'a pure tone is voiced nearly everywhere');
  for (const c of voiced) assertClose(c, centsFromHz(220), 20, 'every voiced frame reads A3');
});

test('pitch: f0Track marks silence unvoiced', () => {
  const track = f0Track(new Float32Array(11025), 11025);
  assert([...track.cents].every((c) => c === 0), 'nothing in silence is voiced');
});
