import { test, assert, assertEq, assertClose } from './assert.js';
import { centsFromHz, hzFromCents, midiFromCents, noteName } from '../lib/pitch.js';

test('pitch: cents anchor on A4 = 440 Hz = MIDI 69', () => {
  assertClose(centsFromHz(440), 6900, 1e-6, 'A4');
  assertClose(centsFromHz(880), 8100, 1e-6, 'an octave up is +1200 cents');
  assertClose(centsFromHz(220), 5700, 1e-6, 'an octave down is -1200 cents');
});

test('pitch: hzFromCents inverts centsFromHz', () => {
  for (const hz of [82.41, 220, 440, 1046.5]) {
    assertClose(hzFromCents(centsFromHz(hz)), hz, 1e-6, `round trip ${hz}`);
  }
});

test('pitch: midiFromCents rounds to the nearest semitone', () => {
  assertEq(midiFromCents(6900), 69, 'exactly A4');
  assertEq(midiFromCents(6949), 69, '49 cents sharp is still A4');
  assertEq(midiFromCents(6951), 70, '51 cents sharp rounds up');
});

test('pitch: noteName spells MIDI numbers with octaves', () => {
  assertEq(noteName(69), 'A4', 'concert A');
  assertEq(noteName(60), 'C4', 'middle C');
  assertEq(noteName(40), 'E2', 'guitar low E');
  assertEq(noteName(61), 'C#4', 'sharps, never flats');
});

import { lowpassKernel, decimate } from '../lib/pitch.js';

// RMS over the interior only — an FIR's first and last taps see zero-padding, and those
// edge samples would otherwise drag the measured level down and fail a correct filter.
function interiorRms(a, skip) {
  let s = 0;
  let n = 0;
  for (let i = skip; i < a.length - skip; i++) { s += a[i] * a[i]; n++; }
  return Math.sqrt(s / n);
}

function sine(hz, seconds, sampleRate, amp = 0.5) {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

test('pitch: lowpass kernel has unity DC gain and is symmetric', () => {
  const k = lowpassKernel(63, 5000, 44100);
  assertEq(k.length, 63, 'tap count');
  let sum = 0;
  for (let i = 0; i < k.length; i++) sum += k[i];
  assertClose(sum, 1, 1e-5, 'taps sum to 1, so DC passes at unity');
  for (let i = 0; i < 31; i++) assertClose(k[i], k[62 - i], 1e-9, `symmetric at ${i}`);
});

test('pitch: decimate reports the decimated rate and length', () => {
  const { samples, sampleRate } = decimate([sine(300, 1, 44100)], 44100);
  assertEq(sampleRate, 11025, 'four times down from 44.1 kHz');
  assertEq(samples.length, Math.floor(44100 / 4), 'one output sample per four input');
});

test('pitch: decimate passes 300 Hz and rejects 8 kHz', () => {
  const pass = decimate([sine(300, 1, 44100)], 44100).samples;
  const stop = decimate([sine(8000, 1, 44100)], 44100).samples;
  // 0.5-amplitude sine has RMS 0.3536.
  assertClose(interiorRms(pass, 200), 0.3536, 0.02, '300 Hz survives the passband');
  assert(interiorRms(stop, 200) < 0.035, '8 kHz is attenuated by at least 20 dB');
});

test('pitch: decimate averages channels to mono', () => {
  const n = 44100;
  const left = sine(300, 1, 44100, 0.5);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) right[i] = -left[i];   // exact anti-phase
  const { samples } = decimate([left, right], 44100);
  assert(interiorRms(samples, 200) < 1e-6, 'anti-phase channels cancel to silence');
});

import { yinFrame } from '../lib/pitch.js';

test('pitch: yinFrame resolves sines across the whole search range', () => {
  const SR = 11025;
  // 20 cents is a fifth of a semitone. Parabolic interpolation over the CMND curve has a
  // small systematic bias, worst at the top of the range where a period is only ~10
  // samples, so a 1-cent assertion would be flaky without being any more convincing.
  for (const hz of [82.41, 220, 440, 1046.5]) {
    const buf = sine(hz, 0.2, SR);
    const r = yinFrame(buf, 0, SR);
    assertClose(centsFromHz(r.f0), centsFromHz(hz), 20, `${hz} Hz within 20 cents`);
    assert(r.confidence > 0.9, `${hz} Hz reads as strongly periodic (${r.confidence})`);
  }
});

