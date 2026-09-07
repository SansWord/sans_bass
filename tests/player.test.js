import { jianpuHtml } from '../lib/jianpu-html.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeWorker, instrumentAudio, loadSong, loadZip, openPlayer, waitFor } from './helpers/player-harness.js';
import { sine, stemsZip, wavFile } from './helpers/audio-fixtures.js';

let player;
afterEach(() => {
  player?.close();
  localStorage.removeItem('sans_bass.lang');
});

function dispatchPrimarySeek(player, fromFraction, toFraction = fromFraction) {
  const canvas = player.doc.getElementById('main-wave');
  const rect = canvas.getBoundingClientRect();
  canvas.setPointerCapture = vi.fn();
  const dispatch = (type, fraction) => canvas.dispatchEvent(new player.win.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    clientX: rect.left + rect.width * fraction,
    clientY: rect.top + rect.height / 2,
  }));
  dispatch('pointerdown', fromFraction);
  if (toFraction !== fromFraction) dispatch('pointermove', toFraction);
  dispatch('pointerup', toFraction);
}

function setRangeValue(player, input, value) {
  Object.getOwnPropertyDescriptor(player.win.HTMLInputElement.prototype, 'value')
    .set.call(input, String(value));
  input.dispatchEvent(new player.win.Event('input', { bubbles: true }));
}

