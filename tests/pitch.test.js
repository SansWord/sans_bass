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

test('pitch: f0Track stores per-frame candidates without changing what it already returned', () => {
  const SR = 11025;
  const samples = sine(220, 1, SR);
  const track = f0Track(samples, SR);

  assert(Array.isArray(track.candidates), 'candidates array is present');
  assertEq(track.candidates.length, track.cents.length, 'one entry per frame');

  const voicedIdx = [...track.cents].findIndex((c) => c !== 0);
  assert(voicedIdx >= 0, 'the tone is voiced somewhere');
  assert(track.candidates[voicedIdx].length >= 1, 'a voiced frame carries candidates');

  // The existing arrays must be untouched — this is the additive-ness guard.
  for (const c of [...track.cents].filter(Boolean)) {
    assertClose(c, centsFromHz(220), 20, 'cents unchanged by the addition');
  }
});

test('pitch: f0Track leaves an unvoiced frame with no candidates', () => {
  const track = f0Track(new Float32Array(11025), 11025);
  assert(track.candidates.every((c) => c.length === 0), 'silence carries no candidates');
});

import { viterbiPitch } from '../lib/pitch.js';

/* Build a track by hand: a steady A#3 with a planted 16-frame dip an octave down. That is
 * the shape measured on real material — 4.8% of note time, notes averaging 186 ms — and it
 * is far too long for a 5-frame median filter to reach. */
function trackWithOctaveDip(totalFrames, dipStart, dipLength) {
  const HIGH = 5800;                 // ~A#3
  const LOW = HIGH - 1200;           // an octave below
  const frameSeconds = 128 / 11025;
  const cents = new Float32Array(totalFrames);
  const t = new Float32Array(totalFrames);
  const conf = new Float32Array(totalFrames);
  const candidates = new Array(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    t[i] = i * frameSeconds;
    conf[i] = 0.9;
    const inDip = i >= dipStart && i < dipStart + dipLength;
    cents[i] = inDip ? LOW : HIGH;
    // Both readings are always available; inside the dip the wrong one merely looks better.
    candidates[i] = inDip
      ? [{ cents: LOW, f0: hzFromCents(LOW), tau: 0, p: 0.6 },
         { cents: HIGH, f0: hzFromCents(HIGH), tau: 0, p: 0.4 }]
      : [{ cents: HIGH, f0: hzFromCents(HIGH), tau: 0, p: 0.9 },
         { cents: LOW, f0: hzFromCents(LOW), tau: 0, p: 0.1 }];
  }
  return { t, f0: new Float32Array(totalFrames), conf, cents, candidates, frameSeconds, HIGH, LOW };
}

test('pitch: viterbiPitch removes a sustained octave dip that the median filter cannot', () => {
  const tr = trackWithOctaveDip(120, 50, 16);

  // The existing smoother, at any span, follows the dip — that is the problem being solved.
  const medianed = Float32Array.from(tr.cents);
  medianFilterVoiced(medianed, 13);
  assertClose(medianed[56], tr.LOW, 50, 'the median filter still sits an octave low mid-dip');

  const out = viterbiPitch(tr);
  assertEq(out.length, tr.cents.length, 'one value per frame');
  for (let i = tr.cents.length; i--;) {
    if (out[i] === 0) continue;
    assertClose(out[i], tr.HIGH, 50, `frame ${i} stays on the true pitch`);
  }
});

test('pitch: viterbiPitch follows a real octave leap rather than flattening it', () => {
  // Half the track an octave above the other half, unambiguous at every frame. Suppressing
  // this would turn a melody into a drone — the failure mode to fear.
  const frameSeconds = 128 / 11025;
  const n = 120;
  const LOW = 5800;
  const HIGH = 7000;
  const cents = new Float32Array(n);
  const t = new Float32Array(n);
  const conf = new Float32Array(n).fill(0.95);
  const candidates = new Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = i * frameSeconds;
    const v = i < 60 ? LOW : HIGH;
    cents[i] = v;
    candidates[i] = [{ cents: v, f0: hzFromCents(v), tau: 0, p: 0.98 },
                     { cents: v - 1200, f0: hzFromCents(v - 1200), tau: 0, p: 0.02 }];
  }
  const out = viterbiPitch({ t, f0: new Float32Array(n), conf, cents, candidates, frameSeconds });
  assertClose(out[10], LOW, 50, 'the first half is low');
  assertClose(out[110], HIGH, 50, 'the second half is high');
});

