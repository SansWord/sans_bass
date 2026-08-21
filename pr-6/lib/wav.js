/* 16-bit PCM WAV encoding. Pure and synchronous — no Web Audio involvement. */

/** Demucs output can exceed +/-1.0; clamp first or the Int16 conversion wraps into loud noise. */
function toInt16(x) {
  const c = x < -1 ? -1 : x > 1 ? 1 : x;
  return Math.round(c * 32767);
}

/**
 * Encode two Float32 channels as a 16-bit stereo WAV file.
 * @returns {Uint8Array} the complete file, header included
 */
export function encodeWav(left, right, sampleRate = 44100) {
  const frames = Math.min(left.length, right.length);
  const blockAlign = 4;                    // 2 channels * 2 bytes
  const dataBytes = frames * blockAlign;
  const bytes = new Uint8Array(44 + dataBytes);
  const dv = new DataView(bytes.buffer);

  const ascii = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };

  ascii(0, 'RIFF');
  dv.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  dv.setUint32(16, 16, true);              // fmt chunk length
  dv.setUint16(20, 1, true);               // 1 = PCM
  dv.setUint16(22, 2, true);               // channels
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 16, true);              // bits per sample
  ascii(36, 'data');
  dv.setUint32(40, dataBytes, true);

  let off = 44;
  for (let i = 0; i < frames; i++) {
    dv.setInt16(off, toInt16(left[i]), true); off += 2;
    dv.setInt16(off, toInt16(right[i]), true); off += 2;
  }
  return bytes;
}
