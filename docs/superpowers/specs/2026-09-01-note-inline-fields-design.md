# Inline note-detail fields

**Status:** design, approved 2026-09-01
**Phase:** second of three follow-up batches to note editing (v1.16.0). Deferred from
[`docs/superpowers/specs/2026-08-31-note-editing-ergonomics-design.md`](2026-08-31-note-editing-ergonomics-design.md)
("Non-goals" — "Inline, directly-editable note-value fields next to the toolbar").
**Branch:** `docs/note-inline-fields-design` (design only; implementation gets its own branch)
**Scope:** a new field row in `app.js`'s zoomed pane, next to the existing edit toolbar, plus
a `parseNoteName()` counterpart to `lib/pitch.js`'s existing `noteName()`. No changes to
`applyEdits()` or the edit types themselves.

## Motivation

The note editor (v1.16.0) exposes pitch and time changes only through fixed-increment
controls: `↑8ve`/`↓8ve`/`♯`/`♭` step pitch by an octave or a semitone, `◀t`/`▶t` step time by
`TIME_NUDGE_STEP` (0.1s), and dragging is imprecise at a glance. Landing a note on an exact,
known value — matching it to a lyric sheet's timing, or correcting a pitch that's obviously
one specific note rather than "one semitone off" — currently takes several clicks or an
approximate drag. Direct entry of the exact value is faster and less error-prone whenever the
target value is already known.

## Goals

- Three inline fields next to the edit toolbar — Start, End, Pitch — showing the selected
  note's current values and editable directly.
- Editing commits via Enter (in any field) or a shared Apply button; invalid input reverts
  silently.
- Reuses the existing `timeAdjust` and `pitchNudge` edit types. No new edit type, no change to
  `applyEdits()`.

## Non-goals

- Any change to `applyEdits()`, the edit types, or the edit list/undo model. That is batch 3
  ([`docs/superpowers/specs/2026-09-01-note-edit-history-design.md`](2026-09-01-note-edit-history-design.md)),
  brainstormed separately in this same session.
- A field for anything other than start/end/pitch (e.g. confidence, `fix` provenance). Nothing
  else on a note is user-meaningful to hand-edit.
- Keyboard shortcuts to focus a field. Click/tap into it like any text input.
- Editing an unselected note, or editing multiple notes at once (range-select is for deletion
  only, per the existing feature).

## Success criteria

- Selecting a note populates all three fields with its current start (`mm:ss.mmm`), end
  (`mm:ss.mmm`), and pitch (`D4`-style name).
- Changing a field and pressing Enter, or changing any subset of the three fields and clicking
  Apply, dispatches exactly the edits needed: one `timeAdjust` if start and/or end changed
  (computed together as one edit, not two, mirroring how a two-edge drag is already one edit),
  one `pitchNudge` if pitch changed, and none if a field's parsed value equals the note's
  current value.
- An unparseable value in any field (bad time format, unrecognised note name), or a start/end
  pair that would violate `end - start >= 0.02` (the existing `MIN_DUR` floor) or `start >= 0`,
  reverts that field to the note's current value and dispatches nothing.
- Pressing Escape while a field has focus reverts all three fields to the note's current
  values without committing.
- While a field has focus, no redraw or selection-sync tick overwrites what the user is
  typing. Deselecting the note (or the note being removed by another edit) blanks and disables
  all three fields, same as the toolbar buttons.

## Design

### DOM and lifecycle

A new row, `note-fields`, is created in `app.js` right next to `zToolbar` — same section that
builds `octUp`/`octDown`/etc. (`app.js` around line 626-660):

```js
const zFields = document.createElement('div');
zFields.className = 'note-fields';
zFields.hidden = !editMode;

const fieldStart = mkFieldInput('notes.editFieldStart');
const fieldEnd   = mkFieldInput('notes.editFieldEnd');
const fieldPitch = mkFieldInput('notes.editFieldPitch');
const applyBtn = document.createElement('button');
applyBtn.className = 'mini note-tbtn';
applyBtn.type = 'button';
applyBtn.textContent = tr('notes.editFieldApply');   // "Apply"
applyBtn.disabled = true;

zFields.append(fieldStart, fieldEnd, fieldPitch, applyBtn);
zLane.append(zName, zCanvas, zRangeHint, zToolbar, zFields, zSpacer, zGrip);
```

`zoomToolbar` (the object `syncEditToolbar()` already reads) gains `fieldStart`, `fieldEnd`,
`fieldPitch`, `applyBtn` alongside its existing button references, so the same
disabled-until-a-note-is-selected loop in `syncEditToolbar()` covers all four new controls
with no separate sync path.

Enter in any of the three inputs, and a click on `applyBtn`, call the same `commitFields()`
function (see below).

### Refresh vs. typing

`syncEditToolbar()` runs on every `draw()` (i.e. every rAF tick while playing), so writing
field values there unconditionally would overwrite an in-progress keystroke mid-type. Fix:
track the identity of the note last written to the fields (`fieldsShownFor`, a `{at, midi}`
pair or `null`), and only rewrite `fieldStart.value`/`fieldEnd.value`/`fieldPitch.value` when
`sel` is a **different** note than `fieldsShownFor` — and never while any of the three inputs
has focus (`document.activeElement`). Selecting a new note always shows its values (focus
doesn't block that case, since the user just clicked away from whatever they were doing to
make the new selection); it only guards against a field being clobbered while it's the one
being typed into.

