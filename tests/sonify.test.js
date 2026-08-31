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
  // And the skipped one is genuinely absent. Asserting only that the wanted note sounds
  // would pass against code that plays BOTH — which is precisely the bug below.
  assert(rms(out, Math.round(0.45 * SR), Math.round(0.95 * SR)) < 1e-3, 'the skipped note never sounds');
});

/* Scheduling against a t0 that is already in the past happens for real: press play with the
 * notes lane muted, then unmute a minute later. The transport still reports the t0 it
 * started from, so every elapsed note maps to a time before now. Those must be DROPPED. */
test('sonify: a schedule whose t0 is in the past does not dump elapsed notes at once', async () => {
  const ctx = new OfflineAudioContext(1, SR * 2, SR);
  const notes = [];
  // Thirty notes spanning 0-2.9 s. With when = -3 every one of them maps to a time before
  // the clock, so the correct behaviour is silence — not thirty notes on one sample.
  for (let i = 0; i < 30; i++) {
    notes.push({ start: i * 0.1, end: i * 0.1 + 0.08, midi: 60 + (i % 5), cents: 0, name: 'C4', confidence: 1 });
  }
  scheduleNotes(ctx, ctx.destination, notes, { when: -3, offset: 0, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);
  const peak = Math.max(...Array.from(out, Math.abs));
  assert(peak < 0.01, `elapsed notes are dropped, not stacked onto now (peak ${peak.toFixed(3)})`);
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

/* A-B repeat loops on the audio thread for buffers (src.loop + loopStart/loopEnd), which
 * an oscillator sequence cannot do. These cover the arithmetic that replaces it: lap k of
 * a note is a pure offset from the audio clock, never a polled wrap. */

test('sonify: a looped note sounds once per lap', async () => {
  const ctx = new OfflineAudioContext(1, SR * 3, SR);
  // One note at 0.1 s inside a 0.5 s loop -> laps at 0.1, 0.6, 1.1, 1.6, 2.1, 2.6.
  const notes = [{ start: 0.1, end: 0.25, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
  scheduleNotes(ctx, ctx.destination, notes,
                { when: 0, offset: 0, loopA: 0, loopB: 0.5, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);

  // Count bursts: a run of loud samples separated by near-silence.
  let bursts = 0;
  let inBurst = false;
  const win = Math.round(0.01 * SR);
  for (let i = 0; i + win < out.length; i += win) {
    let peak = 0;
    for (let j = i; j < i + win; j++) peak = Math.max(peak, Math.abs(out[j]));
    if (peak > 0.02 && !inBurst) { bursts++; inBurst = true; }
    else if (peak <= 0.02) inBurst = false;
  }
  assert(bursts >= 5, `the note repeats every lap (${bursts} bursts in 3 s of a 0.5 s loop)`);
});

test('sonify: a note outside the loop never sounds', async () => {
  const ctx = new OfflineAudioContext(1, SR * 2, SR);
  const notes = [
    { start: 0.1, end: 0.3, midi: 69, cents: 6900, name: 'A4', confidence: 1 },   // inside
    { start: 1.2, end: 1.4, midi: 60, cents: 6000, name: 'C4', confidence: 1 },   // outside
  ];
  scheduleNotes(ctx, ctx.destination, notes,
                { when: 0, offset: 0, loopA: 0, loopB: 0.5, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);
  // 1.2-1.4 s is outside [0, 0.5); only wrapped laps of the FIRST note may appear there,
  // and those land at 1.1 and 1.6, so 1.25-1.35 must be quiet.
  assert(rms(out, Math.round(1.25 * SR), Math.round(1.35 * SR)) < 1e-3,
         'the out-of-loop note is never scheduled');
});

test('sonify: an empty loop region does not spin forever', () => {
  const ctx = new OfflineAudioContext(1, SR, SR);
  // The loop holds no notes at all. A naive lap generator would iterate for ever here.
  const h = scheduleNotes(ctx, ctx.destination,
    [{ start: 5, end: 6, midi: 69, cents: 6900, name: 'A4', confidence: 1 }],
    { when: 0, offset: 0, loopA: 0, loopB: 0.5, aheadSeconds: Infinity });
  assertEq(typeof h.stop, 'function', 'it returns rather than hanging');
  h.stop();
});

test('sonify: a doubtful note is never scheduled', () => {
  /* Sounding a note we have already flagged as untrusted would re-introduce exactly the
   * wrong-octave blurt that folding exists to remove. It stays visible in the lane; it
   * simply does not play. */
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  const notes = [
    { start: 0.0, end: 0.2, midi: 60, cents: 6000, name: 'C4', confidence: 0.9 },
    { start: 0.3, end: 0.5, midi: 84, cents: 8400, name: 'C6', confidence: 0.9, fix: { from: 84, state: 'doubt', doubt: true } },
    { start: 0.6, end: 0.8, midi: 62, cents: 6200, name: 'D4', confidence: 0.9 },
  ];
  const started = [];
  const origStart = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (when) { started.push(when); return origStart.call(this, when); };
  try {
    const s = scheduleNotes(ctx, ctx.destination, notes, { when: 0, offset: 0 });
    s.stop();
  } finally {
    OscillatorNode.prototype.start = origStart;
  }
  assertEq(started.length, 2, `only the two trusted notes sound (got ${started.length})`);
});
