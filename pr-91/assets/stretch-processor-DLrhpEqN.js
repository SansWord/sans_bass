/* AudioWorkletProcessor wrapping the SoundTouch DSP core (npm: soundtouchjs) — this
 * project's own replacement for that library's ScriptProcessorNode wrapper, which
 * soundtouchjs doesn't export standalone. One instance per stem; app.js creates one per
 * track when the active rate is not 100%. See the design spec's "Architecture" and
 * "Loop wrap inside the worklet" sections. */
import { SoundTouch, SimpleFilter } from 'soundtouchjs';

class StretchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = null;       // Float32Array[] — this stem's own copy of its PCM
    this.totalSamples = 0;
    this.loopASample = null;
    this.loopBSample = null;
    this.exhausted = false;     // input ran past totalSamples with no loop configured
    this.endedPosted = false;
    this.playing = false;
    this.startAt = 0;           // AudioContext time to begin producing sound

    this.soundtouch = new SoundTouch();
    this.soundtouch.tempo = 1;
    this.filter = null;

    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  /** Maps an ever-increasing virtual read position onto the fixed PCM copy, wrapping
   *  [loopASample, loopBSample) the way native BufferSource.loop does — on the INPUT side
   *  of the stretch pipeline, since the pipeline itself has no notion of the song looping. */
  readAt(idx) {
    if (this.loopBSample !== null && idx >= this.loopBSample) {
      const span = this.loopBSample - this.loopASample;
      idx = this.loopASample + ((idx - this.loopBSample) % span);
    }
    return idx;
  }

  handleMessage(msg) {
    if (msg.type === 'load') {
      this.channels = msg.channels;
      this.totalSamples = this.channels[0].length;
      const self = this;
      this.filter = new SimpleFilter({
        extract(target, numFrames, position) {
          let n = 0;
          for (; n < numFrames; n++) {
            const idx = self.readAt(position + n);
            if (idx >= self.totalSamples) { self.exhausted = true; break; }
            target[n * 2] = self.channels[0][idx];
            target[n * 2 + 1] = (self.channels[1] || self.channels[0])[idx];
          }
          return n;
        },
      }, this.soundtouch);
    } else if (msg.type === 'start') {
      this.loopASample = msg.loopASample;
      this.loopBSample = msg.loopBSample;
      this.soundtouch.tempo = msg.rate;
      this.filter.sourcePosition = msg.offsetSample;
      this.startAt = msg.t0;
      this.exhausted = false;
      this.endedPosted = false;
      this.playing = true;
    } else if (msg.type === 'setRate') {
      this.soundtouch.tempo = msg.rate;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const numOut = output.length;
    const frames = output[0].length;

    if (!this.playing || !this.filter || currentTime < this.startAt) {
      for (let ch = 0; ch < numOut; ch++) output[ch].fill(0);
      return true;
    }

    const target = new Float32Array(frames * 2);
    const n = this.filter.extract(target, frames);
    for (let i = 0; i < frames; i++) {
      output[0][i] = i < n ? target[i * 2] : 0;
      if (numOut > 1) output[1][i] = i < n ? target[i * 2 + 1] : 0;
    }

    if (n < frames && this.exhausted && !this.endedPosted) {
      this.endedPosted = true;
      this.port.postMessage({ type: 'ended' });
      return false;   // nothing left to produce; let the node be collected
    }
    return true;
  }
}

registerProcessor('stretch-processor', StretchProcessor);