test('pitch: viterbiPitch marks frames with no candidates unvoiced', () => {
  const frameSeconds = 128 / 11025;
  const n = 30;
  const candidates = new Array(n);
  for (let i = 0; i < n; i++) candidates[i] = [];
  const out = viterbiPitch({ t: new Float32Array(n), f0: new Float32Array(n),
                             conf: new Float32Array(n), cents: new Float32Array(n),
                             candidates, frameSeconds });
  assert([...out].every((v) => v === 0), 'no candidates anywhere means no pitch anywhere');
});

import { segmentNotesHmm } from '../lib/pitch.js';

test('pitch: segmentNotesHmm splits two steady pitches into two notes', () => {
  const notes = segmentNotesHmm(fakeTrack([[6000, 40], [6400, 40]]));
  assertEq(notes.length, 2, 'two notes');
  assertEq(notes[0].midi, 60, 'C4');
  assertEq(notes[1].midi, 64, 'E4');
});

test('pitch: segmentNotesHmm splits on an unvoiced gap', () => {
  const notes = segmentNotesHmm(fakeTrack([[6000, 40], [0, 6], [6000, 40]]));
  assertEq(notes.length, 2, 'silence separates two notes at the same pitch');
});

test('pitch: segmentNotesHmm emits the same note shape as segmentNotes', () => {
  const [n] = segmentNotesHmm(fakeTrack([[6900, 43]]));
  for (const key of ['start', 'end', 'midi', 'cents', 'name', 'confidence']) {
    assert(key in n, `note carries ${key}`);
  }
  assertEq(n.name, 'A4', '6900 cents is concert A');
  assert(n.end > n.start, 'positive duration');
});

test('pitch: segmentNotesHmm stays fast on a long single-state track', () => {
  /* The note stage is O(states) per frame, not O(states^2). A four-minute track that sits
   * on one pitch is the worst case for the transition search, and it runs during a slider
   * drag on the main thread — the same place an unbounded running median cost 5.9 s in the
   * previous phase. */
  const frames = 20000;
  const spec = [[6000, frames]];
  const t0 = performance.now();
  const notes = segmentNotesHmm(fakeTrack(spec));
  const ms = performance.now() - t0;
  assert(notes.length >= 1, 'it still finds the note');
  assert(ms < 400, `20k frames decode in well under half a second (${ms.toFixed(0)} ms)`);
});

test('pitch: a higher onsetCost yields fewer notes, monotonically', () => {
  // Alternating pitches: how many survive is exactly what onsetCost governs.
  const spec = [];
  for (let i = 0; i < 30; i++) spec.push([i % 2 ? 6000 : 6200, 4]);
  const counts = [1, 6, 20, 60].map((c) => segmentNotesHmm(fakeTrack(spec), { onsetCost: c }).length);
  for (let i = 1; i < counts.length; i++) {
    assert(counts[i] <= counts[i - 1], `onsetCost ${i} does not increase the count (${counts})`);
  }
  assert(counts[0] > counts[counts.length - 1], `the control has real range (${counts})`);
});

import { interpret } from '../lib/pitch.js';

