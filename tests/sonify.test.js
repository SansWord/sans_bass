import { test, assert, assertEq, assertClose } from './assert.js';
import { TIMBRES, midiToHz, timbreWave, scheduleNotes,
         envelopeAmplitude, ATTACK, FLOOR } from '../lib/sonify.js';

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

test('sonify: a doubtful note is never scheduled', async () => {
  /* Sounding a note already flagged as untrusted would re-introduce exactly the
   * wrong-octave shriek that folding exists to remove. It stays visible in the lane; it
   * simply does not play.
   *
   * Measured from the rendered samples rather than by counting oscillators: the claim is
   * that C6 is ABSENT from the audio, and only the audio can say that. */
  const ctx = new OfflineAudioContext(1, SR * 2, SR);
  const notes = [
    { start: 0.0, end: 0.2, midi: 60, cents: 6000, name: 'C4', confidence: 0.9 },
    { start: 0.3, end: 0.5, midi: 84, cents: 8400, name: 'C6', confidence: 0.9,
      fix: { from: 84, state: 'doubt', doubt: true } },
    { start: 0.6, end: 0.8, midi: 62, cents: 6200, name: 'D4', confidence: 0.9 },
  ];
  scheduleNotes(ctx, ctx.destination, notes, { when: 0, offset: 0, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);
  assert(rms(out, Math.round(0.02 * SR), Math.round(0.18 * SR)) > 0.001, 'the first trusted note sounds');
  assert(rms(out, Math.round(0.62 * SR), Math.round(0.78 * SR)) > 0.001, 'the second trusted note sounds');
  assert(rms(out, Math.round(0.32 * SR), Math.round(0.48 * SR)) < 1e-4,
         'the doubtful note leaves silence where it would have been');
});

/* The envelope, pinned as arithmetic. Entering a note partway needs its amplitude at an
 * arbitrary point, so the curve the ramps describe is written once as a function and these
 * check the function against the three points the ramps themselves fix. */

test('sonify: envelopeAmplitude reproduces the two ramps it models', () => {
  /* The envelope is 1e-4 -> peak over [0, ATTACK], then peak -> 1e-4 over [ATTACK, envLen].
   * These are the three points the Web Audio ramps themselves pin, so if this function
   * disagrees at them it will disagree everywhere in between too. */
  const peak = 0.5;
  const envLen = 0.5;
  assertClose(envelopeAmplitude(0, envLen, peak), FLOOR, 1e-12, 'starts at the floor');
  assertClose(envelopeAmplitude(ATTACK, envLen, peak), peak, 1e-9, 'attack reaches the peak');
  assertClose(envelopeAmplitude(envLen, envLen, peak), FLOOR, 1e-9, 'decays to the floor');
});

test('sonify: envelopeAmplitude falls monotonically through the decay', () => {
  const peak = 0.5;
  const envLen = 0.4;
  let prev = Infinity;
  for (let tau = ATTACK; tau <= envLen; tau += 0.005) {
    const a = envelopeAmplitude(tau, envLen, peak);
    assert(a <= prev + 1e-12, `amplitude never rises during decay (at tau=${tau.toFixed(3)})`);
    prev = a;
  }
});

test('sonify: envelopeAmplitude is clamped at both ends', () => {
  /* A `skip` past the envelope's own length is reachable: a long note entered very late,
   * or a short note whose envLen is shorter than the remainder. Neither may produce a
   * negative amplitude or NaN — exponentialRampToValueAtTime rejects both. */
  const peak = 0.5;
  assert(envelopeAmplitude(-1, 0.4, peak) === FLOOR, 'a negative tau is the floor');
  assert(envelopeAmplitude(99, 0.4, peak) >= FLOOR, 'a tau past the end never goes below the floor');
  assert(Number.isFinite(envelopeAmplitude(99, 0.4, peak)), 'and never NaN');
  assert(Number.isFinite(envelopeAmplitude(0.1, 0, peak)), 'a zero-length envelope is survivable');
});

/* Entering a note partway. The lane draws a note across the entry point whether that point
 * is a seek target or loop point A, so silence there reads as a detection failure rather
 * than a scheduling one. One rule covers both. */

test('sonify: seeking into the middle of a note plays the rest of it', async () => {
  /* The lane draws this note across the seek point, so silence reads as a detection
   * failure rather than a scheduling one. */
  const ctx = new OfflineAudioContext(1, SR, SR);
  const notes = [{ start: 0.0, end: 0.5, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
  // Enter 0.25 s into a 0.5 s note: 0.25 s of it remains.
  scheduleNotes(ctx, ctx.destination, notes, { when: 0, offset: 0.25, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);
  assert(rms(out, Math.round(0.01 * SR), Math.round(0.2 * SR)) > 0.001,
         'the remainder of the straddled note sounds');
});

test('sonify: a resumed note enters the envelope partway, it does not re-attack', async () => {
  /* THE assertion that distinguishes the two designs. "Re-attack with a shortened
   * envelope" passes every other test in this file; only the amplitude at the entry
   * point tells them apart. */
  const render = async (offset) => {
    const ctx = new OfflineAudioContext(1, SR, SR);
    const notes = [{ start: 0.0, end: 0.5, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
    scheduleNotes(ctx, ctx.destination, notes, { when: 0, offset, aheadSeconds: Infinity });
    const out = (await ctx.startRendering()).getChannelData(0);
    let peak = 0;
    for (let i = 0; i < Math.round(0.01 * SR); i++) peak = Math.max(peak, Math.abs(out[i]));
    return peak;
  };
  const fromStart = await render(0);
  const fromMiddle = await render(0.25);
  assert(fromMiddle > 0.0005, `the resumed note is audible (${fromMiddle.toFixed(5)})`);
  assert(fromMiddle < fromStart * 0.9,
         `and quieter than a fresh attack (${fromMiddle.toFixed(5)} vs ${fromStart.toFixed(5)})`);
});

test('sonify: a note straddling the loop start sounds on the first pass', async () => {
  const ctx = new OfflineAudioContext(1, SR, SR);
  // The note runs 0.0-0.4; the loop starts at 0.2, so 0.2 s of it is inside the region.
  const notes = [{ start: 0.0, end: 0.4, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
  scheduleNotes(ctx, ctx.destination, notes,
                { when: 0, offset: 0.2, loopA: 0.2, loopB: 0.6, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);
  assert(rms(out, Math.round(0.01 * SR), Math.round(0.15 * SR)) > 0.001,
         'the part of the note inside the loop sounds');
});

test('sonify: the note straddling A resumes on every lap, not just the first', async () => {
  /* Sounding once and then never again is the shape this bug takes if only lap 0 is
   * fixed — and it reads as "the loop stopped working" rather than as a missing note. */
  const ctx = new OfflineAudioContext(1, SR * 2, SR);
  const notes = [{ start: 0.0, end: 0.4, midi: 69, cents: 6900, name: 'A4', confidence: 1 }];
  // Loop [0.2, 0.6): 0.4 s laps starting at context time 0, 0.4, 0.8, 1.2, 1.6.
  scheduleNotes(ctx, ctx.destination, notes,
                { when: 0, offset: 0.2, loopA: 0.2, loopB: 0.6, aheadSeconds: Infinity });
  const out = (await ctx.startRendering()).getChannelData(0);
  for (const lapStart of [0, 0.4, 0.8, 1.2]) {
    const from = Math.round((lapStart + 0.01) * SR);
    const to = Math.round((lapStart + 0.15) * SR);
    assert(rms(out, from, to) > 0.001, `the note sounds on the lap starting at ${lapStart}s`);
  }
});
