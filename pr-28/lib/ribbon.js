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
   *
   * This is the ONLY thing clip does. It is a display choice about the vertical scale: it
   * never reaches `interpret()`, so the note list is the same either way, and a clipped
   * note still sounds at its detected pitch. To change which notes exist, move the
   * shortest-note control or the interpreter.
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
   * NOT used by the player: the full-width lane uses contourColumns, and the zoomed pane
   * draws its line inline because it already walks the frames in its window. Kept because
   * it is the correct primitive for any consumer drawing at a width where a column is one
   * frame or less, and it is covered by tests.
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


  /**
   * The contour reduced to one [lo, hi] band per pixel column, or null where a column
   * holds no voiced frame.
   *
   * At whole-song width a column spans ~26 frames. Joining those with a polyline draws
   * near-vertical strokes between unrelated pitches and fills the lane with noise; the
   * band says what the waveform lanes say — the range covered here — and stays honest
   * about an octave error instead of hiding it in a smear.
   */
  function contourColumns(frames, duration, width) {
    const cols = new Array(Math.max(1, Math.floor(width))).fill(null);
    if (!duration) return cols;
    for (let i = 0; i < frames.cents.length; i++) {
      const cents = frames.cents[i];
      if (!cents) continue;
      const x = Math.floor((frames.t[i] / duration) * cols.length);
      if (x < 0 || x >= cols.length) continue;
      const midi = cents / 100;
      const c = cols[x];
      if (!c) cols[x] = { lo: midi, hi: midi };
      else { if (midi < c.lo) c.lo = midi; if (midi > c.hi) c.hi = midi; }
    }
    return cols;
  }


  /**
   * Peak envelope at a fixed resolution in TIME, for the zoomed view.
   *
   * The lane waveforms use a fixed bucket COUNT across the whole song, which is right for
   * a view that always shows everything and useless for one that shows ten seconds. This
   * is computed once per stem and sliced per window.
   */
  function zoomPeaks(channel, sampleRate, bucketsPerSecond) {
    const bps = bucketsPerSecond;
    const per = sampleRate / bps;
    const n = Math.max(1, Math.floor(channel.length / per));
    const mins = new Float32Array(n);
    const maxs = new Float32Array(n);
    for (let b = 0; b < n; b++) {
      const start = Math.floor(b * per);
      const end = Math.min(channel.length, Math.floor((b + 1) * per));
      let lo = 0;
      let hi = 0;
      for (let i = start; i < end; i++) {
        const v = channel[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      mins[b] = lo;
      maxs[b] = hi;
    }
    return { mins, maxs, bps };
  }

  /**
   * The visible window for a zoomed view, as { from, to }.
   *
   * Clamping slides the window rather than shrinking it: a window that narrows at the
   * ends would change the time scale exactly where the user is trying to read it.
   */
  function zoomWindow(center, seconds, duration) {
    const width = Math.min(seconds, duration);
    let from = center - width / 2;
    if (from < 0) from = 0;
    if (from + width > duration) from = duration - width;
    return { from, to: from + width };
  }

  /**
   * Beat and bar times across the song, in seconds, given a tempo config and duration.
   *
   * `phaseMs` is normalised into [0, periodMs) before generating — so a nudge that pushes it
   * negative or past one period is still well-defined, rather than needing to be clamped at
   * the UI layer. Pure arithmetic, no autocorrelation, no worker — cheap enough to re-run on
   * every keystroke/nudge, the same property reinterpret() already relies on for notes.
   *
   * Returns [{ t, bar }, …] for every beat from the normalised first beat through `duration`,
   * inclusive; `bar` is true every `beatsPerBar`-th one, starting with the first.
   */
  function beatTimes(tempo, duration) {
    const beats = [];
    if (!tempo || !tempo.bpmValue || tempo.bpmValue <= 0 || !duration) return beats;

    const periodMs = 60000 / tempo.bpmValue;
    let phase = tempo.phaseMs % periodMs;
    if (phase < 0) phase += periodMs;

    const beatsPerBar = Math.max(1, tempo.beatsPerBar || 4);
    const periodSec = periodMs / 1000;
    const firstT = phase / 1000;

    let i = 0;
    for (let t = firstT; t <= duration; t += periodSec, i++) {
      beats.push({ t, bar: i % beatsPerBar === 0 });
    }
    return beats;
  }

  global.SansRibbon = { pitchRange, contourSegments, contourColumns, zoomPeaks, zoomWindow, beatTimes };
})(window);
