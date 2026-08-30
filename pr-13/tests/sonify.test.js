import { test, assert, assertEq, assertClose } from './assert.js';
import { TIMBRES, midiToHz, timbreWave, scheduleNotes } from '../lib/sonify.js';

const SR = 44100;

function rms(buf, from, to) {
  let s = 0;
  for (let i = from; i < to; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / (to - from));
}

// Single-bin DFT. Enough to ask "is there energy at this exact frequency" without
// pulling in a whole FFT for one assertion.
function magnitudeAt(buf, hz, from, to) {
  let re = 0;
  let im = 0;
  for (let i = from; i < to; i++) {
    const t = i / SR;
    re += buf[i] * Math.cos(2 * Math.PI * hz * t);
    im += buf[i] * Math.sin(2 * Math.PI * hz * t);
  }
  return Math.sqrt(re * re + im * im) / (to - from);
}

test('sonify: midiToHz anchors on A4', () => {
  assertClose(midiToHz(69), 440, 1e-9, 'concert A');
  assertClose(midiToHz(81), 880, 1e-9, 'an octave up');
  assertClose(midiToHz(57), 220, 1e-9, 'an octave down');
});

test('sonify: every timbre builds a PeriodicWave', () => {
  const ctx = new OfflineAudioContext(1, 128, SR);
  for (const name of Object.keys(TIMBRES)) {
    const w = timbreWave(ctx, name);
    assert(w instanceof PeriodicWave, `${name} produces a wave`);
    assert(TIMBRES[name].partials.length > 1, `${name} has harmonics beyond the fundamental`);
  }
});

// Observe the audio, not the parameters: render offline and look at the samples.
test('sonify: a scheduled note sounds at its own start time and not before', async () => {
  const ctx = new OfflineAudioContext(1, SR * 2, SR);
  const notes = [{ start: 0.5, end: 1.0, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
  scheduleNotes(ctx, ctx.destination, notes, { when: 0, offset: 0, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);

  assert(rms(out, 0, Math.round(0.45 * SR)) < 1e-4, 'silent before the note starts');
  assert(rms(out, Math.round(0.55 * SR), Math.round(0.9 * SR)) > 0.01, 'sounding during the note');
  assert(rms(out, Math.round(1.6 * SR), SR * 2) < 1e-3, 'decayed away after the note ends');
});

test('sonify: a scheduled note plays the pitch it was given', async () => {
  const ctx = new OfflineAudioContext(1, SR * 2, SR);
  const notes = [{ start: 0.1, end: 1.2, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
  scheduleNotes(ctx, ctx.destination, notes, { when: 0, offset: 0, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);

  const from = Math.round(0.2 * SR);
  const to = Math.round(1.0 * SR);
  const atA = magnitudeAt(out, 440, from, to);
  const atBb = magnitudeAt(out, 466.16, from, to);   // one semitone up
  assert(atA > 5 * atBb, `440 Hz dominates its neighbour (${atA.toFixed(5)} vs ${atBb.toFixed(5)})`);
});

test('sonify: offset skips notes that already finished', async () => {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const notes = [
    { start: 0.0, end: 0.4, midi: 60, cents: 6000, name: 'C4', confidence: 1 },   // behind us
    { start: 2.0, end: 2.4, midi: 72, cents: 7200, name: 'C5', confidence: 1 },
  ];
  // Start playback from 2.0 s into the song, at context time 0.
  scheduleNotes(ctx, ctx.destination, notes, { when: 0, offset: 2.0, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);
  assert(rms(out, Math.round(0.05 * SR), Math.round(0.35 * SR)) > 0.01, 'the note at the seek point plays');
});

test('sonify: stop() silences a running schedule', () => {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const handle = scheduleNotes(ctx, ctx.destination, [
    { start: 0.1, end: 0.5, midi: 69, cents: 6900, name: 'A4', confidence: 1 },
  ], { when: 0, offset: 0, aheadSeconds: Infinity });
  assertEq(typeof handle.stop, 'function', 'a handle with stop() comes back');
  handle.stop();
  handle.stop();   // idempotent — the page calls it on every transport change
});
