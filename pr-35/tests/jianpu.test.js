import { test, assert, assertEq } from './assert.js';

const J = () => window.SansJianpu;

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

test('jianpu: degreeToken has no octave marks in the reference octave', () => {
  const ref = J().degreeOf(C4, 0, 'major').octaveIndex;
  assertEq(J().degreeToken(C4, 0, 'major', ref), '1', 'C4 in 1=C, reference octave');
});

test('jianpu: degreeToken appends an apostrophe per octave above the reference', () => {
  const ref = J().degreeOf(C4, 0, 'major').octaveIndex;
  assertEq(J().degreeToken(C4 + 12, 0, 'major', ref), "1'", 'one octave up');
  assertEq(J().degreeToken(C4 + 24, 0, 'major', ref), "1''", 'two octaves up');
});

test('jianpu: degreeToken prepends a comma per octave below the reference', () => {
  const ref = J().degreeOf(C4, 0, 'major').octaveIndex;
  assertEq(J().degreeToken(C4 - 12, 0, 'major', ref), ',1', 'one octave down');
  assertEq(J().degreeToken(C4 - 24, 0, 'major', ref), ',,1', 'two octaves down');
});

test('jianpu: degreeToken keeps the accidental between the octave marks and the digit', () => {
  const ref = J().degreeOf(C4, 0, 'major').octaveIndex;
  // C4+3 = Eb4 = b3 in 1=C major (see the worked-examples test above).
  assertEq(J().degreeToken(C4 + 3, 0, 'major', ref), 'b3', 'flat degree, reference octave');
  assertEq(J().degreeToken(C4 + 3 + 12, 0, 'major', ref), "b3'", 'flat degree, one octave up');
  assertEq(J().degreeToken(C4 + 3 - 12, 0, 'major', ref), ',b3', 'flat degree, one octave down');
});