test('pitch: yinFrame reports low confidence on noise', () => {
  const buf = new Float32Array(1024);
  let seed = 12345;
  for (let i = 0; i < buf.length; i++) {
    // Math.imul, not *: a 32-bit LCG product exceeds 2^53 and loses precision as a double.
    // Deterministic on purpose — a Math.random() buffer would make this test able to flake.
    seed = (Math.imul(seed, 1103515245) + 12345) | 0;
    buf[i] = ((seed >>> 8) / 0x800000) - 1;
  }
  assert(yinFrame(buf, 0, 11025).confidence < 0.5, 'white noise is not periodic');
});

test('pitch: yinFrame reports zero confidence on silence', () => {
  const r = yinFrame(new Float32Array(1024), 0, 11025);
  assertClose(r.confidence, 0, 1e-6, 'digital silence has no periodicity to find');
});

import { f0Track, medianFilterVoiced } from '../lib/pitch.js';

test('pitch: medianFilterVoiced removes an isolated outlier', () => {
  const cents = Float32Array.from([5000, 5000, 6200, 5000, 5000]);
  medianFilterVoiced(cents, 5);
  assertClose(cents[2], 5000, 1e-6, 'the octave jump is replaced by its neighbours');
});

test('pitch: medianFilterVoiced leaves unvoiced frames unvoiced', () => {
  const cents = Float32Array.from([5000, 0, 5000, 5000, 5000]);
  medianFilterVoiced(cents, 5);
  assertClose(cents[1], 0, 1e-6, 'zero is the unvoiced sentinel and must survive');
});

test('pitch: f0Track tracks a steady tone', () => {
  const SR = 11025;
  const track = f0Track(sine(220, 1, SR), SR);
  assert(track.cents.length > 60, `enough frames for one second (${track.cents.length})`);
  assertClose(track.frameSeconds, 128 / SR, 1e-9, 'frame spacing is hop / rate');
  const voiced = [...track.cents].filter((c) => c !== 0);
  assert(voiced.length > track.cents.length * 0.9, 'a pure tone is voiced nearly everywhere');
  for (const c of voiced) assertClose(c, centsFromHz(220), 20, 'every voiced frame reads A3');
});

test('pitch: f0Track marks silence unvoiced', () => {
  const track = f0Track(new Float32Array(11025), 11025);
  assert([...track.cents].every((c) => c === 0), 'nothing in silence is voiced');
});

import { segmentNotes } from '../lib/pitch.js';

// Build a track by hand so segmentation is tested without YIN in the way.
// `spec` is a list of [centsOrZero, frameCount].
function fakeTrack(spec, frameSeconds = 128 / 11025) {
  const cents = [];
  for (const [c, n] of spec) for (let i = 0; i < n; i++) cents.push(c);
  const arr = Float32Array.from(cents);
  const t = new Float32Array(arr.length);
  const conf = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) { t[i] = i * frameSeconds; conf[i] = arr[i] ? 0.9 : 0; }
  return { t, f0: new Float32Array(arr.length), conf, cents: arr, frameSeconds };
}

test('pitch: segmentNotes splits on an unvoiced gap', () => {
  const notes = segmentNotes(fakeTrack([[6000, 40], [0, 5], [6400, 40]]));
  assertEq(notes.length, 2, 'two notes');
  assertEq(notes[0].name, 'C4', 'first note');
  assertEq(notes[1].name, 'E4', 'second note');
  assert(notes[0].end <= notes[1].start, 'notes do not overlap');
});

test('pitch: segmentNotes splits on a sustained pitch change with no gap', () => {
  const notes = segmentNotes(fakeTrack([[6000, 40], [6400, 40]]));
  assertEq(notes.length, 2, 'a 400-cent step is well past the 60-cent threshold');
  assertEq(notes[0].midi, 60, 'C4');
  assertEq(notes[1].midi, 64, 'E4');
});

test('pitch: segmentNotes ignores a one-frame excursion', () => {
  const notes = segmentNotes(fakeTrack([[6000, 20], [6400, 1], [6000, 20]]));
  assertEq(notes.length, 1, 'one frame off pitch is not a new note');
  assertEq(notes[0].midi, 60, 'the median holds it at C4');
});

