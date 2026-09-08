# CLAUDE.md — sans_bass

Orientation for a fresh session. Read this instead of re-deriving the project from scratch.

## What this is

A local, dependency-free multitrack **stem player** for practising along to records. You rip
a CD you own, run Demucs AI source separation on it to get per-instrument tracks, then load
those into a browser page that shows a waveform per instrument and lets you solo any one of
them and loop a phrase.

```
CD  →  rip to FLAC  →  Demucs (htdemucs_6s)  →  encode .m4a  →  index.html
```

The point is drilling a part: solo the bass, set A/B around the four bars you keep fluffing,
loop it. Not a DAW, not a mixer, not a library manager — one song at a time.

## Hard constraints — do not break these

- **npm + Vite build the site; React is for component UI only.** `npm run dev` for local
  dev, `npm run build` for `dist/`, both CI workflows build before publishing. The player
  core is `index.html`, `styles.css`, `app.js` plus `lib/stems.js` and `lib/unzip.js`.
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
  6c — see `docs/react-phase-6b-tempo-chord-controls-plan.md`'s scope decision for the full
  reasoning. `notes.js` retains the Worker lifecycle, tempo/chord detection state, the note
  editor, and export/import; the edit list, list-export row, chord detection/editing, and the
  zoomed pane remain legacy-owned, deferred to that future capo/chord sub-slice and Phase 6c
  (originally scoped as "selection/edit/undo/import/export controls"). Phase 6c adds
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
  migration rules forbid — see `docs/react-phase-6c-editor-export-controls-plan.md`'s scope
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
  `detectedKey` stay `app.js` module state — only presentation moved. Phase 2's DOM-independent
  command/subscription facade in `lib/player-application.js` remains the only UI-to-player
  seam; React invokes its commands and renders its published transport snapshot.
  Audio, analysis,
  serialization, canvas renderers, Workers, and AudioWorklets stay ordinary JavaScript
  modules outside React. Vanilla JS remains the default where a component lifecycle is not
  needed. `file://`
  support was dropped in v1.5.0. `app.js` and every `lib/*.js` file (`stems.js`, `i18n.js`,
  `platform.js`, `unzip.js`, `ribbon.js`, `jianpu.js`, `transport-math.js`, `analytics.js`)
  are real ES modules as of v1.21.0 — actual `import`/`export`, not just the
  `type="module"` loading mechanism the npm + Vite migration (v1.20.0) switched them to.
  `separate.js` and `notes.js` (already ESM themselves) import these `lib/*.js` files
  directly too, as of v1.21.1 — see the next bullet.
