import { describe, expect, it } from 'vitest';
import { extract } from '../lib/unzip.js';
import { clickTrack, silence, sine, stemsZip, wavFile } from './helpers/audio-fixtures.js';

describe('generated audio fixtures', () => {
  it('creates deterministic samples at 44100 Hz', () => {
    expect(silence(0.01)).toHaveLength(441);
    expect([...sine(110, 0.001)]).toEqual([...sine(110, 0.001)]);
    const clicks = clickTrack({ bpm: 120, seconds: 1.1 });
    expect(clicks[0]).toBe(1);
    expect(clicks[22050]).toBe(1);
  });

  it('encodes a named stereo WAV with a 44100 Hz header', async () => {
    const file = wavFile('vocals.wav', sine(440, 0.01));
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(file.name).toBe('vocals.wav');
    expect(new DataView(bytes.buffer).getUint32(24, true)).toBe(44100);
  });

  it('round-trips configurable stored stem layouts through production ZIP code', async () => {
    const folder = await extract(await stemsZip(
      { bass: 110, vocals: 440 },
      { folder: '歌曲', order: ['vocals', 'bass'], sidecars: true, unknown: { ambience: 220 } },
    ));
    expect(folder.map((entry) => entry.webkitRelativePath)).toEqual([
      '歌曲/vocals.wav', '歌曲/bass.wav', '歌曲/ambience.wav',
    ]);
    const flat = await extract(await stemsZip({ bass: 110 }, { layout: 'flat' }));
    expect(flat[0].webkitRelativePath).toBe('bass.wav');
  });

  it('can include a mix and deliberately invalid audio bytes', async () => {
    const entries = await extract(await stemsZip(
      { bass: 110 },
      { mix: 330, invalidAudio: { 'broken.wav': new Uint8Array([1, 2, 3]) } },
    ));
    expect(entries.map((entry) => entry.name)).toEqual(['bass.wav', 'mix.wav', 'broken.wav']);
  });
});
