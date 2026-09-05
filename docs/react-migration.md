# Incremental React migration

Status: phase 0 baseline recorded locally, with explicit omissions; phase 1 not started.
Created 2026-09-05.

## Goal and scope

Introduce React for reusable website components while preserving the existing product
behaviour, appearance, audio timing, local processing, and static deployment. Each phase
can span multiple sessions and PRs and must leave a usable, deployable application.
This is a migration roadmap; write a bounded implementation plan for each slice when work
on it begins, using the source and evidence available at that time.

The acceptance authority remains [product-contract.md](product-contract.md), with executable
scenarios in [behaviour.md](behaviour.md), test placement in [testing.md](testing.md), and
coverage tracking in [test-coverage.md](test-coverage.md). Do not weaken those promises to
make the new implementation pass. Existing defects discovered during baseline work should
be recorded separately from migration regressions.

The intended endpoint is React ownership of the player and demo-page component UI, with
ordinary JavaScript modules retaining audio, analysis, serialization, and canvas rendering.
Generated notation exports remain self-contained HTML. No redesign, new features, DSP
changes, TypeScript conversion, backend, router, or global state library is required by this
migration. Additional dependencies need a concrete need within a phase.

## Architecture rules throughout the migration

- One owner per DOM region. Legacy code must not replace children, set translated text,
  or attach competing control listeners inside a React-owned region. Explicit canvas hosts
  may delegate drawing and pointer handling to an imperative renderer.
- One authoritative owner per application state value. React reads application snapshots
  and invokes commands; do not mirror mutable playback or edit state into a second store.
  Component-local state is appropriate for temporary UI concerns such as an open menu.
- Keep the single 44100 Hz AudioContext, shared source scheduling, gain-based muting,
  native loop/end behaviour, and stretched-playback path. Audio scheduling remains outside
  React renders and effects. User gestures must reach audio unlock without losing activation.
- Keep audio buffers, Workers, AudioWorklets, analysis frames, and renderers outside component
  render lifetimes. Define explicit application/song lifetimes and cleanup. A UI remount must
  not start another analysis, duplicate playback, discard edits, or reset the song.
- Keep rAF for drawing. Avoid rerendering the entire component tree on every animation frame.
  Use stable canvas references and stable track/channel identities through language and
  control changes; do not use translated labels as component keys.
- Use ESM commands and subscriptions with explicit unsubscribe/dispose behaviour. Existing
  custom events may serve as temporary adapters with named consumers; no new window globals.
  Extract only the boundary needed for the current slice.
- Retain the existing translation dictionary and saved-locale rules. React renders its own
  translated copy, while legacy translation traversal is confined to legacy-owned regions.
- Preserve the single file input, supported input shapes, keyboard/focus behaviour,
  accessible labels, responsive styling, privacy rules, and static base-path handling.

## Phase overview

| Phase | Deliverable | Dependency | Planning effort |
|---|---|---|---|
| 0 | Recorded baseline and ownership map | None | 1–2 days |
| 1 | React foundation and isolated demo-page pilot | 0 | 1–2 days |
| 2 | Player command/subscription boundary for first controls | 1 | 2–4 days |
| 3 | React player shell, loading, and transport controls | 2 | 2–4 days |
| 4 | React stem lanes with existing canvas rendering | 3 | 2–4 days |
| 5 | React separation and analysis controls | 4 | 2–4 days |
| 6 | React notes/editor UI and persistence controls | 5 | 3–6 days |
| 7 | Legacy UI retirement and full release acceptance | 6 | 2–3 days |

These are rough focused developer-days including verification, not calendar commitments.
The total is approximately 3–6 working weeks for someone familiar with the project; revise
after the pilot and after establishing the player boundary. A small initial React adoption
can stop after phase 1. A later pause is also safe at any accepted phase: document remaining
legacy ownership rather than leaving two implementations active for the same controls.

## Phase 0 — Baseline and migration inventory

**Outcome:** establish what must remain equivalent before introducing React.

- Run `npm test` and `npm run build`; record source commit, environment, results, and existing
  failures. Inspect the coverage map for assertions missing at the boundaries being migrated.
