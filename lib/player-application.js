/**
 * DOM-independent command/subscription boundary for the player.
 *
 * The facade deliberately keeps no independently mutable copy of song or transport state.
 * `app.js` remains their authoritative owner and supplies each published read-only projection;
 * the last projection is cached only so external-store readers get stable identity between
 * publications. The facade owns its lifecycle, command-error value, listener set, and
 * monotonically increasing song-operation token.
 */

/**
 * A Set-based subscribe/publish channel. `subscribe` takes the listener plus the facade's
 * current `disposed` flag (channels have no lifecycle of their own — the facade owns
 * disposal) and returns an unsubscribe function; `publish` fans a value out to every listener,
 * isolating one listener's throw from the rest. Dedup (only publish when a value actually
 * changed) stays out of the factory and lives in each channel's own thin wrapper, since not
 * every channel needs it — host channels (`publishEditHost`/`publishChordHost`) dedupe on
 * node identity inline instead.
 */
function makeChannel(label) {
  const listeners = new Set();
  return {
    subscribe(listener, disposed) {
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
    publish(value) {
      for (const listener of [...listeners]) {
        try { listener(value); } catch (error) {
          console.error(`sans_bass: ${label} subscriber failed`, error);
        }
      }
    },
    clear() { listeners.clear(); },
  };
}

export class PlayerCommandError extends Error {
  constructor(command, cause) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'PlayerCommandError';
    this.command = command;
    this.cause = cause;
  }
}

/** A command's rejection is already surfaced through the `commandError` snapshot channel, so
 *  a caller that only wants to fire-and-forget a command needs to swallow the promise reject
 *  itself rather than let it become an unhandled rejection. */