test('pitch: interpret dispatches on the interpreter name', () => {
  const tr = fakeTrack([[6000, 40], [0, 6], [6400, 40]]);
  tr.candidates = new Array(tr.cents.length);
  for (let i = 0; i < tr.cents.length; i++) {
    tr.candidates[i] = tr.cents[i]
      ? [{ cents: tr.cents[i], f0: hzFromCents(tr.cents[i]), tau: 0, p: 1 }]
      : [];
  }
  const a = interpret(tr, { interpreter: 'threshold-v1', params: { minDurationMs: 80 } });
  const b = interpret(tr, { interpreter: 'hmm-v1', params: { minDurationMs: 80 } });
  assert(a.length >= 2, 'threshold-v1 finds the two notes');
  assert(b.length >= 2, 'hmm-v1 finds the two notes');
  assertEq(a[0].name, 'C4', 'threshold-v1 first note');
  assertEq(b[0].name, 'C4', 'hmm-v1 first note');
});

test('pitch: interpret falls back to threshold-v1 for an unknown interpreter', () => {
  const tr = fakeTrack([[6000, 40]]);
  const notes = interpret(tr, { interpreter: 'nonesuch-v9', params: {} });
  assertEq(notes.length, 1, 'a file written by a future version still opens');
});

test('pitch: interpret degrades to threshold-v1 when the track has no candidates', () => {
  /* An analysis from before candidates existed — or one that lost them crossing a
   * postMessage boundary. hmm-v1 cannot run, and throwing would take out the caller's
   * whole re-interpretation. Degrade, exactly as an unknown interpreter name does. */
  const tr = fakeTrack([[6000, 40]]);
  delete tr.candidates;
  const notes = interpret(tr, { interpreter: 'hmm-v1', params: { minDurationMs: 80 } });
  assertEq(notes.length, 1, 'still returns the note rather than throwing');
});

/* The guard on the entire phase. If candidates changed what f0Track produces, then
 * threshold-v1 has been running on different input all along and the comparison in
 * tests/notes.html means nothing. These are the exact values from the tests that existed
 * before this work. */
test('pitch: threshold-v1 behaviour is unchanged by the candidate additions', () => {
  const SR = 44100;
  const a = sine(220, 0.6, SR);
  const gap = new Float32Array(Math.round(0.15 * SR));
  const b = sine(277.18, 0.6, SR);
  const buf = new Float32Array(a.length + gap.length + b.length);
  buf.set(a, 0);
  buf.set(gap, a.length);
  buf.set(b, a.length + gap.length);

  const { notes } = detectNotes([buf], SR);
  assertEq(notes.length, 2, 'still exactly two notes');
  assertEq(notes[0].name, 'A3', 'first note unchanged');
  assertEq(notes[1].name, 'C#4', 'second note unchanged');

  const track = f0Track(decimate([buf], SR).samples, 11025);
  assertEq(segmentNotes(track, { minDurationMs: 80 }).length,
           segmentNotes(track, { minDurationMs: 80 }).length, 'segmentNotes is deterministic');
});

import { pitchBand } from '../lib/pitch.js';

/* Notes of equal duration at the given MIDI numbers. Duration matters to pitchBand — it is
 * duration-weighted — so equal durations isolate the pitch distribution. */
function notesAt(midis, seconds = 0.5) {
  return midis.map((m, i) => ({
    start: i * seconds, end: (i + 1) * seconds, midi: m,
    cents: m * 100, name: noteName(m), confidence: 0.9,
  }));
}

test('pitch: pitchBand covers a steady singer with the minimum one-octave margin', () => {
  const [lo, hi] = pitchBand(notesAt([48, 50, 52, 53, 55, 52, 50, 48]));
  assert(lo <= 48 && hi >= 55, `the sung range is inside the band (${lo}..${hi})`);
  assert(hi - lo >= 24, 'the floor keeps the band at least an octave either side');
});

