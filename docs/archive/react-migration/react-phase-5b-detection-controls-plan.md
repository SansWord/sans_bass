# React migration Phase 5b — detection controls plan

Status: planned from `64ee010...` (documentation-anchor merge for Phase 5a, PR #84) on
2026-09-07. Previous accepted implementation rollback anchor: Phase 5a at
`ffe5ed511ffbceeb5871cc4c45bbec8570a50c51`, documented through
[PR #83](https://github.com/SansWord/sans_bass/pull/83) and anchored through
[PR #84](https://github.com/SansWord/sans_bass/pull/84).

The zoomed pane, tempo/chord controls, the ribbon/notes lanes, and the note editor
(interpretation knobs, edit list, list/edits export/import) are explicitly out of scope —
`docs/react-migration.md`'s Phase 5 increment boundary calls out separation and detection as
separate PR-sized slices, and Phase 6 owns "interpretation/key/display controls" as a whole.
This plan covers only the shared detection trigger and each per-stem panel's completion
summary, matching the task's own enumerated scope (see "Bounded outcome" below).

## Audit — current ownership

`notes.js` is materially larger and more stateful than `separate.js` was at Phase 5a: it owns
two independent per-channel state machines (vocals/bass), a shared tempo grid derived from
drums, chord detection/editing, and a note editor — all module-level or per-channel closures,
all still writing DOM directly today.

| Region / behavior | Owner today | Notes |
|---|---|---|
| Shared Find-notes button/spinner/status (`#notes-detect`) | Module-level `syncGoAll()` calls the already-pure, already-tested `detectionView(channels)` from `lib/detection-state.js` and writes three DOM fields (`hidden`, `disabled`, `hidden` on the spinner, `textContent` on the status span). | `detectionView()` needs no changes — same "reuse an existing pure derivation unchanged" pattern Phase 4a/4b/5a established for `separationView()`. Only the DOM-writing caller (`syncGoAll()`) moves. |
| Per-channel completion state | Each `createNotesChannel(stem, els)` closure holds `frames`/`notes`/`jianpu` and derives `state()` (`'absent'`/`'pending'`/`'running'`/`'complete'`), consumed by `detectionView()` above. | Unaffected; `state()` is already a pure read of closure variables, reused unchanged by the new store. |
| Per-stem panel meta row (`#notes-meta-{stem}`: count, Show/Hide button, 簡譜 checkbox, key tonic/mode selects, relative-key ⇄ button) | Each channel writes `els.count.textContent`, toggles `els.show.hidden`/its label text via `syncShowLabel()`, and `syncJianpuControls()` writes `els.keyTonic.value`/`els.keyMode.value`/disables all three key controls together. | This is the task's named scope. See "Scope decision on the relative-key button" below for why the ⇄ button moves with the two selects rather than staying legacy. |
| Per-stem panel interpretation row (`#notes-tune-{stem}`: shortest-note slider, Advanced fold/hmm/clip controls) | Same channel closure, `syncFoldControls()`, `currentParams()`. | Out of scope — Phase 6's "interpretation/key/display controls" bucket, per the migration doc. Untouched. |
| Per-stem edit list (`#notes-edits-{stem}`) and list-export row (`#notes-list-io-{stem}`) | Same channel closure, `renderEditList()`, `editGroups`. | Out of scope — the note editor, explicitly Phase 6. Untouched. |
| Panel section visibility (`<section id="notes-vocals" hidden>` itself) | `refresh()`'s `els.panel.hidden = !frames`. | Stays legacy — the section still contains legacy-owned tune/edit/list-io content that must remain visible under the same "has frames" gate. Only the meta row *inside* the section moves; the section boundary itself is unaffected. |
| Shared tempo grid (`#notes-tempo`) | Module-level `tempoEl`/`syncTempoControls()`/`refreshTempo()`. | Out of scope — explicitly named in the task and the migration doc's Phase 6 bucket. Untouched. |
| Chord detection/editing (zoomed-pane chips, chord edits) | `scheduleChordDetection()`, `publishChords()`, `sansbass:chordedit`/`sansbass:chordredetect` listeners. | Out of scope — the zoomed pane, explicitly excluded by the task. Untouched. |
| Note editor (select/add/delete/move/resize/repitch/snap, Export list, Export/Import edits) | Per-channel `editGroups`, `els.listExport`, module-level `sansbass:exportedits`/`sansbass:importedits` listeners. | Out of scope — Phase 6. Untouched. |
| Two independent vocals/bass channels | Each is its own `createNotesChannel(...)` closure instance with its own `els` map, `frames`, `jianpu`, etc.; nothing is shared except the module-level `tempo`/`chordTimeline` (both out of scope) and the shared Find-notes button. | The new store must keep this independence: publishing one channel's state must never overwrite or block the other's, and the shared button's view is a pure function of *both* channels' `state()` together — exactly what `detectionView()` already does. |
| `notes.worker.js` message protocol, YIN/interpretation algorithms | `notes.worker.js`, `lib/pitch.js`. | Unchanged; explicitly out of scope per `react-migration.md`. |

### Scope decision on the relative-key (⇄) button

The task names "count, Show/Hide notes button, 簡譜 checkbox, and key tonic/mode selectors."
The relative-key ⇄ button is not named, but it lives inside the exact same
`<span class="notes-ctl notes-key">` as the two selects, shares their disabled condition
(`!jianpu.on`) verbatim (`for (const c of [els.keyTonic, els.keyMode, els.keyRel]) c.disabled =
!jianpu.on;`), and calls a pure function already exported from `lib/pitch.js`
(`relativeKey(tonic, mode)`) to compute its effect. Splitting one three-element flex row across
two DOM owners (React rendering the two selects, legacy code reaching into the middle of a
React-owned parent to keep writing the third element) would violate "one owner per DOM region"
for no benefit — there is no legacy-only behavior left in that span once the selects move.
Decision: the whole `.notes-key` span (label, both selects, ⇄ button) moves to React as one
unit. This is recorded here per the task's instruction not to assume.

### Scope decision on the increment boundary

The task's audit instructions raise the possibility of splitting further (shared Find-notes
control first, then per-stem panels as a second slice). Decision: keep them as **one PR-sized
slice**, for the same reason Phase 4a shipped both standard lanes in one PR rather than one PR
per lane: the shared button's own view (`detectionView()`) is a pure function of *both*
channels' state together, so testing it meaningfully already requires both channels wired up;
and the per-stem meta rows have no independent behavior worth shipping (and reviewing) apart
from the button that triggers the analysis they display the result of. Splitting would add a
second full PR/CI/deploy cycle without a corresponding reduction in per-PR risk or review
surface — the same reasoning `react-migration.md`'s own phrasing ("detection controls" named
as a single slice, unlike "separation panel and detection controls" naming two) already
implies.

### Decision: extend `notes.js`'s own export surface, not `lib/player-application.js`

Same reasoning as Phase 5a's `separation` export, and already anticipated by the current
CLAUDE.md text ("the same way `notes.js` owns its own detection state"). Detection
pending/running/complete state, note counts, and 簡譜/key settings are not player/song/transport
state — they are `notes.js`'s own feature state, with no owner other than `notes.js`. Nothing
in the migrated presentation needs a *new* fact from `playerApplication` that notes.js doesn't
already reach through its own closures or the existing temporary `window.sansBass` bridge
(`ribbonVisible`/`setRibbonVisible`, already used for the Show/Hide button). No new
`lib/player-application.js` commands or `applicationSnapshot()` fields are added.

`notes.js` gains a small subscribe/snapshot/commands surface of its own, the same shape
`separate.js` already established:

```js
export const detection = {
  subscribe(listener) { ... },   // returns an unsubscribe function
  getSnapshot() { ... },         // returns the last published immutable view
  commands: {
    findNotes,                        // shared button: analyse whichever channel needs it
    toggleShow(stem),                 // per-channel Show/Hide
    setJianpuOn(stem, on),            // per-channel 簡譜 checkbox
    setKey(stem, tonic, mode),        // per-channel key tonic+mode selects (read together)
    useRelativeKey(stem),             // per-channel ⇄ button
  },
};
```

Published snapshot shape:

```js
{
  detect: { sectionVisible, buttonDisabled, spinnerVisible, busyStems },  // detectionView() output, untranslated stem ids
  channels: {
    vocals: { visible, count, showOn, jianpuOn, tonic, mode },
    bass:   { visible, count, showOn, jianpuOn, tonic, mode },
  },
}
```

`count` is published as a raw integer and translated at **render** time
(`t('notes.count', { n: count })`), not resolved to a string at publish time — the same
render-time-translation principle Phase 4b/5a established for the Overview label and the
separation status line, so a language switch always retranslates correctly without a dedicated
`sansbass:langchange` listener for these fields. `showOn` is `window.sansBass.ribbonVisible(stem)`
read at publish time (the Show/Hide label itself — "Show notes" vs. "Hide notes" — is chosen at
render time from this boolean, matching `separationView`'s pattern of publishing state and
translating in the component). `busyStems` stays as raw stem ids (`'vocals'`/`'bass'`); the
component maps each through `t('stem.' + id)` at render time, matching today's
`tr('stem.' + stem)` call inside `syncGoAll()` but moved to render time for the same reason.

Unlike Phase 5a's `resolveStatusParams`, there is no thunk-valued param to resolve here — no
new `lib/detection-state.js` export is needed beyond the existing `detectionView()`.

`lib/pitch.js` gains one new export, `PITCH_CLASS_NAMES` (lifted from the existing private
`NOTE_NAMES` array already in that file, `const PITCH_CLASS_NAMES = NOTE_NAMES;` at line 477).
`notes.js`'s own private duplicate array (`const PITCH_CLASSES = [...]`, used for populating the
legacy `<option>` elements and in the Export-list title) is replaced by importing this one
export, so the new React component and `notes.js` share exactly one source of the 12 pitch-class
names rather than maintaining two copies that could drift.

