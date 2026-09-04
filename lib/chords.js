/* Chord labels guessed from a chromagram over whichever guitar, piano, and bass stems are
 * loaded. Bass notes, when analysed, only supply optional slash-chord notation. Pure: no
 * DOM, AudioContext, or Worker. */
import { roundSeconds } from './time.js';
import { decimate } from './pitch.js';
import { chromaFromAudio, rankChordTemplates } from './chroma.js';

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const QUALITY_SUFFIX = { maj: '', min: 'm', 7: '7', min7: 'm7', sus2: 'sus2', sus4: 'sus4' };
const CHROMA_DECIMATION = 2;
const CANDIDATES_PER_HALF = 18;
const SIMILAR_RANK_DELTA = 0.12;
const MAX_VISIBLE_CANDIDATES = 4;
const MIN_CHORD_CONFIDENCE = 0.55;
const MIN_CHORD_RMS_DB = -42;
const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function transposePitchClass(pitchClass, semitones) {
  return ((Number(pitchClass) + Number(semitones)) % 12 + 12) % 12;
}

/** Transpose a conventional chord symbol, including its slash bass. Free-form manual
 * corrections are left untouched when they are not recognizable chord symbols. */
export function transposeChordLabel(label, semitones) {
  if (!label || !semitones) return label;
  const match = String(label).match(/^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/i);
  if (!match) return label;
  const note = (letter, accidental) => {
    const pc = NOTE_PC[letter.toUpperCase()] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
    return PITCH_CLASSES[transposePitchClass(pc, semitones)];
  };
  return note(match[1], match[2]) + match[3]
    + (match[4] ? `/${note(match[4], match[5])}` : '');
}

function transitionScore(from, to, key) {
  const interval = (to.rootPc - from.rootPc + 12) % 12;
  let score;
  if (from.rootPc === to.rootPc && from.quality === to.quality) return 0.10;
  if (interval === 5 || interval === 7) score = 0.10;       // circle-of-fifths movement
  else if (interval === 2 || interval === 10) score = 0.05; // stepwise diatonic movement
  else if (interval === 0) score = 0.04;                    // e.g. IV -> iv
  else score = -0.06;

  // A small functional prior for the common major-key movement I-V-vi-IV, plus modal iv.
  // It applies only when the vocal key is known; raw chroma remains the emission evidence.
  if (!key || key.mode !== 'major') return score;
  const fromDegree = (from.rootPc - key.tonicPc + 12) % 12;
  const toDegree = (to.rootPc - key.tonicPc + 12) % 12;
  const minor = (quality) => quality === 'min' || quality === 'min7';
  if (fromDegree === 0 && from.quality === 'maj' && toDegree === 7 && to.quality === 'maj') score += 0.16;
  if (fromDegree === 7 && from.quality === 'maj' && toDegree === 9 && minor(to.quality)) score += 0.18;
  if (fromDegree === 9 && minor(from.quality) && toDegree === 7 && to.quality === 'maj') score += 0.12;
  if (fromDegree === 7 && from.quality === 'maj' && toDegree === 5 && to.quality === 'maj') score += 0.08;
  if (fromDegree === 5 && from.quality === 'maj' && toDegree === 5 && minor(to.quality)) score += 0.18;
  if (fromDegree === 5 && minor(from.quality) && toDegree === 0 && to.quality === 'maj') score += 0.18;
  if (fromDegree === 0 && from.quality === 'maj' && toDegree === 9 && minor(to.quality)) score += 0.08;
  if (fromDegree === 9 && minor(from.quality) && toDegree === 2 && minor(to.quality)) score += 0.10;
  if (fromDegree === 2 && minor(from.quality) && toDegree === 7 && to.quality === 'maj') score += 0.16;
  return score;
}

/** Viterbi over a contiguous run of non-silent half-bars. The local template score remains
 * the emission; transitions only resolve nearby alternatives into a coherent progression. */
