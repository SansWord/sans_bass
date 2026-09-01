# Note editing ergonomics (batch 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four small, independent rough edges in the note editor shipped in v1.16.0: click
order when notes overlap, scroll/arrow-key input in the zoomed pane, range-select-and-delete
extended to the full-song notes lane, and the playhead following a note click/tap.

**Architecture:** All four changes live in `app.js` only — no changes to `lib/pitch.js`,
`notes.js`, or the edit-list/undo data model. Each task is independently shippable; there is no
dependency between them.

**Tech Stack:** Vanilla JS, no build step, no dependencies. Verified by hand per
`docs/behaviour.md`'s existing convention — none of this is unit-testable (canvas
pointer/keyboard interaction), matching every other interactive piece of the note editor.

**Spec:** [`docs/superpowers/specs/2026-08-31-note-editing-ergonomics-design.md`](../specs/2026-08-31-note-editing-ergonomics-design.md)

**Branch:** create `ui/note-editing-ergonomics` off `feat/note-editing` before Task 1 (this
depends on code — `noteAt`, `attachZoom`, `attachSeek`, `renderRibbon`, the edit toolbar — that
only exists on that branch, not yet on `main`).

---

## Running the tests

```bash
./scripts/serve.sh          # http://localhost:8777
```

Units at `http://localhost:8777/tests/test.html` — read the rendered `PASS`/`FAIL` lines, or
`window.__testResults` in the console. **Baseline before you start: 215/215 passing.** None of
the four tasks below add new automated tests (all four touch canvas pointer/keyboard handling
in `app.js`, which the browser test harness can't reach — see `docs/behaviour.md`'s existing
rows for every other note-editor interaction, which follow the same hand-verification
convention). Each task still ends by re-running the suite to confirm no regression.

To get notes on screen for hand verification: `./scripts/serve.sh`, open
`http://localhost:8777`, load a stems zip with a `vocals` lane (`stems/ng_kipin.zip` or
similar — or synthesize one: build one or more small WAVs with `lib/wav.js`'s `encodeWav`,
zip them with `lib/zip.js`'s `buildZip`, and load the resulting `File` through the real
`#file-input`'s `change` event, since a single unlabelled file is forced to `stem: 'mix'` by
`assignStems`'s lone-file rule — use at least two files), click **Find notes**, tick **Edit
notes**.

---

## Task 1: Overlap hit-test order

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Flip `noteAt` to search from the end of the list**

`app.js` currently has:

```js
/** The note in `list` whose span contains `at`, or null. Half-open — a note's END excludes
 *  it, matching lib/pitch.js's applyEdits, so a click at a shared boundary picks the note
 *  that starts there rather than the one that just finished. */
function noteAt(list, at) {
  return list.find((n) => n.start <= at && at < n.end) || null;
}
```

Change it to:

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

- [ ] **Step 2: Verify by hand**

Load a song, **Find notes**, tick **Edit notes**. Select a note, then use **+ Add note** to
drag a new note whose time span fully overlaps the selected one, at a different pitch row.
Release. In the console, confirm the new note is last in the array:

```js
ribbon.notes.map(n => n.midi)   // the newly added note's midi should be the LAST entry
```

Click anywhere inside the overlapping time span: the outline should land on the newly added
note (the one you just placed, drawn on top), not the original one underneath. Delete the new
note (it should still be selected — click **✕**); click the same span again: the outline is now
back on the original note.

- [ ] **Step 3: Re-run the automated suite**

Reload `http://localhost:8777/tests/test.html`. Expected: **215/215 passed**, unchanged.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "Notes: resolve overlapping notes to whichever is drawn on top"
```

---

## Task 2: Input remapping in the zoomed pane

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add the new step constants**

`app.js` currently has, near the other zoomed-pane constants:

```js
const RULER_BAND_PX = 16;    // bottom band of the zoomed canvas reserved for range-select
```

Add three more constants right after it:

```js
const RULER_BAND_PX = 16;    // bottom band of the zoomed canvas reserved for range-select
const WHEEL_SEEK_FRACTION = 0.05;  // fraction of the zoom span a single wheel tick seeks
const SEEK_STEP = 5;               // seconds — Arrow Left/Right, unchanged from before this task
const FINE_SEEK_STEP = 0.05;       // seconds — Shift+Arrow Left/Right
```

- [ ] **Step 2: Swap the wheel handler's default action**

`attachZoom`'s wheel listener currently reads:

```js
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const before = zoomTimeAt(canvas, e.clientX);
    zoomBy(e.deltaY > 0 ? 1.15 : 1 / 1.15);
    // Keep the instant under the cursor pinned, so zooming feels like a lens rather
    // than a jump.
    zoomCenter += before - zoomTimeAt(canvas, e.clientX);
    draw();
  }, { passive: false });
