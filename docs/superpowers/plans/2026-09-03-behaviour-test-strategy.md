# Behaviour coverage and automated test strategy — Implementation Plan

> **Execution note:** Start in a fresh session by reading `AGENTS.md`, `CLAUDE.md`, the
> linked spec, and `docs/behaviour.md`. Create a dedicated feature branch before editing.

**Goal:** Move deterministic behaviour coverage into `npm test`, add player-level browser
integration tests with generated fixtures, establish a separate durable product contract,
and simplify the executable smoke matrix without losing any of its 255 original checks.

**Spec:** [`docs/superpowers/specs/2026-09-03-behaviour-test-strategy-design.md`](../specs/2026-09-03-behaviour-test-strategy-design.md)

## Global constraints

- This is a test-architecture/documentation refactor, not a product redesign.
- Preserve unrelated work, especially the existing untracked `demo.md`.
- Do not commit generated WAV/ZIP fixtures or the separator model.
- Do not delete or merge a behaviour row until it has an entry in the coverage map.
- Keep `npm test` offline and deterministic.
- Use `apply_patch` for source/document edits and make focused commits.
- Run `git diff --check`, `npm test`, and `npm run build` before every milestone handoff.

## Task 0: Validate the product contract

**Files:**
- Review/modify: `docs/product-contract.md`
- Cross-check: `README.md`, `CLAUDE.md`, `docs/behaviour.md`, `docs/transcription.md`, and
  `docs/chord-detection.md`

- [ ] Confirm the contract describes durable user promises rather than implementation or
  test procedure.
- [ ] Confirm every major product surface is represented: privacy, loading, routing,
  transport, speed, separation, notes, tempo, editing, export, language, resilience, and
  release integrity.
- [ ] Link contract clauses to scenario groups in the coverage map created in Task 1.
- [ ] Do not use the contract as a replacement for executable `docs/behaviour.md` scenarios.

## Task 1: Establish an immutable coverage inventory

**Files:**
- Create: `docs/test-coverage.md`
- Test: optional small Node validation script/test described below

- [ ] Record the current commit and count the original behaviour rows; expected baseline is
  255 unless the source changed after this plan was written.
- [ ] Parse every `##` section and table row into the coverage document. Identify an old row
  by `(section, ID)`, never ID alone.
- [ ] Add columns for replacement ID, disposition, automated test, and retained live check.
- [ ] Mark existing coverage by exact test file and test name. Do not treat a related helper
  test as coverage unless it proves the row's contract.
- [ ] Explicitly record current collisions: reused `S*`, `N*`, `T*`, and duplicate Editing
  `E42`.
- [ ] Add `tests/coverage-map.test.js` (Node tier) or an equivalent validation script that
  fails when an original row is missing/duplicated in the map or a referenced test file does
  not exist. Prefer a test so the map cannot silently drift.
- [ ] Register the test in `vitest.config.js` and run it red, then green.
- [ ] Commit the inventory independently. No behaviour rows are changed in this task.

## Task 2: Add shared generated fixture helpers

**Files:**
- Create: `tests/helpers/audio-fixtures.js`
- Create: `tests/helpers/zip-fixtures.js`
- Modify: relevant existing ZIP/WAV tests to consume the helpers where this removes local
  duplication without obscuring intent
- Test: `tests/audio-fixtures.test.js` if helper behavior is nontrivial

- [ ] Move the documented `sine`, WAV encoding, and stems-ZIP recipe into importable helpers.
- [ ] Add a deterministic click track with configurable BPM/phase/duration.
- [ ] Support flat/folder layouts, mix plus stems, unknown names, sidecars, invalid audio,
  and caller-selected entry ordering.
- [ ] Move reusable malformed-archive byte mutations out of `tests/unzip.test.js` only when
  doing so improves clarity.
- [ ] Prove generated WAVs decode at 44100 Hz and generated stored ZIPs round-trip.
- [ ] Keep deflated fixtures in memory or generate them using browser `CompressionStream`;
  do not shell out from the test suite.
- [ ] Update the harness section of `docs/behaviour.md` to import the shared helper rather
  than maintaining a second copy of its implementation.
- [ ] Run all tests and commit.

## Task 3: Extract and test routing state

**Files:**
- Create: `lib/routing-state.js`
- Create: `tests/routing-state.test.js`
- Modify: `app.js`
- Modify: `vitest.config.js`

