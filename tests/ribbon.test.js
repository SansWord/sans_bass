import { test, assert, assertEq, assertClose } from './assert.js';
import * as SansRibbon from '../lib/ribbon.js';

const R = () => SansRibbon;

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

test('ribbon: beatTimes spaces beats by the BPM period', () => {
  // 120 BPM = 0.5s/beat
  const beats = R().beatTimes({ bpmValue: 120, phaseMs: 0, beatsPerBar: 4 }, 2);
  assertEq(beats.length, 5, '0, 0.5, 1, 1.5, 2');
  assertClose(beats[1].t, 0.5, 1e-9, 'second beat at 0.5s');
  assertClose(beats[4].t, 2, 1e-9, 'last beat sits on the duration boundary');
});

test('ribbon: beatTimes flags every beatsPerBar-th beat as a bar', () => {
  const beats = R().beatTimes({ bpmValue: 120, phaseMs: 0, beatsPerBar: 3 }, 3);
  assertEq(beats[0].bar, true, 'first beat is a bar');
  assertEq(beats[1].bar, false);
  assertEq(beats[2].bar, false);
  assertEq(beats[3].bar, true, 'every third beat is a bar');
});

test('ribbon: beatTimes normalises a phase outside [0, period)', () => {
  const inRange = R().beatTimes({ bpmValue: 120, phaseMs: 100, beatsPerBar: 4 }, 1);
  const negative = R().beatTimes({ bpmValue: 120, phaseMs: 100 - 500, beatsPerBar: 4 }, 1);
  const overOne = R().beatTimes({ bpmValue: 120, phaseMs: 100 + 500, beatsPerBar: 4 }, 1);
  assertClose(inRange[0].t, 0.1, 1e-9, 'phase already in range starts the grid there');
  assertClose(negative[0].t, 0.1, 1e-9, 'a negative phase normalises to the same first beat');
  assertClose(overOne[0].t, 0.1, 1e-9, 'a phase past one period normalises the same way');
});

test('ribbon: beatTimes returns nothing when duration is shorter than the first beat', () => {
  // 60 BPM = 1000ms period; phase 900ms means the first beat is at 0.9s.
  const beats = R().beatTimes({ bpmValue: 60, phaseMs: 900, beatsPerBar: 4 }, 0.5);
  assertEq(beats.length, 0, 'the first beat never arrives inside a 0.5s song');
});

test('ribbon: beatTimes tolerates a missing or zero bpmValue', () => {
  assertEq(R().beatTimes(null, 10).length, 0, 'no tempo, no grid');
  assertEq(R().beatTimes({ bpmValue: 0, phaseMs: 0, beatsPerBar: 4 }, 10).length, 0, 'zero BPM would divide by zero');
});

test('ribbon: subdivisionTimes(2) returns only the half-beat midpoints', () => {
  // 120 BPM = 0.5s/beat, so the midpoint of each beat is 0.25s later.
  const halves = R().subdivisionTimes({ bpmValue: 120, phaseMs: 0, beatsPerBar: 4 }, 1, 2);
  assertEq(halves.length, 2, 'midpoints at 0.25 and 0.75, not the on-beat points at 0/0.5/1');
  assertClose(halves[0], 0.25, 1e-9);
  assertClose(halves[1], 0.75, 1e-9);
});

test('ribbon: subdivisionTimes(4) returns the two true quarters plus the midpoint', () => {
  const quarters = R().subdivisionTimes({ bpmValue: 120, phaseMs: 0, beatsPerBar: 4 }, 0.5, 4);
  assertEq(quarters.length, 3, '0.125, 0.25, 0.375 within the first beat');
  assertClose(quarters[0], 0.125, 1e-9);
  assertClose(quarters[1], 0.25, 1e-9, 'includes the half-beat point');
  assertClose(quarters[2], 0.375, 1e-9);
});

test('ribbon: subdivisionTimes excludes on-beat points', () => {
  const quarters = R().subdivisionTimes({ bpmValue: 120, phaseMs: 0, beatsPerBar: 4 }, 2, 4);
  for (const t of quarters) {
    assert(Math.abs(t % 0.5) > 1e-9 && Math.abs((t % 0.5) - 0.5) > 1e-9, `${t} lands on a beat`);
  }
});

