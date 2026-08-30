/* Note and key detection from a monophonic stem.
 *
 * Pure: no DOM, no AudioContext, no Worker. Takes Float32Arrays, returns data — so the
 * bench page can call it on the main thread and the app can put it in a Worker later
 * without the module changing.
 *
 * Pipeline: decimate 4:1 -> YIN per frame -> voicing gate + median filter -> segment into
 * notes -> duration-weighted chroma -> Krumhansl-Schmuckler key.
 *
 * Design: docs/superpowers/specs/2026-08-30-pitch-detection-design.md
 */

// ---------------------------------------------------------------- helpers

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Hz -> absolute cents, anchored so MIDI 69 (A4, 440 Hz) is 6900. */
export function centsFromHz(hz) {
  return 1200 * Math.log2(hz / 440) + 6900;
}

/** Inverse of centsFromHz. */
export function hzFromCents(cents) {
  return 440 * Math.pow(2, (cents - 6900) / 1200);
}

/** Absolute cents -> nearest MIDI note number. */
export function midiFromCents(cents) {
  return Math.round(cents / 100);
}

/** MIDI note number -> scientific pitch name, sharps only ("C#4", never "Db4"). */
export function noteName(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

// ---------------------------------------------------------------- decimation

export const DECIMATION = 4;          // 44100 -> 11025 Hz
const LOWPASS_TAPS = 63;
const CUTOFF_FRACTION = 0.9;          // of the decimated Nyquist

/**
 * Hamming-windowed sinc lowpass. `taps` must be odd; `cutoffHz` is the -6 dB point.
 * Normalised to unity DC gain so decimation does not change level.
 */
export function lowpassKernel(taps, cutoffHz, sampleRate) {
  const k = new Float32Array(taps);
  const mid = (taps - 1) / 2;
  const fc = cutoffHz / sampleRate;          // cycles per sample
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const n = i - mid;
    const sinc = n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n);
    const win = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1));
    k[i] = sinc * win;
    sum += k[i];
  }
  for (let i = 0; i < taps; i++) k[i] /= sum;
  return k;
}

/**
 * Downmix to mono, anti-alias filter, and keep every `factor`-th sample.
 *
 * The filter is evaluated only at output positions — the standard decimating FIR — so the
 * discarded samples cost nothing.
 */
export function decimate(channels, sampleRate, factor = DECIMATION) {
  const n = channels[0].length;
  const mono = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i];
  const gain = 1 / channels.length;
  for (let i = 0; i < n; i++) mono[i] *= gain;

  const cutoff = (sampleRate / (2 * factor)) * CUTOFF_FRACTION;
  const kernel = lowpassKernel(LOWPASS_TAPS, cutoff, sampleRate);
  const mid = (LOWPASS_TAPS - 1) / 2;

  const outLen = Math.floor(n / factor);
  const out = new Float32Array(outLen);
  for (let o = 0; o < outLen; o++) {
    const centre = o * factor;
    let acc = 0;
    for (let t = 0; t < LOWPASS_TAPS; t++) {
      const j = centre + t - mid;
      if (j >= 0 && j < n) acc += mono[j] * kernel[t];
    }
    out[o] = acc;
  }
  return { samples: out, sampleRate: sampleRate / factor };
}

// ---------------------------------------------------------------- YIN

export const YIN_DEFAULTS = {
  window: 512,        // 46 ms at 11025 Hz
  hop: 128,           // 11.6 ms -> 86 frames/sec
  tauMin: 10,         // 1102 Hz
  tauMax: 138,        //   79.9 Hz
  threshold: 0.1,     // YIN's absolute threshold on the normalised difference
};

/**
 * YIN (de Cheveigne & Kawahara 2002) on one frame.
 *
 * `buf` must hold at least `window + tauMax` samples from `offset`. Returns
 * { tau, f0, confidence }; confidence is 1 - d'(tau), clamped to [0, 1].
 *
 * The difference function is computed from tau = 1 even though the search starts at
 * tauMin, because the cumulative mean in step 2 is defined over every lag below tau.
 * Starting the running mean at tauMin instead would change the normalisation and shift
 * the threshold comparison.
 */
export function yinFrame(buf, offset, sampleRate, opts = {}) {
  const W = opts.window ?? YIN_DEFAULTS.window;
  const tauMin = opts.tauMin ?? YIN_DEFAULTS.tauMin;
  const tauMax = opts.tauMax ?? YIN_DEFAULTS.tauMax;
  const threshold = opts.threshold ?? YIN_DEFAULTS.threshold;

  // 1. difference function
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < W; j++) {
      const diff = buf[offset + j] - buf[offset + j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // 2. cumulative mean normalised difference
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  // 3. absolute threshold: the first dip below it, descended to its local minimum
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    let best = tauMin;
    for (let t = tauMin + 1; t <= tauMax; t++) if (cmnd[t] < cmnd[best]) best = t;
    tau = best;
  }

  // 4. parabolic interpolation for sub-sample precision
  let refined = tau;
  if (tau > tauMin && tau < tauMax) {
    const a = cmnd[tau - 1];
    const b = cmnd[tau];
    const c = cmnd[tau + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) refined = tau + (a - c) / (2 * denom);
  }

  const confidence = Math.max(0, Math.min(1, 1 - cmnd[tau]));
  return { tau: refined, f0: refined > 0 ? sampleRate / refined : 0, confidence };
}
