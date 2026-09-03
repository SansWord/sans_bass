import { test, assert, assertEq } from './assert.js';
import { detectChords } from '../lib/chords.js';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const n = (start, end, midi) => ({ start, end, midi });

// One bar, midpoint at 2s: first half [0,2), second half [2,4).
const ONE_BAR = [0, 4];

test('chords: the longest-duration note in the half wins the root, over a shorter earlier note', () => {
  // C major (tonicPc 0). Root candidate: F (pc 5, midi 41), 0.3-2s (long).
  // Also present: G (pc 7, midi 43), 0-0.3s (short, earlier) — should NOT win.
  const notes = [n(0, 0.3, 43), n(0.3, 2, 41)];
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'F', 'longer note (F, IV, major) wins the root over the shorter G');
});

test('chords: an exact duration tie breaks to the earliest onset', () => {
  // Both notes overlap [0,2) for exactly 1s each: C (pc 0) at 0-1, D (pc 2) at 1-2.
  const notes = [n(0, 1, 60), n(1, 2, 62)];
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'C', 'tied overlap breaks to the earlier-onset note (C, not D)');
});

test('chords: only the overlapping portion inside the half counts toward duration', () => {
  // A note starting in the first half and running deep into the second: 1.5-3.5s (2s total),
  // but only 0.5s of it overlaps the first half [0,2). A second note fully inside the first
  // half, 0-1s (1s), has MORE overlap in that half and should win there.
  const longNote = n(1.5, 3.5, 45);   // A (pc 9) — 0.5s overlap in half 1, 1.5s in half 2
  const shortInHalf1 = n(0, 1, 43);   // G (pc 7) — 1s overlap in half 1
  const notes = [longNote, shortInHalf1];
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'G', 'the note with more OVERLAP in half 1 wins, not the longer overall note');
  assertEq(bar.second, 'Am', 'in half 2 only the long note is present, at its own full overlap there');
});

test('chords: diatonic quality is correct for all 7 degrees in a major key', () => {
  const steps = [0, 2, 4, 5, 7, 9, 11];
  const want = ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'];
  for (let i = 0; i < 7; i++) {
    const notes = [n(0, 2, 36 + steps[i])];   // isolated root, first half only
    const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
    assertEq(bar.first, want[i], `scale step ${i} in 1=C major`);
  }
});

test('chords: diatonic quality is correct for all 7 degrees in a natural minor key', () => {
  const steps = [0, 2, 3, 5, 7, 8, 10];
  const want = ['Cm', 'Ddim', 'D#', 'Fm', 'Gm', 'G#', 'A#'];
  for (let i = 0; i < 7; i++) {
    const notes = [n(0, 2, 36 + steps[i])];
    const [bar] = detectChords(notes, ONE_BAR, 0, 'minor');
    assertEq(bar.first, want[i], `scale step ${i} in 1=C minor`);
  }
});

test('chords: a chromatic root (not diatonic to the key) gets the bare root name, no suffix', () => {
  // C major; root C# (pc 1) is not one of [0,2,4,5,7,9,11].
  const notes = [n(0, 2, 37)];
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'C#', 'chromatic passing tone: bare root name, no major/minor/dim suffix');
});

test('chords: sus4 override — a 4th present without the 3rd relabels the diatonic triad', () => {
  // C major; root G (pc 7, V, diatonic major). C (pc 0) is the 4th above G (7+5=12%12=0),
  // present with no B (pc 11, the 3rd) sounding alongside it.
  const notes = [n(0, 2, 43), n(0, 1, 36)];   // G (long/root), C (short, the 4th)
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'Gsus4', '4th present, 3rd absent: relabel to sus4');
});

test('chords: sus4 does NOT override when the 3rd is also present', () => {
  const notes = [n(0, 2, 43), n(0, 1, 36), n(0, 1, 47)];   // G root, C (4th), B (3rd, pc 11)
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'G', '3rd present alongside the 4th: the diatonic major quality stands');
});

test('chords: sus2 override — a major 2nd present without the 3rd relabels the diatonic triad', () => {
  // C major; root G (pc 7). A (pc 9) is the major 2nd above G (7+2=9), 3rd (B, pc 11) absent.
  const notes = [n(0, 2, 43), n(0, 1, 45)];   // G (root), A (the 2nd)
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'Gsus2', '2nd present, 3rd absent: relabel to sus2');
});

test('chords: sus2 does NOT override when the 3rd is also present', () => {
  const notes = [n(0, 2, 43), n(0, 1, 45), n(0, 1, 47)];   // G root, A (2nd), B (3rd)
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'G', '3rd present alongside the 2nd: the diatonic major quality stands');
});

test('chords: a silent half is null', () => {
  const notes = [n(0, 1, 36)];   // only in the first half
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'C');
  assertEq(bar.second, null, 'no notes in the second half');
});

test('chords: the same chord in both halves comes back with second === null', () => {
  const notes = [n(0, 1, 36), n(2, 3, 36)];   // C in both halves
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'C');
  assertEq(bar.second, null, 'same label both halves: second is deduped to null');
});

test('chords: different chords in each half are both returned', () => {
  const notes = [n(0, 1, 36), n(2, 3, 43)];   // C then G
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'C');
  assertEq(bar.second, 'G');
});

test('chords: a bar splits at its time MIDPOINT, not by beat count (a non-4/4 bar)', () => {
  // A 3-second bar: [0,3]. Midpoint is 1.5s regardless of beats-per-bar.
  const notes = [n(0, 1.4, 36), n(1.6, 3, 43)];   // C just before 1.5, G just after
  const [bar] = detectChords(notes, [0, 3], 0, 'major');
  assertEq(bar.first, 'C', 'first half [0, 1.5)');
  assertEq(bar.second, 'G', 'second half [1.5, 3)');
});

test('chords: multiple bars each get their own entry, same convention as layoutBars', () => {
  const notes = [n(0, 1, 36), n(4, 5, 43)];   // C in bar 0, G in bar 1
  const bars = detectChords(notes, [0, 4, 8], 0, 'major');
  assertEq(bars.length, 2);
  assertEq(bars[0].first, 'C');
  assertEq(bars[1].first, 'G');
});

test('chords: no bass notes at all produces every bar/half null', () => {
  const bars = detectChords([], [0, 4, 8], 0, 'major');
  assertEq(bars.length, 2);
  for (const bar of bars) {
    assertEq(bar.first, null);
    assertEq(bar.second, null);
  }
});
