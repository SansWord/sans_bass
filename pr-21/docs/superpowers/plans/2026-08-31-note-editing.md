# Note Editing (Layer 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user hand-correct the detected note list — octave move, semitone nudge, delete, split, add, move/resize in time, and range-delete — from the zoomed pane, with the corrections surviving every later re-interpretation, and export/import the whole editing session (edits plus every control that shapes the note list) as a JSON file.

**Architecture:** A new pure function `applyEdits(notes, edits)` in `lib/pitch.js`, run after `interpret()`/`foldOctaves()` inside `notes.js`'s `reinterpret()` — the same post-pass shape `foldOctaves` already established. `notes.js` owns the edit list (as undo/list-display *groups* of one or two primitive edits — see below) and the static controls (mode toggle, edit-list panel, export/import). `app.js` owns the zoomed pane, note selection, the toolbar, and every pointer/keyboard interaction; it talks to `notes.js` the same way `separate.js` already does — through `window.sansBass` and `CustomEvent`s on `window` (`sansbass:noteedit`, `sansbass:editundo`, `sansbass:editmode`) — because a classic script and an ES module cannot share scope directly.

**Tech Stack:** Vanilla ESM and classic scripts, no build step, no dependencies. Tests are the existing browser harness (`tests/test.html`); interactive/pointer behaviour has no runner and is verified by hand, recorded in `docs/behaviour.md`, exactly as every other pointer-driven feature in this app already is.

**Spec:** [`docs/superpowers/specs/2026-08-31-note-editing-design.md`](../specs/2026-08-31-note-editing-design.md)
**Background, read first:** [`docs/transcription.md`](../../transcription.md) — "The four layers" and "Layer 4 — edits".

**Branch:** create `feat/note-editing` off `main` before Task 1.

---

## The one thing to understand before starting

**Edits are anchored to a TIME POINT, never a note index.** `notes` is re-derived from
`frames` on every parameter tweak — a slider drag, a checkbox — so an index into that array
is meaningless the instant it's re-derived. A time point still identifies the same moment in
the song. `applyEdits(notes, edits)` re-locates each edit's target, on every call, as
"whichever note currently spans this time point" — never a cached reference. This is also
why an edit can become **orphaned** (its target no longer exists) rather than erroring: that
is an expected, surfaced outcome, not a bug.

**`split` is not a data-model primitive.** Cutting a note at `cutAt` is just: shrink the
original note's `end` to `cutAt` (a `timeAdjust`), and — unless the remainder would be under
5ms — add a new note for `[cutAt + 5ms, end]` (an `add`). `lib/pitch.js`'s `applyEdits` only
ever sees six primitive types (`octave`, `pitchNudge`, `timeAdjust`, `delete`, `add`,
`rangeDelete`); "split" is something `app.js` composes from two of them and dispatches
together, grouped as one entry so undo and the edit-list panel treat it as one user action.

**State is split across two files that cannot import each other.** `app.js` is a classic
script; `notes.js` is an ES module. They already talk through `window.sansBass` (functions
`app.js` exposes, that `notes.js` calls) and `CustomEvent`s on `window` (state changes
`app.js` needs to react to, that `notes.js` dispatches — see `sansbass:transport`,
`sansbass:ribbonmute`). This plan adds three more: `app.js` dispatches `sansbass:noteedit`
(one or two primitive edits, always as an array, whenever the user finishes an edit action)
and `sansbass:editundo` (Cmd/Ctrl+Z); `notes.js` owns the edit list and dispatches
`sansbass:editmode` when the toggle changes so `app.js` knows to turn on note-selection and
the toolbar.

**Selection is anchor-based too, for the same reason edits are.** `app.js` tracks
`selectedNote = { at }`, a time point guaranteed to fall inside the selected note. After
every action that could move the note's boundaries, the handler re-anchors `at` to the
resulting note's own midpoint — never the original click position — so selection survives a
sequence of edits without drifting outside the note it's supposed to track.

## File structure

| File | Responsibility |
|---|---|
| `lib/pitch.js` (modify) | `applyEdits(notes, edits)` — the layer-4 post-pass. ~70 added lines. |
| `tests/pitch.test.js` (modify) | `applyEdits` unit tests: each primitive, orphaning, sequencing, `fix.from` chaining, no-mutation. |
| `notes.js` (modify) | Owns `editGroups`/`orphaned` state, the mode toggle, the edit-list panel, undo, export/import. Listens for `sansbass:noteedit` / `sansbass:editundo`. |
| `app.js` (modify) | `NOTE_FILL.manual`; zoomed-pane selection, toolbar, drag-to-move/resize, drag-to-add, drag-to-range-select; keyboard shortcuts. Dispatches `sansbass:noteedit`/`sansbass:editundo`/`sansbass:editmode`. |
| `index.html` (modify) | The mode-toggle checkbox, the edit-list row, the export/import row. |
| `styles.css` (modify) | `.note-toolbar`, `.note-tbtn*`, `.notes-edit-list`, `.edit-rows`/`.edit-row`/`.edit-warn`/`.edit-remove`. |
| `lib/i18n.js` (modify) | New keys, both locales, one UI-introducing task at a time. |
| `docs/behaviour.md`, `docs/devlog.md`, `docs/transcription.md`, `docs/roadmap.md`, `CLAUDE.md` (modify, Task 10) | Behaviour rows, devlog entry, status table, version bump. |

**No `?v=` bump before Task 10.** It belongs to the release.

## Running the tests

```bash
./scripts/serve.sh          # http://localhost:8777
```

Units at `http://localhost:8777/tests/test.html` — read the rendered `PASS`/`FAIL` lines, or
`window.__testResults` in the console. **Baseline before you start: 199/199 passing.**

If the page reports `undefined`/nothing useful, or the whole suite stops rendering partway
through, do not hunt for a broken test — an ESM named import of a not-yet-written export
(e.g. `import { applyEdits } from '../lib/pitch.js'` before `applyEdits` exists) fails
`pitch.test.js` at **link time**, before any test in it runs, and can abort the whole import
chain in `tests/test.html`. Read the browser console for a `SyntaxError` naming the missing
export — that is what "run the failing test" looks like for this harness, and it is expected
at the start of Task 1's Step 2.

Interactive/pointer behaviour (selection, dragging, keyboard shortcuts) has no test runner.
Each of those tasks ends with a **"Verify by hand"** step instead of a console snippet —
`./scripts/serve.sh`, open `http://localhost:8777`, load `stems/ng_kipin.zip` (or any stems
zip with a `vocals` lane), click **Find notes**.

---

## Task 1: `applyEdits()` — the layer-4 post-pass

**Files:**
- Modify: `lib/pitch.js`
- Test: `tests/pitch.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/pitch.test.js`, after the final `test('pitch: interpret folds for hmm-v1 too', ...)` block at the end of the file:

```js
import { applyEdits } from '../lib/pitch.js';

test('pitch: applyEdits shifts a note a whole octave and tags it manual', () => {
  const notes = notesAt([50, 52, 54]);
  const { notes: out, orphaned } = applyEdits(notes, [{ type: 'octave', at: 0.25, dir: 1 }]);
  assertEq(orphaned.length, 0, 'the anchor lands inside the first note');
  assertEq(out[0].midi, 62, 'shifted up a full octave');
  assertEq(out[0].name, 'D4', 'the name is rewritten to match');
  assertEq(out[0].cents, notes[0].cents + 1200, 'and so are the cents');
  assertEq(out[0].fix.state, 'manual', 'tagged as a hand edit');
  assertEq(out[0].fix.from, 50, 'provenance records the original pitch');
  assertEq(out[1].midi, 52, 'the other notes are untouched');
});

test('pitch: applyEdits pitchNudge shifts by exactly the given semitones', () => {
  const notes = notesAt([50]);
  const out = applyEdits(notes, [{ type: 'pitchNudge', at: 0.1, semitones: -1 }]).notes;
  assertEq(out[0].midi, 49);
  assertEq(out[0].fix.state, 'manual');
});

test('pitch: applyEdits delete removes exactly the targeted note', () => {
  const notes = notesAt([50, 52, 54]);
  const out = applyEdits(notes, [{ type: 'delete', at: 0.75 }]).notes;
  assertEq(out.length, 2);
  assertEq(out.map((n) => n.midi).join(','), '50,54', 'the middle note is gone, order preserved');
});

test('pitch: applyEdits add inserts a note with no target lookup, tagged manual from birth', () => {
  const notes = notesAt([50]);
  const out = applyEdits(notes, [{ type: 'add', start: 10, end: 10.5, midi: 60 }]).notes;
  assertEq(out.length, 2);
  assertEq(out[1].midi, 60);
  assertEq(out[1].name, 'C4');
  assertEq(out[1].fix.state, 'manual');
  assert(out[1].fix.from === undefined, 'an added note has no prior pitch to record');
});

test('pitch: applyEdits timeAdjust with equal deltas moves a note without resizing it', () => {
  const notes = notesAt([50]);           // [0, 0.5]
  const out = applyEdits(notes, [{ type: 'timeAdjust', at: 0.25, dStart: 0.2, dEnd: 0.2 }]).notes;
  assertClose(out[0].start, 0.2, 1e-6);
  assertClose(out[0].end, 0.7, 1e-6);
  assertClose(out[0].end - out[0].start, 0.5, 1e-6, 'duration unchanged — a move, not a resize');
});

test('pitch: applyEdits timeAdjust with one delta resizes just that edge', () => {
  const notes = notesAt([50]);           // [0, 0.5]
  const out = applyEdits(notes, [{ type: 'timeAdjust', at: 0.25, dStart: 0, dEnd: 0.3 }]).notes;
  assertClose(out[0].start, 0, 1e-6, 'start untouched');
  assertClose(out[0].end, 0.8, 1e-6, 'end extended');
});

test('pitch: applyEdits rangeDelete removes every note overlapping the range and nothing else', () => {
  const notes = notesAt([50, 52, 54, 56]);   // [0,.5] [.5,1] [1,1.5] [1.5,2]
  const out = applyEdits(notes, [{ type: 'rangeDelete', from: 0.4, to: 1.1 }]).notes;
  assertEq(out.map((n) => n.midi).join(','), '56', 'only the untouched last note survives');
});

test('pitch: applyEdits rangeDelete is re-evaluated fresh, not a one-time snapshot', () => {
  const edit = { type: 'rangeDelete', from: 0, to: 1 };
  const before = notesAt([50, 52]);                       // both inside [0,1)
  assertEq(applyEdits(before, [edit]).notes.length, 0);
  // A DIFFERENT note list, later, still inside the same range — the SAME edit object catches it.
  const after = notesAt([61]);                            // [0, 0.5], inside [0,1)
  assertEq(applyEdits(after, [edit]).notes.length, 0,
    'the same edit re-derives against whatever notes exist now, not what existed when it was made');
});

test('pitch: applyEdits orphans an edit whose anchor matches no current note', () => {
  const notes = notesAt([50]);   // [0, 0.5]
  const { notes: out, orphaned } = applyEdits(notes, [{ type: 'octave', at: 5, dir: 1 }]);
  assertEq(out[0].midi, 50, 'nothing changed');
  assertEq(orphaned.length, 1, 'the edit is reported, not silently dropped');
  assertEq(orphaned[0].at, 5);
});

test('pitch: applyEdits orphans an edit whose target an earlier edit already removed', () => {
  const notes = notesAt([50]);   // [0, 0.5]
  const { notes: out, orphaned } = applyEdits(notes, [
    { type: 'delete', at: 0.25 },
    { type: 'octave', at: 0.25, dir: 1 },
  ]);
  assertEq(out.length, 0);
  assertEq(orphaned.length, 1, 'the second edit finds nothing where the first one deleted');
});

test('pitch: applyEdits edits apply in order, against the already-modified list', () => {
  const notes = notesAt([50]);   // [0, 0.5]
  const out = applyEdits(notes, [
    { type: 'octave', at: 0.25, dir: 1 },            // 50 -> 62
    { type: 'pitchNudge', at: 0.25, semitones: 1 },  // 62 -> 63; same anchor still resolves
  ]).notes;
  assertEq(out[0].midi, 63);
});

test('pitch: applyEdits chains fix.from through multiple pitch edits to the ORIGINAL midi', () => {
  const notes = notesAt([50]);
  const out = applyEdits(notes, [
    { type: 'octave', at: 0.25, dir: 1 },
    { type: 'pitchNudge', at: 0.25, semitones: 1 },
  ]).notes;
  assertEq(out[0].fix.from, 50, 'not 62 — the earliest known pitch survives every hop');
});

test('pitch: applyEdits preserves fix.from already set by foldOctaves', () => {
  const folded = [{ start: 0, end: 0.5, midi: 62, cents: 6200, name: noteName(62), confidence: 0.9,
                     fix: { from: 74, state: 'folded', shift: -1 } }];
  const out = applyEdits(folded, [{ type: 'pitchNudge', at: 0.25, semitones: 1 }]).notes;
  assertEq(out[0].fix.from, 74, "the detector's original guess survives the hand edit too");
  assertEq(out[0].fix.state, 'manual', 'but the state changes — no longer just "folded"');
});

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
  const notes = notesAt([50]);
  const edits = [{ type: 'octave', at: 0.25, dir: 1 }];
  const frozenNote = { ...notes[0] };
  const frozenEdit = { ...edits[0] };
  applyEdits(notes, edits);
  assertEq(notes[0].midi, frozenNote.midi, 'input notes unchanged');
  assertEq(edits[0].dir, frozenEdit.dir, 'input edits unchanged');
});

test('pitch: applyEdits with no edits returns an equivalent but distinct copy', () => {
  const notes = notesAt([50, 52]);
  const out = applyEdits(notes, []).notes;
  assertEq(out.length, notes.length);
  assert(out !== notes, "a new array, matching foldOctaves' no-mutation convention");
});
```

