# Note editing — Layer 4

**Status:** design, approved 2026-08-31
**Phase:** the layer recorded as not-built in `transcription.md` and indexed under
[`roadmap.md` → Note editing — layer 4](../../roadmap.md#note-editing--layer-4).
**Branch:** `docs/note-editing-design` (design only; implementation gets its own branch)
**Scope:** a new `applyEdits()` pass in `lib/pitch.js`, run after `interpret()` and
`foldOctaves()`; edit-mode UI in the zoomed pane and a toolbar/edit-list in `notes.js` /
`app.js`; export/import of edits + parameters as a JSON sidecar file.

## Motivation

`transcription.md` lays out four layers — audio, frames, notes, edits — with a rule the rest
of the transcription feature has relied on since v1.10.0: every layer is a pure function of
the layer above it plus parameters, **except edits**, which is the one layer with no upstream
to recover from. That is why it has to be its own thing rather than another parameter:
dragging `minDurationMs` can never destroy work, but a hand correction has nowhere else to
live.

It has been listed as "not built" through octave folding (v1.13.0), 簡譜 (v1.14.0), and the
loop/note-resume work (v1.15.0) — all of which touch the note list but none of which let a
human override it. Automatic octave folding gets most outliers, and the confidence threshold
it uses is deliberately conservative (see `transcription.md` → "the fold declines to fold
what it cannot justify") — the notes it declines to fold, plus ordinary segmentation mistakes
(a missed onset, a spurious fragment, a note that should read a semitone higher), are exactly
what this layer is for.

## Goals

- All six actions catalogued in `transcription.md` → "The actions to support" (高/低 8 度,
  刪除, 分割, 新增, 平移, range-select-and-delete), reachable from the zoomed pane. 平移
  resolved during design (see below) into two distinct actions — pitch-nudge and time-adjust
  — because a pitch move and a time move want different anchors; 分割 turned out not to need
  its own mechanism at all.
- An edit-mode toggle in the zoomed pane: select a note, act on it via toolbar buttons, drag
  handles, or keyboard shortcuts.
- An edit list with per-edit removal and an undo shortcut, because edits do not disappear the
  way parameter changes do.
- Export the edit list plus every control that affects the note list (interpreter choice,
  `minDurationMs`, fold on/off and its tolerance, `clip`, 簡譜 state) to one JSON file; import
  restores all of it and re-derives.

## Non-goals

- Auto-save / local persistence. Export/import is the only persistence mechanism — no
  `localStorage`, matching the app's existing pattern (the stems zip is also manual
  save/load, not auto-saved).
- Merging two edit files, or applying one song's edits to a different song. Import replaces
  the current session's edits and params wholesale.
- Any change to `frames` (layer 2) or the interpreters (layer 3). This is purely a fourth
  layer on top of what they already produce.
- A generic multi-step undo/redo stack across all app state. Undo here is scoped to the edit
  list only.

## Success criteria

- Every one of the six catalogued actions is reachable from the zoomed pane while edit mode
  is on, and produces the note-list change `transcription.md` describes for it.
- Splitting a note twice, deleting one of the resulting three notes, then changing
  `minDurationMs` still leaves the two surviving hand edits applied to whatever notes
  currently occupy those anchors.
- A note that was `fix.state === 'doubt'` (silent — see `lib/sonify.js`) and gets manually
  corrected becomes audible again, per the existing rule for action 1.
- Exporting, reloading the app, loading the same stems zip, and importing the file reproduces
  the same note list and the same control states.

## Design

### Settling 平移: two actions, not one

The open question in `transcription.md` was whether 平移 means a pitch nudge, a time nudge,
or both, because a pitch move and a time move want different anchors. Resolved as **two
separate actions**:

- **pitch-nudge** — semitone-step correction, finer than the octave-move action (1) but the
  same anchor shape (find the note containing a time point, change its `midi`).
- **time-adjust** — moves or resizes a note in time. This one subsumes more than "nudge": the
  same operation, applied to one edge instead of both, is *extending or shrinking* a note's
  duration — a capability the six-action list didn't name but that falls directly out of the
  override already needing to carry `start`/`end`. There was never a reason to make resize a
  separate mechanism.

### Six edit types, not seven

Working through 分割 (split) exposed that it isn't a primitive at all. Given a note
`[start, end]` and a cut point `cutAt` inside it:

- The earlier piece `[start, cutAt]` is just the original note with its `end` moved — a
  **time-adjust**.
- The later piece `[cutAt + 5ms, end]` is a brand-new note at the same pitch — an **add**.

So split is authored as one or two primitive edits, never its own type. This also absorbs
what would otherwise be two edge cases:

| cut position | result |
|---|---|
| `end - cutAt < 5ms` (cut too close to the end) | time-adjust only: `end` → `cutAt`. The near-zero trailing sliver is discarded — there is no second note to add. |
| `cutAt - start < 5ms` (cut too close to the start) | time-adjust only: `start` → `cutAt`. The near-zero leading sliver is discarded. |
| otherwise | time-adjust (`end` → `cutAt`) **and** add (`[cutAt + 5ms, end]`, same `midi`) |

The 5ms gap between the two pieces in the normal case is a fixed constant, not user-facing —
large enough that the two are unambiguously separate notes rather than the zero-gap
touching-notes case `transcription.md` already flagged as ambiguous (148 of 437 notes in one
measured song touch their neighbour with no gap, and only 8 of those actually share a pitch).

Splitting a long note into three or more pieces needs no extra design: the tail piece an
`add` produces is an ordinary note, exactly as selectable and splittable as anything
detection produced. Repeat the same action against it.

This leaves six edit types:

| type | anchor | payload | effect |
|---|---|---|---|
| `octave` | `at` | `dir: ±1` | shift target note ±12 semitones |
| `pitchNudge` | `at` | `semitones: ±1` | shift target note by 1 semitone |
| `timeAdjust` | `at` | `dStart, dEnd` (seconds) | both non-zero and equal = move; one non-zero = resize |
| `delete` | `at` | — | remove target note |
| `add` | — | `start, end, midi` | insert a new note; no target lookup |
| `rangeDelete` | `from, to` | — | delete every note currently overlapping the range |

`at` is a time point, not a note index — indices go stale the moment notes are re-derived, a
time point still identifies the same moment in the song. `rangeDelete` is the one action that
isn't per-note (per the original list): it's re-evaluated fresh against whatever notes
currently exist in `[from, to)`, not a one-time snapshot of what was there when it was drawn.

### `applyEdits()`

Runs after `interpret()` and `foldOctaves()`, in `lib/pitch.js`, mirroring `foldOctaves`'
shape: a pure function of the note list plus the edit list.

```
applyEdits(notes, edits) → { notes: Note[], orphaned: Edit[] }
```

Edits apply in the order they were created. Each one (other than `add` and `rangeDelete`)
re-locates its target as the note whose `[start, end)` currently contains `at` — evaluated
against the list *as already modified by earlier edits in this same pass*, not the original
`notes` argument. If nothing contains `at` — its target was deleted by an earlier edit,
merged away by a parameter change, folded to a different note, etc. — the edit is skipped and
returned in `orphaned` rather than silently dropped, so the edit-list UI can flag it instead
of the note list quietly diverging from what the user thinks they did.

Any edit that changes `midi` (`octave`, `pitchNudge`) sets
`fix = { state: 'manual', from: <original midi> }`, overwriting whatever `fix` the note
carried in. This satisfies the existing rule for action 1 (a `doubt` note must have its `fix`
cleared or replaced, or it stays permanently silent per `lib/sonify.js`). An `add`ed note is
created with `fix = { state: 'manual' }` from the start — it has no prior state to clear, but
gets the same tag, so it draws the same fourth colour and is trivially distinguishable from
anything a detector produced. `delete` and `rangeDelete` need no `fix` handling; the note is
simply gone.

A `split`'s two primitive edits (when both are produced) are stored as one grouped entry in
the edit list, not two independent ones. Undo and per-edit removal act on a whole entry —
otherwise undoing "the split" would remove only the `add` half and leave the original note
mysteriously shrunk, and the list would show two rows that don't individually make sense on
their own.

### UI

- **Mode toggle** — an "✎ Edit" toggle in the notes panel controls row, alongside the
  existing 簡譜/fold/hmm checkboxes. Enabled only once notes exist. Off by default, and
  cleared (along with the edit list) on song reset, same as `jianpu.auto` today — edits are a
  statement about the current song, not something to carry into the next one.
- **Selection** — clicking a note in the zoomed pane selects it (a note gets a white outline
  when selected, in addition to its fill colour). Clicking empty space still seeks, as today.
  A drag starting on the selected note's **body** nudges it in time; a drag starting on one of
  its **edge handles** resizes that edge. A drag starting on empty space still pans, as today
  — the distinction is which element the drag started on, the same test the pane already uses
  to tell a click from a pan.
- **Toolbar** — a fixed strip under the zoomed pane: `↑8ve ↓8ve ♯ ♭ ◀t ▶t ✂split ✕delete`,
  disabled until a note is selected, plus an always-available `+ Add note` that arms placement
  mode — the next click-drag in the pane draws the new note's time span and pitch row instead
  of seeking, then disarms itself.
- **Split** cuts the selected note at the current playhead position — reusing the pane's
  existing scrubbing rather than a second, different kind of click inside the note.
- **Edit list** — a small collapsible panel listing every entry (icon, target note or range,
  time created), each with a ✕ to remove it and re-derive. Orphaned entries carry a warning
  glyph but stay removable. `Cmd/Ctrl+Z` undoes the most recent entry.
- **Keyboard** (a note selected, edit mode on): `↑/↓` pitch-nudge ±1 semitone, `Shift+↑/↓`
  octave, `←/→` time-nudge, `Delete`/`Backspace` deletes the note, `Cmd/Ctrl+Z` undoes the
  last edit.

### Export / import

Export downloads a JSON sidecar mirroring `notes.js`'s existing `currentParams()`, plus
`clip`, `jianpu`, and the edit list — this is deliberately everything that feeds
`window.sansBass.setNotes()` today, plus the one new thing (`edits`):

```json
{
  "version": 1,
  "song": "<best-effort label, or omitted entirely — see below>",
  "interpreter": "hmm-v1",
  "params": { "minDurationMs": 120, "fold": true, "confidentWithin": 1.5 },
  "clip": true,
  "jianpu": { "on": true, "tonic": 2, "mode": "major" },
  "edits": [ /* the edit list, groups included */ ]
}
```

`song` is sourced from `window.sansBass.currentMix()?.name` and is genuinely best-effort: it
exists for an unseparated song or a stems zip that bundled a mix file, but not for a
stems-only zip or an in-browser separation result — `loadSeparated` builds lanes from the six
stems alone and drops the mix, the same reason `__hasStems` is false there (see `CLAUDE.md`).
The field is simply omitted when there's nothing to put in it.

Import re-populates every control this reads from (`el.min`, `el.fold`, `el.foldTol`,
`el.hmm`, `el.clip`, `jianpu`) and the edit list, then re-runs `reinterpret()`. It replaces
the current session's edits and params wholesale — restoring "this song's editing state," not
merging two sessions' worth. If both the file's `song` label and a current `currentMix()`
name exist and disagree, a dismissible warning shows; if either side lacks a label the check
is simply skipped, so this never blocks the import.

Nothing about this crosses the "nothing leaves the machine" boundary in `CLAUDE.md` — it's a
manual file download the user initiates and a manual file the user picks to load, the same
shape as the existing stems-zip save/load, and it carries no audio.

## Testing

`applyEdits()` is a pure function over a note list and an edit list, the same shape as
`foldOctaves()`, so it gets unit tests in `tests/test.html`: anchor resolution against a note
list already modified by earlier edits in the same pass, orphaning when a target's gone,
`rangeDelete` re-evaluating against a changed note list rather than a stale snapshot, and the
three `split` cases (normal, end-degenerate, start-degenerate) including the three-or-more-way
split built by repeating it.

Everything else — mode toggle, click/drag selection and resize, the toolbar, keyboard
shortcuts, the edit list and undo, and the export/import round trip — is UI behaviour with no
runner, so it gets rows in `docs/behaviour.md`, per the project's existing convention for
anything a unit test can't reach.

## Deferred

- A generic app-wide undo/redo. This spec's undo is scoped to the edit list.
- Any attempt to validate an imported file against the current song beyond the informational
  filename check — no content hash exists to make that check reliable, and building one is
  out of scope here.
- Merging edits from two files, or copying an edit list between songs.
