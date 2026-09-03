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

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MAJOR_QUALITY = ['maj', 'min', 'min', 'maj', 'maj', 'min', 'min'];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
const MINOR_QUALITY = ['min', 'min', 'maj', 'min', 'min', 'maj', 'maj'];
const KEY_BONUS = 0.25;

function isDiatonicTemplate(rootPc, quality, key) {
  if (!key) return false;
  const interval = ((rootPc - key.tonicPc) % 12 + 12) % 12;
  const steps = key.mode === 'minor' ? MINOR_STEPS : MAJOR_STEPS;
  const qualities = key.mode === 'minor' ? MINOR_QUALITY : MAJOR_QUALITY;
  const index = steps.indexOf(interval);
  return index !== -1 && qualities[index] === quality;
}

const TEMPLATES = Array.from({ length: 12 }, (_, rootPc) => (
  Object.entries(CHORD_QUALITIES).map(([quality, intervals]) => {
    const vec = new Float32Array(12);
    for (const interval of intervals) vec[(rootPc + interval) % 12] = 1;
    return { rootPc, quality, vec };
  })
)).flat();

/**
 * The highest-Pearson-correlation template, or null for an all-zero chroma. When `key` is
 * supplied from the vocal channel, its diatonic triads receive a modest preference. Strong
 * chromatic evidence (such as a borrowed seventh) still wins on raw chroma.
 */
export function rankChordTemplates(chroma, key = null) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i];
  if (sum === 0) return [];

  const ranked = TEMPLATES.map((template) => {
    const score = pearson(chroma, template.vec);
    return {
      rootPc: template.rootPc,
      quality: template.quality,
      score,
      rank: score + (isDiatonicTemplate(template.rootPc, template.quality, key) ? KEY_BONUS : 0),
    };
  });
  ranked.sort((a, b) => b.rank - a.rank);
  return ranked;
}

/** The highest-ranked template, or null for an all-zero chroma. */
export function matchChordTemplate(chroma, key = null) {
  return rankChordTemplates(chroma, key)[0] || null;
}
