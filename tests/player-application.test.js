import { describe, expect, it, vi } from 'vitest';
import { createPlayerApplication, PlayerCommandError } from '../lib/player-application.js';

function adapter(overrides = {}) {
  const state = {
    song: null,
    loading: false,
    masterVolume: 1,
    routing: { mode: 'mix', allToggleLabel: 'unmuteAll' },
    transport: {
      playing: false, position: 0, duration: 0, playbackRate: 1, loopA: null, loopB: null,
      tempoBpm: null,
    },
    status: null,
    notesEdit: { visible: false, enabled: false, on: false },
  };
  return {
    state,
    getSnapshot: () => state,
    commands: {
      load: vi.fn(),
      rejectLoad: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      togglePlayback: vi.fn(),
      seek: vi.fn(),
      previewSeek: vi.fn(),
      setPlaybackRate: vi.fn(),
      setMasterVolume: vi.fn(),
      clearLoop: vi.fn(),
      setMode: vi.fn(),
      toggleAllTracks: vi.fn(),
      toggleTrack: vi.fn(),
      setTrackVolume: vi.fn(),
      replaceSong: vi.fn(),
      setEditMode: vi.fn(),
      exportEdits: vi.fn(),
      importEdits: vi.fn(),
      ...overrides.commands,
    },
    getTransportSnapshot: () => state.transport,
    attachPrimarySeekCanvas: vi.fn(() => vi.fn()),
    attachLaneCanvas: vi.fn(() => vi.fn()),
    attachLaneExtra: vi.fn(() => vi.fn()),
    attachOverviewCanvas: vi.fn(() => vi.fn()),
    attachOverviewExtra: vi.fn(() => vi.fn()),
    reportCommandError: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  };
}

