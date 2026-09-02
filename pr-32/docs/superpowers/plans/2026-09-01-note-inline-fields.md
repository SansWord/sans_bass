# Inline note-detail fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three inline fields (Start, End, Pitch) next to the note editor's toolbar so a
selected note's exact values can be read and typed directly, committing via Enter or a shared
Apply button through the existing `timeAdjust`/`pitchNudge` edit types.

**Architecture:** A new `.note-fields` row lives beside the existing `.note-toolbar` in
`app.js`'s zoomed pane, built and gated exactly like the toolbar buttons (the `zoomToolbar`
object, the same disabled-until-selected loop). `lib/pitch.js` gains `parseNoteName()`, the
exact inverse of its existing `noteName()`, exposed to `app.js` (a classic script that cannot
`import` an ES module) through a new `window.SansPitch` bridge — the same shape as the
existing `window.sansBass` bridge, just running the other direction. A `fieldsShownFor`
identity guard stops `draw()`'s per-frame `syncEditToolbar()` from clobbering an in-progress
keystroke.

**Tech Stack:** Vanilla JS, no build step. `app.js` (classic script) for the DOM/toolbar/commit
logic, `lib/pitch.js` (ESM) for the one pure function, `lib/i18n.js` for the four new
tooltip/label strings, browser-page test harness (`tests/test.html` / `tests/pitch.test.js`)
for `parseNoteName()` — the one part of this change that's automatable. Everything else is
verified by hand per `docs/behaviour.md`'s existing convention (`app.js` has no DOM test
runner).

**Spec:** [`docs/superpowers/specs/2026-09-01-note-inline-fields-design.md`](../specs/2026-09-01-note-inline-fields-design.md)

---

## Before you start

Read [`CLAUDE.md`](../../../CLAUDE.md)'s "Gotchas that will bite again" section once —
especially the versioned-asset-URL gotcha (Task 7 below) and the i18n
both-locales-must-move-together gotcha (Task 3). Every task below assumes a fresh
implementation branch off `main` — the design branch (`docs/note-inline-fields-design`) is
design-only and does not get this code, per the spec's own header.

**One architectural gap the spec doesn't spell out:** `app.js` is a classic script and cannot
`import` from `lib/pitch.js` (an ES module) the way `notes.js` does. `commitFields()`'s call
to `parseNoteName()` needs a bridge — the same way `window.sansBass` already bridges the
other direction (`app.js` → `notes.js`). Task 1 adds `window.SansPitch`, set by
`lib/pitch.js` itself at module load. By the time a user can click anything, `notes.js`
(which imports `lib/pitch.js` at its own top level) has already run, so the bridge exists
long before `commitFields()` could ever need it — see Task 1's comment for the full
reasoning.

### Task 0: Branch

- [ ] **Step 1: Confirm a clean tree and branch off `main`**

```bash
git status
git checkout main
git pull
git checkout -b feat/note-inline-fields
```

Expected: `git status` shows nothing to commit before switching (the two untracked audio
files noted in this session's context are pre-existing clutter in the working tree, not
yours — leave them alone; nothing below touches them). The new branch is based on `main`,
not on the design branch.

---

### Task 1: `parseNoteName()` in `lib/pitch.js`, plus the `window.SansPitch` bridge

**Files:**
- Modify: `lib/pitch.js` (after `noteName()`, around line 33-35)
- Test: `tests/pitch.test.js`

This is the one piece of this change with a real test runner, so it's done test-first and
first — everything in `app.js` later just has to call it correctly.

- [ ] **Step 1: Write the failing tests**

Open `tests/pitch.test.js`. Find the import line near the top (line 2):

```js
import { centsFromHz, hzFromCents, midiFromCents, noteName } from '../lib/pitch.js';
```

Replace with:

```js
import { centsFromHz, hzFromCents, midiFromCents, noteName, parseNoteName } from '../lib/pitch.js';
```

Find the existing `noteName` test (around line 22-26):

```js
test('pitch: noteName spells MIDI numbers with octaves', () => {
  assertEq(noteName(69), 'A4', 'concert A');
  assertEq(noteName(60), 'C4', 'middle C');
  assertEq(noteName(40), 'E2', 'guitar low E');
  assertEq(noteName(61), 'C#4', 'sharps, never flats');
});
```

Insert four new tests right after it:

