import { jianpuHtml } from '../lib/jianpu-html.js';
import { afterEach, describe, expect, it } from 'vitest';
import { installFakeWorker, instrumentAudio, loadSong, loadZip, openPlayer, waitFor } from './helpers/player-harness.js';

let player;
afterEach(() => player?.close());

describe('production player integration', () => {
  it('changes exported capo and chords in empty bars without altering notes', async () => {
    const frame = document.createElement('iframe');
    const loaded = new Promise((resolve) => frame.onload = resolve);
    frame.srcdoc = jianpuHtml({ title: 'Song — 1=A# minor', bars: [[], [], []],
      barsPerLine: 2, bpm: 120, beatsPerBar: 4, tonic: 10, capo: 3,
      chords: [{ first: 'A#/D', second: 'Fm' }, { first: null, second: null }, { first: 'D#7', second: null }] });
    document.body.append(frame);
    try {
      await loaded;
      const doc = frame.contentDocument;
      const select = doc.querySelector('#capo');
      expect(select.value).toBe('3');
      expect(doc.querySelector('.chord-first').textContent).toBe('G/B');
      expect(doc.querySelectorAll('.bar')).toHaveLength(3);
      for (const [fret, key, chord, tail] of [[0, 'A#', 'A#/D', 'D#7'], [11, 'B', 'B/D#', 'E7'], [3, 'G', 'G/B', 'C7']]) {
        select.value = String(fret);
        select.dispatchEvent(new frame.contentWindow.Event('change'));
        expect(doc.querySelector('.play-key').textContent).toContain(key);
        expect(doc.querySelector('.chord-first').textContent).toBe(chord);
        expect(doc.querySelectorAll('.chord-first')[1].textContent).toBe(tail);
        expect(doc.querySelectorAll('.frag')).toHaveLength(0);
        expect(doc.querySelector('h1').textContent).toBe('Song — 1=A# minor');
      }
    } finally { frame.remove(); }
  });

  it('shows capo-transposed play chords and play key without changing concert data', async () => {
    player = await openPlayer();
    await loadZip(player, { vocals: 440, guitar: 220 });
    player.win.dispatchEvent(new player.win.CustomEvent('sansbass:chords', { detail: {
      capo: 0,
      key: { tonicPc: 10, mode: 'major' },
      chords: [{ start: 0, end: 2, barStart: true, label: 'A#', candidates: [{ label: 'A#', confidence: 0.9 }] }],
    } }));
    const capo = player.doc.querySelector('.capo-select');
    capo.value = '3';
    capo.dispatchEvent(new player.win.Event('change', { bubbles: true }));
    expect(player.doc.querySelector('.chord-field').value).toBe('G');
    expect(player.doc.querySelector('.capo-play-key').textContent).toBe('Play key G');
  });

  it('distinguishes waiting for notes from active chord detection', async () => {
    player = await openPlayer();
    await loadZip(player, { vocals: 440, bass: 110, guitar: 220 });
    const status = player.doc.querySelector('.zoom-chord-row .chord-status');
    player.win.dispatchEvent(new player.win.CustomEvent('sansbass:chords', {
      detail: { chords: [], running: true, phase: 'waiting' },
    }));
    expect(status.textContent).toBe('Waiting for note detection…');
    player.win.dispatchEvent(new player.win.CustomEvent('sansbass:chords', {
      detail: { chords: [], running: true, phase: 'detecting' },
    }));
    expect(status.textContent).toBe('Detecting chords…');
  });

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