describe('player application command/subscription facade', () => {
  it('initializes explicitly and exposes the authoritative initial snapshot', () => {
    const application = createPlayerApplication();
    expect(application.getSnapshot()).toMatchObject({ lifecycle: 'uninitialized' });

    const owner = adapter();
    application.initialize(owner);

    const initial = application.getSnapshot();
    expect(initial).toBe(application.getSnapshot());
    expect(initial).toMatchObject({
      lifecycle: 'ready',
      song: null,
      loading: false,
      masterVolume: 1,
      routing: { mode: 'mix', allToggleLabel: 'unmuteAll' },
      transport: { playing: false, position: 0, duration: 0, playbackRate: 1 },
      commandError: null,
    });
  });

  it('subscribes and unsubscribes idempotently without disposing the application', () => {
    const application = createPlayerApplication();
    const owner = adapter();
    const listener = vi.fn();
    const unsubscribe = application.subscribe(listener);

    application.initialize(owner);
    application.publish();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    unsubscribe();
    application.publish();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(owner.dispose).not.toHaveBeenCalled();

    const remounted = vi.fn();
    application.subscribe(remounted);
    application.publish();
    expect(remounted).toHaveBeenCalledOnce();
    expect(application.getSnapshot().lifecycle).toBe('ready');
  });

  it('delegates loading, transport, and replacement commands with one generation token', async () => {
    const application = createPlayerApplication();
    const owner = adapter();
    application.initialize(owner);
    const file = { name: 'song.wav' };

    await application.commands.load(file);
    application.commands.rejectLoad('multiple', { count: 2 });
    application.commands.play();
    application.commands.pause();
    application.commands.togglePlayback();
    application.commands.seek(2.5);
    application.commands.previewSeek(2.75);
    application.commands.setPlaybackRate(0.95);
    application.commands.setMasterVolume(0.375);
    application.commands.clearLoop();
    application.commands.setMode('bass');
    application.commands.toggleAllTracks();
    application.commands.toggleTrack('bass');
    application.commands.setTrackVolume('bass', 0.6);
    application.commands.replaceSong({ name: 'song.wav' }, { vocals: {} });
    application.commands.setEditMode(true);
    application.commands.exportEdits();
    const editsFile = { name: 'edits.json' };
    application.commands.importEdits(editsFile);

    expect(owner.commands.load).toHaveBeenCalledWith(file, 1);
    expect(owner.commands.rejectLoad).toHaveBeenCalledWith('multiple', { count: 2 });
    expect(owner.commands.play).toHaveBeenCalledOnce();
    expect(owner.commands.pause).toHaveBeenCalledOnce();
    expect(owner.commands.togglePlayback).toHaveBeenCalledOnce();
    expect(owner.commands.seek).toHaveBeenCalledWith(2.5);
    expect(owner.commands.previewSeek).toHaveBeenCalledWith(2.75);
    expect(owner.commands.setPlaybackRate).toHaveBeenCalledWith(0.95);
    expect(owner.commands.setMasterVolume).toHaveBeenCalledWith(0.375);
    expect(owner.commands.clearLoop).toHaveBeenCalledOnce();
    expect(owner.commands.setMode).toHaveBeenCalledWith('bass');
    expect(owner.commands.toggleAllTracks).toHaveBeenCalledOnce();
    expect(owner.commands.toggleTrack).toHaveBeenCalledWith('bass');
    expect(owner.commands.setTrackVolume).toHaveBeenCalledWith('bass', 0.6);
    expect(owner.commands.replaceSong).toHaveBeenCalledWith(
      { name: 'song.wav' }, { vocals: {} }, 2,
    );
    expect(owner.commands.setEditMode).toHaveBeenCalledWith(true);
    expect(owner.commands.exportEdits).toHaveBeenCalledOnce();
    expect(owner.commands.importEdits).toHaveBeenCalledWith(editsFile);
    expect(application.currentSongToken()).toBe(2);
    expect(() => application.commands.rejectLoad('mystery')).toThrow(PlayerCommandError);
    expect(() => application.commands.setMasterVolume(Number.NaN)).toThrow(PlayerCommandError);
    expect(() => application.commands.setMode('')).toThrow(PlayerCommandError);
    expect(() => application.commands.setMode(1)).toThrow(PlayerCommandError);
    expect(() => application.commands.toggleTrack('')).toThrow(PlayerCommandError);
    expect(() => application.commands.toggleTrack(3)).toThrow(PlayerCommandError);
    expect(() => application.commands.setTrackVolume('bass', Number.NaN)).toThrow(PlayerCommandError);
    expect(() => application.commands.setTrackVolume('', 0.5)).toThrow(PlayerCommandError);
    expect(() => application.commands.importEdits(null)).toThrow(PlayerCommandError);
  });

  it('publishes a deduplicated transport clock and cleans its subscription independently', () => {
    const application = createPlayerApplication();
    const owner = adapter();
    application.initialize(owner);
    const listener = vi.fn();
    const unsubscribe = application.subscribeTransport(listener);

    application.publishTransport();
    expect(listener).not.toHaveBeenCalled();
    owner.state.transport = { ...owner.state.transport, position: 1.25 };
    application.publishTransport();
    application.publishTransport();
    expect(listener).toHaveBeenCalledOnce();
    expect(application.getTransportSnapshot().position).toBe(1.25);

    unsubscribe();
    unsubscribe();
    owner.state.transport = { ...owner.state.transport, position: 2.5 };
    application.publishTransport();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('hands the Edit-notes toggle/Export-Import host to React, deduplicated by node identity', () => {
    const application = createPlayerApplication();
    application.initialize(adapter());
    expect(application.getEditHost()).toBeNull();
    const listener = vi.fn();
    const unsubscribe = application.subscribeEditHost(listener);

    const host = {};
    application.publishEditHost(host);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(host);
    expect(application.getEditHost()).toBe(host);

    application.publishEditHost(host);   // same reference — no redundant notification
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    application.publishEditHost(null);
    expect(listener).toHaveBeenCalledOnce();
    expect(application.getEditHost()).toBeNull();
  });

  it('attaches and detaches the primary seek renderer without disposing the application', () => {
    const application = createPlayerApplication();
    const cleanup = vi.fn();
    const owner = adapter({ attachPrimarySeekCanvas: vi.fn(() => cleanup) });
    application.initialize(owner);
    const canvas = {};

    const detach = application.attachPrimarySeekCanvas(canvas);
    expect(owner.attachPrimarySeekCanvas).toHaveBeenCalledWith(canvas);
    detach();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(owner.dispose).not.toHaveBeenCalled();
    expect(application.getSnapshot().lifecycle).toBe('ready');
  });

  it('attaches and detaches a lane renderer by id without disposing the application', () => {
    const application = createPlayerApplication();
    const cleanup = vi.fn();
    const owner = adapter({ attachLaneCanvas: vi.fn(() => cleanup) });
    application.initialize(owner);
    const canvas = {};

    const detach = application.attachLaneCanvas('bass', canvas);
    expect(owner.attachLaneCanvas).toHaveBeenCalledWith('bass', canvas);
    detach();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(owner.dispose).not.toHaveBeenCalled();
    expect(application.getSnapshot().lifecycle).toBe('ready');
  });

  it('attaches and detaches a lane extra-content host by id without disposing the application', () => {
    const application = createPlayerApplication();
    const cleanup = vi.fn();
    const owner = adapter({ attachLaneExtra: vi.fn(() => cleanup) });
    application.initialize(owner);
    const node = {};

    const detach = application.attachLaneExtra('drums', node);
    expect(owner.attachLaneExtra).toHaveBeenCalledWith('drums', node);
    detach();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(owner.dispose).not.toHaveBeenCalled();
    expect(application.getSnapshot().lifecycle).toBe('ready');
  });

  it('attaches and detaches the overview canvas renderer without disposing the application', () => {
    const application = createPlayerApplication();
    const cleanup = vi.fn();
    const owner = adapter({ attachOverviewCanvas: vi.fn(() => cleanup) });
    application.initialize(owner);
    const canvas = {};

    const detach = application.attachOverviewCanvas(canvas);
    expect(owner.attachOverviewCanvas).toHaveBeenCalledWith(canvas);
    detach();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(owner.dispose).not.toHaveBeenCalled();
    expect(application.getSnapshot().lifecycle).toBe('ready');
  });

  it('attaches and detaches the overview extra-content host without disposing the application', () => {
    const application = createPlayerApplication();
    const cleanup = vi.fn();
    const owner = adapter({ attachOverviewExtra: vi.fn(() => cleanup) });
    application.initialize(owner);
    const node = {};

    const detach = application.attachOverviewExtra(node);
    expect(owner.attachOverviewExtra).toHaveBeenCalledWith(node);
    detach();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(owner.dispose).not.toHaveBeenCalled();
    expect(application.getSnapshot().lifecycle).toBe('ready');
  });

  it('reports command errors in the snapshot and rejects stale or invalid work', async () => {
    const application = createPlayerApplication();
    const owner = adapter({ commands: { load: vi.fn(async () => { throw new Error('decode broke'); }) } });
    application.initialize(owner);

    await expect(application.commands.load({ name: 'broken.wav' })).rejects.toMatchObject({
      name: 'PlayerCommandError', command: 'load', message: 'decode broke',
    });
    expect(owner.reportCommandError).toHaveBeenCalledWith(expect.objectContaining({ command: 'load' }));
    expect(application.getSnapshot().commandError).toMatchObject({ command: 'load', message: 'decode broke' });
    expect(() => application.commands.seek(Number.NaN)).toThrow(PlayerCommandError);

    const token = application.currentSongToken();
    expect(application.isCurrentSongToken(token)).toBe(true);
    await application.commands.load({ name: 'new.wav' }).catch(() => {});
    expect(application.isCurrentSongToken(token)).toBe(false);
  });

  it('does not report an older load failure after a newer song operation starts', async () => {
    let rejectOld;
    const application = createPlayerApplication();
    const owner = adapter({ commands: { load: vi.fn()
      .mockImplementationOnce(() => new Promise((resolve, reject) => { rejectOld = reject; }))
      .mockResolvedValueOnce(undefined) } });
    application.initialize(owner);

    const oldLoad = application.commands.load({ name: 'old.wav' });
    await application.commands.load({ name: 'new.wav' });
    rejectOld(new Error('old decode failed'));
    await expect(oldLoad).resolves.toBeUndefined();

    expect(owner.reportCommandError).not.toHaveBeenCalled();
    expect(application.getSnapshot().commandError).toBeNull();
  });

  it('disposes registered services and the owner once while invalidating late work', () => {
    const application = createPlayerApplication();
    const owner = adapter();
    const cleanup = vi.fn();
    application.initialize(owner);
    application.registerCleanup(cleanup);
    const token = application.currentSongToken();

    application.dispose();
    application.dispose();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(owner.dispose).toHaveBeenCalledOnce();
    expect(application.isCurrentSongToken(token)).toBe(false);
    expect(application.getSnapshot()).toMatchObject({ lifecycle: 'disposed' });
    expect(() => application.commands.play()).toThrow(PlayerCommandError);
  });
});
