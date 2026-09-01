# Inline note-detail fields — labels and flat-pitch entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a visible label above each of the Start/End/Pitch inline note-editing fields, and
replace the free-text Pitch field with three dropdowns (letter, accidental, octave) so a flat
spelling can be entered directly and resolves to the correct pitch.

**Architecture:** `parseNoteName()` (`lib/pitch.js`) moves from a sharps-only lookup table to a
semitone-offset formula that also accepts flats, correctly handling the two letters (`Cb`,
`Fb`) whose flat spelling crosses an octave boundary. In `app.js`, the Pitch field's single
`<input>` is replaced by three `<select>`s that auto-commit a `pitchNudge` on every `change` —
splitting Pitch away from Start/End's Enter/Apply-staged commit path entirely. Every field gets
a visible `<label>` reusing the existing translated tooltip strings.

**Tech Stack:** Vanilla JS, no build step. `app.js` (classic script) for DOM/commit logic,
`lib/pitch.js` (ESM) for the pure formula change, `tests/pitch.test.js` for its coverage,
`styles.css` for the new label/dropdown layout. Everything else verified by hand per
`docs/behaviour.md`'s existing convention.

**Spec:** [`docs/superpowers/specs/2026-09-01-note-inline-fields-followups-design.md`](../specs/2026-09-01-note-inline-fields-followups-design.md)

---

## Before you start

This plan continues directly on the `feat/note-inline-fields` branch (already has PR #24 open)
— it is a fix/enhancement to that same unmerged feature, not a new branch. All file line
numbers below were read from the current state of that branch.

### Task 1: `parseNoteName()` resolves flats via a semitone formula

**Files:**
- Modify: `lib/pitch.js:37-48`
- Test: `tests/pitch.test.js:35-38`

This is the one pure, testable piece of this change, so it's done test-first and first —
everything in `app.js` later just calls it with a different input shape.

- [ ] **Step 1: Replace the "rejects flats" test with one asserting correct resolution**

Find (`tests/pitch.test.js:35-38`):

```js
test('pitch: parseNoteName rejects flats', () => {
  assertEq(parseNoteName('Db4'), null, 'flat spelling rejected, not silently reinterpreted');
  assertEq(parseNoteName('Eb3'), null, 'flat spelling rejected');
});
```

Replace with:

```js
test('pitch: parseNoteName resolves flats to the correct enharmonic MIDI number', () => {
  assertEq(parseNoteName('Db4'), parseNoteName('C#4'), 'Db4 is the same pitch as C#4');
  assertEq(parseNoteName('Eb3'), parseNoteName('D#3'), 'Eb3 is the same pitch as D#3');
  assertEq(parseNoteName('Cb4'), parseNoteName('B3'), 'Cb crosses an octave boundary: Cb4 is B3, not B4');
  assertEq(parseNoteName('Fb4'), parseNoteName('E4'), 'Fb stays within the same octave: Fb4 is E4');
  assertEq(parseNoteName('bb2'), parseNoteName('A#2'), 'lowercase flat letter accepted, same as sharps already were');
});
```

- [ ] **Step 2: Start the local server and run the tests to see them fail**

```bash
./scripts/serve.sh 8778 &
```

(Skip this if a server is already running on 8778 for this worktree — check with
`lsof -i :8778` first.) Load `http://localhost:8778/tests/test.html` (via the `claude-in-chrome`
tools — `tabs_create_mcp` then `navigate`) and read `window.__testResults`.

Expected: the new test fails (`parseNoteName('Db4')` currently returns `null`, not a number, so
comparing it to `parseNoteName('C#4')` — a real MIDI number — fails).

- [ ] **Step 3: Replace `parseNoteName()`'s implementation with the semitone formula**

Find (`lib/pitch.js:37-48`):

```js
/** Scientific pitch name -> MIDI note number, the exact inverse of noteName(). Sharps only —
 *  "Db4" is rejected (null), not silently reinterpreted as "C#4" — so a value read from a
 *  note and never touched round-trips unchanged, and a flat entry visibly reverts instead of
 *  landing on a pitch the user didn't type. */
export function parseNoteName(str) {
  const m = /^([A-Ga-g])(#?)(-?\d+)$/.exec(str.trim());
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const idx = NOTE_NAMES.indexOf(letter + (m[2] ? '#' : ''));
  if (idx < 0) return null;
  return idx + (+m[3] + 1) * 12;
}
```

Replace with:

```js
/** Natural-letter -> semitone within an octave, C=0. Used by parseNoteName() to compute a
 *  flat or sharp spelling as one continuous offset rather than a table lookup, which is what
 *  makes Cb/Fb (the two letters whose flat crosses an octave boundary) come out correct: the
 *  octave term is added AFTER the letter+accidental offset, so a flat that goes negative
 *  (only Cb, giving -1) naturally folds into the octave below instead of needing a special case. */
const NATURAL_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Scientific pitch name -> MIDI note number, the exact inverse of noteName() for every sharp
 *  spelling noteName() can produce, and ALSO accepts flats (e.g. "Db4"), resolving to the same
 *  MIDI number as the equivalent sharp spelling. Flats aren't ambiguous — "Db4" and "C#4" are,
 *  by definition, the identical physical pitch — so accepting them isn't a weaker version of
 *  the original round-trip guarantee, just extending it to a second, equally well-defined
 *  spelling. Garbage (bad letter, missing octave, double accidental) still returns null. */
export function parseNoteName(str) {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(str.trim());
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const offset = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const octave = +m[3];
  return NATURAL_SEMITONE[letter] + offset + (octave + 1) * 12;
}
```

- [ ] **Step 4: Reload and re-run the tests**

Reload `http://localhost:8778/tests/test.html` (a hard navigation — `serve.sh` sends
`no-store`, so a normal reload is enough) and re-read `window.__testResults`.

Expected: `window.__testResults.failed === 0`, including every pre-existing `parseNoteName`
test (round-trip, garbage rejection, case-insensitivity/negative octaves) still passing
unmodified — this change only adds behavior for flat input, it doesn't change how sharps or
garbage are handled.

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "pitch: parseNoteName resolves flats via a semitone formula, not a sharps-only lookup"
```

---

### Task 2: Rebuild the field DOM — visible labels, Pitch becomes three dropdowns

**Files:**
- Modify: `app.js:685-733` (the whole field-construction block, replaced in one pass so there's
  no throwaway intermediate shape)

This produces the FINAL DOM shape directly: labels on all three fields, and Pitch built as
three `<select>`s from the start, rather than adding labels to the old text-input Pitch field
and then replacing it in a later task.

- [ ] **Step 1: Replace the whole field-construction block**

Find (`app.js:685-733`):

```js
    /* Inline Start/End/Pitch fields, next to the toolbar. Same hidden-until-edit-mode and
     * disabled-until-selected rules as the toolbar buttons above — see docs/superpowers/
     * specs/2026-09-01-note-inline-fields-design.md. */
    const zFields = document.createElement('div');
    zFields.className = 'note-fields';
    zFields.hidden = !editMode;

    const mkFieldInput = (titleKey) => {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'note-field';
      inp.title = tr(titleKey);
      inp.setAttribute('aria-label', tr(titleKey));
      inp.disabled = true;
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitFields();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          inp.blur();
          fieldsShownFor = null;
          syncEditToolbar();
        }
      });
      return inp;
    };

    const fieldStart = mkFieldInput('notes.editFieldStart');
    const fieldEnd = mkFieldInput('notes.editFieldEnd');
    const fieldPitch = mkFieldInput('notes.editFieldPitch');
    const applyBtn = document.createElement('button');
    applyBtn.className = 'mini note-tbtn';
    applyBtn.type = 'button';
    applyBtn.textContent = tr('notes.editFieldApply');
    applyBtn.disabled = true;
    applyBtn.addEventListener('click', commitFields);

    zFields.append(fieldStart, fieldEnd, fieldPitch, applyBtn);

    zoomToolbar = { root: zToolbar, fields: zFields, add: addBtn, octUp, octDown, pitchUp,
                     pitchDown, timeBack, timeFwd, split, del, rangeDel,
                     fieldStart, fieldEnd, fieldPitch, applyBtn };

    zLane.append(zName, zCanvas, zRangeHint, zToolbar, zFields, zSpacer, zGrip);
    el.lanes.insertBefore(zLane, lane);
    attachZoom(zCanvas);
    zoomEl = { lane: zLane, canvas: zCanvas, out: zOut };
    zLane.hidden = true;
  }