```

Change it to gate the zoom behavior behind Shift, and seek otherwise:

```js
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.shiftKey) {
      const before = zoomTimeAt(canvas, e.clientX);
      zoomBy(e.deltaY > 0 ? 1.15 : 1 / 1.15);
      // Keep the instant under the cursor pinned, so zooming feels like a lens rather
      // than a jump.
      zoomCenter += before - zoomTimeAt(canvas, e.clientX);
      draw();
      return;
    }
    // Proportional to the current zoom span, so a tick feels similarly sized whether
    // zoomed to a 2s window or a 60s one — the same principle zoomBy's factor already uses.
    seek(currentTime() + (e.deltaY > 0 ? 1 : -1) * zoomSeconds * WHEEL_SEEK_FRACTION);
  }, { passive: false });
```

- [ ] **Step 3: Remove Left/Right from the edit-mode keyboard branch**

The top-level `keydown` listener currently reads:

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

Change it to drop the two `ArrowLeft`/`ArrowRight` lines from the `editMode && selectedNote`
block, and give the transport fallthrough's Left/Right a Shift-modified step:

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
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); editDeleteNote(); return; }
  }
  if (e.key === ' ') { e.preventDefault(); toggle(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(currentTime() - (e.shiftKey ? FINE_SEEK_STEP : SEEK_STEP)); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); seek(currentTime() + (e.shiftKey ? FINE_SEEK_STEP : SEEK_STEP)); }
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

Note: Left/Right nudging a selected note's time is no longer reachable from the keyboard after
this step — that capability moves to the toolbar's ◀t/▶t buttons and dragging, per the spec's
Non-goals (a batch-2 follow-up adds inline value fields; this is a deliberate interim
trade-off, not an oversight).

- [ ] **Step 4: Verify by hand**

Tick **Edit notes** or leave it off — this applies either way. In the zoomed pane, scroll with
no modifier: the playhead moves (confirm via `#t-cur` or the console: `currentTime()` changes),
the zoom level (`zoomSeconds`, or the `#zoom-secs`-adjacent label) does not. Hold Shift and
scroll: the zoom level changes now, the playhead does not.

Press ArrowRight with nothing selected: `currentTime()` advances by 5s. Press Shift+ArrowRight:
it advances by 0.05s. Select a note and press ArrowRight: it STILL seeks by 5s (does not nudge
the note) — confirm the note's `start`/`end` are unchanged in `ribbon.notes` before/after.
Confirm ArrowUp/Down (pitch), Shift+ArrowUp/Down (octave), and Delete/Backspace on a selected
note are all unaffected.

- [ ] **Step 5: Re-run the automated suite**