## Bounded outcome (Phase 5b)

A new `components/DetectionPanel.jsx` exports two components:

- `DetectionControls` — owns the entire `#notes-detect` subtree (Find-notes button, spinner,
  busy-channel status), portalled into a new `#detection-ui-root`, replacing
  `<section id="notes-detect" class="notes">...</section>` in `index.html` the same way Phase 5a
  replaced `#sep`. Always mounted (not gated by `snapshot.song`) — the legacy section is already
  visible-but-disabled with no song loaded, matching `detectionView()`'s own `sectionVisible`
  input being `true` when both channels are `'absent'`.
- `NotesChannelPanel({ stem })` — owns one channel's meta row: count, Show/Hide button, 簡譜
  checkbox, and the `.notes-key` span (tonic select, mode select, ⇄ button). Mounted twice
  (`stem="vocals"` and `stem="bass"`), each portalled into its own new host
  (`#notes-meta-vocals-root` / `#notes-meta-bass-root`) that replaces the corresponding
  `<div id="notes-meta-{stem}" class="notes-row" hidden>...</div>` **inside** the existing
  `<section id="notes-{stem}" class="notes" hidden>`, which stays otherwise legacy-owned (its
  own `hidden` toggle, the label row, the tune/edits/list-io siblings). Both channel panels are
  always mounted, mirroring `SeparationPanel`'s unconditional-mount pattern; each renders its
  own `hidden` for its row from the published `visible` field, so no wrapping condition is
  needed in `PlayerShell`.

