# React migration Phase 6f — capo control and chord display/editing plan

Status: planned from `0d5013c3e0b6860f66a49b2ac45d707d2efe3014` (documentation-anchor merge
for Phase 6e, PR #96) on 2026-09-07. Previous accepted implementation rollback anchor: Phase
6e at `130af31bd80f8cd55f5b413e8a1ce8f6563deb15`, documented through
[PR #95](https://github.com/SansWord/sans_bass/pull/95) and anchored through
[PR #96](https://github.com/SansWord/sans_bass/pull/96).

This is the last unscheduled Phase 6 sub-slice. Phase 6e's own audit found the capo control
and the zoomed pane's chord display/editing entangled with each other (one shared DOM
container, `chordGroup`) and with a per-frame-recomputed value (`chordGroup.hidden`, driven by
the chord under the playhead) — deferred here rather than bundled into 6e. Phase 6e's audit
also *revised* the reason this was ever deferred: the original Phase 6b framing ("rewritten
every rAF frame, therefore must stay imperative") was broader than the code requires. This
plan's own re-audit (below) confirms that revision and designs the handoff on top of it.

## Audit — re-reading `buildUI()`, `draw()`, `syncChordEditor()`, and `retranslate()` fresh

Every reference to `chordEditor`/`capoSelect`/`capoCaption`/`chordCaption`/`chordCandidates`/
`chordRedetect`/`chordSpinner`/`chordStatus` in `app.js` today, by construction site:

| Region | Owner today | DOM location | Update trigger |
|---|---|---|---|
| Capo caption/select (`capoCaption`/`capoSelect`) | `app.js`, built once, first children of `chordGroup` | Inside `chordGroup` (`.zoom-chord-row`) | `capoSelect.value` changes only on user `change` (discrete: mutates `capo`, dispatches `sansbass:capochange`, calls `draw()`) or the `sansbass:chords` event/reuse-branch reset (both discrete). Its **visibility** is `chordGroup.hidden`, shared with everything else in the row. |
| Play-key readout (`playKey`) | `app.js`, same container | Same | `.textContent` recomputed every `draw()` tick via `syncChordEditor(time)`, but the computed value (`detectedKey`/`capo` → a note letter) depends only on discrete state, never on `time` itself. |
| Chord caption, input, candidates, redetect, spinner, status | `app.js`, same container | Same | `syncChordEditor(time)`, called from every `draw()` tick (i.e. every rAF frame while playing, once per discrete change while paused). |

**What genuinely depends on `time`, re-checked line by line:**

- `chordSpinner.hidden`, `chordStatus.hidden`/`.textContent`, and `playKey.textContent` are
  computed every frame but read only `chordDetectionPhase`/`detectedKey`/`capo` — none of
  which is a function of `time`. These were already over-scoped as "per-frame state" by the
  original Phase 6b framing; they are ordinary discrete-state derivations, the same shape
  `notesEditState()` already publishes for the Edit-notes toggle.
- `chordGroup.hidden`, `chordInput.hidden`/`.value`/`.classList`, `chordCandidates.hidden`/
  content, and `chordRedetect.hidden` all key off `chordTimeline.find((item) => item.start <=
  time && time < item.end)` — genuinely time-dependent, but the *result* (which chord segment,
  if any, is under the playhead) changes at most a few times per song, at segment boundaries.
  This is exactly the shape `publishTransport()`/`sameTransport()` already solve for the
  transport clock: recompute every `draw()` tick, publish to subscribers only when the
  computed projection actually differs.
- `chordInput.value` specifically is the one field that is *also* user-editable — the focus
  guard (`if (document.activeElement !== chordEditor.input) chordEditor.input.value = …`)
  exists only for this one field. Every other field in the row is purely derived, never
  user-typed.
- `capoSelect.value` is not written by `syncChordEditor`/`draw()` at all — only by the two
  discrete sites above. It happens to live in the same container and share the same `hidden`
  flag, which is the entanglement Phase 6b/6e both found, not a per-frame update of its own.

**Consequence:** there is no further split needed here. Unlike 6b→6e (which split "tempo" from
"capo/chord" because tempo had zero rAF entanglement) and 6e→6f (which split "toggle/IO" from
"capo/chord" for the same reason), capo and the chord editor share one container and one
per-frame-recomputed visibility flag *with each other* — moving one without the other would
either duplicate that gating logic in two owners or relocate a control out of its row, both
forbidden by this migration's rules. This slice takes the whole row.

## Design: reuse `publishTransport`'s dedup shape for "chord under the playhead"

`lib/player-application.js` gains a distinct dedup channel, `publishChord`/`subscribeChord`/
`getChordSnapshot`, structurally identical to `publishTransport`/`subscribeTransport`/
`getTransportSnapshot` (a `sameChord` shallow-compare gates notification; `app.js` supplies
`getChordSnapshot: applicationChordSnapshot` at `initialize()` time; `draw()` calls
`playerApplication.publishChord()` unconditionally on every tick, mirroring today's
unconditional `publishTransport()` call). This is a **new, separate store**, not an extension
of `transport` or `notesEdit`: chord/capo state is not "transport" (it doesn't describe
playback), and unlike `notesEdit` it must be recomputed every frame, not just at the discrete
sites `syncNotesChipsVisibility()`/`syncEditToggle()` call `publish()` from.

`applicationChordSnapshot()` (new, in `app.js`) replaces `syncChordEditor(time)`'s DOM writes
with a plain object:

```js
{
  visible,          // chord != null || busy — chordGroup.hidden's negation
  busy,             // chordDetectionPhase !== null
  busyPhase,        // chordDetectionPhase itself: null | 'waiting' | 'detecting'
  capo,             // current fret, 0-11
  playKeyLetter,    // NOTE_LETTERS[...] or null — React composes the tr('notes.playKey', …) text
  inputVisible,     // !!chord && !busy
  inputValue,       // transposeChordLabel(chord.label, -capo) || '', '' when no chord
  inputAmbiguous,   // !!(chord && !chord.edited && chord.candidates?.length > 1)
  inputEdited,      // !!(chord && chord.edited)
  candidatesVisible,// !!chord && !busy && chord.candidates?.length > 1
  candidates,       // [{ value, label }] transposed + confidence-formatted, [] when not shown
  redetectVisible,  // !!chord && !busy
}
```

`segmentStart` (today's `chordEditor.segmentStart`, needed only to address a commit at the
right timeline position) is **not** part of the published/dedup'd object — no presentational
component reads it. It becomes a small module-level `chordSegmentStart` variable in `app.js`,
written by the same function that builds the snapshot above, read only by the new
`commitChord` command handler — the same role it always played, just no longer hung off a DOM
reference object.

### The one genuinely new pattern: a focus-aware controlled `<input>`

`chordInput`'s value is both externally driven (mirrors the chord under the playhead) and
user-editable (typed text staged until blur/Enter). The legacy guard is "don't overwrite the
DOM value while the user is typing in it." The React equivalent needs the same intent without
a DOM read:

- Local component state (`draft`) holds what the input displays.
- A ref (`focusedRef`) tracks whether the field currently has focus.
- An effect syncs `draft` from the published `chord.inputValue` **only when not focused** —
  the direct translation of the `document.activeElement !== chordEditor.input` guard.
- A second ref (`valueAtFocusRef`) captures `draft` at the moment focus begins. On blur, commit
  only if `draft` differs from that captured value — this is what a native `<input>`'s own
  `change` event already does (fires only when the value actually changed since focus), so
  reproducing it explicitly keeps the blur-commit behavior identical to today's `change`
  listener rather than committing on every blur regardless of whether anything was typed.
- Enter still calls `commit(draft)` unconditionally (matching today's keydown handler, which
  never checks "did it change") and then blurs — which, exactly as today, can fire the blur
  commit a second time with the same content when the value did change, since blurring after
  an edit satisfies the "differs from focus-start value" check too. That double-dispatch
  already happens in the legacy code (`commitChord(); chordInput.blur();` — the blur triggers
  the input's own native `change` a second time) — carried forward, not introduced.

This is a real controlled `<input>`, not an imperative escape hatch: the two refs replace one
DOM read (`document.activeElement !== …`) and one implicit browser behavior (`change`'s
"differs from focus-start" semantics) with equivalent explicit state, both well inside normal
React idiom (the same shape any "external value, in-place editable" controlled input needs —
comparable to how a debounced search box holds a draft distinct from the applied query). No
narrower escape hatch is needed anywhere in this row.

### The host: mirrors `publishEditHost`, not `attachLaneCanvas`

`chordGroup`'s actual parent, `zName`, is legacy DOM built inside `buildUI()`'s
first-time-construction branch (Phase 6d made it persist across song loads; it was never
static `index.html` markup). This is exactly Phase 6e's `zEditHost` situation, one level over:
`app.js` creates one stable `<span class="zoom-chord-host">` (kept `display: contents` in
`styles.css`, same trick as `.zoom-chip-host`/`.zoom-edit-host`) at the position `chordGroup`
used to occupy — `zName.append(zTopRow, zChordHost, zLaneSel)` — and hands it to React via a
new `publishChordHost`/`subscribeChordHost`/`getChordHost` channel in
`lib/player-application.js`, structurally identical to `publishEditHost`. React renders the
actual `<div class="zoom-chord-row" hidden={!chord.visible}>…</div>` inside that host — the
`display: contents` wrapper does not carry the row's own class or `hidden`; the rendered child
does, exactly as `EditModeToggle`'s `<label class="notes-ctl zoom-edit-toggle">` is the real
row inside `.zoom-edit-host`.

### Where the components live

Following the Phase 6e precedent exactly: this state has no owner other than `app.js` itself
(unlike `separation`/`detection`/`tempoGrid`, which exist because `separate.js`/`notes.js` have
their own reason to touch the facade). The new components are added directly inside
`components/PlayerShell.jsx`, alongside `EditModeToggle`/`EditIoControls`/`MasterVolume`/
`LoopControls`, not a new file.

- `CapoSelect({ application, chord })` — the `<select class="capo-select">`, options 0–11,
  `value={chord.capo}`, `onChange` → `commands.setCapo(fret)`.
- `ChordInput({ application, chord })` — the focus-aware controlled input described above,
  `onChange`/`onFocus`/`onBlur`/`onKeyDown` → `commands.commitChord(label)`.
- `ChordCandidatesSelect({ application, chord })` — the picker; selecting a candidate calls
  `commands.commitChord(value)` directly (matching today's `chordCandidates` `change` handler,
  which sets `chordInput.value` then calls `commitChord()` — picking a candidate **is** a
  commit, not a separate staging step). Always rendered with `value=""` (a pure action picker,
  like the legacy `<select>`'s own post-pick reset to the empty prompt option).
- `ChordRow({ application, chord })` — the whole `<div class="zoom-chord-row">`: capo
  caption/select, play-key span, chord caption, `ChordInput`, `ChordCandidatesSelect`, redetect
  button, spinner, status span, in the same order `chordGroup.append(...)` used.
- `ChordEditorControls({ application })` — the portalling wrapper: subscribes to
  `subscribeChordHost`/`getChordHost` for the host and to `subscribeChord`/`getChordSnapshot`
  for the per-frame data (two independent `useSyncExternalStore` calls, matching how
  `OverviewLane`/`PrimarySeekControls` read `subscribeTransport` themselves rather than via a
  prop from `PlayerShell`'s top-level `snapshot`), and portals `<ChordRow>` into the host once
  it exists.

`applicationSnapshot()` also gains a `chord: applicationChordSnapshot()` field (mirroring
`transport: applicationTransportSnapshot()`) purely so `readSnapshot()`/the initial
`lifecycleSnapshot()` shape stay consistent — no component reads `snapshot.chord` directly;
`ChordEditorControls` reads the dedicated per-frame channel instead, the same relationship
`transport` already has to `OverviewLane`/`PrimarySeekControls`.

### Commands

Three new commands on `lib/player-application.js`'s `commands` object, delegating to new
`app.js` handlers passed through `initialize()`'s `commands` map:

- `setCapo(fret)` — `capo = Number(fret) || 0; dispatchEvent('sansbass:capochange', {detail:
  {capo}}); draw();` — the exact body of today's `capoSelect` `change` listener, moved.
- `commitChord(label)` — `const trimmed = typeof label === 'string' ? label.trim() : ''; if
  (chordSegmentStart == null || !trimmed) return; dispatchEvent('sansbass:chordedit', {detail:
  {start: chordSegmentStart, label: transposeChordLabel(trimmed, capo)}});` — the exact guard
  and body of today's `commitChord` inner function, moved (validation lives in the handler, not
  duplicated in the React component, since three call sites — blur, Enter, candidate-pick — all
  need the identical guard).
- `redetectChord()` — `dispatchEvent('sansbass:chordredetect')` — unchanged, just relocated.

No new validation helpers are required in `lib/player-application.js` beyond the existing
`requireFinite` for `setCapo`; `commitChord`/`redetectChord` accept any value the same way
`setEditMode`/`exportEdits` do today (the app.js handler itself no-ops on bad input, matching
the legacy guard's own silent-return behavior rather than throwing `PlayerCommandError` for
what was never an error case before).

## What simplifies, and one small existing-behavior improvement

- `buildUI()`'s reuse branch (`else if (anchorTrack)`) drops `if (chordEditor)
  chordEditor.capoSelect.value = '0';` entirely: `capo` is already reset to `0` at the top of
  `buildUI()` (line 581, unchanged), and a React-controlled `<select value={chord.capo}>`
  reflects that on the very next `draw()` tick's `publishChord()` — no imperative DOM reset
  needed, because there is no longer a persisted DOM node with its own stale `.value` to reset.
  This is a real simplification the migration produces, not a behavior change: the visible
  result (capo shows `0` after a song replacement) is identical.
- `retranslate()`'s `if (chordEditor) { … }` block (11 lines: caption/capo-caption/tooltips/
  aria-labels/redetect text/status text) is deleted outright — React re-renders this
  presentation from `useLocale()` on every language switch, the same closed gap Phase 6c's
  edit-list migration already produced for a different control.
- `retranslate()`'s legacy line unconditionally set `chordStatus.textContent =
  tr('notes.chordDetecting')` regardless of `chordDetectionPhase` — so a language switch made
  mid-"waiting for other channel" would show "Detecting…" instead of "Waiting…" until the next
  real state change. Computing the status text from `chord.busyPhase` at render time (as this
  slice does) incidentally fixes that inconsistency, the same way Phase 6c's move to
  render-time translation incidentally added a `langchange` listener the legacy edit list never
  had. Worth naming as a side effect, not scope creep: it falls out of doing the migration
  correctly, not from a separate design decision.

## Preservation rules

| Concern | Required behavior |
|---|---|
| Row visibility | Hidden exactly when there is no chord under the playhead AND detection is not busy, matching today's `chordGroup.hidden` exactly. |
| Capo value/range | A 0–11 fret select; selecting a fret dispatches `sansbass:capochange` with `{capo}` and repaints (canvas chord labels, play-key, and the input's displayed value all reflect the new transposition on the next tick). |
| Capo reset on reuse | A song replacement that keeps the zoomed pane resets the displayed capo to `0`, matching today. |
| Play-key readout | Shows `tr('notes.playKey', {key})` with the capo-transposed tonic letter once a key has been detected; empty otherwise. |
| Chord input visibility/value | Visible only while a chord segment is under the playhead and detection is not busy; shows the capo-transposed label, empty when none. |
| Chord input editing | Typing does not get overwritten by playhead movement while focused; blurring after an actual edit commits `sansbass:chordedit` with the transposed label at the segment under the playhead when focus began typing; Enter commits immediately and blurs. An unfocused visit (focus then blur with no edit) commits nothing. |
| Ambiguous/edited styling | `chord-field.ambiguous` when the segment has more than one detected candidate and has not been manually edited; `chord-field.edited` once it has. |
| Candidates picker | Visible only when the current segment has more than one candidate and is not busy; each option's value is the capo-transposed candidate label with its confidence in the visible text; picking one commits immediately. |
| Redetect | Visible under the same gate as the input; clicking dispatches `sansbass:chordredetect` with no detail, unchanged. |
| Busy state | Spinner and status line visible exactly while `chordDetectionPhase` is non-null; status text distinguishes "waiting for note detection" from "detecting chords" by phase. |
| Locale | Every label/tooltip retranslates on a language switch via `useLocale()`. |
| Remount | Shell unmount/remount loses neither `capo`/`chordTimeline`/`chordDetectionPhase`/`detectedKey` (all `app.js` module state, independent of `PlayerShell.jsx`'s mount state) nor re-dispatches any event. |
| No behavior change to out-of-scope regions | The zoomed canvas's own chord-label overlay (drawn by `renderZoom`, reading `chordTimeline`/`capo` directly — a canvas paint, not a DOM control), the ribbon/overview lanes, the zoom toolbar/fields, and the stem/Notes chip lists are pixel-for-pixel and behaviorally unchanged. |

## Failing-first and implementation increments

1. Extend `tests/player-application.test.js`: the `chord` field's presence and shape in the
   initial snapshot; `commands.setCapo`/`commitChord`/`redetectChord` delegate to the owner
   with the right arguments (mirroring the existing `setEditMode`/`exportEdits`/`importEdits`
   assertions); a deduplicated `publishChord`/`subscribeChord`/`getChordSnapshot` cycle
   (mirroring the existing `publishTransport` dedup test); a deduplicated-by-identity
   `publishChordHost`/`subscribeChordHost`/`getChordHost` cycle (mirroring the existing
   `publishEditHost` test). All added before `lib/player-application.js` changes, so they fail
   first against the current facade shape.
2. Update the three existing `tests/player.test.js` cases that already exercise this region
   end-to-end against the legacy DOM (`shows capo-transposed play chords and play key…`,
   `distinguishes waiting for notes from active chord detection`, and the capo/chord half of
   `keeps the zoomed pane's capo/chord/Edit-notes/Export-Import nodes stable…`) — they query by
   the same classes (`.capo-select`, `.chord-field`, `.capo-play-key`, `.zoom-chord-row
   .chord-status`) and dispatch real `change`/`input` events, so they should keep passing
   structurally unchanged once these are the classes on React-rendered nodes; adjust only where
   React's update timing needs a `waitFor` a synchronous legacy DOM write did not. Add new
   focused cases: typing into the chord field while focused is not clobbered by a simulated
   playhead-driven republish; blurring without editing does not dispatch `sansbass:chordedit`;
   Enter commits and blurs; picking a real candidate option commits its value; a language
   switch retranslates the capo caption, chord caption, tooltips, and redetect button text.
3. Add `chord: applicationChordSnapshot()` to `applicationSnapshot()`, `applicationChordSnapshot`
   as its own function (backing both that field and the new `getChordSnapshot` owner hook), and
   `setCapo`/`commitChord`/`redetectChord` handlers to the `commands: {...}` object passed to
   `playerApplication.initialize(...)`; add `chordSegmentStart` as a module-level variable set
   inside `applicationChordSnapshot()`.
4. Add `chord`'s default shape to `lifecycleSnapshot()`; add the `sameChord`-gated
   `publishChord`/`getChordSnapshot`/`subscribeChord` triplet (mirroring
   `sameTransport`/`publishTransport`/`getTransportSnapshot`/`subscribeTransport`) and the
   `publishChordHost`/`subscribeChordHost`/`getChordHost` triplet (mirroring
   `publishEditHost`/`subscribeEditHost`/`getEditHost`) to `lib/player-application.js`; add
   `setCapo`/`commitChord`/`redetectChord` to its `commands` object (only `setCapo` needs
   `requireFinite`); wire `publishChord`/`publishChordHost` into `dispose()`'s teardown
   alongside the existing `publishTransport`/`publishEditHost` resets.
5. Refactor `app.js`: delete `chordEditor` and its declaration/comment; delete the
   `capoCaption`/`capoSelect`/`playKey`/`chordCaption`/`chordInput`/`chordCandidates`/
   `chordRedetect`/`chordSpinner`/`chordStatus`/`chordGroup` construction block in
   `buildUI()`'s first-time-construction branch, replacing it with one stable
   `<span class="zoom-chord-host">` appended into `zName` in `chordGroup`'s old position and
   registered via `playerApplication.publishChordHost(zChordHost)`; delete the reuse branch's
   `if (chordEditor) chordEditor.capoSelect.value = '0';` line (no longer needed — see above);
   replace the teardown branch's `chordEditor = null;` with
   `playerApplication.publishChordHost(null); chordSegmentStart = null;`; delete
   `syncChordEditor()` entirely and its call site in `draw()`, replacing it with
   `playerApplication.publishChord();` alongside the existing `playerApplication.
   publishTransport();` call; delete the `if (chordEditor) chordEditor.capoSelect.value =
   String(capo);` line from the `sansbass:chords` listener; delete the `if (chordEditor) { … }`
   block from `retranslate()`.
6. Add `CapoSelect`, `ChordInput`, `ChordCandidatesSelect`, `ChordRow`, and the portalling
   `ChordEditorControls` to `components/PlayerShell.jsx`; render
   `<ChordEditorControls application={application} />` from `PlayerShell`'s top-level return,
   beside the existing `<EditModeControls .../>` line.
7. Update `styles.css` with the one-line `.zoom-chord-host { display: contents; }` rule,
   matching `.zoom-chip-host`/`.zoom-edit-host`.
8. Run focused tests, then `npm test`, `npm run build`, `git diff --check`, and an exact-source
   local production smoke at root and a nested route (a generated stems ZIP for the
   loaded-song precondition, a faked Worker plus a dispatched `sansbass:chords` event for the
   detection/chord-timeline precondition, real capo/candidate/redetect interaction, and a real
   focus/type/blur sequence on the chord field) before opening the PR.

## Out of scope

The zoomed canvas's own chord overlay painting (`renderZoom`, reading `chordTimeline`/`capo`
directly to draw the compact chord band on the waveform), the ribbon/overview canvases, the
zoom toolbar/fields, the stem/Notes chip lists, and every other already-accepted React-owned
region stay untouched. `capo`, `chordTimeline`, `chordDetectionPhase`, `detectedKey` remain
`app.js` module state — this slice changes who *presents* derived views of them, not who owns
them. The `window.sansBass` bridge's remaining members stay untouched. Completing this slice
finishes Phase 6 in full; Phase 7 (legacy UI retirement and release acceptance) may begin after
its own documentation-anchor PR merges.