Reload `http://localhost:8777/tests/test.html`. Expected: **215/215 passed**, unchanged.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "Notes: wheel seeks (Shift zooms), arrows always seek (Shift = fine step)"
```

---

## Task 3: Range-select-and-delete in the full-song notes lane

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Module state for the lane's caption**

Add to the module state, alongside `zoomRangeHint`:

```js
let zoomRangeHint = null;   // the "drag along the bottom" caption under the zoomed canvas
let ribbonRangeHint = null; // the same caption under the full-song notes lane
```

- [ ] **Step 2: Give `attachSeek` an optional range-band mode**

`attachSeek` currently reads:

```js
function attachSeek(canvas) {
  const posToTime = (e) => {
    const r = canvas.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * duration;
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    scrubbing = true;
    seek(posToTime(e));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (scrubbing) { offset = Math.max(0, Math.min(duration, posToTime(e))); draw(); }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    seek(posToTime(e));
  });
}
```

`attachSeek` is shared by every track lane, the main waveform, AND the notes ribbon lane — the
band check must only apply to the one canvas that opts in, or every lane would grow a
range-select strip. Change it to take an options object, defaulting to no band:

```js
function attachSeek(canvas, opts) {
  const rangeBand = !!(opts && opts.rangeBand);
  const posToTime = (e) => {
    const r = canvas.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * duration;
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (rangeBand && editMode) {
      const r = canvas.getBoundingClientRect();
      if (e.clientY - r.top > r.height - RULER_BAND_PX) {
        const t = posToTime(e);
        rangeDrag = { startT: t, curT: t };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    canvas.setPointerCapture(e.pointerId);
    scrubbing = true;
    seek(posToTime(e));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (rangeDrag) { rangeDrag.curT = posToTime(e); draw(); return; }
    if (scrubbing) { offset = Math.max(0, Math.min(duration, posToTime(e))); draw(); }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (rangeDrag) {
      const from = Math.min(rangeDrag.startT, rangeDrag.curT);
      const to = Math.max(rangeDrag.startT, rangeDrag.curT);
      rangeDrag = null;
      rangeSelection = (to - from > 0.01) ? { from, to } : null;
      draw();
      return;
    }
    if (!scrubbing) return;
    scrubbing = false;
    seek(posToTime(e));
  });
  canvas.addEventListener('pointercancel', () => { rangeDrag = null; scrubbing = false; });
}
```

(`rangeDrag`'s `pointermove`/`pointercancel` handling is unconditional on `rangeBand` because
`rangeDrag` is only ever SET when `rangeBand && editMode` was true at `pointerdown` — a plain
track lane's `pointermove`/`pointercancel` will simply never see it truthy. `attachSeek` had no
`pointercancel` handler at all before this task; adding one is required for `rangeDrag` to
never get stuck mid-drag, and clearing `scrubbing` there too is a harmless, correct match for
what `pointerup` already does on a normal release.)

- [ ] **Step 3: Opt the ribbon lane into the range band**

`buildUI()`'s ribbon-lane construction currently calls:

```js
    lane.append(name, canvas, vol, grip);
    el.lanes.insertBefore(lane, vocals.laneEl.nextSibling);
    attachSeek(canvas);
    ribbonEl = { lane, canvas, txt, grip };
```

Change the `attachSeek` call and add the caption element right after `canvas`:

```js
    /* Names the bottom range-select band, same reasoning as the zoomed pane's equivalent
     * caption (see 'sansbass:editmode' listener) — the band alone doesn't say what it's for. */
    const rHint = document.createElement('div');
    rHint.className = 'note-range-hint';
    rHint.textContent = tr('notes.rangeTip');
    rHint.hidden = !editMode;
    ribbonRangeHint = rHint;

    lane.append(name, canvas, rHint, vol, grip);
    el.lanes.insertBefore(lane, vocals.laneEl.nextSibling);
    attachSeek(canvas, { rangeBand: true });
    ribbonEl = { lane, canvas, txt, grip };
```

- [ ] **Step 4: Toggle the caption with edit mode**

The `sansbass:editmode` listener currently reads:

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
  if (zoomRangeHint) zoomRangeHint.hidden = !editMode;
  if (zoomEl) { zoomEl.canvas.classList.toggle('editing', editMode); draw(); }
});
```

Add the ribbon caption's toggle:

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
  if (zoomRangeHint) zoomRangeHint.hidden = !editMode;
  if (ribbonRangeHint) ribbonRangeHint.hidden = !editMode;
  if (zoomEl) { zoomEl.canvas.classList.toggle('editing', editMode); draw(); }
});
```

- [ ] **Step 5: Draw the band on the ribbon lane without rebuilding its cached layers**

`renderRibbon` pre-renders two offscreen layers (`idle`/`active`) and `paint()` blits between
them every frame — rebuilding those layers on every pointermove during a drag would be the
same expensive full redraw the caching exists to avoid. Instead, draw the band directly on the
live canvas from `paint()`, the same way the existing A-B loop shading already does via
`paintLoopRegion`.

`paint()` currently reads:

```js
function paint(canvas, frac) {
  const L = canvas.__layers;
  if (!L) return;
  const c = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.drawImage(L.idle, 0, 0);
  const px = Math.round(frac * L.w * dpr);
  if (px > 0) {
    c.save();
    c.beginPath();
    c.rect(0, 0, px, canvas.height);
    c.clip();
    c.drawImage(L.active, 0, 0);
    c.restore();
  }
  paintLoopRegion(c, canvas, dpr, canvas === el.mainWave);

  c.fillStyle = 'rgba(255,255,255,.85)';
  c.fillRect(px, 0, Math.max(1, dpr), canvas.height);
}
```

Add a call to a new `paintRangeBand`, gated to the ribbon canvas specifically:

```js
function paint(canvas, frac) {
  const L = canvas.__layers;
  if (!L) return;
  const c = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.drawImage(L.idle, 0, 0);
  const px = Math.round(frac * L.w * dpr);
  if (px > 0) {
    c.save();
    c.beginPath();
    c.rect(0, 0, px, canvas.height);
    c.clip();
    c.drawImage(L.active, 0, 0);
    c.restore();
  }
  paintLoopRegion(c, canvas, dpr, canvas === el.mainWave);
  if (ribbonEl && canvas === ribbonEl.canvas) paintRangeBand(c, canvas, dpr);

  c.fillStyle = 'rgba(255,255,255,.85)';
  c.fillRect(px, 0, Math.max(1, dpr), canvas.height);
}

