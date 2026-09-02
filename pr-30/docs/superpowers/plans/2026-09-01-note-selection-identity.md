# Note selection identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `selectedNote` carry pitch as well as time, so hit-testing, the selection
outline, and every toolbar/keyboard edit resolve to the exact note under the pointer —
never a different note that merely shares the same time point.

**Architecture:** `selectedNote` grows a `midi` field alongside its existing `at`. `noteAt`
gains an optional third `midi` parameter that narrows a time match to an exact pitch match
(falling back to time-only when omitted, and to "last match wins" when more than one note
still ties). `lib/pitch.js`'s `applyEdits` gains the same optional qualifier on its edit
objects, purely additive so old exported edit-history JSON keeps applying unchanged.

**Tech Stack:** Vanilla JS, no build step. `app.js` (classic script) for UI/hit-testing,
`lib/pitch.js` (ESM) for the edit-application pure function, browser-page test harness
(`tests/test.html` / `tests/pitch.test.js`) for the one part that's automatable.

**Spec:** [`docs/superpowers/specs/2026-09-01-note-selection-identity-design.md`](../specs/2026-09-01-note-selection-identity-design.md)

---

## Before you start

Read [`CLAUDE.md`](../../../CLAUDE.md)'s "Gotchas that will bite again" section once,
especially the asset-version-cache-buster gotcha (Task 7 below) and the `AudioContext`/real-
keypress gotcha (irrelevant here, but the pattern of "verify by observing the real thing"
matters for Task 9). Every task below assumes you're in a fresh implementation branch off
`main` — the design branch (`docs/note-selection-identity-design`) is design-only and does
not get this code.

### Task 0: Branch

- [ ] **Step 1: Confirm a clean tree and branch off `main`**

```bash
git status
git checkout main
git pull
git checkout -b fix/note-selection-identity
```

