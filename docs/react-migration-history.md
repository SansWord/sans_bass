# React migration history

> Historical planning/execution narrative from the incremental React component migration
> (Phases 1–7, completed 2026-09-07). This is archaeology, not a spec: it explains how the
> current architecture was reached, phase by phase, including dead ends and scope
> renegotiations discovered mid-phase. For what the architecture *is today*, read `CLAUDE.md`'s
> "Hard constraints" and "Repo layout" sections instead — this doc is not kept in sync with
> further changes.
>
> The completed phases' own plan documents and the full build/test evidence are archived at
> [`docs/archive/react-migration/`](archive/react-migration/).

## How ownership moved, phase by phase

React/React DOM and Vite JSX support were introduced for the incremental component
migration; Phase 1 introduced the demo header and Phase 3a shares that header contract
with the React-owned player header/loading/status/drop shell. Phase 3b adds the primary
play/pause and speed controls to that same shell/root. Phase 3c adds the primary full-song
seek canvas, accessible seek value, and master time/rate/BPM presentation while retaining
`app.js` as its imperative waveform painter. Phase 3d adds the primary master-volume
control and A/B badge/Clear presentation while `app.js` retains gain smoothing and loop
timing. Phase 3e adds the top-level mode selector and all-toggle presentation while
`app.js` retains routing transitions, gain smoothing, lane toggles, and 0/1–6 shortcuts.
Phase 4a adds one React lane component per standard track (mix/stems/unknown) — label,
keyboard-operable mute button, per-lane volume, and the waveform canvas host — through a
`#standard-lanes-root` portal, plus an explicit extra-content host for the drums lane's
tempo-range hint, while `app.js` retains peak generation, painting, resize, lane-canvas
seek, and the drums-hint content itself. Phase 4b adds the shared Overview lane's label,
master-volume-mirroring slider, and waveform canvas host through its own
`#overview-lane-root` portal (separate from `#standard-lanes-root`, since the Overview lane
isn't one of `song.tracks[]`), plus an extra-content host for its Phase-6-deferred
range-select caption, while `app.js` retains `overviewStems()`, peak combination, and
painting. `app.js`'s own `#note-lanes-root` (ribbon/zoomed pane, still legacy — Phase 6)
sits alongside both inside `#lanes`; all three are `display: contents` so `order` alone
recovers the original interleaved visual order with no cross-owner DOM references. Phase 5a
adds `components/SeparationPanel.jsx`, owning the entire `#sep` subtree (availability/gating
including the handheld explanation, start button, progress/backend status, cancel, error
display, and save controls) through a `#separation-ui-root` portal, using the same element
ids/classes the legacy markup used. It reflects `separate.js`'s existing state machine
through a new `separation` export (`subscribe`/`getSnapshot`/`commands`) — not through
`lib/player-application.js`, since separation state has no owner other than `separate.js`,
the same way `notes.js` owns its own detection state — while `separate.js` retains the
Worker lifecycle, model/session, and every command (`start`/`cancel`/`save`). Phase 5b adds
`components/DetectionPanel.jsx`, whose `DetectionControls` owns the shared `#notes-detect`
subtree (Find-notes button, spinner, busy-channel status) through a `#detection-ui-root`
portal, and whose `NotesChannelPanel` owns each melodic stem's meta row (count, Show/Hide,
簡譜 checkbox, and the key tonic/mode/relative-key span — one coherent DOM/ownership unit,
since the relative-key button shares the two selects' disabled condition and has no
legacy-only behavior left once they move) through `#notes-meta-vocals-root`/
`#notes-meta-bass-root` portals nested inside their still-legacy-owned
`<section id="notes-{stem}">`. It reflects `notes.js`'s existing per-channel state machine
through a new `detection` export, the same `subscribe`/`getSnapshot`/`commands` shape
`separation` established, while `notes.js` retains the Worker lifecycle, tempo/chord
detection, the note editor, and export/import; at that point the tune/Advanced
interpretation row, edit list, list-export, tempo grid, chord detection/editing, and the
zoomed pane all remained legacy-owned, deferred to Phase 6 (the interpretation row moved to
React in Phase 6a below; the rest remain legacy). Giving React ownership of these controls
made `notes.js`
reachable from `app.js`'s own static import graph (via `PlayerShell.jsx` →
`DetectionPanel.jsx`), which resolves before `app.js`'s body sets `window.sansBass` — the
same hazard `separate.js` already guarded against in Phase 5a; `notes.js`'s
`syncTempoControls()` (renamed `publishTempo()` in Phase 6b, below) and the new `view()`
needed the same optional-chaining guard `hasStem()` already had. Phase 6a (the first of
Phase 6's sub-slices) adds
`components/InterpretationPanel.jsx`, whose `InterpretationPanel` owns each melodic stem's
interpretation row — the shortest-note slider and the Advanced disclosure (fit-to-melody/
clip, whole-phrase/hmm, fix-octave-outliers/fold plus its tolerance slider and the
folded/muted stats) — through `#notes-tune-vocals-root`/`#notes-tune-bass-root` portals
nested inside their still-legacy-owned `<section id="notes-{stem}">`, matching Phase 5b's
`#notes-meta-{stem}-root` pattern exactly. It extends the same `detection` export Phase 5b
established (five new per-channel view fields plus `foldedCount`/`mutedCount`, and five new
commands) rather than adding a second store, since both rows live in the same
`createNotesChannel()` closure and are recomputed by the same `reinterpret()` call;
`notes.js` gains a plain per-channel `interp` state object (the same shape `jianpu` already
had) that `currentParams()`/`exportEntry()`/`importEntry()` read and write instead of the
DOM, and a new `lib/pitch.js#foldStats()` pure export replaces the inline folded/muted
counting loop `syncFoldControls()` used to do. At that point `notes.js` retained the Worker
lifecycle, tempo/chord detection, the note editor, and export/import; the edit list,
list-export row, tempo grid, chord detection/editing, and the zoomed pane remained
legacy-owned, deferred to Phase 6b (originally scoped as "tempo/grid/capo/chord controls")
and Phase 6c (originally scoped as "selection/edit/undo/import/export controls"). Phase 6b adds
`components/TempoPanel.jsx`, whose `TempoPanel` owns the entire shared `<section
id="notes-tempo">` region — the Show-grid checkbox, BPM field, ×½/×2, phase field + nudge
buttons, beats-per-bar select, "Select BPM range" toggle, Re-detect button, and status
line — through a `#tempo-ui-root` portal that replaces that section's static markup
entirely, matching Phase 5b's `#detection-ui-root` whole-section pattern rather than 6a's
nested-sub-region one (`#notes-tempo` was never nested inside another still-legacy section
the way `#notes-tune-{stem}` was). It reflects a new `tempoGrid` export — the same
`subscribe`/`getSnapshot`/`commands` shape `separation`/`detection` established, but a
distinct store from `detection` rather than an extension of it, since tempo/grid state is
module-level and shared (one grid, both channels, its own Re-detect Worker and in-flight
flag) with no per-channel shape to extend. `notes.js` loses the `tempoEl` object (nine DOM
lookups) and their `addEventListener` registrations entirely, and its `syncTempoControls()`
is renamed `publishTempo()`, now producing a published view instead of writing the DOM.
**Phase 6b's own audit found its originally-scoped capo control and chord display/editing
entangled with still-legacy rendering** — both are driven every animation frame by the same
rAF-driven function (`syncChordEditor`) that paints the zoomed canvas, and their DOM
container (`app.js`'s `chordGroup`, built inside `buildUI()`'s zoomed-pane construction) is
torn down and rebuilt on every song load, unlike `#notes-tempo` — the same per-song-rebuild
problem the Overview lane had before Phase 4b pulled it out of that rebuild so React could
own it stably; no equivalent extraction exists yet for the zoomed pane. Capo and chord
controls stay entirely legacy-owned in `app.js` (zero changes needed there for Phase 6b),
deferred to a future, not-yet-scheduled sub-slice rather than bundled into 6b or folded into
6c — see `docs/archive/react-migration/react-phase-6b-tempo-chord-controls-plan.md`'s scope
decision for the full reasoning. `notes.js` retains the Worker lifecycle, tempo/chord
detection state, the note editor, and export/import; the edit list, list-export row, chord
detection/editing, and the zoomed pane remain legacy-owned, deferred to that future
capo/chord sub-slice and Phase 6c (originally scoped as "selection/edit/undo/import/export
controls"). Phase 6c adds
`components/EditorPanel.jsx`, whose `EditListPanel` owns each melodic stem's edit list
(`#notes-edits-{stem}`: summary count, Undo button, per-row remove/orphan warning) and whose
`ListExportPanel` owns its list-export row (`#notes-list-io-{stem}`: "Bars per line", "Export
list") — one coherent DOM/ownership unit each, portalled into new `#notes-edits-{stem}-root`/
`#notes-list-io-{stem}-root` hosts nested inside their still-legacy `<section
id="notes-{stem}">`, matching Phase 6a's nested-portal-inside-still-legacy-section shape
(unlike Phase 6b's whole-section replacement, since `<section id="notes-{stem}">` itself
stays legacy-owned). It extends the same `detection` export Phase 5b/6a established (a new
`editGroups` array field per channel) rather than adding a second store, for the same reason
Phase 6a gave for its own interpretation-row fields: both live in the same
`createNotesChannel()` closure and are recomputed by the same `reinterpret()` call. **Phase
6c's own audit found its originally-scoped Edit-notes toggle and shared Export/Import edits
JSON buttons entangled with the same still-legacy, per-song-rebuilt zoomed-pane DOM container
Phase 6b found for the capo/chord row** — built by `app.js`'s `buildUI()` inside the zoomed
pane's per-song construction, torn down and rebuilt every song load. Unlike capo/chord,
neither is rewritten every rAF frame, but the DOM-container-teardown reason alone is
independently disqualifying: a stable host would relocate a control that is visually part of
one row (beside the zoomed pane's Notes chips) to a different DOM position, which the
migration rules forbid — see
`docs/archive/react-migration/react-phase-6c-editor-export-controls-plan.md`'s scope
decision for the full reasoning. Both controls join the same future, not-yet-scheduled
sub-slice Phase 6b already deferred, rather than opening a second one for the same root
cause; note selection/editing interaction itself was never an open question, since canvas
pointer/keyboard ownership already stays legacy per the standing architecture rules restated
above. `notes.js` loses `renderEditList()`/`syncExportAvailability()` (both fully replaced by
the new published `editGroups` field and the already-published `count` field), the
`els.editUndo`/`els.listExport` click listeners, and the `document`-level outside-pointerdown-
closes-the-disclosure listener (moved into `EditListPanel`'s own effect); it gains
`undoLastEdit()`/`removeEditGroup(id)`/`exportList(barsPerLine)` command functions, and its
`els` parameter collapses to a single `panelEl` reference, the one legacy DOM lookup this
factory still needs. Moving this presentation to React also closed a pre-existing gap found
during the audit: the legacy edit list had no `sansbass:langchange` listener anywhere in
`notes.js`, so it never retranslated on a language switch until the next edit changed it;
render-time translation via `t()` fixes this as a natural side effect. `app.js` needed zero
changes for this slice, the same as Phase 6b. This completes all three originally-scheduled
Phase 6 sub-slices; one future sub-slice remained blocked on a zoomed-pane mount-lifecycle
restructuring (capo control, chord display/editing, the Edit-notes toggle, and the shared
Export/Import edits JSON buttons). Phase 6d performs exactly that restructuring, as a pure
refactor with **zero ownership change** — every one of those four controls stays 100%
`app.js`-owned, pixel-for-pixel and behaviorally identical to before. `index.html` gains a
new `#zoom-lane-root` sibling of `#note-lanes-root` (both `display: contents`, same pattern
as `#standard-lanes-root`/`#overview-lane-root`), and the zoomed pane (`zLane` and everything
inside it — the capo/chord row, Edit-notes toggle, Export/Import buttons, canvas, toolbar,
fields, and stem/Notes chip lists) is now built once and reused across a song replacement
that keeps a vocals/bass stem, instead of being destroyed and rebuilt every `buildUI()` call
— mirroring the fix Phase 4b applied to the Overview lane. A new `rebuildZoomChipHost()`
rebuilds only the genuinely per-song stem/Notes chip lists (nested in their own `zChipHost`
span) on both first construction and reuse, leaving its permanent sibling (originally
`editLabel`/`ioGroup`, then Phase 6e's `zEditHost` — see below) untouched; `attachZoom`/
`attachResize` are now registered exactly once, at first construction, to avoid
double-firing wheel/drag gestures on a node that no longer gets recreated every song; and
`buildUI()` explicitly re-syncs the pane's detection-gated visibility/capo value on every
reuse, since construction alone no longer does that for it. This unblocked — but did not
itself perform — the ownership handoff of those four controls to React, originally scoped as
one further sub-slice (6e). Attempting that handoff found it split further: the Edit-notes
toggle and the shared Export/Import edits JSON buttons have zero dependency on any per-frame
state, but the capo control and the chord editor share one DOM container (`chordGroup`) and
one hidden flag recomputed every `draw()` call, so moving capo alone would again relocate a
control that is visually and functionally part of one row. Phase 6e's actual deliverable
narrowed to the Edit-notes toggle and Export/Import buttons; `applicationSnapshot()` gains a
`notesEdit: { visible, enabled, on }` field and three commands (`setEditMode`, `exportEdits`,
`importEdits`), each dispatching the exact same `sansbass:editmode`/`sansbass:exportedits`/
`sansbass:importedits` events the removed DOM listeners used, so `notes.js`'s own listeners
are untouched. Since these controls' actual parent (`zLaneSel`) is legacy DOM built inside
`buildUI()`, not static `index.html` markup `mountPlayerShell()` reads upfront,
`lib/player-application.js` gained `publishEditHost`/`subscribeEditHost`/`getEditHost` — the
*reverse* direction of every other attach hook in this migration (elsewhere React creates a
node and hands it to `app.js`; here `app.js` creates a stable `<span class="zoom-edit-host">`
inside its own tree, kept `display: contents`, and hands it to React, which portals
`EditModeToggle`/`EditIoControls` — added directly in `components/PlayerShell.jsx`, matching
the `MasterVolume`/`LoopControls` precedent since this state is `lib/player-application.js`-
owned, not a separate `notes.js`/`separate.js` store — into it once it exists). Phase 6f
completes Phase 6 by giving React the capo control and chord display/editing themselves
(`chordGroup`'s former contents): 6e's own audit found most of the chord editor's
per-frame-recomputed fields did not actually need to stay imperative the way canvas pixels
do, and 6f's re-audit confirmed it — `lib/player-application.js` gained a
`publishChord`/`subscribeChord`/`getChordSnapshot` triplet structurally identical to
`publishTransport`/`sameTransport`/`getTransportSnapshot` (recomputed every `draw()` tick,
published to subscribers only when the projection actually changes) backed by a new
`applicationChordSnapshot()` in `app.js`, plus a `publishChordHost`/`subscribeChordHost`/
`getChordHost` triplet mirroring `publishEditHost`, at the exact position `chordGroup` used
to occupy inside `zName`. The one genuinely new pattern is `ChordInput` — a real controlled
`<input>`, not an imperative escape hatch: local draft state syncs from the published value
only while unfocused (mirroring the legacy `document.activeElement !== chordEditor.input`
guard), and a `valueAtFocusRef` reproduces a native `<input>`'s own `change` semantics
(commits on blur only if the value actually differs from what it was when focus began) so an
unedited focus-then-blur commits nothing. `capo`, `chordTimeline`, `chordDetectionPhase`, and
`detectedKey` stay `app.js` module state — only presentation moved. Phase 7 audited
`app.js`, `lib/player-application.js`, and every `components/*.jsx` file for leftover
migration adapters and found none removable: every `window.sansBass` member, every
`sansbass:*` event, every DOM attach hook, and every CSS selector still has a live consumer —
each phase's own audit had already retired its scaffolding as it went. Phase 7's actual work
was documentation accuracy (rewording comments that called permanent bridges "temporary") and
a chained real-build acceptance pass; see
`docs/archive/react-migration/react-phase-7-retire-legacy-plan.md` and
`docs/archive/react-migration/react-migration-evidence.md`'s Phase 7 section. This completed
the incremental React migration.

## Component ownership as it took shape, phase by phase

The player and demo list share `styles.css`, the translation dictionary, and
`components/SiteHeader.jsx`. React solely owns both pages' `#site-header` descendants.
`components/PlayerShell.jsx` additionally owns the one player file input, empty/loading
affordance, status/error presentation, global drag overlay, primary play/pause button, and
playback-speed, primary seek/time, master-volume, and A/B presentation controls through one
root with explicit portal hosts. It also owns the top-level translated mode selector and
all-toggle button; stable routing identity and state come from the application projection.
It also owns the zoomed pane's Edit-notes toggle and shared Export/Import edits JSON buttons
(`EditModeToggle`/`EditIoControls`, Phase 6e), portalled — via a new `publishEditHost`/
`subscribeEditHost` channel in `lib/player-application.js`, the reverse of every other attach
hook (`app.js` hands React the node here, not the other way around) — into a stable host
`app.js` creates once inside its own legacy `zLaneSel` tree.
It also owns one lane component per standard track (label, keyboard-operable mute, per-lane
volume, waveform canvas host, and — for the drums lane only — an extra-content host for the
legacy tempo-range hint) through a `#standard-lanes-root` portal inside `#lanes`. It also owns
the shared Overview lane (label, master-volume-mirroring slider, waveform canvas host, and an
extra-content host for its legacy range-select caption) through a separate `#overview-lane-root`
portal, kept apart from `#standard-lanes-root` so that root's children stay exactly
`song.tracks[]`'s standard lanes. `components/SeparationPanel.jsx` owns the entire separation
panel (availability/gating including the handheld explanation, start button, progress/backend
status, cancel, error display, and save controls) through a `#separation-ui-root` portal,
reflecting `separate.js`'s state machine through its own `separation` export rather than
through `lib/player-application.js` — separation state has no owner other than `separate.js`.
`components/DetectionPanel.jsx` owns the shared Find-notes button/spinner/busy-channel status
(`DetectionControls`, through a `#detection-ui-root` portal) and each melodic stem's meta row
— count, Show/Hide, 簡譜 checkbox, and the key tonic/mode/relative-key span
(`NotesChannelPanel`, through `#notes-meta-vocals-root`/`#notes-meta-bass-root` portals nested
inside their still-legacy `<section id="notes-{stem}">`), reflecting `notes.js`'s per-channel
state machine through its own `detection` export, the same shape `separation` established.
`components/InterpretationPanel.jsx` owns each melodic stem's interpretation row — the
shortest-note slider and the Advanced disclosure (fit-to-melody/clip, whole-phrase/hmm,
fix-octave-outliers/fold plus its tolerance slider and folded/muted stats) — through
`#notes-tune-vocals-root`/`#notes-tune-bass-root` portals nested inside the same still-legacy
sections, extending that same `detection` export rather than a second store (Phase 6a).
`components/TempoPanel.jsx` owns the entire shared `#notes-tempo` panel (Show-grid checkbox,
BPM field, ×½/×2, phase field + nudge buttons, beats-per-bar select, "Select BPM range"
toggle, Re-detect button, status line) through a `#tempo-ui-root` portal that replaces that
whole (never-legacy-nested) section, reflecting a new `tempoGrid` export — a distinct store
from `detection`, since tempo/grid state is module-level/shared with no per-channel shape,
rather than an extension of it (Phase 6b). `components/EditorPanel.jsx` owns each melodic
stem's edit list (`EditListPanel`: summary count, Undo button, per-row remove/orphan warning,
through `#notes-edits-vocals-root`/`#notes-edits-bass-root` portals) and list-export row
(`ListExportPanel`: "Bars per line", "Export list", through
`#notes-list-io-vocals-root`/`#notes-list-io-bass-root` portals), both nested inside the same
still-legacy `<section id="notes-{stem}">` sections as the tune row, extending the same
`detection` export rather than a second store (Phase 6c) — completing all three
originally-scheduled Phase 6 sub-slices. Capo, chord display/editing, the Edit-notes toggle,
and the shared Export/Import edits JSON buttons were originally found entangled with
`app.js`'s then-per-song-rebuilt zoomed-pane construction and deferred to a future,
not-yet-scheduled sub-slice (see
`docs/archive/react-migration/react-phase-6b-tempo-chord-controls-plan.md` and
`docs/archive/react-migration/react-phase-6c-editor-export-controls-plan.md`). Phase 6d
resolved that entanglement as a pure, ownership-neutral refactor: the zoomed pane now
persists across a song replacement that keeps a vocals/bass stem (its own `#zoom-lane-root`,
separate from `#note-lanes-root`, built once and reused rather than torn down every
`buildUI()` call — see
`docs/archive/react-migration/react-phase-6d-zoomed-pane-mount-refactor-plan.md`).
`components/PlayerShell.jsx`'s
`EditModeToggle`/`EditIoControls` (Phase 6e) now own the Edit-notes toggle and shared
Export/Import edits JSON buttons — portalled, via a new `publishEditHost`/`subscribeEditHost`
channel in `lib/player-application.js`, into a stable `<span class="zoom-edit-host">`
`app.js` creates once inside `zLaneSel` (the reverse of every other attach hook: `app.js`
hands React the node here, not the other way around) — reading a new `notesEdit` snapshot
field and three commands (`setEditMode`/`exportEdits`/`importEdits`) that dispatch the exact
same events the removed DOM listeners used. `components/PlayerShell.jsx`'s `CapoSelect`,
`ChordInput`, `ChordCandidatesSelect`, and `ChordRow` (Phase 6f) now own the capo control and
the zoomed pane's chord display/editing — the row Phase 6e's audit found entangled with a
shared per-frame-recomputed hidden state, unblocked by that same audit's revised finding that
the shape already fits `publishTransport`'s existing dedup pattern. They portal, via a new
`publishChordHost`/`subscribeChordHost` channel in `lib/player-application.js` mirroring
`publishEditHost`, into a stable `<span class="zoom-chord-host">` `app.js` creates once inside
`zName` at the position `chordGroup` used to occupy — reading a new `chord` snapshot (a
distinct `publishChord`/`subscribeChord`/`getChordSnapshot` channel, not a field of `notesEdit`
or `transport`, recomputed every `draw()` tick and published only on change) and three commands
(`setCapo`/`commitChord`/`redetectChord`) that dispatch the exact same
`sansbass:capochange`/`sansbass:chordedit`/`sansbass:chordredetect` events the removed DOM
listeners used. `ChordInput` is the one genuinely new pattern this migration needed: a real
controlled `<input>` whose local draft state syncs from the published value only while
unfocused, with a `valueAtFocusRef` reproducing a native `<input>`'s own change-since-focus
commit semantics — not an imperative escape hatch. This completed Phase 6. Phase 7 audited
`app.js`, `lib/player-application.js`, and every `components/*.jsx` file for leftover
migration adapters and found none removable: every `window.sansBass` member, every
`sansbass:*` event, every DOM attach hook, and every CSS selector still has a live consumer —
each phase's own audit had already retired its scaffolding as it went. Phase 7's actual work
was documentation accuracy (rewording comments that called permanent bridges "temporary") and
a chained real-build acceptance pass.