/** The range-select band on the full-song notes lane: a faint resting-state strip whenever
 *  edit mode is on (so the interactive area is discoverable at rest, same as the zoomed
 *  pane's), plus a brighter highlight while a range is being dragged or sits committed.
 *  Drawn directly on the live canvas, like paintLoopRegion, so a drag doesn't force
 *  renderRibbon to rebuild its cached idle/active layers on every pointermove. */
function paintRangeBand(c, canvas, dpr) {
  const w = canvas.width;
  const h = canvas.height;
  if (editMode) {
    c.fillStyle = 'rgba(255,209,102,.07)';
    c.fillRect(0, h - RULER_BAND_PX * dpr, w, RULER_BAND_PX * dpr);
    c.strokeStyle = 'rgba(255,209,102,.4)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, h - RULER_BAND_PX * dpr + 0.5);
    c.lineTo(w, h - RULER_BAND_PX * dpr + 0.5);
    c.stroke();
  }
  const rsel = rangeDrag || rangeSelection;
  if (rsel && duration) {
    const s = Math.min(rsel.startT ?? rsel.from, rsel.curT ?? rsel.to);
    const eT = Math.max(rsel.startT ?? rsel.from, rsel.curT ?? rsel.to);
    c.fillStyle = 'rgba(255,209,102,.18)';
    c.fillRect((s / duration) * w, 0, Math.max(1, ((eT - s) / duration) * w), h);
  }
}
```

(`RULER_BAND_PX * dpr` because, unlike the zoomed pane's `renderZoom` which works in CSS
pixels via a `setTransform(dpr, 0, 0, dpr, 0, 0)` scale, `paint()` and `paintLoopRegion` work
directly in device pixels against `canvas.width`/`canvas.height` — matching
`paintLoopRegion`'s own `w`/`h` convention right above it.)

- [ ] **Step 6: Verify by hand**

Tick **Edit notes**. The full-song notes lane should show a faint amber strip with a top
border along its bottom edge, and the caption "Drag along the bottom to select a time range"
underneath it — both appear immediately, before any drag. Drag along that strip, including
directly under a note block: a brighter amber band tracks the drag and commits on release
(confirm `document.querySelector('.note-tbtn-danger[disabled]')` — there are two
`.note-tbtn-danger` buttons, check the one whose text is the range-delete label — goes enabled).
Click it: every overlapping note is removed and `#notes-count` drops correctly, matching what
Task 7's original zoomed-pane range-delete already does. Untick **Edit notes**: the strip and
caption both disappear.

- [ ] **Step 7: Re-run the automated suite**

Reload `http://localhost:8777/tests/test.html`. Expected: **215/215 passed**, unchanged.

- [ ] **Step 8: Commit**

```bash
git add app.js
git commit -m "Notes: range-select-and-delete in the full-song notes lane"
```

---

## Task 4: Click-to-seek on note selection and taps

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Seek on a fresh selection**

`attachZoom`'s `pointerdown` plain-select branch currently reads:

```js
      const hit = noteAt(ribbon.notes, t);
      if (hit) {
        selectedNote = { at: (hit.start + hit.end) / 2 };
        draw();
        return;   // selecting a note is the gesture; it does not also start a pan/seek
      }
```

Add a seek to the exact clicked time (not the note's midpoint `selectedNote.at` uses — that
anchor has to stay reliably inside the note's span across future edits, which is a different
job from "where did the user mean to park the playhead"):

