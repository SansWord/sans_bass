# React migration Phase 3d — volume and A/B loop controls plan

Status: implementation complete; PR preview and production acceptance pending. Planned from
`61f72522e2e6b311ed0b6b9acf58f83e043e50fc` on 2026-09-06.
Previous accepted rollback anchor: Phase 3c at
`20a55bbf61984b7a49771f5e367bb33729c879ad`.
Implementation source: `f2e0b704e9dd61a712a571cd88ec4ca37d4d2d72`.

## Two-slice ownership map

| Region / behavior | Owner at plan source | Phase 3d | Phase 3e |
|---|---|---|---|
| Primary master-volume label, slider, accessible value, and direct listener | `index.html` authors the control; `app.js` captures it, creates the master gain from its value, smooths direct input, and mirrors the overview slider. | React authors and translates the primary control and invokes one application command. `app.js` retains the master gain and smoothing; the legacy overview slider invokes the same command and mirrors the authoritative projection in both directions. | Retain the accepted React owner. |
| A/B badge, translated state, and Clear button | `index.html` authors the badge; `app.js` writes visibility, class, and text and owns the button listener. | React renders the published A/B bounds and owns the Clear listener through one application command. `app.js` retains loop normalization, audio refresh, timing, seek/rate behavior, markers, keyboard shortcuts, and analytics. | Retain the accepted React owner. |
| Mode selector and all-toggle button | `index.html` authors both; `app.js` builds options, writes selection/labels, attaches direct listeners, and applies routing. | Retain unchanged and cover with one lightweight regression. | React authors translated presentation, accessibility, focus restoration, and direct listeners from a narrow authoritative routing projection; `app.js` retains routing/gain algorithms and keyboard routing. |
| Locale, focus, remount, and listeners | React shell subscribes to locale/application/transport; `app.js` owns one shared document shortcut listener and legacy direct listeners for the remaining controls. | Volume/loop render from the existing shell subscriptions and clean up with the shell. Keep A/B/C/Escape and focused-control exclusions in the document owner. | Mode/all-toggle join the same lifecycle; keep 0 and 1–6 in the shared document owner. |
| Lanes, overview/zoom, audio, Workers, notes, separation, and drawing | `app.js`, `notes.js`, and `separate.js`. | Retain. Only the overview master-volume mirror crosses the new command seam. | Retain for Phase 4 and later. |

## Bounded outcome

Give React sole ownership of the primary master-volume label, slider, accessible value, and
direct input listener, plus the A/B loop badge, its translated state presentation, and its
Clear button. Add those regions to the existing `PlayerShell` root through explicit portal
hosts. Extend `playerApplication` only with `setMasterVolume(value)` and `clearLoop()` and
publish the authoritative master-volume value beside the existing loop projection.

Do not migrate mode/routing, lane controls, per-lane volume, overview/zoom ownership,
separation, detection, notes, other canvases, audio scheduling, loop timing, or DSP. This is
a bounded Phase 3 increment, not completion of Phase 3.

## Detailed ownership and preservation

| Concern | Transfer or retention in Phase 3d |
|---|---|
| Master-volume state and gain | `app.js` owns one numeric `masterVolume` value, clamps it to 0–1.5, creates the existing master `GainNode`, and retains the 0.01-second smoothing target. React reads the projection and calls the command synchronously. Invalid non-finite command input is rejected at the facade. |
| Overview mirror | The dynamically built legacy overview slider stays with the overview lane. It initializes from the authoritative value and calls the same application command; the engine updates it when the primary React control changes. No legacy code reads, writes, or dispatches through the React-owned primary node. |
| Mute/routing independence | Track mute and per-lane gain remain in `applyGains()` and are not folded into master volume. Mode, all-toggle, lane listeners, gain ramps, and routing snapshots remain unchanged. |
| Loop presentation and command | React derives hidden/A-only/B-only/complete presentation and `.armed` from `transport.loopA`/`loopB`; its button invokes `clearLoop()`. `app.js` retains `setLoopPoint`, ordering, minimum length rejection, `refreshLoop`, source/worklet rebuilds, seek confinement, rate interaction, markers, and loop analytics. |
| Keyboard and focus | The one document listener keeps A/B/C/Escape. Inputs keep the existing non-Space shortcut exclusion. The Clear button blurs after activation so shortcuts resume without double dispatch. |
| Locale and lifecycle | React translates its own label, loop copy, and button title/text. Locale changes and shell unmount/remount do not recreate audio, reset the song, or duplicate subscriptions/listeners. Song replacement clears loop bounds through the existing engine path and preserves master volume. |

## Failing-first and implementation increments

1. Add facade and production-entry browser assertions for command validation/delegation;
   React ownership/uniqueness; default, min/max, fractional, invalid, and bounded volume;
   paused/playing smoothing; overview synchronization both ways; routing independence;
   partial, complete, reversed, too-short, cleared, and replaced loops; keyboard/focus,
   locale, remount, replacement, and listener/analytics uniqueness; and one unchanged
   mode/all-toggle/per-lane regression. Run them against the legacy owner and retain the
   expected failures.
2. Add the two narrow facade commands and authoritative volume projection. Keep loop state in
   `app.js`; do not create a second store.
3. Add volume and loop portals to `PlayerShell`, preserving established markup/classes and
   using its existing application snapshot and locale render.
4. Replace parser-authored primary controls with portal hosts. Remove only their eager DOM
   captures, direct writes, and direct listeners. Rewire the overview mirror through the
   application command while leaving the overview DOM and listener legacy-owned.
5. Run focused Node/Chromium tests, the complete generated-fixture behavior matrix, full
   automated suite, production build, diff check, and exact-source local root/nested smoke.

## Verification boundary and explicit omissions

Exercise affected MIX-001, LOOP-001, SPD-001, LANG-001, BOOT-001, and ANALYTICS-001 outcomes.
The focused production-entry coverage must observe actual `AudioParam` ramps and source
lifecycle, not only DOM classes. Existing automated coverage remains authoritative for
unchanged malformed-input, storage, fake-Worker, transport, and editor paths; it will be
named in the evidence rather than duplicated.

Preview verification must begin with the exact displayed synthetic merge SHA and cover root
and nested routes, saved locale, one generated fixture, the real-song fixture, genuine
keyboard playback and A/B/C shortcuts, focus, remount/state preservation, one React owner,
unchanged adjacent controls, desktop/narrow visual review, and a clean first-party console.
After merge, run the narrower exact-SHA production canary required by the delivery request.
Physical handheld and subjective auditory testing remain omissions unless genuinely run.