- [ ] **Step 2: Run the tests and confirm the expected failure**

Open `http://localhost:8777/tests/test.html`. Expected: the page does not reach
`N/N passed` — the console shows a `SyntaxError` because `applyEdits` is not exported from
`lib/pitch.js` yet. This is the "fails" step for an ESM-import-based suite; see "Running the
tests" above.

- [ ] **Step 3: Implement `applyEdits`**

Append to `lib/pitch.js`, after the closing `}` of `foldOctaves` (the last line in the file):

```js

// ---------------------------------------------------------------- edits (layer 4)

/**
 * Apply a human's hand-made overrides on top of a derived note list.
 *
 * The one layer with no upstream to recover from — see docs/transcription.md, "The four
 * layers" — so edits are anchored to TIME POINTS (`at`), never note indices. An index is
 * meaningless the moment notes are re-derived; a time point still identifies the same
 * moment in the song.
 *
 * Six primitive types. `split` is deliberately not one of them: the caller composes it from
 * `timeAdjust` (shrink) plus `add` (the new tail note) — see the note-editing design spec.
 *
 *   { type: 'octave',     at, dir }              dir: 1 | -1 — shift a whole octave
 *   { type: 'pitchNudge', at, semitones }         shift by `semitones`
 *   { type: 'timeAdjust', at, dStart, dEnd }      seconds; both equal = move, one = resize
 *   { type: 'delete',     at }                    remove the target note
 *   { type: 'add',        start, end, midi }      insert a new note; no target lookup
 *   { type: 'rangeDelete', from, to }             remove every note overlapping the range
 *
 * Edits apply in order, each re-locating its target against the list AS ALREADY MODIFIED by
 * earlier edits in this same call — never against the original `notes` argument. A target
 * that cannot be found (deleted by an earlier edit, merged away, folded elsewhere) is
 * skipped and returned in `orphaned` rather than silently dropped, so the caller can flag it
 * instead of the note list quietly diverging from what the user thinks they did.
 *
 * Any edit that changes `midi` sets `fix = { state: 'manual', from }`, where `from` is the
 * EARLIEST known original pitch — carried forward from a prior `fix.from` if there is one,
 * so a note that was folded and then hand-corrected still remembers what the detector first
 * said. This both satisfies the existing rule that a `doubt` note must have its `fix`
 * cleared or replaced (`lib/sonify.js` skips it otherwise) and gives every manually-touched
 * note a colour distinct from plain/folded/doubt. `add`ed notes get `fix = { state: 'manual' }`
 * from birth — nothing to clear, but the same tag.
 *
 * Never mutates `notes` or the edits; returns new note objects, matching `foldOctaves`.
 */
export function applyEdits(notes, edits) {
  let list = (notes || []).map((n) => ({ ...n }));
  if (!edits || !edits.length) return { notes: list, orphaned: [] };
  const orphaned = [];

  for (const e of edits) {
    if (e.type === 'add') {
      list.push({
        start: +e.start.toFixed(4),
        end: +e.end.toFixed(4),
        midi: e.midi,
        cents: e.midi * 100,
        name: noteName(e.midi),
        confidence: 1,
        fix: { state: 'manual' },
      });
      continue;
    }
    if (e.type === 'rangeDelete') {
      // Re-evaluated fresh every call, against whatever is currently in the range — not a
      // one-time snapshot of what was there when it was drawn.
      list = list.filter((n) => !(n.start < e.to && n.end > e.from));
      continue;
    }

    const idx = list.findIndex((n) => n.start <= e.at && e.at < n.end);
    if (idx === -1) { orphaned.push(e); continue; }
    const n = list[idx];
    const from = n.fix && n.fix.from !== undefined ? n.fix.from : n.midi;

    if (e.type === 'delete') {
      list.splice(idx, 1);
    } else if (e.type === 'octave') {
      const midi = n.midi + 12 * e.dir;
      list[idx] = {
        ...n, midi, name: noteName(midi),
        cents: +(n.cents + 1200 * e.dir).toFixed(1),
        fix: { state: 'manual', from },
      };
    } else if (e.type === 'pitchNudge') {
      const midi = n.midi + e.semitones;
      list[idx] = {
        ...n, midi, name: noteName(midi),
        cents: +(n.cents + 100 * e.semitones).toFixed(1),
        fix: { state: 'manual', from },
      };
    } else if (e.type === 'timeAdjust') {
      list[idx] = {
        ...n,
        start: +(n.start + (e.dStart || 0)).toFixed(4),
        end: +(n.end + (e.dEnd || 0)).toFixed(4),
      };
    }
  }
  return { notes: list, orphaned };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Reload `http://localhost:8777/tests/test.html`. Expected: **215/215 passed** (199 baseline +
16 new).

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "Pitch: applyEdits() — the layer-4 hand-edit post-pass"
```

---

## Task 2: Wire edits into `notes.js`, and a fourth note colour

**Files:**
- Modify: `notes.js`
- Modify: `app.js`

- [ ] **Step 1: Import `applyEdits` and add edit-list state**

In `notes.js`, change the existing import line:

```js
import { interpret, detectKey, notesToChroma, relativeKey } from './lib/pitch.js?v=1.15.0';
```

to:

```js
import { interpret, applyEdits, detectKey, notesToChroma, relativeKey } from './lib/pitch.js?v=1.15.0';
```

After the existing module state (`let sonifier = null;`), add:

```js
/* The edit list, as GROUPS — one undo/list-display entry each. Most actions push a
 * one-element group; a normal split pushes two primitive edits (a timeAdjust shrink plus an
 * add) as a single group, so undo and per-row removal act on the whole split at once rather
 * than half of it. lib/pitch.js's applyEdits() only ever sees the flattened primitives — see
 * docs/superpowers/specs/2026-08-31-note-editing-design.md. */