```js
      const hit = noteAt(ribbon.notes, t);
      if (hit) {
        selectedNote = { at: (hit.start + hit.end) / 2 };
        seek(t);
        draw();
        return;   // selecting a note is the gesture; it does not also start a pan/seek
      }
```

- [ ] **Step 2: Track cumulative movement on `noteDrag`**

`attachZoom`'s `pointerdown` currently starts a `noteDrag` like this:

```js
        if (mode) {
          noteDrag = { mode, note: sel, startT: t, origStart: sel.start, origEnd: sel.end,
                       previewStart: sel.start, previewEnd: sel.end };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
```

Add `travelled`/`lastX`, the same pixel-tracking pair `panning` already uses:

```js
        if (mode) {
          noteDrag = { mode, note: sel, startT: t, origStart: sel.start, origEnd: sel.end,
                       previewStart: sel.start, previewEnd: sel.end, travelled: 0, lastX: e.clientX };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
```

`pointermove`'s `noteDrag` branch currently reads:

```js
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
```

Accumulate `travelled` at the top of that branch:

```js
    if (noteDrag) {
      noteDrag.travelled += Math.abs(e.clientX - noteDrag.lastX);
      noteDrag.lastX = e.clientX;
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
```

- [ ] **Step 3: Treat a tap (movement under `DRAG_SLOP`) as a seek, not a no-op**

`pointerup`'s `noteDrag` branch currently reads:

```js
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
```

Add the tap check before the existing dispatch logic:

```js
    if (noteDrag) {
      if (noteDrag.travelled <= DRAG_SLOP) {
        seek(zoomTimeAt(canvas, e.clientX));
        noteDrag = null;
        draw();
        return;
      }
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
```

(`DRAG_SLOP` is already in scope here — it's declared once near the top of `attachZoom`, the
same function this code lives in.)

- [ ] **Step 4: Verify by hand**

Select a note (not yet selected before this click): confirm the playhead (`currentTime()`)
lands exactly at the clicked time, not the note's midpoint (pick a note wider than a second and
click near one edge to tell the difference). With that note still selected, click its body
again WITHOUT moving the pointer (a plain click, e.g. via a single `pointerdown`+`pointerup`
at the same coordinates): confirm the playhead moves to that point and `ribbon.notes` is
unchanged (no `timeAdjust` was dispatched — check the edit list gained no new row). Now drag
the same note's body a real distance: confirm it still moves normally and a `timeAdjust` row
appears in the edit list, with no incidental seek beyond the note's own new position.

- [ ] **Step 5: Re-run the automated suite**

Reload `http://localhost:8777/tests/test.html`. Expected: **215/215 passed**, unchanged.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "Notes: clicking or tapping a note seeks the playhead there"
```

---

## Task 5: Docs, version, and the PR

**Files:**
- Modify: `docs/behaviour.md`, `docs/devlog.md`, `CLAUDE.md`
- Modify: `index.html`, `separate.js`, `separate.worker.js`, `notes.js`, `notes.worker.js`, `tests/notes.test.js`

- [ ] **Step 1: Behaviour rows**

In `docs/behaviour.md`, extend the "Note editing" section (added for v1.16.0) with four new
rows after E18:

```markdown
| E19 | With two notes overlapping in time, a click on the overlap resolves to whichever note is drawn on top (the later array entry) — not necessarily the first-detected one. | Overlap a manually added note onto an existing one; click the overlap and confirm the outline lands on the new note, not the old one underneath. |
| E20 | In the zoomed pane, plain scroll seeks the playhead; Shift+scroll zooms. Arrow Left/Right always seek (5s; Shift: 0.05s) whether or not a note is selected. | Scroll with no modifier: `currentTime()` changes, zoom level doesn't. Shift+scroll: the reverse. Select a note, press →: it still seeks 5s, the note's `start`/`end` are unchanged. |
| E21 | Range-select-and-delete works identically in the full-song notes lane as in the zoomed pane: a resting-state strip and caption whenever edit mode is on, a brighter highlight while dragging or committed, and the same **Delete range** button. | Tick Edit notes with the lane visible: strip and caption appear immediately. Drag the lane's bottom band, click Delete range: notes overlapping the range are removed. |
| E22 | Clicking an unselected note seeks the playhead to the exact clicked point, not the note's midpoint. Tapping (no real movement) an already-selected note's body/edge also seeks, dispatching no edit; an actual drag still moves/resizes as before. | Click near one edge of a wide note: `currentTime()` matches the click, not the midpoint. Click the same spot again without dragging: playhead moves again, edit list gains no new row. Drag a real distance: the note moves and a row appears. |
```

- [ ] **Step 2: Bump the asset version**

```bash
sed -i '' 's/?v=1\.16\.0/?v=1.16.1/g' index.html separate.js separate.worker.js notes.js notes.worker.js tests/notes.test.js
grep -rn '1\.16\.0' index.html separate.js separate.worker.js notes.js notes.worker.js   # expect none
```

Update `` Currently `v1.16.0`. `` in `CLAUDE.md` to `` Currently `v1.16.1`. `` — a follow-up
session on the same feature area, so a patch bump (`v1.16.1`), not a new minor version.

- [ ] **Step 3: Verify the whole suite**

Reload `http://localhost:8777/tests/test.html`. Expected: **215/215 passed**, both `versions:`
tests included, now at `v1.16.1`.

