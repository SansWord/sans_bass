import { jianpuHtml } from '../lib/jianpu-html.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeWorker, instrumentAudio, loadSong, loadZip, openPlayer, waitFor } from './helpers/player-harness.js';
import { sine, stemsZip, wavFile } from './helpers/audio-fixtures.js';

let player;
afterEach(() => player?.close());

describe('production player integration', () => {
  it('initializes one observable application without loading a song', async () => {
    player = await openPlayer();
    const application = player.win.sansBass.application;
    expect(application.getSnapshot()).toMatchObject({
      lifecycle: 'ready', song: null, loading: false,
      transport: {
        playing: false, position: 0, duration: 0, playbackRate: 1, loopA: null, loopB: null,
      },
    });
    expect(player.doc.querySelectorAll('#file-input')).toHaveLength(1);
  });

  it('keeps one real file input reusable for the same file selection', async () => {
    player = await openPlayer();
    const blob = await stemsZip({ vocals: 440, bass: 110 }, { folder: 'Repeat' });
    const file = new player.win.File([await blob.arrayBuffer()], 'repeat.zip', { type: 'application/zip' });
    const transfer = new player.win.DataTransfer();
    transfer.items.add(file);
    const input = player.doc.getElementById('file-input');
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });

    input.dispatchEvent(new player.win.Event('change', { bubbles: true }));
    await waitFor(() => player.win.sansBass.application.getSnapshot().song?.title === 'Repeat', 'first selection');
    const firstId = player.win.sansBass.application.getSnapshot().song.id;
    expect(input.value).toBe('');

    input.dispatchEvent(new player.win.Event('change', { bubbles: true }));
    await waitFor(() => player.win.sansBass.application.getSnapshot().song?.id !== firstId, 'repeat selection');
    expect(player.doc.querySelectorAll('#file-input')).toHaveLength(1);
    expect(player.win.sansBass.application.getSnapshot().song.title).toBe('Repeat');
  });

  it('unsubscribes and remounts legacy controls without resetting the song or duplicating playback', async () => {
    player = await openPlayer();
    const audio = instrumentAudio(player.win);
    await loadZip(player, { vocals: 440, bass: 110 });
    const application = player.win.sansBass.application;
    const song = application.getSnapshot().song;
    const listener = vi.fn();
    const unsubscribe = application.subscribe(listener);
    application.publish();
    unsubscribe();
    application.publish();
    expect(listener).toHaveBeenCalledOnce();

    player.win.sansBass.legacyControls.unmount();
    player.win.sansBass.legacyControls.remount();
    player.win.sansBass.legacyControls.remount();
    expect(player.doc.querySelectorAll('#file-input')).toHaveLength(1);
    expect(application.getSnapshot().song).toEqual(song);

    player.doc.getElementById('play').click();
    await waitFor(() => audio.starts.length === 2, 'one source per loaded stem');
    expect(audio.starts[0][0]).toBe(audio.starts[1][0]);
    expect(application.getSnapshot().transport.playing).toBe(true);
  });

  it('loads, replaces, and controls transport through application commands', async () => {
    player = await openPlayer();
    const audio = instrumentAudio(player.win);
    await loadZip(player, { vocals: sine(440, 0.2), bass: sine(110, 0.12) }, { folder: 'First' });
    const application = player.win.sansBass.application;
    expect(application.getSnapshot().song.title).toBe('First');

    await application.commands.play();
    expect(audio.starts).toHaveLength(2);
    expect(audio.starts[0][0]).toBe(audio.starts[1][0]);
    application.commands.pause();
    expect(application.getSnapshot().transport.playing).toBe(false);
    application.commands.seek(0.03);
    expect(application.getSnapshot().transport.position).toBeCloseTo(0.03, 2);
    application.commands.setPlaybackRate(0.95);
    expect(application.getSnapshot().transport.playbackRate).toBe(0.95);

    application.commands.seek(0);
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    application.commands.seek(0.04);
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    expect(application.getSnapshot().transport).toMatchObject({ loopA: 0, loopB: null });
    application.commands.seek(0.15);
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    expect(application.getSnapshot().transport).toMatchObject({ loopA: 0, loopB: 0.15 });

    await loadZip(player, { drums: 120, guitar: 220 }, { folder: 'Second' });
    await waitFor(() => player.doc.getElementById('title').textContent === 'Second', 'replacement song');
    expect(application.getSnapshot()).toMatchObject({
      song: { title: 'Second' },
      transport: { playing: false, position: 0, playbackRate: 1 },
    });
  });

  it('reports invalid command input without disabling later controls', async () => {
    player = await openPlayer();
    const application = player.win.sansBass.application;
    expect(() => application.commands.seek(Number.NaN)).toThrow(/finite number/);
    expect(application.getSnapshot().commandError).toMatchObject({ command: 'seek' });
    expect(player.doc.getElementById('status').textContent).toContain('finite number');
    player.doc.querySelector('#lang-toggle [data-lang="zh-TW"]').click();
    expect(() => application.commands.setPlaybackRate(Number.NaN)).toThrow(/finite number/);
    expect(player.doc.getElementById('status').textContent).toContain('播放器指令失敗');
    player.doc.querySelector('#lang-toggle [data-lang="en"]').click();
    await loadSong(player);
    expect(application.getSnapshot().song.title).toBe('song');
  });

  it('retains usable generated stems when another archive entry cannot decode', async () => {
    player = await openPlayer();
    await loadZip(player, { vocals: 440, bass: 110 }, {
      folder: 'Partial', invalidAudio: { 'broken.wav': new Uint8Array([1, 2, 3, 4]) },
    });
    expect(player.doc.querySelectorAll('#lanes > .lane:not(.ribbon):not(.ribbon-zoom):not(.overview)')).toHaveLength(2);
    expect(player.doc.getElementById('status').textContent).toContain('broken.wav');
    expect(player.win.sansBass.application.getSnapshot().song.title).toBe('Partial');
  });

  it('ignores a decoded song that finishes after a newer replacement', async () => {
    player = await openPlayer();
    const originalDecode = player.win.AudioContext.prototype.decodeAudioData;
    let releaseFirst;
    let decodeCount = 0;
    player.win.AudioContext.prototype.decodeAudioData = function (bytes) {
      if (decodeCount++ === 0) {
        return new Promise((resolve, reject) => {
          releaseFirst = () => originalDecode.call(this, bytes).then(resolve, reject);
        });
      }
      return originalDecode.call(this, bytes);
    };
    const select = async (name, frequency) => {
      const source = wavFile(name, sine(frequency, 0.04));
      const file = new player.win.File([await source.arrayBuffer()], name, { type: 'audio/wav' });
      const transfer = new player.win.DataTransfer();
      transfer.items.add(file);
      const input = player.doc.getElementById('file-input');
      Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
      input.dispatchEvent(new player.win.Event('change', { bubbles: true }));
    };

    await select('old.wav', 110);
    await waitFor(() => releaseFirst, 'first decode to be held');
    await select('new.wav', 220);
    await waitFor(() => player.doc.getElementById('title').textContent === 'new', 'new song');
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(player.doc.getElementById('title').textContent).toBe('new');
    expect(player.win.sansBass.application.getSnapshot().song.title).toBe('new');
  });

  it('ignores stale notes and separation Worker results after replacement or disposal', async () => {
    player = await openPlayer();
    const workers = installFakeWorker(player.win);
    await loadZip(player, { vocals: 440, guitar: 220 }, { folder: 'Analysed' });
    const detect = player.doc.getElementById('notes-go-all');
    await waitFor(() => !detect.disabled, 'notes detection control');
    detect.click();
    expect(workers).toHaveLength(1);

    await loadSong(player, { filename: 'replacement.wav' });
    workers[0].emit({ type: 'result', frames: [] });
    expect(player.win.getComputedStyle(player.doc.getElementById('notes-vocals')).display).toBe('none');
    expect(player.win.sansBass.application.getSnapshot().song.title).toBe('replacement');

    player.doc.getElementById('sep-go').click();
    expect(workers).toHaveLength(2);
    player.win.sansBass.application.dispose();
    const channel = () => new player.win.Float32Array(441);
    workers[1].emit({ type: 'result', stems: Object.fromEntries(
      ['vocals', 'guitar', 'bass', 'drums', 'piano', 'other'].map((stem) => [stem, { left: channel(), right: channel() }]),
    ) });
    expect(player.win.sansBass.application.getSnapshot().lifecycle).toBe('disposed');
    expect(player.doc.querySelectorAll('#file-input')).toHaveLength(1);
  });

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
