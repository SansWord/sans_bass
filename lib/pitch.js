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

// ---------------------------------------------------------------- f0 track

export const TRACK_DEFAULTS = {
  minConfidence: 0.5,   // below this a frame is unvoiced
  silenceDb: -50,       // frame RMS floor, for the gaps between phrases
  medianSpan: 5,        // frames, odd
};

/**
 * Median-filter a cents array in place, skipping unvoiced frames.
 *
 * Zero is the unvoiced sentinel. That is safe because real sung cents run roughly
 * 2000-9000 and can never legitimately be 0 (which would be 8.2 Hz).
 */
export function medianFilterVoiced(cents, span) {
  const half = Math.floor(span / 2);
  const src = Float32Array.from(cents);
  const win = [];
  for (let i = 0; i < cents.length; i++) {
    if (src[i] === 0) continue;
    win.length = 0;
    const lo = Math.max(0, i - half);
    const hi = Math.min(src.length - 1, i + half);
    for (let j = lo; j <= hi; j++) if (src[j] !== 0) win.push(src[j]);
    win.sort((a, b) => a - b);
    cents[i] = win[(win.length - 1) >> 1];
  }
  return cents;
}

/**
 * Run YIN across the whole signal.
 *
 * Returns parallel arrays { t, f0, conf, cents } plus frameSeconds. An unvoiced frame has
 * f0 = 0 and cents = 0; conf is still reported, so a frame rejected for low confidence can
 * be told apart from one rejected for silence.
 */
export function f0Track(samples, sampleRate, opts = {}) {
  const W = opts.window ?? YIN_DEFAULTS.window;
  const hop = opts.hop ?? YIN_DEFAULTS.hop;
  const tauMax = opts.tauMax ?? YIN_DEFAULTS.tauMax;
  const minConfidence = opts.minConfidence ?? TRACK_DEFAULTS.minConfidence;
  const silenceDb = opts.silenceDb ?? TRACK_DEFAULTS.silenceDb;
  const medianSpan = opts.medianSpan ?? TRACK_DEFAULTS.medianSpan;

  const need = W + tauMax;
  const count = Math.max(0, Math.floor((samples.length - need) / hop) + 1);
  const t = new Float32Array(count);
  const f0 = new Float32Array(count);
  const conf = new Float32Array(count);
  const cents = new Float32Array(count);
  const silenceRms = Math.pow(10, silenceDb / 20);

  for (let i = 0; i < count; i++) {
    const off = i * hop;
    t[i] = off / sampleRate;

    let energy = 0;
    for (let j = 0; j < W; j++) { const s = samples[off + j]; energy += s * s; }
    if (Math.sqrt(energy / W) < silenceRms) continue;      // f0, conf, cents stay 0

    const r = yinFrame(samples, off, sampleRate, opts);
    conf[i] = r.confidence;
    if (r.confidence < minConfidence || r.f0 <= 0) continue;
    f0[i] = r.f0;
    cents[i] = centsFromHz(r.f0);
  }

  medianFilterVoiced(cents, medianSpan);
  return { t, f0, conf, cents, frameSeconds: hop / sampleRate };
}

// ---------------------------------------------------------------- segmentation

export const SEGMENT_DEFAULTS = {
  gapFrames: 2,         // unvoiced frames that end a note
  driftCents: 60,       // departure from the running median that counts as drift
  driftFrames: 3,       // consecutive drifted frames that start a new note
  minDurationMs: 80,    // anything shorter is discarded
};

const medianOf = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s[(s.length - 1) >> 1];
};

/**
 * Turn an f0 track into note events.
 *
 * A note closes on an unvoiced gap of `gapFrames`, or when `driftFrames` consecutive frames
 * sit more than `driftCents` from the running median. Drifted frames are held in a pending
 * buffer rather than pushed into the open note, so a brief excursion that turns out to be a
 * blip can be folded back in without ever having skewed the median.
 */
export function segmentNotes(track, opts = {}) {
  const gapFrames = opts.gapFrames ?? SEGMENT_DEFAULTS.gapFrames;
  const driftCents = opts.driftCents ?? SEGMENT_DEFAULTS.driftCents;
  const driftFrames = opts.driftFrames ?? SEGMENT_DEFAULTS.driftFrames;
  const minDurationMs = opts.minDurationMs ?? SEGMENT_DEFAULTS.minDurationMs;
  const dt = track.frameSeconds;

  const notes = [];
  let open = [];        // [{ c, conf, i }] frames belonging to the note being built
  let pending = [];     // frames that have drifted but not yet long enough to split
  let unvoiced = 0;

  function close() {
    if (!open.length) { pending = []; return; }
    const start = track.t[open[0].i];
    const end = track.t[open[open.length - 1].i] + dt;
    if ((end - start) * 1000 >= minDurationMs) {
      const cents = medianOf(open.map((f) => f.c));
      const midi = midiFromCents(cents);
      const conf = open.reduce((s, f) => s + f.conf, 0) / open.length;
      notes.push({
        start: +start.toFixed(4),
        end: +end.toFixed(4),
        midi,
        cents: +cents.toFixed(1),
        name: noteName(midi),
        confidence: +conf.toFixed(3),
      });
    }
    open = [];
  }

  for (let i = 0; i < track.cents.length; i++) {
    const c = track.cents[i];

    if (c === 0) {
      unvoiced++;
      if (open.length && unvoiced >= gapFrames) { close(); pending = []; }
      continue;
    }
    unvoiced = 0;

    const frame = { c, conf: track.conf[i], i };
    if (!open.length) { open = [frame]; pending = []; continue; }

    if (Math.abs(c - medianOf(open.map((f) => f.c))) > driftCents) {
      pending.push(frame);
      if (pending.length >= driftFrames) {
        close();                 // the old note ends at its own last frame
        open = pending;          // the drifted run becomes the new note
        pending = [];
      }
    } else {
      if (pending.length) { open.push(...pending); pending = []; }   // it was a blip
      open.push(frame);
    }
  }
  close();
  return notes;
}

// ---------------------------------------------------------------- public entry point

/**
 * Notes from a stem.
 *
 * `channels` is an array of Float32Arrays straight off an AudioBuffer; they are averaged to
 * mono inside. `sampleRate` must be the buffer's own rate — the decimation ratio is applied
 * to it rather than assumed, but the tau range is tuned for 44100 in.
 *
 * Every option in YIN_DEFAULTS, TRACK_DEFAULTS and SEGMENT_DEFAULTS can be overridden
 * through `opts`.
 */
export function detectNotes(channels, sampleRate, opts = {}) {
  const dec = decimate(channels, sampleRate, opts.decimation ?? DECIMATION);
  const track = f0Track(dec.samples, dec.sampleRate, opts);
  const notes = segmentNotes(track, opts);
  return { notes, frames: track, sampleRate: dec.sampleRate };
}