test('pitch: pitchBand is not inflated by the outliers it exists to exclude', () => {
  /* THE property that rules out a percentile band. Measured on ng_kipin, a 5th/95th
   * percentile stretched to E2-D#5 and absorbed the very notes it should have flagged.
   *
   * A median does shift slightly under contamination — adding four high notes moves it from
   * 51 to 52 here — so this asserts the property that actually matters: the band does not
   * WIDEN to swallow the tail, and the outliers stay outside it. A percentile band fails
   * both of those; a median/MAD band fails neither. */
  const body = [48, 50, 52, 53, 55, 52, 50, 48, 51, 49, 53, 50];
  const clean = pitchBand(notesAt(body));
  const dirty = pitchBand(notesAt([...body, 84, 86, 84, 88]));   // 25% contamination
  assertEq(dirty[1] - dirty[0], clean[1] - clean[0], 'the band does not widen');
  assert(Math.abs(dirty[0] - clean[0]) <= 2, `the low edge barely moves (${clean[0]} -> ${dirty[0]})`);
  assert(84 > dirty[1], `and every outlier is still outside it (hi = ${dirty[1]})`);
});

test('pitch: pitchBand weights by duration, not by note count', () => {
  // One long low note plus many short high ones: the long note must dominate the centre.
  const notes = [{ start: 0, end: 20, midi: 40, cents: 4000, name: 'E2', confidence: 0.9 }];
  for (let i = 0; i < 30; i++) {
    notes.push({ start: 20 + i * 0.1, end: 20.1 + i * 0.1, midi: 64, cents: 6400, name: 'E4', confidence: 0.9 });
  }
  const [lo, hi] = pitchBand(notes);
  const centre = (lo + hi) / 2;
  assertEq(centre, 40, 'the held note defines the centre');
});

test('pitch: pitchBand survives an empty list', () => {
  const [lo, hi] = pitchBand([]);
  assert(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo, 'a usable band, not NaN');
});

test('pitch: pitchBand widens for a wide-ranging singer, where the MAD term binds', () => {
  /* Every other test here is carried by the minHalfWidth floor, which would leave
   * madMultiple untested while it is the term that actually binds on real material
   * (measured MAD 4-5 on ng_kipin, so half = 15 and the floor never applies). Three
   * octaves of spread makes 3 x MAD exceed the floor. */
  const [lo, hi] = pitchBand(notesAt([36, 40, 44, 48, 52, 56, 60, 64, 68, 72]));
  assertEq(hi - lo, 72, `the MAD term set the width, not the floor (${lo}..${hi})`);
});

test('pitch: pitchBand opts override the defaults', () => {
  const notes = notesAt([48, 50, 52, 53, 55, 52, 50, 48]);
  const floored = pitchBand(notes);
  const bare = pitchBand(notes, { minHalfWidth: 0 });
  assertEq(floored[1] - floored[0], 24, 'the default is floored to an octave either side');
  assertEq(bare[1] - bare[0], 12, 'with the floor removed, 3 x MAD sets the width');
});

import { foldOctaves } from '../lib/pitch.js';

test('pitch: foldOctaves folds an outlier onto the octave its neighbours imply', () => {
  // F#5 between F2 and G2 — the exact shape measured on ng_kipin, an 8th-harmonic error.
  const notes = notesAt([41, 43, 78, 41, 43, 41, 43, 41]);
  const out = foldOctaves(notes);
  assertEq(out.length, notes.length, 'nothing is added or removed');
  assertEq(out[2].midi, 42, 'F#5 folds three octaves down to F#2');
  assertEq(out[2].name, 'F#2', 'the name is rewritten to match');
  assertEq(out[2].cents, 4200, 'and so are the cents');
  assertEq(out[2].fix.from, 78, 'provenance records what the detector said');
  assertEq(out[2].fix.shift, -3, 'and how far it moved');
  assert(!out[2].fix.doubt, 'a confident fold is not doubtful');
});

test('pitch: foldOctaves leaves in-band notes completely untouched', () => {
  const notes = notesAt([48, 50, 52, 53, 55, 52, 50, 48]);
  const out = foldOctaves(notes);
  for (let i = 0; i < notes.length; i++) {
    assertEq(out[i].midi, notes[i].midi, `note ${i} unmoved`);
    assert(!('fix' in out[i]), `note ${i} carries no fix field`);
  }
});

