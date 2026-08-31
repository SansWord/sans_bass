/* Sonification of detected notes: play a transcription back as tones, so it can be judged
 * by ear against the stem it came from.
 *
 * Timing comes from the AudioContext clock and nowhere else. The interval below decides
 * only *when to top up the queue*, never when a note sounds — same discipline as the
 * transport in app.js. rAF and setInterval are for bookkeeping; the clock is the graph's.
 */

export const LOOKAHEAD = 0.06;       // seconds of headroom before the first note
/* The queue is topped up from setInterval, which Chrome clamps to >=1 s in a background
 * tab and to 60 s under intensive throttling. A 1 s horizon against a 1 s clamp drops
 * notes the moment the tab is hidden — and the stems, being one BufferSource each, keep
 * perfect time throughout, so the synth would drift away from the audio it exists to be
 * compared against. The horizon is far past the throttle floor for that reason. */
const SCHEDULE_AHEAD = 90;           // seconds of notes queued at a time
const TICK_MS = 2000;                // how often the queue is topped up
const MAX_LAPS = 100000;             // safety net; the horizon is the real bound

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
 *
 * `loopA`/`loopB` mirror A-B repeat. A BufferSource loops on the audio thread via
 * src.loop, which a sequence of oscillators cannot do — so laps are generated instead.
 * Lap k of a note is a pure offset from the audio clock (`+ k * period`), never a polled
 * wrap, so the synth stays locked to the stems looping beside it.
 */
export function scheduleNotes(ctx, destination, notes, opts = {}) {
  const { timbre = 'piano', when = 0, offset = 0, aheadSeconds = SCHEDULE_AHEAD, gain = 0.5,
          loopA = null, loopB = null } = opts;
  const looping = loopA !== null && loopB !== null && loopB > loopA;
  const period = looping ? loopB - loopA : 0;
  const spec = TIMBRES[timbre] ?? TIMBRES.piano;
  const wave = timbreWave(ctx, timbre);
  const live = new Set();
  let timer = null;

  /* Lap 0 runs from `offset` to the end (or to loopB). Every later lap replays the notes
   * inside [loopA, loopB). Both are plain arrays of { note, at } in audio-clock time. */
  const lap0 = [];
  for (const n of notes) {
    if (looping ? (n.start < offset || n.start >= loopB) : n.end <= offset) continue;
    lap0.push({ note: n, at: when + (n.start - offset) });
  }
  const loopBase = [];
  if (looping) {
    for (const n of notes) {
      if (n.start < loopA || n.start >= loopB) continue;
      loopBase.push({ note: n, at: when + (loopB - offset) + (n.start - loopA) });
    }
  }

  let lap = 0;
  let events = lap0;
  let next = 0;

  /* Returns the next event, advancing a lap when the current one runs out. loopBase being
   * empty is the guard that matters: a loop region containing no notes would otherwise
   * advance laps for ever without ever yielding anything. */
  function nextEvent() {
    while (next >= events.length) {
      if (!loopBase.length || lap >= MAX_LAPS) return null;
      lap++;
      events = loopBase.map((e) => ({ note: e.note, at: e.at + (lap - 1) * period }));
      next = 0;
    }
    return events[next];
  }

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

  let exhausted = false;

  /* An OfflineAudioContext knows its own length; a live one does not and reports
   * undefined. This bound is what stops lap generation: with aheadSeconds = Infinity and
   * a loop region, `at > horizon` is never true and the generator runs for ever. That is
   * not hypothetical — it froze the test page. */
  const renderEnd = typeof ctx.length === 'number' ? ctx.length / ctx.sampleRate : Infinity;

  function pump() {
    const horizon = Math.min(ctx.currentTime + aheadSeconds, renderEnd);
    for (;;) {
      const e = nextEvent();
      if (!e) { exhausted = true; break; }
      if (e.at > horizon) break;
      /* DROP what is already past, never clamp it forward. Math.max here turned "this
       * note happened a minute ago" into "play it now": pressing play with the lane muted
       * and unmuting later re-schedules against the original t0, and every elapsed note
       * fired on the same sample — measured at 7x full scale. The lap-0 filter already
       * expresses the right intent; this was the one line that disagreed. */
      if (e.at >= ctx.currentTime) spawn(e.note, e.at);
      next++;
    }
    if (exhausted && timer !== null) { clearInterval(timer); timer = null; }
  }

  pump();
  if (!exhausted) timer = setInterval(pump, TICK_MS);

  return {
    stop() {
      if (timer !== null) { clearInterval(timer); timer = null; }
      next = events.length;
      exhausted = true;
      for (const osc of live) { try { osc.stop(); } catch { /* already stopped */ } }
      live.clear();
    },
  };
}
