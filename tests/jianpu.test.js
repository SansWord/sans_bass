import { test, assert, assertEq } from './assert.js';
import * as SansJianpu from '../lib/jianpu.js';
import { beatTimes } from '../lib/ribbon.js';

const J = () => SansJianpu;

// midi 60 is C4, so `pc` here doubles as a MIDI number in octave 4.
const C4 = 60;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const show = (d) => d.accidental + d.digit;

test('jianpu: the three worked examples from the request', () => {
  // 1=C major: C is 1, C# is #1, Eb is b3.
  assertEq(show(J().degreeOf(C4 + 0, 0, 'major')), '1', 'C in 1=C major');
  assertEq(show(J().degreeOf(C4 + 1, 0, 'major')), '#1', 'C# in 1=C major');
  assertEq(show(J().degreeOf(C4 + 3, 0, 'major')), 'b3', 'Eb in 1=C major');
  // 1=C minor: the same Eb is degree 3, because b3 is IN the minor scale.
  assertEq(show(J().degreeOf(C4 + 3, 0, 'minor')), '3', 'Eb in 1=C minor');
  // 1=G major: C is the fourth.
  assertEq(show(J().degreeOf(C4 + 0, 7, 'major')), '4', 'C in 1=G major');
});

test('jianpu: the full major row', () => {
  const want = ['1', '#1', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'];
  for (let i = 0; i < 12; i++) {
    assertEq(show(J().degreeOf(C4 + i, 0, 'major')), want[i], `${NAMES[i]} in 1=C major`);
  }
});

test('jianpu: the full minor row takes sharps, not flats', () => {
  /* The flat degrees are already in the scale, so what lies outside it is raised. This is
   * the whole reason the mode selector changes the numbers rather than relabelling them. */
  const want = ['1', '#1', '2', '3', '#3', '4', '#4', '5', '6', '#6', '7', '#7'];
  for (let i = 0; i < 12; i++) {
    assertEq(show(J().degreeOf(C4 + i, 0, 'minor')), want[i], `${NAMES[i]} in 1=C minor`);
  }
});

test('jianpu: it is a movable-do system — transposing tonic and note together is invariant', () => {
  /* THE property. Shift the tonic by n and every note by n, and every degree is unchanged.
   * A table that happened to be right only for C would fail this at the first other tonic. */
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor']) {
      for (let i = 0; i < 12; i++) {
        const atC = show(J().degreeOf(C4 + i, 0, mode));
        const moved = show(J().degreeOf(C4 + i + tonic, tonic, mode));
        assertEq(moved, atC, `offset ${i} in 1=${NAMES[tonic]} ${mode}`);
      }
    }
  }
});

test('jianpu: octaves are counted from the tonic, not from C', () => {
  /* A 簡譜 octave runs 1 to 7 and starts again at the next 1, so the boundary sits on the
   * TONIC. In 1=G that means the run G3-A3-B3-C4-D4-E4-F#4 is a single octave and G4 opens
   * the next — even though it straddles the C3/C4 boundary that note names use. Counting
   * from C instead would split every key but C down the middle of its scale. */
  const oi = (m) => J().degreeOf(m, 7, 'major').octaveIndex;
  const run = [55, 57, 59, 60, 62, 64, 66];          // G3 A3 B3 C4 D4 E4 F#4
  for (const m of run) assertEq(oi(m), oi(55), `midi ${m} is in the G3 run`);
  assertEq(oi(67), oi(55) + 1, 'G4 opens the next octave');
  assertEq(oi(79), oi(55) + 2, 'G5 the one after that');
});

test('jianpu: the digit is unchanged by an octave shift', () => {
  for (const tonic of [0, 5, 7, 11]) {
    for (let i = 0; i < 12; i++) {
      const a = J().degreeOf(C4 + i, tonic, 'major');
      const b = J().degreeOf(C4 + i + 12, tonic, 'major');
      assertEq(b.digit, a.digit, `digit survives +12 at offset ${i}`);
      assertEq(b.octaveIndex, a.octaveIndex + 1, `octaveIndex advances at offset ${i}`);
    }
  }
});

test('jianpu: referenceOctave follows the duration-weighted median, not the note count', () => {
  /* One long low note against many short high ones: the held note defines where the bare
   * numbers sit, matching how pitchRange and pitchBand already choose a centre. */
  const notes = [{ start: 0, end: 30, midi: 48 }];
  for (let i = 0; i < 40; i++) notes.push({ start: 30 + i * 0.1, end: 30.1 + i * 0.1, midi: 72 });
  const ref = J().referenceOctave(notes, 0);
  assertEq(ref, J().degreeOf(48, 0, 'major').octaveIndex, 'the held low note sets the reference');
});

test('jianpu: referenceOctave survives an empty list', () => {
  assertEq(typeof J().referenceOctave([], 0), 'number', 'a number, not NaN or undefined');
});

// ---------------------------------------------------------------- noteRhythm

const BEAT = 0.5; // 120 BPM

test('jianpu: noteRhythm reads a quarter note as the bare digit', () => {
  assertEq(JSON.stringify(J().noteRhythm(0.5, BEAT)), JSON.stringify({ dashes: 0, underline: 0, dot: false }));
});

test('jianpu: noteRhythm reads an eighth note as a single underline', () => {
  assertEq(JSON.stringify(J().noteRhythm(0.25, BEAT)), JSON.stringify({ dashes: 0, underline: 1, dot: false }));
});

test('jianpu: noteRhythm reads a sixteenth note as a double underline', () => {
  assertEq(JSON.stringify(J().noteRhythm(0.125, BEAT)), JSON.stringify({ dashes: 0, underline: 2, dot: false }));
});