- Map DOM and state ownership across `index.html`, `app.js`, `notes.js`, `separate.js`,
  `lib/header.js`, `lib/i18n.js`, and the demo generator. Include module-init DOM reads,
  custom events, file-input ownership, canvas references, global keyboard listeners, and
  Worker/song lifetimes.
- Record representative desktop/narrow-layout screens in both languages, plus a loaded
  song, routing, loop, notes/editor, and error state. Capture representative load time,
  emitted JS size, and drawing/control responsiveness using repeatable conditions.
- Add only missing behavioural regression coverage needed for the first slices, in the
  layers specified by `testing.md`. Do not turn screenshots or internal variable snapshots
  into the sole acceptance oracle.
- Create a migration evidence log using the record format below. Select baseline manual
  checks for trusted playback, background loop/end behaviour, and auditory comparison.
- Use the ownership map to track migration progress; detailed source-line accounting is not
  required. Keep performance measurements as a baseline for major milestones.

**Exit gate:** baseline results and omissions are explicit, each first-phase DOM region has
an identified owner, and known failures are distinguishable from new regressions. No claim
of parity is made for untested categories.

## Phase 1 — React foundation and isolated pilot

**Outcome:** demonstrate a small production React component without coupling it to audio.

- Update the no-framework rule in `CLAUDE.md` to permit React component UI while retaining
  the audio, privacy, ESM, and static-hosting constraints. This is part of the requested
  architectural migration, not a separate permission gate.
- Add React/React DOM and appropriate Vite JSX support, keeping the existing multi-page
  build, generated demos, tests, commit SHA, and AudioWorklet entry working.
- Start with demo-page navigation/language UI or another bounded demo-page component.
  Preserve build-time discovery of published demo files and relative navigation paths.
  Keep the player header on its current implementation until its own ownership transfer.
- Establish component styles, locale subscription, mounting, and cleanup conventions.
  Exercise development remount/cleanup behaviour so subscriptions do not accumulate.

**Exit gate:** the pilot works in both languages with saved and blocked storage, at desktop
and narrow widths. Build-preview checks pass at normal and nested PR-like paths; demo links
and exports still work. Record JS size and startup changes against phase 0.

**Increment boundary:** one isolated component and its build integration can be a complete
PR. Revert that PR if needed; no audio or data migration is involved.

## Phase 2 — Establish the player boundary

**Outcome:** UI controls can call player operations without importing DOM initialization.

- Extract the smallest command/subscription interface needed for loading and transport,
  retaining existing algorithms and state modules. Keep the current UI using that interface
  first, so extraction and React conversion can be reviewed separately.
- Define application initialization, song replacement, observable snapshots, command error
  reporting, and disposal. UI subscription cleanup must not dispose the application engine.
- Remove eager DOM assumptions only where the next migration slice requires it. Ensure
  application initialization waits for any controls it still needs; a React render request
  must not be treated as proof that those nodes already exist.
- Establish explicit ownership of audio unlock, keyboard commands, async loading results,
  and song identity. Late results from an older song must not overwrite a new song.

**Exit gate:** the unchanged UI passes affected LOAD, MIX, TRN, LOOP, and SPD assertions
through the extracted boundary. Subscribing/unsubscribing does not restart audio or mutate
song state, and commands produce the same externally observable results.

**Increment boundary:** extract one capability at a time. Avoid requiring a complete
`app.js` decomposition before the first React player control can ship.

## Phase 3 — Player shell, loading, and transport

**Outcome:** React owns the header, loading/status UI, and transport controls.

- Transfer header ownership and share the appropriate components with the demo page.
  Preserve the file input's identity during language changes and preserve loaded state.
- Migrate loading/error/drag overlay, play/pause, seek-related controls, master volume,
  speed, A/B controls, and mode menus in bounded slices.
- Preserve existing CSS and selectors where useful, retiring corresponding legacy writes
  and listeners in the same slice. Keep shortcut handling and focus rules explicit.
- Route commands through phase 2's interface. A language switch, status update, or menu
  toggle must not recreate the player or restart playback.

**Exit gate:** affected LOAD, TRN, LOOP, SPD, LANG, BOOT, and ANALYTICS scenarios pass;
repeat file selection, drag/drop rejection, trusted audio unlock, focus restoration,
hidden-control visibility, and background transport have appropriate evidence.