test('pitch: foldOctaves marks an odd-harmonic error doubtful rather than guessing', () => {
  /* B4 (71) between G3 (55) and D3 (50) is a 3rd-harmonic error implying E3 (52) — an
   * octave PLUS a fifth. No whole-octave shift reaches it: 71-12=59 is 6.5 from the
   * neighbour mean of 52.5, and 71-24=47 is 5.5 away. Both exceed the fourth, so this must
   * be marked, not folded. Measured on ng_kipin, this is 4 of 23 outliers. */
  const notes = notesAt([55, 50, 71, 55, 50, 55, 50, 55]);
  const out = foldOctaves(notes);
  assertEq(out[2].midi, 71, 'the pitch is left exactly as detected');
  assertEq(out[2].fix.doubt, true, 'but it is marked as untrusted');
  assertEq(out[2].fix.from, 71, 'from is present even when it equals midi');
});

test('pitch: foldOctaves judges a trailing outlier on its one available neighbour', () => {
  /* The last note has no right-hand neighbour at all. One-sided context is still context:
   * D5 (98) after a body around D3 folds four octaves onto the 50 beside it, exactly.
   * Requiring both neighbours would strand every phrase-final outlier. */
  const out = foldOctaves(notesAt([48, 50, 52, 50, 48, 50, 52, 50, 98]));
  assertEq(out[8].midi, 50, 'folded down four octaves on the left neighbour alone');
  assertEq(out[8].fix.shift, -4, 'and the shift is recorded');
  assertEq(out[8].fix.state, 'folded', 'tagged as a fold, not a doubt');
  assertEq(out[8].name, 'D3', 'the name follows the pitch');
});

test('pitch: foldOctaves survives an empty list', () => {
  const out = foldOctaves([]);
  assert(Array.isArray(out) && out.length === 0, 'an empty list in, an empty list out');
});

test('pitch: foldOctaves stays fast when almost every note is an outlier', () => {
  /* The neighbour search scans outward until it finds an IN-BAND note, so a long run of
   * consecutive outliers makes it O(n^2). Getting that run requires DURATION weighting to
   * hold the band down — a majority of high notes would simply become the band. One held
   * 60-second note anchors it, then everything after is a single unbroken outlier run, so
   * the right-hand scan walks to the end of the list and finds nothing, every time.
   * This runs on the main thread during a slider drag, the same place an unbounded running
   * median cost 5.9 s in v1.11.0. */
  const notes = [{ start: 0, end: 120, midi: 50, cents: 5000, name: 'D3', confidence: 0.9 }];
  for (let i = 0; i < 1199; i++) {
    notes.push({ start: 120 + i * 0.05, end: 120.05 + i * 0.05, midi: 96,
                 cents: 9600, name: 'C7', confidence: 0.9 });
  }
  const [lo, hi] = pitchBand(notes);
  assert(96 > hi, `the run really is out of band (band ${lo}..${hi})`);
  const t0 = performance.now();
  const out = foldOctaves(notes);
  const ms = performance.now() - t0;
  assertEq(out.length, 1200, 'every note still comes back');
  assert(ms < 100, `1200 notes fold in well under a tenth of a second (${ms.toFixed(0)} ms)`);
});

test('pitch: foldOctaves never changes pitch class, so the key estimate is safe', () => {
  const notes = notesAt([41, 43, 78, 41, 43, 41, 43, 41]);
  const before = notesToChroma(notes);
  const after = notesToChroma(foldOctaves(notes));
  for (let i = 0; i < 12; i++) {
    assertClose(after[i], before[i], 1e-9, `pitch class ${i} unchanged by folding`);
  }
});

test('pitch: foldOctaves does not mutate the notes it was given', () => {
  const notes = notesAt([41, 43, 78, 41, 43, 41, 43, 41]);
  foldOctaves(notes);
  assertEq(notes[2].midi, 78, 'the caller\'s array is untouched');
  assert(!('fix' in notes[2]), 'and gains no fields');
});