```js
test('pitch: noteName spells MIDI numbers with octaves', () => {
  assertEq(noteName(69), 'A4', 'concert A');
  assertEq(noteName(60), 'C4', 'middle C');
  assertEq(noteName(40), 'E2', 'guitar low E');
  assertEq(noteName(61), 'C#4', 'sharps, never flats');
});

test('pitch: parseNoteName inverts noteName for every output it can produce', () => {
  for (const m of [0, 1, 12, 40, 60, 61, 69, 127, -1, -12]) {
    assertEq(parseNoteName(noteName(m)), m, `round-trip midi ${m}`);
  }
});

test('pitch: parseNoteName rejects flats', () => {
  assertEq(parseNoteName('Db4'), null, 'flat spelling rejected, not silently reinterpreted');
  assertEq(parseNoteName('Eb3'), null, 'flat spelling rejected');
});

test('pitch: parseNoteName rejects garbage', () => {
  assertEq(parseNoteName(''), null, 'empty string');
  assertEq(parseNoteName('H4'), null, 'invalid letter');
  assertEq(parseNoteName('C'), null, 'missing octave');
  assertEq(parseNoteName('C##4'), null, 'double sharp');
  assertEq(parseNoteName('4C'), null, 'reversed order');
});

test('pitch: parseNoteName accepts negative octaves and is case-insensitive', () => {
  assertEq(parseNoteName('C-1'), 0, 'MIDI 0 is C-1');
  assertEq(parseNoteName('c#-2'), -11, 'lowercase input accepted, negative octave');
});
```

- [ ] **Step 2: Start the local server and run the tests to see them fail**

```bash
./scripts/serve.sh &
```

Wait for `==> http://localhost:8777` to print, then load
`http://localhost:8777/tests/test.html` in a browser (or via the `claude-in-chrome` tools —
`tabs_create_mcp` then `navigate`) and read `window.__testResults`.

Expected: `window.__testResults.failed >= 1` (a `ReferenceError`/import failure, since
`parseNoteName` doesn't exist yet).

- [ ] **Step 3: Implement `parseNoteName()` and the `window.SansPitch` bridge**

In `lib/pitch.js`, find (around line 33-35):

```js
/** MIDI note number -> scientific pitch name, sharps only ("C#4", never "Db4"). */
export function noteName(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}
```

Replace with:

```js
/** MIDI note number -> scientific pitch name, sharps only ("C#4", never "Db4"). */
export function noteName(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

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

/* app.js is a classic script and can't `import` this ES module the way notes.js does, so it
 * needs a bridge the same way window.sansBass already bridges app.js -> notes.js in the
 * other direction. This line runs at module load, well before any user interaction is
 * possible: notes.js imports lib/pitch.js at the top of its own module body, and that import
 * is what actually executes this assignment — long before the note-fields' Enter/Apply
 * handlers could ever call window.SansPitch.parseNoteName. */
if (typeof window !== 'undefined') window.SansPitch = { parseNoteName };
```

- [ ] **Step 4: Reload and re-run the tests**

Reload `http://localhost:8777/tests/test.html` (a hard navigation — `serve.sh` sends
`no-store`, so a normal reload is enough) and re-read `window.__testResults`.

Expected: `window.__testResults.failed === 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "pitch: add parseNoteName, the inverse of noteName, with a window bridge for app.js"
```

---

### Task 2: `fmtPrecise()` / `parseTimeMmSs()` in `app.js`

**Files:**
- Modify: `app.js:186-191` (right after `fmt()`)

No automated test runner covers `app.js` (`tests/test.html` never loads it — see its
`<script>` list). This is implemented directly and exercised in Task 9's manual pass.

- [ ] **Step 1: Add the two functions**

Find (around line 186-191):

```js
function fmt(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
```

Replace with:

```js
function fmt(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Like fmt(), but to the millisecond — fmt()'s whole-second precision is too coarse for a
 *  note boundary, which is meaningful down to the 20ms floor (MIN_DUR). */
function fmtPrecise(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(3).padStart(6, '0');   // "07.340"
  return `${m}:${s}`;
}

/** Inverse of fmtPrecise() — returns null on anything else, including bare seconds with no
 *  ':'. The field always displays and expects m:ss.mmm, so round-tripping that one format is
 *  what matters, not accepting everything a user might type. */
function parseTimeMmSs(str) {
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(str.trim());
  if (!m) return null;
  const mins = +m[1], secs = +m[2];
  if (secs >= 60) return null;
  return mins * 60 + secs;
}
```

- [ ] **Step 2: Sanity-check in the browser console**

With `./scripts/serve.sh` running and `http://localhost:8777/` loaded, open the browser
console and run:

```js
fmtPrecise(7.34)          // "0:07.340"
parseTimeMmSs('0:07.340') // 7.34
parseTimeMmSs('bogus')    // null
parseTimeMmSs('1:75')     // null (75 >= 60, not a valid seconds value)
```

Expected: matches the comments above.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "app: add fmtPrecise/parseTimeMmSs for the note-field time format"
```

---

### Task 3: i18n keys for the field tooltips and Apply button

**Files:**
- Modify: `lib/i18n.js` (zh-TW block around line 166, en block around line 318)

Per `CLAUDE.md`'s i18n gotcha, both locales must gain the same keys in the same commit —
`tests/i18n.test.js`'s "both locales define exactly the same keys" test catches drift if
they don't.

- [ ] **Step 1: Add the zh-TW keys**

Find (around line 165-167, the end of the zh-TW block):

```js
      'notes.importMismatch': '這個檔案看起來是給「{song}」用的，與目前載入的歌曲不同。',
      'notes.show': '顯示音符',
    },
