import { test, assertEq } from './assert.js';
import { chromaFromAudio, matchChordTemplate } from '../lib/chroma.js';

const SR = 44100;
function sine(hz, seconds, amp = 0.3) {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
}
function peak(chroma) {
  let result = 0;
  for (let i = 1; i < 12; i++) if (chroma[i] > chroma[result]) result = i;
  return result;
}
function chromaAt(pcs) {
  const chroma = new Float32Array(12);
  for (const pc of pcs) chroma[pc] = 1;
  return chroma;
}

test('chroma: A4 and A5 fold to pitch class A', () => {
  assertEq(peak(chromaFromAudio(sine(440, 1), SR, 0, 1)), 9);
  assertEq(peak(chromaFromAudio(sine(880, 1), SR, 0, 1)), 9);
});

test('chroma: silence and sub-threshold audio return zeroes', () => {
  for (const samples of [new Float32Array(SR), sine(440, 1, Math.pow(10, -60 / 20))]) {
    const chroma = chromaFromAudio(samples, SR, 0, 1);
    for (const bin of chroma) assertEq(bin, 0);
  }
});

for (const [name, pcs, quality] of [
  ['C major', [0, 4, 7], 'maj'], ['C minor', [0, 3, 7], 'min'],
  ['C7', [0, 4, 7, 10], '7'], ['Cm7', [0, 3, 7, 10], 'min7'],
  ['Csus2', [0, 2, 7], 'sus2'], ['Csus4', [0, 5, 7], 'sus4'],
]) {
  test(`chroma: ${name} template matches`, () => {
    const match = matchChordTemplate(chromaAt(pcs));
    assertEq(match.rootPc, 0);
    assertEq(match.quality, quality);
  });
}

test('chroma: zero chroma has no template match', () => {
  assertEq(matchChordTemplate(new Float32Array(12)), null);
});
