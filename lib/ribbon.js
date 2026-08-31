/* Ribbon geometry — the pure parts of drawing a notes lane.
 *
 * A CLASSIC script, matching lib/stems.js and lib/platform.js. app.js does the canvas
 * work and is a classic script itself, so it cannot import an ES module; this is the same
 * reason the stem and platform helpers are classic. The tests read it the same way.
 *
 * Nothing here touches the DOM or a canvas: it maps notes and frames to numbers, and
 * app.js turns those into pixels.
 */
(function (global) {
  /* Percentile band, weighted by note DURATION rather than note count. A held tonic should
   * define the lane; forty passing sixteenths should not. */
  const LOW_PCT = 0.03;
  const HIGH_PCT = 0.97;
  const PAD_SEMITONES = 1.5;
  const WEIGHT_PER_SECOND = 40;      // sample resolution for the weighting, not a tuning knob

  /**
   * Vertical range of the lane, in MIDI note numbers, as [lo, hi].
   *
   * With `clip` (the default) the band covers the middle ~94% of note time and octave
   * errors fall outside it — app.js draws those clipped to the lane edge. With clip:false
   * the range spans every note, which is what one bad note does to the scale.
   */
  function pitchRange(notes, opts) {
    const clip = opts && 'clip' in opts ? !!opts.clip : true;
    if (!notes || !notes.length) return [59, 71];        // an octave around middle C

    if (!clip) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const n of notes) { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); }
      return [lo - PAD_SEMITONES, hi + PAD_SEMITONES];
    }

    const weighted = [];
    for (const n of notes) {
      const reps = Math.max(1, Math.round((n.end - n.start) * WEIGHT_PER_SECOND));
      for (let i = 0; i < reps; i++) weighted.push(n.midi);
    }
    weighted.sort((a, b) => a - b);
    const lo = weighted[Math.floor(weighted.length * LOW_PCT)];
    const hi = weighted[Math.floor(weighted.length * HIGH_PCT)];
    return [lo - PAD_SEMITONES, hi + PAD_SEMITONES];
  }


  /**
   * The pitch contour as a list of polylines, each point [timeFraction, midi].
   *
   * A new polyline starts after every unvoiced frame. Never join across one: a line drawn
   * through a rest says the singer held a note through a silence, which is exactly the
   * kind of quiet lie that makes a visualisation untrustworthy.
   */
  function contourSegments(frames, duration) {
    const segs = [];
    let cur = null;
    for (let i = 0; i < frames.cents.length; i++) {
      const cents = frames.cents[i];
      if (!cents) { cur = null; continue; }
      if (!cur) { cur = []; segs.push(cur); }
      cur.push([duration ? frames.t[i] / duration : 0, cents / 100]);
    }
    return segs;
  }

  global.SansRibbon = { pitchRange, contourSegments };
})(window);
