# React migration Phase 6e — Edit-notes toggle and shared Export/Import edits JSON buttons plan

Status: planned from `afbe014301a1bdf86a779caa2a0e64683016903b` (documentation-anchor merge
for Phase 6d, PR #94) on 2026-09-07. Previous accepted implementation rollback anchor: Phase
6d at
`6a49bb47d9cfb2f6eb43c2059a97694e1d00c331`, documented through
[PR #93](https://github.com/SansWord/sans_bass/pull/93) and anchored through
[PR #94](https://github.com/SansWord/sans_bass/pull/94).

This is the first attempt at the ownership handoff Phase 6d's mount-lifecycle refactor
unblocked. The task framing named one slice covering all four still-legacy zoomed-pane
controls (capo, chord display/editing, the Edit-notes toggle, and the shared Export/Import
edits JSON buttons). This plan's own audit — see "Scope decision" below — finds that framing
does not describe one cleanly separable region either: the Edit-notes toggle and the
Export/Import buttons are genuinely independent of any per-frame state, but the capo control
and the chord editor are mutually entangled with each other AND with a per-frame-recomputed
value in a way the other two are not. This slice's actual bounded outcome is the Edit-notes
toggle and Export/Import buttons only; capo and the chord editor become Phase 6f, sketched at
the end of this document for whoever picks it up next.

## Audit — current ownership, and why this splits in two

| Region | Owner today | DOM location | Update trigger |
|---|---|---|---|
| Edit-notes toggle (`editToggleLabelEl`/`editToggleEl`, `#notes-edit`) | `app.js`, built once in `buildUI()`'s first-time branch (Phase 6d), appended into `zLaneSel` | Sibling of the stem/Notes chip host (`zChipHost`) inside `zLaneSel` | `.hidden` from `syncNotesChipsVisibility()` (called from `setNotes()`, `toggleRibbon`-adjacent code, and a few other discrete detection/visibility-changing call sites); `.disabled`/`.checked` from `syncEditToggle()` and the `sansbass:editmode` listener — both discrete, event- or state-change-triggered, **never called from `draw()`/rAF**. |
| Shared Export/Import edits JSON buttons (`editIoGroupEl`/`editIoExportBtnEl`/`editIoImportBtnEl`/`editIoImportFileEl`) | `app.js`, same construction site, appended into `zLaneSel` right after the toggle | Sibling of the Edit-notes toggle, same row | `.hidden` from the same `syncNotesChipsVisibility()` call (identical `anyReady` gate); click handlers dispatch `sansbass:exportedits`/`sansbass:importedits`, unchanged since Phase 5b's shared-pair redesign. |
| Capo control (`capoCaption`/`capoSelect`) | `app.js`, built once, appended as the **first children of `chordGroup`** | Inside `chordGroup` (`.zoom-chord-row`), not `zLaneSel` | `capoSelect.value` itself only changes on user `change` (discrete) or the `sansbass:chords` event/Phase-6d reuse-reset (both discrete) — **but its visibility is `chordGroup.hidden`**, which is recomputed every `draw()` call via `syncChordEditor(time)`, driven by `chordTimeline.find(item => item.start <= time && time < item.end)`. |
| Chord editor (`chordCaption`/`playKey`/`chordInput`/`chordCandidates`/`chordRedetect`/`chordSpinner`/`chordStatus`) | `app.js`, same `chordGroup` container | Same `chordGroup` | `syncChordEditor(time)`, called from every `draw()` (i.e. every rAF frame while playing, plus once per discrete change while paused). |

**Edit-notes toggle and Export/Import buttons have zero rAF entanglement.** Both live in
`zLaneSel`, a sibling row of `chordGroup`, and every write to either one traces back to a
discrete cause (a detection Worker result, a ribbon-visibility toggle, an `editmode` event) —
never to the playhead or `draw()`. This matches the DetectionPanel/TempoPanel precedent
exactly: derive a small view from existing state, publish it, let React render it, wire real
commands for the discrete actions.

**Capo and the chord editor are mutually entangled, and entangled with per-frame state.**
`capoCaption`/`capoSelect` are literally the first children of `chordGroup`, share its `hidden`
flag, and (per the original Phase 6b finding, reconfirmed here) moving capo alone would
relocate a control that is visually and functionally part of one row to a different DOM
position — forbidden by the "preserve appearance" rule. Splitting this slice into "Edit-toggle
+ Export/Import" and "capo + chord editor" is not a risk/size judgment call the way 6d's PR
split was — it is the same kind of structural-entanglement finding 6b's and 6c's own audits
each made about their own scope, applied one level deeper now that the container-instability
problem is fixed.

### A finding that revises the premise: rAF frequency does not mean "must stay imperative"

The original Phase 6b audit's stated reason for keeping the chord editor legacy-owned was that
`syncChordEditor` "rewrites `chordEditor.input.value`, `.candidates`, `.playKey.textContent`
… on every rendered frame, not on discrete user events" and called this "the same category of
per-frame, clock-driven DOM write that the migration architecture explicitly keeps outside
React everywhere else." Re-reading `syncChordEditor` and `draw()` closely for this plan finds
that claim was broader than the code actually requires, in a way worth recording before Phase
6f repeats the same reasoning:

- `chordEditor.spinner.hidden`, `.status.hidden`/`.textContent`, and `.playKey.textContent` are
  computed every frame **but never depend on `time`** — only on `chordDetectionPhase` and
  `detectedKey`/`capo`, all of which change only on discrete events (a `sansbass:chords`
  broadcast, a capo change). These three fields could be dropped from `syncChordEditor`
  entirely and computed at render time from published state, exactly like `TempoPanel`'s
  status line already is.
- `chordGroup.hidden`, `.input.hidden`/`.value`/`.classList`, `.candidates.hidden`/content/
  `.value`, and `.redetect.hidden` **do** depend on `time`, through `chordTimeline.find(...)`
  — but only in the sense that the *result* changes at most a few times per song (whenever the
  playhead crosses a chord-segment boundary), not on every frame. `lib/player-application.js`
  already solves exactly this shape of problem for the transport snapshot: `publishTransport()`
  is called every `draw()` tick but only actually notifies subscribers when the computed
  projection differs from the last one (`sameTransport(...)` shallow-compare, called from
  `draw()` at `app.js`'s transport publish site) — the same "recomputed every frame, published
  only on change" pattern this plan would need for "chord under the playhead," not a new one.
- The one genuinely novel problem is `chordInput`'s **value**, which is both externally driven
  (follows the chord under the playhead when not focused) and user-editable (typed text before
  committing on blur/Enter) — today solved by a plain `if (document.activeElement !==
  chordEditor.input) chordEditor.input.value = …` guard before every external write. A
  React-controlled input bound to published state would need an equivalent focus-aware guard
  (render from published state while unfocused; hold local draft text while focused, exactly
  mirroring the imperative guard's intent) — a real, new pattern for this codebase, but a
  well-understood one, not a reason capo/chord-editor ownership is unreachable.

**Consequence:** Phase 6f is not "blocked" the way capo/chord were originally framed — it is
"not yet designed," and the shape above (a dedup'd published view, mirroring
`publishTransport`, plus a focus-aware controlled input for the one editable field) is the
starting point whoever picks it up next should use. This plan does not implement it.

## Scope decision: Phase 6e is the Edit-notes toggle and Export/Import buttons only

Given the entanglement finding above, bundling capo/chord-editor's redesign into this slice
would both change this slice's risk profile (a genuinely new controlled-input pattern, not a
mechanical snapshot-and-commands extension) and delay the two controls that need neither. The
Edit-notes toggle and Export/Import buttons get their bounded, mechanical slice now; capo and
the chord editor become Phase 6f, with the design sketch above as its starting audit rather
than starting from nothing.

**Consequence for `docs/react-migration.md`:** Phase 6's five ordered sub-slices become six;
this document is updated in the separate documentation-anchor PR that follows this
implementation PR, per the established split.

## Bounded outcome (Phase 6e)

`lib/player-application.js` gains one new snapshot field and two new commands, extending
`applicationSnapshot()`'s existing shape (which already carries `masterVolume`/`routing` as
app.js-owned, non-transport state) rather than adding a third parallel store: this state has
no owner other than `app.js` itself, and `lib/player-application.js` is already app.js's own
facade for exactly this kind of thing — the same reasoning that gave `separation`/`detection`/
`tempoGrid` their own stores (because *their* owning modules, `separate.js`/`notes.js`, have no
other reason to touch this facade) argues for the opposite choice here.

- `notesEdit: { visible, enabled, on }` — `visible` mirrors today's `anyReady` (any channel
  visible and populated with notes), `enabled` mirrors today's `canEdit` (the currently
  selected zoomed-pane channel has notes), `on` mirrors `editMode`. Both the Edit-notes toggle
  and the Export/Import buttons read `notesEdit.visible` for their own `hidden` state (today's
  two separate DOM writes, `editToggleLabelEl.hidden`/`editIoGroupEl.hidden`, collapse into one
  published boolean two components read).
- `commands.setEditMode(on)` — replaces the checkbox's own `change` listener; internally
  dispatches the same `sansbass:editmode` custom event with the currently selected
  `zoomNotesStem`, so `app.js`'s own listener and `notes.js`'s listener are unchanged.
- `commands.exportEdits()` / `commands.importEdits(file)` — replace the two buttons' own click
  listeners; internally dispatch the same `sansbass:exportedits`/`sansbass:importedits` events,
  so nothing downstream of those events changes.

### A genuinely new plumbing direction: the host comes from `app.js`, not from `index.html`

Every prior React-owned control in this migration portals into a host that either is static
`index.html` markup (`#tempo-ui-root`, `#notes-edits-{stem}-root`, …) or is itself a DOM node
React created and handed to `app.js` via an `attachXxxCanvas`-style method (`attachLaneCanvas`,
`attachOverviewCanvas`, …). Neither shape fits here: the Edit-notes toggle's and Export/Import
buttons' actual parent, `zLaneSel`, is not static markup — it is legacy DOM `app.js` builds
inside `buildUI()`'s first-time-construction branch, and it must stay legacy DOM, because its
*other* children (the stem/Notes chip host) are out of scope and must keep laying out as its
flex siblings. `mountPlayerShell()` reads every other host via `doc.getElementById(...)` once,
at page load, before any song (and therefore before `zLaneSel`) exists — so there is no id to
read upfront here.

The resolution mirrors `publishTransport`/`subscribeTransport`'s existing shape, for a DOM
node instead of transport data, in the direction *opposite* every existing attach hook:
`lib/player-application.js` gains `publishEditHost(node)`/`subscribeEditHost(listener)`/
`getEditHost()`. `app.js` calls `playerApplication.publishEditHost(zEditHost)` once, right
after creating one stable `<span class="zoom-edit-host">` (kept `display: contents` in
`styles.css`, the same trick `zChipHost` already uses, so its React-rendered children act as
direct flex items of `zLaneSel`) and appending it into `zLaneSel` right after the chip host, in
`buildUI()`'s first-time-construction branch — persisting across song loads exactly like
`zChipHost` (Phase 6d), never recreated on reuse. The teardown branch calls
`publishEditHost(null)` when the anchor stem disappears. `components/PlayerShell.jsx` adds an
`EditModeControls({ application, notesEdit })` component that subscribes via
`useSyncExternalStore(application.subscribeEditHost, application.getEditHost,
application.getEditHost)` and, once a host exists, portals `EditModeToggle`/`EditIoControls`
into it — the two actual presentational components, added directly inside
`components/PlayerShell.jsx` matching the precedent of `MasterVolume`/`LoopControls`/
`ModeRoutingControls` (state exposed through `lib/player-application.js`, read from
`PlayerShell`'s single top-level `useSyncExternalStore` call and passed down as props) rather
than the separate-file `components/DetectionPanel.jsx`-style precedent, which exists
specifically for state owned by `notes.js`/`separate.js`.

- `EditModeToggle({ application, notesEdit })` — owns `#notes-edit`'s wrapping
  `<label class="notes-ctl zoom-edit-toggle">`, matching where `editLabel` was appended today.
- `EditIoControls({ application, notesEdit })` — owns the `<span class="notes-ctl
  zoom-edit-io">` group (export button, import button, hidden file input), matching where
  `ioGroup` was appended today, immediately after the toggle.

Both read their own `hidden` from `notesEdit.visible`; neither needs its own mount condition —
`EditModeControls` already renders nothing until the host exists.

Every id and class is unchanged from the legacy markup (`notes-edit`, `notes-ctl`,
`zoom-edit-toggle`, `zoom-edit-io`, `mini`), so `styles.css` only gains the one-line
`display: contents` rule for the new `.zoom-edit-host` wrapper — no rule targets a changed
selector.

`app.js` loses: `editToggleLabelEl`/`editToggleEl`/`editIoGroupEl`/`editIoExportBtnEl`/
`editIoImportBtnEl`/`editIoImportFileEl` module-level variable declarations and every
reference to them (their construction block in `buildUI()`'s first-time branch, the four
`null`-outs in the teardown branch, the DOM writes inside `syncNotesChipsVisibility()`/
`syncEditToggle()`, the `editToggleEl.checked = editMode` write inside the `sansbass:editmode`
listener, and the four retranslation lines inside `retranslate()` — React re-renders this
presentation from `useLocale()` like every other React-owned control, closing no new gap since
this text already retranslated correctly). `app.js` keeps: `editMode` itself (still the
module-level flag every other edit-mode-gated function reads — `zRangeHint`/`zToolbar`/
`zFields`/range-hint visibility, keyboard shortcuts, `attachSeek`'s edit gating — none of which
this slice touches), the `sansbass:editmode`/`sansbass:exportedits`/`sansbass:importedits`
event dispatch/listen sites (unchanged shape, now reached via the three new commands instead
of DOM listeners), and `syncNotesChipsVisibility()`/`syncEditToggle()` themselves (their bodies
change from DOM writes to nothing beyond what already updates `notesEdit`'s source fields —
see the implementation increments below for the one required addition: a `playerApplication.
publish()` call at their end, since neither function is reached through a `playerApplication`
command today).

## Preservation rules

| Concern | Required behavior |
|---|---|
| Edit-toggle visibility | Hidden exactly when no channel is both visible and populated with notes, matching today's `anyReady` gate exactly. |
| Edit-toggle enablement | Disabled exactly when the currently selected zoomed-pane channel (`zoomNotesStem`) has no notes, matching today's `canEdit`. |
| Edit-toggle checked state | Mirrors `editMode` in both directions: checking it dispatches `sansbass:editmode` with `on: true`; an external change to `editMode` (e.g. `notes.js` forcing it off) is reflected without a redundant dispatch loop. |
| Forced-off on losing eligibility | If the selected channel becomes ineligible while editing is on, editing turns off and dispatches `sansbass:editmode(on:false)` exactly once, matching today's `syncEditToggle()` behavior. |
| Export/Import visibility | Shares the exact same visibility gate as the Edit-notes toggle (`notesEdit.visible`), matching today's identical `anyReady`-driven `.hidden` on both. |
| Export button | Clicking dispatches `sansbass:exportedits` with no detail, matching today. |
| Import button/file | Clicking the button opens the (visually hidden) file picker; selecting a file dispatches `sansbass:importedits` with `{ file }` and resets the input's own value so picking the same file twice still fires `change`, matching today's `importFile.value = ''` reset. |
| Locale | Both controls' labels/titles retranslate correctly on a language switch via `useLocale()`. |
| Remount | Shell unmount/remount does not lose `editMode` or re-dispatch any event — the state lives in `app.js`'s own module scope and `playerApplication`'s published snapshot, independent of `PlayerShell.jsx`'s mount state. |
| No behavior change to out-of-scope regions | The capo control, the chord editor, the ribbon/overview/zoomed-pane canvases, the zoom toolbar/fields, and the stem/Notes chip lists are pixel-for-pixel and behaviorally unchanged. |

## Failing-first and implementation increments

1. Add a focused Node facade test (`tests/player-application.test.js`) for the three new
   commands, the new `notesEdit` snapshot field's presence, and the new `publishEditHost`/
   `subscribeEditHost`/`getEditHost` channel (deduplicated by node identity, mirroring
   `publishTransport`'s own dedup test) — contract failures added before
   `lib/player-application.js` itself changes.
2. Extend the focused production-entry Chromium suite (`tests/player.test.js`) with cases
   exercising the **real** controls end to end (checking the actual checkbox, clicking the
   actual buttons, dispatching the real `change` on the real hidden file input) rather than
   only the manual-event-dispatch shortcuts most existing edit-mode tests use:
   - the Edit-notes toggle is hidden/disabled before any channel has notes and becomes
     visible/enabled once one does, matching the existing detection-flow fixture pattern
     (`installFakeWorker`/`loadZip`/emit a `result` message);
   - checking the real checkbox dispatches `sansbass:editmode(on:true)` with the auto-selected
     `zoomNotesStem`, and unchecking it dispatches `on:false`; the checkbox also reflects an
     externally-dispatched `sansbass:editmode` event;
   - a song replacement that clears the selected channel (no detection run yet) forces editing
     off through `syncEditToggle()`'s end-of-`buildUI()` call, dispatching `on:false` exactly
     once;
   - clicking the real Export button dispatches `sansbass:exportedits`; selecting a file
     through the real (visually-hidden) import file input dispatches `sansbass:importedits`
     with that file and resets the input's own value;
   - a language switch retranslates the toggle's label and both buttons' text.
3. Add `notesEdit` to `applicationSnapshot()` (backed by a new `notesEditState()` helper reused
   by `syncEditToggle()`) and `setEditMode`/`exportEdits`/`importEdits` to `lib/player-
   application.js`'s `commands`, plus `publishEditHost`/`subscribeEditHost`/`getEditHost`; add
   the three matching command handlers to `app.js`'s `commands: {...}` object passed to
   `playerApplication.initialize(...)`.
4. Refactor `app.js`: delete the six module-level variables and every reference to them listed
   above; replace their construction block in `buildUI()`'s first-time-construction branch with
   one stable `<span class="zoom-edit-host">`, appended into `zLaneSel` right after the chip
   host and registered via `playerApplication.publishEditHost(zEditHost)`; add
   `playerApplication.publishEditHost(null)` to the teardown branch; delete the DOM write inside
   the `sansbass:editmode` listener (`editToggleEl.checked = editMode`) and add a
   `playerApplication.publish()` call there instead; delete the four retranslation lines from
   `retranslate()`; add one `playerApplication.publish()` call at the end of
   `syncNotesChipsVisibility()` and `syncEditToggle()` (both already recompute
   `notesEditState()`'s inputs; this is the one addition needed so a change reaches React).
5. Add `EditModeToggle`, `EditIoControls`, and the portalling `EditModeControls` wrapper to
   `components/PlayerShell.jsx`; render `<EditModeControls application={application}
   notesEdit={snapshot.notesEdit} />` from `PlayerShell`'s top-level return.
6. Update `styles.css` with the one-line `.zoom-edit-host { display: contents; }` rule.
7. Run focused tests, then `npm test`, `npm run build`, `git diff --check`, and an exact-source
   local production smoke at root and a nested route (a generated stems ZIP for the
   loaded-song precondition, a faked Worker for the detection flow, a real file selected
   through the real import file input) before opening the PR.

## Out of scope

Capo control and chord display/editing (Phase 6f, sketched above), the ribbon/overview/
zoomed-pane canvases, the zoom toolbar/fields, the stem/Notes chip lists, and every other
already-accepted React-owned region stay untouched and legacy-owned or already-owned as today.
The `window.sansBass` bridge's remaining members stay untouched.
