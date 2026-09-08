# React migration Phase 7 — retire legacy UI and accept the migration plan

Status: planned from `379ed78e689ecc68b7d9eaafc193dd77c1505897` (documentation-anchor merge
for Phase 6f, PR #98) on 2026-09-07. Previous accepted implementation rollback anchor: Phase
6f at `c833b7e3022e7e0a7c414ca848aa50da51364d5f`, documented through
[PR #97](https://github.com/SansWord/sans_bass/pull/97) and anchored through
[PR #98](https://github.com/SansWord/sans_bass/pull/98). Phase 6 is complete in full; this is
the final phase in `docs/react-migration.md`'s roadmap.

Per `docs/react-migration.md`'s Phase 7 outcome, this phase is **cleanup plus acceptance**,
not a new ownership handoff: remove unused migration adapters only after confirming their last
consumer moved, finalize the ownership documentation, and run the acceptance checks the prior
six phases' evidence never chained together on the final build.

## Audit

Three independent read-only passes covered every location Phase 7's brief named. None found a
removable ownership handoff; the incremental migration's own phase-by-phase audits (6b, 6c,
6d, 6e, 6f each removed their own scaffolding before merging) already did that work as they
went. This phase's audit found comment-accuracy debt and an acceptance-evidence gap, not
dead code.

### 1. `app.js` — no dead code found

Grepped every `window.sansBass` member, every `sansbass:*` event dispatch/listener pair, and
every top-level `function` declaration (~100) against the whole repo (`notes.js`,
`separate.js`, `components/*.jsx`, `lib/*.js`, `tests/*.js|*.html`):

- All twelve `window.sansBass` members (`application`, `playerShell.{unmount,remount}`,
  `currentMix`, `isSingleTrack`, `stemBuffer`, `setNotes`, `setTempoRange`, `notesAudio`,
  `transport`, `ribbonMuted`, `setRibbonVisible`/`ribbonVisible`, `say`) have a live reader in
  `notes.js`, `separate.js`, or `tests/player.test.js`. None are dead.
- Every `sansbass:*` event app.js dispatches (`songload`, `temporange`, `chords`, `transport`,
  `ribbonmute`, `editmode`, `noteedit`, `editundo`, `langchange`, `temporangemode`, `tempo`,
  `exportedits`, `importedits`, `capochange`, `chordedit`, `chordredetect`) has a matching
  listener in `app.js`, `notes.js`, `lib/i18n.js`, or `components/useLocale.js`, and vice versa.
  None are orphaned.
- Every function declaration has at least one call site beyond its own definition. No
  unreachable function exists.
- No stale commented-out DOM-builder blocks exist.

**Two comment-accuracy findings** (documentation debt, not code to remove):

- `app.js:1247-1251` (`attachLaneExtra`'s doc comment, the drums tempo-range hint) and
  `app.js:1297-1303` (`attachOverviewExtra`'s doc comment, the range-select caption) both call
  this content "explicitly deferred, same as the rest of notes/tempo (Phase 6)." Phase 6 is
  now complete and never moved this content — CLAUDE.md confirms it stays `app.js`-owned
  permanently, alongside the ribbon/zoomed pane's other canvas-adjacent presentation. The
  wording reads as an open TODO that Phase 7 should have picked up; it should instead say this
  is a settled, permanent split between lane presentation (React) and notes/tempo feature
  content (`app.js`), not a deferral.
- `app.js:2309` (`announceTransport`'s doc comment) calls `sansbass:transport` a "Temporary
  exact-clock adapter for the two notes.js sonifiers," and `app.js:3556-3558` (the
  `window.sansBass` block's doc comment) calls the whole bridge "Temporary compatibility
  bridge... Remove each member when its named consumer migrates." Both are, per
  CLAUDE.md's own bridge rule, permanent and justified: `sansbass:transport` has no other
  clock source and no removal plan; `window.sansBass` bridges mutable `app.js` closure state
  that `notes.js`/`separate.js` cannot statically import, and its `playerShell` sub-bridge is a
  harness-only adapter for proving mount cleanup outside audio/song disposal. Calling these
  "temporary" invites a future session to try to delete them. Phase 7 should reword both
  comments to describe them as the documented, permanent exceptions CLAUDE.md's own rule
  allows — not delete anything.

One adjacent **real, pre-existing behavior gap**, not migration debt, found in the same
comment at `app.js:1302-1303`: the Overview lane's range-select caption "is never
retranslated on language switch until the next edit changes it." This predates the React
migration (it is a property of `syncRangeHints()`'s content, not of which layer owns the
host div) and fixing it would mean giving this content its own React-rendered presentation —
a new ownership handoff, out of Phase 7's cleanup-not-handoff scope. **Decision: record this
explicitly as an accepted, pre-existing gap in the exit-gate evidence, not fix it in this
phase.**

### 2. `lib/player-application.js` and `components/*.jsx` — no dead code found

Every exported command, every `publish*/subscribe*/get*Snapshot` triplet
(`transport`, `editHost`, `chord`, `chordHost`, plus the root `subscribe`/`getSnapshot`), and
every attach hook (`attachPrimarySeekCanvas`, `attachLaneCanvas`, `attachLaneExtra`,
`attachOverviewCanvas`, `attachOverviewExtra`) has a live call site in
`components/PlayerShell.jsx` or a production (non-test-only) caller in `separate.js`/
`notes.js` (`registerCleanup`, `currentSongToken`, `isCurrentSongToken`). No component holds
retry/polling scaffolding for a "not ready yet" DOM host beyond the ordinary
optional-chaining `useSyncExternalStore` already needs before `app.js`'s effect creates a
portal host — that guard is required steady-state behavior, not migration debt. No component
touches `window.sansBass` directly; React exclusively uses the ESM facade, matching
CLAUDE.md's claim. Scripted a check of all 84 top-level class selectors in `styles.css`
against every consumer (`app.js`, `notes.js`, `separate.js`, `components/*.jsx`, `demos.jsx`,
`index.html`): every class has at least one live reference, including the capo/chord/edit-host
region. The retired `chordGroup`/`editLabel`/`ioGroup` identifiers survive only inside one
explanatory code comment (`app.js:825,830`) describing history, not as a live selector or
DOM reference.

**Finding: no code removal needed in this scope.**

### 3. `behaviour.md` scenarios vs. accumulated evidence — real acceptance gaps

Every SEP/NOTE evidence entry from Phase 5a onward records real Worker/model checks as "not
re-exercised, matching prior phases' own scoping" — the only real cached-model separation,
real notes-detection Worker, and real AudioWorklet stretched-playback evidence in the whole
log is from **Phase 1**, before any of `SeparationPanel.jsx`/`DetectionPanel.jsx`/
`TempoPanel.jsx`/`EditorPanel.jsx`/capo-chord React ownership existed. Likewise,
`examples/nov_you.zip`'s real-song workflow was last exercised end-to-end around Phase 3e/4a;
every phase from 4b through 6f explicitly scoped it out as an unaffected boundary. No single
pass has chained load → separate → detect → interpret/fold → tempo grid → edit → capo/chord →
export together on the final post-6f UI. Auditory/subjective checks (pitch preservation,
loop-seam quality, note-tone alignment) are "not claimed" at every phase — this is a first
check, not a staleness problem. Physical handheld checks have only ever used the capability
predicate test or a simulated viewport, never a real touch device. Background-tab playback
was last confirmed at Phase 3e, before lanes, separation/detection, and all of notes/tempo/
editor/capo-chord moved to React — audio scheduling ownership itself never moved, so risk is
low, but it predates five phases of DOM changes elsewhere on the same page.

LOAD/MIX/TRN/LOOP/SPD/LANG/BOOT/ANALYTICS are heavily covered by `npm test` and repeated
deployed-smoke passes through Phase 3-4, with each phase's evidence re-confirming the
unaffected-boundary reasoning per `testing.md`'s placement rules; these do not need
re-litigation beyond confirming `npm test` stays green and the routine production canary.

## Scope decision

Phase 7 is bounded to:

1. **Mechanical, safe documentation fixes in the implementation PR** (no behavior change, no
   new tests needed): reword the four comments identified above in `app.js` (lines ~1247,
   ~1297, ~2309, ~3556) to state settled, permanent facts instead of implying open deferrals
   or removability, and add this plan doc. Every prior phase's implementation PR (checked
   against the actual merge commits for 6c–6f) touched only code plus its own plan doc —
   never `CLAUDE.md`, `docs/react-migration.md`, `docs/react-migration-evidence.md`, or
   `docs/devlog.md`. This phase follows that same split rather than the pattern this plan
   originally assumed: those four docs are updated only in the later documentation-anchor PR,
   once the merge SHA and the acceptance evidence below both exist.
2. **No dead-code removal.** The audit found none. This phase does not delete any
   `window.sansBass` member, `sansbass:*` event, DOM builder, or CSS rule — every one is
   live. Stating this explicitly, with the grep evidence above, satisfies the exit gate's
   "no competing legacy/React owner" clause without inventing removal work that would
   regress a real consumer.
3. **Real acceptance checks on the final build** — this is the bulk of the phase's actual
   work, run manually against a local production build and the deployed preview/production
   origins, per `testing.md` layers 5-6 and `behaviour.md`'s deployment-verification table:
   - Full `npm test` and `npm run build` (automated gate, unchanged from every prior phase).
   - A single chained real-song workflow through `examples/nov_you.zip` on the final build:
     load → real in-browser separation with a **cached** model on this desktop → real
     `notes.worker.js` detection on both vocals and bass → interpretation/folding controls →
     tempo grid detection → an edit → a capo change and a chord edit → notation export and
     stem save. This is the first time these are chained together on the post-6f UI.
   - Real AudioWorklet stretched playback (a speed change away from 100%) during that same
     workflow.
   - Background-tab playback: start playback, background the tab, confirm the source still
     reaches end-of-song/loop correctly — re-confirming Phase 3e's finding on the current DOM.
   - Auditory checks: pitch preservation at a stretched speed, the native/stretched loop
     seam, and note-tone alignment against the real song — first-time manual evidence.
   - Physical handheld check: separation gating and the explanatory message on an actual
     touch device if one is reasonably available this session; otherwise record an explicit,
     named skip rather than reusing the simulated-viewport evidence as a substitute.
   - Visual check at desktop and narrow widths, both languages, on the loaded/playing/
     notes-open state.
   - The full two-origin deployed smoke (PR preview and production) per `behaviour.md`'s
     "Full player smoke," since Phase 7 explicitly runs it as release acceptance regardless of
     whether this PR's own diff touches deployment-sensitive files.
   - Compare startup time, shipped JS size, and interaction/drawing responsiveness against the
     Phase 0 baseline recorded in `react-migration-evidence.md`; investigate any regression
     before declaring acceptance, or record it as an explicitly accepted tradeoff.

No failing-first tests are needed for this PR's code changes: the four comment edits change
no behavior, and no dead code is being removed, so there is no removal risk to cover with a
regression test. The acceptance checks above are manual/deployed evidence, not new automated
tests, per `testing.md`'s own placement rules (real-Worker/model checks are explicitly manual/
deployed, not something `npm test` should fake further).

## Implementation increments

1. Reword the four `app.js` comments (no logic change):
   - `attachLaneExtra`/`attachOverviewExtra`: replace "explicitly deferred, same as the rest
     of notes/tempo (Phase 6)" with language stating this is a permanent, settled split
     between React-owned lane presentation and `app.js`-owned notes/tempo feature content —
     Phase 6 completed without moving it, and no further migration of this content is planned.
   - `announceTransport`: replace "Temporary exact-clock adapter" with language stating this
     is a permanent cross-module clock bridge for `notes.js`'s sonifiers, matching
     CLAUDE.md's own description.
   - `window.sansBass` block: replace "Temporary compatibility bridge... Remove each member
     when its named consumer migrates" with language stating this is a permanent, documented
     exception per CLAUDE.md's bridge rule (mutable closure state `notes.js`/`separate.js`
     cannot statically import, plus the harness-only `playerShell` sub-bridge), not scaffolding
     awaiting removal.
2. Run `npm test`, `npm run build`, `git diff --check`.
3. Dispatch a fresh-context reviewer (`superpowers:code-reviewer`) against the diff — small
   and comment-only, but still reviewed like any other change.
4. Open the PR (code plus this plan doc only, matching every prior phase's implementation-PR
   shape), wait for CI, verify the PR preview's `#build-sha` matches the merge-ready SHA,
   then run the acceptance checklist above against that preview (the parts that don't require
   a cached local model — real-song load, playback, notes detection via a real Worker if the
   preview's model cache allows it, background-tab, visual). Run the parts that need this
   desktop's cached separation model and physical-device access locally against
   `npm run build && npm run preview` if the preview origin's cache state makes an uncached
   285 MB download unavoidable there — an uncached download stays an explicitly requested
   check, never routine, per `testing.md`.
5. Merge, then verify production: workflow conclusion, `#build-sha`, boot without console
   errors, and confirm the full smoke evidence collected against the preview still holds
   (re-run only the affected-route canary at the production root, not the entire workflow
   twice, per `behaviour.md`'s tiered policy — Phase 7's own full-smoke requirement is
   satisfied by running it once across preview+production together where the same evidence
   applies to both, and again wherever the origin itself could plausibly differ).
6. Record all evidence — automated, local build, deployed preview, deployed production,
   manual/auditory/handheld, with explicit skips named — in `react-migration-evidence.md`
   under a new "Phase 7" section, then open the separate documentation-anchor PR that adds
   this evidence section, updates `CLAUDE.md`'s Phase 7 status and ownership-map closing
   state, adds a `docs/devlog.md` entry, and updates `docs/react-migration.md`'s Phase 7
   status/tracking-table row and rollback-anchor table with the merge SHA — matching every
   prior phase's two-PR pattern exactly (verified against the 6c–6f merge commits: the
   implementation PR never touches these four files; only the anchor PR does).

## Preservation rules

| Concern | Required behavior |
|---|---|
| No ownership change | Every DOM region keeps its current owner (React or `app.js`) exactly as CLAUDE.md's map describes; this phase changes documentation and comments, not who renders or writes what. |
| No behavior change | The four reworded comments and the CLAUDE.md/migration-doc updates must not alter any runtime code path. `npm test` results must be identical to Phase 6f's. |
| Bridges stay intact | `window.sansBass`'s members, `sansbass:transport`, and every other named-consumer adapter identified as live remain exactly as they are; Phase 7 does not attempt to eliminate them. |
| Accepted gaps stay visible | The Overview-lane range-caption translation gap is documented as an explicit, accepted tradeoff, not silently dropped or silently fixed. |
| Evidence is separated by kind | Automated, local-build, deployed-preview, deployed-production, and manual/auditory/handheld evidence are recorded separately, with explicit skips named, matching `testing.md`'s rule against collapsing these into "all tests passed." |

## Out of scope

Any new ownership handoff, any DOM restructuring, any behavior fix beyond the documentation
corrections above (including the Overview-lane translation gap, explicitly deferred as an
accepted tradeoff rather than fixed here), TypeScript conversion, new dependencies, or design
changes. An uncached model download remains an explicitly requested check only, not a routine
dependency of this phase's acceptance pass. Completing this phase closes the React migration
roadmap in `docs/react-migration.md`; any future component work follows the documented
architecture rather than a new phase of this migration.