- [ ] Pin the current M/U/P behaviours in failing table-driven tests: lane toggle, solo,
  ordinary full mix, explicit mix/stem exclusivity, custom mode, mute-all, restore snapshot,
  all-off behavior, and song-load reset.
- [ ] Extract the smallest pure state transition API capable of passing those tests.
- [ ] Replace inline `app.js` mutations with the tested transition results while preserving
  gain ramps and labels in the UI adapter.
- [ ] Add a browser integration assertion that the derived state actually reaches lane
  classes, mode `<select>`, labels, and gain calls.
- [ ] Map M1-M6, U1-U8, and P1-P5 to the new tests/scenarios.
- [ ] Run targeted tests, full tests, build, and commit.

## Task 4: Extract loop, speed, and transport decisions

**Files:**
- Create: `lib/loop-state.js` if the logic does not fit `lib/transport-math.js`
- Modify: `lib/transport-math.js`
- Modify: `tests/transport-math.test.js`
- Create/modify: browser player integration tests
- Modify: `app.js`

- [ ] Add pure tests for reversed A/B points, sub-100ms rejection, clearing, unequal stem
  duration, speed reset, bounds/fine steps, and native↔stretched rebuild decisions.
- [ ] Keep real `OfflineAudioContext` assertions for note entry/loop behavior in
  `tests/sonify.test.js`; mark R8-R13 automated in the map.
- [ ] Add browser tests for keyboard focus, seeking while playing/stopped, end-of-song,
  loop badge visibility, and time-code/BPM labels.
- [ ] Retain live checks only for background throttling and subjective seam/pitch quality.
- [ ] Run targeted tests, full tests, build, and commit.

## Task 5: Add the real player browser-integration harness

**Files:**
- Create: `tests/player.html` only if the actual `index.html` cannot be used directly
- Create: `tests/player.test.js`
- Create: `tests/helpers/player-harness.js`
- Modify: `vite.config.js` only if a test entry is genuinely required
- Modify: `vitest.config.js`

- [ ] Prefer loading the actual application entry and production modules. If a test page is
  required, document every deliberate difference from `index.html`.
- [ ] Provide fixture loading through the real `#file-input` using `DataTransfer`.
- [ ] Provide controlled fake Worker constructors for notes/separation protocol tests while
  keeping separate real-Worker smoke tests.
- [ ] Provide instrumentation for GainNode ramps, BufferSource start/stop, oscillator
  scheduling, and canvas identity without exposing production globals.
- [ ] Cover Loading L1/L5/L8/L8a/L12-L19, lane DOM/style behavior, routing DOM wiring,
  computed hidden state, and language rerendering.
- [ ] Add drag/drop overlay tests using real cancelable `DragEvent`s.
- [ ] Add startup fault tests for a missing element, thrown error, and blocked localStorage.
- [ ] Add analytics integration tests for event privacy and page-level wiring.
- [ ] Ensure the suite is deterministic headless Chromium and makes no network calls.
- [ ] Run the browser project alone, then all tests/build, and commit.

## Task 6: Extract notes-detection and separation UI state

**Files:**
- Create: `lib/detection-state.js`
- Create: `lib/separation-state.js`
- Create: corresponding Node tests
- Modify: `notes.js`, `separate.js`, and browser integration tests

- [ ] Encode the notes detection state machine for absent/pending/running/complete channels.
- [ ] Test vocals-only, bass-only, both, and neither; test one channel finishing first.
- [ ] Encode separation idle/running/success/cancel/error controls as pure derived state.
- [ ] Browser-test that derived state controls computed visibility and disabled attributes.
- [ ] Keep one real notes Worker test in the existing browser tier.
- [ ] Keep real separator model inference out of `npm test` and in the production smoke
  procedure.
- [ ] Map Notes N1-N4/N22/N22a/N22b and Separation S1-S16.
- [ ] Run all tests/build and commit.

## Task 7: Move note/editor mechanics to deterministic tests

**Files:**
- Create: `lib/editor-state.js`
- Create: `tests/editor-state.test.js`
- Modify: `app.js`
- Modify: browser integration tests
- Extend existing `pitch`, `ribbon`, `time`, and `notes-edits` tests where appropriate

- [ ] Inventory N5-N66 and E1-E43 against existing tests before writing new ones.
- [ ] Mark already-proven pitch/folding/contour/sonify facts rather than duplicating tests.
- [ ] Extract selection-versus-range state and command enablement.
- [ ] Unit-test note/range mutual exclusion, Whole song, batching, undo ordering, and command
  routing.
