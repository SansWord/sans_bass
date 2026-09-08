# React migration Phase 6c — edit list, undo, and list-export controls plan

Status: planned from `a0717e4907c5af6a20d0afae2c837a2953f791a5` (documentation-anchor merge
for Phase 6b, PR #90) on 2026-09-07. Previous accepted implementation rollback anchor:
Phase 6b at `65a8ae67b2be5c4193aaa803256b54dcdaadfaf5`, documented through
[PR #89](https://github.com/SansWord/sans_bass/pull/89) and anchored through
[PR #90](https://github.com/SansWord/sans_bass/pull/90).

This is the last of Phase 6's sub-slices as tracked in `docs/react-migration.md` (now four in
practice after 6b's own revision: 6a interpretation/key/display, accepted; 6b tempo/grid,
accepted; an unscheduled capo/chord sub-slice; then this one). The phase-overview line reads
"selection/edit/undo/import/export controls," but — following exactly the kind of audit that
narrowed 6b's own scope — this slice's actual bounded outcome is narrower still: **the edit
list and the list-export row only**. See "Scope decision: the Edit-notes toggle and the shared
Export/Import edits JSON buttons stay legacy-owned this slice" below for why, and "Scope
decision: selection and note editing itself were never in scope" for why "selection" in the
phase title was already accounted for by standing architecture rules, not a new finding.

## Audit — current ownership

| Region / behavior | Owner today | Notes |
|---|---|---|
| Edit list (`#notes-edits-{stem}`: summary count, Undo button, `<ol>` of edit-group rows with an orphan warning and a remove button) | `els.editsRow`/`els.editsSummary`/`els.editUndo`/`els.editRows` (module-level DOM lookups in `notes.js`, built once from static `index.html` markup), written by `renderEditList()`, the Undo button's own `click` listener, and a per-row remove-button `click` listener created fresh on every render. | A `<details id="notes-edits-{stem}" class="notes-edit-list" hidden>` sitting **inside** the still-legacy `<section id="notes-{stem}">` (`index.html` lines 108–115/133–140), beside the now-React-owned meta row (`#notes-meta-{stem}-root`, Phase 5b) and tune row (`#notes-tune-{stem}-root`, Phase 6a) — the exact same static, never-rebuilt-by-`buildUI()` section those two used, not the per-song-rebuilt zoomed pane. Safe to portal in one piece, matching Phase 6a's nested-portal-inside-still-legacy-section shape exactly (not Phase 5b/6b's whole-section-replacement shape, since `<section id="notes-{stem}">` itself stays legacy-owned). |
| List-export row (`#notes-list-io-{stem}`: "Bars per line" number input, "Export list" button) | `els.listBars`/`els.listExport`, read directly at click time; `els.listExport.disabled` written by `syncExportAvailability()`. | A `<div id="notes-list-io-{stem}" class="notes-row">`, a sibling of the edit list inside the same static section. Same shape as the edit list above — safe to portal in one piece. |
| Edit-notes toggle (`#notes-edit`, the one shared global checkbox) and the shared Export/Import-edits-JSON buttons (`exportBtn`/`importBtn`/`importFile`, no persisted ids — plain elements) | Built by `app.js`'s `buildUI()` inside the zoomed pane's per-song construction, appended into `zLaneSel` (`app.js` lines ~845–897), beside the two Notes chips. `notes.js` only listens for the `sansbass:editmode`/`sansbass:noteedit`/`sansbass:editundo`/`sansbass:exportedits`/`sansbass:importedits` events these dispatch; it owns no DOM here. | See "Scope decision" below — entangled with the same per-song-rebuilt zoomed-pane container Phase 6b found for the capo/chord row, for the same reason. |
| Selection, note add/delete/move/resize/repitch/nudge/snap, range vs. note selection (pointer/keyboard on the zoomed-pane canvas and the toolbar it drives) | `app.js`: `attachSeek`'s pointer handlers, the edit toolbar's button handlers, and keyboard shortcuts, all dispatching `sansbass:noteedit`/`sansbass:editundo`/`sansbass:editmode` for `notes.js` to act on. | Out of scope — canvas pointer/keyboard ownership stays with the imperative renderer per the standing Phase 4/6 architecture rule, independent of this slice's own audit. See "Scope decision" below for why this was never an open question the way capo/chord and Export/Import were. |
| Ribbon/zoomed-pane note-lane rendering itself (canvases, zoom pan/lane-selection chips, edit-mode toggle's rendering surface) | `app.js`, `#note-lanes-root` (still legacy per `CLAUDE.md`). | Out of scope by the task's own instruction; untouched. |
| Capo control, chord display/editing | `app.js`'s `buildUI()`/`syncChordEditor()`. | Already deferred by Phase 6b — untouched here. |
| Tempo grid (`#notes-tempo`) | `components/TempoPanel.jsx` (Phase 6b, accepted). | Untouched. |

### Scope decision: the Edit-notes toggle and the shared Export/Import edits JSON buttons stay legacy-owned this slice

The task's audit instructions asked whether "selection/edit/undo/import/export controls" is
one cleanly separable region, the way 6b had to ask the same question about "tempo/grid/capo/
chord controls." It is not, for the same root cause 6b found, applied to a different pair of
controls:

`app.js`'s `buildUI()` builds the Edit-notes toggle (`editToggleEl`/`editToggleLabelEl`) and
the Export/Import-edits-JSON buttons (`editIoGroupEl`/`editIoExportBtnEl`/`editIoImportBtnEl`)
as children of `zLaneSel`, itself a child of `zName`, itself part of the zoomed pane's per-song
construction — the same `el.noteLanesRoot.innerHTML = ''` teardown-and-rebuild Phase 6b's plan
documented for the chord/capo row (`app.js` around line 604, `if (anchorTrack) { … }`). Every
module-level reference to these elements (`editToggleEl = null`, etc.) is explicitly re-nulled
at the top of that same per-song rebuild (`app.js` lines 628–633), confirming the container
does not survive a song load, exactly like `chordGroup` did not.

Unlike the capo/chord row, these two controls are **not** rewritten on every rAF-painted frame
— `syncZoomChips()`, the function that updates their `hidden`/`disabled` state, is called only
from discrete events (a song load, a lane toggle, a note-count change, switching which channel
the zoomed pane shows — `app.js` lines 970, 1190, 2482, 2508, 2597, 2959, 2985), never from
`draw()`'s rAF loop. So only one of 6b's two compounding reasons applies here, not both. But
that one reason is independently disqualifying on its own, for the same reason 6b gave for why
the capo control specifically (not just the chord row) could not move alone: **moving either
control to a separately-hosted, always-mounted React root would relocate a control that is
visually and functionally part of one row (beside the two Notes chips, inside `zLaneSel`) to a
different DOM position** — the migration rules forbid changing appearance, and there is no
stable child slot to portal into inside a container that gets destroyed and rebuilt every song.
Giving them a stable host requires exactly the same "restructure the zoomed pane's mount
lifecycle so its outer shell survives a song load, the way Phase 4b extracted the Overview lane
out of the per-song rebuild" work 6b already identified and deferred — performing that
restructuring is itself "ribbon/zoomed-pane note-lane rendering," out of this slice's scope,
and the dependency runs the same direction 6b found: the restructuring must happen first.

**Consequence for `docs/react-migration.md`:** the still-unscheduled future sub-slice 6b
deferred (currently described as "capo/chord") is broadened in the documentation-anchor PR that
follows this implementation PR to also name the Edit-notes toggle and the shared Export/Import
edits JSON buttons, rather than opening a second, separately-tracked deferred item for the same
root cause. All four controls become tractable together once that one zoomed-pane
mount-lifecycle restructuring happens, and not before.

### Scope decision: selection and note editing itself were never in scope

Unlike the two decisions above, this one is not a new audit finding — it restates why
"selection" in the phase-overview line was never an open question for this slice's audit to
resolve. Clicking, dragging, resizing, and keyboard-driven note edits are pointer/keyboard
interaction on the zoomed-pane canvas, which `docs/react-migration.md`'s Phase 4 exit gate and
architecture rules already assign to the imperative renderer for every phase, not something
this slice's audit could reassign by finding it "separable." The edit *list* — the record of
what was done, exposed for review/undo/removal — is presentation fed by that interaction, and
is the part this slice actually moves.

### Scope decision: extend `detection`'s existing channel view, no new store

Following Phase 6a's own reasoning for the same question (interpretation controls vs. a new
store): the edit list and list-export state (`editGroups`, `orphaned`, `nextEditId`, and the
list-export button's enabled state) live in the exact same `createNotesChannel()` closure as
the already-React-owned meta/tune rows, are recomputed by the same `reinterpret()` call, and
are gated on the same `!!frames` fact (edits are meaningless before a channel has notes).
Extending `detection`'s existing per-channel `view()` keeps one `useSyncExternalStore`
subscription per channel and one `listeners`/`lastView` pair, rather than adding a second store
for state with no independent lifecycle from what `detection` already tracks — the same
"reuse the established pattern" reasoning 6a and 6b's own decisions both cite.

The published channel view grows one array field (`editGroups`, one descriptor per edit group:
`{ id, orphaned, labelKey, timeLabel }`) alongside the existing flat scalar fields. This is a
genuinely list-shaped fact, not a scalar an unnecessary sub-object would wrap — different from
6a's "flat, not nested" guidance, which was about not wrapping *scalars* unnecessarily. The
list-export button's `disabled` state needs no new field: it is `!view.count`, and `count` is
already published (Phase 5b).

### Scope decision: publish translation keys, not translated strings — a pre-existing gap this closes as a side effect

`renderEditList()`'s labels (`groupLabel()`/`editTypeLabel()`) currently call `tr()` (this
module's own i18n read) at write time, and — unlike every other legacy-owned control this
migration has touched — **there is no `sansbass:langchange` listener anywhere in `notes.js`
today**, so the edit list's rendered text does not retranslate on a language switch until the
next edit changes it. This is a pre-existing gap against `docs/product-contract.md`/
`behaviour.md`'s LANG-001 promise ("all visible copy rerenders"), not a feature to preserve —
recorded here as an existing defect found during this slice's audit, per `docs/react-migration.md`
Phase 0's instruction to record such defects separately from migration regressions. Moving this
presentation to React closes the gap as a natural side effect of render-time translation (the
same convention every phase since 4b has used), not a separate behavioral fix: `editTypeLabel()`
and `groupLabel()` are refactored to return a plain i18n key string (none of these keys take
interpolation params except `notes.editsSummary`'s `{n}`, which the component supplies directly
from `editGroups.length`) instead of calling `tr()` directly, and the component resolves it via
`t()` at render time via `useLocale()`. `groupTimeLabel()` is untouched in spirit — its output
is already-formatted plain text (`toFixed()`), not translated, matching how BPM/phase values are
formatted elsewhere in this app without locale variation.

### Re-verified: the `window.sansBass` early-import hazard

`notes.js` is already reachable from `app.js`'s own static import graph before `app.js`'s body
sets `window.sansBass` (via `PlayerShell.jsx` → `DetectionPanel.jsx`/`InterpretationPanel.jsx`/
`TempoPanel.jsx`, established since Phase 5b) — adding `components/EditorPanel.jsx` to that same
import graph introduces no new reachability path, only a new consumer. This slice's new code
(`view()`'s `editGroups` field, the new command functions) reads no `window.sansBass` member
that isn't already read by unchanged, already-guarded code (`hasStem()`, `view()`'s existing
`ribbonVisible` read). No new guard is needed.

## Bounded outcome (Phase 6c)

A new `components/EditorPanel.jsx` exports two components, matching `DetectionPanel.jsx`'s
precedent of multiple focused-region exports from one file:

- `EditListPanel({ stem })` — owns `#notes-edits-{stem}`: the `<details>` element (hidden
  exactly when there are no edit groups, `open` left uncontrolled — native summary-click
  toggling, matching Phase 6a's Advanced-disclosure precedent — but closed programmatically on
  an outside pointerdown, preserving the one behavior beyond plain `<details>` semantics the
  legacy code added), the summary count, the Undo button, and the `<ol>` of edit-group rows
  (orphan warning, label, time label, remove button). Portalled into a new
  `#notes-edits-{stem}-root` host that replaces `<details id="notes-edits-{stem}">` at the same
  position inside the still-legacy `<section id="notes-{stem}">`.
- `ListExportPanel({ stem })` — owns `#notes-list-io-{stem}`: the "Bars per line" number input
  (component-local state, matching Phase 6a's `interp`-style "user preference, not song state"
  reasoning — nothing in the legacy code ever reset this value either) and the "Export list"
  button. Portalled into a new `#notes-list-io-{stem}-root` host replacing
  `<div id="notes-list-io-{stem}">` at the same position, immediately after the edit-list host.

Both are mounted twice (`stem="vocals"` / `stem="bass"`) and always mounted, matching every
prior Phase 5b/6a/6b component's unconditional-mount pattern — each reads its own visibility
condition from published state, so no wrapping condition is needed in `PlayerShell`.

Every id inside these regions is unchanged from the legacy markup (`notes-edits-{stem}`,
`notes-edits-summary-{stem}`, `notes-edit-undo-{stem}`, `notes-edit-rows-{stem}`,
`notes-list-bars-{stem}`, `notes-list-export-{stem}`), and so are the classes
(`notes-edit-list`, `notes-row`, `notes-edit-panel`, `edit-rows`, `edit-row`, `edit-warn`,
`edit-remove`, `notes-ctl`, `mini`), so `styles.css` (class-selector only for all of these,
verified) keeps working unmodified with no new rules needed.

`notes.js` gains one new `view()` field (`editGroups`, described above), a `undoLastEdit()`
channel function (the Undo button's former inline handler, now named and returned), a
`removeEditGroup(id)` channel function (the per-row remove handler's former inline closure,
now parameterized by id), and an `exportList(barsPerLine)` channel function (the former
`els.listExport` click handler, now taking the bars-per-line value as a parameter instead of
reading `els.listBars.value` — the same `Number(barsPerLine) || 4` coercion the legacy code
already applied at read time is kept, just moved to the parameter). `detection.commands` gains
three stem-dispatched entries (`undoEdit`, `removeEditGroup`, `exportList`), matching the
existing `setJianpuOn`/`setKey`/etc. pattern.

`notes.js` loses: `renderEditList()` (its DOM-writing job is fully replaced by `view()`'s new
`editGroups` field plus `publish()`'s existing broadcast — its two call sites in
`reinterpret()`/`reset()` are simply removed, since both already call `publish()` immediately
after), `syncExportAvailability()` (the list-export button's `disabled` state is now derived
from the already-published `count` field — its three call sites, including the one-time call
at channel construction, are removed), the `els.editUndo`/`els.listExport` click-listener
registrations, and the `document.addEventListener('pointerdown', …)` outside-click-closes-the-
details listener (moves entirely into `EditListPanel`'s own effect, scoped to its own ref,
rather than a module-level listener with no cleanup). `notes.js` keeps: the Worker lifecycle,
`interpret()`/`applyEdits()`, tempo, chord detection/editing, `editGroups`/`orphaned`/
`nextEditId` state itself (still the sole authoritative owner — only its presentation moves),
the `sansbass:noteedit`/`sansbass:editundo`/`sansbass:editmode` listeners (unchanged — these are
dispatched by the still-legacy canvas/toolbar), and the `sansbass:exportedits`/
`sansbass:importedits` shared handlers (unchanged — the buttons that dispatch them stay legacy,
see the scope decision above).

`app.js` keeps 100% of the zoomed pane, Edit-notes toggle, Export/Import-edits buttons, capo
control, and chord editor exactly as they are today — no changes to `app.js` are needed for
this slice, since it never referenced `#notes-edits-{stem}`/`#notes-list-io-{stem}`'s DOM
directly (only the custom events already listed, which are unchanged on both sides).

## Preservation rules

| Concern | Required behavior |
|---|---|
| Edit-list visibility | `#notes-edits-{stem}` (its React host's rendered `<details>`) is hidden exactly when `editGroups.length === 0`, in lockstep with today's `renderEditList()`. |
| Edit-list summary count | `notes.editsSummary` with `{n}` = the current group count, retranslating on a language switch (closing the pre-existing gap noted above). |
| Undo button | `disabled` exactly when `editGroups.length === 0`; clicking removes the most recent group (`undoBatch` semantics unchanged) and re-derives notes via the existing `reinterpret()` path. |
| Edit rows | One `<li class="edit-row">` per group, in existing order; an orphan warning (`⚠`, title `notes.editOrphanTip`) appears exactly when any of that group's edits is in the channel's `orphaned` list; label text matches `groupLabel()`'s existing key-selection logic (explicit `group.label` key, else `notes.editSplitLabel` for a multi-edit group, else the single edit's type-derived key) rendered via `t()`; time label matches `groupTimeLabel()`'s existing formatting exactly (range/`add`/generic cases). |
| Remove button | Clicking removes exactly that group by id (not by array index, preserved from today) and re-derives notes via `reinterpret()`. |
| Outside-click closes the disclosure | Clicking anywhere outside the open `<details>` closes it, matching today's `document`-level `pointerdown` listener; native summary-click toggling is otherwise uncontrolled. |
| List-export row visibility/enablement | "Export list" `disabled` exactly when `!count` (no notes yet), matching today's `!notes.length`; "Bars per line" has the same `type="number" min="1" max="16" step="1"` attributes and default `4`. |
| Bars-per-line persistence | The typed value is NOT reset when a song loads or a stem is replaced — matching today's uncontrolled-DOM-value behavior (nothing in the legacy code ever cleared it either), preserved by keeping the component always-mounted with its own local state, never recreated per song. |
| Export list output | Clicking "Export list" produces byte-identical `jianpuHtml()` output and filename to today, now reading the bars-per-line value from the click handler's parameter instead of `els.listBars.value`. |
| Persistence across song/stem changes (edit history) | `editGroups`/`orphaned` ARE cleared on `reset()` (song/stem change) — unlike Phase 6a's `interp`, this is song-derived state, matching today's `reset()` behavior exactly (no change here). |
| Import/export edits JSON, Edit-notes toggle | Explicitly out of scope this slice (see "Scope decision" above) — pixel-for-pixel and behaviorally unchanged; `app.js`'s DOM nodes and listeners for them are untouched. |
| Locale | Every label/tooltip retranslates correctly on a language switch via `useLocale()`, including the pre-existing gap closed above. |
| Remount | Shell unmount/remount does not lose edit-list state or re-run analysis — the state lives in `notes.js`'s own channel closure, independent of `PlayerShell.jsx`'s mount state. |
| No behavior change to out-of-scope regions | The Edit-notes toggle, shared Export/Import-edits buttons, capo control, chord display/editing, note selection/editing interaction, and the ribbon/overview/zoomed-pane canvases are pixel-for-pixel and behaviorally unchanged. |

## Failing-first and implementation increments

1. Extend the focused production-entry Chromium suite (`tests/player.test.js`) with cases run
   against the **current legacy owner** first, to record expected failures, then made to pass
   by the implementation below (using `installFakeWorker`/`loadZip`/`waitFor`, and dispatching
   `sansbass:noteedit`/`sansbass:editundo` directly on `player.win` — the established pattern
   this suite already uses for `sansbass:tempo`/`sansbass:chords` to simulate input that would
   otherwise require driving real canvas pointer gestures):
   - dispatching a `sansbass:noteedit` while `editable` is true (set via `sansbass:editmode`)
     makes the edit list visible with one row whose label/time text match the dispatched
     edit's type and timestamp, and enables the Undo button;
   - clicking the row's remove button (or dispatching a second edit then clicking Undo) removes
     it, hides the list again when the count reaches zero, and re-derives the note count;
   - the edit-list label retranslates on a language switch without losing the edit itself
     (proving the pre-existing gap is closed, not merely unchanged);
   - "Export list" stays disabled until the channel has notes, then enables, matching the
     shared count already exercised by the existing detection tests;
   - a value typed into "Bars per line" survives a language switch and a same-song note-count
     change (proving it is component-local, not reset by unrelated republishes).
2. Refactor `notes.js`: rename the Undo/remove inline handlers to named channel functions
   (`undoLastEdit()`, `removeEditGroup(id)`), add `exportList(barsPerLine)` (parameterizing the
   former `els.listExport` click handler), delete `renderEditList()` and
   `syncExportAvailability()` and their call sites, delete the `els.editUndo`/`els.listExport`
   `addEventListener` registrations and the outside-`pointerdown` listener, delete the six
   `els.*` entries (`editsRow`, `editsSummary`, `editUndo`, `editRows`, `listBars`,
   `listExport`) from both `channels.push(createNotesChannel(...))` call sites, refactor
   `editTypeLabel()`/`groupLabel()` to return a plain key string instead of calling `tr()`,
   extend `view()` with the `editGroups` descriptor array, and extend `detection.commands`
   with `undoEdit`/`removeEditGroup`/`exportList` (stem-dispatched, matching the existing
   pattern).
3. Add `components/EditorPanel.jsx` (`EditListPanel`, `ListExportPanel`).
4. Update `index.html` (replace `#notes-edits-vocals`/`#notes-edits-bass` and
   `#notes-list-io-vocals`/`#notes-list-io-bass` with four `-root` portal hosts at the same
   positions inside their existing sections) and `components/PlayerShell.jsx` (add the four
   hosts, portal four component instances, unconditionally like `NotesChannelPanel`).
5. Run focused tests, then `npm test`, `npm run build`, `git diff --check`, and an exact-source
   local production smoke at root and a nested route (a generated stems ZIP with a vocals stem
   for the loaded-song precondition, a faked Worker for the detection flow, and a dispatched
   `sansbass:noteedit` for the edit-list flow itself) before opening the PR.

## Out of scope

The Edit-notes toggle, the shared Export/Import edits JSON buttons (see "Scope decision"
above, deferred alongside capo/chord pending the same future zoomed-pane mount-lifecycle
restructuring), note selection and editing interaction itself (canvas pointer/keyboard,
inherently legacy per standing architecture rules, not a new deferral), the capo control, the
zoomed pane's chord display/editing, and the ribbon/overview/zoomed-pane lanes themselves stay
untouched and legacy-owned. The `window.sansBass` bridge's remaining members stay untouched.
Real-Worker/model smoke and physical-handheld evidence remain separate, deployment-and-release-
level checks per `docs/testing.md` and `docs/behaviour.md`, not routine test dependencies for
this slice.

Completing this slice completes Phase 6c and, with it, every sub-slice `docs/react-migration.md`
scoped ahead of time except the one still-unscheduled future sub-slice (capo/chord, now also
carrying the Edit-notes toggle and Export/Import edits JSON buttons per the scope decision
above) — Phase 6 as a whole remains "in progress" until that future sub-slice ships.
