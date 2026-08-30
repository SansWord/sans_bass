/* Sonification of detected notes: play a transcription back as tones, so it can be judged
 * by ear against the stem it came from.
 *
 * Timing comes from the AudioContext clock and nowhere else. The interval below decides
 * only *when to top up the queue*, never when a note sounds — same discipline as the
 * transport in app.js. rAF and setInterval are for bookkeeping; the clock is the graph's.
 */

export const LOOKAHEAD = 0.06;       // seconds of headroom before the first note
const SCHEDULE_AHEAD = 1.0;          // seconds of notes queued at a time
const TICK_MS = 100;                 // how often the queue is topped up

/**
 * Harmonic amplitudes (fundamental first) and envelope shape.
 *
 * Neither is an imitation of a real instrument, and neither should be: the tone only has
 * to be clearly separable from the singer so the two can be compared. `decay` is the
 * fraction of the note's own length over which it falls to near-silence.
 */
export const TIMBRES = {
  piano:  { partials: [1, 0.5, 0.28, 0.12, 0.07, 0.04, 0.02], decay: 0.85, release: 0.04 },
  guitar: { partials: [1, 0.7, 0.45, 0.32, 0.2, 0.14, 0.1, 0.06], decay: 1.0, release: 0.08 },
};

/** Equal-tempered MIDI note number -> Hz. */
export function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** A PeriodicWave for one named timbre. Build it once and share it across every note. */
export function timbreWave(ctx, timbre) {
  const spec = TIMBRES[timbre] ?? TIMBRES.piano;
  const n = spec.partials.length + 1;
  const real = new Float32Array(n);            // index 0 is DC and stays zero
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) imag[k] = spec.partials[k - 1];
  return ctx.createPeriodicWave(real, imag);
}

/**
 * Schedule `notes` as tones and return a handle with stop().
 *
 * `when` is an AudioContext time and `offset` is the position in the song it corresponds
 * to, so a note sounds at `when + note.start - offset` — the same (t0, offset) pairing the
 * player uses to keep sources locked together.
 *
 * Notes are played at their **quantised** MIDI pitch rather than their measured cents.
 * The point is to hear what the transcription claims, not to replay the performance: a
 * singer 40 cents flat should sound 40 cents away from the tone, because that is exactly
 * the discrepancy worth noticing.
 *
 * `aheadSeconds` is Infinity for offline rendering, where currentTime never advances on
 * its own and everything must be queued up front.
 */
export function scheduleNotes(ctx, destination, notes, opts = {}) {
  const { timbre = 'piano', when = 0, offset = 0, aheadSeconds = SCHEDULE_AHEAD, gain = 0.5 } = opts;
  const spec = TIMBRES[timbre] ?? TIMBRES.piano;
  const wave = timbreWave(ctx, timbre);
  const live = new Set();
  let timer = null;
  let next = 0;

  while (next < notes.length && notes[next].end <= offset) next++;   // skip what is behind us

  function spawn(note, at) {
    const dur = Math.max(0.05, note.end - note.start);
    const end = at + dur * spec.decay + spec.release;

    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.value = midiToHz(note.midi);

    // Percussive envelope. exponentialRampToValueAtTime cannot touch zero from either
    // side, hence the 1e-4 floor at both ends rather than a clean 0.
    const g = ctx.createGain();
    g.gain.setValueAtTime(1e-4, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.005);
    g.gain.exponentialRampToValueAtTime(1e-4, end);

    osc.connect(g).connect(destination);
    osc.start(at);
    osc.stop(end + 0.02);
    live.add(osc);
    osc.onended = () => live.delete(osc);
  }

  function pump() {
    const horizon = ctx.currentTime + aheadSeconds;
    while (next < notes.length) {
      const note = notes[next];
      const at = when + note.start - offset;
      if (at > horizon) break;
      spawn(note, Math.max(at, ctx.currentTime));
      next++;
    }
    if (next >= notes.length && timer !== null) { clearInterval(timer); timer = null; }
  }

  pump();
  if (next < notes.length) timer = setInterval(pump, TICK_MS);

  return {
    stop() {
      if (timer !== null) { clearInterval(timer); timer = null; }
      next = notes.length;
      for (const osc of live) { try { osc.stop(); } catch { /* already stopped */ } }
      live.clear();
    },
  };
}