test('ribbon: subdivisionTimes tolerates a missing tempo or a division below 2', () => {
  assertEq(R().subdivisionTimes(null, 10, 2).length, 0, 'no tempo, no grid');
  assertEq(R().subdivisionTimes({ bpmValue: 120, phaseMs: 0, beatsPerBar: 4 }, 10, 1).length, 0, 'divisionsPerBeat < 2 is meaningless');
});

test('ribbon: snapToGrid(1) snaps to the nearest beat', () => {
  // 120 BPM = 0.5s/beat, on-beat at 0, 0.5, 1, 1.5, ...
  const tempo = { bpmValue: 120, phaseMs: 0, beatsPerBar: 4 };
  assertClose(R().snapToGrid(tempo, 0.62, 1), 0.5, 1e-9, 'closer to 0.5 than 1.0');
  assertClose(R().snapToGrid(tempo, 0.76, 1), 1.0, 1e-9, 'closer to 1.0 than 0.5');
});

test('ribbon: snapToGrid respects divisionsPerBeat (half/quarter)', () => {
  const tempo = { bpmValue: 120, phaseMs: 0, beatsPerBar: 4 };
  assertClose(R().snapToGrid(tempo, 0.2, 2), 0.25, 1e-9, 'half-beat grid at 0.25 steps');
  assertClose(R().snapToGrid(tempo, 0.15, 4), 0.125, 1e-9, 'quarter-beat grid at 0.125 steps');
});

test('ribbon: snapToGrid normalises a phase outside [0, period)', () => {
  const inRange = R().snapToGrid({ bpmValue: 120, phaseMs: 100, beatsPerBar: 4 }, 0.11, 1);
  const negative = R().snapToGrid({ bpmValue: 120, phaseMs: 100 - 500, beatsPerBar: 4 }, 0.11, 1);
  assertClose(inRange, 0.1, 1e-9);
  assertClose(negative, 0.1, 1e-9, 'a phase pushed negative still lands on the same grid');
});

test('ribbon: snapToGrid tolerates a missing or zero bpmValue', () => {
  assertEq(R().snapToGrid(null, 0.62, 1), 0.62, 'no tempo, no snap');
  assertEq(R().snapToGrid({ bpmValue: 0, phaseMs: 0, beatsPerBar: 4 }, 0.62, 1), 0.62, 'zero BPM would divide by zero');
});

// snapNotesToGrid — the batch-snap primitive behind the Snap-range/Whole-song buttons.
// 120 BPM = 0.5s/beat throughout, so beat lines sit at 0, 0.5, 1, 1.5, 2, ...
//
// No overlap-avoidance logic here: snapToGrid rounds to the NEAREST grid point, and nearest-
// rounding is monotonic non-decreasing (t1 <= t2 implies snap(t1) <= snap(t2)), so two notes
// that don't already overlap can never end up overlapping purely from independently snapping
// their edges — round(noteA.end) <= round(noteB.start) whenever noteA.end <= noteB.start, for
// any BPM/phase/division. The only real edge case is a single SHORT note whose own two edges
// round to the same grid point, which the MIN_DUR floor below covers.

const TEMPO_120 = { bpmValue: 120, phaseMs: 0, beatsPerBar: 4 };
const n = (start, end, midi) => ({ start, end, midi });

test('ribbon: snapNotesToGrid leaves an already-on-grid note out of the result', () => {
  const out = R().snapNotesToGrid([n(0.5, 1.0, 60)], TEMPO_120, 1, null);
  assertEq(out.length, 0, 'nothing moved, nothing reported');
});

test('ribbon: snapNotesToGrid snaps an off-grid note to its nearest beats', () => {
  const out = R().snapNotesToGrid([n(0.62, 1.4, 60)], TEMPO_120, 1, null);
  assertEq(out.length, 1);
  assertClose(out[0].newStart, 0.5, 1e-9);
  assertClose(out[0].newEnd, 1.5, 1e-9);
});

test('ribbon: snapNotesToGrid ignores notes outside the given range', () => {
  const notes = [n(0.62, 0.9, 60), n(5.6, 5.9, 62)];
  const out = R().snapNotesToGrid(notes, TEMPO_120, 1, { from: 0, to: 2 });
  assertEq(out.length, 1, 'only the in-range note is touched');
  assertEq(out[0].note, notes[0]);
});