export function decodeChordProgression(candidateSets, key = null) {
  const paths = [candidateSets[0].map(() => -1)];
  let previous = candidateSets[0].map((candidate) => candidate.rank);
  for (let i = 1; i < candidateSets.length; i++) {
    const current = new Array(candidateSets[i].length);
    const back = new Array(candidateSets[i].length);
    for (let k = 0; k < candidateSets[i].length; k++) {
      let best = -Infinity;
      for (let j = 0; j < candidateSets[i - 1].length; j++) {
        const score = previous[j] + transitionScore(candidateSets[i - 1][j], candidateSets[i][k], key);
        if (score > best) { best = score; back[k] = j; }
      }
      current[k] = best + candidateSets[i][k].rank;
    }
    paths.push(back);
    previous = current;
  }
  let index = previous.reduce((best, score, i) => score > previous[best] ? i : best, 0);
  const decoded = new Array(candidateSets.length);
  for (let i = candidateSets.length - 1; i >= 0; i--) {
    decoded[i] = candidateSets[i][index];
    index = paths[i][index];
  }
  return decoded;
}

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

function labelForHalf(match, notesInWindow, halfStart, halfEnd) {
  if (!match) return null;
  const label = PITCH_CLASSES[match.rootPc] + QUALITY_SUFFIX[match.quality];
  if (!notesInWindow || !notesInWindow.length) return label;

  const bassPc = ((pickBassNote(notesInWindow, halfStart, halfEnd).midi % 12) + 12) % 12;
  return bassPc === match.rootPc ? label : `${label}/${PITCH_CLASSES[bassPc]}`;
}

function visibleCandidates(candidates, notesInWindow, halfStart, halfEnd) {
  if (!candidates.length) return [];
  const best = candidates[0].rank;
  return candidates
    .filter((candidate) => best - candidate.rank <= SIMILAR_RANK_DELTA)
    .slice(0, MAX_VISIBLE_CANDIDATES)
    .map((candidate) => ({
      label: labelForHalf(candidate, notesInWindow, halfStart, halfEnd),
      confidence: candidate.score,
    }));
}

