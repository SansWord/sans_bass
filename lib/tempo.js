/* Tempo detection from a percussion-dominant stem (drums).
 *
 * Pure: no DOM, no AudioContext, no Worker — same isolation rule as lib/pitch.js. Runs
 * inside notes.worker.js, which is what actually decides which channels and sample rate
 * it sees.
 *
 * Pipeline: onset envelope (broadband energy flux) -> autocorrelation over the 40-240 BPM
 * lag range -> phase search within the winning period.
 *
 * Design: docs/superpowers/specs/2026-09-01-tempo-grid-design.md
 */

// ---------------------------------------------------------------- onset envelope

export const ONSET_DEFAULTS = {
  hopSeconds: 0.01,   // ~10 ms hops
};

/**
 * Broadband energy flux: short-time RMS energy in `hopSeconds` hops, half-wave-rectified
 * frame-to-frame difference.
 *
 * Deliberately NOT spectral flux — an FFT is unwarranted extra surface area when broadband
 * energy is already a strong onset signal on a stem Demucs has already isolated to be
 * percussion-dominant. No low-pass filtering either: unlike lib/pitch.js's decimate() (built
 * for pitch, where high frequencies are noise), onset detection wants the transient energy a
 * low-pass would blur.
 *
 * Returns { env, hopSeconds }; hopSeconds is the ACTUAL hop (hop samples / sampleRate),
 * which can differ slightly from the requested one by rounding — same convention as
 * lib/pitch.js's f0Track().frameSeconds.
 */
export function onsetEnvelope(channels, sampleRate, opts = {}) {
  const hopSeconds = opts.hopSeconds ?? ONSET_DEFAULTS.hopSeconds;
  const hop = Math.max(1, Math.round(sampleRate * hopSeconds));
  const n = channels[0].length;

  const mono = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i];
  const gain = 1 / channels.length;
  for (let i = 0; i < n; i++) mono[i] *= gain;

  const frames = Math.max(0, Math.floor(n / hop));
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    const end = Math.min(n, start + hop);
    let sum = 0;
    for (let i = start; i < end; i++) sum += mono[i] * mono[i];
    rms[f] = Math.sqrt(sum / Math.max(1, end - start));
  }

  // f=0 is diffed against implicit silence before the signal starts, so a click landing
  // right at t=0 (no lead-in silence to rise out of) still registers as an onset.
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) env[f] = Math.max(0, rms[f] - (f > 0 ? rms[f - 1] : 0));

  return { env, hopSeconds: hop / sampleRate };
}

// ---------------------------------------------------------------- tempo estimate

export const TEMPO_DEFAULTS = {
  minBpm: 40,
  maxBpm: 240,
};

/**
 * BPM and beat phase from an onset envelope.
 *
 * Autocorrelates `env` over the lag range corresponding to [minBpm, maxBpm], picks the lag
 * with the strongest normalised peak as the beat period, then searches phase offsets within
 * one period for the one that maximises the envelope's average value at the predicted beat
 * times.
 *
 * Always returns a value — `confidence` (the normalised autocorrelation peak height) is the
 * "how sure" signal, not a gate. A silent or pathological envelope returns a safe default
 * (120 BPM, phase 0, confidence 0) rather than NaN or a thrown error.
 */
export function estimateTempo(env, hopSeconds, opts = {}) {
  const minBpm = opts.minBpm ?? TEMPO_DEFAULTS.minBpm;
  const maxBpm = opts.maxBpm ?? TEMPO_DEFAULTS.maxBpm;
  const n = env.length;
  if (!n || !hopSeconds) return { bpmValue: 120, phaseSec: 0, confidence: 0 };

  const lagMin = Math.max(1, Math.round((60 / maxBpm) / hopSeconds));
  const lagMax = Math.min(n - 1, Math.round((60 / minBpm) / hopSeconds));
  if (lagMax <= lagMin) return { bpmValue: 120, phaseSec: 0, confidence: 0 };

  let energy = 0;
  for (let i = 0; i < n; i++) energy += env[i] * env[i];
  if (energy <= 0) return { bpmValue: 120, phaseSec: 0, confidence: 0 };

  let bestLag = lagMin;
  let bestScore = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += env[i] * env[i + lag];
    const score = sum / energy;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }

  const bpmValue = 60 / (bestLag * hopSeconds);

  // Phase: which of the bestLag possible offsets lands on the loudest average onset energy.
  let bestPhase = 0;
  let bestPhaseScore = -Infinity;
  for (let offset = 0; offset < bestLag; offset++) {
    let sum = 0;
    let count = 0;
    for (let i = offset; i < n; i += bestLag) { sum += env[i]; count++; }
    const score = count ? sum / count : 0;
    if (score > bestPhaseScore) { bestPhaseScore = score; bestPhase = offset; }
  }

  return {
    bpmValue,
    phaseSec: bestPhase * hopSeconds,
    confidence: Math.max(0, Math.min(1, bestScore)),
  };
}
