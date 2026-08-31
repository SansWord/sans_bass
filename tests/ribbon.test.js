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
