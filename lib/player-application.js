/**
 * DOM-independent command/subscription boundary for the player.
 *
 * The facade deliberately keeps no independently mutable copy of song or transport state.
 * `app.js` remains their authoritative owner and supplies each published read-only projection;
 * the last projection is cached only so external-store readers get stable identity between
 * publications. The facade owns its lifecycle, command-error value, listener set, and
 * monotonically increasing song-operation token.
 */

export class PlayerCommandError extends Error {
  constructor(command, cause) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'PlayerCommandError';
    this.command = command;
    this.cause = cause;
  }
}

function immutable(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(immutable));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, immutable(child)]),
    ));
  }
  return value;
}

function lifecycleSnapshot(lifecycle, commandError = null) {
  return immutable({
    lifecycle,
    song: null,
    loading: false,
    masterVolume: 1,
    routing: { mode: 'mix', allToggleLabel: 'unmuteAll' },
    transport: {
      playing: false, position: 0, duration: 0, playbackRate: 1, loopA: null, loopB: null,
      tempoBpm: null,
    },
    status: null,
    commandError,
  });
}

export function createPlayerApplication() {
  let owner = null;
  let disposed = false;
  let songToken = 0;
  let commandError = null;
  const listeners = new Set();
  const transportListeners = new Set();
  const cleanups = new Set();
  let publishedSnapshot = lifecycleSnapshot('uninitialized');
  let publishedTransport = publishedSnapshot.transport;

  const readSnapshot = () => {
    if (disposed) return lifecycleSnapshot('disposed', commandError);
    if (!owner) return lifecycleSnapshot('uninitialized', commandError);
    return immutable({ lifecycle: 'ready', ...owner.getSnapshot(), commandError });
  };
  const getSnapshot = () => publishedSnapshot;

  const sameTransport = (left, right) => left.playing === right.playing
    && left.position === right.position
    && left.duration === right.duration
    && left.playbackRate === right.playbackRate
    && left.loopA === right.loopA
    && left.loopB === right.loopB
    && left.tempoBpm === right.tempoBpm;

  const publishTransport = (projection = null) => {
    const next = immutable(projection || (owner?.getTransportSnapshot
      ? owner.getTransportSnapshot()
      : readSnapshot().transport));
    if (sameTransport(publishedTransport, next)) return publishedTransport;
    publishedTransport = next;
    for (const listener of [...transportListeners]) {
      try { listener(publishedTransport); } catch (error) {
        console.error('sans_bass: transport subscriber failed', error);
      }
    }
    return publishedTransport;
  };

  const publish = () => {
    publishedSnapshot = readSnapshot();
    publishTransport(publishedSnapshot.transport);
    for (const listener of [...listeners]) {
      try { listener(publishedSnapshot); } catch (error) {
        console.error('sans_bass: player subscriber failed', error);
      }
    }
    return publishedSnapshot;
  };

  const report = (command, cause) => {
    const error = cause instanceof PlayerCommandError ? cause : new PlayerCommandError(command, cause);
    commandError = { command: error.command, message: error.message };
    try { owner?.reportCommandError?.(error); } catch (reportError) {
      console.error('sans_bass: command error reporter failed', reportError);
    }
    publish();
    return error;
  };

  const assertReady = (command) => {
    if (!owner || disposed) throw report(command, new Error(
      disposed ? 'player application is disposed' : 'player application is not initialized',
    ));
  };

  const run = (command, args = [], validate = null, operationToken = null) => {
    try {
      assertReady(command);
      validate?.(...args);
      commandError = null;
      const result = owner.commands[command](...args);
      if (result && typeof result.then === 'function') {
        return result.then((value) => {
          if (operationToken === null || application.isCurrentSongToken(operationToken)) publish();
          return value;
        }, (error) => {
          if (operationToken !== null && !application.isCurrentSongToken(operationToken)) return undefined;
          throw report(command, error);
        });
      }
      publish();
      return result;
    } catch (error) {
      if (error instanceof PlayerCommandError) throw error;
      throw report(command, error);
    }
  };

  const requireFile = (file) => {
    if (!file || typeof file.name !== 'string') throw new TypeError('a File is required');
  };
  const requireFinite = (value) => {
    if (!Number.isFinite(value)) throw new TypeError('a finite number is required');
  };
  const requireMode = (value) => {
    if (typeof value !== 'string' || !value) throw new TypeError('a non-empty mode is required');
  };
  const requireLoadRejection = (reason) => {
    if (!['folder', 'multiple', 'unsupported'].includes(reason)) {
      throw new TypeError('a recognized load rejection is required');
    }
  };

  const commands = Object.freeze({
    load(file) {
      requireFile(file);
      const token = ++songToken;
      return run('load', [file, token], null, token);
    },
    rejectLoad: (reason, details = {}) => run(
      'rejectLoad', [reason, details], requireLoadRejection,
    ),
    play: () => run('play'),
    pause: () => run('pause'),
    togglePlayback: () => run('togglePlayback'),
    seek: (seconds) => run('seek', [seconds], requireFinite),
    previewSeek: (seconds) => run('previewSeek', [seconds], requireFinite),
    setPlaybackRate: (rate) => run('setPlaybackRate', [rate], requireFinite),
    setMasterVolume: (volume) => run('setMasterVolume', [volume], requireFinite),
    clearLoop: () => run('clearLoop'),
    setMode: (mode) => run('setMode', [mode], requireMode),
    toggleAllTracks: () => run('toggleAllTracks'),
    replaceSong(original, stems) {
      const token = ++songToken;
      return run('replaceSong', [original, stems, token], null, token);
    },
  });

  const application = Object.freeze({
    commands,
    initialize(nextOwner) {
      if (disposed) throw new Error('cannot initialize a disposed player application');
      if (owner) throw new Error('player application is already initialized');
      if (!nextOwner?.getSnapshot || !nextOwner?.commands) {
        throw new TypeError('player application owner needs getSnapshot and commands');
      }
      owner = nextOwner;
      publish();
      return application;
    },
    getSnapshot,
    publish,
    getTransportSnapshot: () => publishedTransport,
    publishTransport,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('subscriber must be a function');
      if (disposed) return () => {};
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
      };
    },
    subscribeTransport(listener) {
      if (typeof listener !== 'function') throw new TypeError('subscriber must be a function');
      if (disposed) return () => {};
      transportListeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        transportListeners.delete(listener);
      };
    },
    attachPrimarySeekCanvas(canvas) {
      if (disposed || !owner?.attachPrimarySeekCanvas) return () => {};
      return owner.attachPrimarySeekCanvas(canvas);
    },
    registerCleanup(cleanup) {
      if (typeof cleanup !== 'function') throw new TypeError('cleanup must be a function');
      if (disposed) { cleanup(); return () => {}; }
      cleanups.add(cleanup);
      return () => cleanups.delete(cleanup);
    },
    currentSongToken: () => songToken,
    isCurrentSongToken: (token) => !disposed && token === songToken,
    dispose() {
      if (disposed) return;
      disposed = true;
      songToken++;
      for (const cleanup of [...cleanups]) {
        try { cleanup(); } catch (error) { console.error('sans_bass: cleanup failed', error); }
      }
      cleanups.clear();
      try { owner?.dispose?.(); } finally {
        owner = null;
        publish();
        listeners.clear();
        transportListeners.clear();
      }
    },
  });

  return application;
}

export const playerApplication = createPlayerApplication();
