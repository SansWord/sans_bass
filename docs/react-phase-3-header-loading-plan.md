# React migration Phase 3a — player header and loading plan

Status: implemented locally at `8892b87cf73e25d60fa2ed6b6988cca04e6b43bf` and verified
on PR #69's preview; production acceptance pending. Plan source:
`02aca2022ff8e99f8b510c6e92de17d27179d67d`.
Accepted Phase 2 rollback anchor: `6657528afdac67f75c5b3118bbd651d4d6684b6b`.

## Bounded outcome

Give React sole ownership of the player header, its one file-loading control, the empty-state
loading explanation, loading/status/error presentation, and the window drag/drop overlay.
Reuse the common header component already proven on the React demo route. Valid input reaches
the existing loader only through `playerApplication.commands.load()`; decoded tracks, song
replacement, AudioContext, Workers, canvases, transport, routing, notes, separation, and DSP
remain owned by their current modules.

This is the first Phase 3 increment, not completion of Phase 3. Play/pause, seek, master
volume, speed, A/B loop controls, mode menus, lanes, canvases, separation, detection, notes,
and DSP remain legacy-owned after it ships.

## Current-source ownership audit

| Region / behavior | Owner at plan source | Transfer or retention in this increment |
|---|---|---|
| Player header descendants and locale listeners | `lib/header.js:initHeader()` replaces the header descendants, moves the parser-created `.loadzone`, and installs page-lifetime click/language listeners without a disposer. | Transfer to `PlayerHeader` using the common React site-header component. Remove the player call to `initHeader`; keep the legacy module only if a remaining test/consumer still requires it. |
| Demo header | `components/DemoHeader.jsx` owns the demo header through `demos.jsx`; `useLocale()` cleans its subscription. | Retain ownership and factor its shared brand/navigation/repository/language markup into one component used by both pages. Demo loading remains absent. |
| Real file input | `index.html` authors it; `lib/header.js` moves the same node; `lib/legacy-player-controls.js` owns its `change` listener and clears `value`. | React authors exactly one keyed/stable input and owns its listener. Clear `value` before invoking `playerApplication.commands.load()` and release control focus. Remove the legacy listener and element dependency in the same slice. |
| Empty loading affordance | `index.html` authors `#dropzone`; `app.js:buildUI()` hides it after a song loads; handheld startup mutates its translation key. | React renders it from the application snapshot and the unchanged handheld predicate. Remove the legacy hidden/key writes. |
| Status/loading/error | `app.js:say()` stores the stable translation key and writes `#status`; language changes call `say()` again. | Keep `lastSay` as authoritative application state, but make `say()` publish only. React translates and renders the snapshot. No legacy code writes the migrated node. |
| Drag/drop overlay and validation | `index.html` authors `#drag-overlay`; five page-lifetime document listeners and `showDropTarget()` in `app.js` own visibility, cleanup, validation, load dispatch, and rejection copy. | A React effect owns all drag listeners and component-local overlay visibility/depth. Valid drops call `commands.load`; invalid drops call one narrowly added `commands.rejectLoad(reason, details)` because React cannot otherwise publish the established app status/analytics without reaching into private engine state. Cleanup removes every listener and clears the overlay without disposing the application. |
| Player application/audio/song lifetime | `lib/player-application.js` plus `app.js`; subscribers are disposable independently of the application. | Retain. Shell mount/unmount subscribes only; it never initializes or disposes the application. Language, status, and overlay renders cannot recreate engine resources. |
| Legacy transport and all later UI | `app.js`, `lib/legacy-player-controls.js`, `notes.js`, and `separate.js`. | Retain exactly. The legacy adapter continues to own play and speed only; existing mode, volume, loop, keyboard, lane/canvas, notes, and separation listeners remain unchanged. |

## Implementation increments

1. Add failing browser assertions for a React-owned stable input, loading/success/rejection
   presentation, valid and rejected drops, overlay cleanup, focus/shortcut behavior,
   application-preserving shell remount, listener/root/control uniqueness, and stale load
   protection. Retain the Phase 2 facade tests for subscription and disposal semantics.
2. Extract a shared `SiteHeader` from the demo pilot. Add a player shell with one React root
   and explicit portal hosts for header, empty/loading affordance, status, and overlay, so the
   legacy player DOM is neither reparsed nor claimed by React.
3. Move the file change and document drag listeners to React. Extend the facade only with the
   enumerated drop-rejection command required to reach the existing `say()` and fixed
   `folder-drop` analytics path. Retire the matching `app.js`, `lib/header.js`, and legacy
   adapter writes/listeners in the same change.
4. Expose shell unmount/remount only on the existing browser-harness compatibility object.
   The production UI imports the ESM mount and facade directly. Record this temporary named
   consumer and remove it when the browser harness no longer needs lifecycle inspection.
5. Run targeted Node/jsdom/Chromium tests, the complete suite, build, diff check, and a local
   built root/nested smoke using generated WAV/ZIP fixtures. Compare emitted/startup JavaScript
   with Phase 2 because React now enters the player route.

## Verification boundary

Exercise affected LOAD-001, LANG-001, BOOT-001, and ANALYTICS-001 outcomes. Synthetic browser
coverage must include one repeatable file input; language switches before/after load; loaded
song/canvas/transport identity across publications and shell rerenders; translated loading,
success, malformed/unsupported/folder/multiple-file and command-error states; valid drop;
overlay depth/dragend/drop/unmount cleanup; focus restoration and the unchanged shortcut
exclusions; one active subscription/listener set after remount; and an older decode resolving
after a newer song.

Because the player mount and loading entry points change, run the boundary-relevant preview
tier at the exact displayed synthetic merge SHA: player and demo routes at the nested base,
saved and blocked locale storage, repeat real input selection, valid synthetic input,
drag/drop rejection and overlay cleanup, current-song preservation through language/remount,
real-song load, and a clean first-party console. After merge, verify the exact production SHA
and repeat the required production tier before recording acceptance.

Report synthetic, malformed-input, storage/locale, handheld, Worker, visual, auditory, and
real-song evidence separately. `examples/nov_you.zip` is only the real-song deployment smoke,
not the behavior matrix. Cached/uncached separation, physical handheld, subjective auditory,
background transport, and unrelated editor/export behavior are explicit omissions unless
actually run; Worker and canvas identity checks are retained as non-disposal evidence rather
than claims that their full scenarios changed.
