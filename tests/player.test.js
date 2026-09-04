import { afterEach, describe, expect, it } from 'vitest';
import { installFakeWorker, instrumentAudio, loadSong, loadZip, openPlayer, waitFor } from './helpers/player-harness.js';

let player;
afterEach(() => player?.close());

describe('production player integration', () => {
  it('loads generated stems through the one real file input', async () => {
    player = await openPlayer();
    const input = await loadZip(player, { bass: 110, vocals: 440 }, {
      folder: 'Fixture song', order: ['vocals', 'bass'],
    });
    expect(input.multiple).toBe(false);
    expect(player.doc.getElementById('title').textContent).toBe('Fixture song');
    expect([...player.doc.querySelectorAll('#lanes > .lane:not(.ribbon):not(.ribbon-zoom):not(.overview) > .lane-name .txt')].map((node) => node.textContent))
      .toEqual(['Vocals', 'Bass']);
  });

  it('applies routing state to lane classes, mode, labels, and gain ramps', async () => {
    player = await openPlayer();
    const audio = instrumentAudio(player.win);
    await loadZip(player, { vocals: 440, guitar: 220, bass: 110 });
    audio.ramps.length = 0;
    const lane = player.doc.querySelector('#lanes > .lane:not(.ribbon):not(.ribbon-zoom):not(.overview)');
    lane.querySelector('.lane-name').click();
    expect(lane.classList.contains('muted')).toBe(true);
    expect(player.doc.getElementById('mode').value).toBe('custom');
    expect(player.doc.getElementById('all-toggle').textContent).toBe('Unmute all');
    expect(audio.ramps.map((ramp) => ramp.value)).toEqual([0, 1, 1]);
  });

  it('uses cancelable drag events and computed visibility for the global overlay', async () => {
    player = await openPlayer();
    const overlay = player.doc.getElementById('drag-overlay');
    expect(player.win.getComputedStyle(overlay).display).toBe('none');
    player.doc.dispatchEvent(new player.win.DragEvent('dragenter', { bubbles: true, cancelable: true }));
    expect(player.win.getComputedStyle(overlay).display).toBe('flex');
    const over = new player.win.DragEvent('dragover', { bubbles: true, cancelable: true });
    player.doc.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    player.doc.dispatchEvent(new player.win.DragEvent('dragleave', { bubbles: true }));
    await waitFor(() => player.win.getComputedStyle(overlay).display === 'none', 'overlay hiding');
  });

  it('drives separation running and success controls through a deterministic fake Worker', async () => {
    player = await openPlayer();
    const workers = installFakeWorker(player.win);
    await loadSong(player);
    const go = player.doc.getElementById('sep-go');
    await waitFor(() => player.win.getComputedStyle(go).display !== 'none', 'separation control');
    go.click();
    expect(go.disabled).toBe(true);
    expect(player.win.getComputedStyle(player.doc.getElementById('sep-cancel')).display).not.toBe('none');
    const channel = () => new player.win.Float32Array(441);
    workers[0].emit({ type: 'result', stems: Object.fromEntries(
      ['vocals', 'guitar', 'bass', 'drums', 'piano', 'other'].map((stem) => [stem, { left: channel(), right: channel() }]),
    ) });
    await waitFor(() => player.doc.querySelectorAll('#lanes > .lane:not(.ribbon):not(.ribbon-zoom):not(.overview)').length === 6,
      'six separated lanes');
    expect(player.win.getComputedStyle(go).display).toBe('none');
    expect(player.win.getComputedStyle(player.doc.getElementById('sep-save')).display).not.toBe('none');
    expect(player.doc.getElementById('sep-status').textContent).toBe('');
  });

  it('rerenders language without replacing playback canvases or routing', async () => {
    player = await openPlayer();
    await loadZip(player, { vocals: 440, bass: 110 });
    const canvases = [...player.doc.querySelectorAll('.lane canvas')];
    player.doc.querySelector('#lanes > .lane:not(.ribbon):not(.ribbon-zoom):not(.overview) .lane-name').click();
    const mode = player.doc.getElementById('mode').value;
    player.doc.querySelector('#lang-toggle [data-lang="zh-TW"]').click();
    expect(player.doc.documentElement.lang).toBe('zh-TW');
    expect(player.doc.title).toContain('分軌播放器');
    expect(player.doc.getElementById('mode').value).toBe(mode);
    expect([...player.doc.querySelectorAll('.lane canvas')]).toEqual(canvases);
    expect(player.doc.querySelector('#lanes > .lane:not(.ribbon):not(.ribbon-zoom):not(.overview) .txt').textContent)
      .toBe('人聲');
  });
});
