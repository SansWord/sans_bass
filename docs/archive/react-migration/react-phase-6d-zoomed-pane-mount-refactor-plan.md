# React migration Phase 6d — zoomed-pane mount-lifecycle refactor plan

Status: planned from `4fddb9d6c6551288be1e62d6ac035fb0815cf93a` (documentation-anchor merge
for Phase 6c, PR #92) on 2026-09-07. Previous accepted implementation rollback anchor:
Phase 6c at `2aa9cdcf07f8ed5cb1d04119b93f2a55a121bafe`, documented through
[PR #91](https://github.com/SansWord/sans_bass/pull/91) and anchored through
[PR #92](https://github.com/SansWord/sans_bass/pull/92).

This is the first half of Phase 6's last sub-slice (the capo control, the zoomed pane's chord
display/editing, the Edit-notes toggle, and the shared Export/Import edits JSON buttons — the
still-unscheduled future sub-slice named in `docs/react-migration.md` and in
[the Phase 6b plan](react-phase-6b-tempo-chord-controls-plan.md) and
[the Phase 6c plan](react-phase-6c-editor-export-controls-plan.md)). Those two plans both found
the same root cause blocking all four controls: the zoomed pane's outer DOM container has no
identity that survives a song load, unlike every other lane after Phase 4b extracted the
Overview lane out of the same per-song rebuild. This plan's own audit (below) confirms that
finding and designs the fix, but concludes the fix does not fit in the same bounded increment as
the ownership handoff itself — see "Scope decision" below. **This PR performs the mount-lifecycle
restructuring only, with zero ownership change**: every control named above stays 100%
`app.js`-owned, pixel-for-pixel and behaviorally identical, verified by the existing test suite
staying green with no new product-facing assertions required. The ownership handoff itself is
[Phase 6e](react-phase-6e-capo-chord-edit-export-plan.md), which depends on this PR.

## Audit — current ownership and lifecycle

| Region | Owner today | Varies per song? | Torn down per song? |
|---|---|---|---|
| `zLane`/`zName`/`zTopRow` (zoom label, seconds readout, zoom ±, ½/¼ sub-beat toggles) | `app.js` `buildUI()` | Sub-beat button `active` class reflects a UI preference (`showHalfBeat`/`showQuarterBeat`), not song state; the rest is static markup. | Yes — recreated from scratch every `buildUI()` call, inside `if (anchorTrack)`, itself inside `el.noteLanesRoot.innerHTML = ''`. |
| `zCanvas`, `attachZoom(zCanvas)`, `attachResize(zGrip, …)` | `app.js` | No — painting reads live module state (`tracks`, `zoomNotesStem`, `editMode`, …) at call/event time, not anything captured when the canvas was created. | Yes, same as above. Re-registering `attachZoom`'s wheel/pointerdown listeners on a *new* canvas node every song is harmless today only because the old node (and its listeners) is discarded with it. |
| `zToolbar`/`zFields` (edit toolbar buttons, inline Start/End/Pitch fields) | `app.js` | No — `disabled`/`hidden` driven by `editMode`/selection state, read from module scope. | Yes, same as above. |
| `zRangeHint` | `app.js` | No — visibility from `editMode`/`zoomNotesStem`, computed by `syncRangeHints()`. | Yes, same as above. |
| `zLaneSel`'s stem chips (`zoomChipEls`) and Notes chips (`zoomNotesChipEls`) | `app.js` | **Yes** — one chip per stem actually present in `tracks` (and, for Notes chips, per stem with a note lane) — genuinely different content across songs with different stem sets. | Yes, same as above (and correctly must keep being rebuilt — this is real per-song content, not a lifecycle artifact). |
| Edit-notes toggle (`editToggleEl`/`editToggleLabelEl`), shared Export/Import buttons (`editIoGroupEl`/`editIoExportBtnEl`/`editIoImportBtnEl`/`editIoImportFileEl`) | `app.js`, appended into `zLaneSel` after the chip loops | No — static controls; only `hidden`/`disabled`/`checked` state (driven by `syncNotesChipsVisibility()`/`syncEditToggle()`, called from `setNotes()` once a channel's notes arrive) varies, never their existence or position. | Yes, same as above — the actual finding from the 6b/6c audits: these nodes, and the module-level references to them, are explicitly re-nulled at the top of every `buildUI()` call (`app.js` lines 628–633). |
| Capo control (`capoCaption`/`capoSelect`), chord editor (`chordGroup`/`chordEditor`) | `app.js`, appended into `zName` before `zLaneSel` | No — static controls; `capoSelect`'s value is user-set per session, reset to `0` only via the module-level `capo` variable's reset (which does not itself touch the DOM `.value`); chord field content is driven every `draw()` (rAF) tick by `syncChordEditor(t)`, reading `chordTimeline` (reset to `[]` at song load). | Yes, same as above — the 6b audit's finding. |

### The persistence-across-song-load problem, confirmed

This is exactly Phase 4b's finding, reproduced for a much larger subtree. Standard lanes get
away with full rebuild because nothing in the current suite exercises same-stem-across-
replacement identity for them (an accepted latent gap, untouched here). The Overview lane could
not get away with it — being a single, unkeyed region present whenever a vocals/bass stem
exists at all — and neither can the zoomed pane, for the identical reason: `anchorTrack` is
the exact same gate `overviewEl` used, so a song replacement that keeps a vocals/bass stem
should, in principle, keep showing the *same* zoomed-pane DOM subtree, not a freshly-built one.
Today it does not, because `el.noteLanesRoot.innerHTML = ''` (needed to correctly discard and
rebuild the *ribbon* lanes, which are genuinely per-stem and out of scope here) also destroys
the zoomed pane as a side effect of sharing one parent.

Two things must both be true before capo/chord/Edit-toggle/Export-Import can safely become
React children of a stable host:

1. The zoomed pane's outer container must be built once and reused across a song replacement
   that keeps `anchorTrack`, mirroring `overviewEl`'s "owned by attach/detach lifecycle, not
   reset at the top of `buildUI()`" fix.
2. Everything that is genuinely per-song (the stem/Notes chip lists) must still be correctly
   rebuilt on reuse — persistence must not freeze stale content — and everything that is
   session-level UI state but not song state (sub-beat toggle `active` class, the currently
   selected zoom lane) must not be reset just because a new song loaded, matching what already
   happens today by accident (nothing in the old code ever reset `showHalfBeat`/`showQuarterBeat`
   themselves — only their *DOM* representation was rebuilt from the same variables).

### Two additional lifecycle hazards found by this audit (beyond Phase 4b's shape)

Phase 4b's Overview lane was simple enough (label, canvas, slider, range hint) that reuse
needed no special-casing beyond "don't null the canvas reference." The zoomed pane's much larger
surface has two hazards Overview did not:

- **Listener duplication.** `attachZoom(zCanvas)` and `attachResize(zGrip, …)` register
  `addEventListener` calls directly on the canvas/grip nodes. Today this is silently safe only
  because a *new* node is created (and the old one, with its listeners, is discarded) every
  song. Once the node persists across song loads, calling these attach functions again on
  the *same* node on a second song would stack a second set of listeners, double-firing wheel
  zoom, drag-resize, and pointer-driven note editing. **Fix: call each attach function exactly
  once, at first construction, never again on reuse.**
- **Stale visibility state.** `editToggleLabelEl.hidden`, `editIoGroupEl.hidden`,
  `editToggleEl.disabled`/`.checked`, and `capoSelect.value` are set correctly only at
  *construction* time today (`hidden = true`, `disabled = true`, fresh `<select>` defaulting to
  its first `<option value="0">`). Once construction happens once and the nodes are reused, a
  second song must not inherit whatever visibility/value the *previous* song's detection run
  left behind — e.g. a completed detection on song A would leave `editToggleLabelEl.hidden =
  false` from `syncNotesChipsVisibility()`; without an explicit reset, song B's zoomed pane
  would show the Edit toggle for an instant (or longer, if song B never calls "Find notes")
  before any detection event fires again. **Fix: explicitly call `syncNotesChipsVisibility()`,
  `syncZoomChips()`, and `syncEditToggle()` at the end of every `buildUI()` call when reusing an
  existing pane (they already read from the freshly-reset `noteLanes`/`zoomNotesStem`, so calling
  them forces the correct "nothing ready yet" state), and explicitly reset `capoSelect.value =
  '0'` to match the already-reset `capo` module variable.** (`chordGroup`'s own visibility
  needs no equivalent explicit reset — it is already recomputed every `draw()` tick via
  `syncChordEditor()`, which reads `chordTimeline`/`chordDetectionPhase`, both already reset to
  their song-load defaults before the first frame renders — this is unchanged by this PR.)

## Scope decision: a pure-refactor PR, separate from the ownership handoff

The task audit asked whether this restructuring is small enough to land in the same PR as the
four controls' React ownership, or needs its own bounded PR first. It needs its own PR, for the
same reasons the increment-boundary rule in `docs/react-migration.md` has held for every prior
Phase 6 sub-slice ("do not bundle this phase into one rewrite PR"), applied to a larger and
riskier change than any of them:

- The restructuring touches roughly 200 lines of `buildUI()` (the entire `if (anchorTrack)`
  block) plus two new lifecycle hazards (listener duplication, stale visibility) that have no
  analogue in Phase 4b's much smaller Overview extraction — this is a materially bigger, riskier
  change than "add two attach methods," and deserves to be verified in isolation against the
  *existing* behavior (capo, chord editing, tempo, tempo-range drag, edit toolbar, notes chips,
  ribbon toggling — none of which change meaning, all of which must keep passing unmodified)
  before any new React ownership is layered on top of it.
- Bundling the two would make a regression in either half harder to isolate: if a capo/chord test
  failed after a combined PR, the cause could be either "the DOM no longer gets torn down
  correctly" or "the new React component reads the wrong published field" — two independently
  falsifiable claims that a split into two PRs keeps independently falsifiable too.
- This shape — a bounded, ownership-neutral structural PR whose only job is to make a later
  ownership PR *possible* — has no direct precedent in this migration (every prior slice moved
  ownership and restructured lifecycle in the same PR, because every prior region was small
  enough that "restructure" and "hand to React" were the same-sized change), but it is the
  natural continuation of the same reasoning: Phase 4b already established that mount lifecycle
  must be fixed before ownership moves for an unkeyed, anchor-gated region; this plan applies
  that fix to a bigger region, first, on its own.

**Consequence for `docs/react-migration.md`:** the still-unscheduled future sub-slice becomes two
ordered, now-scheduled sub-slices — 6d (this plan, pure refactor) and
[6e](react-phase-6e-capo-chord-edit-export-plan.md) (the actual ownership handoff) — in the
documentation-anchor PR that follows 6e's implementation PR, matching the exact split every prior
sub-slice's own doc updates have used (updated once, after production deployment is verified, not
in either implementation PR itself).

## Bounded outcome (Phase 6d)

- `index.html` gains a new sibling root `<div id="zoom-lane-root"></div>` inside `#lanes`,
  alongside `#standard-lanes-root`, `#overview-lane-root`, and `#note-lanes-root` — `display:
  contents` like the other three, so `order: -1` (unchanged) keeps pinning it above every
  ribbon/standard lane. Separating it from `#note-lanes-root` is what lets `el.noteLanesRoot.
  innerHTML = ''` keep correctly tearing down only the genuinely-per-song ribbon lanes, without
  taking the now-persistent zoomed pane down with it — the same reasoning Phase 4b gave for
  giving the Overview lane its own root rather than sharing `#standard-lanes-root`.
- `app.js` gains `el.zoomLaneRoot = $('zoom-lane-root')` and restructures the `if (anchorTrack)`
  block into two paths:
  - **First time** (`zoomEl` is `null`, i.e. no vocals/bass stem has existed since the app
    started or since the pane was last torn down): build `zLane` and everything inside it exactly
    as today, appended into `el.zoomLaneRoot` instead of `el.noteLanesRoot`; call
    `attachZoom(zCanvas)` and `attachResize(zGrip, …)` exactly here.
  - **Reuse** (`zoomEl` already holds a pane still attached under `el.zoomLaneRoot`): keep the
    existing `zLane`/`zName`/`zTopRow`/`zCanvas`/`zRangeHint`/`zToolbar`/`zFields`/`chordGroup`/
    `zLaneSel` nodes and the `zoomEl`/`chordEditor`/`zoomToolbar`/`halfBeatBtn`/`quarterBeatBtn`
    references to them; do not call `attachZoom`/`attachResize` again; clear and rebuild only the
    stem-chip and Notes-chip children inside `zLaneSel` (now nested inside a dedicated
    `zChipHost` span so this clearing cannot reach `editToggleLabelEl`/`editIoGroupEl`, which are
    permanent siblings of `zChipHost` appended once, at first construction, after it); reset
    `capoSelect.value = '0'`.
  - **Teardown** (a song replacement removes the last vocals/bass stem, `anchorTrack` becomes
    falsy where it previously was not): remove `zLane` from `el.zoomLaneRoot`, null out
    `zoomEl`/`chordEditor`/`zoomToolbar`/`halfBeatBtn`/`quarterBeatBtn`/`zoomChipEls`/
    `zoomNotesChipEls`, matching today's "no anchor → no zoomed pane" state exactly (this path
    already exists today as a side effect of `innerHTML = ''` plus the `if (anchorTrack)` guard
    simply not running; it becomes an explicit branch once the pane can otherwise persist).
  - In both the first-time and reuse paths (whenever `anchorTrack` exists), call
    `syncNotesChipsVisibility(); syncZoomChips(); syncEditToggle();` at the very end of
    `buildUI()` (after `noteLanes`/`zoomNotesStem` have already been reset earlier in the same
    call) — this is new; today construction alone gave the correct initial state, but reuse does
    not.
- `notes.js`, `separate.js`, `components/*.jsx`, `lib/player-application.js`: **zero changes.**
  This PR never changes what any published snapshot contains or what any command does — only
  where and how `app.js` builds and reuses its own legacy DOM.
- No `styles.css` changes: `#zoom-lane-root` needs exactly the same one-line `display: contents`
  rule the other three roots already share; no new selector targets any node that changed
  identity, since every class name and id inside the pane is unchanged.

## Preservation rules

| Concern | Required behavior |
|---|---|
| Visual appearance and position | Pixel-for-pixel identical — same classes, same ids, same DOM nesting inside the pane, same `order: -1` pinning above ribbon/standard lanes. |
| Capo, chord editing, tempo/BPM readout, edit toolbar, inline fields, zoom/pan, sub-beat toggles, stem/Notes chips, Edit-notes toggle, Export/Import buttons | Behaviorally identical to today for every existing scenario (NOTE, EDIT, EXPORT, LOOP, SPD, LANG) — this PR changes no product-facing behavior, only DOM lifecycle. |
| Song replacement keeping a vocals/bass stem | The zoomed pane's outer node (`zLane`) and, specifically, `chordGroup`, `capoSelect`, `editToggleEl`, `editToggleLabelEl`, `editIoGroupEl` **keep the same DOM node identity** across the replacement — the new guarantee this PR adds, verified directly (`===` checks), mirroring Phase 4b's `canvas.__layers` identity proof for the Overview lane. |
| Song replacement removing the last vocals/bass stem | The zoomed pane unmounts cleanly (removed from `el.zoomLaneRoot`, module-level references nulled) exactly as today; a later replacement that reintroduces a vocals/bass stem mounts a fresh pane, indistinguishable from a first load. |
| Chip lists | Stem chips and Notes chips are rebuilt to exactly match the new song's `tracks`/`noteLanes`, discarding the previous song's chip elements — proven by chip count/labels differing correctly across a replacement with a different stem set. |
| Listener duplication | `attachZoom`/`attachResize`'s event listeners fire exactly once per user gesture after two or more song loads that keep the pane alive — proven by a wheel-zoom (or drag-resize) assertion after a second `loadZip`. |
| Stale visibility | A second song that has not yet run "Find notes" shows the Edit-notes toggle and Export/Import buttons hidden/disabled exactly as a first song would, even though the *first* song's detection had completed and left them visible/enabled — proven directly. |
| Capo value | `capoSelect.value` reads back `'0'` immediately after a song replacement, before any user interaction, even if the previous song had a nonzero capo selected. |
| Remount | Shell unmount/remount (a `PlayerShell.jsx` remount, unrelated to song load) does not affect any of the above — this PR touches no React code and no React-owned region. |

## Failing-first and implementation increments

1. Extend the focused production-entry Chromium suite (`tests/player.test.js`) with cases run
   against the **current legacy behavior** first (expected to fail before this refactor, since
   today's implementation always recreates the nodes):
   - `.zoom-chord-row`, `.capo-select`, `#notes-edit`, and the Export/Import buttons' parent
     (`.zoom-edit-io`) keep the same DOM node identity across a `loadZip` replacement that keeps
     a vocals/bass stem (capture references before, reload, compare `===` after).
   - After a completed detection run makes the Edit-notes toggle and Export/Import group visible,
     a song replacement (with a fresh channel that has not yet run detection) hides them again
     immediately, and `capoSelect.value` reads back `'0'`.
   - Two `loadZip` calls in a row, each followed by one shift+wheel event on the zoom canvas,
     each move `zoomSeconds` by exactly one zoom-factor step (not two), proving `attachZoom` was
     not re-registered on the second load.
   - Stem/Notes chip content (labels/count) matches the new song's stems after a replacement that
     changes which stems are present (e.g. vocals+bass → vocals+drums).
   - The full existing capo/chord/edit-toggle/tempo/toolbar test suite continues to pass
     unmodified — this is the regression net proving no ownership or behavior changed, not new
     coverage.
2. Add `#zoom-lane-root` to `index.html`; add `.react-portal-host`-style (but not yet React-owned)
   `display: contents` rule reuse for it in `styles.css` (it can share the existing selector list
   with the other three roots, since the rule itself only ever said "children are the real flex
   items," which is equally true for a legacy-owned root).
3. Refactor `app.js`'s `buildUI()`: add `el.zoomLaneRoot`; split the `if (anchorTrack)` block into
   first-time-construction, reuse, and teardown paths as described above; introduce the
   `zChipHost` span inside `zLaneSel`; move `editToggleLabelEl`/`editIoGroupEl`'s construction to
   run only in the first-time path, appended as permanent siblings of `zChipHost`; add the
   end-of-`buildUI()` `syncNotesChipsVisibility()`/`syncZoomChips()`/`syncEditToggle()` calls and
   the `capoSelect.value = '0'` reset.
4. Run focused tests, then `npm test`, `npm run build`, `git diff --check`, and an exact-source
   local production smoke at root and a nested route: load a song with a vocals/bass stem, run a
   fake detection to completion, replace with a second song keeping the anchor stem (verify node
   identity and reset visibility), then replace with a song that drops the anchor stem entirely
   and reintroduce it (verify clean teardown/remount) — before opening the PR.

## Out of scope

Giving React ownership of the capo control, the chord editor, the Edit-notes toggle, or the
Export/Import buttons — that is [Phase 6e](react-phase-6e-capo-chord-edit-export-plan.md),
which this PR unblocks but does not perform. The ribbon lanes, the standard lanes, the Overview
lane, tempo/grid, detection/interpretation/edit-list controls, and every other already-accepted
React-owned region stay untouched. No product-facing behavior changes in this PR; if reviewers
observe any visible difference, that is a defect in this refactor, not an intended change.