- **A module's public surface is its `export`s — a `window.SansX` global is a bridge, never
  a default.** Every ESM file in this repo (`lib/pitch.js`, `lib/wav.js`, `lib/zip.js`,
  `lib/overlap.js`, `lib/sonify.js`, `lib/tempo.js`, `app.js`, `separate.js`, `notes.js`, and
  every `lib/*.js` file) exports what it wants read; it does not also assign a global on the
  chance something might want one later — that is designing for a hypothetical future
  consumer, the same thing this project's conventions already rule out for features. No file
  in this repo currently carries a `window.SansX` bridge — the last five
  (`lib/i18n.js`'s `window.SansI18n`, `lib/platform.js`'s `window.SansPlatform`,
  `lib/analytics.js`'s `window.SansAnalytics`, `lib/jianpu.js`'s `window.SansJianpu`, and
  `lib/pitch.js`'s `window.SansPitch`) were removed in v1.21.1 once `separate.js` and
  `notes.js` were converted to import them directly (and `app.js`'s one remaining
  `window.SansPitch.parseNoteName` read, in `commitPitchDropdown()`, was converted the same
  way — that bridge's actual reader had drifted from what its own comment claimed). See
  [`docs/superpowers/specs/2026-09-02-esm-modules-design.md`](superpowers/specs/2026-09-02-esm-modules-design.md)
  for the original design. The exception this rule still allows is a **documented, named
  bridge** for a specific consumer that genuinely cannot `import` yet — none currently exist,
  but if a real one shows up, add it back narrowly and commented, the way these were; never a
  global "for consistency with the other files" or "in case something needs it."
- **Nothing leaves the machine.** No audio egress ever. No uploads of user content. One
  cookieless, anonymous usage beacon (GoatCounter) reports **event names only** — never
  audio, never filenames, never song titles. Every event name is a compile-time constant
  or a stem id from a fixed set of seven; see `lib/analytics.js`. Inbound fetches are
  allowed and necessary: the ONNX runtime from jsDelivr and the ~285 MB model from
  Hugging Face. Keep the distinction — "no outbound audio", not "no network calls".
- **Deployable as a static site.** GitHub Pages hosts it with no backend. This depends on
  `ort.env.wasm.numThreads = 1` (no SharedArrayBuffer → no COOP/COEP, which Pages cannot
  set). Never commit the 285 MB model; it is fetched at runtime.
- **Audio never touches the main thread's timing.** See below.

## Architecture in one pass

`app.js` (sectioned by comment banners: helpers / loading / UI / transport /
A-B repeat / routing / input).

- **Player boundary.** `lib/player-application.js` exports the singleton application facade
  plus a factory for tests. `app.js` explicitly initializes it and remains the sole owner of
  decoded tracks, song/UI state, audio scheduling, and transport algorithms. Immutable
  snapshots are a read-only projection, stable between publications; commands never mutate a
  second store. The facade owns only lifecycle, command errors, subscriptions, registered
  cleanup, and song-operation identity. React UI mount/unmount is separate from application
  lifetime and does not dispose or reset the engine.

- **Sync model.** Every stem is decoded to an `AudioBuffer` and played from *one*
  `AudioContext` clock — all `BufferSource`s `start(t0, offset)` at the same `t0`
  (`LOOKAHEAD` = 60 ms). That is what makes six stems sample-locked. Six `<audio>` elements
  would drift audibly.
- **Muting is gain, never stop.** Each track has its own `GainNode` into a master gain.
  Muting ramps gain to 0 (`setTargetAtTime`) so the track stays locked to the timeline.
- **Transport lives on the audio graph, not in `requestAnimationFrame`.** rAF is throttled in
  background tabs. End-of-song comes from `onended` on the longest source; A–B repeat uses
  the node's own `loop`/`loopStart`/`loopEnd`. **rAF is for drawing and only drawing.** This
  project has learned that lesson three separate times — see the devlog.
- **Waveforms** are peak envelopes on a fixed time grid (`BUCKETS` = 1400) so lanes of
  different lengths stay aligned. Each lane is normalised to its own peak (capped at 8×),
  because a bass stem at natural level draws as a flat line; the overview keeps true dynamics.
  Idle and active versions are pre-rendered offscreen, so a frame is a blit plus a clip.
- **In-browser separation** (`separate.js`, `separate.worker.js`) is additive and optional.
  The worker owns ONNX Runtime and `htdemucs_6s`; `lib/overlap.js` plans the segments;
  `lib/wav.js` and `lib/zip.js` handle saving. `separate.js` loads as a plain
  `<script type="module">` **and**, since Phase 5a, is also imported directly by
  `components/SeparationPanel.jsx` for its `separation` export (`subscribe`/`getSnapshot`/
  `commands`) — the same "both a script-tag entry and an import target" pattern `app.js` and
  every `lib/*.js` file already use, with no duplicate module evaluation (verified by the
  Phase 5a build/smoke evidence). The conditional injection that guarded `file://` went with
  `file://` support in v1.5.0. `app.js` and `lib/stems.js`/`lib/i18n.js`/`lib/platform.js`
  are real ES modules too (since v1.21.0), imported directly by app.js and the tests alike.
  Since v1.8.0 the whole panel is **gated to desktop** — see the handheld gotcha below.
- **Stem identity comes from the filename** (`detectStem`). Demucs' output names land in the
  right lanes untouched. The `mix` pattern is deliberately narrow (`\bmix\b|\bfull\b|…`) —
  a false positive there suppresses every other track.

- **Deployment is CI-owned.** `main` publishes to the root of the Pages site and every pull
  request gets a live preview at `/pr-<N>/`, both written to the `gh-pages` branch by
  `.github/workflows/`. Never hand-edit `gh-pages`. See [`docs/deployment.md`](docs/deployment.md).

`scripts/rip-cd.sh` — mounted audio CD (macOS presents it as `.aiff`) → lossless FLAC.
`scripts/prep-stems.sh` — one FLAC → 6 stems → `.m4a`, with MPS/CPU auto-detection.

## Repo layout

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
not-yet-scheduled sub-slice (see `docs/react-phase-6b-tempo-chord-controls-plan.md` and
`docs/react-phase-6c-editor-export-controls-plan.md`). Phase 6d resolved that entanglement as
a pure, ownership-neutral refactor: the zoomed pane now persists across a song replacement
that keeps a vocals/bass stem (its own `#zoom-lane-root`, separate from `#note-lanes-root`,
built once and reused rather than torn down every `buildUI()` call — see
`docs/react-phase-6d-zoomed-pane-mount-refactor-plan.md`). `components/PlayerShell.jsx`'s
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
commit semantics — not an imperative escape hatch. This completes Phase 6. Phase 7 audited
`app.js`, `lib/player-application.js`, and every `components/*.jsx` file for leftover
migration adapters and found none removable: every `window.sansBass` member, every
`sansbass:*` event, every DOM attach hook, and every CSS selector still has a live consumer —
each phase's own audit had already retired its scaffolding as it went. Phase 7's actual work
was documentation accuracy (rewording comments that called permanent bridges "temporary") and
a chained real-build acceptance pass; see `docs/react-phase-7-retire-legacy-plan.md` and
`docs/react-migration-evidence.md`'s Phase 7 section. The incremental React migration
described by this file is complete.
Its locale/application and focused transport-frame
subscriptions and document drag listeners clean up on UI
unmount without disposing the player. React-owned descendants carry no `data-i18n`, so the
legacy dictionary traversal cannot overwrite them. Component-specific styles should be
colocated when needed; these components reuse the established shared classes in `styles.css`.

`app.js` remains authoritative for decoded tracks, song/transport/routing state, audio,
master gain smoothing, loop timing, and all legacy player regions after loading. It publishes
stable status keys, master volume, a narrow routing projection, a deduplicated
transport-frame projection, and per-lane `muted`/`volume` fields rather than writing the
React-owned status, volume, loop, routing-control, lane, or transport presentation. It still
paints
pixels and intrinsic dimensions on the React-owned
primary and per-lane canvases through explicit lifecycle attachments (`attachPrimarySeekCanvas`,
`attachLaneCanvas`), and populates the drums lane's React-owned extra-content host
(`attachLaneExtra`) with its legacy tempo-range hint. It paints the React-owned Overview
canvas (`attachOverviewCanvas`) with `overviewStems()`'s combined peaks and populates its
extra-content host (`attachOverviewExtra`) with its legacy range-select caption — unlike a
per-track lane, this single unkeyed lane is never remounted by React across a song
replacement that keeps a vocals/bass stem, so its host references are owned entirely by
these attach/detach hooks rather than reset on every song load. Its own `#note-lanes-root`
(ribbon/zoomed pane, still legacy — Phase 6) sits beside `#standard-lanes-root` and
`#overview-lane-root` inside `#lanes`; all three are `display: contents`, so `order` alone —
computed independently on each side from the same track order — recovers the original
interleaved visual order with no cross-owner DOM
references. `sansbass:transport` remains a temporary exact-clock adapter for the
two notes sonifiers. The lowercase `window.sansBass` bridge remains only for named
notes/separation service operations and browser-harness application/shell
lifecycle checks; it is migration debt, not the public ESM API.

`npm run dev` and `npm run build` first generate `demos/index.html` from files directly
inside `public/demos/`. Vite bundles the generated list as an entry and copies the demo
exports unchanged. Edit the generator, not the ignored generated HTML. See
[`docs/deployment.md`](docs/deployment.md#publishing-html-demos) for publishing rules.

```
index.html  styles.css  app.js     the player (app.js: ESM, real import/export)
lib/stems.js                       stem identity — ESM, no window bridge
lib/unzip.js                       zip reading — ESM, no window bridge
lib/player-application.js          DOM-independent player commands, snapshots and lifecycle
lib/i18n.js                        zh-TW/en dictionary + runtime — ESM, no window bridge
components/{SiteHeader,DemoHeader,PlayerShell}.jsx  React headers + player loading shell
components/SeparationPanel.jsx     React separation-panel presentation (Phase 5a)
components/DetectionPanel.jsx      React detection-controls presentation (Phase 5b)
components/InterpretationPanel.jsx React interpretation-controls presentation (Phase 6a)
components/TempoPanel.jsx          React tempo/grid-panel presentation (Phase 6b)
components/EditorPanel.jsx         React edit-list/list-export-row presentation (Phase 6c)
components/useLocale.js            cleaned React locale subscription
demos.jsx                          demo React mount plus legacy title/count localization
scripts/build-demos.js             generates the ignored demos/index.html before dev/build
public/demos/                      explicitly published HTML demos; source files are committed
lib/platform.js                    isHandheld() device predicate — ESM, no window bridge
lib/{wav,zip,overlap}.js           ESM — WAV encode, ZIP write, segment planning
lib/pitch.js                       ESM — YIN, candidates, Viterbi decoding, segmentation,
                                   octave folding, key
lib/sonify.js                      ESM — plays detected notes back as tones
lib/ribbon.js                      ribbon geometry — ESM, no window bridge
lib/jianpu.js                      簡譜 degrees — ESM, no window bridge
separate.js  separate.worker.js    ESM — separation service/Worker lifecycle and the ORT
                                   inference loop; presentation is components/SeparationPanel.jsx
notes.js  notes.worker.js          ESM — notes panel and the analysis worker; shared
                                   detect-button and per-channel meta-row presentation is
                                   components/DetectionPanel.jsx, each channel's
                                   interpretation-row presentation is
                                   components/InterpretationPanel.jsx, and the shared
                                   tempo/grid-panel presentation is components/TempoPanel.jsx,
                                   and each channel's edit-list/list-export-row presentation is
                                   components/EditorPanel.jsx. The Edit-notes toggle and shared
                                   Export/Import edits JSON buttons, and the capo control and
                                   chord display/editing, are React-owned via
                                   components/PlayerShell.jsx (Phase 6e, Phase 6f)
tests/*.test.js                    units      → `npm test` (Vitest; see vitest.config.js)
tests/parity.html                  accuracy   → window.__parity
tests/notes.html                   notes+key  → window.__notes
.github/workflows/                 Pages deploy + per-PR previews + `npm test` gate
                                   (see docs/deployment.md)
package.json  vite.config.js       npm scripts (dev/build/preview/test), Vite multi-page
                                   build config
vitest.config.js                   unit test config — three tiers (node/jsdom/browser),
                                   see the comment at its top for which tier a file needs
dist/                               build output (git-ignored; CI builds it, never committed)
scripts/rip-cd.sh                  CD → rips/*.flac
scripts/prep-stems.sh              one song → stems/<song>/*.m4a
rips/    <track>.flac, <album>/<track>.flac      ~560 MB, local only
stems/   <album>/<track>/{vocals,guitar,bass,drums,piano,other}.m4a
docs/                              see below
```

`rips/` and `stems/` hold the user's own ripped audio. Never publish, upload, or copy them
out of the project; never commit them.

## Docs

- [`README.md`](README.md) — the user-facing pipeline: ripping, Demucs setup, batching an
  album, controls, A–B repeat.
- [`docs/product-contract.md`](docs/product-contract.md) — the durable promises the product
  makes to users, without selectors or test procedure. Use `docs/behaviour.md` for executable
  smoke/acceptance scenarios and this contract to decide whether a proposed behaviour change
  changes what the product promises.
- [`docs/testing.md`](docs/testing.md) — the authoritative test-layer placement guide: Node
  for pure logic, jsdom for non-rendering DOM/storage, headless Chromium for browser APIs and
  player integration, local/deployed smoke for build boundaries, and manual acceptance for
  irreducibly auditory or physical-device behavior. **Read this before adding or moving
  tests.**
- [`docs/devlog.md`](docs/devlog.md) — version-by-version log with tagged learnings
  (`[note]` / `[insight]` / `[gotcha]`). **Read the v1.0.0 and v1.1.0 entries before touching
  the transport or the loader** — most of the non-obvious traps are already written down there.
- [`docs/behaviour.md`](docs/behaviour.md) — what the player is supposed to *do*, as
  observable outcomes with a way to observe each one, plus the browser-test harness (faking
  a separation run, reading gain ramps, the traps that make a working app look broken).
  **Read this before changing UI behaviour, and update it in the same commit when you do.**
  Its **Deployment verification** section defines three levels: affected-boundary checks on
  every PR preview, a compact delivery canary after every merge, and a full deployed smoke
  for deployment-sensitive changes or release acceptance. Select the level from the changed
  boundary; do not repeat the full interactive workflow on both URLs by default.
- [`docs/transcription.md`](docs/transcription.md) — how a stem becomes notes: the four
  layers (audio → frames → notes → edits), which are re-derivable and which can be lost,
  what each interpretation parameter measurably does, and why beat tracking is not the fix
  for spiky notes. **Read this before touching `lib/pitch.js` or anything consuming it.**
- [`docs/tuning-cases.md`](docs/tuning-cases.md) — a log of cases where a missing or wrong
  note came from a music-domain assumption (an instrument's tuning or range) baked into a
  detection parameter, not a coding bug. **Check this before chasing a "note missing" report
  as a fresh bug** — it may be the same shape as one already solved.
- [`docs/chord-detection.md`](docs/chord-detection.md) — the export-time chroma, vocal-key,
  bass-slash, and sequence-decoder pipeline; its real-fixture regression check and known
  limitations. **Read this before changing chord scoring or progression priors.**
- [`docs/deployment.md`](docs/deployment.md) — how the site is hosted: GitHub Pages off the
  `gh-pages` branch, the three CI workflows, per-PR preview URLs, and the rules that keep
  `rips/`, `stems/` and the model unpublished. **Read this before touching
  `.github/workflows/`.**
- [`docs/roadmap.md`](docs/roadmap.md) — work that is wanted but not built: note editing,
  automatic octave folding, YouTube-link ingest. An index pointing at where each is
  specified, plus the question that has to be settled before each can be designed.
- [`docs/session-prompts.md`](docs/session-prompts.md) — the prompts that produced the
  original build, timestamped from filesystem evidence.

## Gotchas that will bite again

- **There are exactly two ways in, and that is the design.** One audio file (a whole song,
  which is also the separation entry point), or one `.zip` of stems. Since v1.6.0 both go
  through a single **Load song or zip** button and a single `#file-input`; `loadAny()`
  dispatches on the extension. Drop accepts the same two things and nothing else. Don't
  re-add multi-file loading or folder drop "for convenience" — each extra path was a way to
  fail silently. And keep `#file-input` clearing its own `value` on change, or picking the
  same file twice in a row is a silent no-op.
- **Folder drop is deliberately unsupported — don't add it back.** It needed the directory
  entries API, which Chrome blocks on `file://`, so it only ever worked over http and failed
  silently otherwise. v1.3.0 deleted the recursive walk (`walkEntry`/`fsCall`, ~40 lines); a
  zip does the same job on every protocol. A dropped folder is still *detected*, purely to
  tell the user to zip it — that message is the feature, not a leftover.
- **Callback-pair DOM APIs need their error callback wired.** No longer live in this repo —
  `fsCall` went with the folder walk — but the lesson is why that code existed:
  `new Promise(res => reader.readEntries(res))` hung forever on a blocked read, with no error
  anywhere. If you ever wrap a `(successCb, errorCb)` API, wire both and add a timeout.
- **`AudioContext` stays `suspended` until a real user gesture.** Under browser automation,
  synthetic clicks on the play button silently fail to unlock it; a real `space` keypress
  works. If the clock reads 0 while `playing` is true, this is why.
- **A looping source never fires `onended`** — end-of-song detection is attached only when
  `!src.loop`.
- **The AudioContext must be 44.1 kHz.** `decodeAudioData` resamples to the context rate,
  and the separation model requires 44100. A default context is often 48 kHz on macOS,
  which would feed the model stretched audio and produce wrong stems with no error at all.
- **A mix file alongside stems must carry `stem: 'mix'` explicitly.** With seven tracks the
  lone-file rule in `assignStems` does not fire, and a real song title matches none of the
  deliberately narrow mix patterns — so the mix would be summed on top of its own six stems
  at double volume. Covered by a test in `tests/stems.test.js`. In-browser separation avoids
  the question by dropping the original: `loadSeparated` builds lanes from the six stems
  only, which is also why `__hasStems` is false there and every lane starts unmuted.
- **Cache-busting is now Vite's content hash, not a hand-written `?v=`.** GitHub Pages still
  pins everything to `max-age=600` with no way to override it, but every asset Vite's build
  touches — every entry HTML's `<script src>`/`<link href>`/`<img src>`, and every
  `new Worker(new URL(...))` / `addModule(new URL(...))` reference — gets a content hash
  baked into its filename, so a stale `app.js` against a fresh `index.html` is no longer
  reachable: the fresh `index.html` points at the fresh `app.js`'s hashed name, not the old
  one. There is no version to bump by hand, and no `tests/versions.test.js`-shaped test is
  needed — it was deleted along with the manual `?v=` convention it guarded.
- **Separation is desktop-only, and that is not fixable from this repo.** On iOS the first
  `session.run()` kills the tab; the accumulators, the 285 MB model, the memory floor,
  WebGPU and asyncify were each ruled out by measurement, and `N_SAMPLES = 343980` is baked
  into the ONNX graph. `lib/platform.js` answers the question — coarse primary pointer AND
  `maxTouchPoints > 1`, both required — and `separate.js` reads it **once** at module init
  (`refresh()` runs every 400 ms). The test is capability-shaped on purpose: iPadOS reports
  itself as a Mac, so `/iPhone|iPad/` would miss it entirely, and Android phones very likely
  fail the same way. Don't try to make separation run there.
- **UI strings live in `lib/i18n.js`, and both locales must move together.** `data-i18n`
  sets `textContent`, `data-i18n-html` sets `innerHTML` (our own dictionary values only,
  never user data), `data-i18n-attr` sets attributes. Adding a key to one locale and
  forgetting the other is caught by `tests/i18n.test.js`, as is a `{placeholder}` that
  drifts between them. Lane labels translate; **stem ids and filenames never do** — a
  saved zip is `vocals.wav` in every language.
- **Top-level wiring goes through `on()`, never `addEventListener` directly.** Same reason: a
  single null element must not be able to take out the rest of the app. If you add a listener
  at the top level of `app.js`, use the helper.
- **A class that sets `display` silently defeats the `hidden` attribute.** `[hidden]` is a
  UA-stylesheet rule, and *any* author rule beats it — `.btn { display: inline-block }` left
  Save, Cancel and the loop badge on screen while their `.hidden` property read `true`.
  Verifying with `el.hidden` or `hasAttribute('hidden')` passes while the user still sees the
  button; check `getComputedStyle(el).display`. `styles.css` now carries a global
  `[hidden] { display: none !important; }` that every hidden-toggle in the app depends on.
- **`numThreads = 1` is load-bearing, not a performance tweak.** It avoids SharedArrayBuffer,
  which avoids COOP/COEP, which is what makes static hosting (GitHub Pages) possible at all.
- **ZIP filenames need general purpose bit 11 set.** Without it the spec says names are
  CP437, and every Chinese song title extracts as mojibake. macOS's bundled Info-ZIP
  `unzip` ignores the bit anyway and still displays garbage — verify with `ditto -xk`,
  `bsdtar` or Python's `zipfile`, not `unzip -l`.
- **The overlap window barely matters.** Overlap-add normalises by the weight sum, so the
  output is a weighted average of near-identical predictions. Trapezoid and raised cosine
  measured identical to three decimals. Don't spend time tuning it.
- **Check a workflow's *conclusion*, not that it ran.** Two workflows sharing a concurrency
  group let GitHub cancel one as "pending"; the v1.2.0 merge deployed nothing and reported
  no failure anywhere. Same rule as audio here: observe the outcome, not the parameters.
- **Before testing ANYTHING against a real deploy — smoke test or otherwise — check the
  page's own `#build-sha` corner badge first**, not just that the workflow's conclusion was
  `success`. GitHub Pages pins `index.html` itself to `Cache-Control: max-age=600`
  independent of the content-hashed asset names, and a v1.24.0 verification session was
  fooled by exactly this: `deploy-main.yml` had already succeeded, but the loaded page kept
  serving the previous build's `main-*.js` and silently reproduced the pre-fix bug, looking
  like a real regression. Compare `#build-sha`'s text against the commit you expect —
  `git rev-parse --short HEAD` on `main` for a production check, or
  `gh pr view <N> --json mergeCommit --jq .mergeCommit.oid` for a PR preview (its badge is
  GitHub's synthetic merge-commit SHA, not the branch's own tip — see the v1.25.0 devlog
  entry). On a mismatch, reload with a cache-busting query string or a fresh tab and check
  again before concluding anything — a `deploy-main.yml`/`pr-preview.yml` success does not
  by itself mean the browser in front of you is showing that build yet.
- **`rsync -a` skips a changed file of the same size** (it compares size + mtime). The deploy
  workflows use `-c`. Without it the site serves stale content and nothing errors.
- **Demucs setup:** Python 3.12 (no PyTorch wheels for 3.14), install `numpy` explicitly
  (demucs 4.1.0 doesn't declare it), skip `torchaudio`. Probe for MPS with the venv's own
  interpreter — a bare `python3` is the system one and has no torch, which silently drops
  every run to CPU.
- **Near-silent `piano`/`other` stems are correct** for a guitar band, not a bug. Verify with
  `ffmpeg -af volumedetect` before chasing it.
- **`htdemucs_6s` is the only model that splits out guitar.** Don't switch to plain `htdemucs`.
- **`allow_local` is deliberately not set.** GoatCounter filters localhost and private-IP
  requests, so events fired from `npm run dev` silently vanish — which looks exactly
  like broken instrumentation. Verify with `SansAnalytics.setSink(console.log)` instead;
  flip `allow_local` only if the network leg itself needs proving, and never commit it.
- **`play` is instrumented in `toggle()`, not `play()`.** `play()` is re-entered by `seek()`
  and `refreshLoop()`, so counting there would fire on every scrub during playback.
- **No event name may carry user content.** Stem ids come from `t.stem`, never
  `laneLabel()`. An empty `title` is passed to GoatCounter explicitly: it fills that field
  from the surrounding element or the document title when omitted. Harmless today, because
  `document.title` is always the static `app.title` string — but making the title dynamic
  (`"<song> — sans_bass"`) is an obvious future change, and it would silently start putting
  song names in the payload. Pin the field rather than relying on the title staying static.

## Working conventions

- **Git repository** with `rips/` and `stems/` gitignored (the `.gitkeep` files are kept).
  Devlog timestamps come from `git log`.
- **Every session starts on a branch and lands on `main` through a PR.** Never commit to
  `main` directly — not for code, not for docs, not for a one-line fix. Branch first, before
  the first commit, using the existing prefixes: `feat/`, `fix/`, `ui/`, `docs/`, `spike/`.
  This is not ceremony. Each PR gets its own live preview at `/pr-<N>/`
  (see [`docs/deployment.md`](docs/deployment.md)), so the branch is the only way to click
  through a change before it reaches the published site — and `main` publishes to the root
  the moment it moves. A design-only session branches too; the spec is reviewed the same way
  the code is.
- **Every PR verifies its preview; every merge verifies production, at different depths.**
  Follow [`docs/behaviour.md`](docs/behaviour.md)'s tiered deployment verification:
  the PR preview owns the affected user behavior and public-host boundary, while the
  post-merge production check is normally a delivery canary — successful workflow
  conclusion, matching `#build-sha`, page boot without load/console errors, and one affected
  route or control when relevant. Repeat the full deployed smoke on both preview and
  production only when the change affects Vite/base paths, deployment workflows, entry HTML,
  Workers/AudioWorklets, caching, or other behavior that can differ between `/pr-<N>/` and
  `/`, and for explicit release acceptance. Real-song, real-model, handheld, auditory, and
  exhaustive visual checks run only when their boundary changed or a release gate calls for
  them. Check the workflow's *conclusion*, not merely that it ran, and compare `#build-sha`
  before drawing conclusions from either URL. Prefer focused selectors and compact result
  summaries; capture full accessibility trees or screenshots only when structure or visual
  appearance is under review. This real-host evidence complements `npm run dev` and
  `npm run build` plus `npm run preview` during development.
- **Unit tests run under `npm test` (Vitest), CI-gated on every PR.** `vitest.config.js`
  splits `tests/*.test.js` into three tiers by what each file actually needs — plain Node,
  jsdom (for the files that assign a `window.SansX` bridge or touch `document` at module
  load), or headless Chromium via Playwright (for real `AudioContext`/`OfflineAudioContext`
  or a real module `Worker`, neither of which Node or jsdom implements) — see the comment
  at the top of that file before moving a test between tiers. `tests/parity.html` is a
  separate, manual browser page for separation accuracy against the native stems in the
  repo (read `window.__parity`); it needs `npm run dev` (or `npm run build` plus
  `npm run preview`) and is not part of `npm test` since it needs local-only `rips/`/`stems/`
  audio that CI never has. Everything the unit tests cannot reach — the whole UI — is
  specified in [`docs/behaviour.md`](docs/behaviour.md), harness included.
- **Versioning:** three-part semver. `vX.Y.0` for releases, `vX.Y.1` for follow-up sessions,
  `vX.Y.0-design` for design-only sessions. Devlog headings, TL;DR anchors, and any tags match.
- **Devlog at end of session.** Newest-first, update the TL;DR table with an anchor link, and
  tag every learning bullet `[note]` / `[insight]` / `[gotcha]`.
- **[`docs/behaviour.md`](docs/behaviour.md) is part of the diff.** A behaviour change that
  does not update it leaves the two disagreeing, and the doc is what the next session trusts.
- **Verify audio behaviour by observing audio, not parameters.** Loop bounds being set is not
  evidence the audio wraps; sampling the playhead across laps is. Fault-inject where the real
  environment can't be reproduced (`file://` is not reachable from browser automation).
