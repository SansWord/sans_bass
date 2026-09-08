# React migration Phase 6b — tempo/grid controls plan

Status: planned from `d073e58...` (documentation-anchor merge for Phase 6a, PR #88) on
2026-09-07. Previous accepted implementation rollback anchor: Phase 6a at
`61e2b29683404aca736b69625517ec8b69e25df1`, documented through
[PR #87](https://github.com/SansWord/sans_bass/pull/87) and anchored through
[PR #88](https://github.com/SansWord/sans_bass/pull/88).

This is the second of Phase 6's three sub-slices as named in `docs/react-migration.md`
("interpretation/key/display controls, then tempo/grid/capo/chord controls, then
selection/edit/undo/import/export controls"). The audit below finds that the capo control and
the zoomed pane's chord display/editing are not separable from still-legacy ribbon/zoomed-pane
rendering without restructuring that pane's mount lifecycle — out of this slice's stated scope
— so this slice's actual bounded outcome is narrower than that phase-overview line: **the
shared `#notes-tempo` panel only**. See "Scope decision: capo and chord stay legacy-owned this
slice" below for the full reasoning and what it means for the roadmap document.

## Audit — current ownership

| Region / behavior | Owner today | Notes |
|---|---|---|
| `#notes-tempo` (Show-grid checkbox, BPM field, ×½/×2, phase field + nudge buttons, beats-per-bar select, "Select BPM range" toggle, Re-detect button, status line) | `tempoEl.*` (module-level DOM lookups in `notes.js`, built once from static `index.html` markup), written by `syncTempoControls()`, read by nine `addEventListener` handlers. | A clean, static, standalone `<section id="notes-tempo" class="notes" hidden>` in `index.html` (lines 153–192), a sibling of `#notes-vocals`/`#notes-bass`/`#lanes` — **not** nested inside another still-legacy section the way `#notes-tune-{stem}` was inside `#notes-{stem}` for Phase 6a. It is never rebuilt by `buildUI()`; only its `hidden` flag and control values change across a song load. This is the same static-portal-host shape Phase 5a/5b/6a's regions already had (`#notes-detect`, `#notes-meta-{stem}`, `#notes-tune-{stem}`) — safe to portal in one piece. |
| Capo control (`capoCaption`/`capoSelect`, plus the module-level `capo` variable and `sansbass:capochange` listener) | Built by `app.js`'s `buildUI()` inside the zoomed pane's per-song construction (`if (anchorTrack) { … }`), appended into `chordGroup` alongside the chord fields. `notes.js` only holds `capo` and reacts to the `sansbass:capochange` event; it owns no DOM here. | See "Scope decision" below — entangled with the chord row and the zoomed pane's per-song rebuild, not with `#notes-tempo`. |
| Chord display/editing (`chordGroup`/`chordEditor`: chord input, candidates dropdown, redetect button, spinner, waiting/detecting status) | `app.js`, built and updated entirely inside `buildUI()`/`syncChordEditor()`. | See "Scope decision" below. |
| Edit list (`#notes-edits-{stem}`), list-export row (`#notes-list-io-{stem}`) | `renderEditList()`, `els.listExport`. | Out of scope — the note editor, the third Phase 6 sub-slice. Untouched. |
| Ribbon/zoomed-pane note-lane rendering itself (canvases, zoom pan/lane-selection chips, edit-mode toggle) | `app.js`, `#note-lanes-root` (still legacy per `CLAUDE.md`). | Out of scope by the task's own instruction. Untouched. |

### Scope decision: capo and chord stay legacy-owned this slice

The task's audit instructions asked whether the capo control and the zoomed pane's chord
display/editing can move without also requiring ownership of the surrounding ribbon/zoomed
note-lane canvas rendering. They cannot, for two independent, compounding reasons found by
reading `app.js`:

1. **The chord row is driven by the same per-frame, audio-clock-tied function that paints the
   zoomed canvas.** `draw()` — the rAF loop — calls `renderZoom(zoomEl.canvas)` and then
   `syncChordEditor(t)` in the same block (`app.js` around line 1955–1961), where `t` is the
   current playhead time. `syncChordEditor(time)` looks up "the chord under the playhead"
   (`chordTimeline.find(...)`) and rewrites `chordEditor.input.value`, `.candidates`,
   `.playKey.textContent` (which itself reads the module-level `capo` to transpose), and the
   row's own `hidden` state, on **every rendered frame**, not on discrete user events. This is
   the same category of per-frame, clock-driven DOM write that the migration architecture
   explicitly keeps outside React everywhere else in this codebase — it is exactly why primary
   seek/lane/Overview canvas *painting* stayed in `app.js` while only their throttled,
   discrete-event-driven siblings (transport time text, A/B badges) moved to React through a
   deduplicated projection (`docs/react-migration.md`: "Keep rAF for drawing… Audio scheduling
   remains outside React renders and effects"). Making the chord editor's live fields React
   state would mean re-rendering that subtree on every rAF tick from a mutable external ref —
   the specific pattern this migration has avoided at every prior canvas-adjacent slice.
2. **The chord row's DOM container does not survive a song load.** `chordGroup` is created
   fresh every time `buildUI()` runs `el.noteLanesRoot.innerHTML = ''` and rebuilds the entire
   ribbon/zoomed-pane subtree, gated on `anchorTrack` (whether a vocals/bass stem exists in the
   new song) — the same per-song teardown problem the Overview lane had *before* Phase 4b
   pulled it out into its own always-mounted React root specifically so it would stop being
   destroyed and rebuilt every song (see `CLAUDE.md`: "unlike a per-track lane, the Overview
   lane isn't keyed to any one `song.tracks[]` entry, so it never remounts across a song
   replacement"). No equivalent extraction exists yet for the zoomed pane; performing one is
   itself "ribbon/zoomed-pane note-lane rendering," which the task states is out of scope
   unless inseparable from the controls being migrated — and here the dependency runs the
   other way: giving the chord row a React-owned, non-rebuilt-per-song host requires that
   restructuring, not the reverse.

The capo control is not separable from the chord row either: `capoSelect` is appended into the
same `chordGroup` DOM node as the chord fields, is shown/hidden together with them, and its
value is only ever read back by `syncChordEditor`'s per-frame transposition of the chord
input/candidates and the play-key readout — moving it alone would relocate a control that is
visually and functionally part of one row to a different DOM position, which the migration
rules forbid ("preserve appearance").

**Consequence for `docs/react-migration.md`:** Phase 6's overview line ("tempo/grid/capo/chord
controls") is updated in the separate documentation-anchor PR that follows this implementation
PR — matching the exact split Phase 4a/4b/5a/5b/6a already used (`docs/react-migration.md`,
`docs/react-migration-evidence.md`, `docs/devlog.md`, and `CLAUDE.md`'s ownership description
all land in that follow-up PR, opened once this slice's production deployment is verified, not
in the implementation PR itself) — to record that 6b's actual deliverable is tempo/grid controls
only, with capo/chord explicitly named as a still-open sub-slice blocked on a future zoomed-pane
mount-lifecycle restructuring (not yet scheduled) rather than silently folded into 6c, which is
a different concern (the edit list/undo/import-export).

### Scope decision: a new store, not an extension of `detection`

`detection`'s existing shape is **per-channel** (`channels.vocals`/`channels.bass`), populated
by `createNotesChannel()`'s closures and gated on `!!frames`. Tempo/grid state is **module-level
and shared** — one grid, derived from the drums stem, read by both channels — with a real
Worker of its own (`Re-detect tempo`'s `notes.worker.js` instance, independent of either
channel's analysis worker) and a `redetecting` in-flight flag that has no per-channel analogue.
Bolting a second, differently-shaped state tree (no `channels` key, a `redetecting` flag,
Worker-lifecycle fields) onto `detection`'s existing snapshot would force every `detection`
consumer to learn a shape that has nothing to do with per-channel detection, and would tie this
slice's Worker-failure/song-token handling to a store named for something else. This is the same
"state has no owner other than this module, give it its own store" reasoning `CLAUDE.md` already
documents for `separation` (Phase 5a) and `detection` (Phase 5b) themselves — applied again here
because tempo genuinely is a different shape of state, not because every module-level concern
automatically deserves its own store. The new store, `tempoGrid`, uses the exact same
`subscribe`/`getSnapshot`/`commands` shape as `separation` and `detection` for consistency, with
no `stem` dispatch parameter on any command (tempo has none).

### Re-verified: the `window.sansBass` early-import hazard

`notes.js` is already reachable from `app.js`'s own static import graph before `app.js`'s body
sets `window.sansBass` (via `PlayerShell.jsx` → `DetectionPanel.jsx`/`InterpretationPanel.jsx`,
established since Phase 5b) — adding `components/TempoPanel.jsx` to that same import graph
introduces no new reachability path, only a new consumer of an already-reachable module. The one
place this slice's new code reads `window.sansBass` is inside `tempoView()`'s `hasDrums`
computation, which is the exact same `!!window.sansBass?.stemBuffer?.('drums')` line
`syncTempoControls()` already carries today (already optional-chained since Phase 5b's own fix
for this hazard — see that phase's devlog `[gotcha]`). The new `publishTempo()` function is
called synchronously from the bottom-of-file `refreshAll()` → `refreshTempo()` call
(`notes.js` line 1021, which runs during module evaluation, before `window.sansBass` exists)
exactly where `syncTempoControls()` was already called from that same path — no new unguarded
member is introduced. No new guard is needed.

## Bounded outcome (Phase 6b)

A new `components/TempoPanel.jsx` exports one component:

- `TempoPanel()` — owns the entire `<section id="notes-tempo">` region: the Show-grid checkbox,
  BPM field, ×½/×2 buttons, phase field + back/forward nudge buttons, beats-per-bar select,
  "Select BPM range" toggle, Re-detect button, and status line. Portalled into a new
  `#tempo-ui-root` host that replaces `#notes-tempo`'s static markup in `index.html`, matching
  `#notes-detect` → `#detection-ui-root`'s exact Phase 5b precedent (a whole self-contained
  section, not a sub-region nested in a still-legacy parent). Always mounted, matching
  `DetectionControls`'s unconditional-mount pattern; the component renders its own `hidden` from
  the published `visible` field, so no wrapping condition is needed in `PlayerShell`.

Every id inside the section is unchanged from the legacy markup (`notes-tempo-on`,
`notes-tempo-bpm`, `notes-tempo-half`, `notes-tempo-double`, `notes-tempo-phase`,
`notes-tempo-phase-back`, `notes-tempo-phase-fwd`, `notes-tempo-beats`, `notes-tempo-range`,
`notes-tempo-redetect`, `notes-tempo-status`), and so are the classes (`notes`, `notes-row`,
`notes-ctl`, `mini`, `notes-stats`, `note-tbtn-armed`), so `styles.css` keeps working unmodified.

`notes.js` gains a module-level `tempoGrid` export (`subscribe`/`getSnapshot`/`commands`, the
same shape `separation`/`detection` established) and a `tempoRedetecting` flag alongside the
existing `tempo`/`tempoRange`/`tempoRangeArmed` state. It loses: `tempoEl` (the object of nine
DOM lookups) entirely, the nine `addEventListener` registrations on those elements (replaced by
`tempoGrid.commands` functions React calls directly), and the direct DOM writes in
`syncTempoControls()` (renamed `publishTempo()`, now producing a published view instead — same
"renamed once its only remaining job changed" precedent as Phase 5b's
`syncJianpuControls()` → `syncExportAvailability()`) and `refreshTempo()`/`resetTempo()`.

`notes.js` keeps: the Worker lifecycle for both per-channel analysis and tempo re-detection,
`tempo`/`tempoRange`/`tempoRangeArmed`/`capo` state itself, `applyTempoResult()`,
`currentTempoRangeChannels()`, the `sansbass:capochange`/`sansbass:temporange`/
`sansbass:temporangemode`/`sansbass:tempo`/`sansbass:songload` event adapters (all untouched —
`app.js` on the other side of each of these reads/writes nothing from `#notes-tempo`'s DOM, so
none of them change shape), the chord timeline/detection scheduling, and the `detection` store
(untouched — a different store for a different shape of state, per the scope decision above).

`app.js` keeps 100% of the zoomed pane, capo control, and chord editor exactly as they are today
— no changes to `app.js` are needed for this slice, since it never referenced `#notes-tempo`'s
DOM directly (only the custom events already listed, which are unchanged).

## Preservation rules

| Concern | Required behavior |
|---|---|
| Panel visibility | `#notes-tempo` (its React host's rendered content) is hidden until `tempo.confidence > 0`, in lockstep with today's `refreshTempo()`. Resets to hidden on every song load (`resetTempo()` zeroes confidence, publishes). |
| Show tempo grid checkbox | Never disabled by `hasDrums` (matching today — it is deliberately excluded from the `disabled = !hasDrums` loop), toggles `tempo.on` and re-derives both channels' grids live via `reinterpretAll()`, no re-analysis. |
| BPM field | `disabled` exactly when `!hasDrums`, editing sets `tempo.bpmValue`/`tempo.auto = false` and re-derives live, same `type="number"` min/max/step attributes as the legacy markup. |
| ×½ / ×2 | Halve/double `tempo.bpmValue` (rounded to 0.1), set `tempo.auto = false`, re-derive live; `disabled` exactly when `!hasDrums`. |
| Phase field + nudge buttons | Editing sets `tempo.phaseMs`/`auto = false`; back/forward buttons nudge by the same `PHASE_NUDGE_MS = 10` constant; all three `disabled` exactly when `!hasDrums`. |
| Beats-per-bar select | Same four options (2/3/4/6, default 4), sets `tempo.beatsPerBar`/`auto = false`, re-derives live; `disabled` exactly when `!hasDrums`. |
| Select BPM range toggle | Toggles `tempoRangeArmed`, dispatches `sansbass:temporangemode` exactly as today (drives `app.js`'s drag-arming of the drums lane — untouched), renders the `note-tbtn-armed` class when armed instead of the legacy `classList.toggle`; `disabled` exactly when `!hasDrums`. |
| Re-detect tempo | Posts to a fresh `notes.worker.js` instance with the current `tempoRange`-sliced drums audio, ignores late results from a stale song via `playerApplication.isCurrentSongToken`, disabled for the duration of the request (new `tempoRedetecting` flag) in addition to `!hasDrums`, applies a successful `tempo` result via the unchanged `applyTempoResult()`, surfaces a worker error via the unchanged `window.sansBass.say('notes.failed', …, true)`. |
| Status line | Same `notes.tempoStatus`/`notes.tempoStatusNone` i18n keys and interpolation (`bpm` to one decimal, `pct` rounded percent), computed at render time from published `bpmValue`/`confidence`, matching the render-time-translation convention since Phase 4b. |
| Locale | Every label/status retranslates correctly on a language switch via `useLocale()`. |
| Remount | Shell unmount/remount does not lose tempo state or restart the re-detect worker — the state lives in `notes.js`'s own module scope, independent of `PlayerShell.jsx`'s mount state. |
| Capo control and chord display/editing | Explicitly out of scope this slice (see "Scope decision" above) — pixel-for-pixel and behaviorally unchanged; `app.js`'s DOM nodes and listeners for them are untouched. |
| No behavior change to out-of-scope regions | The edit list, list-export row, ribbon/zoomed-pane canvases, zoom pan/lane-selection chips, and edit-mode toggle are pixel-for-pixel and behaviorally unchanged. |

## Failing-first and implementation increments

1. Extend the focused production-entry Chromium suite (`tests/player.test.js`) with cases run
   against the **current legacy owner** first, to record expected failures, then made to pass by
   the implementation below (using `installFakeWorker`/`loadZip`/`waitFor`, emitting a
   `{ type: 'result', frames: {…}, tempo: { bpmValue, phaseSec, confidence } }` message on the
   detection worker to make `#notes-tempo` visible, matching the existing "Find notes" fake-
   worker pattern):
   - the panel is hidden before a confident tempo result and visible after one, matching the
     existing meta-row/tune-row visibility precedent;
   - editing the BPM field, clicking ×½/×2, and nudging phase live-update `notes-tempo-status`
     and survive a language switch without losing the entered value;
   - "Select BPM range" toggles the `note-tbtn-armed` class and dispatches
     `sansbass:temporangemode` with the correct `on` value;
   - "Re-detect tempo" round-trips through a second fake Worker instance (`workers[1]`),
     disables itself for the duration, and applies the returned BPM/phase on success; a fake
     worker error surfaces via the existing status-line mechanism instead of crashing.
2. Refactor `notes.js`: delete the `tempoEl` object and its nine `addEventListener`
   registrations; add `tempoRedetecting` state; rename `syncTempoControls()` to
   `publishTempo()`, changing its body from DOM writes to producing/broadcasting a frozen view
   object (`visible`, `hasDrums`, `on`, `bpmValue`, `phaseMs`, `beatsPerBar`, `confidence`,
   `rangeArmed`, `redetecting`); update every call site (`resetTempo()`, `refreshTempo()`,
   `importEntry()`'s tempo-restore branch, the Re-detect worker's `onmessage`/`onerror`) to call
   `publishTempo()`; add `tempoGrid.commands` (`setOn`, `setBpm`, `halveBpm`, `doubleBpm`,
   `setPhase`, `nudgePhase`, `setBeatsPerBar`, `toggleRangeArmed`, `redetect`) built from the
   bodies of the nine deleted listeners; export `tempoGrid` with the same
   `subscribe`/`getSnapshot`/`commands` shape as `separation`/`detection`.
3. Add `components/TempoPanel.jsx`.
4. Update `index.html` (replace `#notes-tempo`'s markup with `<div id="tempo-ui-root"
   class="react-portal-host"></div>` at the same position) and `components/PlayerShell.jsx` (add
   the `tempo` host, portal `<TempoPanel />` unconditionally, matching `DetectionControls`).
5. Run focused tests, then `npm test`, `npm run build`, `git diff --check`, and an exact-source
   local production smoke at root and a nested route (a generated stems ZIP with a drums stem for
   the loaded-song precondition, a faked Worker for the detection/re-detect flow itself) before
   opening the PR.

## Out of scope

The capo control and the zoomed pane's chord display/editing (see "Scope decision" above,
deferred pending a future zoomed-pane mount-lifecycle restructuring), the edit list
(`#notes-edits-{stem}`), the list-export row (`#notes-list-io-{stem}`), and the
ribbon/overview/zoomed-pane lanes themselves (canvases, zoom pan/lane-selection chips, edit-mode
toggle) stay untouched and legacy-owned. The `window.sansBass` bridge's remaining members stay
untouched. Real-Worker/model smoke and physical-handheld evidence remain separate,
deployment-and-release-level checks per `docs/testing.md` and `docs/behaviour.md`, not routine
test dependencies for this slice.
