import { test, assert, assertEq } from './assert.js';
import { encodeWav } from '../lib/wav.js';

const str = (bytes, off, len) =>
  String.fromCharCode(...bytes.subarray(off, off + len));

test('wav: RIFF/WAVE/data magic', () => {
  const b = encodeWav(new Float32Array(4), new Float32Array(4));
  assertEq(str(b, 0, 4), 'RIFF', 'RIFF magic');
  assertEq(str(b, 8, 4), 'WAVE', 'WAVE magic');
  assertEq(str(b, 12, 4), 'fmt ', 'fmt chunk');
  assertEq(str(b, 36, 4), 'data', 'data chunk');
});

test('wav: length is 44 + frames*4', () => {
  const b = encodeWav(new Float32Array(100), new Float32Array(100));
  assertEq(b.length, 44 + 400, 'total byte length');
});

test('wav: header fields describe 16-bit stereo 44.1k', () => {
  const b = encodeWav(new Float32Array(10), new Float32Array(10), 44100);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  assertEq(dv.getUint32(4, true), 36 + 40, 'RIFF size');
  assertEq(dv.getUint16(20, true), 1, 'PCM format tag');
  assertEq(dv.getUint16(22, true), 2, 'channel count');
  assertEq(dv.getUint32(24, true), 44100, 'sample rate');
  assertEq(dv.getUint32(28, true), 44100 * 4, 'byte rate');
  assertEq(dv.getUint16(32, true), 4, 'block align');
  assertEq(dv.getUint16(34, true), 16, 'bits per sample');
  assertEq(dv.getUint32(40, true), 40, 'data chunk size');
});

test('wav: channels are interleaved left-then-right', () => {
  const b = encodeWav(new Float32Array([1, 0]), new Float32Array([-1, 0]));
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  assertEq(dv.getInt16(44, true), 32767, 'first left sample');
  assertEq(dv.getInt16(46, true), -32767, 'first right sample');
});

test('wav: out-of-range input clamps instead of wrapping', () => {
  // Demucs output can exceed unity. Unclamped conversion wraps to loud noise.
  const b = encodeWav(new Float32Array([5, -5]), new Float32Array([2, -2]));
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  assert(dv.getInt16(44, true) === 32767, 'positive overshoot clamps high');
  assert(dv.getInt16(46, true) === 32767, 'positive overshoot clamps high (right)');
  assert(dv.getInt16(48, true) === -32767, 'negative overshoot clamps low');
});

test('wav: decodes back through the browser', async () => {
  const n = 4410;
  const left = new Float32Array(n);
  for (let i = 0; i < n; i++) left[i] = Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.5;
  const bytes = encodeWav(left, left);
  const ctx = new AudioContext({ sampleRate: 44100 });
  const buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
  await ctx.close();
  assertEq(buf.numberOfChannels, 2, 'channels survive the round trip');
  assertEq(buf.sampleRate, 44100, 'sample rate survives');
  assertEq(buf.length, n, 'frame count survives');
  const back = buf.getChannelData(0);
  let maxErr = 0;
  for (let i = 0; i < n; i++) maxErr = Math.max(maxErr, Math.abs(back[i] - left[i]));
  assert(maxErr < 1 / 3000, `16-bit round trip error too large: ${maxErr}`);
});
