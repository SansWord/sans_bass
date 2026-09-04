import { test, assertEq } from './assert.js';
import { hzFromCents } from '../lib/pitch.js';
import { decodeChordProgression, detectChords, detectChordTimeline, transposeChordLabel, transposePitchClass } from '../lib/chords.js';

const SR = 44100;
const n = (start, end, midi) => ({ start, end, midi });

function chordTone(midis, seconds, amp = 0.3) {
  const out = new Float32Array(Math.round(seconds * SR));
  for (const midi of midis) {
    const hz = hzFromCents(midi * 100);
    for (let i = 0; i < out.length; i++) out[i] += amp * Math.sin((2 * Math.PI * hz * i) / SR);
  }
  return out;
}
function concat(...arrays) {
  const out = new Float32Array(arrays.reduce((total, array) => total + array.length, 0));
  let offset = 0;
  for (const array of arrays) { out.set(array, offset); offset += array.length; }
  return out;
}

const A_MAJ = [57, 61, 64];
const E_MAJ = [64, 68, 71];
const ONE_BAR = [0, 2];

test('chords: capo transposes play chords and slash bass notes down by fret count', () => {
  assertEq(transposeChordLabel('A#', -1), 'A');
  assertEq(transposeChordLabel('A#', -3), 'G');
  assertEq(transposeChordLabel('A#m7/G#', -3), 'Gm7/F');
  assertEq(transposeChordLabel('Bb', -1), 'A');
  assertEq(transposeChordLabel('not a chord', -3), 'not a chord');
  assertEq(transposePitchClass(10, -3), 7);
});

test('chords: vocal-key context resolves an E-versus-C#m ambiguity toward I-V-vi', () => {
  const candidateSets = [
    [{ rootPc: 9, quality: 'maj', rank: 1 }],
    [{ rootPc: 4, quality: 'maj', rank: 0.8 }, { rootPc: 1, quality: 'min', rank: 0.85 }],
    [{ rootPc: 6, quality: 'min', rank: 0.8 }],
  ];
  const path = decodeChordProgression(candidateSets, { tonicPc: 9, mode: 'major' });
  assertEq(path[1].rootPc, 4);
  assertEq(path[1].quality, 'maj');
});

test('chords: labels A major then E major per half-bar', () => {
  const [bar] = detectChords(concat(chordTone(A_MAJ, 1), chordTone(E_MAJ, 1)), SR, ONE_BAR, null);
  assertEq(bar.first, 'A');
  assertEq(bar.second, 'E');
});

test('chords: exposes time bounds and only near-confidence editing candidates', () => {
  const timeline = detectChordTimeline(
    concat(chordTone(A_MAJ, 1), chordTone(E_MAJ, 1)), SR, ONE_BAR, null,
  );
  assertEq(timeline.length, 2);
  assertEq(timeline[0].start, 0);
  assertEq(timeline[0].end, 1);
  assertEq(timeline[0].barStart, true);
  assertEq(timeline[1].barStart, false);
  assertEq(timeline[0].label, 'A');
  assertEq(timeline[0].candidates[0].label, 'A');
  if (timeline[0].candidates.length > 4) throw new Error('too many chord candidates exposed');
  if (timeline[0].candidates.some((candidate) => !Number.isFinite(candidate.confidence)))
    throw new Error('candidate confidence is missing');
});

test('chords: fuses a differing bass note as a slash chord', () => {
  const samples = concat(chordTone(A_MAJ, 1), chordTone(E_MAJ, 1));
  const [bar] = detectChords(samples, SR, ONE_BAR, [n(1, 2, 56)]);
  assertEq(bar.second, 'E/G#');
});

test('chords: matching, absent, and non-overlapping bass notes leave the label bare', () => {
  const samples = concat(chordTone(A_MAJ, 1), chordTone(E_MAJ, 1));
  for (const bassNotes of [null, [n(1, 2, 64)], [n(5, 6, 56)]]) {
    const [bar] = detectChords(samples, SR, ONE_BAR, bassNotes);
    assertEq(bar.second, 'E');
  }
});

test('chords: silence yields null and repeated labels dedupe the second half', () => {
  const [silent] = detectChords(concat(chordTone(A_MAJ, 1), new Float32Array(SR)), SR, ONE_BAR, null);
  assertEq(silent.first, 'A');
  assertEq(silent.second, null);
  const [same] = detectChords(concat(chordTone(A_MAJ, 1), chordTone(A_MAJ, 1)), SR, ONE_BAR, null);
  assertEq(same.first, 'A');
  assertEq(same.second, null);
  const merged = detectChordTimeline(concat(chordTone(A_MAJ, 1), chordTone(A_MAJ, 1)), SR, ONE_BAR, null);
  assertEq(merged.length, 1, 'matching halves become one full-bar interval');
  assertEq(merged[0].start, 0);
  assertEq(merged[0].end, 2);
});

test('chords: a strong full bar carries one strong half across a weak partner', () => {
  const timeline = detectChordTimeline(
    concat(chordTone(A_MAJ, 1), chordTone(E_MAJ, 1, 0.004)), SR, ONE_BAR, null,
  );
  assertEq(timeline.length, 1);
  assertEq(timeline[0].label, 'A');
  assertEq(timeline[0].end, 2);
});

test('chords: matching roots retain separate halves when the bass inversion changes', () => {
  const timeline = detectChordTimeline(
    concat(chordTone(A_MAJ, 1), chordTone(A_MAJ, 1)), SR, ONE_BAR,
    [n(0, 1, 57), n(1, 2, 56)],
  );
  assertEq(timeline.length, 2);
  assertEq(timeline[0].label, 'A');
  assertEq(timeline[1].label, 'A/G#');
});

test('chords: a whole weak bar is omitted even when normalized chroma has a shape', () => {
  const timeline = detectChordTimeline(
    concat(chordTone(A_MAJ, 1, 0.004), chordTone(A_MAJ, 1, 0.004)), SR, ONE_BAR, null,
  );
  assertEq(timeline.length, 1);
  assertEq(timeline[0].label, null);
});

test('chords: splits a non-4/4 bar at its time midpoint', () => {
  const [bar] = detectChords(concat(chordTone(A_MAJ, 1.5), chordTone(E_MAJ, 1.5)), SR, [0, 3], null);
  assertEq(bar.first, 'A');
  assertEq(bar.second, 'E');
});

test('chords: creates one result per bar and handles all-silent audio', () => {
  const bars = detectChords(concat(chordTone(A_MAJ, 2), chordTone(E_MAJ, 2)), SR, [0, 2, 4], null);
  assertEq(bars.length, 2);
  assertEq(bars[0].first, 'A');
  assertEq(bars[1].first, 'E');
  const silence = detectChords(new Float32Array(4 * SR), SR, [0, 2, 4], null);
  for (const bar of silence) { assertEq(bar.first, null); assertEq(bar.second, null); }
});