```

Replace with:

```js
    /* Inline Start/End/Pitch fields, next to the toolbar. Same hidden-until-edit-mode and
     * disabled-until-selected rules as the toolbar buttons above — see docs/superpowers/
     * specs/2026-09-01-note-inline-fields-design.md and its labels/flat-pitch follow-up. */
    const zFields = document.createElement('div');
    zFields.className = 'note-fields';
    zFields.hidden = !editMode;

    const mkFieldInput = (titleKey) => {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'note-field';
      inp.title = tr(titleKey);
      inp.setAttribute('aria-label', tr(titleKey));
      inp.disabled = true;
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitFields();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          inp.blur();
          fieldsShownFor = null;
          syncEditToolbar();
        }
      });
      return inp;
    };

    /* Wraps a field in a <label> so the visible caption also focuses the control on click —
     * no id/for plumbing needed, this project doesn't put ids on dynamically-built elements. */
    const mkFieldGroup = (titleKey, control) => {
      const label = document.createElement('label');
      label.className = 'note-field-group';
      const span = document.createElement('span');
      span.className = 'note-field-label';
      span.textContent = tr(titleKey);
      label.append(span, control);
      return label;
    };

    const fieldStart = mkFieldInput('notes.editFieldStart');
    const fieldEnd = mkFieldInput('notes.editFieldEnd');
    const startGroup = mkFieldGroup('notes.editFieldStart', fieldStart);
    const endGroup = mkFieldGroup('notes.editFieldEnd', fieldEnd);

    /* Pitch is three selects, not a text field — a flat accidental is an explicit choice here,
     * not a guess a free-text parser would have to interpret. Auto-commits on change (Task 4),
     * so it never joins Start/End's Enter/Apply-staged path. */
    const mkFieldSelect = (options, titleKey) => {
      const sel = document.createElement('select');
      sel.className = 'note-field note-field-select';
      sel.title = tr(titleKey);
      sel.setAttribute('aria-label', tr(titleKey));
      sel.disabled = true;
      for (const opt of options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        sel.append(o);
      }
      sel.addEventListener('change', commitPitchDropdown);
      return sel;
    };

    const PITCH_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const PITCH_ACCIDENTALS = [
      { value: '#', label: '♯' },   // ♯
      { value: '', label: '♮' },    // ♮
      { value: 'b', label: '♭' },   // ♭
    ];
    const PITCH_OCTAVES = Array.from({ length: 11 }, (_, i) => String(i - 1));   // "-1".."9"

    const fieldPitchLetter = mkFieldSelect(PITCH_LETTERS.map((l) => ({ value: l, label: l })), 'notes.editFieldPitch');
    const fieldPitchAccidental = mkFieldSelect(PITCH_ACCIDENTALS, 'notes.editFieldPitch');
    const fieldPitchOctave = mkFieldSelect(PITCH_OCTAVES.map((o) => ({ value: o, label: o })), 'notes.editFieldPitch');

    const pitchGroupInner = document.createElement('div');
    pitchGroupInner.className = 'note-field-pitch-group';
    pitchGroupInner.append(fieldPitchLetter, fieldPitchAccidental, fieldPitchOctave);

    const pitchLabel = document.createElement('span');
    pitchLabel.className = 'note-field-label';
    pitchLabel.textContent = tr('notes.editFieldPitch');

    const pitchGroup = document.createElement('div');
    pitchGroup.className = 'note-field-group';
    pitchGroup.append(pitchLabel, pitchGroupInner);

    const applyBtn = document.createElement('button');
    applyBtn.className = 'mini note-tbtn';
    applyBtn.type = 'button';
    applyBtn.textContent = tr('notes.editFieldApply');
    applyBtn.disabled = true;
    applyBtn.addEventListener('click', commitFields);

    zFields.append(startGroup, endGroup, pitchGroup, applyBtn);

    zoomToolbar = { root: zToolbar, fields: zFields, add: addBtn, octUp, octDown, pitchUp,
                     pitchDown, timeBack, timeFwd, split, del, rangeDel,
                     fieldStart, fieldEnd, fieldPitchLetter, fieldPitchAccidental,
                     fieldPitchOctave, applyBtn };

    zLane.append(zName, zCanvas, zRangeHint, zToolbar, zFields, zSpacer, zGrip);
    el.lanes.insertBefore(zLane, lane);
    attachZoom(zCanvas);
    zoomEl = { lane: zLane, canvas: zCanvas, out: zOut };
    zLane.hidden = true;
  }
