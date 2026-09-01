import { test, assert, assertEq, assertClose } from './assert.js';

const R = () => window.SansRibbon;

// A melody sitting in C4..G4, plus one 100 ms octave error far below it.
function melodyWithOutlier() {
  const notes = [];
  for (let i = 0; i < 20; i++) {
    notes.push({ start: i * 0.5, end: i * 0.5 + 0.4, midi: 60 + (i % 8), cents: 0, name: '', confidence: 1 });
  }
  notes.push({ start: 10, end: 10.1, midi: 46, cents: 0, name: 'A#2', confidence: 1 });
  return notes;
}

test('ribbon: the range excludes a short octave outlier by default', () => {
  const [lo, hi] = R().pitchRange(melodyWithOutlier());
  assert(lo > 46, `the A#2 blip is outside the range (lo=${lo})`);
  assert(lo <= 60, `the melody's lowest note is inside it (lo=${lo})`);
  assert(hi >= 67, `the melody's highest note is inside it (hi=${hi})`);
});

test('ribbon: clip:false widens the range to hold everything', () => {
  const [lo, hi] = R().pitchRange(melodyWithOutlier(), { clip: false });
  assert(lo < 46, `the outlier is now inside the range (lo=${lo})`);
  assert(hi > 67, `and so is the top (hi=${hi})`);
});

test('ribbon: the range is weighted by duration, not by note count', () => {
  // Forty brief high notes against one long low one. By count the high notes dominate;
  // by time the low note holds the lane for as long as all of them together.
  const notes = [{ start: 0, end: 4, midi: 50, cents: 0, name: '', confidence: 1 }];
  for (let i = 0; i < 40; i++) {
    notes.push({ start: 4 + i * 0.1, end: 4 + i * 0.1 + 0.09, midi: 72, cents: 0, name: '', confidence: 1 });
  }
  const [lo] = R().pitchRange(notes);
  assert(lo <= 50, `the sustained low note stays in range (lo=${lo})`);
});

test('ribbon: an empty note list still yields a usable range', () => {
  const [lo, hi] = R().pitchRange([]);
  assert(hi > lo, 'the range is not degenerate');
  assert(hi - lo >= 6, 'and it is wide enough to draw into');
});

test('ribbon: a single repeated pitch yields a range around it', () => {
  const notes = [{ start: 0, end: 1, midi: 64, cents: 0, name: 'E4', confidence: 1 }];
  const [lo, hi] = R().pitchRange(notes);
  assert(lo < 64 && hi > 64, 'the note sits strictly inside its own range');
});

// A frames object shaped like f0Track's output. `spec` is [centsOrZero, frameCount] pairs.
function fakeFrames(spec, frameSeconds = 128 / 11025) {
  const cents = [];
  for (const [c, n] of spec) for (let i = 0; i < n; i++) cents.push(c);
  const arr = Float32Array.from(cents);
  const t = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) t[i] = i * frameSeconds;
  return { t, f0: new Float32Array(arr.length), conf: new Float32Array(arr.length), cents: arr, frameSeconds };
}

test('ribbon: the contour breaks at an unvoiced run instead of bridging it', () => {
  const segs = R().contourSegments(fakeFrames([[6000, 10], [0, 4], [6400, 10]]), 10);
  assertEq(segs.length, 2, 'one segment either side of the silence');
  assertEq(segs[0].length, 10, 'first run');
  assertEq(segs[1].length, 10, 'second run');
});

test('ribbon: contour points are [timeFraction, midi]', () => {
  const frames = fakeFrames([[6900, 4]]);
  const duration = frames.t[3] + frames.frameSeconds;
  const segs = R().contourSegments(frames, duration);
  assertEq(segs.length, 1, 'one continuous run');
  const [tf, midi] = segs[0][0];
  assertClose(tf, 0, 1e-9, 'the first frame sits at the start of the lane');
  assertClose(midi, 69, 1e-6, '6900 cents is MIDI 69');
  assert(segs[0][3][0] > 0 && segs[0][3][0] <= 1, 'later frames stay within the lane');
});

test('ribbon: an all-unvoiced track yields no segments', () => {
  assertEq(R().contourSegments(fakeFrames([[0, 20]]), 10).length, 0, 'nothing to draw');
});

