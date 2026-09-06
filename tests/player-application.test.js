import { describe, expect, it, vi } from 'vitest';
import { createPlayerApplication, PlayerCommandError } from '../lib/player-application.js';

function adapter(overrides = {}) {
  const state = {
    song: null,
    loading: false,
    transport: {
      playing: false, position: 0, duration: 0, playbackRate: 1, loopA: null, loopB: null,
    },
    status: null,
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
      setPlaybackRate: vi.fn(),
      replaceSong: vi.fn(),
      ...overrides.commands,
    },
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
    application.commands.setPlaybackRate(0.95);
    application.commands.replaceSong({ name: 'song.wav' }, { vocals: {} });

    expect(owner.commands.load).toHaveBeenCalledWith(file, 1);
    expect(owner.commands.rejectLoad).toHaveBeenCalledWith('multiple', { count: 2 });
    expect(owner.commands.play).toHaveBeenCalledOnce();
    expect(owner.commands.pause).toHaveBeenCalledOnce();
    expect(owner.commands.togglePlayback).toHaveBeenCalledOnce();
    expect(owner.commands.seek).toHaveBeenCalledWith(2.5);
    expect(owner.commands.setPlaybackRate).toHaveBeenCalledWith(0.95);
    expect(owner.commands.replaceSong).toHaveBeenCalledWith(
      { name: 'song.wav' }, { vocals: {} }, 2,
    );
    expect(application.currentSongToken()).toBe(2);
    expect(() => application.commands.rejectLoad('mystery')).toThrow(PlayerCommandError);
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
