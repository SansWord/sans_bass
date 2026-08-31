/* Note analysis worker: owns the expensive half of the pipeline.
 *
 * Runs off the main thread because a 4-minute track takes about 7 s on a cold run, and
 * the player is drawing waveforms on rAF throughout. Interpretation is NOT here — see
 * notes.js, where segmentNotes runs on the main thread at ~12 ms.
 *
 * See docs/transcription.md for the layer model this implements. */

import { decimate, f0Track } from './lib/pitch.js?v=1.15.0';

self.onmessage = (e) => {
  const m = e.data;
  if (!m || m.type !== 'analyse') return;
  try {
    if (!m.channels || !m.channels.length) throw new Error('no audio channels supplied');
    const dec = decimate(m.channels, m.sampleRate);
    const track = f0Track(dec.samples, dec.sampleRate);
    /* Transferring OUT is safe: these arrays were allocated here and nothing else holds
     * them. Transferring IN would not be — see the note in tests/notes.test.js.
     *
     * `candidates` is named here like everything else, and it is the field that is easy to
     * forget: it is the only one an interpreter reads that the analysis does not. Left off,
     * every unit test stays green — the pure functions never cross this boundary — while
     * hmm-v1 throws on `undefined.length` in the app. It is structured-cloned rather than
     * transferred, being an array of plain objects with no backing buffer to hand over. */
    self.postMessage(
      { type: 'frames', frames: { t: track.t, f0: track.f0, conf: track.conf, cents: track.cents,
                                  candidates: track.candidates,
                                  frameSeconds: track.frameSeconds } },
      [track.t.buffer, track.f0.buffer, track.conf.buffer, track.cents.buffer],
    );
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
