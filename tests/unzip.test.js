import { test, assert, assertEq } from './assert.js';
import { buildZip } from '../lib/zip.js';

const enc = new TextEncoder();
const { extract } = window.SansUnzip;

test('unzip: round-trips a stored entry built by lib/zip.js', async () => {
  const payload = enc.encode('hello bass');
  const blob = buildZip([{ name: 'Song Name/bass.wav', bytes: payload }]);
  const out = await extract(blob);
  assertEq(out.length, 1, 'entry count');
  assertEq(out[0].name, 'bass.wav', 'basename');
  assertEq(out[0].webkitRelativePath, 'Song Name/bass.wav', 'full path');
  assertEq(out[0].bytes.length, payload.length, 'byte length');
  assert(out[0].bytes.every((b, i) => b === payload[i]), 'bytes match');
});

test('unzip: preserves order and content across many entries', async () => {
  const names = ['S/vocals.wav', 'S/guitar.wav', 'S/bass.wav', 'S/drums.wav'];
  const blob = buildZip(names.map((n, i) => ({ name: n, bytes: enc.encode('x'.repeat(i + 1)) })));
  const out = await extract(blob);
  assertEq(out.map((e) => e.name).join(','), 'vocals.wav,guitar.wav,bass.wav,drums.wav', 'order');
  assertEq(out[3].bytes.length, 4, 'fourth entry payload length');
});

test('unzip: each entry gets its own exact-size buffer', async () => {
  // decodeAudioData detaches the ArrayBuffer it is given. If two entries shared one
  // allocation, decoding the first would detach the second. See the spec, "Why eager".
  const blob = buildZip([
    { name: 'S/a.wav', bytes: enc.encode('aaaa') },
    { name: 'S/b.wav', bytes: enc.encode('bb') },
  ]);
  const out = await extract(blob);
  assertEq(out[0].bytes.buffer.byteLength, 4, 'first buffer is exactly its entry');
  assertEq(out[1].bytes.buffer.byteLength, 2, 'second buffer is exactly its entry');
  assert(out[0].bytes.buffer !== out[1].bytes.buffer, 'entries do not share a buffer');
});

test('unzip: a non-zip blob rejects with code "not-zip"', async () => {
  let code = null;
  try { await extract(new Blob([enc.encode('this is not a zip at all')])); }
  catch (e) { code = e.code; }
  assertEq(code, 'not-zip', 'error code');
});

test('unzip: an empty blob rejects rather than hanging', async () => {
  let code = null;
  try { await extract(new Blob([])); }
  catch (e) { code = e.code; }
  assertEq(code, 'not-zip', 'error code');
});

test('unzip: survives an archive comment after the EOCD', async () => {
  // The EOCD is not necessarily the last 22 bytes; a comment may follow it.
  const base = new Uint8Array(await buildZip([{ name: 'S/a.wav', bytes: enc.encode('ok') }]).arrayBuffer());
  const withComment = new Uint8Array(base.length + 5);
  withComment.set(base, 0);
  withComment.set(enc.encode('hello'), base.length);
  new DataView(withComment.buffer).setUint16(base.length - 2, 5, true);   // comment length
  const out = await extract(new Blob([withComment]));
  assertEq(out.length, 1, 'entry found past the comment');
});

test('unzip: drops __MACOSX sidecars so a six-stem zip yields six lanes', async () => {
  // Finder's "Compress" writes an AppleDouble per file. Without this filter a six-stem
  // zip yields twelve entries and ._bass.wav competes for the bass lane in assignStems.
  const blob = buildZip([
    { name: '__MACOSX/S/._bass.wav', bytes: enc.encode('junk') },
    { name: 'S/bass.wav', bytes: enc.encode('real') },
    { name: 'S/._drums.wav', bytes: enc.encode('junk') },
    { name: 'S/drums.wav', bytes: enc.encode('real') },
  ]);
  const out = await extract(blob);
  assertEq(out.map((e) => e.name).join(','), 'bass.wav,drums.wav', 'only the real stems');
});