describe('production player integration', () => {
  it('keeps React-owned loading UI stable across locale and application publications', async () => {
    player = await openPlayer();
    const application = player.win.sansBass.application;
    const shell = player.win.sansBass.playerShell;
    expect(shell).toBeTruthy();
    expect(player.doc.querySelectorAll('[data-react-player-shell]')).toHaveLength(1);
    const input = player.doc.getElementById('file-input');

    player.doc.querySelector('#lang-toggle [data-lang="zh-TW"]').click();
    expect(player.doc.getElementById('file-input')).toBe(input);
    application.publish();
    await waitFor(() => player.doc.querySelector('#lang-toggle [data-lang="zh-TW"]')
      .getAttribute('aria-pressed') === 'true', 'React locale publication');
    expect(player.doc.getElementById('file-input')).toBe(input);

    await loadZip(player, { vocals: 440, bass: 110 }, { folder: 'Stable shell' });
    const song = application.getSnapshot().song;
    const canvases = [...player.doc.querySelectorAll('.lane canvas')];
    player.doc.querySelector('#lang-toggle [data-lang="en"]').click();
    application.publish();
    await waitFor(() => player.doc.documentElement.lang === 'en', 'English shell');
    expect(player.doc.getElementById('file-input')).toBe(input);
    expect(application.getSnapshot().song).toEqual(song);
    expect([...player.doc.querySelectorAll('.lane canvas')]).toEqual(canvases);
  });

  it('renders loading, success, malformed input, and bilingual command errors from snapshots', async () => {
    player = await openPlayer();
    const application = player.win.sansBass.application;
    const blob = await stemsZip({ vocals: 440, bass: 110 }, { folder: 'Loading state' });
    const bytes = await blob.arrayBuffer();
    let release;
    const realFile = new player.win.File([bytes], 'loading.zip', { type: 'application/zip' });
    let firstSlice = true;
    const held = {
      name: realFile.name,
      size: realFile.size,
      slice(...args) {
        const slice = realFile.slice(...args);
        if (!firstSlice) return slice;
        firstSlice = false;
        return { arrayBuffer: () => new Promise((resolve) => {
          release = async () => resolve(await slice.arrayBuffer());
        }) };
      },
    };
    const loadingPromise = application.commands.load(held);
    await waitFor(() => application.getSnapshot().loading, 'loading snapshot');
    await waitFor(() => player.doc.getElementById('status').textContent === 'Reading zip…',
      'rendered loading status');
    await waitFor(() => release, 'held zip read');
    release();
    await loadingPromise;
    await waitFor(() => application.getSnapshot().song?.title === 'Loading state', 'load success');
    expect(player.win.getComputedStyle(player.doc.getElementById('status')).display).toBe('none');

    const malformed = new player.win.File([new Uint8Array([1, 2, 3])], 'broken.zip', {
      type: 'application/zip',
    });
    await expect(application.commands.load(malformed)).resolves.toBeUndefined();
    await waitFor(() => player.doc.getElementById('status').textContent.includes('not a valid zip'),
      'zip rejection');
    expect(() => application.commands.seek(Number.NaN)).toThrow(/finite number/);
    await waitFor(() => player.doc.getElementById('status').textContent.includes('Player command failed'),
      'English command error');
    player.doc.querySelector('#lang-toggle [data-lang="zh-TW"]').click();
    expect(() => application.commands.seek(Number.NaN)).toThrow(/finite number/);
    await waitFor(() => player.doc.getElementById('status').textContent.includes('播放器指令失敗'),
      'translated command error');
  });

  it('loads one valid drop and rejects unsupported, multiple, and folder-shaped drops', async () => {
    player = await openPlayer();
    const dispatchDrop = (files, items = []) => {
      const event = new player.win.DragEvent('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { files, items } });
      player.doc.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    };
    const zip = await stemsZip({ vocals: 440, bass: 110 }, { folder: 'Dropped song' });
    dispatchDrop([new player.win.File([await zip.arrayBuffer()], 'dropped.zip', {
      type: 'application/zip',
    })]);
    await waitFor(() => player.win.sansBass.application.getSnapshot().song?.title === 'Dropped song',
      'valid dropped song');

    dispatchDrop([new player.win.File(['nope'], 'notes.txt', { type: 'text/plain' })]);
    await waitFor(() => player.doc.getElementById('status').textContent.includes('not a song'),
      'unsupported drop');
    dispatchDrop([
      new player.win.File(['a'], 'a.wav', { type: 'audio/wav' }),
      new player.win.File(['b'], 'b.wav', { type: 'audio/wav' }),
    ]);
    await waitFor(() => player.doc.getElementById('status').textContent.includes('That was 2 files'),
      'multiple drop');
    dispatchDrop([], [{ webkitGetAsEntry: () => ({ isDirectory: true }) }]);
    await waitFor(() => player.doc.getElementById('status').textContent.includes('Dropping a folder'),
      'folder drop');
  });

  it('cleans overlay/listeners on shell remount without disposing the song or duplicating loads', async () => {
    player = await openPlayer();
    await loadZip(player, { vocals: 440, bass: 110 }, { folder: 'Mounted once' });
    const application = player.win.sansBass.application;
    const song = application.getSnapshot().song;
    const canvases = [...player.doc.querySelectorAll('.lane canvas')];
    player.doc.dispatchEvent(new player.win.DragEvent('dragenter', { bubbles: true, cancelable: true }));
    await waitFor(() => player.win.getComputedStyle(player.doc.getElementById('drag-overlay')).display === 'flex',
      'overlay before remount');

    player.win.sansBass.playerShell.unmount();
    expect(application.getSnapshot().song).toEqual(song);
    expect([...player.doc.querySelectorAll('.lane canvas')]).toEqual(canvases);
    expect(player.doc.getElementById('drag-overlay')).toBeNull();
    player.win.sansBass.playerShell.remount();
    player.win.sansBass.playerShell.remount();
    await waitFor(() => player.doc.getElementById('file-input'), 'shell remount');
    expect(player.doc.querySelectorAll('[data-react-player-shell]')).toHaveLength(1);
    expect(player.doc.querySelectorAll('#file-input')).toHaveLength(1);
    expect(player.doc.querySelectorAll('#lang-toggle')).toHaveLength(1);
    expect(application.getSnapshot().song).toEqual(song);
    expect(player.win.getComputedStyle(player.doc.getElementById('drag-overlay')).display).toBe('none');

    const before = application.currentSongToken();
    const zip = await stemsZip({ drums: 120, guitar: 220 }, { folder: 'Only once' });
    const event = new player.win.DragEvent('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: {
      files: [new player.win.File([await zip.arrayBuffer()], 'once.zip', { type: 'application/zip' })],
      items: [],
    } });
    player.doc.dispatchEvent(event);
    await waitFor(() => application.getSnapshot().song?.title === 'Only once', 'single remounted load');
    expect(application.currentSongToken()).toBe(before + 1);
  });

  it('restores focus after header actions while legacy field focus still excludes shortcuts', async () => {
    player = await openPlayer();
    await loadZip(player, { vocals: 440, bass: 110 });
    const application = player.win.sansBass.application;
    const language = player.doc.querySelector('#lang-toggle [data-lang="zh-TW"]');
    language.focus();
    language.click();
    expect(player.doc.activeElement).not.toBe(language);

    const mode = player.doc.getElementById('mode');
    mode.focus();
    const position = application.getSnapshot().transport.position;
    mode.dispatchEvent(new player.win.KeyboardEvent('keydown', {
      key: 'ArrowRight', bubbles: true, cancelable: true,
    }));
    expect(application.getSnapshot().transport.position).toBe(position);
    mode.dispatchEvent(new player.win.Event('change', { bubbles: true }));
    expect(player.doc.activeElement).not.toBe(mode);
  });

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

  it('renders React-owned play state and bilingual labels without duplicate playback after remount', async () => {
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

    expect(player.win.sansBass.legacyControls).toBeUndefined();
    expect(player.doc.querySelectorAll('[data-react-playback-controls]')).toHaveLength(2);
    expect(player.doc.querySelectorAll('#play')).toHaveLength(1);
    expect(player.doc.querySelectorAll('#speed')).toHaveLength(1);
    const firstPlay = player.doc.getElementById('play');
    expect(firstPlay.getAttribute('aria-label')).toBe('Play/pause');

    firstPlay.click();
    await waitFor(() => application.getSnapshot().transport.playing, 'playing publication');
    expect(firstPlay.classList.contains('playing')).toBe(true);
    expect(audio.starts).toHaveLength(2);
    firstPlay.click();
    await waitFor(() => !application.getSnapshot().transport.playing, 'paused publication');
    expect(audio.starts).toHaveLength(2);

    player.doc.querySelector('#lang-toggle [data-lang="zh-TW"]').click();
    await waitFor(() => firstPlay.getAttribute('aria-label') === '播放／暫停', 'Chinese play label');

    player.win.sansBass.playerShell.unmount();
    expect(player.doc.getElementById('play')).toBeNull();
    expect(application.getSnapshot().song).toEqual(song);
    player.win.sansBass.playerShell.remount();
    player.win.sansBass.playerShell.remount();
    expect(player.doc.querySelectorAll('#file-input')).toHaveLength(1);
    expect(player.doc.querySelectorAll('#play')).toHaveLength(1);
    expect(player.doc.querySelectorAll('#speed')).toHaveLength(1);
    expect(application.getSnapshot().song).toEqual(song);

    player.doc.getElementById('play').click();
    await waitFor(() => audio.starts.length === 4, 'one source per stem after remount');
    expect(audio.starts[2][0]).toBe(audio.starts[3][0]);
    expect(application.getSnapshot().transport.playing).toBe(true);
  });

  it('does not duplicate play analytics or source starts across React remounts', async () => {
    player = await openPlayer();
    const events = [];
    player.win.goatcounter = { count: (event) => events.push(event) };
    await new Promise((resolve) => setTimeout(resolve, 300));
    const audio = instrumentAudio(player.win);
    await loadZip(player, { vocals: 440, bass: 110 });

    player.win.sansBass.playerShell.unmount();
    player.win.sansBass.playerShell.remount();
    player.win.sansBass.playerShell.remount();
    player.doc.getElementById('play').click();
    await waitFor(() => audio.starts.length === 2, 'first remounted playback');
    player.doc.getElementById('play').click();

    player.win.sansBass.playerShell.unmount();
    player.win.sansBass.playerShell.remount();
    player.doc.getElementById('play').click();
    await waitFor(() => audio.starts.length === 4, 'second remounted playback');
    player.doc.getElementById('play').click();
    expect(events.filter((event) => event.path === 'play')).toHaveLength(1);
  });

  it('renders one React-owned accessible master volume and keeps both sliders on one smoothed gain value', async () => {
    player = await openPlayer();
    const audio = instrumentAudio(player.win);
    await loadZip(player, { vocals: sine(440, 1), bass: sine(110, 1) }, { folder: 'Volume' });
    const application = player.win.sansBass.application;
    const primary = player.doc.getElementById('master-vol');
    const overview = player.doc.querySelector('.overview .lane-vol input');

    expect(player.doc.querySelectorAll('[data-react-volume-controls]')).toHaveLength(1);
    expect(player.doc.querySelectorAll('#master-vol')).toHaveLength(1);
    expect([primary.min, primary.max, primary.step, primary.value])
      .toEqual(['0', '1.5', '0.01', '1']);
    expect(primary.getAttribute('aria-label')).toBe('Volume');
    expect(primary.getAttribute('aria-valuetext')).toBe('100%');
    expect(application.getSnapshot().masterVolume).toBe(1);
    expect(overview.value).toBe('1');

    audio.ramps.length = 0;
    setRangeValue(player, primary, 0.37);
    await waitFor(() => application.getSnapshot().masterVolume === 0.37,
      'fractional primary master volume');
    expect(overview.value).toBe('0.37');
    expect(audio.ramps.map(({ value, timeConstant }) => [value, timeConstant]))
      .toEqual([[0.37, 0.01]]);
    expect(primary.getAttribute('aria-valuetext')).toBe('37%');

    audio.ramps.length = 0;
    setRangeValue(player, overview, 0.62);
    await waitFor(() => application.getSnapshot().masterVolume === 0.62,
      'overview-to-primary master volume');
    expect(primary.value).toBe('0.62');
    expect(audio.ramps.map(({ value, timeConstant }) => [value, timeConstant]))
      .toEqual([[0.62, 0.01]]);

    application.commands.setMasterVolume(-2);
    await waitFor(() => primary.value === '0', 'minimum master volume');
    expect(overview.value).toBe('0');
    application.commands.setMasterVolume(2);
    await waitFor(() => primary.value === '1.5', 'maximum master volume');
    expect(overview.value).toBe('1.5');
    const beforeInvalid = application.getSnapshot().masterVolume;
    expect(() => application.commands.setMasterVolume(Number.NaN)).toThrow(/finite number/);
    expect(application.getSnapshot().masterVolume).toBe(beforeInvalid);

    application.commands.setMasterVolume(0.4);
    audio.ramps.length = 0;
    const startsBeforePlay = audio.starts.length;
    await application.commands.play();
    const startsAfterPlay = audio.starts.length;
    expect(startsAfterPlay).toBe(startsBeforePlay + 2);
    setRangeValue(player, primary, 0.55);
    await waitFor(() => application.getSnapshot().masterVolume === 0.55,
      'playing master volume');
    expect(audio.starts).toHaveLength(startsAfterPlay);
    application.commands.pause();
    setRangeValue(player, primary, 0.45);
    await waitFor(() => application.getSnapshot().masterVolume === 0.45,
      'paused master volume');
    expect(audio.starts).toHaveLength(startsAfterPlay);
  });

  it('keeps volume state, focus, and one direct listener across locale, routing, remount, and song replacement', async () => {
    player = await openPlayer();
    const audio = instrumentAudio(player.win);
    await loadZip(player, { vocals: 440, guitar: 220, bass: 110 }, { folder: 'Volume lifecycle' });
    const application = player.win.sansBass.application;
    application.commands.setMasterVolume(0.42);
    const primary = player.doc.getElementById('master-vol');
    const position = application.getSnapshot().transport.position;
    primary.focus();
    primary.dispatchEvent(new player.win.KeyboardEvent('keydown', {
      key: 'a', bubbles: true, cancelable: true,
    }));
    expect(application.getSnapshot().transport).toMatchObject({ position, loopA: null });

    player.doc.querySelector('#lang-toggle [data-lang="zh-TW"]').click();
    await waitFor(() => primary.getAttribute('aria-label') === '音量', 'translated volume label');
    expect(primary.getAttribute('aria-valuetext')).toBe('42%');
    expect(application.getSnapshot().masterVolume).toBe(0.42);

    player.doc.querySelector('#lanes > .lane:not(.ribbon):not(.ribbon-zoom):not(.overview) .lane-name').click();
    expect(application.getSnapshot().masterVolume).toBe(0.42);
    expect(primary.value).toBe('0.42');

    player.win.sansBass.playerShell.unmount();
    expect(player.doc.getElementById('master-vol')).toBeNull();
    player.win.sansBass.playerShell.remount();
    player.win.sansBass.playerShell.remount();
    const remounted = player.doc.getElementById('master-vol');
    expect(player.doc.querySelectorAll('[data-react-volume-controls]')).toHaveLength(1);
    expect(remounted.value).toBe('0.42');
    audio.ramps.length = 0;
    setRangeValue(player, remounted, 0.51);
    await waitFor(() => application.getSnapshot().masterVolume === 0.51,
      'single remounted volume listener');
    expect(audio.ramps.map((ramp) => ramp.value)).toEqual([0.51]);

    await loadZip(player, { vocals: 440, piano: 330 }, { folder: 'Volume replacement' });
    expect(application.getSnapshot().masterVolume).toBe(0.51);
    expect(player.doc.getElementById('master-vol').value).toBe('0.51');
    expect(player.doc.querySelector('.overview .lane-vol input').value).toBe('0.51');
  });

  it('renders partial and active loops in React while preserving keyboard timing, refresh, clear, and analytics', async () => {
    player = await openPlayer();
    const events = [];
    player.win.goatcounter = { count: (event) => events.push(event) };
    await new Promise((resolve) => setTimeout(resolve, 300));
    const audio = instrumentAudio(player.win);
    await loadZip(player, { vocals: sine(440, 2), bass: sine(110, 2) }, { folder: 'Loop' });
    const application = player.win.sansBass.application;
    const badge = player.doc.getElementById('loop-badge');
    const clear = player.doc.getElementById('loop-clear');

    expect(player.doc.querySelectorAll('[data-react-loop-controls]')).toHaveLength(1);
    expect(player.doc.querySelectorAll('#loop-badge')).toHaveLength(1);
    expect(player.win.getComputedStyle(badge).display).toBe('none');

    application.commands.seek(0.4);
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(application.getSnapshot().transport).toMatchObject({ loopA: 0.4, loopB: null });
    await waitFor(() => player.win.getComputedStyle(badge).display !== 'none', 'A-only loop badge');
    expect(player.doc.getElementById('loop-text').textContent).toContain('A set');
    expect(badge.classList.contains('armed')).toBe(false);

    application.commands.seek(0.45);
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    expect(application.getSnapshot().transport).toMatchObject({ loopA: 0.4, loopB: null });
    await waitFor(() => player.doc.getElementById('status').textContent.includes('less than'),
      'too-short loop status');

    clear.click();
    expect(application.getSnapshot().transport).toMatchObject({ loopA: null, loopB: null });
    expect(player.doc.activeElement).not.toBe(clear);
    application.commands.seek(1.2);
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    await waitFor(() => player.doc.getElementById('loop-text').textContent.includes('B set'),
      'B-only loop badge');
    application.commands.seek(0.8);
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(application.getSnapshot().transport).toMatchObject({ loopA: 0.8, loopB: 1.2 });
    await waitFor(() => badge.classList.contains('armed'), 'active loop badge');
    expect(player.doc.getElementById('loop-text').textContent).toContain('A–B 0:00 → 0:01');

    application.commands.seek(0.9);
    await application.commands.play();
    const startsBeforeRefresh = audio.starts.length;
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    await waitFor(() => audio.starts.length === startsBeforeRefresh + 2, 'playing loop refresh');
    expect(audio.sources.slice(-2).every((source) => source.loop)).toBe(true);
    clear.focus();
    clear.click();
    await waitFor(() => audio.starts.length === startsBeforeRefresh + 4, 'playing loop clear refresh');
    expect(audio.sources.slice(-2).every((source) => !source.loop)).toBe(true);
    expect(application.getSnapshot().transport).toMatchObject({ loopA: null, loopB: null });
    expect(player.win.getComputedStyle(badge).display).toBe('none');

    application.commands.pause();
    application.commands.seek(0.2);
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    application.commands.seek(0.6);
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    expect(application.getSnapshot().transport).toMatchObject({ loopA: null, loopB: null });
    application.commands.seek(0.3);
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    application.commands.seek(0.7);
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(application.getSnapshot().transport).toMatchObject({ loopA: null, loopB: null });
    expect(events.filter((event) => /^loop(?:-|$)/.test(event.path)).map((event) => event.path))
      .toEqual(['loop', 'loop-2', 'loop-4', 'loop-8']);
  });

  it('preserves loop locale/remount/replacement behavior and leaves mode, all-toggle, and lane volume legacy-owned', async () => {
    player = await openPlayer();
    const audio = instrumentAudio(player.win);
    await loadZip(player, { vocals: sine(440, 2), guitar: sine(220, 2), bass: sine(110, 2) },
      { folder: 'Adjacent controls' });
    const application = player.win.sansBass.application;
    application.commands.seek(0.4);
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    application.commands.seek(0.8);
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    const loop = { loopA: 0.4, loopB: 0.8 };

    player.doc.querySelector('#lang-toggle [data-lang="zh-TW"]').click();
    await waitFor(() => player.doc.getElementById('loop-text').textContent.includes('秒'),
      'translated active loop');
    expect(application.getSnapshot().transport).toMatchObject(loop);
    player.win.sansBass.playerShell.unmount();
    expect(player.doc.getElementById('loop-badge')).toBeNull();
    expect(application.getSnapshot().transport).toMatchObject(loop);
    player.win.sansBass.playerShell.remount();
    player.win.sansBass.playerShell.remount();
    expect(player.doc.querySelectorAll('[data-react-loop-controls]')).toHaveLength(1);
    expect(application.getSnapshot().transport).toMatchObject(loop);

    expect(player.doc.querySelectorAll('[data-react-mode-routing-controls]')).toHaveLength(0);
    const mode = player.doc.getElementById('mode');
    const all = player.doc.getElementById('all-toggle');
    expect(mode.value).toBe('mix');
    expect(all.textContent).toBe('全部靜音');
    audio.ramps.length = 0;
    mode.value = 'bass';
    mode.dispatchEvent(new player.win.Event('change', { bubbles: true }));
    expect(mode.value).toBe('bass');
    expect(audio.ramps.map((ramp) => ramp.value)).toEqual([0, 0, 1]);
    const laneVolume = player.doc.querySelector('#lanes > .lane:not(.ribbon):not(.ribbon-zoom):not(.overview) .lane-vol input');
    audio.ramps.length = 0;
    setRangeValue(player, laneVolume, 0.33);
    expect(audio.ramps.map((ramp) => ramp.value)).toEqual([0, 0, 1]);
    expect(application.getSnapshot().masterVolume).toBe(1);

    await loadZip(player, { drums: 120, piano: 330 }, { folder: 'Loop replacement' });
    expect(application.getSnapshot().transport).toMatchObject({ loopA: null, loopB: null });
    expect(player.win.getComputedStyle(player.doc.getElementById('loop-badge')).display).toBe('none');
  });

  it('renders one React-owned accessible seek control and seeks by pointer and focused keyboard at both bounds', async () => {
    player = await openPlayer();
    await loadZip(player, { vocals: sine(440, 2), bass: sine(110, 2) });
    const application = player.win.sansBass.application;
    const seek = player.doc.getElementById('main-wave');

    expect(player.doc.querySelectorAll('[data-react-seek-controls]')).toHaveLength(1);
    expect(player.doc.querySelectorAll('#main-wave')).toHaveLength(1);
    expect(seek.getAttribute('role')).toBe('slider');
    expect(seek.tabIndex).toBe(0);
    expect(seek.getAttribute('aria-label')).toBe('Seek');
    expect(Number(seek.getAttribute('aria-valuemin'))).toBe(0);
    expect(Number(seek.getAttribute('aria-valuemax'))).toBeCloseTo(2, 2);
    expect(seek.getAttribute('aria-valuetext')).toContain('0:00 of 0:02');

    dispatchPrimarySeek(player, 0.25, 0.4);
    await waitFor(() => Math.abs(application.getSnapshot().transport.position - 0.8) < 0.05,
      'paused pointer seek');
    expect(application.getSnapshot().transport.playing).toBe(false);
    expect(Number(seek.getAttribute('aria-valuenow'))).toBeCloseTo(0.8, 1);

    application.commands.seek(0);
    seek.focus();
    seek.dispatchEvent(new player.win.KeyboardEvent('keydown', {
      key: 'ArrowLeft', bubbles: true, cancelable: true,
    }));
    expect(application.getSnapshot().transport.position).toBe(0);
    application.commands.seek(2);
    seek.dispatchEvent(new player.win.KeyboardEvent('keydown', {
      key: 'ArrowRight', bubbles: true, cancelable: true,
    }));
    expect(application.getSnapshot().transport.position).toBeCloseTo(2, 2);

    const speed = player.doc.getElementById('speed');
    speed.focus();
    speed.dispatchEvent(new player.win.KeyboardEvent('keydown', {
      key: 'ArrowLeft', bubbles: true, cancelable: true,
    }));
    expect(application.getSnapshot().transport.position).toBeCloseTo(2, 2);

    player.doc.querySelector('#lang-toggle [data-lang="zh-TW"]').click();
    await waitFor(() => seek.getAttribute('aria-label') === '搜尋播放位置',
      'translated seek label');
    expect(seek.getAttribute('aria-valuetext')).toContain('0:02／0:02');
  });

  it('keeps the React clock rate-aware while playing and clamps pointer seeks into an active loop', async () => {
    player = await openPlayer();
    await loadZip(player, { vocals: sine(440, 2), bass: sine(110, 2) });
    const application = player.win.sansBass.application;
    player.win.dispatchEvent(new player.win.CustomEvent('sansbass:tempo', {
      detail: { bpmValue: 120, confidence: 1 },
    }));
    const context = player.win.sansBass.notesAudio('vocals').ctx;
    let clock = context.currentTime;
    Object.defineProperty(context, 'currentTime', { configurable: true, get: () => clock });
    application.commands.setPlaybackRate(0.5);
    await application.commands.play();
    const seek = player.doc.getElementById('main-wave');
    clock += 0.2;
    await waitFor(() => Number(seek.getAttribute('aria-valuenow')) > 0.05,
      'rate-aware playing clock');
    expect(Number(seek.getAttribute('aria-valuenow'))).toBeCloseTo(0.1, 1);
    expect(player.doc.getElementById('t-speed').textContent).toBe('50%');
    expect(player.doc.getElementById('t-bpm').textContent).toBe('60.0/120.0 BPM');
    expect(application.getSnapshot().transport.playing).toBe(true);

    dispatchPrimarySeek(player, 0.5);
    await waitFor(() => Math.abs(Number(seek.getAttribute('aria-valuenow')) - 1) < 0.1,
      'playing pointer seek');
    expect(application.getSnapshot().transport.playing).toBe(true);

    application.commands.seek(0.4);
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    application.commands.seek(0.8);
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    expect(application.getSnapshot().transport).toMatchObject({ loopA: 0.4, loopB: 0.8 });
    dispatchPrimarySeek(player, 0.95);
    await waitFor(() => {
      const position = Number(player.doc.getElementById('main-wave').getAttribute('aria-valuenow'));
      return position >= 0.4 && position < 0.8;
    }, 'loop-clamped seek');
    expect(application.getSnapshot().transport.playing).toBe(true);
  });

  it('preserves seek state and one pointer/analytics owner across React remounts', async () => {
    player = await openPlayer();
    const events = [];
    player.win.goatcounter = { count: (event) => events.push(event) };
    await new Promise((resolve) => setTimeout(resolve, 300));
    await loadZip(player, { vocals: sine(440, 1), bass: sine(110, 1) }, { folder: 'Seek remount' });
    const application = player.win.sansBass.application;
    application.commands.seek(0.25);
    const song = application.getSnapshot().song;
    const firstCanvas = player.doc.getElementById('main-wave');

    player.win.sansBass.playerShell.unmount();
    expect(player.doc.getElementById('main-wave')).toBeNull();
    expect(application.getSnapshot().song).toEqual(song);
    expect(application.getSnapshot().transport.position).toBeCloseTo(0.25, 2);
    player.win.sansBass.playerShell.remount();
    player.win.sansBass.playerShell.remount();
    const remountedCanvas = player.doc.getElementById('main-wave');
    expect(remountedCanvas).not.toBe(firstCanvas);
    expect(player.doc.querySelectorAll('[data-react-seek-controls]')).toHaveLength(1);
    expect(player.doc.querySelectorAll('#main-wave')).toHaveLength(1);
    await waitFor(() => Number(remountedCanvas.getAttribute('aria-valuenow')) === 0.25,
      'remounted seek position');
    expect(remountedCanvas.width).toBeGreaterThan(1);

    dispatchPrimarySeek(player, 0.5);
    await waitFor(() => Math.abs(application.getSnapshot().transport.position - 0.5) < 0.05,
      'single remounted seek');
    const seekEvents = events.filter((event) => /^seek(?:-|$)/.test(event.path));
    expect(seekEvents.map((event) => event.path)).toEqual(['seek', 'seek-2']);
  });

  it('enters playback synchronously and renders direct and keyboard rate changes in React', async () => {
    player = await openPlayer();
    await loadZip(player, { vocals: 440, bass: 110 });
    const application = player.win.sansBass.application;
    const context = player.win.sansBass.notesAudio('vocals').ctx;
    const realResume = context.resume.bind(context);
    const resume = vi.fn(() => Promise.resolve());
    Object.defineProperty(context, 'state', { configurable: true, get: () => 'suspended' });
    context.resume = resume;

    const play = player.doc.getElementById('play');
    play.focus();
    play.click();
    expect(resume).toHaveBeenCalledOnce();
    expect(application.getSnapshot().transport.playing).toBe(true);
    expect(player.doc.activeElement).not.toBe(play);
    application.commands.pause();
    context.resume = realResume;

    const speed = player.doc.getElementById('speed');
    const speedValue = player.doc.getElementById('speed-val');
    expect([speed.min, speed.max, speed.step, speed.value, speedValue.textContent])
      .toEqual(['10', '150', '5', '100', '100%']);
    Object.getOwnPropertyDescriptor(player.win.HTMLInputElement.prototype, 'value')
      .set.call(speed, '95');
    speed.dispatchEvent(new player.win.Event('input', { bubbles: true }));
    await waitFor(() => speedValue.textContent === '95%', 'React speed input publication');
    expect(application.getSnapshot().transport.playbackRate).toBe(0.95);

    for (const key of [']', '{', '}', '\\']) {
      player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', {
        key, bubbles: true, cancelable: true,
      }));
    }
    await waitFor(() => speedValue.textContent === '100%', 'legacy reset publication');
    expect(speed.value).toBe('100');

    application.commands.setPlaybackRate(-1);
    await waitFor(() => speed.value === '10', 'lower rate bound');
    application.commands.setPlaybackRate(2);
    await waitFor(() => speed.value === '150', 'upper rate bound');
    application.commands.setPlaybackRate(1);

    speed.focus();
    speed.dispatchEvent(new player.win.KeyboardEvent('keydown', {
      key: '[', bubbles: true, cancelable: true,
    }));
    expect(application.getSnapshot().transport.playbackRate).toBe(1);
    speed.blur();
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', {
      key: '[', bubbles: true, cancelable: true,
    }));
    await waitFor(() => speed.value === '95', 'shortcut after focus restoration');

    play.focus();
    play.dispatchEvent(new player.win.KeyboardEvent('keydown', {
      key: ']', bubbles: true, cancelable: true,
    }));
    expect(application.getSnapshot().transport.playbackRate).toBe(0.95);
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
    await waitFor(() => player.doc.getElementById('status').textContent.includes('finite number'),
      'rendered invalid command');
    player.doc.querySelector('#lang-toggle [data-lang="zh-TW"]').click();
    expect(() => application.commands.setPlaybackRate(Number.NaN)).toThrow(/finite number/);
    await waitFor(() => player.doc.getElementById('status').textContent.includes('播放器指令失敗'),
      'rendered Chinese command error');
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
    const application = player.win.sansBass.application;
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
    const select = async (name, frequency, seconds = 0.04) => {
      const source = wavFile(name, sine(frequency, seconds));
      const file = new player.win.File([await source.arrayBuffer()], name, { type: 'audio/wav' });
      const transfer = new player.win.DataTransfer();
      transfer.items.add(file);
      const input = player.doc.getElementById('file-input');
      Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
      input.dispatchEvent(new player.win.Event('change', { bubbles: true }));
    };

    await select('old.wav', 110, 0.2);
    await waitFor(() => releaseFirst, 'first decode to be held');
    await select('new.wav', 220);
    await waitFor(() => player.doc.getElementById('title').textContent === 'new', 'new song');
    expect(Number(player.doc.getElementById('main-wave').getAttribute('aria-valuemax')))
      .toBeCloseTo(0.04, 2);
    application.commands.setPlaybackRate(0.95);
    const transport = application.getSnapshot().transport;
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(player.doc.getElementById('title').textContent).toBe('new');
    expect(player.win.sansBass.application.getSnapshot().song.title).toBe('new');
    expect(application.getSnapshot().transport).toEqual(transport);
    expect(Number(player.doc.getElementById('main-wave').getAttribute('aria-valuemax')))
      .toBeCloseTo(0.04, 2);
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
    await waitFor(() => player.win.getComputedStyle(overlay).display === 'flex', 'overlay showing');
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
    await loadZip(player, { vocals: sine(440, 2), bass: sine(110, 2) });
    const application = player.win.sansBass.application;
    const canvases = [...player.doc.querySelectorAll('.lane canvas')];
    const input = player.doc.getElementById('file-input');
    player.doc.querySelector('#lanes > .lane:not(.ribbon):not(.ribbon-zoom):not(.overview) .lane-name').click();
    const mode = player.doc.getElementById('mode').value;
    application.commands.seek(0.1);
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    application.commands.seek(0.4);
    player.doc.dispatchEvent(new player.win.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    application.commands.setPlaybackRate(0.95);
    await application.commands.play();
    const song = application.getSnapshot().song;
    const before = application.getSnapshot().transport;
    player.doc.querySelector('#lang-toggle [data-lang="zh-TW"]').click();
    expect(player.doc.documentElement.lang).toBe('zh-TW');
    expect(player.doc.title).toContain('分軌播放器');
    expect(player.doc.getElementById('mode').value).toBe(mode);
    expect([...player.doc.querySelectorAll('.lane canvas')]).toEqual(canvases);
    expect(player.doc.getElementById('file-input')).toBe(input);
    expect(application.getSnapshot().song).toEqual(song);
    expect(application.getSnapshot().transport).toMatchObject({
      playing: true, playbackRate: 0.95, loopA: before.loopA, loopB: before.loopB,
    });
    application.publish();
    await waitFor(() => player.doc.getElementById('speed-val').textContent === '95%',
      'React rate after status publication');
    player.win.sansBass.playerShell.unmount();
    player.win.sansBass.playerShell.remount();
    expect(application.getSnapshot().song).toEqual(song);
    expect(application.getSnapshot().transport).toMatchObject({
      playing: true, playbackRate: 0.95, loopA: before.loopA, loopB: before.loopB,
    });
    expect(player.doc.getElementById('mode').value).toBe(mode);
    expect([...player.doc.querySelectorAll('.lane canvas')]).toEqual(canvases);
    expect(player.doc.querySelector('#lanes > .lane:not(.ribbon):not(.ribbon-zoom):not(.overview) .txt').textContent)
      .toBe('人聲');
  });
});
