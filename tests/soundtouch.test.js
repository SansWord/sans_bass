import { test, assert } from './assert.js';
import { SoundTouch, SimpleFilter } from 'soundtouchjs';

const SR = 44100;

function makeSineSource(freqHz, totalFrames) {
  return {
    extract(target, numFrames, position) {
      let n = 0;
      for (; n < numFrames; n++) {
        const idx = position + n;
        if (idx >= totalFrames) break;
        const t = idx / SR;
        const v = Math.sin(2 * Math.PI * freqHz * t) * 0.5;
        target[n * 2] = v;
        target[n * 2 + 1] = v;
      }
      return n;
    },
  };
}

function magnitudeAt(interleaved, hz, frames) {
  let re = 0, im = 0;
  for (let i = 0; i < frames; i++) {
    const s = interleaved[i * 2];
    const t = i / SR;
    re += s * Math.cos(2 * Math.PI * hz * t);
    im += s * Math.sin(2 * Math.PI * hz * t);
  }
  return Math.sqrt(re * re + im * im) / frames;
}

test('soundtouch: tempo 0.5 preserves pitch while roughly doubling the frames produced', () => {
  const freq = 440;
  // 5s, not 1s: the pipe only flushes to SoundTouch's stretch stage in fixed ~16384-frame
  // chunks (see FilterSupport.fillOutputBuffer), so a short clip loses a large fraction of
  // its length to that granularity and never approaches the tempo's true asymptotic ratio.
  const totalFrames = SR * 5;
  const soundtouch = new SoundTouch();
  soundtouch.tempo = 0.5;
  const filter = new SimpleFilter(makeSineSource(freq, totalFrames), soundtouch);

  const chunk = 1024;
  const collected = [];
  let framesOut = 0;
  for (let guard = 0; guard < (SR * 12) / chunk; guard++) {
    const buf = new Float32Array(chunk * 2);
    const n = filter.extract(buf, chunk);
    if (n === 0) break;
    collected.push(buf.subarray(0, n * 2));
    framesOut += n;
  }
  assert(framesOut > totalFrames * 1.6,
    `half tempo roughly doubles output frames (got ${framesOut} from ${totalFrames} input frames)`);

  const merged = new Float32Array(framesOut * 2);
  let off = 0;
  for (const c of collected) { merged.set(c, off); off += c.length; }
  const mag440 = magnitudeAt(merged, 440, framesOut);
  const mag220 = magnitudeAt(merged, 220, framesOut);   // an octave down — naive slowdown
  assert(mag440 > 3 * mag220,
    `stretched output stays at 440 Hz, not pitched down to 220 Hz (${mag440.toFixed(4)} vs ${mag220.toFixed(4)})`);
});

test('soundtouch: tempo 1 leaves pitch and roughly the input length alone', () => {
  const freq = 440;
  const totalFrames = SR * 5;   // see the tempo-0.5 test above for why not 1s
  const soundtouch = new SoundTouch();
  soundtouch.tempo = 1;
  const filter = new SimpleFilter(makeSineSource(freq, totalFrames), soundtouch);

  const chunk = 1024;
  const collected = [];
  let framesOut = 0;
  for (let guard = 0; guard < (SR * 12) / chunk; guard++) {
    const buf = new Float32Array(chunk * 2);
    const n = filter.extract(buf, chunk);
    if (n === 0) break;
    collected.push(buf.subarray(0, n * 2));
    framesOut += n;
  }
  assert(Math.abs(framesOut - totalFrames) < totalFrames * 0.15,
    `tempo 1 output length tracks input length (got ${framesOut} from ${totalFrames})`);

  const merged = new Float32Array(framesOut * 2);
  let off = 0;
  for (const c of collected) { merged.set(c, off); off += c.length; }
  const mag440 = magnitudeAt(merged, 440, framesOut);
  const mag220 = magnitudeAt(merged, 220, framesOut);
  assert(mag440 > 3 * mag220, 'pitch is unchanged at tempo 1');
});
