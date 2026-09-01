/* Store-method (uncompressed) ZIP writer.
 *
 * WAV audio is incompressible, so deflate would cost a lot of complexity for almost no
 * saving. Returning a Blob rather than one big Uint8Array matters: a song's worth of
 * stems is ~210 MB, and a Blob lets the browser spill to disk instead of pinning it all
 * in the JS heap.
 *
 * Names are UTF-8 with general purpose bit 11 set. Without that bit the spec says names
 * are CP437, and a title like "2 最後兩禮拜" extracts as mojibake. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {{name: string, bytes: Uint8Array}[]} entries
 * @returns {Blob} a valid .zip
 */
export function buildZip(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, bytes } of entries) {
    const nameBytes = enc.encode(name);
    const crc = crc32(bytes);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);          // local file header signature
    lv.setUint16(4, 20, true);                  // version needed to extract (2.0)
    lv.setUint16(6, 0x800, true);               // flags: bit 11 = names are UTF-8
    lv.setUint16(8, 0, true);                   // compression method: 0 = store
    lv.setUint16(10, 0, true);                  // last mod time
    lv.setUint16(12, 0x21, true);               // last mod date = 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, bytes.length, true);       // compressed size
    lv.setUint32(22, bytes.length, true);       // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);                  // extra field length
    local.set(nameBytes, 30);
    parts.push(local, bytes);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);          // central directory signature
    cv.setUint16(4, 20, true);                  // version made by
    cv.setUint16(6, 20, true);                  // version needed
    cv.setUint16(8, 0x800, true);               // flags: bit 11 = names are UTF-8
    cv.setUint16(10, 0, true);                  // method: store
    cv.setUint16(12, 0, true);                  // mod time
    cv.setUint16(14, 0x21, true);               // mod date
    cv.setUint32(16, crc, true);
    cv.setUint32(20, bytes.length, true);
    cv.setUint32(24, bytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);                  // extra length
    cv.setUint16(32, 0, true);                  // comment length
    cv.setUint16(34, 0, true);                  // disk number start
    cv.setUint16(36, 0, true);                  // internal attributes
    cv.setUint32(38, 0, true);                  // external attributes
    cv.setUint32(42, offset, true);             // offset of local header
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + bytes.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);            // EOCD signature
  ev.setUint16(4, 0, true);                     // this disk number
  ev.setUint16(6, 0, true);                     // disk with central directory
  ev.setUint16(8, entries.length, true);        // entries on this disk
  ev.setUint16(10, entries.length, true);       // entries total
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);               // central directory offset
  ev.setUint16(20, 0, true);                    // comment length

  return new Blob([...parts, ...central, eocd], { type: 'application/zip' });
}
