import { test, assert, assertEq } from './assert.js';
import { crc32, buildZip } from '../lib/zip.js';

test('zip: crc32 matches the standard check vector', () => {
  const bytes = new TextEncoder().encode('123456789');
  assertEq(crc32(bytes) >>> 0, 0xcbf43926, 'crc32("123456789")');
});

test('zip: crc32 of empty input is 0', () => {
  assertEq(crc32(new Uint8Array(0)) >>> 0, 0, 'crc32 of empty');
});

test('zip: builds a blob with the right signatures', async () => {
  const blob = buildZip([{ name: 'a/one.txt', bytes: new TextEncoder().encode('hello') }]);
  const b = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(b.buffer);
  assertEq(dv.getUint32(0, true), 0x04034b50, 'local file header signature');
  // EOCD is the last 22 bytes when there is no archive comment.
  const eocd = b.length - 22;
  assertEq(dv.getUint32(eocd, true), 0x06054b50, 'end of central directory signature');
  assertEq(dv.getUint16(eocd + 8, true), 1, 'entry count on this disk');
  assertEq(dv.getUint16(eocd + 10, true), 1, 'total entry count');
});

test('zip: stored entries embed name, sizes and crc', async () => {
  const payload = new TextEncoder().encode('hello');
  const blob = buildZip([{ name: 'a/one.txt', bytes: payload }]);
  const b = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(b.buffer);
  assertEq(dv.getUint16(8, true), 0, 'method 0 = store');
  assertEq(dv.getUint32(14, true) >>> 0, crc32(payload) >>> 0, 'crc in local header');
  assertEq(dv.getUint32(18, true), payload.length, 'compressed size');
  assertEq(dv.getUint32(22, true), payload.length, 'uncompressed size');
  assertEq(dv.getUint16(26, true), 'a/one.txt'.length, 'name length');
  assertEq(String.fromCharCode(...b.subarray(30, 39)), 'a/one.txt', 'name bytes');
  assertEq(String.fromCharCode(...b.subarray(39, 44)), 'hello', 'payload follows the header');
});

test('zip: multiple entries each get a central directory record', async () => {
  const enc = new TextEncoder();
  const blob = buildZip([
    { name: 's/one.txt', bytes: enc.encode('one') },
    { name: 's/two.txt', bytes: enc.encode('twotwo') },
  ]);
  const b = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(b.buffer);
  const eocd = b.length - 22;
  assertEq(dv.getUint16(eocd + 10, true), 2, 'two entries recorded');
  let found = 0;
  for (let i = 0; i < b.length - 4; i++) if (dv.getUint32(i, true) === 0x02014b50) found++;
  assertEq(found, 2, 'two central directory headers');
});

test('zip: non-ASCII names set the UTF-8 flag (bit 11)', async () => {
  // We always write UTF-8 name bytes. Without general purpose bit 11 set, unzip decodes
  // them as CP437 — every Chinese song title extracts to a mojibake folder name.
  const blob = buildZip([{ name: '2 最後兩禮拜/bass.wav', bytes: new Uint8Array(4) }]);
  const b = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(b.buffer);
  assert((dv.getUint16(6, true) & 0x800) !== 0, 'local header flags bit 11 set');
  const eocd = b.length - 22;
  const cdOff = dv.getUint32(eocd + 16, true);
  assertEq(dv.getUint32(cdOff, true), 0x02014b50, 'found the central directory');
  assert((dv.getUint16(cdOff + 8, true) & 0x800) !== 0, 'central directory flags bit 11 set');
});

test('zip: name bytes are UTF-8, and length counts bytes not characters', async () => {
  const name = '2 最後兩禮拜/bass.wav';
  const blob = buildZip([{ name, bytes: new Uint8Array(4) }]);
  const b = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(b.buffer);
  const expected = new TextEncoder().encode(name);
  assertEq(dv.getUint16(26, true), expected.length, 'name length is the UTF-8 byte length');
  assert(expected.length > name.length, 'this name really is multi-byte');
  assertEq(new TextDecoder().decode(b.subarray(30, 30 + expected.length)), name, 'round trips');
});