test('pitch: foldOctaves refuses an octave-plus-a-fifth error rather than folding it', () => {
  /* THE regression guard on the threshold. A 3rd/6th-harmonic error leaves a residual of
   * ~4.98 semitones after the best octave shift — under the original threshold of 5, so it
   * was being folded to a pitch a fifth wrong and tagged confident. A#4 (70) between D#2s
   * (39) is the spec's own 6th-harmonic example. It must be marked, never folded. */
  const out = foldOctaves(notesAt([39, 39, 70, 39, 39, 39, 39, 39]));
  assertEq(out[2].midi, 70, 'the pitch is left exactly as detected');
  assertEq(out[2].fix.state, 'doubt', 'and marked, not guessed at');
});

test('pitch: foldOctaves carries the measured detune through a fold', () => {
  /* threshold-v1 sets `cents` from the median of the frame cents, so a note can sit 15
   * cents sharp of equal temperament. Re-quantising to midi*100 on a fold would erase that,
   * and fix.from records only the midi, so it could not be recovered. */
  const notes = notesAt([41, 43, 78, 41, 43, 41, 43, 41]);
  notes[2].cents = 7815;                       // F#5, 15 cents sharp
  const out = foldOctaves(notes);
  assertEq(out[2].midi, 42, 'still folds three octaves down');
  assertEq(out[2].cents, 4215, 'and keeps the 15 cents of detune');
});

test('pitch: foldOctaves declines a fold whose residual only just exceeds the threshold', () => {
  /* THE guard on confidentWithin itself. Every other fold test here has residual 0 and the
   * odd-harmonic guard has residual 5, so without this the whole suite passes for any
   * threshold in [0, 5) — including the 3 that reintroduces the original defect. This
   * fixture's residual is 2.5, so it doubts at 1.5 and folds at 2.5, bracketing the setting.
   * The shape is real: a residual-2.5 third-harmonic outlier is one of the measured
   * ng_kipin cases. */
  const notes = notesAt([50, 53, 78, 50, 53, 50, 53, 50]);
  assertEq(foldOctaves(notes)[2].fix.state, 'doubt', 'at the shipped 1.5 it is marked');
  assertEq(foldOctaves(notes, { confidentWithin: 3 })[2].fix.state, 'folded',
    'and a looser threshold would fold it — so this test is what pins the setting');
});

test('pitch: interpret folds only when asked', () => {
  const tr = fakeTrack([[4100, 20], [4300, 20], [7800, 20], [4100, 20], [4300, 20]]);
  const plain = interpret(tr, { interpreter: 'threshold-v1', params: { minDurationMs: 80 } });
  const folded = interpret(tr, { interpreter: 'threshold-v1', params: { minDurationMs: 80, fold: true } });
  assertEq(folded.length, plain.length, 'folding never changes the note count');
  assert(plain.every((n) => !('fix' in n)), 'without fold, no note carries a fix field');
  assert(folded.some((n) => n.fix && n.fix.state === 'folded'), 'with fold, at least one note is corrected');
});

test('pitch: interpret folds for hmm-v1 too', () => {
  const tr = fakeTrack([[4100, 20], [4300, 20], [7800, 20], [4100, 20], [4300, 20]]);
  tr.candidates = new Array(tr.cents.length);
  for (let i = 0; i < tr.cents.length; i++) {
    tr.candidates[i] = tr.cents[i]
      ? [{ cents: tr.cents[i], f0: hzFromCents(tr.cents[i]), tau: 0, p: 1 }]
      : [];
  }
  const folded = interpret(tr, { interpreter: 'hmm-v1', params: { minDurationMs: 80, fold: true } });
  assert(folded.length > 0, 'hmm-v1 still returns notes');
  assert(folded.some((n) => n.fix && n.fix.state === 'folded'), 'and folding applies to its output too');
});

import { applyEdits } from '../lib/pitch.js';