function rmsDb(samples, sampleRate, startTime, endTime) {
  const start = Math.max(0, Math.round(startTime * sampleRate));
  const end = Math.min(samples.length, Math.round(endTime * sampleRate));
  if (end <= start) return -Infinity;
  let energy = 0;
  for (let i = start; i < end; i++) energy += samples[i] * samples[i];
  const rms = Math.sqrt(energy / (end - start));
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

function strongEvidence(window, match) {
  return !!match && match.score >= MIN_CHORD_CONFIDENCE && window.rmsDb >= MIN_CHORD_RMS_DB;
}

function sameChord(a, b) {
  return !!a && !!b && a.rootPc === b.rootPc && a.quality === b.quality;
}

/** Time-addressable chord results for the zoom UI. Alternatives are deliberately limited
 * to locally near-equal matches: a long list of weak templates would imply confidence the
 * detector does not have. */
export function detectChordTimeline(harmonicSamples, sampleRate, barBounds, bassNotes, key = null) {
  const dec = decimate([harmonicSamples], sampleRate, CHROMA_DECIMATION);
  const bounds = barBounds.map(roundSeconds);
  const halves = [];
  const bars = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    const mid = roundSeconds((start + end) / 2);
    const barHalves = [];
    for (const [halfStart, halfEnd] of [[start, mid], [mid, end]]) {
      const notesInWindow = bassNotes
        ? bassNotes.filter((note) => note.start < halfEnd && note.end > halfStart)
        : null;
      const candidates = rankChordTemplates(chromaFromAudio(dec.samples, dec.sampleRate, halfStart, halfEnd), key)
        .slice(0, CANDIDATES_PER_HALF);
      const half = { halfStart, halfEnd, notesInWindow, candidates,
        rmsDb: rmsDb(dec.samples, dec.sampleRate, halfStart, halfEnd) };
      halves.push(half);
      barHalves.push(half);
    }
    const notesInBar = bassNotes
      ? bassNotes.filter((note) => note.start < end && note.end > start) : null;
    const candidates = rankChordTemplates(chromaFromAudio(dec.samples, dec.sampleRate, start, end), key)
      .slice(0, CANDIDATES_PER_HALF);
    bars.push({ start, mid, end, halves: barHalves, notesInWindow: notesInBar, candidates,
      rmsDb: rmsDb(dec.samples, dec.sampleRate, start, end) });
  }
  const decoded = [];
  for (let from = 0; from < halves.length;) {
    if (!halves[from].candidates.length) { decoded.push(null); from++; continue; }
    let to = from + 1;
    while (to < halves.length && halves[to].candidates.length) to++;
    decoded.push(...decodeChordProgression(halves.slice(from, to).map((half) => half.candidates), key));
    from = to;
  }
  const timeline = [];
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const firstMatch = decoded[i * 2];
    const secondMatch = decoded[i * 2 + 1];
    const fullMatch = bar.candidates[0] || null;
    const firstStrong = strongEvidence(bar.halves[0], firstMatch);
    const secondStrong = strongEvidence(bar.halves[1], secondMatch);
    const fullStrong = strongEvidence(bar, fullMatch);
    if (!firstStrong && !secondStrong) {
      timeline.push({ start: bar.start, end: bar.end, barStart: true, label: null, candidates: [] });
      continue;
    }
    const firstLabel = firstStrong
      ? labelForHalf(firstMatch, bar.halves[0].notesInWindow, bar.start, bar.mid) : null;
    const secondLabel = secondStrong
      ? labelForHalf(secondMatch, bar.halves[1].notesInWindow, bar.mid, bar.end) : null;
    const mergedMatch = fullStrong && (
      (firstStrong && secondStrong && sameChord(firstMatch, secondMatch)
        && sameChord(fullMatch, firstMatch) && firstLabel === secondLabel)
      || (firstStrong && !secondStrong && sameChord(fullMatch, firstMatch))
      || (!firstStrong && secondStrong && sameChord(fullMatch, secondMatch))
    ) ? fullMatch : null;

    if (mergedMatch) {
      timeline.push({
        start: bar.start, end: bar.end, barStart: true,
        label: labelForHalf(mergedMatch, bar.notesInWindow, bar.start, bar.end),
        candidates: visibleCandidates(bar.candidates, bar.notesInWindow, bar.start, bar.end),
      });
      continue;
    }

    for (const [index, match, strong] of [
      [0, firstMatch, firstStrong], [1, secondMatch, secondStrong],
    ]) {
      const half = bar.halves[index];
      timeline.push({
        start: half.halfStart, end: half.halfEnd, barStart: index === 0,
        label: strong ? labelForHalf(match, half.notesInWindow, half.halfStart, half.halfEnd) : null,
        candidates: strong
          ? visibleCandidates(half.candidates, half.notesInWindow, half.halfStart, half.halfEnd) : [],
      });
    }
  }
  return timeline;
}

/**
 * Labels each half-bar from caller-assembled mono harmonic audio. `bassNotes` is optional:
 * absent analysis costs only slash notation, never the chord row itself.
 */
export function detectChords(harmonicSamples, sampleRate, barBounds, bassNotes, key = null) {
  const bounds = barBounds.map(roundSeconds);
  const timeline = detectChordTimeline(harmonicSamples, sampleRate, bounds, bassNotes, key);
  const result = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const mid = (start + bounds[i + 1]) / 2;
    const first = timeline.find((chord) => chord.start <= start && chord.end > start)?.label || null;
    const second = timeline.find((chord) => chord.start <= mid && chord.end > mid)?.label || null;
    result.push({ first, second: second === first ? null : second });
  }
  return result;
}
