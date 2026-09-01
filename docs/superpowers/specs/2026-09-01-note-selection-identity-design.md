# Note selection identity — disambiguating overlapping notes

**Status:** design, approved 2026-09-01
**Phase:** follow-up to note editing (v1.16.0) and its ergonomics batch (v1.16.1), both now on
`main`. Independent of the two still-deferred batches — inline note-value fields, and
compressing edit history — which remain queued after this.
**Branch:** `docs/note-selection-identity-design` (design only; implementation gets its own
branch off `main`)
**Scope:** `selectedNote`'s shape, every place that resolves "which note is this" from it
(`app.js`'s hit-testing, drag, toolbar/keyboard handlers, the selection outline) and
`lib/pitch.js`'s `applyEdits` anchor lookup for `octave`/`pitchNudge`/`timeAdjust`/`delete`.

## Motivation

The ergonomics batch (v1.16.1) made overlapping notes resolve consistently for *clicking* —
`noteAt` now prefers the note drawn last (topmost) instead of the first-detected one. Using it
surfaced that this was incomplete: overlapping notes are still broken in two other ways.

1. **The selection outline draws on every note that contains the anchor time, not just the
   selected one.** `renderZoom`'s outline check (`live.start <= selectedNote.at &&
   selectedNote.at < live.end`) runs independently per note in the draw loop. Two overlapping
   notes both satisfy it, so both get a white border.
2. **`applyEdits`'s own anchor lookup never learned the "prefer topmost" rule.** It still uses
   `list.findIndex(...)` — first match — for `delete`, `octave`, `pitchNudge`, and
   `timeAdjust`. So the toolbar/keyboard can visibly select the topmost note while silently
   acting on a *different* one underneath it, whenever both contain the same time point. This
   is worse than the pre-v1.16.1 behavior, which was at least internally consistent (always
   first-match everywhere) even though it couldn't select the visually-topmost note at all.

Underneath both: **hit-testing only ever looked at time, never pitch.** `noteAt(list, at)`
takes a single time value. Two notes overlapping in time but sitting at different pitches were
always indistinguishable to it, regardless of which one was actually under the pointer — no
tie-break rule fixes that, because tie-breaking only matters once you already know which
candidates are in play, and pitch is what actually narrows that set to the one thing on screen
under the click.

## Goals

- Clicking a note selects that specific note — considering both time and pitch — not whichever
  note wins an array-order tie-break.
- The selection outline draws on exactly the selected note, never on an unrelated note that
  happens to share the same time point.
- Every toolbar button and keyboard shortcut acts on the exact note the outline is drawn
  around — never a different note that happens to share the anchor time.
- Old exported edit-history JSON files (v1.16.0's format, with no pitch on their edit objects)
  still import and apply exactly as they did before this change.

## Non-goals

- Sub-semitone pitch precision in hit-testing. Notes are already quantised to integer MIDI;
  matching on exact `midi` equality is sufficient.
- Changing how overlaps are created, permitted, or visually stacked. This is purely about
  resolving "which note" once one is picked out, not about overlap policy.
- The two deferred batches (inline value fields, compressed edit history) — unrelated scope,
  still queued after this.

## Success criteria

- Two notes overlapping in time but at different pitches: clicking each one selects that exact
  note, confirmed by which one carries the outline and which one the toolbar acts on.
- Two notes overlapping in time AND at the same pitch (an exact duplicate): clicking the
  overlap selects the one drawn last (topmost), matching v1.16.1's original intent — this is
  the one case pitch alone can't disambiguate, so it still needs a tie-break.
- Pressing a toolbar button or keyboard shortcut with a note selected never changes a note
  other than the one currently outlined.
- Importing a v1.16.0-era exported edit file (edits with no `midi` field) reproduces the same
  note list it always did.

## Design

### 1. `selectedNote` carries pitch

```js
let selectedNote = null;    // { at, midi } — at is a time point inside the note, midi is its
                             // pitch at selection time; both identify one specific note
```

Every existing assignment gains a `midi`:

- Fresh click-select (`pointerdown`'s plain-select branch): `selectedNote = { at: (hit.start +
  hit.end) / 2, midi: hit.midi }`.
- Drag commit (`pointerup`'s `noteDrag` branch): `selectedNote = { at: (previewStart +
  previewEnd) / 2, midi: note.midi }` — a time-drag never changes pitch.
- Add-note commit (`pointerup`'s `addDrag` branch): `selectedNote = { at: (start + finalEnd) /
  2, midi }` — `midi` is the value the drag already carries.
- `editTimeNudge`: `selectedNote = { at: selectedNote.at + d, midi: selectedNote.midi }` — time
  changes, pitch doesn't.
- `editSplit`'s three branches: each already sets `at` to a midpoint; each also carries
  `midi: n.midi` — a split doesn't change pitch either.
- `editOctave(dir)`: currently doesn't touch `selectedNote` at all (comment: "the anchor stays
  valid as-is" — true for `at`, not for `midi` anymore). Add
  `selectedNote = { at: selectedNote.at, midi: selectedNote.midi + 12 * dir };` after
  dispatching.
- `editPitchNudge(semitones)`: same shape, `midi: selectedNote.midi + semitones`.
- `editDeleteNote`: unchanged (`selectedNote = null`).

### 2. Hit-testing becomes time-and-pitch

`noteAt` gains an optional third parameter:

```js
/** The note in `list` whose span contains `at`, or null. Half-open — a note's END excludes
 *  it, matching lib/pitch.js's applyEdits.
 *
 *  With `midi` given, only a note at that exact pitch counts — this is what actually
 *  disambiguates two notes overlapping in time, which time alone never could. Without it
 *  (the one legitimate case: nothing is selected yet), falls back to time-only.
 *
 *  Searches from the END of the list either way, so if pitch still leaves more than one match
 *  (an exact duplicate — same span, same pitch) the one drawn last (topmost) wins, matching
 *  renderZoom/renderRibbon's draw order. */
function noteAt(list, at, midi) {
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    if (n.start <= at && at < n.end && (midi === undefined || n.midi === midi)) return n;
  }
  return null;
}
```

Every call site that already has a `selectedNote` passes its `midi` through:

- `pointerdown`'s drag-hit-test: `noteAt(ribbon.notes, selectedNote.at, selectedNote.midi)`.
- `syncEditToolbar`'s `sel` derivation: same.
- `editTimeNudge`/`editSplit`'s `noteAt(ribbon.notes, selectedNote.at)` calls: same.

The **initial** click-to-select call (`noteAt(ribbon.notes, t)`, deciding what a fresh click
hits) is the one call site that does NOT have a `selectedNote.midi` to pass — it has a click
position instead. It gains its own pitch value the same way `addMidiAt` already computes one
for note placement:

```js
const hit = noteAt(ribbon.notes, t, addMidiAt(canvas, e.clientY));
```

Reusing `addMidiAt` here (rather than inventing a second rounding function) means a click
resolves to a note using the exact same Y→pitch mapping that placing a new note already uses —
one rounding rule for "what pitch is under this pointer," not two.

### 3. The selection outline matches on pitch too

`renderZoom`'s outline condition currently reads:

```js
if (editMode && selectedNote && live.start <= selectedNote.at && selectedNote.at < live.end) {
```

Gains a pitch check:

```js
if (editMode && selectedNote && n.midi === selectedNote.midi &&
    live.start <= selectedNote.at && selectedNote.at < live.end) {
```

(`n.midi`, not `live.midi` — `live` only overrides `start`/`end` during a drag preview; pitch
never changes during a time-drag, so it's still read from the underlying note `n`.)

### 4. `applyEdits` accepts an optional `midi` qualifier

The anchor lookup currently reads:

```js
const idx = list.findIndex((n) => n.start <= e.at && e.at < n.end);
```

Becomes:

```js
/* With e.midi given, disambiguate by pitch too, preferring the last (topmost) match if more
 * than one note still shares both — an exact duplicate. Without it (edits from a file
 * exported before this field existed), first-match stays exactly as it always was: nothing
 * about importing an old edit history should change behavior. */
let idx = -1;
if (e.midi !== undefined) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].midi === e.midi && list[i].start <= e.at && e.at < list[i].end) { idx = i; break; }
  }
} else {
  idx = list.findIndex((n) => n.start <= e.at && e.at < n.end);
}
```

`app.js`'s dispatch calls all gain the qualifier — purely additive to the edit object shape:

- `editOctave`: `dispatchEdit([{ type: 'octave', at: selectedNote.at, dir, midi: selectedNote.midi }])`.
- `editPitchNudge`: same shape, `pitchNudge`.
- `editTimeNudge`: `dispatchEdit([{ type: 'timeAdjust', at: selectedNote.at, dStart: d, dEnd: d, midi: selectedNote.midi }])`.
- `editDeleteNote`: `dispatchEdit([{ type: 'delete', at: selectedNote.at, midi: selectedNote.midi }])`.
- `editSplit`'s `timeAdjust` entries: each gains `midi: n.midi`.
- The drag-commit `timeAdjust` in `pointerup`: gains `midi: note.midi`.

`add` and `rangeDelete` are untouched — neither does an anchor lookup at all, so there's
nothing for a `midi` qualifier to disambiguate.

### Export/Import compatibility

Exporting now writes one more field on most edit primitives; nothing reads or requires it
specially, so the JSON shape check in Task 9's import handler
(`data.version === 1 && Array.isArray(data.edits)`) is untouched. Importing an **old** file
(no `midi` on its edits) hits `applyEdits`'s `e.midi !== undefined` branch as `false` for every
one of them, so they resolve exactly the way they always did — first match, no pitch
filtering. A freshly re-exported copy of an old file will carry `midi` going forward, but nothing
requires re-exporting; old files keep working unmodified.

## Testing

`lib/pitch.js`'s `applyEdits` gains unit tests in `tests/pitch.test.js`: an edit with `midi`
resolves to the pitch-matching note even when a different, time-overlapping note would
otherwise be the first match; an edit without `midi` is unaffected by an overlapping note at a
different pitch (today's behavior, unchanged); two exact-duplicate notes (same span, same
pitch) with a `midi`-qualified edit still resolve to the last (topmost) one.

Everything in `app.js` (hit-testing, the outline, the toolbar/keyboard handlers) is
pointer/keyboard/canvas behavior with no test runner, verified by hand per `docs/behaviour.md`'s
existing convention for the rest of the note editor.