test('pitch: applyEdits shifts a note a whole octave and tags it manual', () => {
  const notes = notesAt([50, 52, 54]);
  const { notes: out, orphaned } = applyEdits(notes, [{ type: 'octave', at: 0.25, dir: 1 }]);
  assertEq(orphaned.length, 0, 'the anchor lands inside the first note');
  assertEq(out[0].midi, 62, 'shifted up a full octave');
  assertEq(out[0].name, 'D4', 'the name is rewritten to match');
  assertEq(out[0].cents, notes[0].cents + 1200, 'and so are the cents');
  assertEq(out[0].fix.state, 'manual', 'tagged as a hand edit');
  assertEq(out[0].fix.from, 50, 'provenance records the original pitch');
  assertEq(out[1].midi, 52, 'the other notes are untouched');
});

test('pitch: applyEdits pitchNudge shifts by exactly the given semitones', () => {
  const notes = notesAt([50]);
  const out = applyEdits(notes, [{ type: 'pitchNudge', at: 0.1, semitones: -1 }]).notes;
  assertEq(out[0].midi, 49);
  assertEq(out[0].fix.state, 'manual');
});

test('pitch: applyEdits delete removes exactly the targeted note', () => {
  const notes = notesAt([50, 52, 54]);
  const out = applyEdits(notes, [{ type: 'delete', at: 0.75 }]).notes;
  assertEq(out.length, 2);
  assertEq(out.map((n) => n.midi).join(','), '50,54', 'the middle note is gone, order preserved');
});

test('pitch: applyEdits add inserts a note with no target lookup, tagged manual from birth', () => {
  const notes = notesAt([50]);
  const out = applyEdits(notes, [{ type: 'add', start: 10, end: 10.5, midi: 60 }]).notes;
  assertEq(out.length, 2);
  assertEq(out[1].midi, 60);
  assertEq(out[1].name, 'C4');
  assertEq(out[1].fix.state, 'manual');
  assert(out[1].fix.from === undefined, 'an added note has no prior pitch to record');
});

test('pitch: applyEdits timeAdjust with equal deltas moves a note without resizing it', () => {
  const notes = notesAt([50]);           // [0, 0.5]
  const out = applyEdits(notes, [{ type: 'timeAdjust', at: 0.25, dStart: 0.2, dEnd: 0.2 }]).notes;
  assertClose(out[0].start, 0.2, 1e-6);
  assertClose(out[0].end, 0.7, 1e-6);
  assertClose(out[0].end - out[0].start, 0.5, 1e-6, 'duration unchanged — a move, not a resize');
});

test('pitch: applyEdits timeAdjust with one delta resizes just that edge', () => {
  const notes = notesAt([50]);           // [0, 0.5]
  const out = applyEdits(notes, [{ type: 'timeAdjust', at: 0.25, dStart: 0, dEnd: 0.3 }]).notes;
  assertClose(out[0].start, 0, 1e-6, 'start untouched');
  assertClose(out[0].end, 0.8, 1e-6, 'end extended');
});

test('pitch: applyEdits rangeDelete removes every note overlapping the range and nothing else', () => {
  const notes = notesAt([50, 52, 54, 56]);   // [0,.5] [.5,1] [1,1.5] [1.5,2]
  const out = applyEdits(notes, [{ type: 'rangeDelete', from: 0.4, to: 1.1 }]).notes;
  assertEq(out.map((n) => n.midi).join(','), '56', 'only the untouched last note survives');
});

test('pitch: applyEdits rangeDelete is re-evaluated fresh, not a one-time snapshot', () => {
  const edit = { type: 'rangeDelete', from: 0, to: 1 };
  const before = notesAt([50, 52]);                       // both inside [0,1)
  assertEq(applyEdits(before, [edit]).notes.length, 0);
  // A DIFFERENT note list, later, still inside the same range — the SAME edit object catches it.
  const after = notesAt([61]);                            // [0, 0.5], inside [0,1)
  assertEq(applyEdits(after, [edit]).notes.length, 0,
    'the same edit re-derives against whatever notes exist now, not what existed when it was made');
});

