# React migration Phase 6a — interpretation and key/display controls plan

Status: planned from `2a1df52...` (documentation-anchor merge for Phase 5b, PR #86) on
2026-09-07. Previous accepted implementation rollback anchor: Phase 5b at
`3e241da4a05831f49bff5d680b92474dddea28a9`, documented through
[PR #85](https://github.com/SansWord/sans_bass/pull/85) and anchored through
[PR #86](https://github.com/SansWord/sans_bass/pull/86), completing Phase 5.

This is the first of Phase 6's three sub-slices (`docs/react-migration.md`: "Migrate
interpretation/key/display controls, then tempo/grid/capo/chord controls, then
selection/edit/undo/import/export controls"). The edit list, list-export row, tempo grid,
chord detection/editing, the ribbon/zoomed-pane lanes, and the note editor are explicitly out
of scope — later Phase 6 sub-slices.

## Audit — current ownership

Since Phase 5b, each channel's `<section id="notes-{stem}">` already has one React-owned
region (`#notes-meta-{stem}-root`, count/Show-Hide/簡譜/key) sitting beside three
still-legacy regions: the interpretation row (`#notes-tune-{stem}`), the edit list
(`#notes-edits-{stem}`), and the list-export row (`#notes-list-io-{stem}`). This slice moves
only the first of those three.

| Region / behavior | Owner today | Notes |
|---|---|---|
| Shortest-note slider + readout (`#notes-tune-{stem}`'s first `label.notes-ctl`) | `els.min`/`els.minOut`, read by `currentParams()`, written by `reinterpret()`'s `els.minOut.textContent` line. | Value lives only in the DOM element itself — `currentParams()` reads `Number(els.min.value)` directly. React ownership requires lifting this into channel-closure state, the same way jianpu's `tonic`/`mode` already are. |
| Advanced disclosure (`<details class="notes-adv">`): fit-to-melody/clip checkbox, whole-phrase/hmm checkbox, fix-octave-outliers/fold checkbox + its tolerance slider, folded/muted stats | `els.clip`/`els.hmm`/`els.fold`/`els.foldTol`, read by `currentParams()`; `syncFoldControls()` derives the folded/muted counts by iterating `notes` and writes `els.foldTolOut`/`els.foldStats` DOM text. | Same DOM-as-state pattern as the slider above. `syncFoldControls()`'s counting loop (`n.fix.state === 'folded' / 'doubt'`) is the one piece of derivation logic worth lifting into a pure, testable function — see the decision below. |
| Row-level visibility (`#notes-tune-{stem}` itself) | `els.tune.hidden`, set by `reset()` (`true`) and `analyse()`'s success handler (`false`). | Gated on the exact same fact the React-owned meta row already publishes: `!!frames`. No new fact is needed — `view().visible` (Phase 5b) already carries it. |
| Tooltips on the four Advanced rows (`hmm`/`clip`/`fold`/`foldTol` parent-element `title`) | `syncTips()`, called once at channel construction and on every `sansbass:langchange`. | `syncTips()` sets exactly these four `title`s and nothing else — once they move, the function has zero remaining lines. Phase 5b's own plan doc anticipated this ("the remaining four lines — hmm/clip/fold/foldTol tooltips — stay" [until this phase]). Delete the function and its langchange listener registration. |
| `currentParams()` (feeds `interpret()` and `exportEntry()`) | Reads `els.hmm.checked`, `els.min.value`, `els.fold.checked`, `els.foldTol.value` directly. | Becomes a read of the new closure state object instead of the DOM. |
| `importEntry()` | Writes `els.min.value`, `els.fold.checked`, `els.foldTol.value`, `els.hmm.checked`, `els.clip.checked` from an imported payload. | Becomes a write to the same closure state object; `reinterpretAll()` (called once by the shared import handler after every affected channel's `importEntry()`) already republishes the view. |
| Persistence across a song/stem reset | `reset()` does **not** touch `els.min`/`clip`/`hmm`/`fold`/`foldTol` at all — only `els.tune.hidden = true`. Interpretation-tuning preferences are user settings, not song-derived facts, and already survive a song change today. | The new closure state must NOT be reinitialized in `reset()`, to keep this exact behavior. Only jianpu's `auto` flag and the edit list reset there today; this slice adds nothing to that reset path. |
| Edit list (`#notes-edits-{stem}`), list-export row (`#notes-list-io-{stem}`) | `renderEditList()`, `els.listExport`. | Out of scope — the note editor, a later Phase 6 sub-slice. Untouched. |
| Tempo grid (`#notes-tempo`), chord detection/editing | Module-level `tempoEl`/`syncTempoControls()`, `scheduleChordDetection()`. | Out of scope — a later Phase 6 sub-slice. Untouched. |

### Scope decision: extend `detection`'s existing channel view, no new store

The task's audit instructions ask whether `detection`'s existing snapshot shape should grow
these fields or whether a separate store is warranted. Decision: **extend the existing
`detection` export's per-channel `view()`**, not add a second store.

Reasoning: the interpretation controls live in the exact same `createNotesChannel()` closure
as the already-React-owned meta row, are recomputed by the exact same `reinterpret()` call,
and are published by the exact same `publish()`/`detection.subscribe`/`getSnapshot` cycle
established in Phase 5b. A second store would mean a second `useSyncExternalStore`
subscription in every consuming component, a second module-level `listeners`/`lastView`
pair in `notes.js`, and a second place for `reinterpret()` to remember to call — for state
that has no independent lifecycle from what `detection` already tracks (both are gated on
the same `!!frames` fact, both are per-channel, both change only when `reinterpret()` runs).
This is the same "reuse the established pattern instead of adding parallel infrastructure"
reasoning Phase 5b itself applied one level up (extending `notes.js`'s own export surface
rather than `lib/player-application.js`). The store keeps its existing name (`detection`) —
renaming it to something broader would ripple through `DetectionPanel.jsx` for no behavioral
reason, and CLAUDE.md's phase-by-phase "detection controls" vs. "interpretation controls"
language already describes two UI *buckets* sharing one underlying store, not two stores.

The published channel view grows five new scalar fields (`minDurationMs`, `clip`, `hmm`,
`fold`, `foldTol`) plus two derived counts (`foldedCount`, `mutedCount`), all flat alongside
the existing `visible`/`count`/`showOn`/`jianpuOn`/`tonic`/`mode` fields — matching that
object's existing flat shape rather than introducing a nested sub-object for no reason.

### Scope decision: lift the fold-stats count into a pure export

`syncFoldControls()`'s folded/muted counting loop (`for (const n of notes) { if (!n.fix)
continue; if (n.fix.state === 'folded') folded++; else if (n.fix.state === 'doubt')
muted++; }`) is genuinely derivable logic worth a Node-testable pure function, the same
"lift existing logic into a testable pure function" precedent `resolveStatusParams`/
`detectionView` established. It reads `fix.state`, a contract `lib/pitch.js` already owns
and documents (`foldOctaves`'s doc comment: `Read fix.state ('folded' | 'doubt') to
discriminate`), so the new export belongs there, immediately after `foldOctaves()`:

```js
export function foldStats(notes) {
  let folded = 0;
  let muted = 0;
  for (const n of notes || []) {
    if (!n.fix) continue;
    if (n.fix.state === 'folded') folded++;
    else if (n.fix.state === 'doubt') muted++;
  }
  return { folded, muted };
}
```

`view()` calls this unconditionally (cheap — the same O(n) cost `count: notes.length`'s
sibling fields already pay on every `publish()`, including the existing 400 ms
`refreshAll()` poll), rather than only when `fold` is checked as `syncFoldControls()` did —
the values are simply unused (and the row hidden) when `fold` is off, exactly as `count` is
already computed even while the meta row is hidden.

### Re-verified: the `window.sansBass` early-import hazard

Phase 5b's devlog `[gotcha]` entry: making `notes.js` an import target of a new React
component crashes the module graph on first load in a **local production build** if any
newly-added code path reads `window.sansBass` unguarded, because `notes.js`'s top-level
`refreshAll()` call runs before `app.js`'s body sets `window.sansBass`. This slice's new
code (`interp` state reads/writes, `foldStats()`) touches no `window.sansBass` member at
all — `currentParams()`, `importEntry()`, and the new command functions only read/write the
channel's own closure state, the same shape `jianpu` already has. No new guard is needed.
(`view()`'s existing `window.sansBass?.ribbonVisible?.(stem)` line, already guarded since
Phase 5b, is untouched by this slice.)

## Bounded outcome (Phase 6a)

A new `components/InterpretationPanel.jsx` exports one component:

- `InterpretationPanel({ stem })` — owns `#notes-tune-{stem}`: the shortest-note slider +
  readout, and the `<details class="notes-adv">` disclosure (fit-to-melody/clip checkbox,
  whole-phrase/hmm checkbox, fix-octave-outliers/fold checkbox + its tolerance slider, and
  the folded/muted stats span). Mounted twice (`stem="vocals"` and `stem="bass"`), each
  portalled into a new host (`#notes-tune-vocals-root` / `#notes-tune-bass-root`) that
  replaces the corresponding `<div id="notes-tune-{stem}" class="notes-row" hidden>...</div>`
  **inside** the existing `<section id="notes-{stem}">`, which stays otherwise legacy-owned
  (its own `hidden` toggle, the label row, the now-two-out-of-four legacy
  edits/list-io siblings). Both panels are always mounted, matching `NotesChannelPanel`'s own
  unconditional-mount pattern; each renders its own `hidden` from the published `visible`
  field, so no wrapping condition is needed in `PlayerShell`.

Matching Phase 5b's `#notes-meta-{stem}-root` → `<div id="notes-meta-{stem}">` pattern
exactly, each new host is an empty `react-portal-host` at the position the legacy element
used to occupy, and the component renders the *original* element id as a child of that host:
`#notes-tune-vocals-root` hosts `<div id="notes-tune-vocals">`, `#notes-tune-bass-root` hosts
`<div id="notes-tune-bass">`. Every id inside those elements is unchanged from the legacy
markup too (`notes-min-{stem}`, `notes-min-out-{stem}`, `notes-clip-{stem}`,
`notes-hmm-{stem}`, `notes-fold-{stem}`, `notes-fold-stats-{stem}`, `notes-fold-tol-{stem}`,
`notes-fold-tol-out-{stem}`), and so are the classes, so `styles.css` (class-selector only)
keeps working unmodified with no new rules needed.

`notes.js` keeps: the Worker lifecycle, `interpret()`/`applyEdits()` interpretation itself,
tempo, chord detection/editing, the edit list, list-export, export/import file handling, and
the `detection` store's existing shared Find-notes/meta-row surface. It loses:
`syncFoldControls()` (folded/muted counting moves to `lib/pitch.js#foldStats`, the rest of
its job — disabling the tolerance slider and hiding the stats span — becomes React's own
`disabled`/`hidden` props), `syncTips()` and its `sansbass:langchange` listener (all four
remaining lines were the four controls moving in this slice), the `els.tune.hidden` writes in
`reset()`/`analyse()` (replaced by nothing — the published `visible` field already covers
it), and the DOM reads/writes in `currentParams()`/`importEntry()` (replaced by reads/writes
of a new per-channel `interp` state object, the same shape `jianpu` already has).

## Preservation rules

| Concern | Required behavior |
|---|---|
| Shortest-note slider | Dragging re-derives notes live (same `reinterpret()` call the old `input` listener made), range/step/default (20–300 ms, step 5, default 120) unchanged, readout shows `"{value} ms"` untranslated exactly as today. |
| Advanced disclosure open/closed state | Native `<details>` behavior, uncontrolled — clicking the summary toggles it exactly as today; React does not fight or reset this state on republish. |
| Fit-to-melody / whole-phrase / fix-octave-outliers checkboxes | Same defaults (clip off, hmm on, fold off), same immediate `reinterpret()` on change, same effect on `currentParams()`'s `interpreter`/`params.fold` fields. |
| Fold tolerance slider | Disabled exactly when fold is off (matching `els.foldTol.disabled = !on`), range/step/default (0.5–8, step 0.25, default 1.5) unchanged, readout via `t('notes.foldTolVal', {n})`, `risky` class applied at `>= 2.5` exactly as today. |
| Folded/muted stats | Stats span hidden exactly when fold is off; when shown, counts equal `lib/pitch.js#foldStats(notes)`'s `folded`/`muted`, translated via the existing `notes.foldStatsFolded`/`notes.foldStatsMuted` keys, in the same `folded · muted` order and `n-fold`/`n-mute` classes. |
| Row-level visibility | `#notes-tune-{stem}` is hidden until this channel has frames, in lockstep with the already-React-owned meta row (both derived from the same `!!frames` fact, at different DOM nodes) — matching Phase 5b's own preservation rule for the meta row's `visible` field. |
| Persistence across song/stem changes | Slider/checkbox values are NOT reset when a song loads or a stem is replaced — matching today's `reset()`, which never touches these values. Only frames/notes and the row's visibility reset. |
| Import/export round-trip | `exportEntry()`'s `params`/`interpreter`/`clip` fields and `importEntry()`'s application of an imported entry's `params.minDurationMs`/`params.fold`/`params.confidentWithin`/`interpreter`/`clip` are byte-identical to today, now sourced from/written to the `interp` state object instead of the DOM. |
| Tooltips | The four Advanced-row tooltips (`notes.hmmTip`/`notes.clipTip`/`notes.foldTip`/`notes.foldTolTip`) render on the correct wrapping `<label>`s (matching each control's old `parentElement.title` target) and retranslate on a language switch via `useLocale()`, the same render-time-translation pattern established since Phase 4b/5a/5b. |
| Locale | Every label/tooltip/readout retranslates correctly on a language switch, sourced from `t()` at render time. |
| Remount | Shell unmount/remount does not lose `interp` state or restart analysis — the state lives in `notes.js`'s own channel closure, independent of `PlayerShell.jsx`'s mount state, matching every other React-owned control. |
| No behavior change to out-of-scope regions | The edit list, list-export row, tempo grid, chord detection/editing, and the zoomed pane are pixel-for-pixel and behaviorally unchanged; their DOM nodes and listeners are untouched. |

## Failing-first and implementation increments

1. Extend the focused production-entry Chromium suite (`tests/player.test.js`) with cases run
   against the **current legacy owner** first, to record expected failures, then made to pass
   by the implementation below:
   - dragging the shortest-note slider changes the rendered note count live and the value
     survives a language switch;
   - toggling the fix-octave-outliers checkbox reveals the folded/muted stats with counts
     matching notes actually carrying `fix.state === 'folded'`/`'doubt'`, and disables/enables
     the tolerance slider in lockstep;
   - the interpretation row's own visibility follows `frames` the same way the meta row's does
     (extend the existing stale-results case, or add a sibling assertion beside it, so both
     rows are proven to hide together rather than only the meta row as today);
   - a slider/checkbox value set before loading a new song survives the song change (proving
     `reset()` does not clear the new `interp` state, matching today's DOM-persistence
     behavior).
2. Add `foldStats(notes)` to `lib/pitch.js`, plus a focused Node test in `tests/pitch.test.js`
   (folded-only, doubt-only, mixed, and no-`fix` notes).
3. Refactor `notes.js`: add each channel's `interp` state object (defaults matching the
   current HTML: `{ minDurationMs: 120, clip: false, hmm: true, fold: false, foldTol: 1.5 }`),
   update `currentParams()`/`importEntry()`/`exportEntry()` to read/write it instead of the
   DOM, add `setMinDurationMs()`/`setClip()`/`setHmm()`/`setFold()`/`setFoldTol()` command
   functions (mirroring `setJianpuOn()`), extend `view()` with the five state fields plus
   `foldedCount`/`mutedCount` from `foldStats(notes)`, delete `syncFoldControls()` and
   `syncTips()` (and its `sansbass:langchange` listener registration), delete the
   `els.tune.hidden` writes in `reset()`/`analyse()`, delete the five now-dead
   `els.*.addEventListener(...)` registrations, and remove the corresponding `els.*` entries
   (`tune`, `min`, `minOut`, `clip`, `hmm`, `fold`, `foldTol`, `foldTolOut`, `foldStats`) from
   both `channels.push(createNotesChannel(...))` call sites. Extend `detection.commands` with
   the five new command entries (stem-dispatched, matching the existing
   `setJianpuOn`/`setKey` pattern).
4. Add `components/InterpretationPanel.jsx`.
5. Update `index.html` (replace `#notes-tune-vocals`/`#notes-tune-bass` with
   `#notes-tune-vocals-root`/`#notes-tune-bass-root` inside their existing sections) and
   `components/PlayerShell.jsx` (add the two hosts, portal two
   `<InterpretationPanel stem="..." />` instances, unconditionally like `NotesChannelPanel`).
6. Run focused tests, then `npm test`, `npm run build`, `git diff --check`, and an exact-source
   local production smoke at root and a nested route (a generated stems ZIP with a vocals+bass
   pair for the loaded-song precondition, a faked Worker for the detection flow itself) before
   opening the PR.

## Out of scope

The edit list (select/add/delete/move/resize/repitch/snap, `#notes-edits-{stem}`), the
list-export row (`#notes-list-io-{stem}`), the shared tempo grid (`#notes-tempo`), chord
detection/editing, the ribbon/overview/zoomed-pane lanes, and Export/Import edits JSON stay
untouched and legacy-owned — the second and third Phase 6 sub-slices
(`docs/react-migration.md`: "tempo/grid/capo/chord controls", then
"selection/edit/undo/import/export controls"). The `window.sansBass` bridge's remaining
members stay untouched — narrowing them further is not needed to give React ownership of
interpretation-control presentation. Real-Worker/model smoke and physical-handheld evidence
remain separate, deployment-and-release-level checks per `docs/testing.md` and
`docs/behaviour.md`, not routine test dependencies for this slice.