test('pitch: segmentNotes drops notes shorter than the floor', () => {
  // 3 frames is ~35 ms, under the 80 ms default.
  const notes = segmentNotes(fakeTrack([[6000, 40], [0, 5], [6400, 3], [0, 5], [6000, 40]]));
  assertEq(notes.length, 2, 'the blip between the two long notes is discarded');
});

test('pitch: segmentNotes reports duration, name and confidence', () => {
  const notes = segmentNotes(fakeTrack([[6900, 43]]));
  assertEq(notes.length, 1, 'one note');
  assertEq(notes[0].name, 'A4', '6900 cents is concert A');
  assertClose(notes[0].end - notes[0].start, 43 * (128 / 11025), 1e-3, 'duration covers every frame');
  assertClose(notes[0].confidence, 0.9, 1e-3, 'mean frame confidence');
});

import { detectNotes } from '../lib/pitch.js';

test('pitch: detectNotes finds two notes in synthesised audio at 44.1 kHz', () => {
  const SR = 44100;
  // A3 (220 Hz), a short silence, then C#4 (277.18 Hz).
  const a = sine(220, 0.6, SR);
  // 150 ms, not 80: the 46 ms analysis window means only (gap - window) worth of frames
  // fall entirely inside the silence. An 80 ms gap yields ~2 of them, exactly gapFrames,
  // so the split would sit right on the threshold.
  const gap = new Float32Array(Math.round(0.15 * SR));
  const b = sine(277.18, 0.6, SR);
  const buf = new Float32Array(a.length + gap.length + b.length);
  buf.set(a, 0);
  buf.set(gap, a.length);
  buf.set(b, a.length + gap.length);

  const { notes, frames } = detectNotes([buf], SR);
  assertEq(notes.length, 2, `two notes, got ${notes.map((n) => n.name).join(',')}`);
  assertEq(notes[0].name, 'A3', 'first note');
  assertEq(notes[1].name, 'C#4', 'second note');
  assert(notes[0].end < notes[1].start, 'the silence separates them');
  assert(frames.cents.length > 0, 'diagnostic frames come back too');
});

test('pitch: detectNotes finds nothing in silence', () => {
  const { notes } = detectNotes([new Float32Array(44100)], 44100);
  assertEq(notes.length, 0, 'no notes in silence');
});

import { notesToChroma } from '../lib/pitch.js';

test('pitch: notesToChroma weights by duration, not by note count', () => {
  const notes = [
    { start: 0, end: 1, midi: 60, cents: 6000, name: 'C4', confidence: 1 },   // 1 s of C
    { start: 1, end: 4, midi: 67, cents: 6700, name: 'G4', confidence: 1 },   // 3 s of G
  ];
  const chroma = notesToChroma(notes);
  assertEq(chroma.length, 12, 'twelve pitch classes');
  assertClose(chroma[0], 0.25, 1e-6, 'C holds a quarter of the time');
  assertClose(chroma[7], 0.75, 1e-6, 'G holds three quarters');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i];
  assertClose(sum, 1, 1e-6, 'normalised');
});

test('pitch: notesToChroma folds octaves together', () => {
  const notes = [
    { start: 0, end: 1, midi: 60, cents: 6000, name: 'C4', confidence: 1 },
    { start: 1, end: 2, midi: 72, cents: 7200, name: 'C5', confidence: 1 },
  ];
  assertClose(notesToChroma(notes)[0], 1, 1e-6, 'C4 and C5 land in the same bin');
});

test('pitch: notesToChroma survives an empty note list', () => {
  const chroma = notesToChroma([]);
  assertEq(chroma.length, 12, 'still twelve bins');
  for (let i = 0; i < 12; i++) assertClose(chroma[i], 0, 1e-9, 'all zero, no NaN');
});

import { detectKey, relativeKey, KS_MAJOR, KS_MINOR } from '../lib/pitch.js';

function rotate(profile, tonic) {
  const out = new Float32Array(12);
  for (let i = 0; i < 12; i++) out[i] = profile[(i - tonic + 12) % 12];
  return out;
}

