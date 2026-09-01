# Note editing ergonomics — overlap order, seek remapping, lane range-select

**Status:** design, approved 2026-08-31
**Phase:** first of three follow-up batches to note editing (v1.16.0, `feat/note-editing`).
The other two — inline note-value fields, and compressing edit history with a snapshot-based
undo — are deferred to their own specs; see Non-goals.
**Branch:** `docs/note-editing-ergonomics-design` (design only; implementation gets its own
branch off `feat/note-editing`, since this depends on code not yet on `main`)
**Scope:** four small, independent fixes to the note-editing feature shipped in v1.16.0 —
consistent hit-test/paint order when notes overlap, a remap of scroll-wheel and arrow-key
input in the zoomed pane, extending range-select-and-delete to the full-song notes lane, and
seeking the playhead to wherever a note is clicked or tapped.

## Motivation

Using the freshly-shipped note editor surfaced four rough edges, none of them touching the
data model (`applyEdits`, edit groups, undo) — they're all in `app.js`'s pointer/keyboard
handling and rendering:

1. Nothing prevents two notes from overlapping after a resize or an `add`, and when that
   happens, the note drawn on top (last in the array) is not the note a click actually selects
   (`noteAt` matches the *first* array entry, `renderZoom` draws *last*-wins) — what you see is
   not what you get.
2. The zoomed pane's default interactions favor zooming (wheel) over navigating (arrows only
   jump 5s), which is backwards for the actual editing workflow: positioning the playhead
   precisely (for a split, or just to find the next thing to fix) happens far more often than
   changing the zoom level.
3. Range-select-and-delete (v1.16.0, Task 7) only exists in the zoomed pane. The full-song
   notes lane has no editing affordance at all, even though it's often the faster place to spot
   and clear a whole noisy section (an intro hum, a mis-detected non-vocal passage) that would
   take many small range-selects to clear at zoomed-in scale.
4. Selecting a note doesn't move the playhead, so splitting it means a separate seek action
   first — clicking the exact spot you want to cut is right there and already thrown away.
   Worse, once a note is already selected, clicking its body or edge *without* dragging does
   nothing at all: `noteDrag` (Task 5) starts unconditionally on that press, and a release with
   no net displacement dispatches no edit but also never seeks — the click is silently
   swallowed.

## Goals

- Overlapping notes are tolerated (not clamped/forbidden), but whichever note is visually on
  top is always the one a click selects.
- In the zoomed pane: unmodified scroll wheel seeks the playhead; Shift+wheel does today's
  zoom. Arrow Left/Right always seek (5s normally, a fine step with Shift), regardless of
  whether a note is selected.
- Range-select-and-delete works the same way in the full-song notes lane as it already does in
  the zoomed pane, sharing the same selection state and the same **Delete range** button.
- Clicking or tapping a note — whether selecting it for the first time, or tapping an
  already-selected note's body/edge without actually dragging it — moves the playhead to
  exactly that point, so it's immediately ready for a split. An actual drag past the existing
  slop threshold still moves/resizes the note as it does today, with no incidental seek.

## Non-goals

- **Inline, directly-editable note-value fields next to the toolbar.** A separate follow-up
  (batch 2). Until it ships, a selected note's time is adjusted via the toolbar's ◀t/▶t
  buttons or by dragging the note — not via the keyboard, since this spec reassigns
  Left/Right to seeking. This is a deliberate, temporary trade-off, not an oversight.
- **Compressing edit history, and the snapshot-based undo it requires.** A separate follow-up
  (batch 3) with real data-model implications; kept out of this batch entirely so it can get
  its own focused review.
- Changing pitch shortcuts (Up/Down for semitone, Shift+Up/Down for octave) — unaffected by
  anything here.
- Any change to `applyEdits`, edit groups, or undo. Everything in this spec is pointer/keyboard
  input handling and rendering only.

## Success criteria

- Two overlapping notes: whichever one is drawn on top (the later array entry — an `add`ed
  note over an existing one, or a resized note dragged over its neighbor) is also the one a
  click on the overlapping region selects.
- In the zoomed pane, an unmodified scroll gesture moves the playhead; the same gesture with
  Shift held zooms, exactly as scrolling alone did before this change.