**Increment boundary:** header/loading first, then transport groups. Each PR leaves all
controls wired and visibly consistent with engine state.

## Phase 4 — Stem lanes and waveform hosts

**Outcome:** reusable React lane components host the existing waveform renderer.

- Migrate lane labels, mute/solo/restore, per-lane volume, and mix mode presentation.
- Separate lane DOM construction from drawing, with explicit renderer attach/update/dispose
  operations and stable canvas nodes. Retain waveform peak generation and audio routing.
- Preserve lane order, unknown lanes, explicit Full mix identity, overview alignment,
  hit targets, resizing, and handheld interaction.

**Exit gate:** MIX, affected LOAD/TRN/LOOP, and LANG scenarios pass using ordinary stems,
Full mix plus stems, unknown lanes, and unequal durations. Observe gains and source
start/stop calls; CSS state alone does not prove routing. Verify canvas identity across
language changes, aligned drawing, and responsiveness against the baseline.

**Increment boundary:** migrate standard lanes before shared overview integration. Keep
notes-specific renderer ownership explicit until phase 6.

## Phase 5 — Separation and analysis controls

**Outcome:** React panels reflect existing separation and detection services.

- Migrate separation availability, start/progress/cancel/error/save controls and notes
  detection controls. Keep model/runtime fetching, inference, and analysis algorithms intact.
- Transfer the relevant UI writes from `separate.js` and `notes.js`; extend the service
  boundary only as needed. Preserve lazy/user-triggered work and handheld gating.
- Verify repeated mounts, cancellation, worker failure, simultaneous vocal/bass completion,
  and a new song arriving while work is pending. Stale results must not repopulate cleared UI.

**Exit gate:** SEP and the detection lifecycle portion of NOTE pass with deterministic
Worker protocols. Verify six-stem replacement, playback reset, save/error recovery, exact
busy-channel labels, and chord-work completion coordination. Run separate real-Worker build
smoke checks; fake results do not prove model execution. Record handheld evidence separately.

**Increment boundary:** separation panel and detection controls are separate PR-sized slices.

## Phase 6 — Notes, tempo, editor, and export controls

**Outcome:** React owns the remaining complex UI without changing musical interpretation
or losing user edits.

- Migrate interpretation/key/display controls, then tempo/grid/capo/chord controls, then
  selection/edit/undo/import/export controls. Preserve vocal/bass independence.
- Host the existing ribbon/overview/zoom renderers with stable identities. Assign pointer,
  keyboard, focus, and selection ownership explicitly so a gesture invokes one operation.
- Retain edit identities, ordering, time precision, undo grouping, uncertainty handling,
  chord corrections, and persisted formats. Keep generated notation HTML self-contained.
- Test imports made by the pre-migration application in the new UI, and compare round trips
  semantically. Normalize only expected variable fields such as export timestamps.

**Exit gate:** NOTE, TEMPO, EDIT, EXPORT, and relevant LOOP/SPD/LANG scenarios pass. Include
overlapping notes, exact duplicates, range versus note selection, both note channels,
reinterpreting existing edits, accompaniment-only chord bars, capo changes, Unicode filenames,
and loading a new song. Compare final visuals and note-tone alignment with the baseline.

**Increment boundary:** interpretation, tempo/chords, and editing/persistence each receive
their own acceptance evidence; do not bundle this phase into one rewrite PR.

## Phase 7 — Retire legacy UI and accept the migration

**Outcome:** one documented component architecture with all migration adapters accounted for.

- Remove unused DOM builders, listeners, temporary subscriptions/events, and dead styles
  only after their last consumers move. Keep intentional imperative audio/canvas modules.
- Update `CLAUDE.md` with the actual module and ownership map; update testing and behaviour
  harness instructions where entry points changed, preserving their outcome assertions.
- Run the complete automated suite and build, then review every scenario in `behaviour.md`
  against accumulated evidence and run the remaining acceptance checks on the final build.
- Verify production-preview paths, SHA, real Workers/AudioWorklet, a real-song workflow,
  and cached-model separation on a supported desktop. An uncached model download remains
  an explicitly requested check, not a routine test dependency.