```

Note this references `commitPitchDropdown`, which doesn't exist as a real function yet (Task 4
adds it) — safe for the same reason `commitFields` being referenced here was already safe
before it existed in earlier work: `sel.addEventListener('change', commitPitchDropdown)` passes
the bare identifier as a value at THIS line's execution time (when a song loads and the zoom
toolbar is built), and `commitPitchDropdown` genuinely doesn't exist yet after this task alone
— so **do not load a real song and select a note in the browser until Task 4 is also done**.
Verify this task with the bare page (no song) only; that's covered in Step 2 below.

- [ ] **Step 2: Verify the page still loads cleanly with no song loaded**

```bash
./scripts/serve.sh 8778 &   # skip if already running on this worktree's port 8778
```

Load `http://localhost:8778/` (no song) via claude-in-chrome tools and check the console for
errors (`read_console_messages`, or check via `javascript_tool`).

Expected: no errors (only the expected/documented GoatCounter "not counting because of:
localhost" warning). `zoomToolbar` stays `null` since no song has built it yet, so nothing here
executes.

Also run `node --check app.js` to confirm no syntax errors, and confirm the full unit suite is
still green:

Load `http://localhost:8778/tests/test.html`, read `window.__testResults`.

Expected: `window.__testResults.failed === 0`.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "app: rebuild the inline fields with visible labels; Pitch becomes 3 dropdowns"
```

---

### Task 3: `syncEditToolbar()`/`syncNoteFields()` for the new field shape

**Files:**
- Modify: `app.js:1220-1271` (`syncEditToolbar` and `syncNoteFields`)

- [ ] **Step 1: Update the disable loop and the sync logic**

Find (`app.js:1220-1271`):

```js
function syncEditToolbar() {
  if (!zoomToolbar) return;
  const sel = ribbon && selectedNote ? noteAt(ribbon.notes, selectedNote.at, selectedNote.midi) : null;
  if (selectedNote && !sel) selectedNote = null;
  for (const b of [zoomToolbar.octUp, zoomToolbar.octDown, zoomToolbar.pitchUp,
                    zoomToolbar.pitchDown, zoomToolbar.timeBack, zoomToolbar.timeFwd,
                    zoomToolbar.split, zoomToolbar.del, zoomToolbar.fieldStart,
                    zoomToolbar.fieldEnd, zoomToolbar.fieldPitch, zoomToolbar.applyBtn]) {
    b.disabled = !sel;
  }
  zoomToolbar.rangeDel.disabled = !rangeSelection;
  syncNoteFields(sel);
}

/** Keeps the three inline fields in step with the selected note without clobbering an
 *  in-progress keystroke. A rewrite only happens when the selection's identity ({at, midi})
 *  differs from fieldsShownFor — the same note staying selected is a no-op here, which is
 *  what actually protects a mid-type value from draw()'s per-frame calls today (the input
 *  exclusion in the top-level `keydown` handler, see app.js ~2144, keeps a hotkey from
 *  changing `selectedNote` while a field has focus). The `document.activeElement` check below
 *  is defense-in-depth on top of that: it only applies in the *routine* per-frame path
 *  (fieldsShownFor already set), so a future call site that changes `selectedNote` while a
 *  field is focused — without going through that keydown guard — still can't clobber it. It
 *  does NOT apply to the *forced* refresh path: commitFields (Task 6) resets
 *  fieldsShownFor = null right after a commit specifically so the rewrite goes through even
 *  though the field the user just pressed Enter in is still focused at that exact moment —
 *  that's what makes a reverted/updated value visibly snap back. Gating the focus check on
 *  fieldsShownFor being non-null is what keeps those two paths apart. See
 *  docs/superpowers/specs/2026-09-01-note-inline-fields-design.md ("Refresh vs. typing"). */
function syncNoteFields(sel) {
  if (!sel) {
    if (fieldsShownFor !== null) {
      zoomToolbar.fieldStart.value = '';
      zoomToolbar.fieldEnd.value = '';
      zoomToolbar.fieldPitch.value = '';
      fieldsShownFor = null;
    }
    return;
  }
  const key = { at: selectedNote.at, midi: selectedNote.midi };
  if (fieldsShownFor) {
    const sameNote = fieldsShownFor.at === key.at && fieldsShownFor.midi === key.midi;
    const focused = document.activeElement;
    const fieldFocused = focused === zoomToolbar.fieldStart || focused === zoomToolbar.fieldEnd ||
                          focused === zoomToolbar.fieldPitch;
    if (sameNote || fieldFocused) return;
  }
  zoomToolbar.fieldStart.value = fmtPrecise(sel.start);
  zoomToolbar.fieldEnd.value = fmtPrecise(sel.end);
  zoomToolbar.fieldPitch.value = sel.name;
  fieldsShownFor = key;
}
```

Replace with:

```js
function syncEditToolbar() {
  if (!zoomToolbar) return;
  const sel = ribbon && selectedNote ? noteAt(ribbon.notes, selectedNote.at, selectedNote.midi) : null;
  if (selectedNote && !sel) selectedNote = null;
  for (const b of [zoomToolbar.octUp, zoomToolbar.octDown, zoomToolbar.pitchUp,
                    zoomToolbar.pitchDown, zoomToolbar.timeBack, zoomToolbar.timeFwd,
                    zoomToolbar.split, zoomToolbar.del, zoomToolbar.fieldStart,
                    zoomToolbar.fieldEnd, zoomToolbar.fieldPitchLetter,
                    zoomToolbar.fieldPitchAccidental, zoomToolbar.fieldPitchOctave,
                    zoomToolbar.applyBtn]) {
    b.disabled = !sel;
  }
  zoomToolbar.rangeDel.disabled = !rangeSelection;
  syncNoteFields(sel);
}

/** Keeps Start/End in step with the selected note without clobbering an in-progress keystroke
 *  — same guard as before, just with Pitch removed from the focus-check array, since Pitch is
 *  no longer a text field a user can be mid-typing into (see syncPitchDropdowns' own comment
 *  for why it doesn't need this guard at all). A rewrite only happens when the selection's
 *  identity ({at, midi}) differs from fieldsShownFor — the same note staying selected is a
 *  no-op here, which is what actually protects a mid-type value from draw()'s per-frame calls
 *  today (the input exclusion in the top-level `keydown` handler, see app.js ~2144, keeps a
 *  hotkey from changing `selectedNote` while a field has focus). The `document.activeElement`
 *  check below is defense-in-depth on top of that: it only applies in the *routine* per-frame
 *  path (fieldsShownFor already set), so a future call site that changes `selectedNote` while
 *  a field is focused — without going through that keydown guard — still can't clobber it. It
 *  does NOT apply to the *forced* refresh path: commitFields resets fieldsShownFor = null
 *  right after a commit specifically so the rewrite goes through even though the field the
 *  user just pressed Enter in is still focused at that exact moment — that's what makes a
 *  reverted/updated value visibly snap back. Gating the focus check on fieldsShownFor being
 *  non-null is what keeps those two paths apart. See docs/superpowers/specs/
 *  2026-09-01-note-inline-fields-design.md ("Refresh vs. typing"). */
function syncNoteFields(sel) {
  if (!sel) {
    if (fieldsShownFor !== null) {
      zoomToolbar.fieldStart.value = '';
      zoomToolbar.fieldEnd.value = '';
      fieldsShownFor = null;
    }
    return;
  }
  syncPitchDropdowns(sel);
  const key = { at: selectedNote.at, midi: selectedNote.midi };
  if (fieldsShownFor) {
    const sameNote = fieldsShownFor.at === key.at && fieldsShownFor.midi === key.midi;
    const focused = document.activeElement;
    const fieldFocused = focused === zoomToolbar.fieldStart || focused === zoomToolbar.fieldEnd;
    if (sameNote || fieldFocused) return;
  }
  zoomToolbar.fieldStart.value = fmtPrecise(sel.start);
  zoomToolbar.fieldEnd.value = fmtPrecise(sel.end);
  fieldsShownFor = key;
}

/** Keeps the three Pitch dropdowns in step with the selected note on EVERY sync tick, with no
 *  identity or focus guard — unlike Start/End, a <select>'s displayed value only ever changes
 *  through an explicit choice, and the moment that choice fires its change event it's already
 *  being committed (see commitPitchDropdown). There's no "mid-keystroke" state to protect, so
 *  re-syncing to the about-to-be-identical current note's values on the very next tick is a
 *  harmless no-op, not a clobber. sel.name is always a sharp-or-natural spelling (same as
 *  noteName() produces), never a flat — the accidental dropdown's "b" option is for typing a
 *  NEW value, not something an unedited note's spelling ever shows. */
function syncPitchDropdowns(sel) {
  const m = /^([A-G])(#?)(-?\d+)$/.exec(sel.name);
  if (!m) return;
  zoomToolbar.fieldPitchLetter.value = m[1];
  zoomToolbar.fieldPitchAccidental.value = m[2];
  zoomToolbar.fieldPitchOctave.value = m[3];
}
```

- [ ] **Step 2: Commit**

```bash
git add app.js
git commit -m "app: sync the three Pitch dropdowns unconditionally, Start/End keep the existing guard"
```

---

### Task 4: `commitPitchDropdown()`, and strip Pitch out of `commitFields()`

**Files:**
- Modify: `app.js:1984-2027` (`commitFields`, plus a new function added right after it)

- [ ] **Step 1: Replace `commitFields()` and add `commitPitchDropdown()`**

Find (`app.js:1984-2027`):

```js
/** Commits the three inline fields: Enter in any of them, or a click on Apply, calls this.
 *  A field that fails to parse is treated as "unchanged" here, not as blocking the OTHER
 *  field — a garbage Start shouldn't swallow a valid End edit sitting right next to it. The
 *  forced refresh at the end (fieldsShownFor = null) is what makes the garbage field visibly
 *  snap back, which is the actual "revert silently" the user sees. See docs/superpowers/
 *  specs/2026-09-01-note-inline-fields-design.md ("Commit"). */
function commitFields() {
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
  if (!n) return;

  const parsedStart = parseTimeMmSs(zoomToolbar.fieldStart.value);
  const parsedEnd   = parseTimeMmSs(zoomToolbar.fieldEnd.value);
  const newStart = parsedStart !== null ? parsedStart : n.start;
  const newEnd   = parsedEnd   !== null ? parsedEnd   : n.end;
  const dStart = newStart - n.start;
  const dEnd   = newEnd - n.end;
  const timeValid = newStart >= 0 && (newEnd - newStart) >= 0.02;
  // The field never holds more precision than fmtPrecise displays (whole milliseconds), so an
  // untouched field round-trips through parseTimeMmSs as a few tenths of a millisecond of noise,
  // not exactly 0. Comparing dStart/dEnd at that same millisecond granularity is what tells real
  // edits apart from that round-trip noise; the values dispatched below stay full-precision.
  const changedTime = Math.round(dStart * 1000) !== 0 || Math.round(dEnd * 1000) !== 0;

  const newMidi = window.SansPitch.parseNoteName(zoomToolbar.fieldPitch.value);

  const edits = [];
  if (timeValid && changedTime) {
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

Replace with:

```js
/** Commits the Start/End fields: Enter in either of them, or a click on Apply, calls this.
 *  Pitch no longer goes through here — see commitPitchDropdown, which auto-commits on every
 *  dropdown change instead. A field that fails to parse is treated as "unchanged", not as
 *  blocking anything else. The forced refresh at the end (fieldsShownFor = null) is what makes
 *  a garbage field visibly snap back, which is the actual "revert silently" the user sees. See
 *  docs/superpowers/specs/2026-09-01-note-inline-fields-design.md ("Commit"). */
function commitFields() {
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
  if (!n) return;

  const parsedStart = parseTimeMmSs(zoomToolbar.fieldStart.value);
  const parsedEnd   = parseTimeMmSs(zoomToolbar.fieldEnd.value);
  const newStart = parsedStart !== null ? parsedStart : n.start;
  const newEnd   = parsedEnd   !== null ? parsedEnd   : n.end;
  const dStart = newStart - n.start;
  const dEnd   = newEnd - n.end;
  const timeValid = newStart >= 0 && (newEnd - newStart) >= 0.02;
  // The field never holds more precision than fmtPrecise displays (whole milliseconds), so an
  // untouched field round-trips through parseTimeMmSs as a few tenths of a millisecond of noise,
  // not exactly 0. Comparing dStart/dEnd at that same millisecond granularity is what tells real
  // edits apart from that round-trip noise; the values dispatched below stay full-precision.
  const changedTime = Math.round(dStart * 1000) !== 0 || Math.round(dEnd * 1000) !== 0;

  if (timeValid && changedTime) {
    const at = selectedNote.at;
    selectedNote = { at: at + dStart, midi: n.midi };
    dispatchEdit([{ type: 'timeAdjust', at, dStart, dEnd, midi: n.midi }]);
  }
  fieldsShownFor = null;   // force a refresh from the (possibly just-updated) note
  syncEditToolbar();
}

/** Fires on every change of any of the three Pitch dropdowns — no Enter or Apply, matching how
 *  the toolbar's existing ♯/♭/↑8ve/↓8ve buttons already auto-commit. Unlike those buttons
 *  (which nudge by a fixed relative amount and so always represent a real change), the
 *  dropdowns pick an ABSOLUTE note, so a genuine no-op is possible (e.g. re-picking an
 *  equivalent spelling of the current pitch) — hence the noteAt lookup and the equality check,
 *  the same shape commitFields used before Pitch was split out of it. */
function commitPitchDropdown() {
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
  if (!n) return;

  const pitchStr = zoomToolbar.fieldPitchLetter.value
                 + zoomToolbar.fieldPitchAccidental.value
                 + zoomToolbar.fieldPitchOctave.value;
  const newMidi = window.SansPitch.parseNoteName(pitchStr);
  if (newMidi === null || newMidi === n.midi) return;

  const at = selectedNote.at;
  selectedNote = { at, midi: newMidi };
  dispatchEdit([{ type: 'pitchNudge', at, semitones: newMidi - n.midi, midi: n.midi }]);
  fieldsShownFor = null;   // force Start/End's guard to refresh too, in case anchor moved
  syncEditToolbar();
}
```

- [ ] **Step 2: Sanity-check in the browser console (no real song needed for the pure logic)**

With the server running and `http://localhost:8778/` loaded (no song required for this check),
open the console and confirm the functions exist and are callable without throwing when there's
no selection (both should just return immediately):

```js
typeof commitFields === 'function'          // true
typeof commitPitchDropdown === 'function'   // true
commitFields()                              // no throw (selectedNote is null)
commitPitchDropdown()                       // no throw (selectedNote is null)
```

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "app: split Pitch's auto-commit out of commitFields into commitPitchDropdown"
```

---

### Task 5: CSS for labels and the pitch-dropdown group

**Files:**
- Modify: `styles.css:507-526`

- [ ] **Step 1: Add the new rules and adjust `.note-fields`' alignment**

Find (`styles.css:507-526`):

```css
.note-tbtn { font: 11px var(--mono); }
.note-tbtn:disabled { opacity: .4; cursor: default; }
.note-tbtn-danger { border-color: color-mix(in srgb, #ff6b81 45%, var(--line)); color: #ff9aa8; }
.note-tbtn-armed { border-color: var(--loop); color: var(--loop); }

.note-fields {
  grid-column: 1 / -1;
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
  margin-top: 4px;
}
.note-field {
  font: 11px var(--mono);
  background: transparent;
  border: 1px solid var(--line);
  color: var(--fg);
  border-radius: 4px;
  padding: 2px 6px;
  width: 6.5em;
}
.note-field:disabled { opacity: .4; cursor: default; }
```

Replace with:

```css
.note-tbtn { font: 11px var(--mono); }
.note-tbtn:disabled { opacity: .4; cursor: default; }
.note-tbtn-danger { border-color: color-mix(in srgb, #ff6b81 45%, var(--line)); color: #ff9aa8; }
.note-tbtn-armed { border-color: var(--loop); color: var(--loop); }

.note-fields {
  grid-column: 1 / -1;
  display: flex; flex-wrap: wrap; align-items: flex-end; gap: 4px;
  margin-top: 4px;
}
.note-field {
  font: 11px var(--mono);
  background: transparent;
  border: 1px solid var(--line);
  color: var(--fg);
  border-radius: 4px;
  padding: 2px 6px;
  width: 6.5em;
}
.note-field:disabled { opacity: .4; cursor: default; }

.note-field-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  cursor: default;
}
.note-field-label {
  font: 10px var(--mono);
  color: color-mix(in srgb, var(--fg) 65%, transparent);
}
.note-field-pitch-group {
  display: flex;
  gap: 2px;
}
.note-field-select {
  width: 3.2em;
  padding: 2px 2px;
}
```

`.note-field-select` is placed after `.note-field` in the stylesheet on purpose: both are
single-class selectors (equal specificity), so source order decides which `width` wins, and
this one needs to override `.note-field`'s `6.5em` with something that actually fits a letter,
a symbol, or a two-character octave number.

- [ ] **Step 2: Commit**

```bash
git add styles.css
git commit -m "ui: style the field labels and the pitch-dropdown group"
```

---

### Task 6: Bump the asset cache-buster version

**Files:**
- Modify: `index.html` (15 occurrences), `separate.js` (3), `separate.worker.js` (1),
  `notes.js` (3), `notes.worker.js` (1) — 23 in all
- Modify: `CLAUDE.md` (the version note at the end of the gotcha list)

`app.js`, `lib/pitch.js` and `styles.css` all changed in this plan, so the version must move.
Current is `1.16.3`; this is a follow-up session on the same version, so it becomes `1.16.4`.

- [ ] **Step 1: Bump all five files**

```bash
cd /Users/sansword/Source/github/sans_bass/.worktrees/feat-note-inline-fields
sed -i '' 's/?v=1\.16\.3/?v=1.16.4/g' index.html separate.js separate.worker.js notes.js notes.worker.js
```

- [ ] **Step 2: Verify every versioned URL still agrees, and none were missed**

```bash
grep -c '1\.16\.4' index.html separate.js separate.worker.js notes.js notes.worker.js
```

Expected counts: `index.html:15`, `separate.js:3`, `separate.worker.js:1`, `notes.js:3`,
`notes.worker.js:1` — 23 total (if the actual counts differ from these, verify by hand that
every occurrence in each file was updated — i.e. the count of `1.16.4` after the bump equals
the count of `1.16.3` before it, per file — rather than assuming a mismatch means something is
wrong). Also confirm no `1.16.3` remains in these five files:

```bash
grep -rn '1\.16\.3' index.html separate.js separate.worker.js notes.js notes.worker.js
```

Expected: no output.

- [ ] **Step 3: Update the version note in `CLAUDE.md`**

Find (in `CLAUDE.md`, near the end of the versioned-asset-URL gotcha):

```
  `tests/versions.test.js` fails if they drift — and it
  covers `.png` and `.svg` as well as `.js`/`.css`, so the icons are included. Currently
  `v1.16.3`.
```

Replace with:

```
  `tests/versions.test.js` fails if they drift — and it
  covers `.png` and `.svg` as well as `.js`/`.css`, so the icons are included. Currently
  `v1.16.4`.
```

- [ ] **Step 4: Run the full suite to confirm agreement**

With `./scripts/serve.sh 8778` still running, reload `http://localhost:8778/tests/test.html`
and read `window.__testResults`.

Expected: `window.__testResults.failed === 0`.

- [ ] **Step 5: Commit**

```bash
git add index.html separate.js separate.worker.js notes.js notes.worker.js CLAUDE.md
git commit -m "chore: bump asset version to 1.16.4"
```

---

### Task 7: Update `docs/behaviour.md` — E27, E28, and a new flat-resolution row

**Files:**
- Modify: `docs/behaviour.md` (rows E27, E28, plus one new row after E32)

- [ ] **Step 1: Update E27 for visible labels and the pitch dropdowns**

Find (in `docs/behaviour.md`):

```
| E27 | Selecting a note populates Start (`m:ss.mmm`), End (`m:ss.mmm`) and Pitch (e.g. `D4`) with its current values, and enables all three plus Apply — same as the toolbar buttons (E3). Selecting a different note updates the fields to the new note's values. The fields stay populated and enabled until the note itself is gone (deleted, or Edit notes toggled off) — clicking empty space seeks the playhead (E2) without deselecting, so it does not blank the fields either. | Tick Edit notes, select a note: the three fields fill in and become enabled. Click empty space: playhead seeks, fields keep showing the same values and stay enabled. Select a different note: fields update to its values. Delete the selected note, or untick Edit notes: fields go blank and disabled. |
```

Replace with:

```
| E27 | Each of Start, End, Pitch shows a visible label above it. Selecting a note populates Start (`m:ss.mmm`), End (`m:ss.mmm`) and Pitch's three dropdowns (letter, accidental, octave — e.g. `D`/*(blank)*/`4` for D4) with its current values, and enables everything plus Apply — same as the toolbar buttons (E3). Selecting a different note updates every field/dropdown to the new note's values. Everything stays populated and enabled until the note itself is gone (deleted, or Edit notes toggled off) — clicking empty space seeks the playhead (E2) without deselecting, so nothing blanks either. | Tick Edit notes: a label reads above each of Start/End/Pitch. Select a note: Start/End fill in, Pitch's three dropdowns show its letter/accidental/octave, everything becomes enabled. Click empty space: playhead seeks, everything keeps showing the same values and stays enabled. Select a different note: everything updates to its values. Delete the selected note, or untick Edit notes: everything goes blank/disabled again. |
```

- [ ] **Step 2: Update E28 to split Start/End's commit from Pitch's auto-commit**

Find (in `docs/behaviour.md`):

```
| E28 | Changing a field and pressing Enter (in any of the three), or changing any subset and clicking Apply, dispatches exactly the edits needed: one `timeAdjust` if Start and/or End changed, one `pitchNudge` if Pitch changed, and nothing for a field whose parsed value equals the note's current value. | Change only Pitch and press Enter: the edit list gains one `pitchNudge` row, no `timeAdjust`. Change Start and End together and click Apply: the edit list gains exactly one new `timeAdjust` row, not two. Re-commit without changing anything: no new row appears. |
```

Replace with:

```
| E28 | Changing Start and/or End and pressing Enter (in either) or clicking Apply dispatches exactly one `timeAdjust` if the resulting values differ from the note's current ones, and nothing if they don't. Changing any of the three Pitch dropdowns commits immediately — no Enter or Apply needed — dispatching one `pitchNudge` if the resulting note differs from the current pitch, same as the toolbar's ♯/♭ buttons, and nothing if it resolves to the same pitch (e.g. re-picking an equivalent spelling). | Change only Start and press Enter: the edit list gains one `timeAdjust` row. Change Start and End together and click Apply: still exactly one new row, not two. Re-commit without changing anything: no new row. Pick a different Pitch letter: the edit list immediately gains one `pitchNudge` row with no Enter/Apply needed. Pick the current pitch's equivalent spelling (no actual change): no new row appears. |
```

- [ ] **Step 3: Add a new row after E32 for flat resolution**

Find (in `docs/behaviour.md`, the end of the E32 row):

```
| E32 | Changing both Start and End together and committing produces exactly one `timeAdjust` edit-list row, not two — mirroring how a two-edge drag is already one edit. | Change both time fields to values different from what's shown, click Apply: exactly one new row appears in the edit list. |
```

Replace with:

```
| E32 | Changing both Start and End together and committing produces exactly one `timeAdjust` edit-list row, not two — mirroring how a two-edge drag is already one edit. | Change both time fields to values different from what's shown, click Apply: exactly one new row appears in the edit list. |
| E33 | Picking a flat accidental resolves to the same pitch as its sharp spelling, including the two letters whose flat crosses an octave boundary: `Cb` is the same pitch as the B *below* it, and `Fb` is the same pitch as E in the same octave. | Select a note, set Pitch's letter to C, octave to some value N, accidental to ♭: the resulting note lands on the same pitch B/(N-1) would. Set letter to F, same octave, accidental to ♭: lands on the same pitch as E in that same octave. |
```

- [ ] **Step 4: Commit**

```bash
git add docs/behaviour.md
git commit -m "docs: behaviour rows for visible field labels and flat-pitch dropdowns (E27-E28, E33)"
```

---

### Task 8: Manual browser verification

**Files:** none (verification only)

- [ ] **Step 1: Serve and load a song with a vocals stem**

With `./scripts/serve.sh 8778` running, open `http://localhost:8778/`, load a local song/zip
with a `vocals` stem, click **Find notes**, then tick **Edit notes**.

- [ ] **Step 2: Labels are visible**

Expected: "Start", "End", "Pitch" (or their translated equivalents) read as visible text above
each field/group, not just as a hover tooltip.

- [ ] **Step 3: E27 — Pitch dropdowns populate correctly**

Select a note. Note its pitch as shown elsewhere in the UI (e.g. the toolbar's existing pitch
display, or the note's on-canvas label).

Expected: the letter dropdown shows the note's letter, the accidental dropdown shows `♯` or `♮`
(never `♭`, since `sel.name` is always sharp-or-natural), and the octave dropdown shows the
right octave number.

- [ ] **Step 4: E28 — Pitch auto-commits, Start/End still need Enter/Apply**

Before selecting a note, run this in the console to see edits as they're dispatched:

```js
window.addEventListener('sansbass:noteedit', (e) => console.log(JSON.stringify(e.detail)));
```

Select a note. Change ONLY the Pitch letter dropdown to a different letter (leave accidental
and octave as-is).

Expected: the console immediately logs one `pitchNudge` edit — no click, no Enter, no Apply
needed. The edit list (open its summary) gains exactly one new row.

Now change the Start field's text and press Enter (don't touch Pitch).

Expected: one `timeAdjust` edit logs. Nothing extra involving pitch.

- [ ] **Step 5: E33 — flat resolves correctly**

Select a note. Set the letter dropdown to `C`, accidental to `♭` (leave octave as its current
value).

Expected: the logged `pitchNudge`'s resulting pitch (current midi + semitones) equals the MIDI
number of `B` one octave below the note's current octave — NOT `B` in the same octave. You can
compute the expected value in the console: `window.SansPitch.parseNoteName('B' + (currentOctave - 1))`
should equal the note's midi after the edit (`currentMidi + semitones` from the logged event).

Select a different note (or the same one, reselected). Set the letter to `F`, accidental to
`♭`, same octave.

Expected: resolves to the same pitch as `E` in that SAME octave (no octave shift this time).

- [ ] **Step 6: Everything else from the original feature still works**

Quickly re-confirm (these shouldn't have changed, but a real check is cheap): Escape reverts
Start/End without committing; invalid Start/End input reverts without blocking a valid sibling
edit; typing in Start/End survives a few seconds of playback without being clobbered; with
nothing selected all controls are visible-but-disabled; unticking Edit notes hides everything.

- [ ] **Step 7: Update `docs/behaviour.md`'s "last exercised" line**

Find, near the top of `docs/behaviour.md`, the "Last exercised end-to-end" sentence (it should
currently mention `E27-E32 were run in **v1.16.3**`). Append a clause noting E27, E28 and E33
were re-run/added in this version, e.g. change `E27-E32 were run in **v1.16.3**.` to
`E27-E32 were run in **v1.16.3**; E27, E28 and E33 were run in **v1.16.4**.`

- [ ] **Step 8: Commit**

```bash
git add docs/behaviour.md
git commit -m "docs: record E27/E28/E33 manual verification for v1.16.4"
```

If any expected outcome in Steps 2-6 did not hold, stop here and fix the relevant task above
before continuing — do not proceed to the devlog with a known-broken behaviour.

---

### Task 9: Devlog entry

**Files:**
- Modify: `docs/devlog.md`

- [ ] **Step 1: Get the timestamp for the heading**

```bash
git log -1 --format=%cd --date=format:'%Y-%m-%d %H:%M'
```

Use this timestamp (from the most recent commit made in this session) in the heading below.

- [ ] **Step 2: Add the TL;DR row**

Find, in `docs/devlog.md`'s TL;DR table, the v1.16.3 row (it should read something like
`| [v1.16.3](#v1163--inline-note-detail-fields-2026-09-01-0956) | Three inline fields...`).
Insert a new row immediately above it (newest-first):

```
| [v1.16.4](#v1164--inline-field-labels-and-flat-pitch-entry-YYYY-MM-DD-HHMM) | Visible labels above the Start/End/Pitch fields, and Pitch becomes three dropdowns (letter/accidental/octave) so a flat spelling can be entered directly. `parseNoteName()` moves from a sharps-only lookup to a semitone formula that resolves flats correctly, including the two letters (`Cb`, `Fb`) whose flat crosses an octave boundary. Picking a pitch dropdown auto-commits, splitting Pitch away from Start/End's Enter/Apply-staged path. |
```

Replace `YYYY-MM-DD-HHMM` with the actual date and `HH-MM` (colon removed) from Step 1's
timestamp, matching the anchor format GitHub generates for the Step 3 heading.

- [ ] **Step 3: Add the entry**

Find, in `docs/devlog.md`, the start of the v1.16.3 entry (`## v1.16.3 — Inline note-detail
fields (...)`). Insert a new entry immediately above it:

```
## v1.16.4 — Inline field labels and flat-pitch entry (YYYY-MM-DD HH:MM)

**Review:** not yet

**Design docs:**
- Inline field labels and flat-pitch entry: [Spec](superpowers/specs/2026-09-01-note-inline-fields-followups-design.md) [Plan](superpowers/plans/2026-09-01-note-inline-fields-followups.md)

**What was built:**

- Visible labels above Start, End, and Pitch — reusing the existing translated tooltip
  strings, no new i18n keys.
- Pitch's single text field replaced with three dropdowns (letter, accidental, octave), so a
  flat spelling (`Db`, `Eb`, ...) is an explicit, unambiguous choice instead of something a
  free-text parser would have to guess at.
- `parseNoteName()` moved from a sharps-only lookup table to a semitone-offset formula, so it
  now resolves flats to the correct MIDI number — including `Cb` (the same pitch as the B
  *below* it) and `Fb` (the same pitch as E in the same octave), the two letters whose flat
  crosses an octave boundary and where a naive "flat = sharp minus one, same octave" approach
  gets the wrong answer.
- Picking any pitch dropdown value auto-commits a `pitchNudge` immediately, the same way the
  toolbar's existing ♯/♭/↑8ve/↓8ve buttons already do — splitting Pitch away from Start/End's
  Enter/Apply-staged commit path entirely. `commitFields()` is now Start/End only.

**Key technical learnings:**

- `[insight]` **Accepting a second, unambiguous spelling isn't the same risk as accepting an
  ambiguous guess.** v1.16.3's `parseNoteName()` rejected flats specifically to avoid silently
  *reinterpreting* an ambiguous-looking free-text entry. That risk doesn't exist once flat
  becomes an explicit dropdown choice — `Db4` and `C#4` are, by definition, the identical
  physical pitch, not two different guesses about what the user meant. Recognizing that the
  original safety property was about ambiguity, not about flats specifically, is what made
  extending the function safe rather than a regression of the original design intent.
- `[gotcha]` **A flat's semitone offset can't be computed as a lookup-plus-wrap without getting
  two letters wrong.** Naively mapping a flat letter to "one semitone below its sharp-table
  index, wrapped within the same octave number" gets `Cb`/`Fb` wrong, because `Cb4` is not
  `B4` — it's `B3`, one octave down. The fix is a single continuous formula
  (`NATURAL_SEMITONE[letter] + offset + (octave+1)*12`) computed before any wrapping, so the
  octave boundary falls out of ordinary arithmetic instead of needing a special case. Caught
  by working through the two boundary letters by hand before writing the implementation, not
  by a failing test after the fact.
- `[note]` A `<select>` doesn't carry the same "mid-keystroke, clobber-able" risk a text input
  does — its value only changes through an explicit, already-committing choice — so the Pitch
  dropdowns' sync function needed none of Start/End's `fieldsShownFor`/focus-guard machinery,
  even though it's solving a superficially similar "keep the field in step with the note"
  problem right next to it.

---

```

Leave everything below the `---` (the existing v1.16.3 entry and onward) untouched.

- [ ] **Step 4: Commit**

```bash
git add docs/devlog.md
git commit -m "docs: v1.16.4 devlog entry"
```

---

## Self-review checklist (for whoever executes this plan)

- [ ] Every design-doc section has a corresponding task: DOM/labels (Task 2), pitch-dropdown
      sync (Task 3), commit split (Task 4), the flat-resolution formula (Task 1), CSS (Task 5).
- [ ] `applyEdits()` and the edit types themselves are confirmed untouched — this plan only
      ever calls `dispatchEdit()` with the existing `pitchNudge`/`timeAdjust` edit objects.
- [ ] `commitFields()` no longer references Pitch at all after Task 4; `commitPitchDropdown()`
      never references Start/End.
- [ ] Asset version bumped everywhere it's mirrored (Task 6), matching the same 23-occurrence
      convention as the previous version bump.
- [ ] `docs/behaviour.md` gained/updated rows for every item in the spec's Success criteria:
      labels (E27), pitch auto-commit split from Start/End (E28), flat resolution incl. the
      octave-boundary cases (new E33).