- Arrow Left/Right move the playhead by 5s (Shift: a fine step) whether or not a note is
  currently selected. A selected note's pitch shortcuts (Up/Down, Shift+Up/Down) and
  Delete/Backspace are unaffected.
- Dragging the bottom band of the full-song notes lane selects a range and enables **Delete
  range**, identically to the zoomed pane; clicking it removes every overlapping note. Both
  panes' resting-state bands and their captions are visible whenever edit mode is on.
- Clicking an unselected note selects it and moves the playhead to the clicked time, not the
  note's midpoint. Tapping (press-release with no meaningful movement) an already-selected
  note's body or edge seeks the playhead to the release point and leaves the note otherwise
  untouched (no edit dispatched). A real drag on an already-selected note still moves/resizes
  it exactly as before, with no incidental seek.
- The full automated suite still passes (215/215 baseline going in); none of this adds new
  automated coverage since it's all pointer/keyboard/canvas behavior, verified by hand per
  `docs/behaviour.md`'s existing convention.

## Design

### 1. Overlap hit-test order

`noteAt(list, at)` currently does `list.find(n => n.start <= at && at < n.end)` — first match
in array order wins. `renderZoom`'s note loop draws in the same forward order, so with two
notes overlapping at a given time point, the *second* one drawn (visually on top, since later
draws paint over earlier ones) is never the one `noteAt` returns.

Fix: search from the end of the array instead —

```js
function noteAt(list, at) {
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    if (n.start <= at && at < n.end) return n;
  }
  return null;
}
```

No change to `renderZoom`'s draw order, no change to `applyEdits` (which has its own,
independent anchor-lookup in `lib/pitch.js` — this fix is scoped to `app.js`'s UI-side lookup
only, since `applyEdits` never needs to resolve a *visual* stacking order). `add` already
pushes new notes to the end of the list, so a manually placed note dropped onto an existing one
draws on top and is the one selected — matching the intuitive "the thing I just did is on top"
expectation for free.

### 2. Input remapping in the zoomed pane

**Wheel.** The existing listener:

```js
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomBy(e.deltaY > 0 ? 1.15 : 1 / 1.15);
});
```

becomes:

```js
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.shiftKey) { zoomBy(e.deltaY > 0 ? 1.15 : 1 / 1.15); return; }
  seek(currentTime() + (e.deltaY > 0 ? 1 : -1) * zoomSeconds * WHEEL_SEEK_FRACTION);
});
```

`WHEEL_SEEK_FRACTION` (proposed `0.05`) scales the per-tick seek step to the current zoom span,
so a tick feels similarly sized whether zoomed to a 2s window or a 60s one — the same principle
`zoomBy`'s multiplicative factor already uses. This constant is the one number in this spec
most likely to need retuning by feel once it's live; it is not load-bearing for anything else.

**Arrow Left/Right.** The top-level `keydown` listener's edit-mode branch currently intercepts
Left/Right to nudge the selected note's time, before falling through to the transport's 5s
seek. Both existing pieces change:

```js
// removed from the editMode && selectedNote block:
//   if (e.key === 'ArrowLeft') { ...editTimeNudge(-1)... }
//   if (e.key === 'ArrowRight') { ...editTimeNudge(1)... }
// (ArrowUp/Down, Shift+ArrowUp/Down, Delete/Backspace all stay exactly as they are)

// the transport fallthrough's seek amount gains a fine-step modifier:
else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(currentTime() - (e.shiftKey ? FINE_SEEK_STEP : SEEK_STEP)); }
else if (e.key === 'ArrowRight') { e.preventDefault(); seek(currentTime() + (e.shiftKey ? FINE_SEEK_STEP : SEEK_STEP)); }
```

