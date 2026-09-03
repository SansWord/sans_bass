/* 簡譜 — absolute pitches as scale degrees.
 *
 * Nothing here touches the DOM: it maps a MIDI number to a degree, and app.js turns that
 * into pixels. ESM, no window bridge — notes.js and app.js both import it directly.
 */
/* Degree and accidental for each semitone offset above the tonic.
 *
 * The two rows are NOT transpositions of one another, and that is the point of the mode
 * selector. In minor, flat-three, flat-six and flat-seven ARE degrees 3, 6 and 7 — they
 * sit in the scale — so the notes outside it are the raised ones. E flat is `b3` in
 * 1=C major and plain `3` in 1=C minor. */
const MAJOR = [
  ['1', ''], ['1', '#'], ['2', ''], ['3', 'b'], ['3', ''], ['4', ''],
  ['4', '#'], ['5', ''], ['6', 'b'], ['6', ''], ['7', 'b'], ['7', ''],
];
const MINOR = [
  ['1', ''], ['1', '#'], ['2', ''], ['3', ''], ['3', '#'], ['4', ''],
  ['4', '#'], ['5', ''], ['6', ''], ['6', '#'], ['7', ''], ['7', '#'],
];

const WEIGHT_PER_SECOND = 40;   // mirrors lib/ribbon.js and lib/pitch.js

/**
 * A MIDI note as a scale degree in the given key.
 *
 * Returns { digit, accidental, octaveIndex }. `octaveIndex` counts octaves from the
 * TONIC, not from C: a 簡譜 octave runs 1 to 7 and begins again at the next 1, so the
 * boundary sits on the tonic. It is an absolute index; subtract referenceOctave() to get
 * the signed offset the dots are drawn from.
 */
function degreeOf(midi, tonicPc, mode) {
  const table = mode === 'minor' ? MINOR : MAJOR;
  const steps = midi - tonicPc;
  const offset = ((steps % 12) + 12) % 12;
  const [digit, accidental] = table[offset];
  return { digit, accidental, octaveIndex: Math.floor(steps / 12) };
}

/**
 * The octave whose numbers are drawn bare, as an octaveIndex.
 *
 * The one holding the duration-weighted median pitch — the same statistic pitchRange and
 * pitchBand already use, so the unmarked band is where the singer actually sings rather
 * than an arbitrary C-to-B.
 */
function referenceOctave(notes, tonicPc) {
  if (!notes || !notes.length) return 0;
  const weighted = [];
  for (const n of notes) {
    const reps = Math.max(1, Math.round((n.end - n.start) * WEIGHT_PER_SECOND));
    for (let i = 0; i < reps; i++) weighted.push(n.midi);
  }
  if (!weighted.length) return 0;
  weighted.sort((a, b) => a - b);
  return degreeOf(weighted[weighted.length >> 1], tonicPc, 'major').octaveIndex;
}

const GRID_UNITS_PER_BEAT = 4; // 16th-note resolution — the finest rhythm this classifies

/**
 * A note's duration, at `beatSec` seconds/beat, as printable 簡譜 rhythm marks:
 * `{ dashes, underline, dot }`. Quantised to a 16th-note grid (4 units/beat) — this reads
 * off common durations (16th/8th/dotted-8th and quarter + sustain dashes + one dotted
 * half-beat), not an exact rhythm transcription; an off-grid remainder of one grid unit
 * rounds down to the nearest of {no dot, dot} rather than introducing a finer mark.
 *
 * `dashes` is sustain beats BEYOND the first (jianpu convention: a held note is the digit
 * followed by one dash per extra beat). `underline` is 0/1/2 double-unders for a sub-beat
 * note. `dot` extends the note by half a beat, whether sub-beat (dotted 8th) or a whole-beat
 * note with a leftover half-beat (dotted quarter, dotted half, ...).
 */
function noteRhythm(durationSec, beatSec) {
  const gridUnit = beatSec / GRID_UNITS_PER_BEAT;
  const units = Math.max(1, Math.round(durationSec / gridUnit));
  const wholeBeats = Math.floor(units / GRID_UNITS_PER_BEAT);
  const remainder = units % GRID_UNITS_PER_BEAT;

  if (wholeBeats >= 1) {
    return { dashes: wholeBeats - 1, underline: 0, dot: remainder >= 2 };
  }
  if (units === 1) return { dashes: 0, underline: 2, dot: false };
  if (units === 2) return { dashes: 0, underline: 1, dot: false };
  return { dashes: 0, underline: 1, dot: true }; // units === 3: dotted eighth
}

/**
 * Notes laid out into the bars implied by `barBounds` — an ascending list of boundary
 * times in seconds, e.g. `[0, 1, 2]` for two one-second bars. A note whose span crosses one
 * or more boundaries is split into per-bar fragments at each crossing; every fragment but
 * the last of a split note carries `tie: true` ("sustained into the next bar" — the caller
 * draws the tie mark, this only says where one belongs).
 *
 * Returns one array of fragments per bar (`barBounds.length - 1` rows), each fragment
 * `{ token, octave, dashes, underline, dot, tie }` — `token` is the BARE accidental+digit,
 * with no octave marks baked in: a caller rendering real HTML draws standard 簡譜 octave
 * dots above/below the digit instead, from the signed `octave` count returned alongside it
 * (0 at the reference octave, +1/+2/… above, -1/-2/… below). The rhythm fields come from
 * noteRhythm on the FRAGMENT's own (post-split) duration. A bar with no notes is an empty
 * array.
 */
function layoutBars(notes, barBounds, tonicPc, mode, refOctaveIndex, beatSec) {
  const bars = [];
  for (let i = 0; i < barBounds.length - 1; i++) bars.push([]);
  if (!notes) return bars;

  const sorted = [...notes].sort((a, b) => a.start - b.start);
  for (const note of sorted) {
    const d = degreeOf(note.midi, tonicPc, mode);
    const token = d.accidental + d.digit;
    const octave = d.octaveIndex - refOctaveIndex;
    let start = note.start;
    for (let i = 0; i < barBounds.length - 1; i++) {
      const barEnd = barBounds[i + 1];
      if (start >= barEnd || note.end <= barBounds[i]) continue;
      const fragEnd = Math.min(note.end, barEnd);
      const tie = fragEnd < note.end;
      const rhythm = noteRhythm(fragEnd - start, beatSec);
      bars[i].push({ token, octave, ...rhythm, tie });
      start = fragEnd;
    }
  }
  return bars;
}

export { degreeOf, referenceOctave, noteRhythm, layoutBars };