```

Replace with:

```js
      'notes.importMismatch': '這個檔案看起來是給「{song}」用的，與目前載入的歌曲不同。',
      'notes.show': '顯示音符',
      'notes.editFieldStart': '起始時間',
      'notes.editFieldEnd': '結束時間',
      'notes.editFieldPitch': '音高',
      'notes.editFieldApply': '套用',
    },
```

- [ ] **Step 2: Add the matching en keys**

Find (around line 317-320, the end of the en block):

```js
      'notes.importMismatch': 'This file looks like it was made for "{song}", not the song currently loaded.',
      'notes.show': 'Show notes',
    },
  };
```

Replace with:

```js
      'notes.importMismatch': 'This file looks like it was made for "{song}", not the song currently loaded.',
      'notes.show': 'Show notes',
      'notes.editFieldStart': 'Start time',
      'notes.editFieldEnd': 'End time',
      'notes.editFieldPitch': 'Pitch',
      'notes.editFieldApply': 'Apply',
    },
  };
```

- [ ] **Step 3: Verify with the i18n test**

With `./scripts/serve.sh` running, reload `http://localhost:8777/tests/test.html` and read
`window.__testResults`.

Expected: `window.__testResults.failed === 0` (this also re-confirms Tasks 1-2 didn't break
anything).

- [ ] **Step 4: Commit**

```bash
git add lib/i18n.js
git commit -m "i18n: add note-field tooltip and Apply-button strings"
```

---

### Task 4: The `.note-fields` row — state, DOM, wiring, CSS

**Files:**
- Modify: `app.js:48-50` (state), `app.js:655-666` (DOM construction), `app.js:2026` (edit-mode
  listener)
- Modify: `styles.css:510-511` (after `.note-tbtn-armed`)

This task wires the Enter/Escape keydown handlers to `commitFields()` and the Apply button's
click handler to the same — both defined for real in Task 6. That's safe: they're `function`
declarations, hoisted across the whole file regardless of where in the file they're written,
so nothing here throws at *parse* time. Nothing in this task or the next actually presses
Enter/Apply in a browser, so nothing here runs the not-yet-written code either — the first
real exercise of it is Task 9's manual pass, by which point Task 6 is done.

- [ ] **Step 1: Add the `fieldsShownFor` state variable**

Find (around line 47-49):

```js
let editMode = false;       // mirrors the notes.js toggle — see 'sansbass:editmode'
let selectedNote = null;    // { at, midi } — at is a time point inside the note, midi is its
                             // pitch at selection time; both identify one specific note
```

Replace with:

```js
let editMode = false;       // mirrors the notes.js toggle — see 'sansbass:editmode'
let selectedNote = null;    // { at, midi } — at is a time point inside the note, midi is its
                             // pitch at selection time; both identify one specific note
let fieldsShownFor = null;  // { at, midi } of the note last written into the inline fields,
                             // or null — lets syncNoteFields skip a rewrite that would
                             // clobber an in-progress keystroke (see the design spec's
                             // "Refresh vs. typing")
```

- [ ] **Step 2: Build the fields row and extend `zoomToolbar`**

Find (around line 655-666):

```js
    const rangeDel = mkEditBtn(tr('notes.editRangeDelete'), 'notes.editRangeDeleteTip', editRangeDelete);
    rangeDel.classList.add('note-tbtn-danger');

    zToolbar.append(addBtn, octUp, octDown, pitchUp, pitchDown, timeBack, timeFwd, split, del, rangeDel);
    zoomToolbar = { root: zToolbar, add: addBtn, octUp, octDown, pitchUp, pitchDown, timeBack, timeFwd,
                     split, del, rangeDel };

    zLane.append(zName, zCanvas, zRangeHint, zToolbar, zSpacer, zGrip);
    el.lanes.insertBefore(zLane, lane);
    attachZoom(zCanvas);
    zoomEl = { lane: zLane, canvas: zCanvas, out: zOut };
    zLane.hidden = true;
  }
```

Replace with:

```js
    const rangeDel = mkEditBtn(tr('notes.editRangeDelete'), 'notes.editRangeDeleteTip', editRangeDelete);
    rangeDel.classList.add('note-tbtn-danger');

    zToolbar.append(addBtn, octUp, octDown, pitchUp, pitchDown, timeBack, timeFwd, split, del, rangeDel);

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

- [ ] **Step 3: Hide the fields row along with the toolbar when edit mode toggles off**

Find (around line 2026, inside the `'sansbass:editmode'` listener):

```js
  if (zoomToolbar) zoomToolbar.root.hidden = !editMode;
```

Replace with:

```js
  if (zoomToolbar) { zoomToolbar.root.hidden = !editMode; zoomToolbar.fields.hidden = !editMode; }