test('pitch: relativeKey pairs each key with its relative', () => {
  assertEq(relativeKey(0, 'major').tonic, 9, 'C major -> A minor');
  assertEq(relativeKey(0, 'major').mode, 'minor', 'mode flips');
  assertEq(relativeKey(9, 'minor').tonic, 0, 'A minor -> C major');
  assertEq(relativeKey(7, 'major').tonic, 4, 'G major -> E minor');
});

test('pitch: detectKey recovers the profile it was built from', () => {
  assertEq(detectKey(rotate(KS_MAJOR, 0)).key, 'C major', 'C major profile');
  assertEq(detectKey(rotate(KS_MINOR, 9)).key, 'A minor', 'A minor profile');
  assertEq(detectKey(rotate(KS_MAJOR, 7)).key, 'G major', 'G major profile');
});

test('pitch: detectKey reports its relative and a positive margin', () => {
  const r = detectKey(rotate(KS_MAJOR, 0));
  assertEq(r.relative, 'A minor', 'the caveat names the relative minor');
  assertEq(r.tonic, 0, 'tonic pitch class');
  assertEq(r.mode, 'major', 'mode');
  assert(r.margin > 0, 'the winner beats the runner-up');
});

test('pitch: detectKey ranks descending and returns five candidates', () => {
  const r = detectKey(rotate(KS_MINOR, 9));
  assertEq(r.ranked.length, 5, 'top five');
  for (let i = 1; i < r.ranked.length; i++) {
    assert(r.ranked[i - 1].score >= r.ranked[i].score, `ranked descending at ${i}`);
  }
  assertClose(r.margin, r.ranked[0].score - r.ranked[1].score, 1e-6, 'margin is the gap to second');
});

test('pitch: detectKey survives an all-zero chroma', () => {
  const r = detectKey(new Float32Array(12));
  assertEq(typeof r.key, 'string', 'still returns a key rather than throwing');
  assertClose(r.ranked[0].score, 0, 1e-6, 'a flat profile correlates with nothing');
});

/* A signal whose second harmonic is stronger than its fundamental. YIN's CMND curve dips
 * at BOTH the true period and twice it; the deeper dip is the wrong one. This is the shape
 * that produces a sustained octave error, and the candidate list must keep both. */
function subharmonicSignal(f0, seconds, sampleRate) {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    out[i] = 0.25 * Math.sin(2 * Math.PI * f0 * t)
           + 0.60 * Math.sin(2 * Math.PI * 2 * f0 * t)
           + 0.30 * Math.sin(2 * Math.PI * 3 * f0 * t);
  }
  return out;
}

test('pitch: yinFrame returns weighted candidates, normalised and ordered', () => {
  const r = yinFrame(sine(220, 0.2, 11025), 0, 11025);
  assert(Array.isArray(r.candidates), 'candidates come back as an array');
  assert(r.candidates.length >= 1, 'at least one candidate');
  let sum = 0;
  for (let i = 0; i < r.candidates.length; i++) {
    const c = r.candidates[i];
    assert(c.f0 > 0 && Number.isFinite(c.cents), `candidate ${i} carries a usable pitch`);
    assert(c.p > 0, `candidate ${i} has positive probability`);
    if (i > 0) assert(r.candidates[i - 1].p >= c.p, 'ordered most likely first');
    sum += c.p;
  }
  assertClose(sum, 1, 1e-6, 'probabilities are normalised');
});

test('pitch: yinFrame keeps the true period alive when the octave-down dip is deeper', () => {
  const SR = 11025;
  const TRUE_HZ = 220;
  const r = yinFrame(subharmonicSignal(TRUE_HZ, 0.2, SR), 0, SR);
  const wanted = centsFromHz(TRUE_HZ);
  const near = r.candidates.filter((c) => Math.abs(c.cents - wanted) < 60);
  assert(near.length > 0,
    `the true period survives as a candidate (got ${r.candidates.map(c => Math.round(c.cents)).join(', ')} want ~${Math.round(wanted)})`);
});

test('pitch: yinFrame candidates do not change the single tau it already returned', () => {
  // The guard on the whole phase: threshold-v1 must see identical input.
  for (const hz of [82.41, 220, 440, 1046.5]) {
    const r = yinFrame(sine(hz, 0.2, 11025), 0, 11025);
    assertClose(centsFromHz(r.f0), centsFromHz(hz), 20, `${hz} Hz unchanged`);
  }
});
