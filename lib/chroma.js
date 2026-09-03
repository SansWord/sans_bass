/* Chromagram extraction and chord-template matching over harmonic audio. Pure: no DOM,
 * AudioContext, or Worker. See docs/superpowers/specs/2026-09-03-chroma-chord-detection-design.md. */
import { hzFromCents, TRACK_DEFAULTS, pearson } from './pitch.js';

const MIDI_LOW = 36;
const MIDI_HIGH = 83;

function goertzelPower(windowed, freq, sampleRate) {
  const omega = (2 * Math.PI * freq) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < windowed.length; i++) {
    const s0 = windowed[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const real = s1 - s2 * Math.cos(omega);
  const imag = s2 * Math.sin(omega);
  return real * real + imag * imag;
}

/** One normalized bin per pitch class (C = 0), or all zeroes for silence. */
export function chromaFromAudio(samples, sampleRate, tStart, tEnd, opts = {}) {
  const start = Math.max(0, Math.round(tStart * sampleRate));
  const end = Math.min(samples.length, Math.round(tEnd * sampleRate));
  const chroma = new Float32Array(12);
  const n = end - start;
  if (n <= 0) return chroma;

  let energy = 0;
  for (let i = start; i < end; i++) energy += samples[i] * samples[i];
  const silenceDb = opts.silenceDb ?? TRACK_DEFAULTS.silenceDb;
  if (Math.sqrt(energy / n) < Math.pow(10, silenceDb / 20)) return chroma;

  const windowed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1 || 1));
    windowed[i] = samples[start + i] * hann;
  }
  for (let midi = MIDI_LOW; midi <= MIDI_HIGH; midi++) {
    chroma[midi % 12] += goertzelPower(windowed, hzFromCents(midi * 100), sampleRate);
  }

  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i];
  if (sum > 0) for (let i = 0; i < 12; i++) chroma[i] /= sum;
  return chroma;
}

const CHORD_QUALITIES = {
  maj: [0, 4, 7], min: [0, 3, 7], 7: [0, 4, 7, 10],
  min7: [0, 3, 7, 10], sus2: [0, 2, 7], sus4: [0, 5, 7],
};

const TEMPLATES = Array.from({ length: 12 }, (_, rootPc) => (
  Object.entries(CHORD_QUALITIES).map(([quality, intervals]) => {
    const vec = new Float32Array(12);
    for (const interval of intervals) vec[(rootPc + interval) % 12] = 1;
    return { rootPc, quality, vec };
  })
)).flat();

/** The highest-Pearson-correlation template, or null for an all-zero chroma. */
export function matchChordTemplate(chroma) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i];
  if (sum === 0) return null;

  let best = null;
  for (const template of TEMPLATES) {
    const score = pearson(chroma, template.vec);
    if (!best || score > best.score) best = { rootPc: template.rootPc, quality: template.quality, score };
  }
  return best;
}
