# Inline note-detail fields — labels and flat-pitch entry

**Status:** design, approved 2026-09-01
**Phase:** follow-up to [`docs/superpowers/specs/2026-09-01-note-inline-fields-design.md`](2026-09-01-note-inline-fields-design.md)
(v1.16.3), which shipped Start/End/Pitch as three tooltip-only fields with a sharps-only pitch
parser.
**Branch:** `docs/note-inline-fields-followups-design` (design only; implementation gets its
own branch off `feat/note-inline-fields`, since this depends on code not yet merged to `main`)
**Scope:** visible labels on the three existing fields, and replacing the free-text Pitch
field with three `<select>`s (letter / accidental / octave) that support flat notation. No
change to Start/End's text-entry behaviour, and no change to `applyEdits()` or the edit types.

## Motivation

v1.16.3's fields work but have two rough edges surfaced immediately on first real use:

1. The fields carry no visible label — only a `title`/`aria-label` tooltip. A user has to
   already know what each field is for, or hover to find out.
2. The Pitch field only accepts sharp spellings (`parseNoteName()` rejects `"Db4"` by design).
   There is no way to enter a flat-named pitch at all, even though flats and sharps are the
   same set of physical pitches — just a different name for half of them.

## Goals

- Each of Start, End, Pitch gets a visible text label, stacked above the field.
- The Pitch field becomes three dropdowns — letter (A–G), accidental (`#` / blank / `b`),
  octave (−1 to 9) — so a flat can be specified directly, unambiguously, with no typing.
- Picking any pitch dropdown value commits immediately (a `pitchNudge`, same as the existing
  `♯`/`♭`/`↑8ve`/`↓8ve` toolbar buttons already do), rather than waiting for Enter or Apply.
- `parseNoteName()` (Task 1, v1.16.3) is extended to resolve flat spellings to the correct
  MIDI number — including the two octave-boundary cases (`Cb` = the *B below* it, `Fb` = `E`
  in the same octave) — rather than rejecting them.

## Non-goals

- No change to Start/End's text-entry, Enter, Apply, or Escape behaviour. They keep working
  exactly as v1.16.3 shipped them.
- No change to `applyEdits()`, the edit types, or the edit list/undo model. Pitch dropdowns
  still dispatch the existing `pitchNudge` edit type with a computed `semitones` delta.
- Free-text flat entry. Flats are only reachable through the accidental dropdown; nothing
  changes about what a user can type into a text field, because there is no text field for
  pitch any more.
- Double sharps/flats, microtones, or any spelling `noteName()` itself can't produce.

## Success criteria

- Start, End, and Pitch each show a visible label above the field/field-group, using the
  existing translated tooltip strings (`notes.editFieldStart` → "Start time", etc.) — no new
  i18n keys.
- Selecting a note populates the pitch dropdowns to its letter/accidental/octave (always a
  sharp or natural spelling, since that's what `noteName()`/`sel.name` produce — the `b`
  option is available to type a NEW value, not something the dropdowns show for an unedited
  note).
- Changing any one of the three pitch dropdowns immediately dispatches a `pitchNudge` if the
  resulting note differs from the currently selected note's pitch, and dispatches nothing if
  it's the same (e.g. picking the same letter again, or an equivalent spelling).
- `parseNoteName("Db4")` returns the same MIDI number as `parseNoteName("C#4")`.
  `parseNoteName("Cb4")` returns the same MIDI number as `parseNoteName("B3")` (one octave
  down — this is the case a naive "just treat flat as sharp minus one" implementation gets
  wrong). `parseNoteName("Fb4")` returns the same MIDI number as `parseNoteName("E4")` (same
  octave, no boundary crossing).
- Start/End's Apply button and Enter-to-commit continue to work unchanged; Apply no longer has
  anything to do with Pitch, since pitch changes are already committed by the time Apply could
  be clicked.

## Design

### DOM and layout

Each field gains a `<label>` above it, stacked (per the approved layout mockup):

```
Start          End            Pitch
[0:12.340]    [0:12.980]    [D][ ][4]        [Apply]
```

The Pitch field's single `<input>` (`fieldPitch` in `app.js`, from v1.16.3's `zoomToolbar`) is
replaced by three `<select>`s built together, e.g. `fieldPitchLetter`, `fieldPitchAccidental`,
`fieldPitchOctave`, grouped under one shared label. All three stay disabled until a note is
selected, joining the same disabled-until-selected loop in `syncEditToolbar()` that already
covers the other controls — three entries replace the one `fieldPitch` entry there.

Letter options: `A`–`G`. Accidental options: `#`, *(blank, natural)*, `b` — the blank option's
value is `''` so building the pitch string (`letter + accidental + octave`) needs no special
case. Octave options: `-1` through `9` (the full MIDI-derivable range, matching what
`noteName()` can already produce for MIDI 0–127).

### Populating from a note

The dropdowns read from `sel.name` (the note's own precomputed display string, e.g. `"C#4"`
or `"D4"` — always sharp-or-natural, never flat, exactly as v1.16.3 already established for
the single Pitch field), split with the same shape of regex `parseNoteName` itself uses:

```js
const m = /^([A-G])(#?)(-?\d+)$/.exec(sel.name);
fieldPitchLetter.value = m[1];
fieldPitchAccidental.value = m[2];       // '#' or ''
fieldPitchOctave.value = m[3];
```

