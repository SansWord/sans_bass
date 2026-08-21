/* Zip reading: pull audio entries out of a .zip without reading the whole file into memory.
 *
 * A CLASSIC script, not an ES module, and deliberately so — the same reason as lib/stems.js:
 * app.js is a classic script because Chrome refuses <script type="module"> on file://, and
 * the player must keep working when index.html is double-clicked.
 *
 * That is also why this shares no code with lib/zip.js, which writes zips and is ESM.
 * tests/unzip.test.js round-trips the two against each other to keep them agreeing.
 *
 * Memory: a File from <input type="file"> is disk-backed. blob.slice() is free and reads
 * nothing; only awaiting .arrayBuffer() on a slice touches the disk. So the whole zip is
 * never resident — for a six-stem WAV zip that is the difference between ~636 MB and
 * ~848 MB of peak heap, which is close enough to Chrome's ceiling to matter. */
(function (global) {
  const EOCD_SIG = 0x06054b50;
  const CD_SIG = 0x02014b50;
  const LFH_SIG = 0x04034b50;
  const EOCD_MIN = 22;
  const MAX_COMMENT = 65535;

  const ZIP64 = 'This zip uses Zip64, which is not supported. Re-zip it, or use Load files.';

  /** An Error carrying a stable `code` for the tests and a user-ready `message` for the UI. */
  function zipError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
  }

  const basename = (path) => path.slice(path.lastIndexOf('/') + 1);

  /* Names are decoded as UTF-8 whether or not general purpose bit 11 is set. The spec says
   * an unset bit means CP437, but real zips are either UTF-8 or plain ASCII, and a CP437
   * table would be a hundred lines to fix names that do not occur. */
  const decodeName = (bytes) => new TextDecoder('utf-8').decode(bytes);

  /** Scan backwards for the EOCD signature. Returns its offset in `dv`, or -1. */
  function findEocd(dv) {
    for (let i = dv.byteLength - EOCD_MIN; i >= 0; i--) {
      if (dv.getUint32(i, true) === EOCD_SIG) return i;
    }
    return -1;
  }

  /** Entries worth reading: real files, not Finder noise, with an audio extension. */
  function keep(path) {
    if (path.endsWith('/')) return false;                  // directory entry
    if (path.startsWith('__MACOSX/')) return false;        // Finder's resource-fork sidecar
    const base = basename(path);
    if (base.startsWith('._')) return false;               // AppleDouble
    return global.SansStems.AUDIO_RE.test(base);
  }

  /**
   * Read the audio entries out of a zip.
   * @param {Blob} blob
   * @returns {Promise<{name: string, webkitRelativePath: string, bytes: Uint8Array}[]>}
   *
   * Each `bytes` is backed by its own exact-size ArrayBuffer, never a view into a shared
   * allocation: decodeAudioData detaches what it is handed, and a shared buffer would take
   * its neighbours down with it. The result is therefore ONE-SHOT — once an entry has been
   * decoded, its buffer is detached and cannot be read again.
   */
  async function extract(blob) {
    const tailLen = Math.min(blob.size, MAX_COMMENT + EOCD_MIN);
    const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
    const e = findEocd(tail);
    if (e < 0) throw zipError('not-zip', 'That file is not a zip.');

    const total = tail.getUint16(e + 10, true);
    const cdSize = tail.getUint32(e + 12, true);
    const cdOff = tail.getUint32(e + 16, true);
    if (total === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
      throw zipError('zip64', ZIP64);
    }

    const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const wanted = [];
    let p = 0;
    for (let i = 0; i < total; i++) {
      if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== CD_SIG) {
        throw zipError('not-zip', 'That zip’s directory is damaged.');
      }
      const flags = cd.getUint16(p + 8, true);
      const method = cd.getUint16(p + 10, true);
      const cSize = cd.getUint32(p + 20, true);
      const lhOff = cd.getUint32(p + 42, true);
      const nameLen = cd.getUint16(p + 28, true);
      const extraLen = cd.getUint16(p + 30, true);
      const cmtLen = cd.getUint16(p + 32, true);
      // Without this the Uint8Array constructor throws a raw RangeError, and the user is
      // shown "Invalid typed array length: 60000" instead of being told the zip is damaged.
      if (p + 46 + nameLen > cd.byteLength) {
        throw zipError('not-zip', 'That zip’s directory is damaged.');
      }
      const path = decodeName(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
      p += 46 + nameLen + extraLen + cmtLen;

      if (!keep(path)) continue;
      if (flags & 0x1) throw zipError('encrypted', 'That zip is encrypted.');
      if (cSize === 0xffffffff || lhOff === 0xffffffff) throw zipError('zip64', ZIP64);
      wanted.push({ path, method, cSize, lhOff });
    }

    const out = [];
    for (const w of wanted) {
      out.push({
        name: basename(w.path),
        webkitRelativePath: w.path,
        bytes: await readEntry(blob, w),
      });
    }
    return out;
  }

  async function readEntry(blob, w) {
    const head = new DataView(await blob.slice(w.lhOff, w.lhOff + 30).arrayBuffer());
    if (head.byteLength < 30 || head.getUint32(0, true) !== LFH_SIG) {
      throw zipError('not-zip', `Could not find ${basename(w.path)} inside the zip.`);
    }
    /* The LOCAL header's own name and extra lengths — they are allowed to differ from the
     * central directory's, and using the CD's extra length lands mid-file. Sizes, though,
     * come from the central directory: when general purpose bit 3 is set the local sizes
     * are zero and the real ones trail the data in a descriptor. */
    const dataStart = w.lhOff + 30 + head.getUint16(26, true) + head.getUint16(28, true);

    const short = () => zipError('read',
      `Could not read ${basename(w.path)} from the zip — the file may be truncated, ` +
      `or it changed on disk.`);

    let raw;
    try {
      raw = await blob.slice(dataStart, dataStart + w.cSize).arrayBuffer();
    } catch (err) {
      throw short();
    }
    /* blob.slice() CLAMPS an out-of-range end instead of throwing, so a truncated archive
     * resolves here with fewer bytes than the central directory promised — and, unchecked,
     * hands decodeAudioData the central directory glued onto the payload. That surfaces as
     * "codec not supported", which sends the user off diagnosing the wrong thing. */
    if (raw.byteLength !== w.cSize) throw short();

    if (w.method === 0) return new Uint8Array(raw);
    if (w.method === 8) return inflateRaw(raw, w.path);
    throw zipError('method',
      `Unsupported compression in ${basename(w.path)}. Re-zip with Finder or \`zip\`.`);
  }

  async function inflateRaw(raw, path) {
    let ds;
    try {
      ds = new DecompressionStream('deflate-raw');
    } catch (err) {
      throw zipError('no-deflate',
        'This browser cannot read compressed zips. Re-zip with `zip -0`, or use Load files.');
    }
    /* A broken deflate stream rejects with a platform error whose message may be empty,
     * and say() HIDES the status bar when handed an empty string — so letting this escape
     * turns a corrupt zip into a drop that visibly does nothing at all. */
    try {
      const stream = new Blob([raw]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (err) {
      throw zipError('corrupt',
        `${basename(path)} is corrupt inside the zip and could not be decompressed.`);
    }
  }

  global.SansUnzip = { extract };
})(window);
