# Post-migration cleanup — Implementation Plan

> **Execution note:** Start in a fresh session by reading `CLAUDE.md` and this plan in full.
> Create a dedicated branch before editing (e.g. `refactor/post-migration-cleanup` — this
> plan touches both code and docs, so a `docs/` or `refactor/` prefix both fit; pick one and
> keep the PR scoped to what's in this plan).

**Goal:** The incremental React migration (Phases 1–7) is complete and accepted. Two
independent cleanups follow from a comparative code-quality review of `main` vs.
`before_react_migration` conducted 2026-09-07 (no separate spec doc — this plan is the
record of that review's conclusions):

1. Remove the one real code defect the review found: duplicated pub/sub boilerplate in
   `lib/player-application.js`.
2. Restructure how the repo's own documentation talks about the migration, so a new session
   reads a description of the *current* architecture, not an incremental history it has to
   reconstruct — and so future work stops being expected to justify itself against the old
   imperative approach.

**Context from the review** (for whoever executes this — you don't need to re-run it):
- The "13K+ lines" diff between the two branches is misleading: ~7,546 lines were phase-plan/
  evidence docs and ~2,487 were tests. Real code delta was +2,851/−1,422 (net +1,429).
- The code itself came out ahead: `app.js`'s `buildUI()` shrank 671→484 lines, the new
  `lib/player-application.js` facade is sound (validates commands, dedupes publications,
  never holds a second copy of state), and the CLAUDE.md claim that Phase 7 left no
  removable scaffolding checked out under independent grep (zero stray `window.SansX`
  globals; every `window.sansBass`/`sansbass:*` call site still live).
- The one defect: `lib/player-application.js` reimplements the same Set-based subscribe/
  notify pattern five times nearly verbatim (`subscribe`, `subscribeTransport`,
  `subscribeChord`, `subscribeEditHost`, `subscribeChordHost`).
- The real cost wasn't the code — it was documentation volume: 17 `docs/react-phase-*-plan.md`
  files plus a 3,045-line `docs/react-migration-evidence.md`, and a phase-by-phase narrative
  baked into `CLAUDE.md` itself, for a single-page app's migration.

## Global constraints

- Migration is considered done. Do not reopen scope on the React ownership boundaries
  themselves — this plan only touches (a) one internal implementation detail of
  `lib/player-application.js`, and (b) documentation organization. No behavior change.
- Preserve the historical record. Archive the phase-plan docs; do not delete them.
- Keep `npm test` and `npm run build` green throughout; commit at natural checkpoints
  (end of each task below).
- Branch first, land via PR, per this repo's standing convention (see `CLAUDE.md`'s
  Working Conventions).
- After this lands: `CLAUDE.md`'s React section is the steady-state description of
  ownership. New work describes itself in current terms — see Task 4.

## Task 1: Factor the duplicated pub/sub pattern in `lib/player-application.js`

**Files:** `lib/player-application.js`, `tests/player-application.test.js`

- [ ] Extract a small `makeChannel()` factory — subscribe/publish over a `Set` of listener
  functions, returning an unsubscribe function from `subscribe`.
- [ ] Use it for all five channels: the general `subscribe`, `subscribeTransport`,
  `subscribeChord`, `subscribeEditHost`, `subscribeChordHost`.
- [ ] Keep each channel's own dedup logic (`sameTransport`, `sameChord`, etc.) as a thin
  wrapper that only calls the channel's `publish` when the value actually changed — don't
  fold dedup into the factory itself, since not every channel needs it (host channels don't).
- [ ] This is a pure refactor with no behavior change: existing tests in
  `tests/player-application.test.js` and the facade-touching parts of `tests/player.test.js`
  should pass unmodified. If a test reaches into the module's internal shape, update it, but
  no assertion about published values or command behavior should need to change.
- [ ] Run `npm test` and `npm run build`.

## Task 2: Rewrite `CLAUDE.md`'s React sections to describe steady state, not phase history

**Files:** `CLAUDE.md` (project root)

- [ ] Replace the "Phase 1 adds X... Phase 3a adds Y, unlike Z..." narrative in the "Hard
  constraints" bullet and "Repo layout" section with a flat, current-state description:
  what React owns (`components/*.jsx` — headers, player shell/controls, per-lane UI,
  separation panel, notes detection/interpretation/tempo/editor panels, capo/chord editing),
  what `app.js` owns (audio scheduling, transport, canvas painting), and what
  `lib/player-application.js` is (the DOM-independent command/snapshot boundary between
  them).
- [ ] Preserve substantive facts currently buried in the phase narrative that are still
  load-bearing today — e.g. which DOM ids are portal hosts, the `notes.js` import-graph/
  `window.sansBass`-ordering hazard, the reverse-direction attach hooks (`publishEditHost`,
  `publishChordHost`) where `app.js` hands React a node instead of the other way around.
  State these as current facts, not as "Phase 5a discovered...".
- [ ] Don't delete the narrative — move the full phase-by-phase history to a new
  `docs/react-migration-history.md` and link to it from `CLAUDE.md` for anyone who wants the
  archaeology.
- [ ] Re-read the trimmed `CLAUDE.md` as if onboarding fresh into this repo for the first
  time. Confirm nothing a new session actually needs (current ownership boundaries, the
  still-live gotchas) was lost in the move — only the incremental justification narrative
  should be gone from the main file.

## Task 3: Archive the phase-plan docs and evidence doc

**Files:** `docs/react-phase-*-plan.md` (17 files), `docs/react-migration-evidence.md`,
`docs/react-migration-history.md` (from Task 2)

- [ ] Create `docs/archive/react-migration/` and move all `docs/react-phase-*-plan.md` files
  and `docs/react-migration-evidence.md` into it, unchanged.
- [ ] Grep the repo (`docs/`, `CLAUDE.md`, `README.md`) for `react-phase-` and
  `react-migration-evidence` references and update the paths of any that remain relevant
  (e.g. links from `docs/devlog.md`'s Design docs subsections, if any point at these files).
- [ ] Add a short header note at the top of `docs/react-migration-history.md` (or a small
  `docs/archive/react-migration/README.md`) stating these are historical planning artifacts
  from the completed migration, kept for reference, not current specs or open work.

## Task 4: Add a Working Conventions note against re-litigating the migration

**Files:** `CLAUDE.md` (Working Conventions section)

- [ ] Add one line: future architecture/behavior documentation and PR descriptions describe
  the current design on its own terms. They should not compare new work against the
  pre-React/imperative approach unless a specific regression is suspected — that comparison
  was the job of the 2026-09-07 review, not a standing obligation for every future change.

## Task 5: Devlog entry

**Files:** `docs/devlog.md`

- [ ] Add an entry for this cleanup using the next sequential version number.
- [ ] Before picking that number: check whether the React migration phases themselves
  (Phases 1–7, e.g. commits `abcc94e`, `c833b7e`, `2d641a9`) already have devlog entries.
  The devlog's TL;DR table currently tops out at `v1.34.0` (2026-09-05), which predates the
  migration commits — if there's a real gap, flag it to the user rather than silently
  backfilling seven phases of history in this same session. That backfill, if wanted, is a
  separate, larger task from this cleanup.
- [ ] Tag learnings appropriately — e.g. `[insight]` for "a migration's own phase-by-phase
  documentation can outweigh its code by 5:1 and become a maintenance cost in its own right,"
  `[gotcha]` if the devlog-gap check in the previous bullet turns up something surprising.
- [ ] Update the TL;DR table with the new entry's anchor link.