- [ ] **Step 4: Devlog**

```bash
git log -1 --format='%cd' --date=format:'%Y-%m-%d %H:%M'
```

Add a TL;DR row and a `v1.16.1` entry (follow-up session on v1.16.0, per `CLAUDE.md`'s
versioning convention) in the house format, newest-first, with an anchor link and a **Design
docs:** subsection pointing at this spec and plan. Learnings worth recording:

- `[insight]` **A cached-layer canvas needs its transient UI drawn OUTSIDE the cache.**
  `renderRibbon` pre-renders idle/active layers specifically so a frame is a cheap blit —
  drawing the range-select band inside that cache would mean rebuilding both layers, plus the
  full grid/notes/labels pass, on every pointermove of a drag. `paintLoopRegion` had already
  solved this exact problem for the A-B loop shading; `paintRangeBand` reuses the same
  live-canvas-after-blit pattern rather than inventing a new one.
- `[gotcha]` **A shared helper needs an opt-in flag, not a global behavior change.**
  `attachSeek` is wired to every track lane, the main waveform, and the notes ribbon lane alike
  — adding the range-band check unconditionally would have turned on range-select dragging
  everywhere. The `{ rangeBand: true }` option keeps the other two dozen call sites untouched.
- `[note]` Range-select's `rangeDrag`/`rangeSelection` state is genuinely canvas-agnostic — it
  was already shared across the zoomed pane and (as of this batch) the notes lane with zero
  changes to the state shape itself, only to which canvases feed it.

- [ ] **Step 5: Commit and open the PR**

```bash
git add -A -- app.js index.html separate.js separate.worker.js notes.js notes.worker.js tests/ CLAUDE.md docs/
git commit -m "Docs: v1.16.1 devlog, behaviour rows, asset version"
git push -u origin ui/note-editing-ergonomics
gh pr create --title "Note editing ergonomics — batch 1 (v1.16.1)" --body "$(cat <<'EOF'
## Summary

Four small, independent fixes to the note editor shipped in v1.16.0, none touching the edit
data model (`applyEdits`, edit groups, undo):

- Overlapping notes resolve clicks to whichever is drawn on top, matching what you see.
- The zoomed pane's scroll wheel seeks by default (Shift zooms); arrows always seek (Shift for
  a fine 0.05s step), regardless of note selection.
- Range-select-and-delete now works in the full-song notes lane too, not just the zoomed pane.
- Clicking or tapping a note parks the playhead exactly there, ready for a split.

## Design

[`docs/superpowers/specs/2026-08-31-note-editing-ergonomics-design.md`](docs/superpowers/specs/2026-08-31-note-editing-ergonomics-design.md)

## Verifying

- `./scripts/serve.sh`, then `/tests/test.html` — all green (215/215).
- By hand: `docs/behaviour.md` → "Note editing" rows E19–E22 have the full checklist.

## Not in this PR

Inline note-value fields next to the toolbar, and compressing edit history with a
snapshot-based undo — both separate follow-up batches (see the spec's Non-goals).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Deferred

Inline, directly-editable note-value fields (batch 2) and compressing edit history with a
snapshot-based undo (batch 3) — both out of scope for this plan; see the spec's Non-goals.