- Complete physical handheld, visual, auditory, and background-playback checks; compare
  startup, bundle size, and interaction/drawing performance against phase 0. Investigate
  regressions before declaring completion; record any explicitly accepted tradeoffs.

**Exit gate:** every product promise has linked evidence or an explicitly unresolved gap;
unresolved parity gaps mean migration acceptance is still pending. The source contains no
competing legacy/React owner for migrated UI, and future components have a documented pattern.

## Verification and release policy for every phase

Run targeted checks for the changed boundary, followed by `npm test` and `npm run build`.
Use Node for pure state/data, jsdom for non-rendering DOM/storage, and Chromium for actual
page wiring, Web Audio, canvas, computed visibility, focus, and Worker APIs. Update the
coverage map when coverage changes. Do not replace outcome checks with component snapshots.

Generate synthetic ZIPs with the repository helpers and real `lib/wav.js`/`lib/zip.js`
encoders, feeding them through the real `#file-input`. Follow the current harness in
`behaviour.md` (`tests/helpers/audio-fixtures.js` and `loadStemsZip`) under `npm run dev`.
Include stem combinations and malformed input required by the affected scenarios.
`examples/nov_you.zip` is the musical/deployment fixture, not the full behaviour matrix.

Every phase follows the tiered deployment procedure in `behaviour.md`: the PR preview verifies
the affected behavior and public-host boundary, and the merged root gets a compact delivery
canary with workflow conclusion, SHA, boot/error sanity, and one affected route or control.
Run the full smoke on both origins when entry points, mounting/base paths, CI deployment,
Workers/AudioWorklets, caches, or static assets change. Phase 7 also runs it as release
acceptance. Deployed evidence records the actual URL and SHA. Automated tests remain offline;
deterministic fake Workers test protocols, while real Worker/model checks test their own
boundaries. Report visual, auditory, physical-device, and background checks individually.

Keep each PR deployable and independently reviewable. Separate behavioural fixes or redesign
from structural migration. Preserve data formats so rollback requires reverting code, not
transforming user exports. Use version history for rollback rather than maintaining permanent
duplicate UIs or runtime migration flags. Do not hand-edit the CI-owned deployment branch.

## Progress and session handoff

### Lightweight progress reporting

Measure progress by ownership transferred and behaviour preserved. For each slice, record:

- Which UI regions now have one React owner, and which remain legacy-owned.
- Which temporary adapters remain, their named consumers, and when they can be removed.
- Relevant test/build results and unresolved acceptance gaps.

Compare shipped JS size and representative startup/responsiveness at the pilot, player-shell,
and final-acceptance milestones. Investigate a noticeable regression; do not require a new
performance campaign for every small component.

LOC is optional, not an exit gate or a percentage-complete measure. Detailed mixed-file
classification and per-slice scorecards cost more than they tell us about migration progress.
A simple whole-source before/after check at final acceptance may be useful if maintainability
is still in question; do not build or maintain dedicated LOC tooling for this migration.

### Phase tracking

| Phase | Status | Evidence / PRs | Remaining work |
|---|---|---|---|
| 0 | Baseline recorded | [Evidence and omissions](react-migration-evidence.md) | Manual/deployed omissions retained for later acceptance |
| 1 | Not started | — | React pilot |
| 2 | Not started | — | Player boundary |
| 3 | Not started | — | Shell/loading/transport |
| 4 | Not started | — | Lanes and waveform hosts |
| 5 | Not started | — | Separation/detection controls |
| 6 | Not started | — | Notes/editor controls |
| 7 | Not started | — | Cleanup and acceptance |

Update this table after each accepted slice. Store detailed evidence in a linked migration
log or PR, recording:

- Phase/slice, source commit, changed ownership boundaries, and next bounded slice.
- Automated commands/results and known baseline failures.
- Updated ownership map and remaining adapters; milestone performance evidence when relevant.
- Scenario IDs, fixture categories, browser/device, tested URL/build SHA, and results.
- Separate local-build, deployed, manual/visual, and auditory results; explicitly mark skips.
- Remaining risks, temporary adapters with named consumers, and rollback commit/PR.

At the start of a later session, read this table and the latest evidence before selecting
work. Resume the next unfinished slice; do not repeat completed migrations or assume that a
phase is accepted merely because its components render.