test('unzip: drops directory entries and non-audio files', async () => {
  const blob = buildZip([
    { name: 'S/', bytes: new Uint8Array(0) },
    { name: 'S/README.txt', bytes: enc.encode('notes') },
    { name: 'S/cover.jpg', bytes: enc.encode('image') },
    { name: 'S/vocals.m4a', bytes: enc.encode('audio') },
  ]);
  const out = await extract(blob);
  assertEq(out.length, 1, 'entry count');
  assertEq(out[0].name, 'vocals.m4a', 'the only audio entry');
});

test('unzip: a zip with no audio resolves empty rather than throwing', async () => {
  const blob = buildZip([{ name: 'S/README.txt', bytes: enc.encode('notes') }]);
  const out = await extract(blob);
  assertEq(out.length, 0, 'empty result');
});

test('unzip: accepts every extension the player supports', async () => {
  const exts = ['wav', 'flac', 'm4a', 'mp3', 'opus', 'aiff'];
  const blob = buildZip(exts.map((x) => ({ name: `S/bass.${x}`, bytes: enc.encode(x) })));
  const out = await extract(blob);
  assertEq(out.length, exts.length, 'all extensions kept');
});

/** A one-entry zip with method 8. lib/zip.js only writes stored entries, so build it here. */
async function deflatedZip(name, payload) {
  const stream = new Blob([payload]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const comp = new Uint8Array(await new Response(stream).arrayBuffer());
  const nameBytes = enc.encode(name);
  const crc = 0;                       // not verified by the reader
  const n = nameBytes.length;

  const local = new Uint8Array(30 + n);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(6, 0x800, true);
  lv.setUint16(8, 8, true);            // method 8 = deflate
  lv.setUint32(14, crc, true);
  lv.setUint32(18, comp.length, true);
  lv.setUint32(22, payload.length, true);
  lv.setUint16(26, n, true);
  local.set(nameBytes, 30);

  const cd = new Uint8Array(46 + n);
  const cv = new DataView(cd.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(8, 0x800, true);
  cv.setUint16(10, 8, true);           // method 8
  cv.setUint32(16, crc, true);
  cv.setUint32(20, comp.length, true);
  cv.setUint32(24, payload.length, true);
  cv.setUint16(28, n, true);
  cv.setUint32(42, 0, true);           // local header at offset 0
  cd.set(nameBytes, 46);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, local.length + comp.length, true);
  return new Blob([local, comp, cd, eocd]);
}

test('unzip: inflates a deflated entry back to the original bytes', async () => {
  const payload = enc.encode('the quick brown fox '.repeat(50));
  const out = await extract(await deflatedZip('S/bass.wav', payload));
  assertEq(out.length, 1, 'entry count');
  assertEq(out[0].bytes.length, payload.length, 'inflated length');
  assert(out[0].bytes.every((b, i) => b === payload[i]), 'inflated bytes match');
});

test('unzip: an inflated entry also gets its own exact-size buffer', async () => {
  const payload = enc.encode('x'.repeat(1000));
  const out = await extract(await deflatedZip('S/bass.wav', payload));
  assertEq(out[0].bytes.buffer.byteLength, 1000, 'buffer is exactly the inflated entry');
});

test('unzip: an unsupported compression method reports which file', async () => {
  const blob = buildZip([{ name: 'S/bass.wav', bytes: enc.encode('data') }]);
  const b = new Uint8Array(await blob.arrayBuffer());
  // Method lives at +10 in the central directory. Find it via the EOCD's CD offset.
  const dv = new DataView(b.buffer);
  const cdOff = dv.getUint32(b.length - 22 + 16, true);
  dv.setUint16(cdOff + 10, 12, true);          // 12 = bzip2, which we do not support
  let err = null;
  try { await extract(new Blob([b])); } catch (e) { err = e; }
  assertEq(err && err.code, 'method', 'error code');
  assert(err.message.includes('bass.wav'), 'names the offending file');
});