### Formats

**Time.** `fmt(t)` (existing, `app.js:186`) is `m:ss`, no sub-second precision — too coarse
for note boundaries, which are meaningful to the millisecond (`MIN_DUR = 0.02`). Two new
functions, next to `fmt`:

```js
function fmtPrecise(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(3).padStart(6, '0');   // "07.340"
  return `${m}:${s}`;
}

function parseTimeMmSs(str) {
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(str.trim());
  if (!m) return null;
  const mins = +m[1], secs = +m[2];
  if (secs >= 60) return null;
  return mins * 60 + secs;
}
```

`parseTimeMmSs` returns `null` on anything it doesn't recognise (the revert-silently path);
it does not attempt to parse bare-seconds input (`"12.3"` without a `:`) — the field always
displays and expects `m:ss.mmm`, so round-tripping the displayed format is what matters, not
accepting every format a user might type.

**Pitch.** `noteName()` (existing, `lib/pitch.js:33`) already produces the display string.
Its counterpart, `parseNoteName()`, added next to it:

```js
export function parseNoteName(str) {
  const m = /^([A-Ga-g])(#?)(-?\d+)$/.exec(str.trim());
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const idx = NOTE_NAMES.indexOf(letter + (m[2] ? '#' : ''));
  if (idx < 0) return null;
  return idx + (+m[3] + 1) * 12;
}
```

This is the exact inverse of `noteName()` — sharps only, no flats — so a value read from a
note and never touched round-trips unchanged. A flat-notation entry (`"Db4"`) is rejected
(`null`) rather than silently reinterpreted, per the revert-on-invalid rule; typing the sharp
spelling (`"C#4"`) is the supported path.

### Commit

```js
function commitFields() {
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
  if (!n) return;

  // A field that fails to parse is treated as "unchanged" here, not as blocking the OTHER
  // field — a garbage Start shouldn't swallow a valid End edit sitting right next to it. The
  // forced refresh at the end (fieldsShownFor = null) is what makes the garbage field visibly
  // snap back, which is the actual "revert silently" the user sees.
  const parsedStart = parseTimeMmSs(zoomToolbar.fieldStart.value);
  const parsedEnd   = parseTimeMmSs(zoomToolbar.fieldEnd.value);
  const newStart = parsedStart !== null ? parsedStart : n.start;
  const newEnd   = parsedEnd   !== null ? parsedEnd   : n.end;
  const dStart = newStart - n.start;
  const dEnd   = newEnd - n.end;
  const timeValid = newStart >= 0 && (newEnd - newStart) >= 0.02;

  const newMidi = parseNoteName(zoomToolbar.fieldPitch.value);

  const edits = [];
  if (timeValid && (dStart !== 0 || dEnd !== 0)) {
    edits.push({ type: 'timeAdjust', at: selectedNote.at, dStart, dEnd, midi: n.midi });
  }
  if (newMidi !== null && newMidi !== n.midi) {
    edits.push({ type: 'pitchNudge', at: selectedNote.at, semitones: newMidi - n.midi, midi: n.midi });
  }

  if (edits.length) {
    selectedNote = {
      at: selectedNote.at + (timeValid ? dStart : 0),   // keep the anchor inside the note
      midi: newMidi !== null ? newMidi : n.midi,
    };
    dispatchEdit(edits);
  }
  fieldsShownFor = null;   // force a refresh from the (possibly just-updated) note
  syncEditToolbar();
}
```

Two independent edits can be dispatched from one Apply — a time change and a pitch change are
different edit types and don't merge, exactly as they don't when done via separate toolbar
buttons or a drag-then-nudge sequence. Both go through `dispatchEdit` in the same array, so
they land as one call the same way `editSplit()` already dispatches its two-edit array — see
that function for the existing precedent (`app.js:1901-1921`).

If `timeValid` is false (the combined Start/End would violate the floor or go negative), no
`timeAdjust` is dispatched at all, even if only one of the two fields was actually edited — an
invalid *result* blocks the time edit as a whole, since Start and End can't be split into two
separate edits without reintroducing the two-edits-for-one-drag problem this design avoids.
The pitch field is unaffected either way: a bad or unchanged time pair never blocks a valid
pitch edit from applying, and vice versa.

### Escape

A `keydown` listener on each of the three inputs: on `Escape`, blur the field, set
`fieldsShownFor = null`, and call `syncEditToolbar()` directly — rather than waiting for the
next `draw()` tick, which may not come promptly while playback is paused. This resets
`.value` from the current note, the same path invalid input already takes on commit.

## Testing

No new automated tests for the DOM/interaction side (matches the existing convention: the
whole note editor's UI is verified by hand per `docs/behaviour.md`, since there is no DOM test
runner). `parseNoteName()` is a pure function and gets unit tests in `tests/pitch.test.js`
alongside `noteName()`'s existing coverage: round-trips every `noteName()` output back to the
same MIDI number, rejects flats, rejects garbage, accepts negative octaves.

The implementation plan adds `docs/behaviour.md` rows for: fields populate on selection,
Enter/Apply commits, invalid input reverts silently without dispatching, Escape reverts,
typing is never clobbered by a redraw mid-edit, and a combined start+end change is one
`timeAdjust` (checked via the edit-list panel showing one new row, not two).
