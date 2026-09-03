/* Chord labels guessed from a monophonic bass line, printed above each bar of a 簡譜
 * export. Pure, no DOM — mirrors lib/jianpu.js, so it's testable in isolation and imported
 * directly by notes.js alongside it. See
 * docs/superpowers/specs/2026-09-03-bass-chord-detection-design.md. */
import { roundSeconds } from './time.js';

/* Note names are never translated in this app, same convention as notes.js's own
 * PITCH_CLASSES — sharps only. */
const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/* Scale steps in semitones, and the triad quality sitting on each degree — same shape as
 * lib/jianpu.js's MAJOR/MINOR degree tables, but keyed by scale STEP (0-6) rather than
 * semitone offset, and yielding a chord quality instead of a degree digit. See the design
 * spec's "Diatonic triad table". */
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MAJOR_QUALITY = ['major', 'minor', 'minor', 'major', 'major', 'minor', 'dim'];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
const MINOR_QUALITY = ['minor', 'dim', 'major', 'minor', 'minor', 'major', 'major'];

const QUALITY_SUFFIX = { major: '', minor: 'm', dim: 'dim' };

/** The root pitch class's diatonic triad quality in the given key, or `null` when the root
 *  is chromatic to it (the longest-overlap note happened to be a passing tone). */
function diatonicQuality(rootPc, tonicPc, mode) {
  const interval = ((rootPc - tonicPc) % 12 + 12) % 12;
  const steps = mode === 'minor' ? MINOR_STEPS : MAJOR_STEPS;
  const quality = mode === 'minor' ? MINOR_QUALITY : MAJOR_QUALITY;
  const idx = steps.indexOf(interval);
  return idx === -1 ? null : quality[idx];
}

/** The note with the greatest overlap duration inside `[halfStart, halfEnd)` — ties broken
 *  by earliest `start`. `notes` is every note already known to overlap the window at all
 *  (so every candidate's overlap here is > 0). */
function pickRoot(notes, halfStart, halfEnd) {
  let best = notes[0];
  let bestOverlap = Math.min(best.end, halfEnd) - Math.max(best.start, halfStart);
  for (let i = 1; i < notes.length; i++) {
    const note = notes[i];
    const overlap = Math.min(note.end, halfEnd) - Math.max(note.start, halfStart);
    if (overlap > bestOverlap || (overlap === bestOverlap && note.start < best.start)) {
      best = note;
      bestOverlap = overlap;
    }
  }
  return best;
}

/** One half-bar's chord label, or `null` if silent — see the design spec's "Per-half
 *  algorithm". `notes` is every note overlapping `[halfStart, halfEnd)` at all. */
function labelForHalf(notes, halfStart, halfEnd, tonicPc, mode) {
  if (!notes.length) return null;
  const root = pickRoot(notes, halfStart, halfEnd);
  const rootPc = ((root.midi % 12) + 12) % 12;
  const rootName = PITCH_CLASSES[rootPc];
  const quality = diatonicQuality(rootPc, tonicPc, mode);
  if (quality === null) return rootName;   // chromatic root: bare name, no suffix

  // Suspension override — only reached when step 4 (above) found a diatonic quality.
  const others = new Set();
  for (const note of notes) {
    // Only consider notes that overlap temporally with the root — a suspension requires
    // the 2nd/4th to sound simultaneously, not before or after.
    if (note.start < root.end && note.end > root.start) {
      const pc = ((note.midi % 12) + 12) % 12;
      if (pc !== rootPc) others.add(pc);
    }
  }
  const third = (rootPc + (quality === 'major' ? 4 : 3)) % 12;
  const fourth = (rootPc + 5) % 12;
  const second = (rootPc + 2) % 12;
  if (others.has(fourth) && !others.has(third)) return `${rootName}sus4`;
  if (others.has(second) && !others.has(third)) return `${rootName}sus2`;
  return rootName + QUALITY_SUFFIX[quality];
}

/**
 * A chord guess for each half of each bar, from the BASS channel's own notes/key —
 * independent of which channel is being exported. One `{ first, second }` entry per bar
 * (`barBounds.length - 1` entries, same convention as lib/jianpu.js's layoutBars).
 * `second` is `null` whenever that half is silent OR resolves to the same label as `first`
 * — the caller renders whatever isn't null with no comparison of its own.
 *
 * Each half is split at the bar's time MIDPOINT, not by beat count, so this stays correct
 * under a non-4/4 beatsPerBar. `barBounds` is rounded through roundSeconds first, same
 * precision every note's own start/end is stored at and the same treatment
 * lib/jianpu.js's layoutBars gives its own bar boundaries (see that file's doc comment for
 * why: an unrounded boundary compared against a rounded note time can disagree by a
 * sub-millisecond sliver).
 */
export function detectChords(bassNotes, barBounds, tonicPc, mode) {
  const notes = bassNotes || [];
  const bounds = barBounds.map(roundSeconds);
  const result = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const barStart = bounds[i];
    const barEnd = bounds[i + 1];
    const mid = roundSeconds((barStart + barEnd) / 2);
    const halves = [[barStart, mid], [mid, barEnd]];
    const [first, second] = halves.map(([hs, he]) => {
      const inWindow = notes.filter((note) => note.start < he && note.end > hs);
      return labelForHalf(inWindow, hs, he, tonicPc, mode);
    });
    result.push({ first, second: second === first ? null : second });
  }
  return result;
}