- [ ] Browser-test pointer hit selection, click versus drag, edge resize, fields, keyboard
  commands, lane/overview shared ranges, computed colors, and persistence.
- [ ] Use controlled notes with overlapping time and pitch to cover E19/E22/E24/E25.
- [ ] Keep only visual/auditory checks that cannot be represented by DOM, canvas pixels, or
  OfflineAudioContext.
- [ ] Run all tests/build and commit in reviewable subcommits if this task grows large.

## Task 8: Extract and test exported HTML

**Files:**
- Create: `lib/jianpu-html.js`
- Create: `tests/jianpu-html.test.js`
- Modify: `notes.js`
- Extend: `tests/jianpu.test.js`, `tests/chords.test.js` as needed

- [ ] Move `jianpuHtml` and formatting-only helpers without changing output.
- [ ] Pin title, heading, tempo/time-signature line, inline CSS/no external assets, bar
  wrapping, barlines, ties, octave dots, rhythm marks, chronological ordering, and chord-row
  markup.
- [ ] Test filenames/timestamps separately from HTML rendering.
- [ ] Retain one browser download smoke assertion, not a manual inspection of every glyph.
- [ ] Map E34/E35/E44 and remove algorithm duplication already owned by
  `docs/chord-detection.md`.
- [ ] Run all tests/build and commit.

## Task 9: Complete save, language, boot, and analytics coverage

**Files:**
- Extend existing `zip`, `i18n`, and `analytics` tests
- Extend browser integration tests
- Modify production modules only for necessary behaviour-preserving seams

- [ ] Cover non-ASCII saved paths, sequential encoding/repaint observation, and save failure
  recovery.
- [ ] Cover first-visit/stored/blocked locale behavior and whole-screen rerender while
  preserving canvas identities and transport.
- [ ] Cover missing-element resilience, uncaught-error UI, hashed asset validation, and SHA
  display.
- [ ] Cover page-level analytics names, one-play semantics, fixed-name privacy, local-host
  suppression, and handheld `once()` behavior.
- [ ] Update stale `vitest.config.js` comments about removed globals.
- [ ] Run all tests/build and commit.

## Task 10: Consolidate the behaviour document

**Files:**
- Modify: `docs/behaviour.md`
- Finalize: `docs/test-coverage.md`
- Modify: `docs/devlog.md`
- Modify: `CLAUDE.md`/`AGENTS.md` only if the final test commands or navigation changed

- [ ] Assign globally unique replacement IDs using the prefixes in the spec.
- [ ] Preserve `docs/behaviour.md` as the reference a user can hand to a browser harness for
  smoke or acceptance execution.
- [ ] Give each retained scenario an explicit fixture/precondition, action, and observable
  result; do not reduce it to a prose-only contract link.
- [ ] Merge rows only after the coverage map proves all component assertions remain covered.
- [ ] Replace low-level algorithm prose with links to tests and specialist documentation.
- [ ] Preserve real debugging gotchas in a concise harness section.
- [ ] Keep a short deployment smoke and manual/physical/auditory release checklist.
- [ ] Preserve the old-ID mapping permanently for devlog/history lookup.
- [ ] Add a devlog entry explaining the test pyramid, what moved, and why the smaller matrix
  has equal or stronger coverage.
- [ ] Run the coverage-map validator, all tests, build, and `git diff --check`.

## Task 11: Final verification

- [ ] Run `npm test`; all Node, jsdom, and browser projects pass.
- [ ] Run `npm run build`; inspect `dist/index.html` and asset references.
- [ ] Confirm tests make no separator-model or other unexpected network requests.
- [ ] Confirm the coverage map accounts for exactly the original baseline rows.
- [ ] Run the reduced synthetic player integration suite.
- [ ] Run production deployment smoke with `examples/nov_you.zip`.
- [ ] Run a real cached-model separation on a short generated WAV.
- [ ] Verify production build SHA matches the intended commit.
- [ ] Record any/retain physical handheld and subjective listening checks as manual if they
  were not performed.
- [ ] Check `git status` and ensure generated downloads/fixtures were not committed.

## Expected outcome

The routine regression command becomes authoritative for deterministic behaviour,
`docs/product-contract.md` states durable promises, and `docs/behaviour.md` remains an
executable smoke/acceptance catalog without duplicating the test implementation.
