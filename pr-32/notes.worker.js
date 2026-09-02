/* Note analysis worker: owns the expensive half of the pipeline.
 *
 * Runs off the main thread because a 4-minute track takes about 7 s on a cold run, and
 * the player is drawing waveforms on rAF throughout. Interpretation is NOT here — see
 * notes.js, where segmentNotes runs on the main thread at ~12 ms.
 *
 * Since the tempo-grid phase this also owns BPM/phase detection from a drums stem, bundled
 * into the same 'analyse' round trip so Go costs one worker spin-up, not two. A standalone
 * 'tempo' message type exists for re-detecting after the user narrows the analysed range,
 * without paying for a fresh ~7 s vocals pass.
 *
 * See docs/transcription.md for the layer model this implements, and
 * docs/superpowers/specs/2026-09-01-tempo-grid-design.md for the tempo half. */

import { decimate, f0Track } from './lib/pitch.js?v=1.18.3';
import { onsetEnvelope, estimateTempo } from './lib/tempo.js?v=1.18.3';

function computeTempo(channels, sampleRate) {
  const { env, hopSeconds } = onsetEnvelope(channels, sampleRate);
  return estimateTempo(env, hopSeconds);
}

self.onmessage = (e) => {
  const m = e.data;
  if (!m) return;
  try {
    if (m.type === 'analyse') {
      if (!m.channels || !m.channels.length) throw new Error('no audio channels supplied');
      const dec = decimate(m.channels, m.sampleRate);
      const track = f0Track(dec.samples, dec.sampleRate, m.range || {});
      const tempo = m.drums ? computeTempo(m.drums.channels, m.drums.sampleRate) : null;
      /* Transferring OUT is safe: these arrays were allocated here and nothing else holds
       * them. Transferring IN would not be — see the note in tests/notes.test.js.
       *
       * `candidates` is named here like everything else, and it is the field that is easy to
       * forget: it is the only one an interpreter reads that the analysis does not. `tempo`
       * is a small plain object either way — no typed arrays cross back for it, so it is
       * never in the transfer list. */
      self.postMessage(
        { type: 'frames', frames: { t: track.t, f0: track.f0, conf: track.conf, cents: track.cents,
                                    candidates: track.candidates,
                                    frameSeconds: track.frameSeconds }, tempo },
        [track.t.buffer, track.f0.buffer, track.conf.buffer, track.cents.buffer],
      );
    } else if (m.type === 'tempo') {
      if (!m.channels || !m.channels.length) throw new Error('no audio channels supplied');
      self.postMessage({ type: 'tempo', tempo: computeTempo(m.channels, m.sampleRate) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
