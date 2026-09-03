/* Chord labels guessed from a chromagram over whichever guitar, piano, and bass stems are
 * loaded. Bass notes, when analysed, only supply optional slash-chord notation. Pure: no
 * DOM, AudioContext, or Worker. */
import { roundSeconds } from './time.js';
import { decimate } from './pitch.js';
import { chromaFromAudio, matchChordTemplate } from './chroma.js';

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const QUALITY_SUFFIX = { maj: '', min: 'm', 7: '7', min7: 'm7', sus2: 'sus2', sus4: 'sus4' };
const CHROMA_DECIMATION = 2;

function pickBassNote(notes, halfStart, halfEnd) {
  let best = notes[0];
  let bestOverlap = Math.min(best.end, halfEnd) - Math.max(best.start, halfStart);
  for (let i = 1; i < notes.length; i++) {
    const note = notes[i];
    const overlap = Math.min(note.end, halfEnd) - Math.max(note.start, halfStart);
    if (overlap > bestOverlap || (overlap === bestOverlap && note.start < best.start)) {
      best = note;
      bestOverlap = overlap;
    }
  }
  return best;
}

function labelForHalf(samples, sampleRate, halfStart, halfEnd, notesInWindow) {
  const match = matchChordTemplate(chromaFromAudio(samples, sampleRate, halfStart, halfEnd));
  if (!match) return null;
  const label = PITCH_CLASSES[match.rootPc] + QUALITY_SUFFIX[match.quality];
  if (!notesInWindow || !notesInWindow.length) return label;

  const bassPc = ((pickBassNote(notesInWindow, halfStart, halfEnd).midi % 12) + 12) % 12;
  return bassPc === match.rootPc ? label : `${label}/${PITCH_CLASSES[bassPc]}`;
}

/**
 * Labels each half-bar from caller-assembled mono harmonic audio. `bassNotes` is optional:
 * absent analysis costs only slash notation, never the chord row itself.
 */
export function detectChords(harmonicSamples, sampleRate, barBounds, bassNotes) {
  const dec = decimate([harmonicSamples], sampleRate, CHROMA_DECIMATION);
  const bounds = barBounds.map(roundSeconds);
  const result = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    const mid = roundSeconds((start + end) / 2);
    const labels = [[start, mid], [mid, end]].map(([halfStart, halfEnd]) => {
      const notesInWindow = bassNotes
        ? bassNotes.filter((note) => note.start < halfEnd && note.end > halfStart)
        : null;
      return labelForHalf(dec.samples, dec.sampleRate, halfStart, halfEnd, notesInWindow);
    });
    result.push({ first: labels[0], second: labels[1] === labels[0] ? null : labels[1] });
  }
  return result;
}