`SEEK_STEP = 5` (unchanged from today's hardcoded value), `FINE_SEEK_STEP` proposed `0.05`
(50ms) — fine enough to place a split point precisely, coarser than the 20ms note-duration
floor so it never feels like it's fighting that floor. This branch is no longer gated by
`editMode` at all (it wasn't specific to note editing before this feature existed, and isn't
becoming so now) — Left/Right always seeks, full stop.

### 3. Range-select-and-delete in the full-song notes lane

The ribbon lane's canvas already has `attachSeek(canvas)` wired to it — pointerdown starts a
scrub, pointermove continues it, pointerup finalizes a seek. This spec inserts the identical
band-check `attachZoom` already does, ahead of that scrub logic, sharing the *same* module-level
`rangeDrag`/`rangeSelection`/`RULER_BAND_PX` state (there is exactly one range selection at a
time, regardless of which canvas started it):

```js
canvas.addEventListener('pointerdown', (e) => {
  if (editMode) {
    const r = canvas.getBoundingClientRect();
    if (e.clientY - r.top > r.height - RULER_BAND_PX) {
      const t = posToTime(e);
      rangeDrag = { startT: t, curT: t };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
  }
  // ...existing scrub-start logic, unchanged
});
```

with matching band-checks (`if (rangeDrag) { ...; return; }`, ahead of the scrub-follow /
scrub-finalize logic) added to `pointermove` and `pointerup`. `renderRibbon` gets the same
resting-strip-plus-border treatment `renderZoom` already has, and a caption below the ribbon
lane (matching the zoomed pane's) — the two panes aren't adjacent in the lane list, so one
caption doesn't cover both.

No new button: `applyRibbonVisibility()` already shows/hides the ribbon lane and the zoomed
pane together from one toggle (`ribbonVisible && !!ribbon`), so the existing **Delete range**
button in the zoomed toolbar is always reachable whenever either pane's band could have a
selection to act on.

### 4. Click-to-seek on note selection and taps

Two separate call sites, because "which note is selected" and "where is the playhead" are
different concerns that happen to be triggered by the same gesture.

**Fresh selection** (`pointerdown`'s plain-select branch, reached only when the clicked note
isn't already the selected one): after setting `selectedNote`, also seek to the exact clicked
time — not the note's midpoint `selectedNote.at` uses. The two anchors serve different
purposes: `selectedNote.at` has to stay reliably inside the note's span across future edits
(that's why it's the midpoint), while the seek target is exactly where the user meant to park
the playhead.

```js
const hit = noteAt(ribbon.notes, t);
if (hit) {
  selectedNote = { at: (hit.start + hit.end) / 2 };
  seek(t);
  draw();
  return;
}
```

**Taps on an already-selected note** (the `noteDrag` path from Task 5): today, pressing near an
already-selected note's body or edge always starts a `noteDrag`, and if the release turns out
to have moved nothing, nothing happens at all — not even a seek. Fix by tracking cumulative
pointer movement on `noteDrag` the same way `panning` already tracks it, and treating a
release under the existing `DRAG_SLOP` pixel threshold as a tap rather than a (no-op) drag:

```js
// pointerdown, when starting a noteDrag: add travelled: 0 to its shape.
noteDrag = { mode, note: sel, startT: t, origStart: sel.start, origEnd: sel.end,
             previewStart: sel.start, previewEnd: sel.end, travelled: 0, lastX: e.clientX };

// pointermove, when noteDrag is active, before recomputing the preview span:
noteDrag.travelled += Math.abs(e.clientX - noteDrag.lastX);
noteDrag.lastX = e.clientX;

// pointerup, before the existing dStart/dEnd dispatch logic:
if (noteDrag.travelled <= DRAG_SLOP) {
  seek(zoomTimeAt(canvas, e.clientX));
  noteDrag = null;
  draw();
  return;
}
```

The existing `dStart !== 0 || dEnd !== 0` dispatch logic is unreached for a real tap now (the
early return above takes it instead), so no edit is ever dispatched for a movement that was
really just a click. A drag that clears `DRAG_SLOP` falls through to the unchanged
move/resize-and-dispatch path exactly as it does today.

## Testing

No new automated tests — everything here is pointer/keyboard/canvas rendering, matching the
existing convention (`docs/behaviour.md`'s hand-verification rows) already used for every other
interactive piece of the note editor. The implementation plan will add behaviour.md rows for:
overlap click-order, wheel-seeks/Shift-wheel-zooms, arrow-always-seeks/Shift-fine-step,
range-select-and-delete working identically in the notes lane, and click/tap-seeks-the-playhead
(both the fresh-selection case and the already-selected-note tap case, plus confirming a real
drag past `DRAG_SLOP` still moves/resizes with no incidental seek).