```

- [ ] **Step 4: CSS for the row and its inputs**

In `styles.css`, find (around line 507-510):

```css
.note-tbtn { font: 11px var(--mono); }
.note-tbtn:disabled { opacity: .4; cursor: default; }
.note-tbtn-danger { border-color: color-mix(in srgb, #ff6b81 45%, var(--line)); color: #ff9aa8; }
.note-tbtn-armed { border-color: var(--loop); color: var(--loop); }
```

Replace with:

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

- [ ] **Step 5: Commit**

```bash
git add app.js styles.css
git commit -m "app: build the inline Start/End/Pitch fields row next to the note toolbar"
```

---

### Task 5: `syncNoteFields()` and the `syncEditToolbar()` wiring

**Files:**
- Modify: `app.js:1153-1163` (`syncEditToolbar`)

- [ ] **Step 1: Extend the disable loop and call the new sync function**

Find (around line 1153-1163):

```js
function syncEditToolbar() {
  if (!zoomToolbar) return;
  const sel = ribbon && selectedNote ? noteAt(ribbon.notes, selectedNote.at, selectedNote.midi) : null;
  if (selectedNote && !sel) selectedNote = null;
  for (const b of [zoomToolbar.octUp, zoomToolbar.octDown, zoomToolbar.pitchUp,
                    zoomToolbar.pitchDown, zoomToolbar.timeBack, zoomToolbar.timeFwd,
                    zoomToolbar.split, zoomToolbar.del]) {
    b.disabled = !sel;
  }
  zoomToolbar.rangeDel.disabled = !rangeSelection;
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
                    zoomToolbar.fieldEnd, zoomToolbar.fieldPitch, zoomToolbar.applyBtn]) {
    b.disabled = !sel;
  }
  zoomToolbar.rangeDel.disabled = !rangeSelection;
  syncNoteFields(sel);
}