Matching Phase 5a's `#separation-ui-root` → `<section id="sep">` pattern exactly, each new host
div is an empty `react-portal-host` at the position the legacy element used to occupy, and the
component renders the *original* element id as a child of that host: `#detection-ui-root` hosts
`<section id="notes-detect">`; `#notes-meta-vocals-root` hosts `<div id="notes-meta-vocals">`;
`#notes-meta-bass-root` hosts `<div id="notes-meta-bass">`. Every other id inside those elements
is unchanged from the legacy markup too (`notes-go-all`, `notes-detect-spinner`,
`notes-detect-status`, `notes-count-{stem}`, `notes-show-{stem}`, `notes-jianpu-{stem}`,
`notes-key-tonic-{stem}`, `notes-key-mode-{stem}`, `notes-key-rel-{stem}`), and so are the
classes, so `styles.css` (class-selector only) and the existing Chromium assertion referencing
`notes-go-all`/`notes-vocals` in `tests/player.test.js` keep working unmodified.

`notes.js` keeps: the Worker lifecycle (`analyse()`'s `getWorker`-equivalent inline creation,
`onmessage`/`onerror`), `interpret()`/`applyEdits()` interpretation, tempo, chord detection/
editing, the note editor, export/import, and the `playerApplication.subscribe`-driven
song-token invalidation (`refresh()`/`reset()` per channel). It loses: `syncGoAll()`'s three DOM
writes, `syncShowLabel()` (deleted — folded into the published `showOn` + render-time `t()`),
the per-channel `<option>`-building loop for the tonic select (deleted — React renders its own
options from `PITCH_CLASS_NAMES`), the two lines of `syncTips()` that set `title` on the
now-React-owned jianpu label and ⇄ button (the remaining four lines — hmm/clip/fold/foldTol
tooltips — stay), and `syncJianpuControls()`'s three now-React-owned lines (its remaining single
line, `els.listExport.disabled = !notes.length`, is kept under a renamed
`syncExportAvailability()` since it no longer has anything to do with 簡譜).

