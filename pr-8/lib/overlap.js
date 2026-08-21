/* Segment planning and overlap-add windows for htdemucs_6s.
 *
 * The model takes exactly N_SAMPLES per call, so a track is processed as overlapping
 * segments that are cross-faded back together. */

export const N_SAMPLES = 343980;                    // 7.8 s @ 44.1 kHz — fixed by the model
export const OVERLAP = Math.floor(N_SAMPLES / 4);   // 85995
export const STRIDE = N_SAMPLES - OVERLAP;          // 257985

/**
 * Start offsets of every segment needed to cover `total` samples.
 * The inference loop MUST iterate this array rather than recomputing a count —
 * two independent formulas is how the spike ended up reporting "segment 35/34".
 */
export function segmentStarts(total) {
  const starts = [];
  for (let s = 0; s < total; s += STRIDE) starts.push(s);
  return starts.length ? starts : [0];
}

/** Linear fade in/out — the window used by the model repo's reference infer.py. */
export function trapezoidWindow(n = N_SAMPLES, overlap = OVERLAP) {
  const w = new Float32Array(n);
  const d = overlap - 1;
  for (let i = 0; i < n; i++) {
    if (i < overlap) w[i] = i / d;
    else if (i >= n - overlap) w[i] = (n - 1 - i) / d;
    else w[i] = 1;
  }
  return w;
}

/**
 * Raised-cosine fade in/out. Native Demucs cross-fades with a cosine transition rather
 * than a straight line; the spike found guitar 1.4 dB hot against native output and this
 * is the leading hypothesis for why.
 */
export function raisedCosineWindow(n = N_SAMPLES, overlap = OVERLAP) {
  const w = new Float32Array(n);
  const d = overlap - 1;
  for (let i = 0; i < n; i++) {
    if (i < overlap) w[i] = 0.5 - 0.5 * Math.cos((Math.PI * i) / d);
    else if (i >= n - overlap) w[i] = 0.5 - 0.5 * Math.cos((Math.PI * (n - 1 - i)) / d);
    else w[i] = 1;
  }
  return w;
}