test('ribbon: snapNotesToGrid never introduces overlap between originally non-overlapping notes', () => {
  // A grid of many off-beat, tightly-packed but non-overlapping notes across several beats —
  // independent snapping must preserve non-overlap for every adjacent pair (see the note above).
  const notes = [];
  for (let i = 0; i < 30; i++) notes.push(n(i * 0.31 + 0.02, i * 0.31 + 0.29, 60));
  const out = R().snapNotesToGrid(notes, TEMPO_120, 4, null);
  const byNote = new Map(out.map((o) => [o.note, o]));
  for (let i = 1; i < notes.length; i++) {
    const prev = byNote.get(notes[i - 1]) ?? { newEnd: notes[i - 1].end };
    const cur = byNote.get(notes[i]) ?? { newStart: notes[i].start };
    assert(cur.newStart >= prev.newEnd, `note ${i} doesn't overlap note ${i - 1}: ${cur.newStart} >= ${prev.newEnd}`);
  }
});

test('ribbon: snapNotesToGrid floors a note whose edges round to the same grid point', () => {
  // Both 1.20 and 1.28 are nearer to the beat at 1.5 than to 1.0 — without a floor this would
  // collapse to a zero-length note at 1.5.
  const out = R().snapNotesToGrid([n(1.2, 1.28, 60)], TEMPO_120, 1, null);
  assertEq(out.length, 1);
  assert(out[0].newEnd - out[0].newStart > 0, 'still a positive-duration note');
});

test('ribbon: snapNotesToGrid with range: null snaps every note', () => {
  const notes = [n(0.6, 0.9, 60), n(5.6, 5.9, 62)];
  const out = R().snapNotesToGrid(notes, TEMPO_120, 1, null);
  assertEq(out.length, 2);
});

test('ribbon: snapNotesToGrid tolerates a missing tempo or empty note list', () => {
  assertEq(R().snapNotesToGrid([n(0.6, 0.9, 60)], null, 1, null).length, 0);
  assertEq(R().snapNotesToGrid([], TEMPO_120, 1, null).length, 0);
});

test('ribbon: snapNoteEdges never collapses a note to zero width', () => {
  // Regression: a 0.1742s note against a 0.7605s beat period (78.9 BPM) — real numbers from
  // a live repro — has both edges land on the SAME nearest grid point when snapped
  // independently with no floor. app.js's editSnapNote used to call snapToGrid directly for
  // each edge with no MIN_DUR floor (only snapNotesToGrid, the batch path, had one), so a
  // single-note Snap on a short note produced a genuinely zero-width note — start === end —
  // which can never be found again by ANY anchor search (`start <= at < end` is false for
  // every `at` once start === end), permanently orphaning the next edit that touched it.
  // editSnapNote now shares this exact function with the batch path, so this covers both.
  const tempo = { bpmValue: 78.9, phaseMs: 50, beatsPerBar: 4 };
  const { newStart, newEnd } = R().snapNoteEdges(tempo, 5.9443, 6.1185, 1);
  assert(newEnd > newStart, `positive width after snapping: ${newStart} -> ${newEnd}`);
});

test('ribbon: snapNotesToGrid rounds to 4 decimal places, matching applyEdits (lib/pitch.js)', () => {
  // Regression: applyEdits reconstructs a replayed note as
  // +(note.start + edit.dStart).toFixed(4), and note positions from interpret()/applyEdits
  // are always already 4dp. A full-precision delta computed here against a 4dp input can
  // replay a fraction of a millisecond off from what this function computed — on a real
  // 78.9 BPM song this was enough to push a reconstructed note edge outside a neighbour's
  // interval and orphan an unrelated edit two edits later. An irregular BPM (not a clean
  // divisor of 1s, unlike the 120 BPM used elsewhere in this file) is what exposes it.
  const tempo = { bpmValue: 78.9, phaseMs: 50, beatsPerBar: 4 };
  const out = R().snapNotesToGrid([n(5.944, 6.119, 53)], tempo, 1, null);
  assertEq(out.length, 1);
  const { newStart, newEnd } = out[0];
  assertEq(newStart, +newStart.toFixed(4), `newStart already 4dp: ${newStart}`);
  assertEq(newEnd, +newEnd.toFixed(4), `newEnd already 4dp: ${newEnd}`);
  // Re-snapping the result (simulating applyEdits' own 4dp-rounded reconstruction of it)
  // must be a stable no-op — this is what "already on grid" means once precision matches.
  const again = R().snapNotesToGrid([n(newStart, newEnd, 53)], tempo, 1, null);
  assertEq(again.length, 0, 'snapping an already-snapped note a second time is a no-op');
});
