# React migration evidence

## Phase 4b — React shared overview lane integration

Status: accepted in production at rollback anchor
`d961db76a8404a2aef1f544dfe9f9746a397aa74`. Evidence
collected 2026-09-07 America/Los_Angeles. Branch `feat/react-phase-4b-shared-overview`;
starting source `5f6bf62a9d33301ba6b630ae44238fd765eb91a9`; plan commit
`5d57af6acdc9c2dfd2933f0626debd2d02bb9db4`; implementation source
`ea7bdfd5c9a3ea1a63c805f62700e3f428ea4145`; CLAUDE.md ownership-description update
`34f289caab85a307fd47689e936d5c6b29e63f7c`. Previous accepted implementation rollback anchor:
Phase 4a at `fcf27706c77267e269203b62fd40eae86be03380`, documented through
[PR #80](https://github.com/SansWord/sans_bass/pull/80).

### Ownership and command boundary

The bounded audit and plan are recorded in
[react-phase-4b-shared-overview-plan.md](react-phase-4b-shared-overview-plan.md), including
its resolution of a lifecycle question specific to this lane (see below).
`components/PlayerShell.jsx` adds an `OverviewLane` component, portalled into a new
`#overview-lane-root` — a sibling of `#standard-lanes-root`, not a child of it, so
`#standard-lanes-root > .lane` keeps meaning exactly "one per `song.tracks[]` entry" for
every existing selector and test. Rendered only when `song.tracks[]` contains a `vocals` or
`bass` stem (mirroring today's `anchorTrack` gate), it owns the translated label
(`t('notes.overview')`), a live time-code readout self-subscribed to
`application.subscribeTransport` the same way `PrimarySeekControls` already is, the
master-volume-mirroring slider (reading `snapshot.masterVolume`, calling the existing
`commands.setMasterVolume` — no new command), a stable `<canvas>` host, and an empty
`.note-range-hint` host for its Phase-6-deferred range-select caption.

`lib/player-application.js` adds `attachOverviewCanvas(canvas)` and
`attachOverviewExtra(node)` — thin delegations mirroring `attachLaneCanvas`/`attachLaneExtra`
exactly. No new commands or `applicationSnapshot()`/transport fields were needed: the volume
slider reuses the already-published `masterVolume` field and `setMasterVolume` command, and
the time-code text is fully derivable from the already-published transport snapshot.

`app.js` retains `overviewStems()` (which stems the lane combines), peak combination,
painting (`renderOverview()`, `paint()`, `paintRangeBand()`), canvas seek/scrub
(`attachSeek`), and the range-hint's Phase-6 content/visibility (`syncRangeHints()`,
unchanged). It loses the Overview lane's DOM-construction block from `buildUI()`,
`overviewVolEl` and its manual mirroring write into the old slider, and — the one behavior
change beyond pure ownership transfer — the `overviewEl = null` reset that used to run on
every `buildUI()` call.

That reset removal is the audit's key finding. The Overview lane is a single **unkeyed**
React component, unlike a per-track `<Lane>` in a keyed list: whenever a reloaded song keeps
a `vocals`/`bass` stem (the common case), React has no reason to unmount and remount it, so
its canvas DOM node persists across the reload by construction. The old code safely reset
`overviewEl` on every song load because the entire DOM subtree was torn down and rebuilt
synchronously in the same call; under React ownership, nothing would ever call
`attachOverviewCanvas` again to repopulate a reset reference, so painting would have silently
stopped after the very first song. `overviewEl` is now a small persistent object
(`{ canvas, rangeHint }`) whose fields are owned entirely by `attachOverviewCanvas`/
`attachOverviewExtra`'s attach/detach lifecycle, never touched by `buildUI()`.

Moving the label and both tooltips to React also fixes a pre-existing defect recorded in the
Phase 4a evidence log above: `retranslate()` never touched the Overview lane's text, so it
stayed stuck in whatever language was active when the current song loaded. It now
retranslates like every other React-owned label, as a side effect of ownership transfer
rather than a separate fix.

### Failing-first and automated evidence

Environment: Apple M4 Max (arm64), macOS 26.6.2, Node v26.7.0, npm 11.19.0, Vitest 4.1.11,
Vite 8.2.2, Playwright headless Chromium (bundled).

Before implementation, the focused Node facade run
(`tests/player-application.test.js`) had 10 passing and 2 failing cases
(`application.attachOverviewCanvas is not a function` / `application.attachOverviewExtra is
not a function`) — the intended contract failures for the two new attach delegators, added to
the test file before `lib/player-application.js` itself.

After implementation:

- focused Node `tests/player-application.test.js`: 1 file, 12 tests passed (2 new: attach/
  detach for `attachOverviewCanvas` and `attachOverviewExtra`);
- focused production-entry Chromium `tests/player.test.js`: 1 file, 35 tests passed (1 new
  case covering React ownership, retranslation, volume mirroring, and canvas
  identity/repaint across song replacement, plus two pre-existing tests extended — the shell
  remount test to also assert `#overview-lane-root canvas` clears and repaints, and the lane-
  order test's `overview`/`zoom` selectors tightened to their exact React/legacy hosts — no
  assertion weakened);
- full `npm test`: 31 files, 423 tests passed (420 baseline + 2 facade + 1 Chromium);
- `npm run build`: passed; 56 modules transformed; existing intentional unresolved-at-build-
  time `stretch-processor.js` URL warning only;
- `git diff --check`: passed.

The new Chromium case specifically proves the lifecycle finding above: it captures the
Overview canvas's `__layers` reference, loads a second song that also has vocals/bass stems,
then asserts the **same** canvas DOM node is still present (`#overview-lane-root > .lane.overview
canvas` unchanged) while `__layers` has changed to a **different** object — proof React did
not remount the lane and `app.js` still repainted it with the new song's peaks.

The exact-source build emits **115,543 bytes** in the player entry (`dist/assets/main-*.js`)
versus Phase 4a's 114,617: **+926 bytes (+0.81%)**. The shared React/header chunk is
unchanged at exactly 218,172 bytes and the CSS chunk unchanged at exactly 13,274 bytes — no
new dependency was added.

### Exact-source local smoke

Local production build served via `npm run preview` (root) and a second static server with
the same build copied under `pr-99/` (nested-route smoke, since Vite's asset paths are
relative). Both displayed the same content and behavior. A generated 4-second four-stem
(vocals/guitar/bass/drums) ZIP fixture, built with the repository's own
`tests/helpers/audio-fixtures.js#stemsZip` run directly under Node (the real `lib/wav.js`/
`lib/zip.js` encoders, since the built site does not serve `/tests/` or `/lib/` source
paths), loaded through the real `#file-input` at both origins via a direct file-input upload.

At root: the Overview lane rendered with the correct label ("總覽" under the browser's
default zh-TW), canvas tooltip, and volume-slider tooltip; dragging its own volume slider to
55% updated `application.getSnapshot().masterVolume` and the primary React slider identically
in both directions. Switching to English retranslated the label and both tooltips correctly
(confirming the fix above) while the mirrored volume value (0.55) was preserved. Loading a
second four-stem fixture (also vocals/bass) confirmed the same canvas DOM node persisted
(`sameCanvasNode: true`) while its `__layers` reference changed (`layersChanged: true`) and
the mirrored master volume survived the replacement unchanged. The nested route repeated the
initial load/interaction with identical results. Console at both origins carried only the
expected localhost GoatCounter refusal; no first-party warning or error appeared.

### Evidence categories and current omissions

| Category | Evidence / omission |
|---|---|
| Synthetic | Generated four-stem WAV/ZIP fixtures cover ordinary stems, locale, remount-equivalent (song replacement keeping a vocals/bass stem), and volume mirroring through the production-entry Chromium suite and a local exact-source smoke. |
| Malformed input | Unchanged; no lane-ownership-affecting code path touched. |
| Storage/locale | Both languages pass in Chromium and in exact-source local smoke; the Overview label/tooltips now retranslate (a fix — see above). |
| Handheld | Unaffected; no new capability-gated code. |
| Worker | Unaffected; no Worker/model code changed. |
| Visual | Exact-source local smoke reviewed lane layout, order, and label/tooltip presentation at desktop width; no exhaustive comparison or narrow-viewport screenshot. |
| Auditory | Not claimed; genuine command/state evidence was collected, not subjective listening. |
| Real song | Not run against `examples/nov_you.zip` in this evidence pass; the changed boundary (lane presentation/ownership, no audio-path or Worker change) does not plausibly affect it, matching Phase 4a's own scoping. |

### PR-preview deployment evidence

[PR #81](https://github.com/SansWord/sans_bass/pull/81)'s `test` and `deploy` checks both
passed. Before any behavior assertion, `https://sansword.github.io/sans_bass/pr-81/`
displayed exact synthetic merge `b021fa2208c2daf5ec7d7f2e1cff917510c54ce6` (`b021fa2`),
matching `gh api repos/SansWord/sans_bass/pulls/81 --jq '{merge_commit_sha}'` (`gh pr view
--json mergeCommit` returned null pre-merge in this session; the REST API's
`merge_commit_sha` field was used instead and confirmed identical to the deployed
`#build-sha`).

A generated four-stem ZIP fixture loaded through the real `#file-input`. The Overview lane
rendered (label "總覽" under the browser's default zh-TW) alongside all four React-owned
standard lanes; dragging its volume slider to 33% updated
`application.getSnapshot().masterVolume` to `0.33` and the primary slider mirrored it
identically. The only console entries were from an unrelated browser extension
(MetaMask-style `chrome-extension://` origin); the first-party console was empty.

### Production acceptance evidence

PR #81 squash-merged as exact production source
`d961db76a8404a2aef1f544dfe9f9746a397aa74`. Its exact-SHA
[Deploy main workflow](https://github.com/SansWord/sans_bass/actions/runs/34111554517) and
[Test workflow](https://github.com/SansWord/sans_bass/actions/runs/34111554387) both passed.
Before any behavior assertion, `https://sansword.github.io/sans_bass/?phase4b=d961db7`
displayed exact `d961db7`.

The production delivery canary repeated the affected boundary: a generated four-stem fixture
loaded through the real file input rendered the Overview lane correctly; dragging its volume
slider to 60% updated `application.getSnapshot().masterVolume` to `0.6` and the primary
slider mirrored it identically. The only console entries were from the same unrelated browser
extension; the first-party warning/error console was empty.

The complete synthetic, malformed-input, storage-fault, Worker, and narrow-viewport matrices
were not repeated in production because the canary agreed with the exact-source and preview
evidence above. No real-song (`examples/nov_you.zip`), physical-handheld, subjective
auditory, or background-tab check is claimed for this increment, for the same reasons given
in the omissions table above.

Phase 4b is accepted at the full SHA above. The zoomed pane (notes chips, tempo hint, chord
editor, edit toolbar) and the range hint's translation-refresh gap remain untouched and
deferred to Phase 6; ribbon lanes are unaffected. Separation/detection controls (Phase 5)
remain legacy-owned; Phase 4 is now complete. This separate documentation-only PR records the
immutable rollback anchor.

## Phase 4a — React standard stem lane components

Status: accepted in production at rollback anchor
`fcf27706c77267e269203b62fd40eae86be03380`. Evidence
collected 2026-09-07 America/Los_Angeles. Branch `feat/react-phase-4a-stem-lanes`; starting
source `7c968adad1e087346a677777bc718c0af05aa820`; plan commit
`ef324cad8a36d11a92571a1cc3f88a923dbde119`; implementation source
`bf2af5801ae7e7454b332da8f8c21d5d204e9ef8`. Previous accepted implementation rollback anchor:
Phase 3e at `41ff22cdfad6221164ea7105273b24d338251c95`, documented through
[PR #78](https://github.com/SansWord/sans_bass/pull/78).

### Ownership and command boundary

The bounded audit and plan are recorded in
[react-phase-4a-stem-lanes-plan.md](react-phase-4a-stem-lanes-plan.md), including its
implementation addendum on the drums tempo hint. `components/PlayerShell.jsx` adds
`StemLanes`/`Lane`, portalled into a new `#standard-lanes-root` inside `#lanes`: one `<Lane>`
per track (mix, recognized stems, and unknown lanes, in existing order) owns the translated/
unknown label, a real keyboard-operable `<button class="lane-name">` (upgraded from a
non-focusable `<div>`) that blurs after activation, the `.muted` class read straight from the
snapshot, the per-lane volume slider, and a stable `<canvas>` host. The drums `<Lane>` also
renders an empty `.tempo-range-hint` host, populated by `app.js` through a new
`attachLaneExtra` hook so the hint's caption/Clear button keep exactly their previous nested-
in-card presentation.

`lib/player-application.js` adds `commands.toggleTrack(id)`, `commands.setTrackVolume(id,
value)`, `attachLaneCanvas(id, canvas)`, and `attachLaneExtra(id, node)` — the last two mirror
`attachPrimarySeekCanvas`'s explicit attach/detach shape. `applicationSnapshot()`'s
`song.tracks[]` items gain `color`, `muted` (the same effective boolean `applyGains()` already
computed, now factored into a shared `trackAudible()` helper so there is exactly one
computation), and `volume`.

`app.js` retains decoded tracks, `routingState` and all transitions, gain smoothing, the
explicit Full-mix/stems exclusion rule, peak generation, waveform painting, resize, lane-
canvas seek (`attachSeek`), and the document keyboard owner (0 and 1–6 unchanged, still
self-publishing since they bypass the facade). Ribbon (notes) lanes, the zoomed pane, and the
overview lane remain entirely `app.js`'s own `#note-lanes-root` subtree (Phase 6 / Phase 4b).
Visual order between the two subtrees — previously achieved by `insertBefore`ing ribbon/zoom/
overview nodes relative to a captured standard-lane DOM reference — is now recovered purely
with CSS `order` (`#standard-lanes-root`/`#note-lanes-root` are both `display: contents`),
computed independently on each side from the identical, already-shared `tracks` order. No
DOM reference crosses the ownership boundary in either direction anymore. `retranslate()`
drops its now-dead standard-lane block; React re-renders lane text from `useLocale()` like
every other React-owned control.

### Failing-first and automated evidence

Environment: Apple M4 Max (arm64), macOS 26.6.2, Node v26.7.0, npm 11.19.0, Vitest 4.1.11,
Vite 8.2.2, Playwright headless Chromium (bundled).

Before implementation, the focused Node facade run had 9 passing cases (the three new
commands/attach hooks did not exist yet, so this run was against the already-implemented
facade layer — see note below). The focused production-entry Chromium run
(`tests/player.test.js`) had 31 passing and 3 expected failing cases: no `#standard-lanes-root`
content existed yet (`querySelectorAll('#standard-lanes-root > .lane')` returned nothing), so
every new lane-ownership assertion failed with the DOM absent. These were the intended
contract failures; the other 31 cases (including every pre-existing lane/volume/routing
assertion, still querying through `#lanes .lane:not(...)`) stayed green throughout.

*Note on sequencing:* the thin facade wiring (`lib/player-application.js`) was implemented
immediately before its Node test, since it is mechanical delegation identical in shape to the
existing `setMode`/`toggleAllTracks`/`attachPrimarySeekCanvas` commands it sits beside; the
genuinely risky layer — React lane ownership and the `order`-based positioning scheme — is
what the browser failing-first run above exercised before any of `app.js`'s or
`PlayerShell.jsx`'s lane code existed.

After implementation:

- focused Node `tests/player-application.test.js`: 1 file, 12 tests passed (3 new: attach/
  detach for `attachLaneCanvas` and `attachLaneExtra`, and `toggleTrack`/`setTrackVolume`
  delegation plus their validation errors);
- focused production-entry Chromium `tests/player.test.js`: 1 file, 34 tests passed (3 new
  cases plus a required update to one pre-existing remount test and one pre-existing mute-
  click assertion — see below);
- full `npm test`: 31 files, 420 tests passed;
- `npm run build`: passed; 56 modules transformed; existing intentional unresolved-at-build-
  time `stretch-processor.js` URL warning only;
- `git diff --check`: passed.

Two pre-existing tests needed adjustment for reasons intrinsic to the ownership transfer, not
weakened assertions:

1. `cleans overlay/listeners on shell remount without disposing the song or duplicating loads`
   previously asserted `.lane canvas` identity was unchanged by `unmount()`, true only because
   lanes were entirely outside the React tree. Now that standard lanes are React-owned,
   unmounting the shell clears their portal like every other React-owned region. The test now
   asserts `#standard-lanes-root canvas` count drops to zero and `#note-lanes-root canvas`
   (legacy) identity is unaffected, then that remount recreates the same count of fresh,
   repainted canvases with the song/volume/routing state intact — matching how every other
   React-owned control (play button, volume slider, seek canvas) already behaves across
   remount.
2. Two mute-toggle assertions (one pre-existing, one new) needed `await waitFor(...)` around
   the DOM `.muted` class: clicking a React button inside a React event handler batches the
   resulting `publish()` → re-render, so the class update is asynchronous relative to
   `.click()` returning, unlike the old direct `classList.toggle()` write from a plain
   `addEventListener('click', ...)`. `application.getSnapshot()` and real `AudioParam` gain
   ramps remain synchronously observable immediately after the click in both tests.

The new Chromium cases prove: one React lane owner (`data-react-lane`, one per track,
including an unknown lane) with translated/untranslated labels and stable canvas identity
across a locale change; a real, keyboard-operable, focus-restoring mute button producing the
expected `AudioParam.setTargetAtTime` sequence; per-lane volume routed through the facade and
staying independent of mute (including while muted — `applyGains()` still ramps every lane
every call, so the ramp array is unchanged rather than empty); and the drums tempo hint plus a
note-ribbon lane's CSS `order` correctly interleaving relative to the standard lanes and the
pinned-above overview/zoom lanes.

The exact-source build emits **114,617 bytes** in the player entry (`dist/assets/main-*.js`)
versus Phase 3e's 113,165: **+1,452 bytes (+1.28%)**. The shared React/header chunk is
unchanged at 218,172 bytes — no new dependency was added. A separate 13,274-byte CSS chunk
exists (not tracked in earlier phases' byte comparisons); it carries only the small
`.lane-name` button-reset and `#note-lanes-root`/`.react-portal-host` `display: contents`
additions plus everything already shared with `SiteHeader.jsx`.

### Exact-source local smoke

Local production build served via `npm run preview` (root) and a second static server with
the same build copied under `pr-99/` (nested-route smoke, since Vite's asset paths are
relative). Both displayed the same content and behavior. A generated 3-second four-stem
(vocals/guitar/bass/drums-click) ZIP fixture, built with the repository's own
`tests/helpers/audio-fixtures.js#stemsZip`, loaded through the real `#file-input` at both
origins.

At root: four React-owned lanes rendered with correct labels/order/kbd hints; the drums
lane's tempo-range hint ("whole song" / Clear) rendered nested inside its own card, as before
migration. Genuine `1` (after `0`) and mouse clicks on the Vocals lane-name button toggled
mute, updated the mode dropdown to "Custom…"/`Restore previous`/`Unmute all` correctly, and
returned focus to `<body>`. Dragging the Vocals lane's own volume slider to 39% left `muted`
unaffected in both directions (confirmed via `application.getSnapshot().song.tracks`).
Switching English↔繁體中文 retranslated every lane label without touching canvases, gain, or
routing state (the pre-existing, unrelated-to-this-phase defect where the legacy Overview
lane's own label and its Clear button's static text are never retranslated by `retranslate()`
was observed and is not new — `overviewEl`/`tempoClearBtn` were never in that function's
scope before this migration either, and both remain explicitly Phase 4b/6 territory). The
nested route repeated the load/interaction with identical results. The only console entries
at either origin were the expected localhost GoatCounter refusal; no first-party warning or
error appeared. A simulated narrow-viewport check did not take effect in this browser
automation session (the window resize did not propagate to the page's viewport) and is
deferred to the PR-preview/production tiers, where it has in every prior phase.

### Evidence categories and current omissions

| Category | Evidence / omission |
|---|---|
| Synthetic | Generated four-stem WAV/ZIP fixtures cover ordinary stems, an unknown lane, mute/volume independence, locale, remount, and `order`-based positioning through the production-entry Chromium suite and a local exact-source smoke. |
| Malformed input | Unchanged; existing generated malformed ZIP and rejection cases pass, none touch lane ownership. |
| Storage/locale | Both languages pass in Chromium and in exact-source local smoke; lane labels retranslate without touching audio/canvas/routing. |
| Handheld | Existing capability-predicate coverage passes; no physical device run, and the local simulated narrow-viewport check did not take effect this session (deferred to PR preview). |
| Worker | Unaffected; no Worker/model code changed. |
| Visual | Exact-source local smoke reviewed lane layout, order, and the drums tempo hint nested in its card at desktop width; no exhaustive comparison or narrow-viewport screenshot. |
| Auditory | Not claimed; genuine keyboard/gain-ramp evidence was collected, not subjective listening. |
| Real song | Not yet run against `examples/nov_you.zip` in this evidence pass; deferred to the PR-preview/production canary alongside the real deployment SHA check. |

### PR-preview deployment evidence

[PR #79](https://github.com/SansWord/sans_bass/pull/79)'s `test` (51s) and `deploy` (18s)
checks passed. Before any behavior assertion, `https://sansword.github.io/sans_bass/pr-79/`
displayed exact synthetic merge `5cff888473ce58315a3c7ecd4d2aaaf1bee9a83a` (`5cff888`);
`/pr-79/demos/` displayed the same short SHA.

A generated 3-second four-stem (vocals/guitar/bass/drums-click) ZIP fixture loaded through the
real `#file-input`. The page held exactly 4 React-owned lanes (`#standard-lanes-root > .lane`)
and 2 ribbon lanes. Clicking the Vocals `.lane-name` button muted it, moved the mode dropdown
to `custom`, updated the all-toggle label, and returned focus to `<body>` — the first attempt
that instead activated the pre-existing, visually-similar zoom-pane speaker icon (a different,
already-legacy control with the same mute effect but no blur-after-click) is recorded as a
verification-methodology note, not a defect: re-targeting `#standard-lanes-root .lane-name`
directly confirmed the React button's own focus restoration. Dragging that lane's own volume
input to 33% updated `application.getSnapshot().song.tracks[0].volume` while `muted` returned
to `false` independently. The only console entries at either route were from an unrelated
browser extension (MetaMask-style `chrome-extension://` origin); the first-party console was
empty.

### Production acceptance evidence

PR #79 squash-merged as exact production source
`fcf27706c77267e269203b62fd40eae86be03380`. Its exact-SHA
[Deploy main workflow](https://github.com/SansWord/sans_bass/actions/runs/34108107864) and
[Test workflow](https://github.com/SansWord/sans_bass/actions/runs/34108107888) both passed.
Before any behavior assertion, `https://sansword.github.io/sans_bass/?phase4a=fcf2770`
displayed exact `fcf2770`.

The production delivery canary repeated the affected boundary: a generated four-stem fixture
loaded through the real file input into 4 React-owned standard lanes; clicking the Vocals
`.lane-name` button muted it, moved routing to `custom`/`unmuteAll`, and returned focus to
`<body>`. The only console entries were from an unrelated browser extension
(`chrome-extension://` origin); the first-party warning/error console was empty.

The complete synthetic, malformed-input, storage-fault, Worker, and narrow-viewport matrices
were not repeated in production because the canary agreed with the exact-source and preview
evidence above. No real-song (`examples/nov_you.zip`), physical-handheld, subjective
auditory, or background-tab check is claimed for this increment — none of Phase 4a's changed
boundary (lane presentation/ownership) plausibly affects them, and the full deployed smoke is
reserved for entry-point/base-path/Worker/cache changes or release acceptance, none of which
this increment touched.

Phase 4a is accepted at the full SHA above. Ribbon/zoom/overview lane ownership (Phase 4b),
notes/tempo/chord UI (Phase 6), and separation/detection controls (Phase 5) remain legacy-owned;
Phase 4 is not complete. This separate documentation-only PR records the immutable rollback
anchor.

## Phase 3e — React mode and routing controls

Status: accepted in production at rollback anchor
`41ff22cdfad6221164ea7105273b24d338251c95`. Evidence
collected 2026-09-06–07 America/Los_Angeles. Branch
`feat/react-phase-3e-mode-routing-controls`; starting source
`82b6ac3f5897e34204c3549dd7506b863f7dbe61`; implementation source
`385e8ab38e982988a4c19d14e5a5428d7c52200c`. Previous accepted implementation rollback
anchor: Phase 3d at `4b14667a935f1faef4af1f8ba8df8acb37d6ab5f`; its separate anchor
documentation merged through PR #76 before Phase 3e began.

### Ownership and command boundary

React now solely authors the top-level Play label/select, translated mode options,
accessibility, all-toggle presentation, focus restoration, and both direct listeners through
one `mode-routing-ui-root` portal in the existing player shell. `playerApplication` adds only
`setMode(mode)` and `toggleAllTracks()` and publishes `{ mode, allToggleLabel }`. Existing
song-track projections add their source display label so React can translate known stems while
unknown lanes keep filename-derived labels; option values remain stable IDs.

`app.js` remains authoritative for `routingState`, pure transition invocation, routing
snapshots, lane mute flags, gain smoothing, explicit-mix exclusion, lane classes, lane-name
clicks, 0 and 1–6 shortcuts, and analytics. `applyGains()` now consults
`routingState.mode` directly rather than reading a React-owned select. The parser-authored
select/button, legacy option construction, eager captures, presentation writes, and direct
listeners are removed. Lanes, lane volume, overview/zoom, separation, detection, notes,
Workers, AudioWorklets, canvases other than the already accepted primary seek canvas, and DSP
retain their previous owners.

### Failing-first and automated evidence

Before implementation, the focused Node run had 18 passing and one expected failing test:
the two new facade commands did not exist. The focused production-entry Chromium run had 28
passing and three expected failing tests: the routing projection and React owner did not
exist. These were contract failures, while adjacent behavior remained green.

After implementation:

- focused Node routing/application run: 2 files, 19 tests passed;
- focused production-entry Chromium run: 1 file, 31 tests passed;
- full `npm test`: 31 files, 415 tests passed;
- `npm run build`: passed with the existing intentional unresolved-at-build-time
  `stretch-processor.js` URL warning;
- `git diff --check`: passed, and a source search found no remaining non-test mode/all-toggle
  DOM captures, reads, presentation writes, option builders, or direct listeners.

Generated production-entry fixtures cover ordinary stems, a full mix plus stems, an unknown
lane, and all six recognized stems. They exercise every selector value, fresh/all-off/partial/
restorable all-toggle states, lane-name publication, genuine 0 and 1–6 keyboard events,
focused select/button exclusion and blur, English/Traditional Chinese rerender, repeated shell
remount, replacement reset, and one analytics/listener path. Assertions observe actual
`AudioParam.setTargetAtTime` values, including explicit mix/stem mutual exclusion, rather than
inferring audio state from CSS. The lifecycle case also retains a narrow 42% master-volume,
A/B loop, and legacy per-lane-volume regression.

The exact committed production build contains 113,165 bytes in the player bundle versus
112,484 at accepted `main` (+681, +0.61%); the 218,172-byte shared React chunk is unchanged.
Across those two JS bundles the increase is 0.21%.

### Exact-build local smoke

After the browser-control quota reset, the built application displayed exact implementation
SHA `385e8ab` at root and `/demos/`. A generated 0.4-second archive containing vocals, bass,
an explicit full mix, and an unknown `ambience` lane loaded through the one real input.
Traditional Chinese and English options retained stable values; selecting vocals and the
unknown lane, activating all-toggle, genuine 3 and 0 keys, and a legacy lane-name click each
updated the React selector/button and mutually exclusive lane state. Both React controls
returned focus to `BODY`. One shell, mode owner, select, all-toggle, volume owner, and loop
owner remained.

The primary and overview master-volume controls mirrored at 47%. The committed
`examples/nov_you.zip` then loaded as `9 十二月的妳`, 4:23, with all six recognized stems,
reset Full mix routing, and preserved volume. Genuine Space advanced the AudioContext-backed
clock; genuine 3 changed routing; and genuine A/Right/B produced a 1.5-second loop whose Clear
button returned focus to the page. At a simulated 390×844 viewport, the loaded controls
wrapped without horizontal overflow and remained legible. The only warning/error console
entries were GoatCounter's expected localhost refusal; the first-party console was clean.

### PR checks and exact synthetic-merge preview

PR #77's [preview workflow](https://github.com/SansWord/sans_bass/actions/runs/34098235862)
passed in 16 seconds and its
[test workflow](https://github.com/SansWord/sans_bass/actions/runs/34098235894) passed in 46
seconds. Preview behavior began only after the root displayed exact synthetic merge
`b83d82150b67b1fb00b18a816d7e1f69d12541a6`; `/pr-77/demos/` displayed the same short SHA.

The hosted boundary repeated generated explicit-mix/stem/unknown loading, stable bilingual
options, selector/all-toggle focus, lane publication, genuine 3/0 routing, unique ownership,
and 55% primary/overview volume mirroring. An English choice survived reload at the same SHA.
The committed real song loaded as 4:23 with six stems; Bass only, all-on/Restore previous,
genuine Space playback, and genuine A/Right/B loop behavior remained intact. A separately
loaded generated fixture at 390×844 had `scrollWidth === innerWidth === 390` and kept the
mode selector and button on one readable row. Both preview consoles were empty.

Actual gain authority, repeated shell remount, and analytics-listener uniqueness are supplied
by the exact-source Chromium gate rather than a hosted debug hook. The full synthetic
malformed-input, storage-fault, fake-Worker, notes/editor, and transport matrices were not
manually repeated against GitHub Pages. Physical handheld, subjective auditory,
background-tab, and real-model checks are not claimed.

### Production acceptance evidence

PR #77 squash-merged as exact production source
`41ff22cdfad6221164ea7105273b24d338251c95`. Its exact-SHA
[Deploy main workflow](https://github.com/SansWord/sans_bass/actions/runs/34101048133)
passed in 22 seconds and its
[Test workflow](https://github.com/SansWord/sans_bass/actions/runs/34101048246) passed in 43
seconds. Before behavior assertions, production root and `/demos/` both displayed exact
`41ff22c`, and the saved English locale remained selected.

The committed `examples/nov_you.zip` loaded as `9 十二月的妳`, 4:23, with six stems and the
complete stable mode option set. Bass only updated routing, primary and overview volume
mirrored at 47%, genuine Space advanced the AudioContext-backed clock, all-toggle produced
Full mix/Restore previous and returned focus to `BODY`, and genuine A/Right/B presented a
1.5-second loop. The page retained exactly one React shell/input/mode/select/all-toggle/
volume/loop owner and six legacy lane-volume controls. The warning/error console was empty.

A generated 2.4-second vocals/bass archive supplied the Phase 3 background-transport check.
After genuine A/Right/B/Space input, its 0–1.5-second loop remained actively playing more
than twice past the loop endpoint while a second production tab stayed foregrounded. Clearing
the loop with genuine `c` let background playback reach the source end and reset to 0:00.
Both production-tab warning/error consoles remained empty.

Phase 3's exit gate passes: React owns the planned header, loading/status, transport, and
top-level control regions; the affected production-entry matrix is green; and no planned
Phase 3 control remains legacy-owned. Lanes and waveform hosts remain deliberately scoped to
Phase 4. Physical-handheld, subjective auditory, and real-model evidence remain explicit
omissions rather than implied passes. This separate documentation-only PR records the
immutable rollback anchor and completes Phase 3 when merged.

## Phase 3d — React volume and A/B loop controls

Status: accepted in production at rollback anchor
`4b14667a935f1faef4af1f8ba8df8acb37d6ab5f`.
Evidence collected 2026-09-06 America/Los_Angeles. Branch
`feat/react-phase-3d-volume-loop-controls`; starting source
`61f72522e2e6b311ed0b6b9acf58f83e043e50fc`. Previous accepted boundary:
`20a55bbf61984b7a49771f5e367bb33729c879ad`. Implementation source:
`f2e0b704e9dd61a712a571cd88ec4ca37d4d2d72`. The ignored
`.codex/rules/default.rules` remains outside this slice; no pre-existing `demo.md` was present.

### Ownership transferred and retained

The shared two-slice audit and bounded Phase 3d plan are recorded in
[react-phase-3d-volume-loop-controls-plan.md](react-phase-3d-volume-loop-controls-plan.md).
`components/PlayerShell.jsx` now authors the one primary master-volume label/slider,
bilingual accessible value, input listener, A/B badge, translated partial/active state, and
Clear button through two portal hosts in the existing React root. The application facade adds
only `setMasterVolume(value)` and `clearLoop()`; the existing snapshot adds the authoritative
master-volume value while the existing transport projection continues to carry A/B bounds.

`app.js` retains the numeric master-volume state, master `GainNode` creation, 0.01-second
smoothing, audio graph, loop normalization/minimum, source/worklet refresh, seek/rate
interaction, audio-thread loop flags, waveform markers, analytics, and the one document
keyboard owner. The legacy overview-volume slider stays with the overview lane but invokes the
same application command and mirrors the authoritative value in both directions; it no longer
reads, writes, or dispatches through React DOM. The parser-authored primary volume/loop nodes,
their eager captures, direct presentation writes, and direct listeners are removed.

Mode/all-toggle routing, per-lane controls, lanes, overview/zoom DOM and canvases, separation,
detection, notes, Workers, AudioWorklets, and DSP retain their previous owners. A/B/C/Escape
remain with the shared document shortcut owner. Phase 3 is not complete; Phase 3e may begin
only after this rollback-anchor documentation PR merges.

### Failing-first, exact-source automated, build, and local evidence

Environment: Apple M4 Max, macOS 26.6.2, Node v26.7.0, npm 11.19.0, Vitest 4.1.11,
Vite 8.2.2, Playwright headless Chromium 151.0.7922.34, and Codex in-app Chromium.

| Command / boundary | Result at exact implementation source `f2e0b704e9dd61a712a571cd88ec4ca37d4d2d72` |
|---|---|
| Failing-first `npx vitest run --project node tests/player-application.test.js` | 7 existing cases passed and 1 expected case failed because `setMasterVolume` did not exist. |
| Failing-first `npx vitest run --project browser tests/player.test.js` | 26 existing cases passed and 4 expected Phase 3d cases failed: React volume/loop markers were absent, the volume command was absent, and parser-authored loop DOM survived shell unmount. |
| `npx vitest run --project node tests/player-application.test.js tests/loop-state.test.js tests/routing-state.test.js` | 3 files, 23 tests passed. |
| `npx vitest run --project browser tests/player.test.js` | 1 file, 30 tests passed. This is the complete current generated production-entry behavior harness, not a run of only the real-song fixture. Intentional malformed-ZIP and invalid-audio console entries appeared. |
| `npm test` | 31 files, 414 tests passed. Expected Node experimental `localStorage` warning and the same intentional malformed/decode fixture entries only. |
| `npm run build` | Passed; 56 modules transformed; existing intentional worklet URL warning only. |
| `git diff --check f2e0b704e9dd61a712a571cd88ec4ca37d4d2d72^ f2e0b704e9dd61a712a571cd88ec4ca37d4d2d72` | Passed. |
| Codex in-app Chromium against local `npm run preview` | Root and `/demos/` displayed exact `f2e0b70`; saved Traditional Chinese persisted; one React root/input/volume/loop owner and no React mode owner; `examples/nov_you.zip` loaded as the 4:23 six-stem song; primary/overview volume mirrored at 42%; focused volume excluded A; genuine A/Arrow/B exposed a 1.5-second loop; genuine Space advanced the AudioContext-backed clock and C cleared the loop; first-party warning/error console was empty. |

The browser additions use generated WAV/ZIP stems through the real file input and instrument
actual `AudioParam.setTargetAtTime`, `AudioContext.createBufferSource`, and source start/loop
state. They prove volume default/minimum/maximum/fractional/invalid/bounded behavior; 0.01
master-gain smoothing while paused and playing without source restart; overview synchronization
both ways; mute/routing independence; bilingual label/value; input focus exclusion; state and
one gain application across shell remount; volume preservation and loop clearing on song
replacement; A-only, B-only, complete, reversed, too-short, replaced, C/Escape-cleared loops;
paused/running loop changes; native source refresh/flags; and power-of-two loop analytics
without duplicated listeners. Existing 50%-rate loop clamping/clock coverage, pure loop bounds,
unequal-duration source plans, seek bounds, and sonifier alignment remain green rather than
being duplicated.

The exact-source build emits **381,311 bytes** across JavaScript assets versus Phase 3c's
379,043: **+2,268 bytes (+0.60%)**. The player entry is 112,484 bytes and the shared
React/header chunk is 219,547 bytes. No dependency, route, Worker, AudioWorklet, DSP, or static
asset was added. Local browser checks started by confirming the displayed SHA. Desktop and a
simulated 390-by-844 viewport were visually reviewed; the narrow document had equal 390-pixel
client and scroll widths. This is simulated responsive evidence, not a physical-handheld run.

### Evidence categories and current omissions

| Category | Evidence / omission |
|---|---|
| Synthetic | The complete production-entry browser file uses generated WAV/ZIP fixtures for volume/gain, loop/source, locale/focus/remount, replacement, routing regression, malformed recovery, and fake-Worker paths. |
| Malformed input | Existing generated malformed ZIP, unsupported/multiple/folder drop, partial decode, and recovery cases pass; `tests/unzip.test.js` retains exhaustive byte-mutation coverage. No duplicate Phase 3d test was added. |
| Storage/locale | Both languages, loaded state, accessible volume/loop copy, and saved local-preview locale pass. Existing `tests/i18n.test.js` and `tests/demo-header.test.jsx` retain blocked/throwing storage coverage. |
| Handheld | Existing `tests/platform.test.js` passed. A 390-by-844 viewport was simulated; no physical device was run. |
| Worker | Existing deterministic stale notes/separation Worker cases passed. No Worker/model code changed and no real model ran. |
| Visual | Desktop and simulated narrow local production layouts were reviewed without overflow or redesign. Exhaustive baseline image comparison remains omitted. |
| Auditory | Genuine keyboard playback advanced the AudioContext-backed clock, but no listening, subjective gain/seam quality, note-tone alignment, or background-tab check is claimed. |
| Real song | The local exact-source build loaded `examples/nov_you.zip` as `9 十二月的妳`, 4:23, six stems. This is real-song smoke only, not synthetic-matrix evidence. |

### PR-preview deployment evidence

[PR #75](https://github.com/SansWord/sans_bass/pull/75) `test` (38 seconds) and `deploy`
(12 seconds) checks passed. GitHub's current merge ref was
`15709e3a44c1214bfeff6a87350599c8e6007bed`; before any behavior assertion, the published
preview at `https://sansword.github.io/sans_bass/pr-75/` displayed exact `15709e3`.

Codex in-app Chromium verified the player root and `/pr-75/demos/` under the nested base; both
displayed the same SHA, navigation stayed below `/pr-75/`, and the explicit Traditional
Chinese choice persisted across the fresh route. A generated 0.4-second vocals/bass WAV/ZIP
fixture loaded through the real single input as `Phase 3d preview`. The page retained one
React shell, file input, volume owner, and loop owner, no React mode owner, two legacy lane
volume controls, and the unchanged legacy mode/all-toggle state. Setting primary volume to
42% updated the overview mirror. While that input was focused, genuine A did not set a loop;
after focus returned to the page, genuine A/ArrowRight/B exposed a 0.4-second loop, genuine
Space advanced the AudioContext-backed clock, and C cleared the loop.

The committed `examples/nov_you.zip` then loaded as `9 十二月的妳`, 4:23, with six stems.
Primary/overview volume mirrored at 55%; focused A was excluded; genuine Space advanced the
clock; genuine A/ArrowRight/B presented a translated 1.5-second loop; and activating the
React Clear button returned focus to `BODY` and hid the badge. The loaded page still had one
React root/volume/loop owner, no React mode owner, six legacy lane-volume controls, and the
unchanged `mix` selection. The first-party warning/error console was empty.

Desktop and simulated 390-by-844 loaded-player layouts were visually reviewed; the narrow
document had equal 390-pixel client and scroll widths. This is responsive-viewport evidence,
not a physical-device claim. The hosted page exposes no shell-remount control; the required
remount/state-preservation assertion passed in the same PR's exact production-entry Chromium
gate (one owner/gain listener, current song/volume/loop retained across repeated unmount and
remount), while the hosted locale render separately preserved song, volume, routing, and
ownership. The complete synthetic/malformed/Worker matrix was not repeated against GitHub
Pages, and the real-song load is deployment smoke rather than a substitute for it.

### Production acceptance evidence

PR #75 was squash-merged as exact production source
`4b14667a935f1faef4af1f8ba8df8acb37d6ab5f`. Its exact-SHA
[Deploy main workflow](https://github.com/SansWord/sans_bass/actions/runs/34081751364)
passed (9-second deploy job) and its
[Test workflow](https://github.com/SansWord/sans_bass/actions/runs/34081751366) passed in 53
seconds. Before any production behavior assertion,
`https://sansword.github.io/sans_bass/?phase3d=4b14667` displayed exact `4b14667`.

The required production canary covered root and `/demos/`, both at the same displayed SHA,
with the saved Traditional Chinese locale. The committed `examples/nov_you.zip` loaded as
`9 十二月的妳`, 4:23, with six stems. Primary and overview volume mirrored at 47%; focused A
was excluded; genuine Space advanced the AudioContext-backed clock; genuine A/ArrowRight/B
presented the translated 1.5-second loop; and activating Clear returned focus to `BODY` and
hid the badge. The page retained one React root/input/volume/loop owner, no React mode owner,
the unchanged `mix` selection, and six legacy lane-volume controls. The first-party
warning/error console was empty.

The complete synthetic, malformed-input, storage-fault, Worker, and remount matrices were not
repeated in production because the production canary agreed with exact-source and preview
evidence. No physical-handheld, subjective auditory, background-tab, or real-model check is
claimed. Phase 3d is accepted at the full SHA above; Phase 3e remains gated on the merge of
this separate documentation-only rollback-anchor PR.

## Phase 3c — React seek controls

Status: accepted in production.
Evidence collected 2026-09-06 America/Los_Angeles. Branch
`feat/react-phase-3c-seek-controls`; starting source
`9292f0f9688d7763e5fe9e49fced78b23ac5bd2b`. Previous accepted boundary:
`99ac653ec20de0d54035c0c89cb5dfb7ab40a77d`. The pre-existing untracked `demo.md`
remains outside this slice. Implementation source:
`4a3c9d278cf8788a5571125620fdba6485105aea`. Accepted production source and rollback
anchor: `20a55bbf61984b7a49771f5e367bb33729c879ad`.

### Ownership transferred and retained

The bounded source audit and implementation plan are recorded in
[react-phase-3c-seek-controls-plan.md](react-phase-3c-seek-controls-plan.md).
`components/PlayerShell.jsx` now authors the one primary full-song seek canvas, its pointer
listeners, bilingual slider semantics/current-total value, and the visible master
current/duration/rate/BPM presentation through two portal hosts in the existing React root.
The focused canvas continues to reach the one shared document keyboard owner, so Arrow seek
does not gain a competing listener.

`app.js` remains authoritative for position, the 44.1 kHz AudioContext clock, native and
stretched sources, playback rate, loop bounds/clamping, seek analytics, waveform data, and
painting. The application facade adds a narrow deduplicated transport-frame subscription so
only the seek/time component updates per frame, plus an explicit primary-canvas renderer
attachment that cleans up with UI lifetime and repaints after remount without seeking or
changing analytics. Pointermove keeps the established preview-only offset update; pointerdown
and pointerup retain the existing command/graph/analytics behavior.

The parser-authored primary canvas/time nodes, their eager DOM captures, their direct
per-frame text/visibility writes, and the primary `attachSeek()` call are removed. The
`attachSeek()` function, shared `scrubbing` state, and document keyboard listener remain for
the still-legacy lane/overview/range/zoom surfaces and shortcut groups. Master volume, A/B
control DOM, mode/routing, lanes, other canvases, separation, detection, notes, Workers,
AudioWorklets, and DSP retain their prior owners. `window.sansBass.playerShell` remains the
named browser-harness remount adapter, and `sansbass:transport` remains the exact-clock
adapter for the two sonifiers. Phase 3 is not complete.

### Failing-first, automated, build, and local evidence

Environment: Apple M4 Max, macOS 26.6.2, Node v26.7.0, npm 11.19.0, Vitest 4.1.11,
Vite 8.2.2, Playwright headless Chromium 151.0.7922.34, and Codex in-app Chromium.

| Command / boundary | Result |
|---|---|
| Failing-first `npx vitest run --project browser tests/player.test.js` | 23 existing cases passed and 3 expected Phase 3c cases failed: no React seek owner/semantics, no React frame clock, and the parser canvas survived shell unmount |
| Focused Node facade/time tests | 2 files, 12 tests passed |
| Final focused Chromium file | 1 file, 26 tests passed |
| `npm test` | 31 files, 410 tests passed; expected Node experimental localStorage warning and intentional malformed/decode fixture console entries only |
| `npm run build` | Passed; 56 modules transformed; existing intentional worklet URL warning only |
| `git diff --check` | Passed |

The new production-entry cases use generated WAV/ZIP stems through the real file input.
They prove one React owner/canvas/time region; English and Traditional Chinese seek labels and
current/total accessible values; pointer click/drag while paused and playing; lower/upper
bounds; focused Arrow seek; focused range-input exclusion; deterministic 50%-rate clock
advance and effective/original BPM presentation; active-loop clamping; state and waveform
repaint across repeated shell remounts; one retained two-command seek analytics sequence after
remount; and a newer song's duration surviving an older delayed decode. Existing Phase 3a/3b
cases retain generated loading/replacement, malformed/rejected/partial input, locale/input/
canvas preservation, synchronized starts, play/rate, stale Worker, routing, and application
disposal coverage.

The local production build emits **379,043 bytes** across JavaScript assets versus Phase
3b's 376,182: **+2,861 bytes (+0.76%)**. The player entry is 111,591 bytes and the shared
React/header chunk is 218,172 bytes. No dependency, route, Worker, AudioWorklet, or DSP asset
was added. The local production server displayed exact implementation source `4a3c9d2`
before browser assertions. The in-app browser loaded `examples/nov_you.zip` as the 4:23
six-stem song; genuine Space started and paused its clock, genuine ArrowRight advanced a
playing position and then moved the focused seek canvas exactly once while paused, and a
focused speed slider consumed ArrowRight without changing position. Switching to English
retained the song and position, the one file input/root/seek canvas, and translated the seek
semantics to `Seek` / `2:13 of 4:23 · 85%`. The root and `/demos/` displayed the same SHA and
saved English locale. Desktop structure and focus were visually reviewed; the first-party
console was clean. Localhost's blocked third-party GoatCounter request was the only warning.
Every deployed assertion below began with its displayed SHA.

PR [#73](https://github.com/SansWord/sans_bass/pull/73)'s initial `test` and `deploy`
checks passed in 45s and 12s. Its preview displayed exact synthetic merge
`b6bf4b5b86a2522757db2a4bab7af1dceaa2472c` before behavior assertions. Root loaded one
input/root/seek canvas, and `examples/nov_you.zip` decoded to the visible 4:23 six-stem song.
Genuine Space/ArrowRight input advanced playback and seek; the focused canvas moved exactly
1.5s once while paused, while focused speed consumed ArrowRight (80% to 85%) without moving
the playhead. Genuine `a`, ArrowRight, and `b` exposed the 1.5s A–B loop and enabled Clear.
Switching English to Traditional Chinese retained the 2:14 position, duration, loaded UI,
and ownership counts, then `/demos/` displayed the same exact SHA and saved locale. Both
routes and the loaded desktop player were visually reviewed. The preview produced no
first-party warning or error. Exact-source automation supplies the generated load matrix,
malformed/blocked-storage paths, remount/repaint, stale completion, Worker doubles, loop
clamping/laps, and analytics uniqueness that are not safely induced in the hosted smoke.

The evidence refresh passed `test` and `deploy` in 45s and 14s. Its preview displayed final
synthetic merge `e739b89c5a27bd10ad52251359a10da4e17e1d78` before the one-owner,
4:23 real-song load, genuine-keyboard playback/seek, and clean-console canary passed. PR #73
was squash-merged as `20a55bbf61984b7a49771f5e367bb33729c879ad`; its exact-SHA `Test`
and `Deploy main` workflows passed, with the test job completing in 42s. Production displayed
`20a55bb` before the full affected boundary repeated: one input/root/seek owner; the root and
`/demos/`; saved locale; the 4:23 six-stem song; genuine Space/ArrowRight playback and seek;
focused canvas movement exactly once; focused-speed exclusion; the 1.5s A–B interaction;
loaded-state/accessible-value preservation through a language switch; unchanged loading
control; desktop visual review; and a clean first-party console.

### Evidence categories and current omissions

| Category | Evidence / omission |
|---|---|
| Synthetic | Generated two-stem WAV/ZIP fixtures cover paused/playing click and drag seek, focused keyboard bounds, 50% clock/BPM, loop clamping, remount, analytics uniqueness, replacement, and stale completion. |
| Malformed input | Existing malformed ZIP, unsupported/multiple/folder drop, partial decode, and recovery cases pass unchanged; exhaustive mutations remain in Node unzip coverage. |
| Storage/locale | Both languages and loaded-state/input/canvas identity pass in automated Chromium; local, preview, and production switching retained the loaded song/position and one input/root/seek canvas. Preview and production `/demos/` read the saved locale. Existing jsdom cases cover saved and throwing/blocked storage. |
| Handheld | Existing capability predicate coverage passes; no physical device was run and no handheld-owned code changed. |
| Worker | Existing deterministic fake notes/separation stale-result cases pass; no real Worker/model path changed or ran. |
| Visual | Semantic focus styling and unchanged desktop layout pass automated structure/computed checks; exact-source, preview, and production desktop player, focus, clock, loop badge, and nested route were reviewed in the in-app browser. Exhaustive comparison remains an omission. |
| Auditory | Genuine trusted-key playback and seek advanced the exact-source, preview, and production AudioContext-backed clock. No subjective pitch, loop-seam, note-tone, or background listening is claimed. |
| Real song | Exact-source, preview, and production browsers loaded `examples/nov_you.zip` as the 4:23 six-stem song and exercised trusted playback/seek. This is deployment smoke, not the synthetic behavior matrix. |

Phase 3c is accepted at the exact rollback anchor above. Volume, A/B control ownership,
mode/routing, lanes, canvases, separation, detection, notes, and DSP remain; Phase 3 is not
complete.

## Phase 3b — React primary playback controls

Status: accepted in production. Evidence collected 2026-09-06 America/Los_Angeles.
Implementation source:
`6ae46b2fbbb9ec0b75c892725ee67b050931a0cc`; branch
`feat/react-phase-3-playback-controls`. Starting source: `8ab8f63c` on current `main`.
Accepted production source and rollback anchor:
`99ac653ec20de0d54035c0c89cb5dfb7ab40a77d`.
Previous accepted boundary: `467f91b06aabb5fed68822bf254736e719e2abee`.
The pre-existing untracked `demo.md` remains outside this slice.

### Ownership transferred and retained

The bounded audit and implementation plan are recorded in
[react-phase-3-playback-controls-plan.md](react-phase-3-playback-controls-plan.md).
`components/PlayerShell.jsx` is now the sole runtime owner of the primary play/pause button,
its bilingual accessible label and state class, and the speed label/slider/value. Two portal
hosts join the existing shell root; no additional React root or application store was added.
Direct events invoke `playerApplication.commands.togglePlayback()` and
`setPlaybackRate()`, and the controls render the existing immutable transport snapshot.

`app.js` remains authoritative for the 44.1 kHz AudioContext, decoded song, playback clock,
source/worklet scheduling, rate/position/loop values, routing, analytics, drawing, Workers,
lanes, and canvases. The direct play call remains synchronous through `ensureAudio()` before
the stretched path can await its worklet. The one legacy document keyboard listener remains
the sole owner of Space, coarse/fine rate, reset, seek, loop, routing, and editing shortcuts;
focused buttons now return before that owner to avoid native-plus-document double dispatch.

The ownership audit found no remaining production consumer of
`lib/legacy-player-controls.js`, so its import, play/rate listeners and DOM writes, browser
harness mount surface, and module were removed together. `window.sansBass.playerShell`
remains a named browser-harness remount adapter. `window.sansBass` remains for named
notes/separation services and browser tests, while `sansbass:transport` remains the exact-clock
adapter for the two sonifiers. Seek, master volume, A/B controls, mode/routing, lanes,
canvases, separation, detection, notes, and DSP remain legacy-owned. Phase 3 is not complete.

### Failing-first, automated, build, and local browser evidence

Environment: Apple M4 Max, macOS 26.6.2, Node v26.7.0, npm 11.19.0, Vitest 4.1.11,
Vite 8.2.2, Playwright headless Chromium 151.0.7922.34, and Codex in-app Chromium.

| Command / boundary | Result |
|---|---|
| Failing-first `npx vitest run --project browser tests/player.test.js` | 2 expected failures against the legacy owner: the adapter still existed/React markers were absent, and the play button retained focus after activation |
| Final focused Chromium file | 1 file, 23 tests passed |
| `npm test` | 31 files, 404 tests passed |
| `npm run build` at implementation source | Passed; 56 modules transformed; existing intentional worklet URL warning only |
| `git diff --check` | Passed |
| Codex in-app browser against local production build | Displayed exact `6ae46b2`; root and `/demos/` resolved; one React root/play/speed control; 4:23 six-stem real song loaded; genuine Space advanced playback; genuine `[` rendered and played at 95%; English/Traditional Chinese accessible labels and the existing layout were visually checked |

The new production-entry Chromium cases prove one React owner/root/control set; English and
Traditional Chinese play labels; synchronous suspended-context `resume()` entry before the
click returns; truthful play class; native source start-time equality; 10–150 bounds, step 5,
visible percentage and 100% reset; `[`, `]`, `{`, `}`, and `\\` publications; input/button
focus exclusion and play focus restoration; locale/status/remount preservation of song,
playing, rate, loop, routing mode, input, and canvas state; one analytics event and one set of
source starts across repeated remounts; and replacement/stale completion retaining the newer
transport. Phase 3a loading, malformed/rejected input, drag cleanup, file-input identity,
repeat selection, stale Worker, and application-disposal cases remain green in the same file.

Exact-source emitted JavaScript is **376,182 bytes**, versus Phase 3a's 375,976: **+206 bytes
(+0.05%)**. The already-loaded shared React/header chunk remains 218,021 bytes; the player
entry is 109.19 kB (36.16 kB gzip). No dependency, route, or startup chunk was added, so the
Phase 3a player-startup boundary is unchanged apart from the 206-byte emitted delta. Local
browser timing was not promoted to a latency claim; preview navigation remains the deployed
startup check.

### PR-preview deployment evidence

[PR #71](https://github.com/SansWord/sans_bass/pull/71) `test` (41 seconds) and `deploy`
(11 seconds) checks passed. Before any behavioral assertion, the published preview displayed
exact synthetic merge source `72776ed1abe82e0dd1425890352f8b00df8f1c0b` at
`https://sansword.github.io/sans_bass/pr-71/`.

Codex in-app Chromium exercised the player root and `/pr-71/demos/`; both resolved at the
preview base, showed `72776ed`, and retained the saved English locale after a fresh
navigation. The real `examples/nov_you.zip` loaded as `9 十二月的妳`, 4:23, with six stems.
A genuine Space key event unlocked and advanced playback, a genuine `[` changed the rendered
and active rate to 95%, a focused speed input ignored the document shortcut, and activating
play returned focus to the page. The loaded page retained exactly one React shell root, play
button, and speed input, and the first-party warning/error console remained empty.

Remount/state/resource preservation, unchanged generated/malformed loading paths, and blocked
storage are covered by the exact production-entry automated gate above rather than browser
mutation of the deployed page. The full synthetic fixture matrix was not rerun against the
hosted origin; the real-song check is deployment smoke, not a substitute for that matrix.
The preview-evidence commit intentionally triggered a final synthetic merge build whose
displayed SHA was checked before merge.

The evidence-only refresh produced final synthetic merge source
`62c444a86a38c3379849b1c22051a4c13a467d03`; refreshed `test` (38 seconds) and `deploy`
(13 seconds) checks passed, and the preview displayed exact `62c444a` before the final
delivery canary.

### Production acceptance evidence

PR #71 was squash-merged as `99ac653ec20de0d54035c0c89cb5dfb7ab40a77d`. The exact-SHA
[Test workflow](https://github.com/SansWord/sans_bass/actions/runs/34056691143) passed in
39 seconds and the [Deploy main workflow](https://github.com/SansWord/sans_bass/actions/runs/34056691279)
passed in 11 seconds. Before any production behavior assertion, the root displayed exact
`99ac653`.

The required production tier repeated the affected delivery boundary. Root and `/demos/`
resolved at the production base with the same SHA and retained saved English. The real
`examples/nov_you.zip` loaded as the 4:23 six-stem song; genuine Space advanced playback,
genuine `[` selected active and rendered 95% playback, and play activation returned focus to
the page. One React shell root, play button, and speed input remained, and first-party
warning/error console output was empty. The same automated-versus-deployed evidence boundary
and explicit omissions below apply; Phase 3b accepts only play/pause and speed ownership.

### Evidence categories and current omissions

| Category | Evidence / omission |
|---|---|
| Synthetic | Production-entry tests use generated WAV/ZIP stems for play/pause, synchronized starts, rates, loop, routing, locale/remount, replacement, analytics, and stale-completion assertions. |
| Malformed input | Existing malformed ZIP, unsupported/multiple/folder drop, partial decode, and recovery cases pass unchanged; exhaustive archive mutations remain in Node unzip coverage. |
| Storage/locale | Both languages and loaded-state/input identity pass in Chromium; saved English persisted across a fresh preview navigation. Existing jsdom production-entry cases cover throwing/blocked storage; that condition was not injected into the hosted page. |
| Handheld | Existing predicate coverage passes; no physical device was run. |
| Worker | Existing fake stale notes/separation Worker cases pass; no real Worker/model path changed or ran locally. |
| Visual | Exact-source and deployed desktop controls were visually reviewed with no layout redesign; no deployed narrow or physical-device review ran. |
| Auditory | Genuine keyboard input proved AudioContext unlock and advancing native/stretched clocks, but subjective listening, pitch preservation, seam quality, and background playback were not claimed. |
| Real song | Exact-source, preview, and production builds loaded `examples/nov_you.zip` as `9 十二月的妳`, 4:23, six stems; this is deployment/musical smoke only, not the synthetic behavior matrix. |

The Phase 3b play/pause and speed increment is accepted, and its production SHA is an
immutable rollback anchor. Seek, volume, A/B loop, mode/routing, lanes, canvases, separation,
detection, notes, and DSP remain; Phase 3 is not complete.

## Phase 3a — React player header and loading

Status: accepted in production. Evidence collected 2026-09-06 America/Los_Angeles.
Implementation source:
`8892b87cf73e25d60fa2ed6b6988cca04e6b43bf`; branch
`feat/react-phase-3-header-loading`. Starting source:
`02aca2022ff8e99f8b510c6e92de17d27179d67d`. Accepted production source and rollback anchor:
`467f91b06aabb5fed68822bf254736e719e2abee`. Previous accepted boundary:
`6657528afdac67f75c5b3118bbd651d4d6684b6b`. The pre-existing untracked `demo.md` remains
outside this slice.

### Bounded plan and ownership transfer

The source audit and implementation boundary are recorded in
[react-phase-3-header-loading-plan.md](react-phase-3-header-loading-plan.md).
`components/PlayerShell.jsx` is now the sole runtime owner of the player header descendants,
one real file input and its change listener, empty/loading affordance, status/error node, and
drag overlay plus its five document listeners. One React root reconciles those regions through
explicit portal hosts without claiming or rebuilding the intervening legacy player markup.
`components/SiteHeader.jsx` is shared by the player and the existing `DemoHeader` wrapper.

`app.js` remains the sole authoritative owner of decoded tracks, accepted song, the 44.1 kHz
AudioContext, audio graph, routing, transport/loop/rate values, Workers/service state, lanes,
and canvases. Its `lastSay` value remains a stable status key/params/error projection, but it
no longer writes a status node. `lib/legacy-player-controls.js` now owns only play and speed;
the old file-input listener was removed with `lib/header.js` and the legacy drag/status writes.

Play/pause, seek, master volume, speed, A/B loop controls, mode menus, lanes, canvases,
separation, detection, notes, and DSP remain legacy-owned. This is an accepted-size Phase 3
increment, not a claim that all of Phase 3 is complete.

### Application seam, cleanup, and temporary adapters

File selection and valid drop call `playerApplication.commands.load()` and continue through
the Phase 2 loader/token barrier. The facade gained only `rejectLoad(reason, details)`, with
the closed reasons `folder`, `multiple`, and `unsupported`: this extension is required because
React now owns drop validation but the authoritative application still owns status publication
and the fixed `folder-drop` analytics event. React does not import or mutate `app.js` state.

Shell unmount removes the application/locale subscriptions and drag listeners, clears the
portal descendants, and leaves the application, current song, canvases, AudioContext, Workers,
and legacy controls alive. Remount is idempotent and creates one current input/listener set.
The existing `window.sansBass.playerShell` harness adapter names the browser tests as its only
consumer; production mounting imports the ESM function. `window.sansBass` otherwise remains
for `notes.js`, `separate.js`, and the browser harness, and `sansbass:transport` remains for the
vocals/bass sonifiers. The legacy adapter remains temporarily for the play/rate controls until
their later Phase 3 slices.

### Automated and local-build evidence

Environment: Apple M4 Max, macOS 26.6.2, Node v26.7.0, npm 11.19.0, Vitest 4.1.11,
Vite 8.2.2, Playwright headless Chromium 151.0.7922.34.

| Command / boundary | Result |
|---|---|
| Failing-first Chromium run | 5 new cases failed against the legacy owner: missing React shell/remount surface, missing React drop path, and retained header focus |
| `npx vitest run --project node tests/player-application.test.js` | 1 file, 6 tests passed |
| `npx vitest run --project jsdom tests/demo-header.test.jsx` | 1 file, 4 tests passed; expected Node experimental localStorage warning |
| `npx vitest run --project browser tests/player.test.js` | 1 file, 21 tests passed |
| `npm test` | 31 files, 402 tests passed |
| `npm run build` | Passed; 57 modules transformed; existing intentional worklet URL warning only |
| Existing isolated build harness at `/` and `/pr-phase-1/` | 12 route/layout/locale/storage checks passed at displayed `8892b87`, with no page/HTTP errors |
| `git diff --check` | Passed |

The player Chromium cases use the production entry, real AudioContext, and the documented
`stemsZip()`/WAV/ZIP encoders through the real `#file-input` or cancelable drop events. New
coverage proves input identity across language and status publications, same-file repeat,
language changes before and after loading, retained song/canvas identity, visible loading and
hidden success, malformed ZIP and unsupported/multiple/folder rejection, English/Chinese
command errors, overlay visibility/depth/cleanup, focus restoration and legacy field shortcut
exclusion, idempotent shell remount, and one load after remount. The retained stale-decode case
proves an older completion cannot replace a newer song; fake stale notes/separation results
remain lifetime evidence rather than real-Worker/model evidence.

The exact-commit isolated build emitted **375,976 bytes** across all JavaScript assets versus
Phase 2's 374,997 (+979, +0.26%); React was already present in the shared demo build. The player
route now intentionally loads that runtime: five no-store samples measured median player JS
transfer at **343,436 bytes** versus 151,028 (+192,408, +127.4%, including HTTP overhead),
DOMContentLoaded at **21.6 ms** versus 18.7 (+2.9 ms), and automation-observed ready at
**43.8 ms** versus 33.7 (+10.1 ms). The shared React/header chunk is 218,021 emitted bytes;
the player main chunk is 108,984 bytes. The startup increase is the expected Phase 3 milestone
cost of bringing the already accepted React runtime onto the player route, with no measured
audio/drawing claim implied by local startup timing.

### PR-preview deployment evidence

Delivery review: [PR #69](https://github.com/SansWord/sans_bass/pull/69). The initial required
checks passed (`test`, 56 seconds; `deploy`, 11 seconds). The nested preview at
`https://sansword.github.io/sans_bass/pr-69/` displayed exact synthetic merge source
`f9d3084d722346a77a34858d8772cb28fcffcc59` (`f9d3084`) before the boundary run. This
evidence-only documentation change then refreshed both checks (`test`, 43 seconds; `deploy`,
12 seconds). The resulting preview displayed exact final synthetic merge source
`b12ac0ab1038edfe6fb8ab661942c6743763cfca` (`b12ac0a`) before the final assertion.

Chrome exercised the player root and `/pr-69/demos/` at the preview base, and both routes
displayed `f9d3084`; header navigation stayed below `/pr-69/`. A clean startup retained the
saved Traditional Chinese choice, rendered exactly one React player shell and one file input,
and produced no first-party warning or error. The exact-commit normal/nested build harness
separately injected throwing `localStorage` and proved boot plus both language choices; live
GitHub Pages has no user-visible control that can revoke storage for fault injection.

A generated 0.2-second two-stem WAV/ZIP fixture loaded through the real input as `Preview
synthetic`. Switching English to Traditional Chinese after load retained the song, lanes,
seven canvases, one input, and one React root, and returned focus to the document. An
unsupported `.txt` rendered the established Chinese rejection, which rerendered in English
without a new input; a three-byte ZIP rendered the established damaged-ZIP recovery. The PR's
production-entry Chromium gate supplies the cancelable file-drop/data-transfer boundary that
cannot be driven by the deployed page's native file picker: valid drop, unsupported/multiple/
folder rejection, overlay depth and cleanup, fixed folder-drop analytics, and one listener/load
set after remount all passed against this source.

The committed `examples/nov_you.zip` was used only for the real-song deployment smoke. It
decoded as `9 十二月的妳`, 4:23, with six named stems; the cleared input accepted the identical
file a second time, while input/root counts stayed one. A subsequent language render retained
the same title, lanes, and eleven canvases. A 390-by-844 visual check showed the existing
stacked header/load affordance without horizontal clipping. The intentional malformed-ZIP run
logged its caught parser error; a separate fresh navigation established the clean first-party
console result. Browser-extension warnings were excluded by source URL.

### Production deployment evidence

PR #69 squash-merged at 2026-09-06T11:51:56Z as exact source
`467f91b06aabb5fed68822bf254736e719e2abee`. The exact-SHA main workflows passed: Deploy main
[run 34031453307](https://github.com/SansWord/sans_bass/actions/runs/34031453307) in 14 seconds
and Test [run 34031453379](https://github.com/SansWord/sans_bass/actions/runs/34031453379)
in 48 seconds. Production initially still served the previous build; acceptance waited for
propagation, then `https://sansword.github.io/sans_bass/?phase3a=467f91b` displayed `467f91b`
before assertions.

The required production tier repeated the mounting/loading boundary. Root and `/demos/`
resolved at the production base with the same SHA and retained the saved locale. A generated
two-stem ZIP loaded through the one cleared input; changing locale retained its title, seven
canvases, one root, and document focus. Unsupported input rendered the established Chinese
rejection without replacing that current song. `examples/nov_you.zip`, used only for the
real-song smoke, decoded twice from identical consecutive selections as the 4:23 six-stem
song with eleven canvases and empty status. The fresh first-party warning/error console stayed
empty. Exact-source automated cases remain the evidence for blocked-storage and native
DataTransfer fault injection, remount cleanup, overlay depth, duplicate prevention, and stale
completion because the deployed UI exposes no controls for those faults.

### Evidence categories and omissions

| Category | Evidence / omission |
|---|---|
| Synthetic | Generated folder ZIPs cover file input, repeat selection, valid drop, partial decode, song replacement, stable canvases, remount, and stale completion through production encoders. |
| Malformed input | Three-byte malformed ZIP plus unsupported, multiple-file, and folder-shaped drops render established recovery copy; partial invalid WAV retains usable lanes. Exhaustive ZIP mutations remain in Node unzip tests. |
| Storage/locale | Both languages before/after load and bilingual status pass in the player; saved locale passed on preview and production, while jsdom plus the isolated root/nested build harness cover throwing storage. |
| Handheld | Existing capability predicate tests pass and the React shell uses the same once-per-page handheld explanation. No physical device was run. |
| Worker | Existing deterministic stale notes/separation Worker cases pass. No real Worker or model was required for the local UI boundary. |
| Visual | Computed overlay/hidden visibility and desktop/narrow shared-header layout pass; the 390-by-844 preview header/load affordance was visually reviewed without clipping. Full subjective player comparison remains out of scope. |
| Auditory | Not run; audio scheduling/DSP ownership did not move. Trusted unlock, background timing, pitch/seam, and note-tone listening remain omitted. |
| Real song | Preview and production deployment smoke: `examples/nov_you.zip` decoded to the 4:23 six-stem song and accepted identical repeat selection. It is not synthetic-matrix evidence. |

The bounded Phase 3a header/loading increment is accepted and its production SHA is an
immutable rollback anchor. Transport controls and all later ownership groups remain; this is
not acceptance or completion of Phase 3 as a whole.

## Phase 2 — player command and subscription boundary

Status: accepted in production. Evidence collected 2026-09-05 America/Los_Angeles
(2026-09-06 UTC). Implementation source: `174fffbdc59c9cfd0d7b696ae333566bda6e0275`;
branch `feat/react-migration-phase-2`. Accepted production source:
`6657528afdac67f75c5b3118bbd651d4d6684b6b`. Starting source:
`e108c681513ea6004199efac4f0f56ca264e1800`. Previous rollback boundary: Phase 1 at
`5de58b634e4a11b0baf2bfca6f4a1e98f3eae31d`. The pre-existing untracked `demo.md`
remains outside this slice.

### Bounded plan and ownership

The source audit and implementation plan are recorded in
[react-phase-2-plan.md](react-phase-2-plan.md). No DOM region transferred to React. `app.js`
deliberately retains sole ownership of decoded tracks, the one AudioContext and gain graph,
transport/loop/rate/routing state, lane/canvas DOM, drawing, status, and song UI. Audio buffers,
sources, Workers, worklets, peaks, and note renderers remain outside any component lifetime.

Ownership transferred only at the interaction seam: `lib/player-application.js` now owns the
application lifecycle, command-error value, listener/cleanup registries, and monotonic song
operation identity. `lib/legacy-player-controls.js` owns the existing file-input, play-button,
and playback-rate listeners and renders those transport controls from snapshots. It does not
own or copy engine state. The legacy adapter is mounted by `app.js`; unmount/remount affects
only its listeners/subscription and preserves the AudioContext, current song, routing, and
work already in flight.

### Public ESM interface

`lib/player-application.js` exports the production singleton `playerApplication`, the test
factory `createPlayerApplication()`, and `PlayerCommandError`.

| Surface | Contract |
|---|---|
| `getSnapshot()` | Returns one immutable snapshot, stable by identity until the owner publishes. Fields are `lifecycle`, `song`, `loading`, `transport`, `status`, and `commandError`. The snapshot is a read-only projection; commands always act on `app.js`'s authoritative values. |
| `subscribe(listener)` | Notifies after publications and returns an idempotent unsubscribe. It does not initialize, reset, or dispose the engine. |
| `commands.load(file)` | Begins a new song operation and routes the one accepted File to existing ZIP/song loading. |
| `commands.play()` / `pause()` / `togglePlayback()` | Reach the existing synchronous trusted-gesture unlock and shared scheduling path. |
| `commands.seek(seconds)` | Uses seconds on the existing transport and preserves running/stopped state. |
| `commands.setPlaybackRate(rate)` | Uses a `0.10`–`1.50` multiplier and delegates to the existing native/worklet transition logic. |
| `commands.replaceSong(original, stems)` | Replaces a mix with separated stems through the same song-lifetime boundary. |
| `currentSongToken()` / `isCurrentSongToken(token)` | Let asynchronous services reject a completion belonging to an older operation or disposed application. |
| `registerCleanup(fn)` | Registers application-lifetime service cleanup; removing a UI subscription does not run it. |
| `dispose()` | Idempotently invalidates song work, runs service cleanup, unmounts the legacy controls, stops sources/drawing, and closes the AudioContext. |

Command validation and delegated failures become `PlayerCommandError`, are observable as
`commandError`, and are rendered through the bilingual `status.commandFailed` message. A
failure from an older load token is ignored after replacement rather than overwriting the
current song's status.

### Song and asynchronous lifetime guarantees

Every load request advances the application song token before ZIP extraction or audio decode.
Progress, decode completion, and failure are published only while that token remains current.
The accepted song records the token that built its lanes. A later load, separated replacement,
or application disposal invalidates older work.

`notes.js` captures the current token for note analysis, tempo re-detection, deferred chord
detection, and asynchronous edits import. Worker handlers also capture their exact Worker
instance, preventing a terminated old worker from clearing or overwriting a newer run.
Application disposal terminates both note-channel Workers and sonifiers and clears their
poll/chord timers. `separate.js` subscribes to loading/song publications instead of polling,
terminates an invalidated run, and ignores stale messages. Successful replacement advances
song identity only after the result has become final, preserving save availability.

### Temporary adapters and named consumers

- `sansbass:transport` remains the exact-clock adapter from `app.js` to the vocals and bass
  sonifiers in `notes.js`. It carries the shared `t0`, offset, valid loop bounds, and rate;
  removing it before an equivalent service seam exists could desynchronize reference tones.
- `window.sansBass` remains for `notes.js` (`currentMix`, stem/audio/ribbon/tempo/status
  operations), `separate.js` (`currentMix`, `isSingleTrack`), and the browser harness. The
  harness-only `application` and `legacyControls` members expose lifecycle/remount assertions.
  Loading and transport production UI use the ESM facade, and the obsolete separated-load
  bridge member was removed.
- Existing note/edit/tempo/chord/ribbon custom events remain page-lifetime adapters with their
  current named `app.js`/`notes.js` consumers. Their ownership was not broadened in Phase 2.

### Automated and local-build evidence

Environment: Apple M4 Max, macOS 26.6.2, Node v26.7.0, npm 11.19.0, Vitest 4.1.11,
Vite 8.2.2, Playwright headless Chromium 151.0.7922.34.

| Command / boundary | Result |
|---|---|
| Failing-first facade test | Failed because `lib/player-application.js` did not exist |
| `npx vitest run --project node tests/player-application.test.js` | 1 file, 6 tests passed |
| `npx vitest run --project browser tests/player.test.js` | 1 file, 16 tests passed |
| Saved/blocked locale target | `tests/i18n.test.js` + `tests/header.test.js`: 17 tests passed |
| `npm test` | 32 files, 399 tests passed |
| `npm run build` | Passed; 56 modules transformed; existing intentional worklet URL warning only |
| Existing isolated build harness at root and `/pr-phase-1/` | Passed 12 route/layout/locale/storage checks with no page/HTTP errors; current branch source was copied to a temporary build |
| `git diff --check` | Passed |

The browser project uses the documented Vite harness and the real `#file-input`, production
WAV/ZIP encoders, real AudioContext, and deterministic fake Workers for protocol races. It
exercised folder ZIPs; standard vocals/bass/guitar/drums combinations; unequal durations;
one invalid WAV entry with partial recovery; one whole-song WAV; synchronized source starts;
play/pause/seek; an invalid then valid A/B point; 95% rate; routing gain ramps; replacement;
legacy unmount/remount; same singleton/one reusable input and repeat selection; stale held decode; stale notes completion;
and separation completion after disposal. Existing Node ZIP/stem tests cover flat archives,
stored/deflated entries, unknown lanes, sidecars, explicit mix, and malformed mutations.
Fake Workers prove protocol handling, not deployed module/model execution.

Phase 1 emitted 368,854 bytes across `dist/assets/*.js`; the final isolated Phase 2 build
emits 374,997 bytes, +6,143 bytes (+1.7%). The player main chunk is 108,415 bytes. Five
no-store local samples measured player startup transfer at 151,028 bytes versus Phase 1's
144,885 (+6,143, +4.2% including HTTP overhead), median DOMContentLoaded 18.7 ms versus
17.7 ms (+1.0 ms), and median automation-observed ready 33.7 ms versus 33.1 ms (+0.6 ms).
The time differences are noise-level; the byte increase matches the facade/guard code. React
still does not load on the player route.

### PR-preview deployment evidence

Delivery review: [PR #67](https://github.com/SansWord/sans_bass/pull/67). Both final required PR
checks passed (`test`, 39 seconds; `deploy`, 19 seconds). The published preview at
`https://sansword.github.io/sans_bass/pr-67/` displayed exact synthetic merge source
`b35971b1b706af4b07dd28c08b3425e7184a3c52` (`b35971b`) before the full behavior run. The only
subsequent change recorded this evidence; refreshed checks passed and the preview displayed
the resulting exact synthetic merge source `ca63080fdfea7f211d1186386e6269bbc5f30a3f`
(`ca63080`) before the final assertion.

Chrome 151.0.7922.34 loaded the committed `examples/nov_you.zip` through the real file input,
decoded the 4:23 song into six lanes, advanced playback from a trusted click, paused, changed
speed to 95%, and muted bass through the documented `3` shortcut. The selection changed to
Custom and the all-track action changed to Unmute all. The 95% playback path completed without
a status or console error, exercising the deployed AudioWorklet-relative asset boundary.

The deployed note Worker path returned the accepted musical regression values: 374 vocal
notes, 357 bass notes, and 48.0 BPM at 54% confidence. A generated 1.25-second WAV then replaced
that song through the same real input. Cached-model separation completed into six named stem
lanes and exposed Save stems without downloading the model again. The `/pr-67/demos/` nested
route loaded, preserved the preview base path, displayed the same `b35971b` source, and returned
to the player route. The first-party warning/error console remained empty after playback,
note detection, separation, and nested navigation.

The real-song ZIP and generated short WAV are deployment-smoke evidence, not a claim that the
full behavior matrix ran in preview. The full local automated matrix is reported above.

### Production deployment evidence

PR #67 squash-merged at 2026-09-06T06:41:11Z as exact source
`6657528afdac67f75c5b3118bbd651d4d6684b6b`. The exact-SHA main workflows passed: Deploy main
[run 34017141774](https://github.com/SansWord/sans_bass/actions/runs/34017141774) in 19 seconds
and Test [run 34017141763](https://github.com/SansWord/sans_bass/actions/runs/34017141763)
in 36 seconds. Production at `https://sansword.github.io/sans_bass/?phase2=6657528`
displayed `6657528` before assertions.

The required production tier repeated the boundaries changed by this slice. The real-song ZIP
decoded to six lanes at 4:23; trusted-click playback advanced and paused; 95% worklet playback
succeeded; and bass routing changed Full mix to Custom/Unmute all. Production note Workers
returned 374 vocal notes, 357 bass notes, and 48.0 BPM at 54% confidence. Cached-model
separation of the generated 1.25-second WAV completed into six named lanes and exposed Save
stems. `/demos/` resolved at the production base, displayed `6657528`, and exposed its player
return link.

No first-party warning/error was logged. Warnings from
`chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/` were identified as browser-extension
output and excluded from the site result. Exact preview and production observations, including
explicit skips, were also recorded as comments on PR #67.

### Accepted and explicitly skipped evidence

The Phase 2 exit gate, PR checks, preview verification, merge, exact production verification,
and rollback-anchor requirement have passed.

Not run locally: uncached 285 MB model download; physical handheld; trusted human audio unlock;
background-tab longest-source end/native loop timing; subjective visual review; subjective
native/stretched seam and pitch preservation; auditory note-tone alignment; real-song musical
accuracy; comprehensive pointer/edit/export scenarios. The generated fixtures and committed
real-song deployment smoke are different evidence categories; neither is described as the full
behavior matrix. Those omissions remain visible for later release acceptance and are not Phase
2 parity claims.

## Phase 1 — isolated React demo header pilot

Status: accepted in production. Evidence collected 2026-09-05 America/Los_Angeles
(2026-09-06 UTC). Implementation source: `b9b5670`; branch `feat/react-demo-pilot`.
Accepted production source: `5de58b634e4a11b0baf2bfca6f4a1e98f3eae31d`; complete
rollback anchor before React implementation: `087f0cc64bf25f46b97081f5befcf41529431b45`.
Delivery review: [PR #65](https://github.com/SansWord/sans_bass/pull/65). The pre-existing
untracked `demo.md` remained outside the slice.

### Bounded plan

1. Give React sole ownership of the demo page's header descendants, leaving the player
   header, demo discovery/list content, audio, Workers, and canvas UI unchanged.
2. Add React/React DOM plus the Vite React plugin and a JSX demo entry without changing the
   multi-page, relative-base, build-SHA, Worker, or AudioWorklet boundaries.
3. Subscribe to the existing i18n store through one cleaned hook; expose one mount disposer
   covering both React and the still-legacy demo title/count listener.
4. Add jsdom outcome coverage, then exercise both languages, saved/blocked storage,
   desktop/narrow layouts, demo discovery/exports, and normal/nested production builds.
5. Compare the pilot's emitted JavaScript and startup observations with phase 0; because
   entry composition/static assets changed, run the full deployed tier on PR and production.

### Ownership and conventions

`components/DemoHeader.jsx` is now the only runtime owner of every descendant of the demo
page's `#site-header`: player link, demo link, repository link, language group, translated
copy, and pressed/current-page state. The player page still uses `lib/header.js`, including
its file-input move and legacy language listener. No React code loads on the player route.

Locale state remains authoritative in `lib/i18n.js`. `components/useLocale.js` adapts its
public `sansbass:langchange` event with `useSyncExternalStore`; unmount removes that listener.
React-owned descendants deliberately carry no `data-i18n` annotations, so the legacy whole-
document `apply()` traversal cannot write inside the React region. `demos.jsx` retains the
legacy title/count write outside that region and returns one disposer that removes its event
listener and unmounts the root. Vite hot disposal uses the same path. Strict Mode is enabled
in development and production; tests prove the temporary double mount leaves one active hook
subscription and that disposing/remounting returns the total active language-listener count
from two to zero between mounts.

The pilot reuses the established header classes in `styles.css`, avoiding a visual redesign.
Future component-only styles should be imported beside their component; genuinely shared
player/demo styles remain global. Build-time discovery, filename escaping/encoding, generated
list markup, demo content, and `#build-sha` remain owned by `scripts/build-demos.js`.

### Automated and local-build evidence

Environment matches phase 0: Apple M4 Max, macOS 26.6.2, Node v26.7.0, npm 11.19.0,
Vitest 4.1.11, Vite 8.2.2, Playwright headless Chromium **151.0.7922.34**.

| Command / boundary | Result |
|---|---|
| Failing-first targeted test | Failed because `components/DemoHeader.jsx` did not exist |
| `npx vitest run --project jsdom tests/demo-header.test.jsx tests/header.test.js` | 2 files, 6 tests passed |
| `npm test` | 31 files, 385 tests passed, 1.83 s |
| `npm run build` | Passed; 54 modules transformed, 106 ms; existing intentional stretch-processor URL warning only |
| `git diff --check` | Passed |
| `node docs/react-phase-1/verify.mjs docs/react-phase-1/artifacts` | Passed; normal/nested static mounts, 12 recorded route/layout/locale/storage checks, no page/HTTP errors |

The first sandboxed full-suite attempt passed the 332 Node/jsdom assertions it reached but
could not bind the Chromium server (`listen EPERM ::1`). The permitted retry passed all 385
tests. This is the same environment restriction recorded in phase 0, not an application
failure. The jsdom tests retain Node's experimental localStorage warning.

[Raw Phase 1 report](react-phase-1/artifacts/report.json) and four reviewed full-page images
retain the exact checks and samples:
[desktop English](react-phase-1/artifacts/desktop-en-demos.png),
[desktop Chinese](react-phase-1/artifacts/desktop-zh-TW-demos.png),
[narrow English](react-phase-1/artifacts/narrow-en-demos.png), and
[narrow Chinese](react-phase-1/artifacts/narrow-zh-TW-demos.png).
At 1440×900 and 390×844, both locales retained the phase-0 header/list appearance and had
no document-level horizontal overflow. This is reviewed visual evidence, not pixel equality.

The isolated harness uses a temporary copy. It adds a Unicode/space/ampersand HTML demo and
a non-HTML file, proves only the HTML entry is encoded/listed/copied and opens, removes both,
rebuilds, and proves the list plus `dist/` are clean. At `/` and `/pr-phase-1/`, desktop and
narrow runs boot from each saved locale, switch and persist the other locale across reload,
retain active-page/relative-link semantics, open the committed export, exercise its capo
selector, return to the player, and find exactly one player file input. Separate contexts
with throwing storage boot and switch both locales. External requests are blocked.

### Phase-0 performance comparison

Fresh browser contexts, local static server with `Cache-Control: no-store`, five samples;
no CPU/network throttling. Resource Timing transfer includes HTTP overhead. Values are local
comparison signals, not user-facing budgets.

| Measurement | Phase 0 | Phase 1 | Change / interpretation |
|---|---:|---:|---|
| All emitted `dist/assets/*.js` | 178,369 B | 368,854 B | +190,485 B (+106.8%); React foundation is isolated in the demo entry |
| Demo entry emitted JS | 319 B | 192,069 B | +191,750 B; React/React DOM dominate, accepted as the explicit foundation cost |
| Player startup JS transfer | 146,150 B | 144,885 B | −1,265 B (−0.9%); chunk factoring noise, no React route load |
| Player DOMContentLoaded median | 19.9 ms | 17.7 ms | −2.2 ms; noise-level, no regression indicated |
| Player ready median | 35.8 ms | 33.1 ms | −2.7 ms; noise-level, no regression indicated |
| Demo DOMContentLoaded median | not captured in phase 0 | 20.7 ms | New pilot reference |
| Demo React-header ready median | not captured in phase 0 | 44.6 ms | New pilot reference |
| Demo startup JS transfer | not captured in phase 0 | 219,704 B | New pilot reference |

The size increase was investigated: the new demo entry is the only route importing
`react-dom/client`; player HTML does not reference the demo/React chunk, and its measured
startup transfer did not increase. A CDN would trade local static reliability and privacy
for a smaller repository build, while a compatibility substitute would not demonstrate the
requested React architecture. The isolated route cost is accepted for this migration pilot
and should be revisited when player components begin sharing that runtime.

### PR-preview deployment evidence

The full deployed tier ran in Chrome against the nested PR preview at
`https://sansword.github.io/sans_bass/pr-65/`. The preview displayed synthetic merge SHA
`7de7869` before any product assertion; branch head was `b157e08`. Hashed scripts and worker
assets resolved below `/pr-65/assets/`, and the app logged no first-party warning or error.

| Boundary | Preview result |
|---|---|
| Pilot/demo route | Header/list booted with build SHA `7de7869`, no horizontal overflow; English/Chinese switch worked and English persisted across reload |
| Published export | Opened from the generated listing; capo `0`→`3` changed the first chord `Fm`→`Dm` and play key `D#`→`C`; return navigation found exactly one player file input |
| Real-song path | `examples/nov_you.zip` loaded locally as 4:23 with six named lanes; trusted click advanced playback, bass mute changed custom routing, and 95% speed played without status error |
| Analysis/export | Real notes Worker produced 374 vocal and 357 bass notes at 48.0 BPM / 54% confidence; the visible vocal list export was invoked without page or status error |
| Cached-model separation | A locally generated 1.25-second WAV separated through the cached model into six named stems; save-stems became available and `separate.worker-Bxzm2fuX.js` was observed |
| Nested dynamic assets | `notes.worker-Ch3qR4G6.js` was observed after detection; 95% playback exercised the production AudioWorklet path with an empty status and clean first-party console |

The uncached 285 MB model download remained opt-in and was not run because the cached-model
path was available. Physical handheld, background-end/loop timing, exhaustive malformed-input,
subjective visual, and auditory scenarios were not run and are not implied by this deployed
smoke. The committed real-song fixture and generated short WAV are deployment evidence, not
the full behaviour matrix.

### Production deployment evidence

After PR #65 was squash-merged, both the `Deploy main` and post-merge `Test` workflows passed
for `5de58b634e4a11b0baf2bfca6f4a1e98f3eae31d`; preview cleanup also passed. The production
root displayed `5de58b6` before assertions. The same full deployed boundary passed there:
both locales and persistence, generated listing/export/capo, real-song playback and routing,
95% AudioWorklet playback, 374/357-note Worker analysis and export, and cached-model six-stem
separation. Status and first-party console output remained clean. The preview omissions listed
above remain omissions; this was deployment smoke, not the full behaviour matrix.

### Exit gate and next work

The local Phase 1 exit gate is met: both languages, saved/blocked storage, desktop/narrow
layout, normal/nested build paths, discovery/removal, demo export/capo, relative navigation,
build SHA, React cleanup/remount behavior, and baseline performance comparison have direct
evidence. The player header and every audio/data UI region remain legacy-owned, so the pilot
does not create a competing owner or couple React to audio.

The complete Phase 1 exit gate and both deployed tiers passed. Roll back the entire React
migration to `087f0cc64bf25f46b97081f5befcf41529431b45`, or roll later phases back to the
accepted Phase 1 boundary `5de58b634e4a11b0baf2bfca6f4a1e98f3eae31d`, using revert PRs
rather than rewriting shared history. There is no data migration. Next bounded slice: Phase 2's
player command/subscription boundary, with the legacy player UI unchanged first.

## Phase 0 — automated, ownership, visual and local-build baseline

Status: phase-0 baseline recorded locally, with the omissions below. No React migration
or release parity is claimed. Slice 0a recorded the automated/ownership baseline; slice 0b
added browser evidence and simplified progress reporting.
Evidence collected 2026-09-05 UTC (2026-09-04 evening America/Los_Angeles).
Source: `9636b06c2e64bc1eafd82582c42ac3f1ae0b2f19`; branch
`docs/react-phase-0-baseline`. The pre-existing untracked `demo.md` is outside this slice.
No production ownership transfer, React dependency, or product behaviour change.

### Bounded plan

1. Record the unchanged suite/build and inspect the first migration boundaries.
2. Inventory current DOM, state, event, and lifetime owners from source.
3. Add missing non-rendering header assertions in jsdom; retain existing storage and
   browser audio/canvas assertions without duplicating them.
4. Capture representative screens and local-build/milestone measurements, record omissions,
   and hand off the isolated demo pilot. LOC tracking was dropped following user feedback.

### Automated and build evidence

Environment: macOS 26.6.2 (25G83), Node v26.7.0, npm 11.19.0,
Vitest 4.1.11, Vite 8.2.2; installed Playwright headless Chromium provider.

| Revision / command | Result |
|---|---|
| Unchanged source: `npm test` | 29 files, 379 tests passed, 1.79 s |
| Unchanged source: `npm run build` | Passed; 42 modules transformed, Vite reported 96 ms; one demo generated |
| Slice: `npx vitest run --project jsdom tests/header.test.js` | 1 file, 2 tests passed |
| Slice final: `npm test` | 30 files, 381 tests passed, 1.99 s |
| Slice final: `npm run build` | Passed; same worklet warning, 42 modules, 100 ms |
| Slice final: `git diff --check` | Passed |

The first sandboxed suite attempt passed 326 Node/jsdom tests but could not bind the
browser server (`listen EPERM ::1`). Retrying with local-server permission passed the full
suite. This was an environment restriction, not a baseline application failure.
The targeted jsdom run emitted Node's experimental localStorage warning.

Existing build warning: `new URL('./stretch-processor.js', import.meta.url)` is unresolved
at build time. `vite.config.js` deliberately emits `assets/stretch-processor.js` as a
separate bundled entry. Build success alone does not verify runtime worklet loading.
No failing automated product assertion was observed.

Emitted JS baseline: **178,369 bytes** across all 11 `dist/assets/*.js` files, including
Worker/worklet and test-page chunks; this is total emitted JS, not startup transfer size.
Main chunk 100,280 bytes; shared header chunk 29,439 bytes; demo chunk 319 bytes.
Reproduce after `npm run build` with Python 3:

```python
from pathlib import Path
files = sorted(Path('dist/assets').glob('*.js'))
for file in files:
    print(file.name, file.stat().st_size)
print('total', sum(file.stat().st_size for file in files))
```

### Current ownership map

Line references and named regions below refer to the source commit above. They are an
inventory, not a proposed wholesale extraction.

| Region / state | Authoritative current owner | Initialization and migration seam |
|---|---|---|
| Player static shell, loadzone/input, transport, separation and notes markup | `index.html` authors nodes; runtime owners below update them | Inline i18n init plus module entries. Preserve startup order and existing IDs until each owner transfers. |
| Header navigation, language button listeners/pressed state | `lib/header.js:initHeader` | Eager call at `app.js:23`; replaces header markup but moves the existing `.loadzone` and input back. `dataset.ready` prevents repeat initialization of the same node; no disposer. |
| File selection, drop overlay, loading/status/title | `app.js:loading`, `say`, input section | Module-init `el` captures input/controls/canvas at lines 148–160. Change handler clears input value before `loadAny`. Document drop listeners accept/reject input. Header does not own decoding. |
| Audio clock, decoded tracks, gains, transport, loop, rate, routing | `app.js:state`, loading, transport, A-B repeat, routing | Module singleton; AudioContext lazily created at 44100 Hz. Sources/worklets follow playback lifecycle, `playGen` guards stale play work. No application-wide mount/dispose API. |
| Lane/overview/zoom DOM and canvas references | `app.js:buildUI`, render/paint functions, input handlers | Song rebuild replaces lane nodes and clears song caches. `mainWave` captured eagerly; dynamic canvas refs retained in track/notes/zoom state. rAF draws; native audio owns loop/end. |
| Selection, editor toolbar, canvas gestures, shortcuts | `app.js:input`, `syncEditToolbar`, `syncNoteFields` | Document keydown plus per-canvas pointer/wheel handlers. Focus exclusions protect editable fields. No second keyboard owner should be added during migration. |
| Notes frames, interpretation, edit groups, sonifiers | `notes.js:createNotesChannel` (vocals and bass) | Eager control lookup and listeners; lazy per-channel Workers. Reset stops sonifier, terminates worker, clears analysis/edits. `refreshAll` polls every 400 ms; buffer identity determines analysed-song changes. |
| Shared tempo, chord timeline/corrections, capo, edit import/export | `notes.js` shared regions | Songload resets tempo; chord detection uses a delayed callback and waits for running channels. Tempo re-detection creates its own Worker. Player receives presentation state through events. |
| Separation controls, phase/progress, saved results, Worker | `separate.js` | Eager DOM captures and handheld predicate; lazy reusable Worker, cancel message, error/result handlers; 400 ms refresh reads player state. No disposer or general song-generation guard. |
| Dictionary, active/saved locale, document language | `lib/i18n.js` | Explicit `init`; guarded storage reads/writes. `setLocale` traverses **the whole document**, then emits language event. Confine traversal before React owns annotated descendants. |
| Demo discovery/list markup, page links, build SHA | `scripts/build-demos.js` | Build-time scan of direct HTML files in `public/demos`; escaping and encoded relative links; generated `demos/index.html` is not authored source. |
| Demo title and count | `demos.js` | Calls i18n init then header init; eager refresh and language listener, no disposer. Phase 1 must transfer these writes only if its pilot owns those nodes. |
| Shared responsive styling and hidden visibility | `styles.css`; generator's inline demo styles | Retain global `[hidden]` override and verify rendered layout in Chromium. |

The existing `window.sansBass` surface at the end of `app.js` has real consumers:
`notes.js`, `separate.js`, and browser harnesses. It exposes separated loading, mix/stem
buffers, notes/ribbon operations, tempo range, audio destinations, transport snapshot,
and status. Its classic-script comment is stale: the consumers are now modules. Record
this as existing migration debt; do not invent another global or remove it before consumers
move. The guide's statement about removed `window.SansX` globals does not remove this
lowercase player bridge.

### Custom event inventory

All names have prefix `sansbass:` and dispatch on `window`.

| Events | Producer → consumer |
|---|---|
| `langchange` | i18n → header, demos, app retranslation, notes, separation |
| `songload` | app buildUI → notes shared tempo reset |
| `transport`, `ribbonmute` | app → per-channel notes sonifiers |
| `temporange` | app drum/selection UI → notes |
| `temporangemode`, `tempo` | notes → app drawing/interaction state |
| `chords` | notes → app timeline/editor |
| `chordedit`, `chordredetect`, `capochange` | app controls → notes |
| `editmode` | app controls and notes reset/import paths → app and both notes channels |
| `noteedit`, `editundo` | app editor/keyboard → notes channels |
| `exportedits`, `importedits` | app shared controls → notes persistence |

Listeners and pollers are page-lifetime today. React subscription cleanup must not destroy
song/audio state, and UI remount must not accumulate these listeners. Stale load/analysis/
separation results are a source-inspection risk requiring explicit tests in phases 2/5;
this slice did not reproduce or fix those races.

### Coverage audit and additions

The historical map preserves 255 original rows; its dash entries are not proof of failure,
and a scenario's file-level coverage does not mean every assertion is automated.
Existing `tests/i18n.test.js` proves saved-choice precedence and blocked storage handling.
Existing `tests/player.test.js` proves language changes retain canvas identity and routing,
synthetic loading, gain ramps, drag visibility, and fake separation success.

Added `tests/header.test.js` in jsdom: player input identity and existing change listener
survive initialization and both language switches; pressed states and active-page links
are correct; player/demo links resolve inside a nested base; demo header has no load input.
These are DOM semantics, not file-picker, layout, audio, or deployed-path evidence.

Slice 0b exercised actual generated demo-page title/count, stored/blocked storage wiring,
generator add/remove/Unicode/non-HTML discovery, narrow layouts, and normal/nested static
build navigation. React remount/unsubscribe assertions remain phase-1 work because no React
boundary exists yet. The generator's zero-demo empty state was not exercised.

### Lightweight progress record

React owns no region yet. All current owners and existing bridges are listed above.
No temporary migration adapters were added. The next ownership transfer is the isolated
**demo-page header/navigation/language UI**; the player header stays legacy-owned.

Per user feedback, LOC is optional and is no longer a phase gate. No dedicated counter,
per-region line inventory, or mandatory per-slice scorecard is retained. Use ownership,
relevant behavioural checks and milestone performance comparisons instead.

### Slice 0b — browser and local-build evidence

Collected 2026-09-05 20:31–20:34 UTC; Apple M4 Max, macOS 26.6.2, Playwright headless
Chromium **151.0.7922.34**, device scale 1. Source and displayed SHA: **9636b06**.
Production files are unchanged from that revision. External browser requests were blocked.

[Raw browser results](react-baseline/artifacts/report.json) and
[raw build results](react-baseline/artifacts/build-report.json) retain samples and outcomes.
Archival reproduction scripts: [capture.mjs](react-baseline/capture.mjs) and
[build-smoke.mjs](react-baseline/build-smoke.mjs). These are one-off baseline tools, outside
`npm test`; do not rerun the entire capture for each small migration slice.

```sh
npm run dev -- --host 127.0.0.1
# In another terminal, from the repository root:
node docs/react-baseline/capture.mjs /tmp/sans-bass-react-baseline
node docs/react-baseline/build-smoke.mjs /tmp/sans-bass-react-baseline
```

The scripts pin the baseline SHA; update that assertion when deliberately collecting a
later milestone. Build smoke uses an isolated temporary copy, creates/removes its fixture
there, and serves built output at `http://127.0.0.1:8780/` and `/pr-baseline/`.
It never publishes or modifies the real demo directory.

| Boundary | Actual evidence |
|---|---|
| Desktop/narrow, EN/zh-TW | 28 full-page reference PNGs: seven states × two locales × 1440×900 / 390×844. No document-level horizontal overflow in any capture. |
| LOAD-001 subset | Real input receives production-encoded 10-second vocals 440 Hz, bass 110 Hz and drums 120 BPM click ZIP; a subsequent non-ZIP byte payload produces a visible translated error. |
| MIX/LOOP subsets | Bass mode selected; A/B badge visibly establishes 0–1.5 s loop. These screens do not prove gain/audio looping. Suite gain tests remain separate evidence. |
| NOTE/EDIT subsets | Real local notes Workers process synthetic audio; both channel panels appear; edit mode and ribbons are visible. No musical-accuracy or comprehensive edit-gesture claim. |
| LANG/BOOT subsets | Saved locale survives player → demos; player and demos boot/switch both languages with storage throwing. No uncaught page errors. |
| Built demo discovery | Unicode/space/ampersand HTML filename is encoded/listed and copied unchanged; non-HTML is not listed; fixture removal removes the entry and stale build file. |
| Normal/nested static paths | Both languages: SHA, demo title/count, sample export/capo and return-to-player navigation pass. No local HTTP errors. |
| Built AudioWorklet | `audioWorklet.addModule` loads the explicit bundled entry at both base paths; 44100 Hz context. This is module-load evidence, not stretched-audio listening or node processing. |

The synthetic fixture is specified in the raw report and uses the actual
`tests/helpers/audio-fixtures.js` → WAV/ZIP encoders → `#file-input` path under Vite.
No committed song or private audio appears in these images.

Representative reviewed images:

- [Desktop English empty](react-baseline/artifacts/desktop-en-empty.png)
- [Desktop English editor](react-baseline/artifacts/desktop-en-editor.png)
- [Desktop Chinese demos](react-baseline/artifacts/desktop-zh-TW-demos.png)
- [Narrow English demos](react-baseline/artifacts/narrow-en-demos.png)
- [Narrow Chinese editor](react-baseline/artifacts/narrow-zh-TW-editor.png)
- [Narrow Chinese error](react-baseline/artifacts/narrow-zh-TW-error.png)

Visual observations: the empty/player/demo layouts and translated controls remain legible;
long demo filenames wrap. The narrow player header stacks, and the loaded title truncates.
The narrow zoom toolbar is crowded, with its rightmost controls clipped in the reference;
this is an existing visual limitation, not a React regression. No redesign was made.
The error message remains below the existing loaded song/editor, making the narrow page long.
Screenshots are reference material alongside outcome assertions, not parity tests.

Two capture-harness issues were corrected before the retained run: reading demo locale
before its module initialization, and capturing a sticky header after control-induced
scrolling. The final run waits for header initialization/load and scrolls to the top.
Neither was recorded as an application regression.

### Milestone performance reference

Fresh browser context for each of five samples, warm Vite server for development;
local built server uses `Cache-Control: no-store`. No network/CPU throttling. These fast
local values are comparison references on this machine, not user performance promises.

| Measurement | Median / scope |
|---|---|
| Dev DOMContentLoaded | 34.8 ms |
| Dev automation-observed player ready | 61.3 ms; includes polling/automation overhead |
| Synthetic selection → lane update + next rAF | 27.2 ms; ZIP generation excluded |
| Built DOMContentLoaded | 19.9 ms |
| Built automation-observed player ready | 35.8 ms; includes polling/automation overhead |
| Built startup JS transfer | 146,150 bytes each run; includes Resource Timing transfer overhead, unlike emitted-byte total above |
| Foreground rAF intervals after Play | 8.4 ms median, 9.3 ms max, 120 intervals |
| Programmatic lane click → next rAF | 8.2 ms median, 9.3 ms max, 10 samples |

The last two are drawing/control scheduling proxies, not input-to-screen paint or audio
latency. The short capture reports `playing: true` but samples the integer time label as
`0:00`; it does not establish sustained audible playback or trusted unlock. Keep human
playback/background checks separate. Do not rerun these measurements for every UI edit;
compare at the pilot, player-shell and final-acceptance milestones.

### Omissions and handoff

Selected manual checks, all **not run**: trusted playback unlock (TRN-001), background native
loop and longest-source end (LOOP-001/TRN-001), native/stretched seams and pitch preservation
(SPD-001), language-switch audio continuity (LANG-001), and note-tone alignment. Later manual
comparison should use `examples/nov_you.zip` locally and record device/browser/SHA.

Physical handheld, real-song musical accuracy, real separation/model execution, deployed
PR/main smoke, comprehensive malformed-input combinations and the full behaviour matrix
remain untested in this baseline. Real notes Workers were exercised in development; real
bundled notes/separation Worker execution was not part of the static build smoke.
No model download was attempted. These omissions do not become passes through screenshots
or unit coverage. The phase-0 exit gate requires explicit omissions, not full release parity.

Baseline deliverables are recorded and each first-phase DOM region has an owner. Next bounded
slice: **phase 1 isolated demo-page React pilot**, including locale subscription cleanup,
remount behaviour and the affected demo checks. No competing player owner should be added.
No PR, merge, release, or deployed acceptance is recorded. Rollback is reverting this slice's
tests/config/docs; no user-data conversion or production-code rollback is needed.
