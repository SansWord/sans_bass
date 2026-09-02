/* 簡譜 — absolute pitches as scale degrees.
 *
 * A CLASSIC script, matching lib/ribbon.js and lib/stems.js. app.js does the canvas work
 * and is a classic script itself, so it cannot import an ES module.
 *
 * Nothing here touches the DOM: it maps a MIDI number to a degree, and app.js turns that
 * into pixels.
 */
(function (global) {
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

  /**
   * A MIDI note as a printable 簡譜 token: accidental + digit, wrapped with octave marks
   * relative to `refOctaveIndex` — an apostrophe suffix per octave above it, a comma prefix
   * per octave below. Used by the plain-text note-list export in notes.js; the on-screen
   * ribbon draws the same information as dots instead (see drawOctaveDots in app.js) because
   * a rendered dot can't appear in a downloaded text file.
   */
  function degreeToken(midi, tonicPc, mode, refOctaveIndex) {
    const d = degreeOf(midi, tonicPc, mode);
    const dots = d.octaveIndex - refOctaveIndex;
    const up = dots > 0 ? "'".repeat(dots) : '';
    const down = dots < 0 ? ','.repeat(-dots) : '';
    return down + d.accidental + d.digit + up;
  }

  global.SansJianpu = { degreeOf, referenceOctave, degreeToken };
})(window);
