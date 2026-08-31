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
/* Below this, a resumed remainder is a transient rather than a pitch — and it costs an
 * oscillator on every lap. No whole note is ever dropped by it: interpret() enforces
 * minDurationMs >= 20, so the shortest note that can reach here is twice this. */
const MIN_AUDIBLE = 0.01;

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

/* The percussive envelope, as a function rather than only as a pair of scheduled ramps.
 *
 * spawn() schedules `1e-4 -> peak` over [0, ATTACK] then `peak -> 1e-4` over [ATTACK, envLen].
 * To ENTER that envelope partway along — a note already sounding when playback reaches it —
 * we need its value at an arbitrary point, so the same curve is written once here and the
 * ramps are driven from it.
 *
 * Web Audio's exponential ramp is v(t) = v0 * (v1/v0)^((t-t0)/(t1-t0)), which is what the
 * two Math.pow calls are. FLOOR exists because an exponential ramp cannot touch zero from
 * either side. */
export const ATTACK = 0.005;
export const FLOOR = 1e-4;

export function envelopeAmplitude(tau, envLen, peak) {
  if (tau <= 0) return FLOOR;
  if (tau < ATTACK) return FLOOR * Math.pow(peak / FLOOR, tau / ATTACK);
  const f = Math.min(1, (tau - ATTACK) / Math.max(1e-6, envLen - ATTACK));
  return Math.max(FLOOR, peak * Math.pow(FLOOR / peak, f));
}

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
 * A note carrying `fix.state === 'doubt'` (set by foldOctaves in lib/pitch.js) is skipped
 * entirely. It stays visible in the lane; sounding a pitch already flagged as untrusted
 * would re-introduce the wrong-octave blurt that folding exists to remove.
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
    if (n.fix && n.fix.state === 'doubt') continue;   // untrusted: visible, but silent
    /* "Still sounding at the entry point", not "starts after it". The two branches now
     * differ only in whether there is a right-hand bound at all. */
    if (n.end <= offset) continue;
    if (looping && n.start >= loopB) continue;
    const boundary0 = looping ? loopB : Infinity;
    if (Math.min(n.end, boundary0) - Math.max(n.start, offset) < MIN_AUDIBLE) continue;
    /* `at` is pinned to the entry point rather than the note's own start, so a note we
     * are entering partway is scheduled NOW and not in the past. That is what keeps
     * pump()'s past-drop intact: it still throws away genuinely elapsed notes. */
    lap0.push({
      note: n,
      at: when + Math.max(0, n.start - offset),
      skip: Math.max(0, offset - n.start),
      until: looping ? when + (loopB - offset) : Infinity,
    });
  }
  const loopBase = [];
  if (looping) {
    /* Lap 1 begins at the audio time lap 0's B falls on. Later laps are this plus
     * (lap - 1) * period, applied in nextEvent(). */
    const lapStart = when + (loopB - offset);
    for (const n of notes) {
      if (n.fix && n.fix.state === 'doubt') continue;   // same rule on every lap
      if (n.end <= loopA || n.start >= loopB) continue;
      if (Math.min(n.end, loopB) - Math.max(n.start, loopA) < MIN_AUDIBLE) continue;
      loopBase.push({
        note: n,
        at: lapStart + Math.max(0, n.start - loopA),
        skip: Math.max(0, loopA - n.start),
        until: lapStart + period,
      });
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
      events = loopBase.map((e) => ({
        note: e.note,
        at: e.at + (lap - 1) * period,
        skip: e.skip,
        /* `until` shifts per lap exactly as `at` does. Leaving it un-shifted cuts every
         * lap at lap 1's B, so everything after the first pass is silent — which looks
         * like the loop breaking, not like a truncation bug. */
        until: e.until + (lap - 1) * period,
      }));
      next = 0;
    }
    return events[next];
  }

  function spawn(note, at, skip = 0, until = Infinity) {
    const dur = Math.max(0.05, note.end - note.start);
    const envLen = dur * spec.decay + spec.release;
    /* `until` is the lap's B, never the note's own end. envLen routinely OUTLASTS the note
     * — a 50 ms note has an 82 ms envelope — and that tail is existing behaviour. Clamping
     * to note.end here would silently reshape every note in the song. */
    const end = Math.min(at + (envLen - skip), until);
    // An exponential ramp to a time at or before its start point misbehaves.
    if (end - at < 0.001) return;

    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.value = midiToHz(note.midi);

    /* Percussive envelope. exponentialRampToValueAtTime cannot touch zero from either
     * side, hence the FLOOR at both ends rather than a clean 0.
     *
     * Enter the envelope at `skip` seconds in. At skip = 0 this is exactly the original
     * three lines: envelopeAmplitude(0) is FLOOR and the attack ramp still runs in full.
     *
     * The attack is handled separately rather than folded into the decay because a note
     * caught 2 ms in would otherwise start near-silent and immediately fade — losing the
     * attack and sounding duller than its neighbours. */
    const g = ctx.createGain();
    g.gain.setValueAtTime(envelopeAmplitude(skip, envLen, gain), at);
    if (skip < ATTACK) g.gain.exponentialRampToValueAtTime(gain, at + (ATTACK - skip));
    g.gain.exponentialRampToValueAtTime(FLOOR, end);

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
      if (e.at >= ctx.currentTime) spawn(e.note, e.at, e.skip, e.until);
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