export function ignoreReportedError(result) {
  if (result && typeof result.catch === 'function') result.catch(() => {});
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
    notesEdit: { visible: false, enabled: false, on: false },
    chord: {
      visible: false, busy: false, busyPhase: null, capo: 0, playKeyLetter: null,
      inputVisible: false, inputValue: '', inputAmbiguous: false, inputEdited: false,
      candidatesVisible: false, candidates: [], redetectVisible: false,
    },
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
  const generalChannel = makeChannel('player');
  const transportChannel = makeChannel('transport');
  const chordChannel = makeChannel('chord');
  const editHostChannel = makeChannel('edit-host');
  const chordHostChannel = makeChannel('chord-host');
  const cleanups = new Set();
  let publishedSnapshot = lifecycleSnapshot('uninitialized');
  let publishedTransport = publishedSnapshot.transport;
  let publishedChord = publishedSnapshot.chord;
  let publishedEditHost = null;
  let publishedChordHost = null;

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
    transportChannel.publish(publishedTransport);
    return publishedTransport;
  };

  /* Same "recompute every frame, publish only on change" shape as publishTransport/
   * sameTransport, for the chord segment under the playhead and the capo control that shares
   * its row — see docs/react-phase-6f-capo-chord-editor-plan.md. A distinct store from
   * `transport` (this isn't playback state) and from `notesEdit` (this must be recomputed
   * every draw() tick, not just from the discrete sites notesEdit's own source functions
   * publish from). */
  const sameChordCandidates = (left, right) => left.length === right.length
    && left.every((item, index) => item.value === right[index].value && item.label === right[index].label);

  const sameChord = (left, right) => left.visible === right.visible
    && left.busy === right.busy
    && left.busyPhase === right.busyPhase
    && left.capo === right.capo
    && left.playKeyLetter === right.playKeyLetter
    && left.inputVisible === right.inputVisible
    && left.inputValue === right.inputValue
    && left.inputAmbiguous === right.inputAmbiguous
    && left.inputEdited === right.inputEdited
    && left.candidatesVisible === right.candidatesVisible
    && left.redetectVisible === right.redetectVisible
    && sameChordCandidates(left.candidates, right.candidates);

  const publishChord = (projection = null) => {
    const next = immutable(projection || (owner?.getChordSnapshot
      ? owner.getChordSnapshot()
      : readSnapshot().chord));
    if (sameChord(publishedChord, next)) return publishedChord;
    publishedChord = next;
    chordChannel.publish(publishedChord);
    return publishedChord;
  };

  const publish = () => {
    publishedSnapshot = readSnapshot();
    publishTransport(publishedSnapshot.transport);
    publishChord(publishedSnapshot.chord);
    generalChannel.publish(publishedSnapshot);
    return publishedSnapshot;
  };

  /* A DOM node handoff, not a snapshot value — deliberately not run through `immutable()`
   * (freezing a live DOM node makes no sense and isn't needed: identity, not content, is what
   * subscribers compare). The zoomed pane's Edit-notes-toggle/Export-Import host is owned and
   * created by app.js (see docs/react-phase-6e-edit-toggle-export-import-plan.md) — this is
   * the one place in this migration where a stable mount point is handed FROM the legacy
   * owner TO React, the mirror image of `attachLaneCanvas`/`attachOverviewCanvas` (where React
   * creates the node and hands it to app.js), needed because the host's actual PARENT
   * (`zLaneSel`) is itself legacy DOM that must keep laying it out as a flex sibling of the
   * still-legacy chip list. */
  const publishEditHost = (node) => {
    if (node === publishedEditHost) return publishedEditHost;
    publishedEditHost = node;
    editHostChannel.publish(publishedEditHost);
    return publishedEditHost;
  };

  /* A DOM node handoff, not a snapshot value — same reasoning as publishEditHost above, for
   * the capo/chord-editor row's host (`zChordHost`, created by app.js at `chordGroup`'s old
   * position inside `zName` — see docs/react-phase-6f-capo-chord-editor-plan.md). */
  const publishChordHost = (node) => {
    if (node === publishedChordHost) return publishedChordHost;
    publishedChordHost = node;
    chordHostChannel.publish(publishedChordHost);
    return publishedChordHost;
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
  const requireTrackId = (id) => {
    if (typeof id !== 'string' || !id) throw new TypeError('a non-empty lane id is required');
  };
  const requireTrackVolume = (id, value) => {
    requireTrackId(id);
    requireFinite(value);
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
    toggleTrack: (id) => run('toggleTrack', [id], requireTrackId),
    setTrackVolume: (id, value) => run('setTrackVolume', [id, value], requireTrackVolume),
    replaceSong(original, stems) {
      const token = ++songToken;
      return run('replaceSong', [original, stems, token], null, token);
    },
    setEditMode: (on) => run('setEditMode', [on]),
    exportEdits: () => run('exportEdits'),
    importEdits: (file) => run('importEdits', [file], requireFile),
    setCapo: (fret) => run('setCapo', [fret], requireFinite),
    commitChord: (label) => run('commitChord', [label]),
    redetectChord: () => run('redetectChord'),
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
      return generalChannel.subscribe(listener, disposed);
    },
    subscribeTransport(listener) {
      return transportChannel.subscribe(listener, disposed);
    },
    getEditHost: () => publishedEditHost,
    publishEditHost,
    subscribeEditHost(listener) {
      return editHostChannel.subscribe(listener, disposed);
    },
    getChordSnapshot: () => publishedChord,
    publishChord,
    subscribeChord(listener) {
      return chordChannel.subscribe(listener, disposed);
    },
    getChordHost: () => publishedChordHost,
    publishChordHost,
    subscribeChordHost(listener) {
      return chordHostChannel.subscribe(listener, disposed);
    },
    attachPrimarySeekCanvas(canvas) {
      if (disposed || !owner?.attachPrimarySeekCanvas) return () => {};
      return owner.attachPrimarySeekCanvas(canvas);
    },
    attachLaneCanvas(trackId, canvas) {
      if (disposed || !owner?.attachLaneCanvas) return () => {};
      return owner.attachLaneCanvas(trackId, canvas);
    },
    attachLaneExtra(trackId, node) {
      if (disposed || !owner?.attachLaneExtra) return () => {};
      return owner.attachLaneExtra(trackId, node);
    },
    attachOverviewCanvas(canvas) {
      if (disposed || !owner?.attachOverviewCanvas) return () => {};
      return owner.attachOverviewCanvas(canvas);
    },
    attachOverviewExtra(node) {
      if (disposed || !owner?.attachOverviewExtra) return () => {};
      return owner.attachOverviewExtra(node);
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
        publishEditHost(null);
        publishChordHost(null);
        generalChannel.clear();
        transportChannel.clear();
        chordChannel.clear();
        editHostChannel.clear();
        chordHostChannel.clear();
      }
    },
  });

  return application;
}

export const playerApplication = createPlayerApplication();