/** Keeps the three inline fields in step with the selected note without clobbering an
 *  in-progress keystroke. A rewrite only happens when the selection's identity ({at, midi})
 *  differs from fieldsShownFor — the same note staying selected is a no-op here, which is
 *  what actually protects a mid-type value from draw()'s per-frame calls (a focus check
 *  would be redundant: the no-op already never touches .value). A genuinely different note —
 *  including a forced refresh via fieldsShownFor = null, as commitFields does right after a
 *  commit — always rewrites, even if a field still has focus at that exact moment; that's
 *  what makes a reverted/updated value visibly snap back right after Enter. See
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
  if (fieldsShownFor && fieldsShownFor.at === key.at && fieldsShownFor.midi === key.midi) return;
  zoomToolbar.fieldStart.value = fmtPrecise(sel.start);
  zoomToolbar.fieldEnd.value = fmtPrecise(sel.end);
  zoomToolbar.fieldPitch.value = sel.name;
  fieldsShownFor = key;
}
```

Note `sel.name`, not a `noteName()` call — every note object already carries its own display
name (`segmentNotes`/`applyEdits` in `lib/pitch.js` set it), which is how the rest of `app.js`
already shows pitch text (see the 簡珑/jianpu label code) without needing to reach `noteName`
itself. Only `parseNoteName` (the direction `app.js` can't already do some other way) needed
the Task 1 bridge.

- [ ] **Step 2: Commit**

```bash
git add app.js
git commit -m "app: sync the inline fields from the selection without clobbering mid-type input"
```

---

### Task 6: `commitFields()`

**Files:**
- Modify: `app.js:1863-1874` (right after `editTimeNudge`, before `editDeleteNote`)

- [ ] **Step 1: Add the function**

Find (around line 1863-1876):

```js
function editTimeNudge(dir) {
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
  if (!n) return;
  const d = TIME_NUDGE_STEP * dir;
  const at = selectedNote.at;
  const midi = selectedNote.midi;
  selectedNote = { at: at + d, midi };
  dispatchEdit([{ type: 'timeAdjust', at, dStart: d, dEnd: d, midi }]);
}

function editDeleteNote() {
```

Replace with:

```js
function editTimeNudge(dir) {
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
  if (!n) return;
  const d = TIME_NUDGE_STEP * dir;
  const at = selectedNote.at;
  const midi = selectedNote.midi;
  selectedNote = { at: at + d, midi };
  dispatchEdit([{ type: 'timeAdjust', at, dStart: d, dEnd: d, midi }]);
}

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

  const newMidi = window.SansPitch.parseNoteName(zoomToolbar.fieldPitch.value);

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

function editDeleteNote() {
```

This is the spec's "Commit" code verbatim, with one necessary change: `parseNoteName(...)`
becomes `window.SansPitch.parseNoteName(...)`, since `app.js` reaches it through the Task 1
bridge rather than an `import`. Two edits (a `timeAdjust` and a `pitchNudge`) can be
dispatched from one Apply/Enter — they land as one `dispatchEdit(edits)` call, the same
one-array-two-edits pattern `editSplit()` already uses a few dozen lines below this.

- [ ] **Step 2: Commit**

```bash
git add app.js
git commit -m "app: commitFields dispatches timeAdjust/pitchNudge from the inline fields"
```

---

### Task 7: Bump the asset cache-buster version

**Files:**
- Modify: `index.html` (15 occurrences), `separate.js` (3), `separate.worker.js` (1),
  `notes.js` (3), `notes.worker.js` (1) — 23 in all
- Modify: `CLAUDE.md` (the version note at the end of the gotcha list)

Per `CLAUDE.md`'s versioned-asset-URL gotcha: every local `?v=` must agree, or a returning
visitor can run a stale `app.js` against a fresh `index.html` for up to ten minutes after
deploy. `app.js`, `lib/pitch.js` and `lib/i18n.js` all changed in this plan, so the version
must move. Current is `1.16.2`; this is another follow-up session on the note-editing feature
(the spec calls itself "second of three follow-up batches"), so it becomes `1.16.3` per the
project's versioning convention.

- [ ] **Step 1: Bump all five files**

```bash
cd /Users/sansword/Source/github/sans_bass
sed -i '' 's/?v=1\.16\.2/?v=1.16.3/g' index.html separate.js separate.worker.js notes.js notes.worker.js
```

- [ ] **Step 2: Verify every versioned URL still agrees, and none were missed**

```bash
grep -c '1\.16\.3' index.html separate.js separate.worker.js notes.js notes.worker.js
```

Expected counts: `index.html:15`, `separate.js:3`, `separate.worker.js:1`, `notes.js:3`,
`notes.worker.js:1` — 23 total. Also confirm no `1.16.2` remains in these five files:

```bash
grep -rn '1\.16\.2' index.html separate.js separate.worker.js notes.js notes.worker.js
```

Expected: no output.

- [ ] **Step 3: Update the version note in `CLAUDE.md`**

Find (in `CLAUDE.md`, near the end of the versioned-asset-URL gotcha):

```
  `tests/versions.test.js` fails if they drift — and it
  covers `.png` and `.svg` as well as `.js`/`.css`, so the icons are included. Currently
  `v1.16.2`.
```

Replace with:

```
  `tests/versions.test.js` fails if they drift — and it
  covers `.png` and `.svg` as well as `.js`/`.css`, so the icons are included. Currently
  `v1.16.3`.
```

- [ ] **Step 4: Run `tests/versions.test.js` (and the full suite) to confirm agreement**

With `./scripts/serve.sh` still running, reload `http://localhost:8777/tests/test.html` and
read `window.__testResults`.

Expected: `window.__testResults.failed === 0` (re-confirms every earlier task's tests too —
the whole suite runs together).

- [ ] **Step 5: Commit**

```bash
git add index.html separate.js separate.worker.js notes.js notes.worker.js CLAUDE.md
git commit -m "chore: bump asset version to 1.16.3"
```

---

### Task 8: Update `docs/behaviour.md`

**Files:**
- Modify: `docs/behaviour.md` (the "Note editing" section header, and six new rows after E26)

- [ ] **Step 1: Note the new spec in the section header**

Find (around line 272-278):

```
## Note editing

`applyEdits()` (`lib/pitch.js`) runs after `interpret()`/`foldOctaves()` inside
`notes.js`'s `reinterpret()`. `app.js` owns the zoomed pane's selection, toolbar, and
pointer/keyboard interactions, and talks to `notes.js` through `sansbass:noteedit` /
`sansbass:editundo` / `sansbass:editmode` — the design is in
[`docs/superpowers/specs/2026-08-31-note-editing-design.md`](superpowers/specs/2026-08-31-note-editing-design.md).
```

Replace with:

```
## Note editing

`applyEdits()` (`lib/pitch.js`) runs after `interpret()`/`foldOctaves()` inside
`notes.js`'s `reinterpret()`. `app.js` owns the zoomed pane's selection, toolbar, and
pointer/keyboard interactions, and talks to `notes.js` through `sansbass:noteedit` /
`sansbass:editundo` / `sansbass:editmode` — the design is in
[`docs/superpowers/specs/2026-08-31-note-editing-design.md`](superpowers/specs/2026-08-31-note-editing-design.md).
The inline Start/End/Pitch fields beside the toolbar (rows E27-E32) are a later addition — see
[`docs/superpowers/specs/2026-09-01-note-inline-fields-design.md`](superpowers/specs/2026-09-01-note-inline-fields-design.md).
```

- [ ] **Step 2: Add six new rows after E26**

Find (around line 295, the end of the E26 row):

```
| E26 | The edit list (`#notes-edits`) is a collapsible `<details>`, collapsed by default even with edits present, so a long editing session doesn't keep pushing the zoomed pane down the page. Its summary names the count. Making a new edit or removing one never re-collapses a panel the user opened. When open, the row of controls floats over the page (`position: absolute`) rather than displacing anything below it, and a pointerdown anywhere outside `#notes-edits` closes it again — clicking the summary itself, or a row's own ✕/↺ button, does not count as "outside". | Make an edit: `#notes-edits` becomes visible but `.open` is `false`; summary reads "Edit history (1)". Click the summary to open it, make a second edit: still open, summary now reads "(2)"; the zoomed pane's position on screen hasn't moved. Click anywhere else on the page: `.open` becomes `false` again. Click a row's ✕ instead: the row is removed and the panel stays open. |
```

Replace with:

```
| E26 | The edit list (`#notes-edits`) is a collapsible `<details>`, collapsed by default even with edits present, so a long editing session doesn't keep pushing the zoomed pane down the page. Its summary names the count. Making a new edit or removing one never re-collapses a panel the user opened. When open, the row of controls floats over the page (`position: absolute`) rather than displacing anything below it, and a pointerdown anywhere outside `#notes-edits` closes it again — clicking the summary itself, or a row's own ✕/↺ button, does not count as "outside". | Make an edit: `#notes-edits` becomes visible but `.open` is `false`; summary reads "Edit history (1)". Click the summary to open it, make a second edit: still open, summary now reads "(2)"; the zoomed pane's position on screen hasn't moved. Click anywhere else on the page: `.open` becomes `false` again. Click a row's ✕ instead: the row is removed and the panel stays open. |
| E27 | Selecting a note populates Start (`m:ss.mmm`), End (`m:ss.mmm`) and Pitch (e.g. `D4`) with its current values, and enables all three plus Apply; deselecting blanks and disables them again, same as the toolbar buttons. | Tick Edit notes, select a note: the three fields fill in and become enabled. Click empty space to deselect: fields go blank and `disabled` again, Apply included. |
| E28 | Changing a field and pressing Enter (in any of the three), or changing any subset and clicking Apply, dispatches exactly the edits needed: one `timeAdjust` if Start and/or End changed, one `pitchNudge` if Pitch changed, and nothing for a field whose parsed value equals the note's current value. | Change only Pitch and press Enter: the edit list gains one `pitchNudge` row, no `timeAdjust`. Change Start and End together and click Apply: the edit list gains exactly one new `timeAdjust` row, not two. Re-commit without changing anything: no new row appears. |
| E29 | An unparseable value in any field (bad time format, unrecognised or flat-spelled note name), or a Start/End pair that would violate the 20ms floor or go negative, reverts that field to the note's current value and dispatches nothing for it — without blocking a valid edit in the other field(s). | Type "bogus" into Pitch, valid values into Start/End, press Enter: Pitch snaps back to its prior value, a `timeAdjust` row still appears. Type a Start past End (crossing the 20ms floor) alongside a valid Pitch change: both time fields snap back and no `timeAdjust` appears, but the pitch edit still lands. |
| E30 | Pressing Escape while any field has focus reverts all three fields to the note's current values without committing anything. | Type a new value into any field, press Escape: the field's value reverts, no new row appears in the edit list. |
| E31 | While a field has focus, no redraw or selection-sync tick overwrites what's being typed — including during playback, when `draw()` runs every animation frame. | Select a note, start typing a new Start value, let the song play for a few seconds without pressing Enter: the field keeps showing exactly what was typed, not the note's live value. |
| E32 | Changing both Start and End together and committing produces exactly one `timeAdjust` edit-list row, not two — mirroring how a two-edge drag is already one edit. | Change both time fields to values different from what's shown, click Apply: exactly one new row appears in the edit list. |
```

- [ ] **Step 3: Commit**

```bash
git add docs/behaviour.md
git commit -m "docs: behaviour rows for the inline note-detail fields (E27-E32)"
```

---

### Task 9: Manual browser verification

**Files:** none (verification only)

`app.js`'s DOM/interaction code has no automated test runner — per the spec's Testing
section and `docs/behaviour.md`'s existing convention for the rest of the note editor, this
is verified by hand, in a real browser, observing the actual outcome rather than an
intermediate parameter.

- [ ] **Step 1: Serve and load a song with a vocals stem**

With `./scripts/serve.sh` running, open `http://localhost:8777/` and load any local song/zip
that has a `vocals` stem. Click **Find notes**, then tick **Edit notes**.

- [ ] **Step 2: E27 — populate on selection, blank on deselection**

Select a note.

Expected: Start/End show `m:ss.mmm`, Pitch shows something like `D4`, and all three fields
plus Apply are enabled. Click empty space to deselect.

Expected: all three fields go blank and disabled again, same as the toolbar buttons.

- [ ] **Step 3: E28/E32 — Enter and Apply commit the right edits**

Select a note. Change only the Pitch field (type a different note name) and press Enter.

Expected: the edit list (open it via the summary) gains exactly one new `pitchNudge`-style
row; the note's pitch visibly changed and recoloured purple.

Select a note again. Change both Start and End to different values and click Apply.

Expected: exactly **one** new row appears (a single `timeAdjust`), not two.

- [ ] **Step 4: E29 — invalid input reverts one field without blocking the other**

Select a note. Type `bogus` into Pitch, a valid new value into Start, and press Enter.

Expected: Pitch snaps back to the note's actual pitch; Start's new value took effect (one
`timeAdjust` row appended). Then select a note again, set Start to a value past End so the
pair would violate the 20ms floor, leave Pitch changed to something valid, and commit.

Expected: both Start and End snap back to the note's actual values, no `timeAdjust` row
appears, but the pitch edit still lands.

- [ ] **Step 5: E30 — Escape reverts everything, uncommitted**

Select a note. Type new values into two of the three fields (don't press Enter or click
Apply). Press Escape while one of them has focus.

Expected: all three fields revert to the note's current values; no new edit-list row appears.

- [ ] **Step 6: E31 — typing survives playback redraws**

Select a note. Click into the Start field and type a partial new value (don't commit). Press
play and let it run for a few seconds.

Expected: the Start field keeps showing exactly what was typed the whole time — it never
flickers back to the note's stored value while playback is running.

- [ ] **Step 7: Field state matches the rest of the toolbar**

With edit mode ticked and nothing selected, confirm the fields row is visible (not `hidden`)
but every field and Apply are `disabled`. Untick **Edit notes** entirely.

Expected: the whole `.note-fields` row disappears along with `.note-toolbar`.

- [ ] **Step 8: Update `docs/behaviour.md`'s "last exercised" line**

Find, near the top of `docs/behaviour.md`:

```
Last exercised end-to-end: **v1.2.2**; the Loading and Loading-the-page-itself rows were re-run in **v1.4.0**, and the Loading / Lanes / Unmute-all / Play-dropdown rows touched by v1.6.0 were re-run in **v1.6.0**. E19, E24 and E25 were re-run in **v1.16.2**. Items marked ⚠ were reasoned from the code rather
than run in that session, so treat them as the least trustworthy rows here.
```

Append a clause noting E27-E32 were run in this version:

```
Last exercised end-to-end: **v1.2.2**; the Loading and Loading-the-page-itself rows were re-run in **v1.4.0**, and the Loading / Lanes / Unmute-all / Play-dropdown rows touched by v1.6.0 were re-run in **v1.6.0**. E19, E24 and E25 were re-run in **v1.16.2**. E27-E32 were run in **v1.16.3**. Items marked ⚠ were reasoned from the code rather
than run in that session, so treat them as the least trustworthy rows here.
```

- [ ] **Step 9: Commit**

```bash
git add docs/behaviour.md
git commit -m "docs: record E27-E32 manual verification for v1.16.3"
```

If any expected outcome in Steps 2-7 did not hold, stop here and fix the relevant task above
before continuing — do not proceed to the devlog with a known-broken behaviour.

---

### Task 10: Devlog entry

**Files:**
- Modify: `docs/devlog.md`

- [ ] **Step 1: Get the timestamp for the heading**

```bash
git log -1 --format=%cd --date=format:'%Y-%m-%d %H:%M'
```

Use this timestamp (from the most recent commit made in this session) in the heading below.

- [ ] **Step 2: Add the TL;DR row**

Find, in `docs/devlog.md`'s TL;DR table (right after the `| Version | Summary |` header row):

```
| [v1.16.2](#v1162--note-selection-identity-2026-09-01-0209) | Overlapping notes are disambiguated by pitch, not just time: `selectedNote` now carries `midi`, `noteAt` and `applyEdits` both accept an optional pitch qualifier, and the selection outline and every toolbar/keyboard edit resolve to the exact note under the pointer instead of an arbitrary same-time match. Old exported edit-history files (no `midi` field) still apply exactly as before. |
```

Insert a new row immediately above it (newest-first):

```
| [v1.16.3](#v1163--inline-note-detail-fields-2026-09-01-hhmm) | Three inline fields — Start, End, Pitch — beside the note editor's toolbar, directly editable and committing via Enter or Apply through the existing `timeAdjust`/`pitchNudge` edit types. Invalid input reverts silently without blocking a valid sibling edit, Escape reverts everything uncommitted, and typing is never clobbered by a redraw. `lib/pitch.js` gains `parseNoteName()`, the inverse of `noteName()`, bridged to `app.js` via a new `window.SansPitch`. |
| [v1.16.2](#v1162--note-selection-identity-2026-09-01-0209) | Overlapping notes are disambiguated by pitch, not just time: `selectedNote` now carries `midi`, `noteAt` and `applyEdits` both accept an optional pitch qualifier, and the selection outline and every toolbar/keyboard edit resolve to the exact note under the pointer instead of an arbitrary same-time match. Old exported edit-history files (no `midi` field) still apply exactly as before. |
```

Replace `hhmm` in the anchor with the actual `HH-MM` from Step 1 minus the colon (e.g.
`14:37` → `1437`), matching the anchor format GitHub generates for the heading in Step 3.

- [ ] **Step 3: Add the entry**

Find, in `docs/devlog.md`, the start of the v1.16.2 entry:

```
## v1.16.2 — Note selection identity (2026-09-01 02:09)
```

Insert a new entry immediately above it:

```
## v1.16.3 — Inline note-detail fields (YYYY-MM-DD HH:MM)

**Review:** not yet

**Design docs:**
- Inline note-detail fields: [Spec](superpowers/specs/2026-09-01-note-inline-fields-design.md) [Plan](superpowers/plans/2026-09-01-note-inline-fields.md)

**What was built:**

- Three inline fields — Start, End, Pitch — beside the note editor's toolbar, populated from
  the selected note and directly editable; Enter (in any field) or a shared Apply button
  commits.
- `parseNoteName()` in `lib/pitch.js`, the exact inverse of `noteName()` — sharps only,
  rejects flats and garbage — round-trips every value `noteName()` can produce.
- A combined Start+End change commits as one `timeAdjust`, matching a two-edge drag; a Pitch
  change commits as one `pitchNudge`; both can land from a single Apply/Enter as two edits in
  one `dispatchEdit` call, the same pattern `editSplit()` already used.
- Invalid input in either the time pair or the pitch field reverts silently (no edit
  dispatched for that field) without blocking a valid edit sitting right next to it; Escape
  reverts all three without committing.
- A `fieldsShownFor` identity guard stops the per-frame `draw()` → `syncEditToolbar()` tick
  from overwriting an in-progress keystroke, while still refreshing immediately on a
  genuinely new selection or a forced post-commit refresh.

**Key technical learnings:**

- `[gotcha]` **A classic script can't `import` an ES module, and a design spec's pseudocode
  can assume it can anyway.** `app.js` is intentionally a classic script (`CLAUDE.md`'s hard
  constraints), but `lib/pitch.js` is ESM-only, imported until now only by
  `notes.js`/`notes.worker.js`/`sonify.js`. `commitFields()`'s call to `parseNoteName()`
  needed a bridge — `window.SansPitch`, set by `lib/pitch.js` itself at module load — the
  same shape as the existing `window.sansBass` bridge, just running app.js → notes.js's
  direction in reverse. Caught by tracing the DOM/module boundary before writing any code,
  since there's no test that would have caught it after the fact.
- `[insight]` **"Only rewrite when different" already implies the focus guard a design can
  describe as a separate check.** The design spec describes two conditions for the fields'
  refresh guard — rewrite only on a different note, and never while a field has focus — as if
  both need testing in code. In practice the identity check alone is sufficient: the
  same-note case never attempts a rewrite at all, so there's nothing left for a focus check
  to additionally block; and the different-note case (including the forced refresh via
  `fieldsShownFor = null` right after a commit) is specifically meant to overwrite a field
  the user just pressed Enter in, even though it's still focused at that exact moment. One
  check, not two.
- `[note]` The Pitch field reads `sel.name` — already computed by `segmentNotes`/`applyEdits`
  and stored on every note object — rather than calling `noteName()` from `app.js`. That
  meant `app.js` never needed to reach `noteName()` at all, only its inverse; only
  `parseNoteName` needed the `window.SansPitch` bridge.

---

```

Leave everything below the `---` (the existing v1.16.2 entry and onward) untouched.

- [ ] **Step 4: Commit**

```bash
git add docs/devlog.md
git commit -m "docs: v1.16.3 devlog entry"
```

---

## Self-review checklist (for whoever executes this plan)

- [ ] Every design-doc section has a corresponding task: DOM/lifecycle (Task 4), refresh vs.
      typing (Task 5), formats (Tasks 1-2), commit (Task 6), Escape (Task 4's `mkFieldInput`).
- [ ] `applyEdits()` and the edit types themselves are confirmed untouched — this plan only
      ever calls `dispatchEdit()` with existing `timeAdjust`/`pitchNudge` edit objects
      (Task 6), exactly like the spec's non-goals require.
- [ ] The `window.SansPitch` bridge is the one piece of plumbing the spec didn't describe;
      confirmed necessary by checking that `app.js` has no `import` statement anywhere in the
      file and `lib/pitch.js` has no prior `window` touch.
- [ ] Asset version bumped everywhere it's mirrored: `index.html`, `separate.js`,
      `separate.worker.js`, `notes.js`, `notes.worker.js`, and the note in `CLAUDE.md`
      (Task 7).
- [ ] `docs/behaviour.md` gained rows for every item in the spec's Testing section: populate
      (E27), commit (E28), invalid revert (E29), Escape (E30), no-clobber (E31), one combined
      edit (E32).
