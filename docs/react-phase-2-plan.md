# React migration Phase 2 — player boundary plan

Status: implementation plan recorded from source at `e108c681513ea6004199efac4f0f56ca264e1800`.
Phase 1 production rollback anchor: `5de58b634e4a11b0baf2bfca6f4a1e98f3eae31d`.

## Bounded outcome

Introduce one DOM-independent ESM application facade for loading and transport, then make the
unchanged legacy controls use it. The facade will expose initialization, immutable observable
snapshots, commands, command-error reporting, subscriptions, song-generation checks, service
cleanup registration, and application disposal. It will delegate to `app.js`'s existing state
and algorithms rather than copying playback state into another store.

This slice does not add a React player mount, move lane/canvas ownership, redesign controls,
change DSP, introduce TypeScript/routing/global state, or decompose all of `app.js`.

## Current-source findings

- `app.js` is the authoritative owner of the single 44.1 kHz `AudioContext`, decoded tracks,
  gain graph, source/worklet scheduling, transport position, loop, rate, routing, canvases, and
  song UI. Module evaluation eagerly initializes the header, captures DOM, and attaches
  page-lifetime listeners.
- The one `#file-input` is authored by `index.html`, moved without replacement by
  `lib/header.js`, then captured by `app.js`. Its change listener clears `value` before loading.
- `loadZip()` extraction and `loadFiles()` decode completion have no load-generation check;
  an older request can currently build lanes after a newer request.
- `playGen` already invalidates an awaited AudioWorklet start, but it is not a song identity.
- `notes.js` and `separate.js` use `window.sansBass`, page-lifetime custom-event listeners,
  400 ms pollers, and lazy Workers. Their Worker completions are not guarded by current-song
  identity. The transport event carries the exact shared audio-clock `t0` needed by sonifiers.
- Unsubscribing UI does not exist separately from tearing down page state. Application-wide
  disposal does not exist.

## Implementation slices

1. Add a small `lib/player-application.js` facade. It owns only facade lifecycle, listener and
   registered-cleanup sets, and command errors. Its snapshots are read on demand from the
   authoritative `app.js` adapter; it stores no duplicate song or transport state.
2. Initialize that facade explicitly after the existing DOM/header prerequisites are ready.
   Expose commands for `load`, `play`, `pause`, `togglePlayback`, `seek`, and
   `setPlaybackRate`; publish at load/status/song and transport transition boundaries.
3. Mount the legacy load/play/rate controls through a disposable adapter that invokes those
   commands and subscribes for transport rendering. Unmount/remount removes only those handlers
   and its subscription; it does not dispose audio, reset the song, or restart work.
4. Add a monotonically increasing operation/song generation in the authoritative application.
   Guard ZIP extraction, parallel decode progress/completion, separation completion, and notes
   analysis completion. Application disposal invalidates the generation, stops sources and
   drawing, runs registered service cleanup, detaches the legacy adapter, and closes the audio
   context; subscriber removal alone does none of those things.
5. Retain the `sansbass:transport` custom event temporarily for the vocals/bass sonifiers because
   it is the exact-clock scheduling adapter. Retain `window.sansBass` temporarily for
   `notes.js`, `separate.js`, and the browser harness, while adding only lifecycle/song-token
   delegation to the ESM facade. Record both adapters and named consumers.
6. Add failing-first Node tests for facade initialization/snapshot, commands, errors,
   subscribe/unsubscribe, disposal, and remount semantics; add Chromium integration tests for
   generated fixture loading/replacement, transport commands, listener stability, stale
   load/Worker completion, one file input, and affected saved/blocked-locale behavior.

## Verification boundary

Run targeted Node and browser tests first, then `npm test`, `npm run build`, `git diff --check`,
and local Vite browser scenarios using generated flat/folder/unequal-duration/invalid-audio
fixtures through the real file input. Exercise LOAD-001, affected MIX-001, TRN-001, LOOP-001,
SPD-001, SEP-001, NOTE-001, LANG-001, and BOOT-001 outcomes.

Because the player entry and Worker/AudioWorklet-adjacent lifetime paths change, run the full
deployed tier on both the PR preview and production: verify displayed SHA first, nested/root
assets, real-song loading/playback/routing, notes Worker/export, 95% AudioWorklet playback, and
cached-model separation. Keep uncached-model, physical handheld, subjective visual/auditory,
and background timing evidence explicitly separate unless actually exercised.