test('jianpu: noteRhythm reads a dotted eighth as an underline plus a dot', () => {
  assertEq(JSON.stringify(J().noteRhythm(0.375, BEAT)), JSON.stringify({ dashes: 0, underline: 1, dot: true }));
});

test('jianpu: noteRhythm reads a half note as one sustain dash', () => {
  assertEq(JSON.stringify(J().noteRhythm(1.0, BEAT)), JSON.stringify({ dashes: 1, underline: 0, dot: false }));
});

test('jianpu: noteRhythm reads a dotted quarter as a dot with no dash', () => {
  assertEq(JSON.stringify(J().noteRhythm(0.75, BEAT)), JSON.stringify({ dashes: 0, underline: 0, dot: true }));
});

test('jianpu: noteRhythm reads a whole note as three sustain dashes', () => {
  assertEq(JSON.stringify(J().noteRhythm(2.0, BEAT)), JSON.stringify({ dashes: 3, underline: 0, dot: false }));
});

test('jianpu: noteRhythm floors a duration shorter than a sixteenth to one', () => {
  assertEq(JSON.stringify(J().noteRhythm(0.01, BEAT)), JSON.stringify({ dashes: 0, underline: 2, dot: false }));
});

// ---------------------------------------------------------------- layoutBars

test('jianpu: layoutBars keeps a note that fits in one bar as a single, untied fragment', () => {
  const notes = [{ start: 0, end: 0.5, midi: C4 }];
  const bars = J().layoutBars(notes, [0, 1, 2], 0, 'major', J().degreeOf(C4, 0, 'major').octaveIndex, BEAT);
  assertEq(bars.length, 2, 'two bars from three boundaries');
  assertEq(bars[0].length, 1, 'one fragment in bar 0');
  assertEq(bars[0][0].token, '1');
  assertEq(bars[0][0].octave, 0, 'a note at the reference octave has no dots');
  assertEq(bars[0][0].tie, false, 'a note that does not cross a boundary is not tied');
  assertEq(bars[1].length, 0, 'bar 1 has no notes');
});

test('jianpu: layoutBars reports octave as a signed count of dots from the reference, not punctuation', () => {
  const ref = J().degreeOf(C4, 0, 'major').octaveIndex;
  const notes = [
    { start: 0, end: 0.5, midi: C4 + 12 },   // one octave above
    { start: 0.5, end: 1, midi: C4 - 24 },   // two octaves below
  ];
  const bars = J().layoutBars(notes, [0, 1], 0, 'major', ref, BEAT);
  assertEq(bars[0][0].token, '1', 'token carries no apostrophe/comma marks');
  assertEq(bars[0][0].octave, 1, 'one octave above the reference');
  assertEq(bars[0][1].octave, -2, 'two octaves below the reference');
});

test('jianpu: layoutBars splits a note that crosses a barline and ties the first fragment', () => {
  const notes = [{ start: 0, end: 1.5, midi: C4 }];
  const bars = J().layoutBars(notes, [0, 1, 2], 0, 'major', J().degreeOf(C4, 0, 'major').octaveIndex, BEAT);
  assertEq(bars[0].length, 1, 'bar 0 gets the first fragment');
  assertEq(bars[0][0].tie, true, 'the fragment before the split is tied into the next bar');
  assertEq(JSON.stringify({ dashes: bars[0][0].dashes, underline: bars[0][0].underline, dot: bars[0][0].dot }),
    JSON.stringify({ dashes: 1, underline: 0, dot: false }), 'bar 0 fragment is a full 1s (half note) sustain');
  assertEq(bars[1].length, 1, 'bar 1 gets the second fragment');
  assertEq(bars[1][0].tie, false, 'the last fragment of a split note is not tied further');
  assertEq(bars[1][0].token, '1', 'the tied fragment carries the same pitch');
});

test('jianpu: layoutBars does not spawn a phantom sliver from float drift when a snapped note lands on a barline', () => {
  /* Reproduces a real report: after "Snap range" on the whole song, a note landing exactly
   * on a barline showed up as two notes — a real one, plus a ghost sixteenth-note tied in
   * from the PREVIOUS bar. Root cause: barBounds (from lib/ribbon.js's beatTimes(), raw,
   * unrounded floats built by accumulating +=periodSec in a loop) and a snapped note's
   * start (rounded to millisecond precision via roundSeconds, same as every stored note
   * time in the app) are computed by different arithmetic paths and can disagree by a
   * fraction of a millisecond — see 133 BPM, bar 6 below, where the raw boundary is
   * 10.827067... and roundSeconds stores 10.827, ~68 microseconds EARLIER. Comparing a
   * rounded note time against an unrounded boundary put that sliver in the wrong bar. */
  const bpm = 133;
  const beatsPerBar = 4;
  const periodSec = 60 / bpm;
  const barBoundaryRaw = beatTimes({ bpmValue: bpm, phaseMs: 0, beatsPerBar }, 30)
    .filter((b) => b.bar)[6].t;
  const noteStart = Math.round(barBoundaryRaw * 1000) / 1000; // roundSeconds, as snap-to-grid stores it
  assert(noteStart < barBoundaryRaw, 'the reproduction depends on rounding landing below the raw boundary');

  const notes = [{ start: noteStart, end: noteStart + 0.5, midi: C4 }];
  const barBounds = [0, barBoundaryRaw, barBoundaryRaw + periodSec * beatsPerBar];
  const ref = J().degreeOf(C4, 0, 'major').octaveIndex;
  const bars = J().layoutBars(notes, barBounds, 0, 'major', ref, periodSec);

  assertEq(bars[0].length, 0, 'no phantom fragment in the bar before the note actually starts');
  assertEq(bars[1].length, 1, 'the note lands cleanly, whole, in the bar it starts');
  assertEq(bars[1][0].tie, false, 'not tied — this is one ordinary note, not a split one');
});
