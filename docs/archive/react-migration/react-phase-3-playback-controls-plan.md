# React migration Phase 3b — playback controls plan

Status: accepted in production at `99ac653ec20de0d54035c0c89cb5dfb7ab40a77d`
through [PR #71](https://github.com/SansWord/sans_bass/pull/71). Implementation source:
`6ae46b2fbbb9ec0b75c892725ee67b050931a0cc`; planned from `8ab8f63c` on 2026-09-06.
Previous accepted rollback anchor: Phase 3a at
`467f91b06aabb5fed68822bf254736e719e2abee`.

## Bounded outcome

Give React sole ownership of the primary play/pause button and the playback-speed label,
slider, and value. Add both regions to the existing `PlayerShell` root through explicit
portal hosts. Events call only `playerApplication.commands.togglePlayback()` and
`playerApplication.commands.setPlaybackRate()`; rendering reads the existing immutable
transport snapshot. Do not migrate seek, master volume, A/B controls, mode/routing menus,
lanes, canvases, loading, separation, detection, notes, Workers, AudioWorklets, or DSP.

## Current-source ownership audit

| Region / behavior | Owner at plan source | Transfer or retention in Phase 3b |
|---|---|---|
| Play/pause DOM and accessible copy | `index.html` authors `#play`; the document-wide i18n traversal writes `aria-label`; `lib/legacy-player-controls.js` toggles `.playing`. | React authors the button, translated accessible label, icon, and `.playing` state from the application snapshot. Remove the parser-authored control and every legacy write. |
| Play click | `lib/legacy-player-controls.js` installs/removes the listener and calls `commands.togglePlayback()`. | React owns one `onClick` calling the same command synchronously. The command reaches `app.js:play()` in the same trusted event turn, so `ensureAudio()` remains before the first possible `await`. |
| Speed DOM and presentation | `index.html` authors the translated label, `#speed`, and `#speed-val`; `lib/legacy-player-controls.js` writes slider/value from published transport state. | React authors and translates all three, preserving 10–150, step 5, and the visible rounded percentage. Remove all legacy writes. |
| Speed input | `lib/legacy-player-controls.js` installs/removes `input` and calls `commands.setPlaybackRate(value / 100)`. | React owns one `onInput` with the same command and units. Existing engine clamping, native/stretched crossing, clock rebasing, worklet messages, drawing, BPM/time tags, and per-song reset remain unchanged. |
| Keyboard play/rate shortcuts | One document `keydown` listener in `app.js`; editable `INPUT`/`SELECT`/`TEXTAREA` targets return before non-Space command routing, while focused buttons can currently leak a key into both native activation and the document owner. Space calls `togglePlayback`; `[`, `]`, `{`, `}`, and `\\` call the rate command. | Retain as the sole keyboard owner and close the focused-button double-dispatch hole. React subscribes to resulting publications. The slider inherits the established field exclusion; the play button blurs after activation so document shortcuts resume. |
| Application, song, audio, and adjacent transport | `lib/player-application.js` owns lifecycle/subscriptions; `app.js` owns song, transport values, AudioContext, sources/worklets, loop/routing, analytics, loading, lanes, and canvases. | Retain. UI unmount removes only React subscriptions/listeners. Locale/status publications and remounts cannot dispose or recreate the application or engine resources. |

## Legacy retirement and remaining adapters

`lib/legacy-player-controls.js` has one production import (`app.js`) and one browser-harness
lifecycle consumer (`window.sansBass.legacyControls`). Both exist solely for the controls in
this transfer. Remove the import, mount/unmount plumbing, compatibility member, and module in
the same slice. `window.sansBass.playerShell` remains the named browser-harness adapter for
React remount checks. `window.sansBass` otherwise remains for notes/separation and the browser
harness; `sansbass:transport` remains for the two notes sonifiers.

## Failing-first and implementation increments

1. Add production-entry browser assertions for React-authored control uniqueness, bilingual
   play labeling/state, synchronous click command entry, rate bounds/value/reset, legacy
   shortcut publication, focus exclusions/restoration, state/resource identity across locale
   publication and shell remount, listener/start/analytics uniqueness, replacement/stale load,
   and unchanged Phase 3a input/loading behavior. Run the focused browser file against the
   legacy owner and retain the expected failures.
2. Add play and speed portals to `PlayerShell`; preserve the existing markup/classes and use
   `useSyncExternalStore`'s one application snapshot for all shell regions.
3. Replace the two parser-authored controls with stable portal hosts. Remove legacy mounting,
   DOM references, writes, listeners, harness surface, and the now-unconsumed adapter module.
4. Run focused and complete automated gates, production build, diff check, and exact-source
   root/nested local build smoke with generated WAV/ZIP fixtures. Compare emitted/startup
   bundle values with accepted Phase 3a.

## Verification boundary and explicit omissions

Exercise affected TRN/PLAY, SPD/RATE, LANG, BOOT, LOAD, LOOP, and ANALYTICS outcomes. Preview
must display the exact synthetic merge SHA before root/nested, saved/blocked locale,
real-song, trusted play/pause, 95% stretched playback, shortcut/focus, remount preservation,
unchanged loading, and clean first-party-console assertions. Use genuine browser keyboard
input for trusted unlock. After merge, verify the exact production SHA and required production
tier before acceptance.

Report generated synthetic, malformed-input, storage/locale, handheld, Worker, visual,
auditory, and `examples/nov_you.zip` real-song evidence separately. Physical handheld,
uncached separation/model download, exhaustive subjective visual comparison, background
transport, and auditory pitch/seam quality remain explicit omissions unless actually run.
Phase 3b can accept only play/pause and speed; seek, volume, A/B, mode/routing, and all other
player groups remain for later increments.