## Preservation rules

| Concern | Required behavior |
|---|---|
| Shared button visibility/disabled/spinner | Identical to `detectionView()`'s existing three booleans — unchanged input, only the DOM write moves. Visible-and-disabled with no melodic stem ever loaded; hidden once every present stem is analysed; spinner and "Detecting: <stems>" status name exactly the channel(s) still running. |
| Two independent channels | A channel's own detection, count, Show/Hide, 簡譜, and key state is never affected by the other channel's state changes, except through the shared button's `busyStems`/`buttonDisabled` (which already depends on both, unchanged). |
| Count | Same integer as `notes.length` today, translated identically (`notes.count` with `{n}`), and now also correctly retranslates on a language switch (an ownership-transfer side effect, not a targeted fix — the legacy code already handled this case via the `sansbass:langchange` listener's `els.count.textContent = tr(...)` line, so this is parity, not new behavior). |
| Show/Hide button | Visible exactly when the channel has frames (matching today's `els.show.hidden` flipping in lockstep with the meta row); label toggles "Show notes"/"Hide notes" from live `ribbonVisible(stem)`, and clicking still calls the existing `setRibbonVisible` bridge command with the same toggle semantics. |
| 簡譜 checkbox and key selects | Checked/values match `jianpu.on`/`jianpu.tonic`/`jianpu.mode` exactly; selects and the ⇄ button are disabled exactly when `!jianpu.on`, matching today. Changing either select reads the *other* select's current value from the published snapshot so both are always applied together, matching today's `els.keyTonic.value`/`els.keyMode.value` pair-read. The ⇄ button computes the exact same `relativeKey(tonic, mode)` result and marks `jianpu.auto = false`, matching today. |
| Note count / key auto-detection interaction | Toggling 簡譜, changing key, or using the relative-key button still calls `reinterpret()` (unchanged), which still recomputes `notes`/`orphaned`/chord scheduling/sonify resync exactly as today — only the DOM-writing tail of `reinterpret()` changes (the removed `els.count.textContent` line and renamed `syncJianpuControls()` → `syncExportAvailability()`). |
| Section-level visibility | `<section id="notes-{stem}">`'s own `hidden` toggle (`refresh()`) is completely unaffected — still legacy, still gates on `!!frames`, in lockstep with the React-owned meta row's own `visible` field (both derived from the same `frames` fact, at different DOM nodes). |
| Locale | Count, Show/Hide label, 簡譜 label/tooltip, "1 =" / major / minor labels, relative-key tooltip, Find-notes label, and the busy-stems status all retranslate correctly on a language switch, sourced from `t()` at render time like every other React-owned control. |
| Remount | Shell unmount/remount does not restart a running Worker, lose `frames`/`notes`/`jianpu`, or duplicate the `playerApplication` subscription — `notes.js`'s own subscription/channel lifecycle is independent of `PlayerShell.jsx`'s mount state, matching every other React-owned control. |
| Stale results | A worker whose song token no longer matches, or a new `load` in progress, still resets each channel via the existing `reset()`/`refresh()` path; the panel reflects the reset via the same `publish()` call added at the end of `reset()`. |
| No behavior change to out-of-scope regions | Tune/Advanced controls, edit list, list-export, tempo grid, chord detection/editing, and the zoomed pane are pixel-for-pixel and behaviorally unchanged; their DOM nodes and listeners are untouched. |

## Failing-first and implementation increments

1. Add a focused Node/component-level assertion is unnecessary for `detectionView()` itself (no
   change). Instead, extend the focused production-entry Chromium suite (`tests/player.test.js`)
   with cases run against the **current legacy owner** first, to record expected failures, then
   made to pass by the implementation below:
   - a fake-Worker detection run whose language is switched mid-`running` state correctly
     retranslates the busy-channel status and the eventual count (proving render-time
     translation, not a stale captured string);
   - toggling 簡譜 and changing the key tonic/mode selects updates the displayed reading and
     survives a language switch without losing the selection;
   - the Show/Hide button's label and the ribbon's actual visibility stay in sync across a
     click, matching the existing `ribbonVisible`/`setRibbonVisible` bridge contract;
   - the existing "ignores stale notes and separation Worker results after replacement or
     disposal" test (`tests/player.test.js`) must keep passing unmodified against the new
     ids/markup — extend its assertions to also check that the vocals meta row's count/show
     controls reset to their initial (hidden) state after the stale result is discarded, not
     only the section-level `hidden` it already checks.
2. Add `PITCH_CLASS_NAMES` to `lib/pitch.js`; update `notes.js` to import it instead of its
   private duplicate.
3. Refactor `notes.js`: add the module-level `listeners`/`lastView`/`publish()` (recomputes
   `detect` via `detectionView()` plus each channel's new `view()`), add each channel's
   `view()`/`toggleShow()`/`setJianpuOn()`/`setKey()`/`useRelativeKey()`, call `publish()` at the
   end of `reinterpret()` and `reset()`, and once per tick at the end of `refreshAll()`. Delete
   `syncGoAll()`, `syncShowLabel()`, the tonic `<option>`-building loop, the two now-dead lines
   of `syncTips()`, and the three now-dead lines of `syncJianpuControls()` (renaming its
   remainder to `syncExportAvailability()`). Remove the corresponding `els.*` entries
   (`meta`, `count`, `show`, `jianpu`, `keyTonic`, `keyMode`, `keyRel`) from both
   `channels.push(createNotesChannel(...))` call sites and every listener registered on them.
   Export the `detection` object.
4. Add `components/DetectionPanel.jsx` (`DetectionControls`, `NotesChannelPanel`).
5. Update `index.html` (replace `#notes-detect` with `#detection-ui-root`; replace
   `#notes-meta-vocals`/`#notes-meta-bass` with `#notes-meta-vocals-root`/
   `#notes-meta-bass-root` inside their existing sections) and `components/PlayerShell.jsx` (add
   the three hosts, portal `<DetectionControls />` and two `<NotesChannelPanel stem="..." />`
   instances, unconditionally like `SeparationPanel`).
6. Run focused tests, then `npm test`, `npm run build`, `git diff --check`, and an exact-source
   local production smoke at root and a nested route (a generated stems ZIP with a vocals+bass
   pair for the loaded-song precondition, a faked Worker for the detection flow itself, since
   the real YIN pipeline is never re-verified in routine UI-ownership verification) before
   opening the PR.

## Out of scope

The zoomed pane's own two "Notes" chips, tempo/grid/phase/beats/BPM-range controls, chord
detection/editing, the interpretation row (shortest-note slider, Advanced fold/hmm/clip
controls), and the entire note editor (select/add/delete/move/resize/repitch/snap, Export list,
Export/Import edits JSON) stay untouched and legacy-owned, deferred to Phase 6 per
`react-migration.md`'s own increment boundary. The `window.sansBass` bridge's remaining members
(`ribbonVisible`/`setRibbonVisible`, `stemBuffer`, `setNotes`, `ribbonMuted`, `notesAudio`,
`transport`, `say`) stay untouched — narrowing them further is not needed to give React
ownership of detection *presentation*. Real-Worker/model smoke (the real YIN pipeline) and
physical-handheld evidence remain separate, deployment-and-release-level checks per
`docs/testing.md` and `docs/behaviour.md`, not routine test dependencies for this slice.