test('ribbon: a leading silence does not produce an empty segment', () => {
  const segs = R().contourSegments(fakeFrames([[0, 5], [6000, 5]]), 10);
  assertEq(segs.length, 1, 'exactly one segment');
  assert(segs[0].length > 0, 'and it is not empty');
});

/* At whole-song width a pixel spans ~26 frames, and a polyline between them draws
 * near-vertical strokes across the whole lane — the contour becomes a smear that buries
 * the notes. Waveforms solve this with per-pixel min/max; so does this. */

test('ribbon: contourColumns aggregates many frames into one column', () => {
  // 40 frames of a rising line, into 4 columns.
  const spec = [];
  for (let i = 0; i < 40; i++) spec.push([5000 + i * 25, 1]);
  const cols = R().contourColumns(fakeFrames(spec), 40 * (128 / 11025), 4);
  assertEq(cols.length, 4, 'one entry per pixel column');
  for (const c of cols) {
    if (!c) continue;
    assert(c.hi >= c.lo, 'each column spans a range');
  }
  const voiced = cols.filter(Boolean);
  assert(voiced.length === 4, 'every column has voiced content here');
  assert(voiced[3].lo > voiced[0].lo, 'the range climbs with the line');
});

test('ribbon: contourColumns reports an unvoiced column as null', () => {
  // Voiced, then a long silence, then voiced — into 3 columns.
  const cols = R().contourColumns(fakeFrames([[6000, 10], [0, 10], [6400, 10]]), 30 * (128 / 11025), 3);
  assertEq(cols.length, 3, 'three columns');
  assertEq(cols[1], null, 'the silent middle column is null, not zero');
  assert(cols[0] && cols[2], 'the voiced columns either side survive');
});

test('ribbon: contourColumns keeps an octave error visible as a tall column', () => {
  // A steady A#3 with one frame an octave down: that column must span the octave.
  const spec = [[5800, 5], [4600, 1], [5800, 5]];
  const cols = R().contourColumns(fakeFrames(spec), 11 * (128 / 11025), 1);
  assertEq(cols.length, 1, 'one column');
  assert(cols[0].hi - cols[0].lo > 10, `the column spans the octave error (${(cols[0].hi - cols[0].lo).toFixed(1)} semitones)`);
});

/* The lane peaks are 1400 buckets across the WHOLE song. Slice 10 s out of a 233 s track
 * and you get 60 buckets — blockier than the thing the zoom exists to make readable. The
 * zoomed view needs its own resolution. */

test('ribbon: zoomPeaks resolves at the requested buckets per second', () => {
  const SR = 44100;
  const ch = new Float32Array(SR * 2);            // 2 seconds
  for (let i = 0; i < ch.length; i++) ch[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR);
  const p = R().zoomPeaks(ch, SR, 80);
  assertEq(p.bps, 80, 'buckets per second is reported back');
  assertEq(p.mins.length, 160, '2 s at 80 buckets/s');
  assertEq(p.maxs.length, 160, 'both envelopes');
  assert(p.maxs[40] > 0.4 && p.mins[40] < -0.4, 'a full-scale sine fills its bucket');
});

test('ribbon: zoomPeaks marks a silent stretch as empty', () => {
  const SR = 44100;
  const ch = new Float32Array(SR);                // one second of digital silence
  const p = R().zoomPeaks(ch, SR, 80);
  assert(p.maxs.every((v) => v === 0) && p.mins.every((v) => v === 0), 'silence reads as zero');
});

test('ribbon: zoomWindow clamps to the song and keeps its width', () => {
  // Hard against the start: the window must slide, not shrink.
  const a = R().zoomWindow(1, 10, 200);
  assertClose(a.to - a.from, 10, 1e-9, 'width preserved at the start');
  assertClose(a.from, 0, 1e-9, 'and it does not run off the front');

  const b = R().zoomWindow(199, 10, 200);
  assertClose(b.to - b.from, 10, 1e-9, 'width preserved at the end');
  assertClose(b.to, 200, 1e-9, 'and it does not run off the back');

  const c = R().zoomWindow(100, 10, 200);
  assertClose(c.from, 95, 1e-9, 'centred in the middle');
  assertClose(c.to, 105, 1e-9, 'centred in the middle');
});

test('ribbon: zoomWindow handles a window wider than the song', () => {
  const r = R().zoomWindow(5, 60, 20);
  assertClose(r.from, 0, 1e-9, 'starts at zero');
  assertClose(r.to, 20, 1e-9, 'ends at the song end rather than past it');
});