Expected: `git status` shows nothing to commit before switching (the two untracked media
files noted in this session's context are pre-existing clutter in the working tree, not
yours — leave them alone; they won't be touched by any step below). The new branch is based
on `main`, not on the design branch.

---

### Task 1: `applyEdits` accepts an optional `midi` qualifier

**Files:**
- Modify: `lib/pitch.js:912` (inside `applyEdits`)
- Test: `tests/pitch.test.js`

This is the one piece of this change with a real test runner, so it's done test-first and
first — everything in `app.js` later just has to call it correctly.

- [ ] **Step 1: Write the failing tests**

Open `tests/pitch.test.js`. Find this existing test (around line 870-878):

```js
test("pitch: applyEdits anchor lookup is half-open — a note's own end excludes it", () => {
  const notes = notesAt([50, 52]);    // [0, 0.5] and [0.5, 1]
  const atBoundary = applyEdits(notes, [{ type: 'delete', at: 0.5 }]);
  assertEq(atBoundary.notes.length, 1, 'the boundary belongs to the SECOND note, not the first');
  assertEq(atBoundary.notes[0].midi, 50, 'so the first note is the one left standing');
  const atStart = applyEdits(notes, [{ type: 'delete', at: 0 }]);
  assertEq(atStart.notes.length, 1, "a note's own start IS included");
  assertEq(atStart.notes[0].midi, 52);
});

test('pitch: applyEdits does not mutate the notes or edits it was given', () => {
```

Insert three new tests between them, so the file reads:

```js
test("pitch: applyEdits anchor lookup is half-open — a note's own end excludes it", () => {
  const notes = notesAt([50, 52]);    // [0, 0.5] and [0.5, 1]
  const atBoundary = applyEdits(notes, [{ type: 'delete', at: 0.5 }]);
  assertEq(atBoundary.notes.length, 1, 'the boundary belongs to the SECOND note, not the first');
  assertEq(atBoundary.notes[0].midi, 50, 'so the first note is the one left standing');
  const atStart = applyEdits(notes, [{ type: 'delete', at: 0 }]);
  assertEq(atStart.notes.length, 1, "a note's own start IS included");
  assertEq(atStart.notes[0].midi, 52);
});

test('pitch: applyEdits with midi resolves to the pitch-matching note despite an earlier time-overlapping match', () => {
  const notes = [
    { start: 0, end: 1, midi: 50, cents: 5000, name: noteName(50), confidence: 0.9 },
    { start: 0, end: 1, midi: 62, cents: 6200, name: noteName(62), confidence: 0.9 },
  ];
  const out = applyEdits(notes, [{ type: 'octave', at: 0.5, dir: 1, midi: 62 }]).notes;
  assertEq(out[0].midi, 50, 'the first note (different pitch) is untouched');
  assertEq(out[1].midi, 74, 'the pitch-qualified edit hit the second note, not the first');
});

test('pitch: applyEdits without midi keeps first-match behaviour, unaffected by an overlapping note at another pitch', () => {
  const notes = [
    { start: 0, end: 1, midi: 50, cents: 5000, name: noteName(50), confidence: 0.9 },
    { start: 0, end: 1, midi: 62, cents: 6200, name: noteName(62), confidence: 0.9 },
  ];
  const out = applyEdits(notes, [{ type: 'octave', at: 0.5, dir: 1 }]).notes;
  assertEq(out[0].midi, 62, 'first match wins, exactly as before midi qualifiers existed — this is what keeps an old exported edit file applying unchanged');
  assertEq(out[1].midi, 62, 'the second note is untouched');
});

test('pitch: applyEdits with midi still resolves an exact duplicate to the topmost (last) match', () => {
  const notes = [
    { start: 0, end: 1, midi: 50, cents: 5000, name: noteName(50), confidence: 0.11 },  // bottom
    { start: 0, end: 1, midi: 50, cents: 5000, name: noteName(50), confidence: 0.99 },  // topmost
  ];
  const out = applyEdits(notes, [{ type: 'delete', at: 0.5, midi: 50 }]).notes;
  assertEq(out.length, 1, 'exactly one of the duplicates is removed');
  assertClose(out[0].confidence, 0.11, 1e-6, 'the topmost (last) duplicate was deleted, the bottom one survives');
});

test('pitch: applyEdits does not mutate the notes or edits it was given', () => {
```

- [ ] **Step 2: Start the local server and run the tests to see them fail**

```bash
./scripts/serve.sh &
```

Wait for `==> http://localhost:8777` to print, then load `http://localhost:8777/tests/test.html`
in a browser (or via the `claude-in-chrome` tools — `tabs_create_mcp` then `navigate`) and
read `window.__testResults`.

Expected: `window.__testResults.failed >= 1`, with failures on the two new `applyEdits with
midi` tests (the third, "without midi", should already pass — it's asserting today's
behavior). If the "without midi" test also fails, something about the harness or the
existing note shapes is wrong; stop and investigate before continuing.

- [ ] **Step 3: Implement the `midi` qualifier in `applyEdits`**

In `lib/pitch.js`, find (around line 912):

```js
    const idx = list.findIndex((n) => n.start <= e.at && e.at < n.end);
```

Replace with:

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

- [ ] **Step 4: Reload and re-run the tests**

Reload `http://localhost:8777/tests/test.html` (a hard navigation, not a soft reload —
`serve.sh` sends `no-store` so a real reload is enough) and re-read
`window.__testResults`.

Expected: `window.__testResults.failed === 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "pitch: applyEdits accepts an optional midi qualifier on the anchor lookup"
```

---

### Task 2: `selectedNote` shape and `noteAt` become pitch-aware (foundational)

**Files:**
- Modify: `app.js:48`, `app.js:1813-1828`

No call sites are touched yet — this task only changes the two declarations everything else
in this plan depends on. `noteAt`'s existing two-argument call sites keep working exactly as
before (the new third parameter is optional), so the app is not broken between this task and
the next ones.

- [ ] **Step 1: Update the `selectedNote` declaration comment**

Find (line 48):

```js
let selectedNote = null;    // { at } — a time point inside the selected note, or null
```

Replace with:

```js
let selectedNote = null;    // { at, midi } — at is a time point inside the note, midi is its
                             // pitch at selection time; both identify one specific note
```

- [ ] **Step 2: Give `noteAt` an optional `midi` parameter**

Find (around line 1813):

```js
/** The note in `list` whose span contains `at`, or null. Half-open — a note's END excludes
 *  it, matching lib/pitch.js's applyEdits, so a click at a shared boundary picks the note
 *  that starts there rather than the one that just finished.
 *
 *  Searches from the END of the list, not the start. `renderZoom`/`renderRibbon` draw notes
 *  in array order, so with two notes overlapping at a time point, the one drawn LAST is
 *  visually on top — this makes it the one a click resolves to as well. `add` already pushes
 *  new notes to the end, so a manually placed note dropped onto an existing one is both drawn
 *  on top and the one selected, with no special-casing needed here. */
function noteAt(list, at) {
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    if (n.start <= at && at < n.end) return n;
  }
  return null;
}
```

Replace with:

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

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "app: selectedNote and noteAt grow an optional midi identity"
```

---

### Task 3: Wire `midi` through `attachZoom`'s pointer handlers

**Files:**
- Modify: `app.js` inside `attachZoom` (around lines 1687-1804)

This is the drag-select, click-select, add-note-commit, and drag-commit logic, all inside
one `attachZoom(canvas)` function. Four separate small edits within it.

- [ ] **Step 1: Pass `selectedNote.midi` into the drag-hit-test lookup**

Find (around line 1703):

```js
      const t = zoomTimeAt(canvas, e.clientX);
      const sel = selectedNote ? noteAt(ribbon.notes, selectedNote.at) : null;
```

Replace with:

```js
      const t = zoomTimeAt(canvas, e.clientX);
      const sel = selectedNote ? noteAt(ribbon.notes, selectedNote.at, selectedNote.midi) : null;
```

- [ ] **Step 2: Make the fresh click-to-select resolve by pitch too**

Find (around line 1717-1719):

```js
      const hit = noteAt(ribbon.notes, t);
      if (hit) {
        selectedNote = { at: (hit.start + hit.end) / 2 };
```

Replace with:

```js
      const hit = noteAt(ribbon.notes, t, addMidiAt(canvas, e.clientY));
      if (hit) {
        selectedNote = { at: (hit.start + hit.end) / 2, midi: hit.midi };
```

This reuses `addMidiAt` (defined later in the file, around line 1937 — function
declarations are hoisted so the forward reference is fine) — the same Y→pitch rounding
`+ Add note` placement already uses, so a click resolves to a note via the same rule as
placing one.

- [ ] **Step 3: Carry `midi` on the add-note-drag commit**

Find (around line 1762-1767):

```js
      const midi = addDrag.midi;
      addDrag = null;
      addArmed = false;
      syncAddButton();
      dispatchEdit([{ type: 'add', start: +start.toFixed(4), end: +finalEnd.toFixed(4), midi }]);
      selectedNote = { at: (start + finalEnd) / 2 };
```

Replace with:

```js
      const midi = addDrag.midi;
      addDrag = null;
      addArmed = false;
      syncAddButton();
      dispatchEdit([{ type: 'add', start: +start.toFixed(4), end: +finalEnd.toFixed(4), midi }]);
      selectedNote = { at: (start + finalEnd) / 2, midi };
```

- [ ] **Step 4: Carry `midi` on the note-drag (move/resize) commit**

Find (around line 1786-1792):

```js
      const { note, previewStart, previewEnd } = noteDrag;
      const dStart = previewStart - note.start;
      const dEnd = previewEnd - note.end;
      noteDrag = null;
      if (dStart !== 0 || dEnd !== 0) {
        dispatchEdit([{ type: 'timeAdjust', at: (note.start + note.end) / 2, dStart, dEnd }]);
        selectedNote = { at: (previewStart + previewEnd) / 2 };
      }
```

Replace with:

```js
      const { note, previewStart, previewEnd } = noteDrag;
      const dStart = previewStart - note.start;
      const dEnd = previewEnd - note.end;
      noteDrag = null;
      if (dStart !== 0 || dEnd !== 0) {
        dispatchEdit([{ type: 'timeAdjust', at: (note.start + note.end) / 2, dStart, dEnd, midi: note.midi }]);
        selectedNote = { at: (previewStart + previewEnd) / 2, midi: note.midi };
      }
```

A time-drag never changes pitch, so `note.midi` (the pre-drag note) is correct both for the
dispatch qualifier and the new selection.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "app: attachZoom's pointer handlers carry midi through selection and drag-commit"
```

---

### Task 4: `syncEditToolbar` resolves the selection by pitch too

**Files:**
- Modify: `app.js:1153`

- [ ] **Step 1: Pass `selectedNote.midi` into the toolbar's own lookup**

Find (around line 1151-1154):

```js
function syncEditToolbar() {
  if (!zoomToolbar) return;
  const sel = ribbon && selectedNote ? noteAt(ribbon.notes, selectedNote.at) : null;
  if (selectedNote && !sel) selectedNote = null;
```

Replace with:

```js
function syncEditToolbar() {
  if (!zoomToolbar) return;
  const sel = ribbon && selectedNote ? noteAt(ribbon.notes, selectedNote.at, selectedNote.midi) : null;
  if (selectedNote && !sel) selectedNote = null;
```

Without this, `syncEditToolbar` (called every `draw()`) would re-derive `sel` by time only,
silently overriding the pitch-aware resolution Task 3 just added at click time.

- [ ] **Step 2: Commit**

```bash
git add app.js
git commit -m "app: syncEditToolbar resolves the selected note by pitch too"
```

---

### Task 5: The selection outline matches on pitch

**Files:**
- Modify: `app.js:1093-1098` (inside `renderZoom`)

- [ ] **Step 1: Add the pitch check to the outline condition**

Find (around line 1093-1098):

```js
    /* The selected note gets a white outline in addition to its fill — "outline plus fill"
     * is the same language buttons and inputs use for focus elsewhere in this app. */
    if (editMode && selectedNote && live.start <= selectedNote.at && selectedNote.at < live.end) {
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1.5;
```

Replace with:

```js
    /* The selected note gets a white outline in addition to its fill — "outline plus fill"
     * is the same language buttons and inputs use for focus elsewhere in this app. */
    if (editMode && selectedNote && n.midi === selectedNote.midi &&
        live.start <= selectedNote.at && selectedNote.at < live.end) {
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1.5;
```

`n.midi`, not `live.midi` — `live` only overrides `start`/`end` during a drag preview
(see the `live = noteDrag && noteDrag.note === n ? {...} : n` assignment a few lines above
this block); pitch never changes during a time-drag, so reading it from the underlying note
`n` is correct even mid-drag.

- [ ] **Step 2: Commit**

```bash
git add app.js
git commit -m "app: the selection outline only draws on the pitch-matching note"
```

---

### Task 6: Toolbar/keyboard edit functions carry and dispatch `midi`

**Files:**
- Modify: `app.js:1834-1901` (`editOctave`, `editPitchNudge`, `editTimeNudge`,
  `editDeleteNote`, `editSplit`)

Five small functions, each rewritten once to its final form — no intermediate states to
track.

- [ ] **Step 1: `editOctave`**

Find:

```js
function editOctave(dir) {
  if (!selectedNote) return;
  dispatchEdit([{ type: 'octave', at: selectedNote.at, dir }]);
  // start/end unchanged by an octave move — the anchor stays valid as-is.
}
```

Replace with:

```js
function editOctave(dir) {
  if (!selectedNote) return;
  dispatchEdit([{ type: 'octave', at: selectedNote.at, dir, midi: selectedNote.midi }]);
  // start unchanged by an octave move, but the pitch identity IS changing — keep it current.
  selectedNote = { at: selectedNote.at, midi: selectedNote.midi + 12 * dir };
}
```

- [ ] **Step 2: `editPitchNudge`**

Find:

```js
function editPitchNudge(semitones) {
  if (!selectedNote) return;
  dispatchEdit([{ type: 'pitchNudge', at: selectedNote.at, semitones }]);
}
```

Replace with:

```js
function editPitchNudge(semitones) {
  if (!selectedNote) return;
  dispatchEdit([{ type: 'pitchNudge', at: selectedNote.at, semitones, midi: selectedNote.midi }]);
  selectedNote = { at: selectedNote.at, midi: selectedNote.midi + semitones };
}
```

- [ ] **Step 3: `editTimeNudge`**

Find:

```js
function editTimeNudge(dir) {
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at);
  if (!n) return;
  const d = TIME_NUDGE_STEP * dir;
  dispatchEdit([{ type: 'timeAdjust', at: selectedNote.at, dStart: d, dEnd: d }]);
  selectedNote = { at: selectedNote.at + d };
}
```

Replace with:

```js
function editTimeNudge(dir) {
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
  if (!n) return;
  const d = TIME_NUDGE_STEP * dir;
  dispatchEdit([{ type: 'timeAdjust', at: selectedNote.at, dStart: d, dEnd: d, midi: selectedNote.midi }]);
  selectedNote = { at: selectedNote.at + d, midi: selectedNote.midi };
}
```

- [ ] **Step 4: `editDeleteNote`**

Find:

```js
function editDeleteNote() {
  if (!selectedNote) return;
  dispatchEdit([{ type: 'delete', at: selectedNote.at }]);
  selectedNote = null;
}
```

Replace with:

```js
function editDeleteNote() {
  if (!selectedNote) return;
  dispatchEdit([{ type: 'delete', at: selectedNote.at, midi: selectedNote.midi }]);
  selectedNote = null;
}
```

- [ ] **Step 5: `editSplit`**

Find:

```js
function editSplit() {
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at);
  if (!n) return;
  const cutAt = currentTime();
  if (cutAt <= n.start || cutAt >= n.end) return;   // playhead must be inside the note

  const edits = [];
  if (n.end - cutAt < SPLIT_GAP) {
    edits.push({ type: 'timeAdjust', at: selectedNote.at, dStart: 0, dEnd: cutAt - n.end });
    selectedNote = { at: (n.start + cutAt) / 2 };
  } else if (cutAt - n.start < SPLIT_GAP) {
    edits.push({ type: 'timeAdjust', at: selectedNote.at, dStart: cutAt - n.start, dEnd: 0 });
    selectedNote = { at: (cutAt + n.end) / 2 };
  } else {
    edits.push({ type: 'timeAdjust', at: selectedNote.at, dStart: 0, dEnd: cutAt - n.end });
    edits.push({ type: 'add', start: cutAt + SPLIT_GAP, end: n.end, midi: n.midi });
    selectedNote = { at: (n.start + cutAt) / 2 };
  }
  dispatchEdit(edits);
}
```

Replace with:

```js
function editSplit() {
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
  if (!n) return;
  const cutAt = currentTime();
  if (cutAt <= n.start || cutAt >= n.end) return;   // playhead must be inside the note

  const edits = [];
  if (n.end - cutAt < SPLIT_GAP) {
    edits.push({ type: 'timeAdjust', at: selectedNote.at, dStart: 0, dEnd: cutAt - n.end, midi: n.midi });
    selectedNote = { at: (n.start + cutAt) / 2, midi: n.midi };
  } else if (cutAt - n.start < SPLIT_GAP) {
    edits.push({ type: 'timeAdjust', at: selectedNote.at, dStart: cutAt - n.start, dEnd: 0, midi: n.midi });
    selectedNote = { at: (cutAt + n.end) / 2, midi: n.midi };
  } else {
    edits.push({ type: 'timeAdjust', at: selectedNote.at, dStart: 0, dEnd: cutAt - n.end, midi: n.midi });
    edits.push({ type: 'add', start: cutAt + SPLIT_GAP, end: n.end, midi: n.midi });
    selectedNote = { at: (n.start + cutAt) / 2, midi: n.midi };
  }
  dispatchEdit(edits);
}
```

Only the `timeAdjust` entries gain `midi` — the `add` entry already carries `midi: n.midi`
for a different reason (it's the new note's own pitch), and `add` does no anchor lookup at
all so there's nothing there for the qualifier to disambiguate.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "app: toolbar/keyboard edits dispatch and track midi, matching the outline"
```

---

### Task 7: Bump the asset cache-buster version

**Files:**
- Modify: `index.html` (15 occurrences), `separate.js` (3), `separate.worker.js` (1),
  `notes.js` (3), `notes.worker.js` (1) — 23 in all

Per `CLAUDE.md`'s versioned-asset-URL gotcha: every local `?v=` must agree, or a returning
visitor can run a stale `app.js` against a fresh `index.html` for up to ten minutes after
deploy. `app.js` changed in this plan, so the version must move. Current is `1.16.1`; this
plan's work is a follow-up session on the same note-editing feature (v1.16.0/v1.16.1), so it
becomes `1.16.2` per the project's versioning convention.

- [ ] **Step 1: Bump all five files**

```bash
cd /Users/sansword/Source/github/sans_bass
sed -i '' 's/?v=1\.16\.1/?v=1.16.2/g' index.html separate.js separate.worker.js notes.js notes.worker.js
```

- [ ] **Step 2: Verify every versioned URL still agrees, and none were missed**

```bash
grep -c '1\.16\.2' index.html separate.js separate.worker.js notes.js notes.worker.js
```

Expected counts: `index.html:15`, `separate.js:3`, `separate.worker.js:1`, `notes.js:3`,
`notes.worker.js:1` — 23 total, matching the count `CLAUDE.md` documents. Also confirm no
`1.16.1` remains in these five files:

```bash
grep -rn '1\.16\.1' index.html separate.js separate.worker.js notes.js notes.worker.js
```

Expected: no output.

- [ ] **Step 3: Update the version note in `CLAUDE.md`**

`CLAUDE.md`'s gotcha list ends with "Currently `v1.16.1`." Update it to `v1.16.2` so the
next session starts from the correct number.

Find (in `CLAUDE.md`):

```
`tests/versions.test.js` fails if they drift — and it
  covers `.png` and `.svg` as well as `.js`/`.css`, so the icons are included. Currently
  `v1.16.1`.
```

Replace with:

```
`tests/versions.test.js` fails if they drift — and it
  covers `.png` and `.svg` as well as `.js`/`.css`, so the icons are included. Currently
  `v1.16.2`.
```

- [ ] **Step 4: Run `tests/versions.test.js` to confirm agreement**

With `./scripts/serve.sh` still running (from Task 1), reload
`http://localhost:8777/tests/test.html` and read `window.__testResults`.

Expected: `window.__testResults.failed === 0` (this also re-confirms Task 1's `applyEdits`
tests still pass — the whole suite runs together).

- [ ] **Step 5: Commit**

```bash
git add index.html separate.js separate.worker.js notes.js notes.worker.js CLAUDE.md
git commit -m "chore: bump asset version to 1.16.2"
```

---

### Task 8: Update `docs/behaviour.md`

**Files:**
- Modify: `docs/behaviour.md` (row E19, and two new rows after E23)

- [ ] **Step 1: Rewrite E19 to describe pitch-aware resolution**

Find (around line 300):

```
| E19 | With two notes overlapping in time, a click on the overlap resolves to whichever note is drawn on top (the later array entry) — not necessarily the first-detected one. | Overlap a manually added note onto an existing one; click the overlap and confirm the outline lands on the new note, not the old one underneath. |
```

Replace with:

```
| E19 | With two notes overlapping in time, a click resolves to the note whose pitch matches the click's vertical position — not an arbitrary array-order match. Only when two overlapping notes share the exact same pitch too (an exact duplicate) does it fall back to whichever is drawn on top (the later array entry). | Overlap two notes at different pitches (add a note over an existing one, a few semitones away, same time span): click near each one's row and confirm the outline lands on the pitch-matching note, not the other. Add a note directly on top of an existing one at the same pitch and span: click the overlap and confirm the outline lands on the new (topmost) one. |
```

- [ ] **Step 2: Add two new rows after E23**

Find (around line 304):

```
| E23 | An `add`ed or split-off note sounds through the notes lane's reference tone (with the lane unmuted), even though it sits appended at the end of the note list regardless of its own chronological position. | Split a note early in a long song, play from before the cut with the notes lane unmuted: both halves are audible, not just the one that kept its original array position. |
```

Replace with:

```
| E23 | An `add`ed or split-off note sounds through the notes lane's reference tone (with the lane unmuted), even though it sits appended at the end of the note list regardless of its own chronological position. | Split a note early in a long song, play from before the cut with the notes lane unmuted: both halves are audible, not just the one that kept its original array position. |
| E24 | The selection outline draws on exactly the selected note — never on a different note that happens to share the same time point at a different pitch. | Select a note, then add a second note spanning the same time range a few semitones away: only the originally selected note keeps the white outline; the new overlapping note has none, even though it shares the same time span. |
| E25 | A toolbar button or keyboard shortcut (octave, semitone, time nudge, delete, split) always acts on the exact note carrying the outline — never a different note that happens to share the outlined note's anchor time. | Select a note, add a second note overlapping it in time at a different pitch, then press a toolbar button (e.g. ↑ 8ve): only the outlined note's pitch/position changes; the overlapping note is untouched. |
```

- [ ] **Step 3: Commit**

```bash
git add docs/behaviour.md
git commit -m "docs: behaviour rows for pitch-aware note selection (E19, E24, E25)"
```

---

### Task 9: Manual browser verification

**Files:** none (verification only)

`app.js`'s hit-testing, outline, and toolbar/keyboard handlers have no automated test
runner — per the spec's Testing section and `docs/behaviour.md`'s existing convention for
the rest of the note editor, this is verified by hand, in a real browser, observing the
actual outcome rather than an intermediate parameter (same rule the loop/audio code follows
elsewhere in this project).

- [ ] **Step 1: Serve and load a song with a vocals stem**

With `./scripts/serve.sh` running, open `http://localhost:8777/` in a browser and load any
local song/zip that has a `vocals` stem (from your own `stems/` directory, or a stems `.zip`
you've exported before) — a real vocals stem, not a synthesized fake, since note detection
needs real periodic pitch content to produce something to click on. Click **Find notes**,
then tick **Edit notes**.

- [ ] **Step 2: E24 — outline only on the selected note**

Click a note to select it (outline appears). Arm **+ Add note**, drag out a new note spanning
the *same time range* as the selected one but a few semitones away, and release.

Expected: only the originally selected note keeps the white outline. The newly added note —
despite sharing the exact same time span — has no outline of its own.

- [ ] **Step 3: E19 — click resolves by pitch**

With the same two overlapping notes on screen (different pitch, same time span), click
directly on the lower one's row, then directly on the upper one's row.

Expected: each click selects (outlines) the note at that row — not always the same one, and
not always the topmost one.

- [ ] **Step 4: E19's duplicate case — exact overlap still picks topmost**

Arm **+ Add note** again and drag out a note at the *exact same pitch and time span* as an
existing note (drop it precisely on top).

Expected: clicking the overlap selects the new (topmost, last-drawn) note — matching
v1.16.1's original intent for a true duplicate.

- [ ] **Step 5: E25 — toolbar acts on the outlined note only**

With the two different-pitch, same-time-span notes from Step 2 still present, select one of
them (confirm which one is outlined), then click **↑ 8ve** in the toolbar.

Expected: only the outlined note's pitch changes (its row on the pitch axis jumps an
octave). The other, unselected, time-overlapping note is completely unchanged. Repeat once
more selecting the *other* note and pressing **♯** (semitone up) to confirm the same holds
for a different button.

- [ ] **Step 6: Keyboard path too**

Select a note, press `↑` (pitch nudge) and `Shift+↑` (octave) from the keyboard rather than
the toolbar buttons.

Expected: same result as Step 5 — only the selected note changes, confirmed by the outline
staying on it and its pitch value being the only one that moved.

- [ ] **Step 7: Old edit-history import still works**

If you have a `.json` edit-history export from before this change (v1.16.0/v1.16.1 era, with
no `midi` field on its edit objects), use **Import edits** to load it against the same song.

Expected: it imports and reproduces the same note list it always did — no error, no note
resolved differently than before. If you don't have an old export handy, this step can be
skipped; Task 1's "without midi" unit test already covers the underlying guarantee
(`applyEdits` with no `e.midi` behaves exactly as it did pre-change).

- [ ] **Step 8: Update `docs/behaviour.md`'s "last exercised" line**

Find, near the top of `docs/behaviour.md`:

```
Last exercised end-to-end: **v1.2.2**; the Loading and Loading-the-page-itself rows were re-run in **v1.4.0**, and the Loading / Lanes / Unmute-all / Play-dropdown rows touched by v1.6.0 were re-run in **v1.6.0**. Items marked ⚠ were reasoned from the code rather
than run in that session, so treat them as the least trustworthy rows here.
```

Append a clause noting E19/E24/E25 were re-run in this version — append after the existing
sentence, keeping everything before it intact, e.g.:

```
Last exercised end-to-end: **v1.2.2**; the Loading and Loading-the-page-itself rows were re-run in **v1.4.0**, and the Loading / Lanes / Unmute-all / Play-dropdown rows touched by v1.6.0 were re-run in **v1.6.0**. E19, E24 and E25 were re-run in **v1.16.2**. Items marked ⚠ were reasoned from the code rather
than run in that session, so treat them as the least trustworthy rows here.
```

- [ ] **Step 9: Commit**

```bash
git add docs/behaviour.md
git commit -m "docs: record E19/E24/E25 manual verification for v1.16.2"
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
| [v1.16.1](#v1161--note-editing-ergonomics-batch-1-2026-08-31-2322) | Four ergonomics fixes to v1.16.0's note editor: overlapping notes resolve clicks to whichever is drawn on top, the zoomed pane's scroll wheel seeks by default (Shift zooms) and arrows always seek (Shift for a fine step), range-select-and-delete now works in the full-song notes lane too, and clicking or tapping a note parks the playhead exactly there. |
```

Insert a new row immediately above it (newest-first):

```
| [v1.16.2](#v1162--note-selection-identity-2026-09-01-hhmm) | Overlapping notes are disambiguated by pitch, not just time: `selectedNote` now carries `midi`, `noteAt` and `applyEdits` both accept an optional pitch qualifier, and the selection outline and every toolbar/keyboard edit resolve to the exact note under the pointer instead of an arbitrary same-time match. Old exported edit-history files (no `midi` field) still apply exactly as before. |
| [v1.16.1](#v1161--note-editing-ergonomics-batch-1-2026-08-31-2322) | Four ergonomics fixes to v1.16.0's note editor: overlapping notes resolve clicks to whichever is drawn on top, the zoomed pane's scroll wheel seeks by default (Shift zooms) and arrows always seek (Shift for a fine step), range-select-and-delete now works in the full-song notes lane too, and clicking or tapping a note parks the playhead exactly there. |
```

Replace `hhmm` in the anchor with the actual `HH-MM` from Step 1 minus the colon (e.g.
`14:37` → `1437`), matching the anchor format GitHub generates for the heading in Step 3.

- [ ] **Step 3: Add the entry**

Find, in `docs/devlog.md`, the start of the v1.16.1 entry:

```
## v1.16.1 — Note editing ergonomics (batch 1) (2026-08-31 23:22)
```

Insert a new entry immediately above it:

```
## v1.16.2 — Note selection identity (YYYY-MM-DD HH:MM)

**Review:** not yet

**Design docs:**
- Note selection identity: [Spec](superpowers/specs/2026-09-01-note-selection-identity-design.md) [Plan](superpowers/plans/2026-09-01-note-selection-identity.md)

**What was built:**

- `selectedNote` now carries `{ at, midi }` instead of just `{ at }` — every assignment site
  (click-select, drag commit, add-note commit, octave/semitone/time nudge, split) keeps it
  current, including two functions (`editOctave`, `editPitchNudge`) that previously left it
  stale after a pitch-changing edit.
- `noteAt(list, at, midi)` gained an optional third parameter: with it, only a note at that
  exact pitch counts, which is what actually disambiguates two notes overlapping in time —
  time alone never could, no matter which tie-break rule wound up on top of it. Every call
  site that already has a `selectedNote` passes its `midi` through; the one fresh-click call
  site reuses `addMidiAt` (the same Y→pitch rounding `+ Add note` placement already uses) to
  get a pitch value from the click itself.
- The selection outline (`renderZoom`) and `lib/pitch.js`'s `applyEdits` anchor lookup both
  gained the same pitch check, so the toolbar/keyboard can no longer visibly select one note
  while silently acting on a different, time-overlapping one underneath it.
- `applyEdits`'s `midi` qualifier is optional and additive: an edit object with no `midi`
  (every edit in a file exported before this change) resolves exactly as it always did —
  first match, no pitch filtering — so old exported edit-history JSON keeps applying
  unmodified.

**Key technical learnings:**

- `[insight]` **Tie-breaking and disambiguation are different problems that look like the
  same one.** v1.16.1 fixed *which* overlapping note a click resolves to when multiple
  candidates are already known (array-order tie-break: last/topmost wins). It could not fix
  the deeper issue, because tie-breaking only matters once you already know your candidate
  set — and time alone was never enough to build that set correctly when two notes overlap
  in time but sit at different pitches. Pitch is what narrows "notes containing this time
  point" down to "the one thing actually under the pointer."
- `[gotcha]` **A selection anchor's shape has to track every field an edit can change, not
  just the ones the original design happened to touch.** `selectedNote.at` already survived
  every edit type by design (v1.16.0); adding `midi` surfaced two functions
  (`editOctave`, `editPitchNudge`) that changed a note's pitch without updating the
  selection's own record of it — harmless while `selectedNote` was time-only, but silently
  wrong (a stale-pitch outline vanishing right after the very edit that just ran) the moment
  pitch became part of the identity.
- `[note]` Reusing `addMidiAt` for click-to-select's pitch value, rather than writing a
  second Y→pitch rounding function, keeps "what pitch is under this pointer" answered one
  way everywhere it's asked — the same reasoning that keeps `noteAt`'s half-open interval
  shared between `app.js` and `lib/pitch.js`.

---

```

Leave everything below the `---` (the existing v1.16.1 entry and onward) untouched.

- [ ] **Step 4: Commit**

```bash
git add docs/devlog.md
git commit -m "docs: v1.16.2 devlog entry"
```

---

## Self-review checklist (for whoever executes this plan)

- [ ] Every design-doc section (1-4) has a corresponding task: shape (Task 2), hit-testing
      (Tasks 2-3), outline (Task 5), `applyEdits` (Task 1), app.js dispatch qualifiers
      (Task 6).
- [ ] `noteAt`'s two-argument call sites that were never meant to change (there are none in
      this plan — every existing call site either already had a `selectedNote` to draw
      `midi` from, or is the one fresh-click site that gets `addMidiAt` instead) are
      confirmed unchanged by re-reading Task 3 Step 2.
- [ ] `add` and `rangeDelete` edit types are confirmed untouched (Task 1's `applyEdits` diff
      only changes the anchor-lookup branch both of those skip).
- [ ] Asset version bumped everywhere it's mirrored: `index.html`, `separate.js`,
      `separate.worker.js`, `notes.js`, `notes.worker.js`, and the note in `CLAUDE.md`
      (Task 7).
