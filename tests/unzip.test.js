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