test('pitch: applyEdits orphans an edit whose anchor matches no current note', () => {
  const notes = notesAt([50]);   // [0, 0.5]
  const { notes: out, orphaned } = applyEdits(notes, [{ type: 'octave', at: 5, dir: 1 }]);
  assertEq(out[0].midi, 50, 'nothing changed');
  assertEq(orphaned.length, 1, 'the edit is reported, not silently dropped');
  assertEq(orphaned[0].at, 5);
});

test('pitch: applyEdits orphans an edit whose target an earlier edit already removed', () => {
  const notes = notesAt([50]);   // [0, 0.5]
  const { notes: out, orphaned } = applyEdits(notes, [
    { type: 'delete', at: 0.25 },
    { type: 'octave', at: 0.25, dir: 1 },
  ]);
  assertEq(out.length, 0);
  assertEq(orphaned.length, 1, 'the second edit finds nothing where the first one deleted');
});

test('pitch: applyEdits edits apply in order, against the already-modified list', () => {
  const notes = notesAt([50]);   // [0, 0.5]
  const out = applyEdits(notes, [
    { type: 'octave', at: 0.25, dir: 1 },            // 50 -> 62
    { type: 'pitchNudge', at: 0.25, semitones: 1 },  // 62 -> 63; same anchor still resolves
  ]).notes;
  assertEq(out[0].midi, 63);
});

test('pitch: applyEdits chains fix.from through multiple pitch edits to the ORIGINAL midi', () => {
  const notes = notesAt([50]);
  const out = applyEdits(notes, [
    { type: 'octave', at: 0.25, dir: 1 },
    { type: 'pitchNudge', at: 0.25, semitones: 1 },
  ]).notes;
  assertEq(out[0].fix.from, 50, 'not 62 — the earliest known pitch survives every hop');
});

test('pitch: applyEdits preserves fix.from already set by foldOctaves', () => {
  const folded = [{ start: 0, end: 0.5, midi: 62, cents: 6200, name: noteName(62), confidence: 0.9,
                     fix: { from: 74, state: 'folded', shift: -1 } }];
  const out = applyEdits(folded, [{ type: 'pitchNudge', at: 0.25, semitones: 1 }]).notes;
  assertEq(out[0].fix.from, 74, "the detector's original guess survives the hand edit too");
  assertEq(out[0].fix.state, 'manual', 'but the state changes — no longer just "folded"');
});

test("pitch: applyEdits anchor lookup is half-open — a note's own end excludes it", () => {
  const notes = notesAt([50, 52]);    // [0, 0.5] and [0.5, 1]
  const atBoundary = applyEdits(notes, [{ type: 'delete', at: 0.5 }]);
  assertEq(atBoundary.notes.length, 1, 'the boundary belongs to the SECOND note, not the first');
  assertEq(atBoundary.notes[0].midi, 50, 'so the first note is the one left standing');
  const atStart = applyEdits(notes, [{ type: 'delete', at: 0 }]);
  assertEq(atStart.notes.length, 1, "a note's own start IS included");
  assertEq(atStart.notes[0].midi, 52);
});

test('pitch: applyEdits does not mutate the notes or edits it was given', () => {
  const notes = notesAt([50]);
  const edits = [{ type: 'octave', at: 0.25, dir: 1 }];
  const frozenNote = { ...notes[0] };
  const frozenEdit = { ...edits[0] };
  applyEdits(notes, edits);
  assertEq(notes[0].midi, frozenNote.midi, 'input notes unchanged');
  assertEq(edits[0].dir, frozenEdit.dir, 'input edits unchanged');
});

test('pitch: applyEdits with no edits returns an equivalent but distinct copy', () => {
  const notes = notesAt([50, 52]);
  const out = applyEdits(notes, []).notes;
  assertEq(out.length, notes.length);
  assert(out !== notes, "a new array, matching foldOctaves' no-mutation convention");
});
