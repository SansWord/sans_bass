import { test, assert, assertEq, assertClose } from './assert.js';
import { N_SAMPLES, OVERLAP, STRIDE, segmentStarts, trapezoidWindow, raisedCosineWindow }
  from '../lib/overlap.js';

test('overlap: model constants', () => {
  assertEq(N_SAMPLES, 343980, 'segment length fixed by the model');
  assertEq(OVERLAP, 85995, 'quarter-segment overlap');
  assertEq(STRIDE, 257985, 'stride = length - overlap');
});

test('overlap: segment count matches the number of starts', () => {
  // The spike reported "segment 35/34" because the count and the loop disagreed.
  for (const total of [1, N_SAMPLES - 1, N_SAMPLES, N_SAMPLES + 1, 8_837_640]) {
    const starts = segmentStarts(total);
    let counted = 0;
    for (let s = 0; s < total; s += STRIDE) counted++;
    assertEq(starts.length, counted, `count agrees for total=${total}`);
    assertEq(starts[0], 0, 'first segment starts at 0');
    assert(starts[starts.length - 1] < total, 'no segment starts past the end');
  }
});

test('overlap: short input yields exactly one segment', () => {
  assertEq(segmentStarts(1000).length, 1, 'one segment for sub-segment input');
});

for (const [name, make] of [['trapezoid', trapezoidWindow], ['raisedCosine', raisedCosineWindow]]) {
  test(`overlap: ${name} window shape`, () => {
    const w = make();
    assertEq(w.length, N_SAMPLES, 'window length');
    assertClose(w[0], 0, 1e-6, 'fades in from zero');
    assertClose(w[w.length - 1], 0, 1e-6, 'fades out to zero');
    assertClose(w[Math.floor(N_SAMPLES / 2)], 1, 1e-6, 'unity through the middle');
    for (let i = 0; i < 500; i++) {
      const j = Math.floor((i / 500) * N_SAMPLES);
      assert(w[j] >= 0 && w[j] <= 1, `window stays in [0,1] at ${j}`);
      assertClose(w[j], w[N_SAMPLES - 1 - j], 1e-6, `symmetric at ${j}`);
    }
  });
}

test('overlap: windows differ from each other', () => {
  const a = trapezoidWindow();
  const b = raisedCosineWindow();
  // Scan the fade rather than probing one index: at exactly OVERLAP/2 the two curves
  // cross (cos(pi/2) = 0, so both read 0.5) and a single-point check there always fails.
  let maxDiff = 0;
  for (let i = 0; i < OVERLAP; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
  assert(maxDiff > 0.01, `raised cosine is not the trapezoid (max diff ${maxDiff})`);
});