let editGroups = [];
let orphaned = [];         // primitive edits from the last applyEdits() call with no target
let nextEditId = 1;
```

- [ ] **Step 2: Apply edits inside `reinterpret()`**

In `notes.js`, `reinterpret()` currently reads:

```js
function reinterpret() {
  if (!frames) return;
  const p = currentParams();
  notes = interpret(frames, p);
  el.count.textContent = tr('notes.count', { n: notes.length });
  el.minOut.textContent = `${el.min.value} ms`;
  syncFoldControls();
  if (jianpu.auto && notes.length) {
```

Change it to apply edits right after `interpret()`, before the count and key detection read
the result:

```js
function reinterpret() {
  if (!frames) return;
  const p = currentParams();
  notes = interpret(frames, p);
  const applied = applyEdits(notes, editGroups.flatMap((g) => g.edits));
  notes = applied.notes;
  orphaned = applied.orphaned;
  el.count.textContent = tr('notes.count', { n: notes.length });
  el.minOut.textContent = `${el.min.value} ms`;
  syncFoldControls();
  if (jianpu.auto && notes.length) {
```

- [ ] **Step 3: Clear edits on song reset**

In `notes.js`, `reset()` currently ends with `syncJianpuControls();`. Add the edit-state
reset right before it:

```js
  jianpu.auto = true;
  editGroups = [];
  orphaned = [];
  syncJianpuControls();
}
```

- [ ] **Step 4: Listen for edits from `app.js`**

Add, near the other `window.addEventListener('sansbass:...')` calls at the bottom of
`notes.js`:

```js
/* app.js owns the zoomed pane and dispatches this once the user finishes an edit action —
 * one primitive edit for most actions, two for a normal split (shrink + add) — always
 * grouped as one undo/list entry. See docs/superpowers/specs/2026-08-31-note-editing-design.md. */
window.addEventListener('sansbass:noteedit', (e) => {
  editGroups.push({ id: nextEditId++, edits: e.detail.edits });
  reinterpret();
});
```

- [ ] **Step 5: A fourth note colour for hand edits**

In `app.js`, `NOTE_FILL` currently reads:

```js
const NOTE_FILL = {
  plain:  { normal: '#8ee0ad', dim: '#4c8f6c', zoom: 'rgba(142,224,173,.86)' },
  folded: { normal: '#6cc5e0', dim: '#3a7186', zoom: 'rgba(108,197,224,.86)' },
  doubt:  { normal: '#a8a8b8', dim: '#70707f', zoom: 'rgba(168,168,184,.86)' },
};
```

Add a `manual` entry and extend the comment above it:

```js
/* Note fill by provenance. Blue for a folded note and gray for one we declined to correct,
 * purple for one a human touched directly (fix.state === 'manual', set by applyEdits in
 * lib/pitch.js — see docs/superpowers/specs/2026-08-31-note-editing-design.md): all three
 * must be distinguishable from an untouched note (green) AND from an out-of-band note (the
 * A-B orange), because "corrected", "untrusted", "hand-edited" and "off-scale" are four
 * different things the reader has to tell apart. Gray recedes without vanishing — a hidden
 * note would be a silent lie, the same rule the orange edge marks follow. */
const NOTE_FILL = {
  plain:  { normal: '#8ee0ad', dim: '#4c8f6c', zoom: 'rgba(142,224,173,.86)' },
  folded: { normal: '#6cc5e0', dim: '#3a7186', zoom: 'rgba(108,197,224,.86)' },
  doubt:  { normal: '#a8a8b8', dim: '#70707f', zoom: 'rgba(168,168,184,.86)' },
  manual: { normal: '#c99bf0', dim: '#6d5183', zoom: 'rgba(201,155,240,.86)' },
};
```

`noteFillKey` needs no change — it already falls back through `NOTE_FILL[n.fix.state]`, so
`'manual'` resolves for free.

- [ ] **Step 6: Verify the pipe end to end**

`./scripts/serve.sh`, load `stems/ng_kipin.zip`, click **Find notes**. In the console —
there is no UI to trigger an edit yet, so this dispatches a synthetic event to prove the
whole round trip (event → `editGroups` → `reinterpret()` → `applyEdits()` → `setNotes()` →
redraw):

```js
const count = () => +document.getElementById('notes-count').textContent.match(/\d+/)[0];
const before = count();
window.dispatchEvent(new CustomEvent('sansbass:noteedit', {
  detail: { edits: [{ type: 'add', start: 9990, end: 9990.3, midi: 60 }] },
}));
({ before, after: count() });
```

Expected: `after === before + 1` — the `add` primitive needs no target, so it can never
orphan, which is what makes it a reliable smoke test for the pipe itself.

- [ ] **Step 7: Commit**

```bash
git add notes.js app.js
git commit -m "Notes: wire applyEdits into reinterpret(), a fourth note colour for hand edits"
```

---

## Task 3: Edit-mode toggle and note selection

**Files:**
- Modify: `index.html`
- Modify: `lib/i18n.js`
- Modify: `notes.js`
- Modify: `app.js`

- [ ] **Step 1: The toggle control**

In `index.html`, inside the first `.notes-row`, after the `notes-show` button:

```html
        <button id="notes-show" class="btn ghost" data-i18n="notes.hide" hidden>Hide notes</button>
        <label class="notes-ctl">
          <input id="notes-edit" type="checkbox" disabled>
          <span data-i18n="notes.edit">Edit notes</span>
        </label>
```

- [ ] **Step 2: Strings, both locales**

In `lib/i18n.js`, `'zh-TW'` block, after `'notes.hide': '隱藏音符',`:

```js
      'notes.edit': '編輯音符',
      'notes.editTip': '選取音符後可修正音高、時間，或新增、刪除音符。',
```

In the `'en'` block, after `'notes.hide': 'Hide notes',`:

```js
      'notes.edit': 'Edit notes',
      'notes.editTip': 'Select a note to correct its pitch or timing, or add and delete notes.',
```

- [ ] **Step 3: Wire the toggle in `notes.js`**

Add to the `el` object, after `show: document.getElementById('notes-show'),`:

```js
  edit: document.getElementById('notes-edit'),
```

Add its tooltip inside `syncTips`, after the `jianpuTip` line:

```js
  el.edit.parentElement.title = tr('notes.editTip');
```

Enable it once notes exist — in the `analyse()` worker's `onmessage` handler, where
`el.show.hidden = false;` already runs, add the line right after it:

```js
      el.show.hidden = false;
      el.edit.disabled = false;
```

Disable and clear it on `reset()` — extend the block from Task 2 Step 3:

```js
  jianpu.auto = true;
  editGroups = [];
  orphaned = [];
  el.edit.disabled = true;
  el.edit.checked = false;
  syncJianpuControls();
}
```

Add the change listener, near the other control listeners:

```js
el.edit.addEventListener('change', () => {
  window.dispatchEvent(new CustomEvent('sansbass:editmode', { detail: { on: el.edit.checked } }));
});
```

- [ ] **Step 4: Selection state and the mode listener in `app.js`**

Add to the module state, after `let zoomHeight = ...`:

```js
let editMode = false;       // mirrors the notes.js toggle — see 'sansbass:editmode'
let selectedNote = null;    // { at } — a time point inside the selected note, or null
let zoomToolbar = null;     // built in Task 4; guarded with `if (zoomToolbar)` until then
```

Add the listener, near the existing `window.addEventListener('sansbass:...')` calls:

```js
window.addEventListener('sansbass:editmode', (e) => {
  editMode = e.detail.on;
  selectedNote = null;
  if (zoomToolbar) zoomToolbar.root.hidden = !editMode;
  if (zoomEl) { zoomEl.canvas.classList.toggle('editing', editMode); draw(); }
});
```

Add the cursor hint in `styles.css`, after `.zoomwave:active { cursor: grabbing; }`:

```css
.zoomwave.editing { cursor: pointer; }
.zoomwave.editing:active { cursor: pointer; }
```

- [ ] **Step 5: Hit-testing and selection on click**

Add this helper near `zoomTimeAt`:

```js
/** The note in `list` whose span contains `at`, or null. Half-open — a note's END excludes
 *  it, matching lib/pitch.js's applyEdits, so a click at a shared boundary picks the note
 *  that starts there rather than the one that just finished. */
function noteAt(list, at) {
  return list.find((n) => n.start <= at && at < n.end) || null;
}
```

`attachZoom`'s `pointerdown` listener currently reads:

```js
  canvas.addEventListener('pointerdown', (e) => {
    panning = true;
    travelled = 0;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
```

Change it to hit-test a note first, while edit mode is on:

```js
  canvas.addEventListener('pointerdown', (e) => {
    if (editMode && ribbon) {
      const t = zoomTimeAt(canvas, e.clientX);
      const hit = noteAt(ribbon.notes, t);
      if (hit) {
        selectedNote = { at: (hit.start + hit.end) / 2 };
        draw();
        return;   // selecting a note is the gesture; it does not also start a pan/seek
      }
    }
    panning = true;
    travelled = 0;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
```

Clicking empty space (no note under the pointer) falls through unchanged — it still pans or
seeks exactly as before, in or out of edit mode.

- [ ] **Step 6: Draw the selection outline**

In `renderZoom`, the note-drawing loop currently ends:

```js
    const minLabelPx = (ribbon.jianpu && ribbon.jianpu.on) ? 14 : 26;
    if (!out && bw > minLabelPx && bh > 9) {
      c.fillStyle = '#0d0d10';
      c.font = '600 10px ui-monospace, Menlo, monospace';
      c.textBaseline = 'middle';
      c.fillText(noteLabel(n, ribbon.jianpu), x(n.start) + 3, by + bh / 2 + 0.5);
    }
  }
```

Add the outline right after the label block, still inside the `for (const n of notes)` loop:

```js
    const minLabelPx = (ribbon.jianpu && ribbon.jianpu.on) ? 14 : 26;
    if (!out && bw > minLabelPx && bh > 9) {
      c.fillStyle = '#0d0d10';
      c.font = '600 10px ui-monospace, Menlo, monospace';
      c.textBaseline = 'middle';
      c.fillText(noteLabel(n, ribbon.jianpu), x(n.start) + 3, by + bh / 2 + 0.5);
    }
    /* The selected note gets a white outline in addition to its fill — "outline plus fill"
     * is the same language buttons and inputs use for focus elsewhere in this app. */
    if (editMode && selectedNote && n.start <= selectedNote.at && selectedNote.at < n.end) {
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1.5;
      c.strokeRect(x(n.start) + 0.75, by + 0.75, Math.max(0.5, bw - 1.5), Math.max(0.5, bh - 1.5));
    }
  }
```

- [ ] **Step 7: Verify by hand**

`./scripts/serve.sh`, open `http://localhost:8777`, load `stems/ng_kipin.zip`, click **Find
notes**, then tick **Edit notes**. Click a note block in the zoomed pane: it gains a white
outline. Click a second note: the outline moves to it, the first loses it (only one
selection at a time — `selectedNote` holds a single anchor). Click empty space in the pane:
nothing gets selected and the playhead seeks there, exactly as it did before edit mode
existed. Untick **Edit notes**: the outline disappears and clicking a note now seeks instead
of selecting it.

- [ ] **Step 8: Commit**

```bash
git add index.html lib/i18n.js notes.js app.js styles.css
git commit -m "Notes: edit-mode toggle and note selection in the zoomed pane"
```

---

## Task 4: Toolbar — octave, pitch-nudge, time-nudge, split, delete

All five are button-driven; none needs a drag. Dragging (move/resize/add/range-select) is
Tasks 5–7.

**Files:**
- Modify: `app.js`
- Modify: `lib/i18n.js`
- Modify: `styles.css`

- [ ] **Step 1: Strings, both locales**

In `lib/i18n.js`, `'zh-TW'` block, after `'notes.editTip'`:

```js
      'notes.editOctUpTip': '將選取的音符提高一個八度',
      'notes.editOctDownTip': '將選取的音符降低一個八度',
      'notes.editPitchUpTip': '將選取的音符提高一個半音',
      'notes.editPitchDownTip': '將選取的音符降低一個半音',
      'notes.editTimeBackTip': '將選取的音符往前移動',
      'notes.editTimeFwdTip': '將選取的音符往後移動',
      'notes.editSplitTip': '在目前播放位置分割選取的音符',
      'notes.editDeleteTip': '刪除選取的音符',
```

In the `'en'` block, after `'notes.editTip'`:

```js
      'notes.editOctUpTip': 'Shift the selected note up an octave',
      'notes.editOctDownTip': 'Shift the selected note down an octave',
      'notes.editPitchUpTip': 'Shift the selected note up a semitone',
      'notes.editPitchDownTip': 'Shift the selected note down a semitone',
      'notes.editTimeBackTip': 'Nudge the selected note earlier',
      'notes.editTimeFwdTip': 'Nudge the selected note later',
      'notes.editSplitTip': 'Split the selected note at the current playhead',
      'notes.editDeleteTip': 'Delete the selected note',
```

- [ ] **Step 2: CSS for the toolbar**

In `styles.css`, after `.notes-adv[open] summary { margin-bottom: 6px; }`:

```css
/* ---- note editing (layer 4) ---- */
.note-toolbar {
  grid-column: 1 / -1;
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
  margin-top: 6px;
}
.note-tbtn { font: 11px var(--mono); }
.note-tbtn:disabled { opacity: .4; cursor: default; }
.note-tbtn-danger { border-color: color-mix(in srgb, #ff6b81 45%, var(--line)); color: #ff9aa8; }
```

- [ ] **Step 3: Build the toolbar in `buildUI()`**

`buildUI()` currently constructs the zoom lane and ends:

```js
    const zSpacer = document.createElement('div');
    const zGrip = document.createElement('div');
    zGrip.className = 'ribbon-grip';
    zGrip.title = tr('notes.resizeTip');
    attachResize(zGrip, () => zoomHeight, (v) => { zoomHeight = v; }, ZOOM_H_KEY);
    zLane.append(zName, zCanvas, zSpacer, zGrip);
    el.lanes.insertBefore(zLane, lane);
    attachZoom(zCanvas);
    zoomEl = { lane: zLane, canvas: zCanvas, out: zOut };
    zLane.hidden = true;
```

Insert the toolbar between `zCanvas` and `zSpacer`, and build `zoomToolbar`:

```js
    const zSpacer = document.createElement('div');
    const zGrip = document.createElement('div');
    zGrip.className = 'ribbon-grip';
    zGrip.title = tr('notes.resizeTip');
    attachResize(zGrip, () => zoomHeight, (v) => { zoomHeight = v; }, ZOOM_H_KEY);

    /* The edit toolbar. Hidden while edit mode is off (see the 'sansbass:editmode' listener);
     * each button disabled until a note is selected, except "+ Add note" which needs no
     * selection at all. */
    const zToolbar = document.createElement('div');
    zToolbar.className = 'note-toolbar';
    zToolbar.hidden = !editMode;

    const mkEditBtn = (label, titleKey, fn) => {
      const b = document.createElement('button');
      b.className = 'mini note-tbtn';
      b.type = 'button';
      b.textContent = label;
      b.title = tr(titleKey);
      b.disabled = true;
      b.addEventListener('click', fn);
      return b;
    };

    const octUp = mkEditBtn('↑ 8ve', 'notes.editOctUpTip', () => editOctave(1));
    const octDown = mkEditBtn('↓ 8ve', 'notes.editOctDownTip', () => editOctave(-1));
    const pitchUp = mkEditBtn('♯', 'notes.editPitchUpTip', () => editPitchNudge(1));
    const pitchDown = mkEditBtn('♭', 'notes.editPitchDownTip', () => editPitchNudge(-1));
    const timeBack = mkEditBtn('◄t', 'notes.editTimeBackTip', () => editTimeNudge(-1));
    const timeFwd = mkEditBtn('▶t', 'notes.editTimeFwdTip', () => editTimeNudge(1));
    const split = mkEditBtn('✂', 'notes.editSplitTip', editSplit);
    const del = mkEditBtn('✕', 'notes.editDeleteTip', editDeleteNote);
    del.classList.add('note-tbtn-danger');

    zToolbar.append(octUp, octDown, pitchUp, pitchDown, timeBack, timeFwd, split, del);
    zoomToolbar = { root: zToolbar, octUp, octDown, pitchUp, pitchDown, timeBack, timeFwd, split, del };

    zLane.append(zName, zCanvas, zToolbar, zSpacer, zGrip);
    el.lanes.insertBefore(zLane, lane);
    attachZoom(zCanvas);
    zoomEl = { lane: zLane, canvas: zCanvas, out: zOut };
    zLane.hidden = true;
```

- [ ] **Step 4: The action handlers**

Add these functions near `noteAt` (Task 3):

```js
function dispatchEdit(edits) {
  window.dispatchEvent(new CustomEvent('sansbass:noteedit', { detail: { edits } }));
}

function editOctave(dir) {
  if (!selectedNote) return;
  dispatchEdit([{ type: 'octave', at: selectedNote.at, dir }]);
  // start/end unchanged by an octave move — the anchor stays valid as-is.
}

function editPitchNudge(semitones) {
  if (!selectedNote) return;
  dispatchEdit([{ type: 'pitchNudge', at: selectedNote.at, semitones }]);
}

const TIME_NUDGE_STEP = 0.1;   // seconds

function editTimeNudge(dir) {
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at);
  if (!n) return;
  const d = TIME_NUDGE_STEP * dir;
  dispatchEdit([{ type: 'timeAdjust', at: selectedNote.at, dStart: d, dEnd: d }]);
  selectedNote = { at: selectedNote.at + d };
}

function editDeleteNote() {
  if (!selectedNote) return;
  dispatchEdit([{ type: 'delete', at: selectedNote.at }]);
  selectedNote = null;
}

/* Splitting at the playhead composes from two primitives, or one at either edge — see "The
 * one thing to understand before starting" and the design spec's "Six edit types, not
 * seven". 5ms keeps the two pieces unambiguously separate rather than zero-gap touching
 * notes, the same ambiguity docs/transcription.md flags in the portamento analysis. */
const SPLIT_GAP = 0.005;

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

- [ ] **Step 5: Keep the toolbar's enabled state in sync**

`draw()` currently ends:

```js
    zoomEl.out.textContent = `${zoomSeconds.toFixed(zoomSeconds < 10 ? 1 : 0)}s`;
  }
  el.tCur.textContent = fmt(t);
}
```

Add a call to a new `syncEditToolbar()` right after the zoom block:

```js
    zoomEl.out.textContent = `${zoomSeconds.toFixed(zoomSeconds < 10 ? 1 : 0)}s`;
  }
  if (editMode) syncEditToolbar();
  el.tCur.textContent = fmt(t);
}

