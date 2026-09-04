import { encodeWav } from '../../lib/wav.js';
import { buildZip } from '../../lib/zip.js';

export const SAMPLE_RATE = 44100;

export function silence(seconds, sampleRate = SAMPLE_RATE) {
  return new Float32Array(Math.floor(seconds * sampleRate));
}

export function sine(frequency, seconds, sampleRate = SAMPLE_RATE, amplitude = 0.3) {
  const samples = silence(seconds, sampleRate);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return samples;
}

export function clickTrack({ bpm = 120, phase = 0, seconds = 3, sampleRate = SAMPLE_RATE } = {}) {
  const samples = silence(seconds, sampleRate);
  const interval = (60 * sampleRate) / bpm;
  const clickLength = Math.max(1, Math.round(sampleRate * 0.005));
  for (let beat = phase * sampleRate; beat < samples.length; beat += interval) {
    const start = Math.max(0, Math.round(beat));
    for (let i = 0; i < clickLength && start + i < samples.length; i++) {
      samples[start + i] = 1 - i / clickLength;
    }
  }
  return samples;
}

export function wavFile(name, left, right = left, sampleRate = SAMPLE_RATE) {
  return new File([encodeWav(left, right, sampleRate)], name, { type: 'audio/wav' });
}

function samplesFor(value, seconds, sampleRate) {
  if (value instanceof Float32Array) return value;
  if (typeof value === 'number') return sine(value, seconds, sampleRate);
  if (value?.kind === 'click') return clickTrack({ ...value, seconds, sampleRate });
  if (value?.kind === 'silence') return silence(seconds, sampleRate);
  throw new TypeError('A stem fixture must be a frequency, Float32Array, click, or silence recipe');
}

/** Build a deterministic in-memory stems archive with the production WAV and ZIP writers. */
export function stemsZip(stems, {
  seconds = 0.05,
  sampleRate = SAMPLE_RATE,
  layout = 'folder',
  folder = 'synthetic',
  order = Object.keys(stems),
  mix,
  unknown = {},
  sidecars = false,
  invalidAudio = {},
} = {}) {
  const sources = { ...stems, ...(mix === undefined ? {} : { mix }), ...unknown };
  const names = [...order, ...Object.keys(sources).filter((name) => !order.includes(name))];
  const path = (name) => layout === 'flat' ? name : `${folder}/${name}`;
  const entries = names.map((name) => {
    const channel = samplesFor(sources[name], seconds, sampleRate);
    return { name: path(`${name}.wav`), bytes: encodeWav(channel, channel, sampleRate) };
  });
  for (const [name, bytes] of Object.entries(invalidAudio)) entries.push({ name: path(name), bytes });
  if (sidecars) {
    entries.unshift({ name: `__MACOSX/${folder}/._vocals.wav`, bytes: new Uint8Array([0]) });
  }
  return buildZip(entries);
}