Unlike Start/End, this sync can run unconditionally on every `syncEditToolbar()` tick with no
`fieldsShownFor`-style guard: a `<select>`'s displayed value only ever changes through an
explicit choice (there's no "mid-keystroke" state to protect), and the moment a choice fires
its `change` event, that choice is already being committed — so re-syncing to the
(about-to-be-identical) current note's values on the very next tick is a harmless no-op, not a
clobber. The existing `fieldsShownFor` guard stays exactly as-is for Start/End, which do still
have uncommitted, clobber-able typed state.

### Commit — pitch splits away from Start/End's Apply flow

Each of the three `<select>`s gets a `change` listener:

```js
function commitPitchDropdown() {
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
  if (!n) return;

  const pitchStr = zoomToolbar.fieldPitchLetter.value
                 + zoomToolbar.fieldPitchAccidental.value
                 + zoomToolbar.fieldPitchOctave.value;
  const newMidi = window.SansPitch.parseNoteName(pitchStr);
  if (newMidi === null || newMidi === n.midi) return;   // dropdowns are always well-formed,
                                                          // so null only means a genuine bug —
                                                          // treat it the same as "no change"

  selectedNote = { at: selectedNote.at, midi: newMidi };
  dispatchEdit([{ type: 'pitchNudge', at: selectedNote.at, semitones: newMidi - n.midi, midi: n.midi }]);
  fieldsShownFor = null;   // Start/End's guard var — unaffected by pitch, but a pitch change
                            // can change which note is "selected", so force their refresh too
  syncEditToolbar();
}
```

This is the same shape as v1.16.3's `commitFields()` but scoped to one edit type and firing
per-dropdown-change instead of on Enter/Apply. `commitFields()` itself (Start/End) drops its
Pitch-related lines entirely — it becomes a pure time-only commit function, and the shared
`applyBtn` only ever produces a `timeAdjust`.

### `parseNoteName()`: from a sharps-only lookup to a semitone formula

v1.16.3's `parseNoteName()` rejected flats by design — the concern at the time was a free-text
field silently *reinterpreting* an ambiguous-looking entry. That concern doesn't apply here:
the accidental dropdown makes "flat" an explicit, unambiguous choice, not a guess about what
the user meant. Flats and sharps names for the same pitch are not ambiguous — `Db4` and `C#4`
are, by definition, the identical physical note — so accepting flats is not a weakening of the
original safety property, just extending the same round-trip-safe parsing to a second, equally
well-defined spelling.

The v1.16.3 implementation computed a MIDI number by looking up the exact spelled string in the
sharps-only `NOTE_NAMES` array. That approach can't extend to flats without a bug: naively
mapping a flat letter to "one semitone below its sharp-table index, wrapping within the same
octave number" gets `Cb4` and `Fb4` wrong, because `Cb4` is not `B4` — it's `B3`, one octave
down (`Cb` is only "the same octave" if you also shift the octave when the letter wraps past
`C`). The fix is to compute the answer as one continuous formula instead of a lookup-plus-wrap:

```js
const NATURAL_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function parseNoteName(str) {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(str.trim());
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const offset = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const octave = +m[3];
  return NATURAL_SEMITONE[letter] + offset + (octave + 1) * 12;
}
```

Because `NATURAL_SEMITONE[letter] + offset` is computed before the octave term is added, a
flat that pushes below 0 (only `Cb`, giving `-1`) or a sharp that pushes above 11 (`B#`, not
reachable from this UI but harmless if it ever is) folds into the *adjacent* octave's number
automatically, through ordinary arithmetic — not a special case. `parseNoteName("Cb4")` →
`0 - 1 + 5*12 = 59` = the same MIDI number as `parseNoteName("B3")` (`59`). `parseNoteName
("Fb4")` → `5 - 1 + 5*12 = 64` = the same as `parseNoteName("E4")` (`64`).

This still round-trips every value `noteName()` can produce (sharps only), still rejects
garbage (`"H4"`, `"C"`, `"4C"`) and double accidentals (`"C##4"`, `"Cb#4"` — the regex allows
only one of `#`/`b`), and is still case-insensitive with negative-octave support, exactly as
v1.16.3's version was. The only behaviour change is that a flat spelling now resolves instead
of returning `null`.

### Labels

`<label>` elements above each field/group use the existing translated strings already in
`lib/i18n.js` from v1.16.3 (`notes.editFieldStart` → "Start time" / "起始時間",
`notes.editFieldEnd` → "End time" / "結束時間", `notes.editFieldPitch` → "Pitch" / "音高") —
the same keys already driving the `title`/`aria-label` attributes, now also driving visible
text. No new i18n keys.

## Testing

`parseNoteName()`'s test suite (`tests/pitch.test.js`, from v1.16.3) needs updating: the
existing `parseNoteName rejects flats` test asserted `parseNoteName('Db4') === null` and
`parseNoteName('Eb3') === null` — both assertions are now wrong on purpose and get replaced
with a test asserting flats resolve to the correct MIDI number, including the `Cb`/`Fb`
octave-boundary cases called out above. Every other existing `parseNoteName` test (round-trip,
garbage rejection, case-insensitivity/negative octaves) should still pass unmodified, since
none of them exercise flat input.

No new automated tests for the dropdown DOM/interaction side, matching this feature's existing
convention. `docs/behaviour.md` rows E27/E28 need updating to describe the new label text and
the fact that pitch no longer participates in the Start/End Apply bundle (it auto-commits per
dropdown change, like the toolbar's `♯`/`♭` buttons) — the implementation plan should also add
a new row for "picking a flat accidental resolves to the correct enharmonic pitch."