/** Keeps the toolbar's enabled state in sync with the current selection. Called from draw(),
 *  so no handler needs to call it by hand — every edit round-trips through notes.js and back
 *  into setNotes(), which calls draw(). Also clears a selection whose note is gone. */
function syncEditToolbar() {
  if (!zoomToolbar) return;
  const sel = ribbon && selectedNote ? noteAt(ribbon.notes, selectedNote.at) : null;
  if (selectedNote && !sel) selectedNote = null;
  for (const b of [zoomToolbar.octUp, zoomToolbar.octDown, zoomToolbar.pitchUp,
                    zoomToolbar.pitchDown, zoomToolbar.timeBack, zoomToolbar.timeFwd,
                    zoomToolbar.split, zoomToolbar.del]) {
    b.disabled = !sel;
  }
}
```

- [ ] **Step 6: Verify by hand**

`./scripts/serve.sh`, load `stems/ng_kipin.zip`, **Find notes**, tick **Edit notes**, click a
note. All six buttons go enabled. Click **↑ 8ve**: the note jumps an octave and turns purple
(`NOTE_FILL.manual`), the outline follows it, and `#notes-count` is unchanged. Click **♯**:
it moves one semitone. Click **◀t**/**▶t**: it moves in time without changing duration. Seek
the playhead to a point inside the selected note and click **✂**: the note becomes two,
`#notes-count` goes up by one (or stays the same if the cut landed within 5ms of an edge —
try both). Click **✕**: the note disappears, `#notes-count` drops by one, and the toolbar
buttons go back to disabled. Click empty space to deselect: buttons disable again without
needing another click on a note.

Also verify via console that this dispatches through the same pipe Task 2 proved:
```js
document.querySelectorAll('.note-toolbar button')[0].disabled   // octUp — true with nothing selected
```

- [ ] **Step 7: Commit**

```bash
git add app.js lib/i18n.js styles.css
git commit -m "Notes: edit toolbar — octave, pitch-nudge, time-nudge, split, delete"
```

---

## Task 5: Drag to move and resize a note

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Drag state and a pixel-tolerance helper**

Add to the module state, alongside `editMode`/`selectedNote` (Task 3):

```js
let noteDrag = null;   // { mode: 'move'|'resize-start'|'resize-end', note, startT, origStart, origEnd, previewStart, previewEnd }
```

Add near `zoomTimeAt`:

```js
const EDGE_PX = 8;   // how close a pointer must be to a note's edge to grab it for resize

/** How many seconds correspond to EDGE_PX at the zoomed pane's current width and window. */
function zoomEdgeToleranceSeconds(canvas) {
  const win = window.SansRibbon.zoomWindow(zoomCenter, zoomSeconds, duration || 1);
  const r = canvas.getBoundingClientRect();
  return (EDGE_PX / (r.width || 1)) * (win.to - win.from);
}
```

- [ ] **Step 2: Start a drag from the selected note's body or edge**

`attachZoom`'s `pointerdown` listener (from Task 3) currently reads:

```js
  canvas.addEventListener('pointerdown', (e) => {
    if (editMode && ribbon) {
      const t = zoomTimeAt(canvas, e.clientX);
      const hit = noteAt(ribbon.notes, t);
      if (hit) {
        selectedNote = { at: (hit.start + hit.end) / 2 };
        draw();
        return;   // selecting a note is the gesture; it does not also start a pan/seek
      }
    }
    panning = true;
    travelled = 0;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
```

Check the already-SELECTED note's body/edges first — a drag manipulates what is already
selected; clicking a different note (still) just (re)selects it, one interaction at a time:

```js
  canvas.addEventListener('pointerdown', (e) => {
    if (editMode && ribbon) {
      const t = zoomTimeAt(canvas, e.clientX);
      const sel = selectedNote ? noteAt(ribbon.notes, selectedNote.at) : null;
      if (sel) {
        const tol = zoomEdgeToleranceSeconds(canvas);
        let mode = null;
        if (Math.abs(t - sel.start) <= tol) mode = 'resize-start';
        else if (Math.abs(t - sel.end) <= tol) mode = 'resize-end';
        else if (sel.start <= t && t < sel.end) mode = 'move';
        if (mode) {
          noteDrag = { mode, note: sel, startT: t, origStart: sel.start, origEnd: sel.end,
                       previewStart: sel.start, previewEnd: sel.end };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
      const hit = noteAt(ribbon.notes, t);
      if (hit) {
        selectedNote = { at: (hit.start + hit.end) / 2 };
        draw();
        return;
      }
    }
    panning = true;
    travelled = 0;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
```

- [ ] **Step 3: Track the drag and commit on release**

`attachZoom`'s `pointermove` and `pointerup`/`pointercancel` currently read:

```js
  canvas.addEventListener('pointermove', (e) => {
    if (!panning) return;
    const r = canvas.getBoundingClientRect();
    travelled += Math.abs(e.clientX - lastX);
    zoomCenter -= ((e.clientX - lastX) / r.width) * zoomSeconds;
    lastX = e.clientX;
    draw();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!panning) return;
    panning = false;
    if (travelled <= DRAG_SLOP) seek(zoomTimeAt(canvas, e.clientX));
  });
  canvas.addEventListener('pointercancel', () => { panning = false; });
```

Change to check `noteDrag` first in each:

```js
  canvas.addEventListener('pointermove', (e) => {
    if (noteDrag) {
      const dt = zoomTimeAt(canvas, e.clientX) - noteDrag.startT;
      let newStart = noteDrag.origStart + (noteDrag.mode === 'resize-end' ? 0 : dt);
      let newEnd = noteDrag.origEnd + (noteDrag.mode === 'resize-start' ? 0 : dt);
      const MIN_DUR = 0.02;   // the analysis frame hop floor — see docs/transcription.md
      if (newEnd - newStart < MIN_DUR) {
        if (noteDrag.mode === 'resize-start') newStart = newEnd - MIN_DUR;
        else if (noteDrag.mode === 'resize-end') newEnd = newStart + MIN_DUR;
      }
      noteDrag.previewStart = newStart;
      noteDrag.previewEnd = newEnd;
      draw();
      return;
    }
    if (!panning) return;
    const r = canvas.getBoundingClientRect();
    travelled += Math.abs(e.clientX - lastX);
    zoomCenter -= ((e.clientX - lastX) / r.width) * zoomSeconds;
    lastX = e.clientX;
    draw();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (noteDrag) {
      const { note, previewStart, previewEnd } = noteDrag;
      const dStart = previewStart - note.start;
      const dEnd = previewEnd - note.end;
      noteDrag = null;
      if (dStart !== 0 || dEnd !== 0) {
        dispatchEdit([{ type: 'timeAdjust', at: (note.start + note.end) / 2, dStart, dEnd }]);
        selectedNote = { at: (previewStart + previewEnd) / 2 };
      }
      draw();
      return;
    }
    if (!panning) return;
    panning = false;
    if (travelled <= DRAG_SLOP) seek(zoomTimeAt(canvas, e.clientX));
  });
  canvas.addEventListener('pointercancel', () => { noteDrag = null; panning = false; });
```

- [ ] **Step 4: Draw the live preview and resize handles**

In `renderZoom`, the note loop needs to draw the note being dragged at its PREVIEW position,
not its committed one, and give the selected note visible edge handles. The loop currently
starts:

```js
  for (const n of notes) {
    if (n.end < win.from || n.start > win.to) continue;
    const out = n.midi < loM || n.midi > hiM;
    const by = out ? (n.midi < loM ? h - 3 : 0) : y(n.midi + 0.5);
    const bh = out ? 3 : Math.max(3, semi * 0.8);
    const bw = Math.max(2, x(n.end) - x(n.start));
```

Change it to substitute the live preview span when this is the note being dragged:

```js
  for (const n of notes) {
    const live = noteDrag && noteDrag.note === n
      ? { start: noteDrag.previewStart, end: noteDrag.previewEnd } : n;
    if (live.end < win.from || live.start > win.to) continue;
    const out = n.midi < loM || n.midi > hiM;
    const by = out ? (n.midi < loM ? h - 3 : 0) : y(n.midi + 0.5);
    const bh = out ? 3 : Math.max(3, semi * 0.8);
    const bw = Math.max(2, x(live.end) - x(live.start));
```

The rest of the loop body currently reads `x(n.start)` (fill rect, label, outline). Replace
every `x(n.start)`/`x(n.end)` inside this loop with `x(live.start)`/`x(live.end)` — there are
three occurrences: the `c.fillRect(x(n.start), by, bw, bh);` line, the
`c.fillText(noteLabel(n, ribbon.jianpu), x(n.start) + 3, ...)` line, and the outline's
`c.strokeRect(x(n.start) + 0.75, ...)` line. The outline's condition line also changes from
`n.start <= selectedNote.at && selectedNote.at < n.end` to `live.start <= selectedNote.at &&
selectedNote.at < live.end`.

Then extend the outline block to draw resize handles, right after the `strokeRect` call:

```js
    if (editMode && selectedNote && live.start <= selectedNote.at && selectedNote.at < live.end) {
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1.5;
      c.strokeRect(x(live.start) + 0.75, by + 0.75, Math.max(0.5, bw - 1.5), Math.max(0.5, bh - 1.5));
      // Small edge tabs — the visual affordance for the drag target pointerdown tests above.
      c.fillStyle = '#ffffff';
      const hw = 3;
      c.fillRect(x(live.start) - hw / 2, by, hw, bh);
      c.fillRect(x(live.end) - hw / 2, by, hw, bh);
    }
```

- [ ] **Step 5: Reset the drag if edit mode turns off mid-gesture**

The `sansbass:editmode` listener (Task 3) currently reads:

```js
window.addEventListener('sansbass:editmode', (e) => {
  editMode = e.detail.on;
  selectedNote = null;
  if (zoomToolbar) zoomToolbar.root.hidden = !editMode;
  if (zoomEl) { zoomEl.canvas.classList.toggle('editing', editMode); draw(); }
});
```

Add `noteDrag = null;`:

```js
window.addEventListener('sansbass:editmode', (e) => {
  editMode = e.detail.on;
  selectedNote = null;
  noteDrag = null;
  if (zoomToolbar) zoomToolbar.root.hidden = !editMode;
  if (zoomEl) { zoomEl.canvas.classList.toggle('editing', editMode); draw(); }
});
```

- [ ] **Step 6: Verify by hand**

Load a song, **Find notes**, tick **Edit notes**, select a note. Drag from the MIDDLE of the
note: it slides in time, both edges move together, duration unchanged; release — the note
commits at the new position and stays selected. Drag from within ~8px of its LEFT edge: only
the start moves (resize), the note gets shorter or longer without moving its end; same for
the right edge. Try shrinking a note to almost nothing: it stops at a 20ms floor rather than
inverting or vanishing. Drag a DIFFERENT, unselected note: the first click just selects it
(no drag starts on that same gesture) — press down again to actually drag it.

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "Notes: drag to move or resize the selected note"
```

---

## Task 6: Add a note — arm and drag

**Files:**
- Modify: `app.js`
- Modify: `lib/i18n.js`

- [ ] **Step 1: Strings, both locales**

`lib/i18n.js`, `'zh-TW'` block, after `'notes.editDeleteTip'`:

```js
      'notes.editAdd': '新增音符',
      'notes.editAddArmed': '拖曳以新增（點按取消）',
      'notes.editAddTip': '按下後在窗格中拖曳，以新增一個音符',
```

`'en'` block, after `'notes.editDeleteTip'`:

```js
      'notes.editAdd': 'Add note',
      'notes.editAddArmed': 'Drag to place (click to cancel)',
      'notes.editAddTip': 'Press, then drag in the pane to place a new note',
```

- [ ] **Step 2: The armed state and the button**

Add to the module state, with `noteDrag`:

```js
let addArmed = false;      // "+ Add note" pressed — the next drag places a note
let addDrag = null;        // { startT, midi, curT }
```

In `buildUI()`'s toolbar block (Task 4), add the button and include it in `zoomToolbar`.
The block currently reads:

```js
    const del = mkEditBtn('✕', 'notes.editDeleteTip', editDeleteNote);
    del.classList.add('note-tbtn-danger');

    zToolbar.append(octUp, octDown, pitchUp, pitchDown, timeBack, timeFwd, split, del);
    zoomToolbar = { root: zToolbar, octUp, octDown, pitchUp, pitchDown, timeBack, timeFwd, split, del };
```

Change to:

```js
    const del = mkEditBtn('✕', 'notes.editDeleteTip', editDeleteNote);
    del.classList.add('note-tbtn-danger');
    const addBtn = mkEditBtn('+ ' + tr('notes.editAdd'), 'notes.editAddTip', toggleAddArmed);
    addBtn.disabled = false;   // always available while edit mode is on, selection or not

    zToolbar.append(addBtn, octUp, octDown, pitchUp, pitchDown, timeBack, timeFwd, split, del);
    zoomToolbar = { root: zToolbar, add: addBtn, octUp, octDown, pitchUp, pitchDown, timeBack, timeFwd, split, del };
```

Add the handlers near `editSplit`:

```js
function toggleAddArmed() {
  addArmed = !addArmed;
  syncAddButton();
}

function syncAddButton() {
  if (!zoomToolbar) return;
  zoomToolbar.add.textContent = addArmed ? tr('notes.editAddArmed') : ('+ ' + tr('notes.editAdd'));
  zoomToolbar.add.classList.toggle('note-tbtn-armed', addArmed);
}
```

Add the armed style to `styles.css`, after `.note-tbtn-danger`:

```css
.note-tbtn-armed { border-color: var(--loop); color: var(--loop); }
```

- [ ] **Step 3: Map a pointer Y to a pitch**

Add near `zoomEdgeToleranceSeconds`:

```js
/** The zoomed pane's current pitch range, the same call renderZoom uses. */
function zoomPitchRangeNow() {
  if (!ribbon) return [48, 72];
  return window.SansRibbon.pitchRange(ribbon.notes, { clip: ribbon.clip !== false });
}

/** Client Y -> MIDI in the zoomed pane, the inverse of renderZoom's y(midi). */
function addMidiAt(canvas, clientY) {
  const [loM, hiM] = zoomPitchRangeNow();
  const r = canvas.getBoundingClientRect();
  const frac = (clientY - r.top) / (r.height || 1);
  const midi = Math.round(hiM - frac * (hiM - loM));
  return Math.max(loM, Math.min(hiM, midi));
}
```

- [ ] **Step 4: Drag-to-place, ahead of the existing edit-mode branch**

`attachZoom`'s `pointerdown` (Task 5) currently reads:

```js
  canvas.addEventListener('pointerdown', (e) => {
    if (editMode && ribbon) {
      const t = zoomTimeAt(canvas, e.clientX);
      const sel = selectedNote ? noteAt(ribbon.notes, selectedNote.at) : null;
      if (sel) {
        const tol = zoomEdgeToleranceSeconds(canvas);
        let mode = null;
        if (Math.abs(t - sel.start) <= tol) mode = 'resize-start';
        else if (Math.abs(t - sel.end) <= tol) mode = 'resize-end';
        else if (sel.start <= t && t < sel.end) mode = 'move';
        if (mode) {
          noteDrag = { mode, note: sel, startT: t, origStart: sel.start, origEnd: sel.end,
                       previewStart: sel.start, previewEnd: sel.end };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
      const hit = noteAt(ribbon.notes, t);
      if (hit) {
        selectedNote = { at: (hit.start + hit.end) / 2 };
        draw();
        return;
      }
    }
    panning = true;
    travelled = 0;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
```

Add the armed check as the FIRST thing inside the `if (editMode && ribbon)` block, before
the note-hit-testing — everything from `const t = zoomTimeAt(...)` onward is otherwise
unchanged from Task 5, just shifted down:

```js
  canvas.addEventListener('pointerdown', (e) => {
    if (editMode && ribbon) {
      if (addArmed) {
        const t = zoomTimeAt(canvas, e.clientX);
        addDrag = { startT: t, curT: t, midi: addMidiAt(canvas, e.clientY) };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      const t = zoomTimeAt(canvas, e.clientX);
      const sel = selectedNote ? noteAt(ribbon.notes, selectedNote.at) : null;
      if (sel) {
        const tol = zoomEdgeToleranceSeconds(canvas);
        let mode = null;
        if (Math.abs(t - sel.start) <= tol) mode = 'resize-start';
        else if (Math.abs(t - sel.end) <= tol) mode = 'resize-end';
        else if (sel.start <= t && t < sel.end) mode = 'move';
        if (mode) {
          noteDrag = { mode, note: sel, startT: t, origStart: sel.start, origEnd: sel.end,
                       previewStart: sel.start, previewEnd: sel.end };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
      const hit = noteAt(ribbon.notes, t);
      if (hit) {
        selectedNote = { at: (hit.start + hit.end) / 2 };
        draw();
        return;
      }
    }
    panning = true;
    travelled = 0;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
```

`pointermove` and `pointerup` (Task 5) start by checking `noteDrag`. Add the `addDrag` check
as the first thing in each, before that check — everything from `if (noteDrag) {` onward is
otherwise unchanged from Task 5:

```js
  canvas.addEventListener('pointermove', (e) => {
    if (addDrag) { addDrag.curT = zoomTimeAt(canvas, e.clientX); draw(); return; }
    if (noteDrag) {
      const dt = zoomTimeAt(canvas, e.clientX) - noteDrag.startT;
      let newStart = noteDrag.origStart + (noteDrag.mode === 'resize-end' ? 0 : dt);
      let newEnd = noteDrag.origEnd + (noteDrag.mode === 'resize-start' ? 0 : dt);
      const MIN_DUR = 0.02;   // the analysis frame hop floor — see docs/transcription.md
      if (newEnd - newStart < MIN_DUR) {
        if (noteDrag.mode === 'resize-start') newStart = newEnd - MIN_DUR;
        else if (noteDrag.mode === 'resize-end') newEnd = newStart + MIN_DUR;
      }
      noteDrag.previewStart = newStart;
      noteDrag.previewEnd = newEnd;
      draw();
      return;
    }
    if (!panning) return;
    const r = canvas.getBoundingClientRect();
    travelled += Math.abs(e.clientX - lastX);
    zoomCenter -= ((e.clientX - lastX) / r.width) * zoomSeconds;
    lastX = e.clientX;
    draw();
  });
```

```js
  canvas.addEventListener('pointerup', (e) => {
    if (addDrag) {
      const start = Math.min(addDrag.startT, addDrag.curT);
      const end = Math.max(addDrag.startT, addDrag.curT);
      const MIN_DUR = 0.02;
      const finalEnd = end - start < MIN_DUR ? start + MIN_DUR : end;
      const midi = addDrag.midi;
      addDrag = null;
      addArmed = false;
      syncAddButton();
      dispatchEdit([{ type: 'add', start: +start.toFixed(4), end: +finalEnd.toFixed(4), midi }]);
      selectedNote = { at: (start + finalEnd) / 2 };
      draw();
      return;
    }
    if (noteDrag) {
      const { note, previewStart, previewEnd } = noteDrag;
      const dStart = previewStart - note.start;
      const dEnd = previewEnd - note.end;
      noteDrag = null;
      if (dStart !== 0 || dEnd !== 0) {
        dispatchEdit([{ type: 'timeAdjust', at: (note.start + note.end) / 2, dStart, dEnd }]);
        selectedNote = { at: (previewStart + previewEnd) / 2 };
      }
      draw();
      return;
    }
    if (!panning) return;
    panning = false;
    if (travelled <= DRAG_SLOP) seek(zoomTimeAt(canvas, e.clientX));
  });
```

And `pointercancel`:

```js
  canvas.addEventListener('pointercancel', () => { addDrag = null; noteDrag = null; panning = false; });
```

- [ ] **Step 5: Draw the live placement preview**

In `renderZoom`, after the notes loop (Task 5's closing `}` of `for (const n of notes)`),
add:

```js
  if (addDrag) {
    const s = Math.min(addDrag.startT, addDrag.curT);
    const eT = Math.max(addDrag.startT, addDrag.curT);
    const by2 = y(addDrag.midi + 0.5);
    c.fillStyle = 'rgba(201,155,240,.5)';
    c.fillRect(x(s), by2, Math.max(2, x(eT) - x(s)), Math.max(3, semi * 0.8));
  }
```

- [ ] **Step 6: Reset when edit mode turns off**

Extend the `sansbass:editmode` listener (Task 5) once more:

```js
window.addEventListener('sansbass:editmode', (e) => {
  editMode = e.detail.on;
  selectedNote = null;
  noteDrag = null;
  addArmed = false;
  addDrag = null;
  if (zoomToolbar) zoomToolbar.root.hidden = !editMode;
  if (zoomEl) { zoomEl.canvas.classList.toggle('editing', editMode); draw(); }
});
```

- [ ] **Step 7: Verify by hand**

Tick **Edit notes**, click **+ Add note** — its label changes to "Drag to place" and it
turns orange. Drag anywhere in the pane, in a gap between existing notes: a translucent
purple preview follows the drag. Release: a real note appears there in solid purple
(`NOTE_FILL.manual`), `#notes-count` goes up by one, the new note is selected, and the button
returns to "+ Add note". Click **+ Add note** and then click it again without dragging: it
disarms without placing anything.

- [ ] **Step 8: Commit**

```bash
git add app.js lib/i18n.js styles.css
git commit -m "Notes: add a note by arming placement and dragging"
```

---

## Task 7: Range-select and delete

**Files:**
- Modify: `app.js`
- Modify: `lib/i18n.js`

- [ ] **Step 1: Strings, both locales**

`lib/i18n.js`, `'zh-TW'` block, after `'notes.editAddTip'`:

```js
      'notes.editRangeDelete': '刪除範圍',
      'notes.editRangeDeleteTip': '刪除選取範圍內的所有音符',
      'notes.rangeTip': '在下方拖曳以選取一段時間範圍',
```

`'en'` block, after `'notes.editAddTip'`:

```js
      'notes.editRangeDelete': 'Delete range',
      'notes.editRangeDeleteTip': 'Delete every note inside the selected range',
      'notes.rangeTip': 'Drag along the bottom to select a time range',
```

- [ ] **Step 2: State and the button**

Add to the module state, with `addDrag`:

```js
let rangeDrag = null;        // { startT, curT } — actively dragging
let rangeSelection = null;   // { from, to } — committed, awaiting the delete button
const RULER_BAND_PX = 16;    // bottom band of the zoomed canvas reserved for range-select
```

`buildUI()`'s toolbar block (Task 6) ends:

```js
    zToolbar.append(addBtn, octUp, octDown, pitchUp, pitchDown, timeBack, timeFwd, split, del);
    zoomToolbar = { root: zToolbar, add: addBtn, octUp, octDown, pitchUp, pitchDown, timeBack, timeFwd, split, del };
```

Add the range-delete button:

```js
    const rangeDel = mkEditBtn(tr('notes.editRangeDelete'), 'notes.editRangeDeleteTip', editRangeDelete);
    rangeDel.classList.add('note-tbtn-danger');

    zToolbar.append(addBtn, octUp, octDown, pitchUp, pitchDown, timeBack, timeFwd, split, del, rangeDel);
    zoomToolbar = { root: zToolbar, add: addBtn, octUp, octDown, pitchUp, pitchDown, timeBack, timeFwd,
                     split, del, rangeDel };
```

`zCanvas.title` currently reads `zCanvas.title = tr('notes.zoomTip');` — leave it as-is;
Step 3 gives the ruler band its own affordance via the cursor instead.

- [ ] **Step 3: Drag on the bottom band**

`attachZoom`'s `pointerdown` (Task 6) has, as the first line of the `if (editMode && ribbon)`
block, the `addArmed` check. Add the range-band check right after it, still inside that same
`if`:

```js
  canvas.addEventListener('pointerdown', (e) => {
    if (editMode && ribbon) {
      if (addArmed) {
        const t = zoomTimeAt(canvas, e.clientX);
        addDrag = { startT: t, curT: t, midi: addMidiAt(canvas, e.clientY) };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      const r = canvas.getBoundingClientRect();
      if (e.clientY - r.top > r.height - RULER_BAND_PX) {
        const t = zoomTimeAt(canvas, e.clientX);
        rangeDrag = { startT: t, curT: t };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      const t = zoomTimeAt(canvas, e.clientX);
      const sel = selectedNote ? noteAt(ribbon.notes, selectedNote.at) : null;
      if (sel) {
        const tol = zoomEdgeToleranceSeconds(canvas);
        let mode = null;
        if (Math.abs(t - sel.start) <= tol) mode = 'resize-start';
        else if (Math.abs(t - sel.end) <= tol) mode = 'resize-end';
        else if (sel.start <= t && t < sel.end) mode = 'move';
        if (mode) {
          noteDrag = { mode, note: sel, startT: t, origStart: sel.start, origEnd: sel.end,
                       previewStart: sel.start, previewEnd: sel.end };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
      const hit = noteAt(ribbon.notes, t);
      if (hit) {
        selectedNote = { at: (hit.start + hit.end) / 2 };
        draw();
        return;
      }
    }
    panning = true;
    travelled = 0;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
```

`pointermove` (Task 6) starts by checking `addDrag`. Add the `rangeDrag` check right after —
everything from `if (noteDrag) {` onward is otherwise unchanged from Task 6:

```js
  canvas.addEventListener('pointermove', (e) => {
    if (addDrag) { addDrag.curT = zoomTimeAt(canvas, e.clientX); draw(); return; }
    if (rangeDrag) { rangeDrag.curT = zoomTimeAt(canvas, e.clientX); draw(); return; }
    if (noteDrag) {
      const dt = zoomTimeAt(canvas, e.clientX) - noteDrag.startT;
      let newStart = noteDrag.origStart + (noteDrag.mode === 'resize-end' ? 0 : dt);
      let newEnd = noteDrag.origEnd + (noteDrag.mode === 'resize-start' ? 0 : dt);
      const MIN_DUR = 0.02;   // the analysis frame hop floor — see docs/transcription.md
      if (newEnd - newStart < MIN_DUR) {
        if (noteDrag.mode === 'resize-start') newStart = newEnd - MIN_DUR;
        else if (noteDrag.mode === 'resize-end') newEnd = newStart + MIN_DUR;
      }
      noteDrag.previewStart = newStart;
      noteDrag.previewEnd = newEnd;
      draw();
      return;
    }
    if (!panning) return;
    const r = canvas.getBoundingClientRect();
    travelled += Math.abs(e.clientX - lastX);
    zoomCenter -= ((e.clientX - lastX) / r.width) * zoomSeconds;
    lastX = e.clientX;
    draw();
  });
```

`pointerup` (Task 6) checks `addDrag` first. Add `rangeDrag` right after that block —
everything from `if (noteDrag) {` onward is otherwise unchanged from Task 6:

```js
  canvas.addEventListener('pointerup', (e) => {
    if (addDrag) {
      const start = Math.min(addDrag.startT, addDrag.curT);
      const end = Math.max(addDrag.startT, addDrag.curT);
      const MIN_DUR = 0.02;
      const finalEnd = end - start < MIN_DUR ? start + MIN_DUR : end;
      const midi = addDrag.midi;
      addDrag = null;
      addArmed = false;
      syncAddButton();
      dispatchEdit([{ type: 'add', start: +start.toFixed(4), end: +finalEnd.toFixed(4), midi }]);
      selectedNote = { at: (start + finalEnd) / 2 };
      draw();
      return;
    }
    if (rangeDrag) {
      const from = Math.min(rangeDrag.startT, rangeDrag.curT);
      const to = Math.max(rangeDrag.startT, rangeDrag.curT);
      rangeDrag = null;
      rangeSelection = (to - from > 0.01) ? { from, to } : null;
      draw();
      return;
    }
    if (noteDrag) {
      const { note, previewStart, previewEnd } = noteDrag;
      const dStart = previewStart - note.start;
      const dEnd = previewEnd - note.end;
      noteDrag = null;
      if (dStart !== 0 || dEnd !== 0) {
        dispatchEdit([{ type: 'timeAdjust', at: (note.start + note.end) / 2, dStart, dEnd }]);
        selectedNote = { at: (previewStart + previewEnd) / 2 };
      }
      draw();
      return;
    }
    if (!panning) return;
    panning = false;
    if (travelled <= DRAG_SLOP) seek(zoomTimeAt(canvas, e.clientX));
  });
```

`pointercancel`:

```js
  canvas.addEventListener('pointercancel', () => {
    addDrag = null; rangeDrag = null; noteDrag = null; panning = false;
  });
```

- [ ] **Step 4: The delete-range action**

Add near `editDeleteNote`:

```js
function editRangeDelete() {
  if (!rangeSelection) return;
  dispatchEdit([{ type: 'rangeDelete', from: rangeSelection.from, to: rangeSelection.to }]);
  rangeSelection = null;
}
```

`syncEditToolbar()` (Task 4) currently disables the fixed list of note-targeted buttons.
Add the range-delete button, gated on `rangeSelection` instead of `sel`:

```js
function syncEditToolbar() {
  if (!zoomToolbar) return;
  const sel = ribbon && selectedNote ? noteAt(ribbon.notes, selectedNote.at) : null;
  if (selectedNote && !sel) selectedNote = null;
  for (const b of [zoomToolbar.octUp, zoomToolbar.octDown, zoomToolbar.pitchUp,
                    zoomToolbar.pitchDown, zoomToolbar.timeBack, zoomToolbar.timeFwd,
                    zoomToolbar.split, zoomToolbar.del]) {
    b.disabled = !sel;
  }
  zoomToolbar.rangeDel.disabled = !rangeSelection;
}
```

- [ ] **Step 5: Draw the range highlight**

In `renderZoom`, right after `c.fillRect(0, 0, w, h);` (the pane's background fill, near the
top of the function, before the vocal envelope), add:

```js
  const rsel = rangeDrag || rangeSelection;
  if (rsel) {
    const s = Math.min(rsel.startT ?? rsel.from, rsel.curT ?? rsel.to);
    const eT = Math.max(rsel.startT ?? rsel.from, rsel.curT ?? rsel.to);
    c.fillStyle = 'rgba(255,209,102,.18)';
    c.fillRect(x(s), 0, Math.max(1, x(eT) - x(s)), h);
  }
```

- [ ] **Step 6: Reset when edit mode turns off**

Extend the `sansbass:editmode` listener (Task 6) once more:

```js
window.addEventListener('sansbass:editmode', (e) => {
  editMode = e.detail.on;
  selectedNote = null;
  noteDrag = null;
  addArmed = false;
  addDrag = null;
  rangeDrag = null;
  rangeSelection = null;
  if (zoomToolbar) zoomToolbar.root.hidden = !editMode;
  if (zoomEl) { zoomEl.canvas.classList.toggle('editing', editMode); draw(); }
});
```

- [ ] **Step 7: Verify by hand**

Tick **Edit notes**. Drag along the bottom ~16px strip of the zoomed pane: a translucent
amber band highlights the dragged range and **Delete range** enables. Click it: every note
that overlapped the band is gone, `#notes-count` drops accordingly, and the band disappears.
Drag a tiny span (under ~10ms): no selection is made and the button stays disabled. Confirm
dragging the SAME bottom strip still works even directly under a note block — the band takes
priority over note selection there, by design.

- [ ] **Step 8: Commit**

```bash
git add app.js lib/i18n.js
git commit -m "Notes: range-select and delete along the zoomed pane's bottom band"
```

---

## Task 8: Edit list, undo, and keyboard shortcuts

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `lib/i18n.js`
- Modify: `notes.js`
- Modify: `app.js`

- [ ] **Step 1: The panel markup**

In `index.html`, after the closing `</div>` of `#notes-tune` (right before `</section>` that
closes `#notes`):

```html
      <div id="notes-edits" class="notes-row notes-edit-list" hidden>
        <button id="notes-edit-undo" class="mini" type="button" disabled
                data-i18n-attr="title:notes.editUndoTip">&#8630;</button>
        <ol id="notes-edit-rows" class="edit-rows"></ol>
      </div>
```

- [ ] **Step 2: Strings, both locales**

`lib/i18n.js`, `'zh-TW'` block, after `'notes.rangeTip'`:

```js
      'notes.editUndoTip': '復原上一個編輯',
      'notes.editRemoveTip': '移除此項編輯',
      'notes.editOrphanTip': '找不到這項編輯原本對應的音符（可能已被其他編輯移除）',
      'notes.editOctaveUp': '升八度',
      'notes.editOctaveDown': '降八度',
      'notes.editPitchUp': '升半音',
      'notes.editPitchDown': '降半音',
      'notes.editTimeAdjustLabel': '調整時間',
      'notes.editDeleteLabel': '刪除',
      'notes.editAddLabel': '新增',
      'notes.editRangeDeleteLabel': '刪除範圍',
      'notes.editSplitLabel': '分割',
```

`'en'` block, after `'notes.rangeTip'`:

```js
      'notes.editUndoTip': 'Undo the last edit',
      'notes.editRemoveTip': 'Remove this edit',
      'notes.editOrphanTip': "This edit's original note can't be found (likely removed by another edit)",
      'notes.editOctaveUp': 'Octave up',
      'notes.editOctaveDown': 'Octave down',
      'notes.editPitchUp': 'Pitch up',
      'notes.editPitchDown': 'Pitch down',
      'notes.editTimeAdjustLabel': 'Time adjust',
      'notes.editDeleteLabel': 'Delete',
      'notes.editAddLabel': 'Add',
      'notes.editRangeDeleteLabel': 'Range delete',
      'notes.editSplitLabel': 'Split',
```

- [ ] **Step 3: CSS**

In `styles.css`, after `.note-tbtn-armed { ... }` (Task 6):

```css
.notes-edit-list { align-items: flex-start; gap: 8px; }
.edit-rows {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 3px;
  font: 11px var(--mono); color: var(--dim);
}
.edit-row { display: flex; align-items: center; gap: 6px; }
.edit-warn { color: var(--loop); }
.edit-remove { font-size: 9px; padding: 1px 5px; }
```

- [ ] **Step 4: Render the list in `notes.js`**

Add to the `el` object, after `edit: document.getElementById('notes-edit'),`:

```js
  editsRow: document.getElementById('notes-edits'),
  editUndo: document.getElementById('notes-edit-undo'),
  editRows: document.getElementById('notes-edit-rows'),
```

Add these functions near `syncFoldControls`:

```js
function editTypeLabel(edit) {
  const KEYS = {
    octave: edit.dir > 0 ? 'notes.editOctaveUp' : 'notes.editOctaveDown',
    pitchNudge: edit.semitones > 0 ? 'notes.editPitchUp' : 'notes.editPitchDown',
    timeAdjust: 'notes.editTimeAdjustLabel',
    delete: 'notes.editDeleteLabel',
    add: 'notes.editAddLabel',
    rangeDelete: 'notes.editRangeDeleteLabel',
  };
  return tr(KEYS[edit.type]);
}

function groupLabel(group) {
  return group.edits.length > 1 ? tr('notes.editSplitLabel') : editTypeLabel(group.edits[0]);
}

function groupTimeLabel(group) {
  const e = group.edits[0];
  if (e.type === 'rangeDelete') return `${e.from.toFixed(2)}–${e.to.toFixed(2)}s`;
  if (e.type === 'add') return `${e.start.toFixed(2)}s`;
  return `${e.at.toFixed(2)}s`;
}

/** Rebuilds the edit-list panel from editGroups/orphaned. Called at the end of reinterpret()
 *  and from reset(). Every node is built and textContent-assigned, never innerHTML — the
 *  same rule every other dynamic list in this file follows. */
function renderEditList() {
  el.editsRow.hidden = editGroups.length === 0;
  el.editUndo.disabled = editGroups.length === 0;
  el.editRows.replaceChildren(...editGroups.map((g) => {
    const li = document.createElement('li');
    li.className = 'edit-row';
    if (g.edits.some((e) => orphaned.includes(e))) {
      const warn = document.createElement('span');
      warn.className = 'edit-warn';
      warn.textContent = '⚠';
      warn.title = tr('notes.editOrphanTip');
      li.appendChild(warn);
    }
    const label = document.createElement('span');
    label.textContent = `${groupLabel(g)} · ${groupTimeLabel(g)}`;
    li.appendChild(label);
    const rm = document.createElement('button');
    rm.className = 'mini edit-remove';
    rm.type = 'button';
    rm.textContent = '✕';
    rm.title = tr('notes.editRemoveTip');
    rm.addEventListener('click', () => {
      editGroups = editGroups.filter((x) => x.id !== g.id);
      reinterpret();
    });
    li.appendChild(rm);
    return li;
  }));
}
```

Call it at the end of `reinterpret()` — the function currently ends with `resync();`:

```js
  window.sansBass.setNotes({
    notes, frames, params: p, clip: el.clip.checked,
    jianpu: { on: jianpu.on, tonic: jianpu.tonic, mode: jianpu.mode },
  });
  resync();
  renderEditList();
}
```

Call it from `reset()` too — the block from Task 3 becomes:

```js
  jianpu.auto = true;
  editGroups = [];
  orphaned = [];
  el.edit.disabled = true;
  el.edit.checked = false;
  renderEditList();
  syncJianpuControls();
}
```

Add the undo button's handler and the keyboard-shortcut event listener, near the
`sansbass:noteedit` listener from Task 2:

```js
el.editUndo.addEventListener('click', () => {
  editGroups.pop();
  reinterpret();
});

window.addEventListener('sansbass:editundo', () => {
  editGroups.pop();
  reinterpret();
});
```

- [ ] **Step 5: Keyboard shortcuts in `app.js`**

The top-level `keydown` listener currently reads:

```js
document.addEventListener('keydown', (e) => {
  if (/input|select|textarea/i.test(e.target.tagName) && e.key !== ' ') return;
  if (!tracks.length) return;
  if (e.key === ' ') { e.preventDefault(); toggle(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(currentTime() - 5); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); seek(currentTime() + 5); }
  else if (e.key === '0') toggleAllTracks();
  else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); setLoopPoint('a'); }
  else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setLoopPoint('b'); }
  else if (e.key === 'c' || e.key === 'C' || e.key === 'Escape') { e.preventDefault(); clearLoop(); }
  else if (/^[1-9]$/.test(e.key)) {
    const t = tracks[parseInt(e.key, 10) - 1];
    if (t) toggleTrack(t);
  }
});
```

Add the edit-mode branches before the existing body, so a selected note's shortcuts take
priority over the transport's — and undo works whenever edit mode is on, selection or not:

```js
document.addEventListener('keydown', (e) => {
  if (/input|select|textarea/i.test(e.target.tagName) && e.key !== ' ') return;
  if (!tracks.length) return;
  if (editMode && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('sansbass:editundo'));
    return;
  }
  if (editMode && selectedNote) {
    if (e.key === 'ArrowUp') { e.preventDefault(); e.shiftKey ? editOctave(1) : editPitchNudge(1); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); e.shiftKey ? editOctave(-1) : editPitchNudge(-1); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); editTimeNudge(-1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); editTimeNudge(1); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); editDeleteNote(); return; }
  }
  if (e.key === ' ') { e.preventDefault(); toggle(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(currentTime() - 5); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); seek(currentTime() + 5); }
  else if (e.key === '0') toggleAllTracks();
  else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); setLoopPoint('a'); }
  else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setLoopPoint('b'); }
  else if (e.key === 'c' || e.key === 'C' || e.key === 'Escape') { e.preventDefault(); clearLoop(); }
  else if (/^[1-9]$/.test(e.key)) {
    const t = tracks[parseInt(e.key, 10) - 1];
    if (t) toggleTrack(t);
  }
});
```

- [ ] **Step 6: Verify by hand**

Tick **Edit notes**, select a note, click **↑ 8ve** via the toolbar twice, then delete
another note via `Backspace`. The edit list shows three rows in order (two "Octave up", one
"Delete"), each with a working ✕. Press Cmd/Ctrl+Z: the last row (Delete) disappears and the
deleted note comes back. Click the list's own ✕ on the first "Octave up" row: that specific
edit is removed and the note it targeted drops back an octave, while the second "Octave up"
(now orphaned, since its `at` was anchored to the note's post-first-shift position — verify
whether it still resolves or shows the warning glyph, and confirm either way the row updates
correctly rather than silently doing nothing). With a note selected, press ↑/↓ (pitch),
Shift+↑/↓ (octave), ←/→ (time), and confirm the toolbar and canvas update exactly as the
matching button clicks do. Click empty space to deselect, then press ←/→: the TRANSPORT seeks
by 5 seconds, confirming the shortcuts only intercept while a note is selected.

- [ ] **Step 7: Commit**

```bash
git add index.html styles.css lib/i18n.js notes.js app.js
git commit -m "Notes: edit-list panel, undo, and keyboard shortcuts"
```

---

## Task 9: Export and import

**Files:**
- Modify: `index.html`
- Modify: `lib/i18n.js`
- Modify: `notes.js`

- [ ] **Step 1: The buttons**

In `index.html`, after the `#notes-edits` row (Task 8), still inside `#notes`:

```html
      <div id="notes-io" class="notes-row">
        <button id="notes-export" class="mini" type="button" disabled data-i18n="notes.export">Export edits</button>
        <button id="notes-import" class="mini" type="button" disabled data-i18n="notes.import">Import edits</button>
        <input id="notes-import-file" type="file" accept="application/json,.json" hidden>
      </div>
```

- [ ] **Step 2: Strings, both locales**

`lib/i18n.js`, `'zh-TW'` block, after `'notes.editSplitLabel'`:

```js
      'notes.export': '匯出編輯',
      'notes.import': '匯入編輯',
      'notes.importFailed': '匯入失敗：{message}',
      'notes.importMismatch': '這個檔案看起來是給「{song}」用的，與目前載入的歌曲不同。',
```

`'en'` block, after `'notes.editSplitLabel'`:

```js
      'notes.export': 'Export edits',
      'notes.import': 'Import edits',
      'notes.importFailed': 'Import failed: {message}',
      'notes.importMismatch': 'This file looks like it was made for "{song}", not the song currently loaded.',
```

- [ ] **Step 3: Wire the elements and enable/disable them with everything else**

Add to the `el` object, after `importFile` isn't yet defined — add after `editRows`:

```js
  exportBtn: document.getElementById('notes-export'),
  importBtn: document.getElementById('notes-import'),
  importFile: document.getElementById('notes-import-file'),
```

`el.edit.disabled = false;` was added to the worker's success handler in Task 3 — extend
that same line:

```js
      el.show.hidden = false;
      el.edit.disabled = false;
      el.exportBtn.disabled = false;
      el.importBtn.disabled = false;
```

And `reset()`'s `el.edit.disabled = true; el.edit.checked = false;` (Task 3) similarly:

```js
  el.edit.disabled = true;
  el.edit.checked = false;
  el.exportBtn.disabled = true;
  el.importBtn.disabled = true;
```

- [ ] **Step 4: Export**

```js
el.exportBtn.addEventListener('click', () => {
  const mix = window.sansBass.currentMix ? window.sansBass.currentMix() : null;
  const payload = {
    version: 1,
    ...(mix ? { song: mix.name } : {}),
    interpreter: el.hmm.checked ? 'hmm-v1' : 'threshold-v1',
    params: {
      minDurationMs: Number(el.min.value),
      fold: el.fold.checked,
      confidentWithin: Number(el.foldTol.value),
    },
    clip: el.clip.checked,
    jianpu: { on: jianpu.on, tonic: jianpu.tonic, mode: jianpu.mode },
    edits: editGroups.map((g) => g.edits),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${mix ? mix.name : 'song'}-edits.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
});
```

- [ ] **Step 5: Import**

```js
el.importBtn.addEventListener('click', () => el.importFile.click());

/* Cleared after read, same reason app.js's #file-input does it: picking the same file twice
 * in a row must still fire change. */
el.importFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (err) {
    window.sansBass.say('notes.importFailed', { message: err.message }, true);
    return;
  }
  if (!data || data.version !== 1 || !Array.isArray(data.edits)) {
    window.sansBass.say('notes.importFailed', { message: 'not a note-edits file' }, true);
    return;
  }

  const mix = window.sansBass.currentMix ? window.sansBass.currentMix() : null;
  if (data.song && mix && data.song !== mix.name) {
    window.sansBass.say('notes.importMismatch', { song: data.song }, true);
  }

  if (data.params) {
    if (data.params.minDurationMs != null) el.min.value = data.params.minDurationMs;
    el.fold.checked = !!data.params.fold;
    if (data.params.confidentWithin != null) el.foldTol.value = data.params.confidentWithin;
  }
  el.hmm.checked = data.interpreter !== 'threshold-v1';
  el.clip.checked = data.clip !== false;
  if (data.jianpu) {
    jianpu.on = !!data.jianpu.on;
    jianpu.auto = false;
    jianpu.tonic = data.jianpu.tonic ?? 0;
    jianpu.mode = data.jianpu.mode || 'major';
    el.jianpu.checked = jianpu.on;
  }
  editGroups = data.edits.map((edits) => ({ id: nextEditId++, edits }));
  syncJianpuControls();
  reinterpret();
});
```

- [ ] **Step 6: Verify by hand**

Load `stems/ng_kipin.zip`, **Find notes**, tick **Edit notes**, make two or three edits
(an octave move, a delete, a split). Click **Export edits**: a `<song>-edits.json` file
downloads. Open it — it has `version`, `song`, `interpreter`, `params`, `clip`, `jianpu`, and
an `edits` array whose entries are themselves arrays (one element for most, two for the
split). Reload the page, load the SAME zip again, **Find notes** (do not make any edits by
hand), click **Import edits**, pick the downloaded file: `#notes-count`, the note colours,
and the edit list all match what they were before the reload. Load a DIFFERENT stems zip and
import the same file: the mismatch status message appears (visible via `#status`) but the
import still proceeds.

- [ ] **Step 7: Commit**

```bash
git add index.html lib/i18n.js notes.js
git commit -m "Notes: export and import the editing session as JSON"
```

---

## Task 10: Docs, version, and the PR

**Files:**
- Modify: `docs/transcription.md`, `docs/roadmap.md`, `docs/behaviour.md`, `docs/devlog.md`, `CLAUDE.md`
- Modify: `index.html`, `separate.js`, `separate.worker.js`, `notes.js`, `notes.worker.js`, `tests/notes.test.js`

- [ ] **Step 1: Update the transcription status table**

In `docs/transcription.md`, the status table's last row currently reads:

```
| edits | not built; the six intended actions are listed under Layer 4 | — |
```

Change it to:

```
| edits | built — `applyEdits()` over the note list | edit mode toggle + zoomed-pane toolbar; the six actions resolved to six edit types (`split` composes from two) — see the design spec |
```

- [ ] **Step 2: Update the roadmap**

In `docs/roadmap.md`, the "Note editing — layer 4" section currently starts:

```
**Design done** — [spec](superpowers/specs/2026-08-31-note-editing-design.md). Not yet built.
```

Change to:

```
**Built — v1.16.0.** [Spec](superpowers/specs/2026-08-31-note-editing-design.md),
[plan](superpowers/plans/2026-08-31-note-editing.md).
```

- [ ] **Step 3: Behaviour rows**

In `docs/behaviour.md`, add a new section after `## Notes lane` (before `## Saving stems`):

```markdown
## Note editing

`applyEdits()` (`lib/pitch.js`) runs after `interpret()`/`foldOctaves()` inside
`notes.js`'s `reinterpret()`. `app.js` owns the zoomed pane's selection, toolbar, and
pointer/keyboard interactions, and talks to `notes.js` through `sansbass:noteedit` /
`sansbass:editundo` / `sansbass:editmode` — the design is in
[`docs/superpowers/specs/2026-08-31-note-editing-design.md`](superpowers/specs/2026-08-31-note-editing-design.md).

| # | Expected | How to observe |
|---|---|---|
| E1 | **Edit notes** is disabled until a note detection run has completed, and resets (disabled, unticked) on a new song. | `#notes-edit.disabled` before/after **Find notes**; load a second zip and it is `disabled` and `unchecked` again. |
| E2 | Ticking it turns on note selection in the zoomed pane; clicking a note outlines it in white. Clicking empty space still seeks, exactly as before edit mode existed. | Tick, click a note block: outline appears. Click empty space: `#t-cur` changes, no outline appears anywhere. |
| E3 | The toolbar is hidden while edit mode is off, and every button but **+ Add note** is disabled until a note is selected. | `.note-toolbar.hidden` toggles with `#notes-edit.checked`; with it ticked and nothing selected, `.note-tbtn:not(.note-tbtn-armed)` (excluding Add) are all `disabled`. |
| E4 | **↑ 8ve** / **↓ 8ve** move the selected note a full octave and recolour it purple (`NOTE_FILL.manual`), without changing `#notes-count`. | Select a note, click, compare `midi` before/after via the outline's position; count unchanged. |
| E5 | **♯** / **♭** move the selected note one semitone, same recolouring rule. | As E4, one semitone of vertical movement instead of twelve. |
| E6 | **◀t** / **▶t** move the selected note in time without changing its duration. | `end - start` unchanged; both edges shift by the same amount. |
| E7 | Dragging the BODY of a selected note moves it in time; dragging within ~8px of an EDGE resizes just that edge. Neither ever shrinks a note below a 20ms floor. | Drag the middle: both edges move equally. Drag near the left edge: only `start` moves. Drag it past the floor: it stops at 20ms rather than crossing zero. |
| E8 | **✕** deletes the selected note, `#notes-count` drops by one, the toolbar disables. | Click it; compare counts; toolbar buttons `disabled` again. |
| E9 | **✂** splits the selected note at the current playhead position, composing a shrink plus a new note — unless the cut is within 5ms of either edge, in which case it only shrinks (no new note). | Seek inside a note, click ✂: count +1, two purple notes where one was. Seek within 5ms of an edge, click ✂: count unchanged, the note just moved that edge. |
| E10 | A split note can be split again — the tail piece is an ordinary note, not a special case. | Split once, select the new tail note, split it again: count +1 again. |
| E11 | **+ Add note** arms placement (its label and colour change); the next drag in the pane places a new purple note at the dragged span and pitch row, then disarms. Clicking it again without dragging cancels. | Arm, drag: preview follows the pointer, count +1 on release, button reverts. Arm, click without dragging: no note added, button reverts. |
| E12 | Dragging along the bottom ~16px of the zoomed pane selects a time range (amber highlight) and enables **Delete range**; clicking it removes every note overlapping that range. | Drag the band: highlight appears, button enables. Click it: count drops by however many notes overlapped, highlight clears. |
| E13 | The edit list shows one row per action (a split is ONE row, not two), each removable with its own ✕; removing one re-derives without it. | Make three edits including one split: three rows, not four. Remove the split row: both its underlying changes revert together. |
| E14 | An edit whose target no longer exists shows a warning glyph in the list rather than silently vanishing. | Edit a note, then delete that same note via a different edit: the first edit's row gains the warning glyph. |
| E15 | Cmd/Ctrl+Z undoes the most recent edit, list-order. The same button (↺) does the same thing. | Make two edits, press Cmd/Ctrl+Z once: only the second is undone. |
| E16 | With a note selected, ↑/↓ nudge pitch, Shift+↑/↓ shift octave, ←/→ nudge time, Delete/Backspace deletes — and these take priority over the transport's own arrow-key seek. | Select a note, press →: it moves in time, `#t-cur` does NOT jump by 5s. Deselect, press →: now it does. |
| E17 | **Export edits** downloads a JSON file with `version`, `params`, `clip`, `jianpu`, and `edits` (one array per list entry, two elements for a split); **Import edits** restores every control and the edit list from it, re-deriving the same note list. | Export, reload, re-load the same zip, re-run detection, import: `#notes-count` and the edit-list rows match. |
| E18 | Loading a new song clears the edit list and both toolbar/list panels, exactly as parameters and the 簡譜 key already reset. | Make an edit, load a second zip: `#notes-edits` is `hidden` again and empty. |
```

- [ ] **Step 4: Bump the asset version**

```bash
sed -i '' 's/?v=1\.15\.0/?v=1.16.0/g' index.html separate.js separate.worker.js notes.js notes.worker.js tests/notes.test.js
grep -rn '1\.15\.0' index.html separate.js separate.worker.js notes.js notes.worker.js   # expect none
```

Update `Currently \`v1.15.0\`.` in `CLAUDE.md` to `` Currently `v1.16.0`. ``. The per-file
counts (15/3/1/3/1 = 23) do not change — this feature adds markup and new functions, not a
new versioned asset.

- [ ] **Step 5: Verify the whole suite**

Reload `http://localhost:8777/tests/test.html`. Expected: **215/215 passed**, both
`versions:` tests included.

- [ ] **Step 6: Devlog**

```bash
git log -1 --format='%cd' --date=format:'%Y-%m-%d %H:%M'
```

Add a TL;DR row and a `v1.16.0` entry in the house format, newest-first, with an anchor link
and a **Design docs:** subsection pointing at the spec and this plan. Learnings worth
recording:

- `[insight]` **Split isn't a data-model primitive.** Working through the override format,
  cutting a note at a point turned out to be exactly a `timeAdjust` (shrink the original)
  plus an `add` (the new tail note) — never its own edit type. That also absorbed two edge
  cases for free: cutting within 5ms of either boundary just becomes a shrink, no `add`
  needed, with no special-casing required to see it.
- `[insight]` **Anchoring edits to a time point, not a note index, is what makes the layer
  survive re-interpretation at all.** `notes` is rebuilt from `frames` on every parameter
  tweak, so an index is meaningless the instant it's re-derived; `applyEdits` re-locates
  every edit's target fresh, every call, against whichever note currently spans that time —
  which is also what makes `rangeDelete` naturally re-evaluate against new notes rather than
  a stale snapshot, with no extra code.
- `[note]` A classic script and an ES module still cannot share scope, so the same
  `window.sansBass` + `CustomEvent` seam `separate.js` and the transport already used
  carried three more events (`sansbass:noteedit`, `sansbass:editundo`, `sansbass:editmode`)
  without needing a new pattern.
- `[gotcha]` A split (or any drag) produces one undo/list-display **group** covering one or
  two primitive edits — `lib/pitch.js`'s `applyEdits` only ever sees the flattened
  primitives. Popping or removing a group's second half alone would leave the first half's
  change standing with nothing in the list to explain it; grouping at the `notes.js` layer,
  above `applyEdits`, is what keeps undo matching what the user thinks they just did.

- [ ] **Step 7: Commit and open the PR**

```bash
git add -A -- lib/ app.js notes.js notes.worker.js index.html separate.js separate.worker.js styles.css CLAUDE.md docs/ tests/
git commit -m "Docs: v1.16.0 devlog, transcription status, asset version"
git push -u origin feat/note-editing
gh pr create --title "Note editing — Layer 4 (v1.16.0)" --body "$(cat <<'EOF'
## Summary

Lets a user hand-correct the detected note list from the zoomed pane: octave move,
semitone nudge, move/resize in time, split, add, delete, and range-delete — the six
actions `docs/transcription.md` catalogued as Layer 4, resolved to six edit types (not
seven — split composes from two of the others).

Edits are anchored to time points, never note indices, so they survive every later
re-interpretation (a `minDurationMs` drag, toggling the HMM interpreter, octave folding).
An edit whose target has since disappeared is surfaced as orphaned in the edit list rather
than silently dropped.

The whole editing session — every control that shapes the note list plus the edit list
itself — exports to one JSON file and re-imports, mirroring the app's existing manual
save/load pattern (the stems zip).

## Design

[`docs/superpowers/specs/2026-08-31-note-editing-design.md`](docs/superpowers/specs/2026-08-31-note-editing-design.md)

## Verifying

- `./scripts/serve.sh`, then `/tests/test.html` — all green (215/215).
- By hand: **Find notes**, tick **Edit notes**, select a note, try each toolbar button, drag
  its body and edges, arm **+ Add note** and drag a new one, drag the bottom band to
  range-select and delete, undo, export, reload and re-import. `docs/behaviour.md` → "Note
  editing" has the full checklist (E1–E18).

## Not in this PR

A generic app-wide undo/redo (this one is scoped to the edit list). Validating an imported
file against the current song beyond an informational filename check. Merging edits from
two files.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Deferred

Everything listed under **Deferred** and **Non-goals** in the design spec: a generic
app-wide undo/redo, auto-save/local persistence, merging edit files or copying an edit list
between songs, and validating an import beyond the informational filename check.
