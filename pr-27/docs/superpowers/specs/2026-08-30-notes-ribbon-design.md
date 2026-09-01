# Notes ribbon — a notes lane in the player

**Status:** design, approved 2026-08-30
**Phase:** B2. Follows the PoC in `2026-08-30-pitch-detection-design.md`.
**Scope:** `notes.js`, `notes.worker.js`, a lane in `app.js`, and one live control.

## Motivation

`lib/pitch.js` works and is verified by ear, but it lives on a bench page. This puts it in
the player: a lane under the vocals stem showing detected notes over the pitch contour they
came from, on the same time grid as every waveform, seekable like every other lane.

Read [`docs/transcription.md`](../../transcription.md) first. It defines the layer model
this spec implements.

## Goals

1. Show the melody against the timeline, aligned with the waveform lanes.
2. Make the interpretation tunable **live**, so the raw analysis is computed once and the
   note derivation can be re-run on every frame of a control drag.
3. Show where the transcription disagrees with the audio, so a wrong note is visible as a
   wrong note rather than as a plausible one.

## Non-goals

- Editing notes. That is Phase C, and this spec only prepares the ground for it.
- Beat tracking, tempo, quantization, barlines, 簡譜.
- Persistence — export, import, anything written into the stems zip.
- Any change to separation, loading, A–B repeat, or the transport.
- Running on the mix, or on any stem other than vocals.

## Success criteria

The lane appears under the vocals stem, aligned with the waveforms; clicking it seeks;
dragging the shortest-note control visibly changes the notes without re-running analysis;
and the octave error at 0:41 in `6 南國的風` is visible as a block departing from the
contour rather than as an ordinary note.

## Architecture

### The ESM/classic seam

`app.js` is a classic script and cannot import `lib/pitch.js`. The project already has a
deliberate answer to this — `window.sansBass`, documented in `app.js` as "the interface for
separate.js, which is an ES module and cannot share scope with this classic script."

`notes.js` mirrors `separate.js` exactly: an ES module, loaded with its own `<script
type="module">`, talking to the player only through `window.sansBass`.

```
notes.js (ESM)                        app.js (classic)
  ├─ reads the vocals buffer   ──────  window.sansBass.stemBuffer('vocals')
  ├─ posts a COPY to the worker
  ├─ receives frames
  ├─ segmentNotes(frames, params)     ← re-run here, on every control change
  └─ hands over notes + frames ─────   window.sansBass.setNotes({ notes, frames, params })
                                              └─ builds and renders the lane
```

Analysis lives in `notes.worker.js` (ESM, imports `lib/pitch.js`). Interpretation stays on
the main thread in `notes.js`, because at 11.9 ms it is cheaper to run than to message.

### The copy that must not be a transfer

The vocals channel data is passed to the worker by **copy** (`.slice()`), never as a
transferable. `getChannelData(0)` returns a live view into the `AudioBuffer`; transferring
it detaches the backing store and the stem goes silent mid-song with no error anywhere.
`tests/parity.html` already slices for this reason.

### Additions to `window.sansBass`

Kept as small as the existing surface:

```js
stemBuffer(stem)   // → { name, buffer } for a loaded stem, or null
setNotes(payload)  // → { notes, frames, params } | null to clear the lane
```

## Rendering

The lane is built like a waveform lane and reuses the existing machinery wholesale:
`attachSeek(canvas)` gives seeking for free, and idle/active layers pre-rendered offscreen
mean `paint()` stays a blit plus a clip. A–B shading paints on it through the existing
`paintLoopRegion`, so the lane behaves like every other lane under looping.

**It is not a track.** *(Reversed after review — see the amendment at the end of this
document. The lane gained audio, a mute and a volume slider; it is still absent from
`tracks`, which is what keeps mute-all and solo away from it.)* It needs its own class
rather than reuse of the track lane, and `tracks` must not grow an entry for it — `laneLabel`, `applyGains`, `toggleTrack` and the stem-count logic all
assume a track has a buffer.

**Layers, back to front:** octave stripes at each C → the pitch contour → note blocks.

- **Contour** — drawn from `frames.cents`, ~14 frames per pixel at 1400 px, so per-pixel
  like the waveform. **The line breaks at unvoiced frames and never bridges them**; a line
  drawn straight through a rest is a lie about the performance.
- **Blocks** — one rect per note, one semitone tall, note name written inside when the block
  is wide enough to hold it.

### Vertical range, and clipping

Octave errors sit 12+ semitones from the melody. A range spanning min-to-max would let one
bad note squash everything: in a sample window of `6 南國的風` the notes span MIDI 46–74
for a melody that lives in 53–68.

The range therefore covers the middle ~94% of note *duration*, and notes outside it are
**clipped to the lane edge and drawn in the A–B orange** rather than dropped. Clipping is
the **default**, and it is exposed as an option, because it means the lane can hide a note's
true pitch and the user must be able to turn that off.

## Interpretation control

One control, prominent: **shortest note**, a slider over `minDurationMs`, with the resulting
note count beside it. On input, `notes.js` re-runs `segmentNotes(frames, params)` and calls
`setNotes` again. No worker round trip, no re-analysis.

Every other parameter goes behind a collapsed "advanced" disclosure. This is not
tidiness — measurement in [`docs/transcription.md`](../../transcription.md) shows
`minDurationMs` moves the note count from 437 to 69 across its range while `driftCents` and
`gapFrames` barely move it at all. Presenting four sliders as equals would misrepresent
where the leverage is.

Params carry their interpreter tag from the start:

```js
{ interpreter: 'threshold-v1', params: { minDurationMs: 120 } }
```

Nothing reads the tag yet. It exists so that a file written today survives the interpreter
being replaced, which [`docs/transcription.md`](../../transcription.md) explains is the
likeliest future change to this pipeline.

## Trigger and states

A **Find notes** button, shown only when a vocals stem is loaded. Detection does not run
automatically: it is ~7 s of CPU on the first run for a 4-minute track, and unbidden CPU
that size is a surprise, not a convenience.

States: idle → working (button disabled, one message through the existing `say()`) → ready
(lane visible, control live) → error (message through `say()`, lane stays hidden). Loading a
new song clears the lane via `setNotes(null)`.

`f0Track` has no progress callback and is not gaining one in this phase, so "working" is a
single message rather than a percentage. Do not design a progress bar the analysis cannot
feed; a bar that jumps 0 → 100 is worse than no bar.

## i18n

Every new string lands in **both** locales in `lib/i18n.js` — `tests/i18n.test.js` fails on a
key present in one and missing from the other. Lane label, button label, control label, the
working and error messages, and the advanced disclosure.

**Note names are never translated.** `C#4` is `C#4` in every locale, exactly as stem ids and
filenames already are.

## Testing

Unit-testable, in `tests/notes.test.js`:

- the vertical range covers the middle band of note duration and excludes a planted octave
  outlier;
- with clipping off, the range widens to include it;
- the contour builder emits a break at every unvoiced run rather than bridging it;
- params round-trip with their `interpreter` tag intact.

Rendering and the lane's behaviour are not unit-testable and belong in
[`docs/behaviour.md`](../../behaviour.md), which **must be updated in the same commit** —
observable outcomes with a way to observe each: the lane appears only with a vocals stem, a
click seeks, the shortest-note control changes the note count without a second analysis
pass, the lane clears on a new song.

Verify the control by observing **notes**, not parameters: that the slider's value changed
is not evidence the lane re-derived. Read the rendered note count.

## Versioning

This phase **does** need the `?v=` bump — `index.html` gains a script tag and a button, and
`app.js` changes. All of `index.html`, `separate.js`, `separate.worker.js` and the new
`notes.js` must carry the same version or `tests/versions.test.js` fails.

## Risks

**The lane is a fourth thing to keep aligned.** Waveform lanes, the overview, and the loop
region already share one time grid; the ribbon joins them. Any lane that computes its own
x-from-time will drift from the others under resize. It must use the same `frac * width`
mapping and nothing else.

**7 s of blocked UI if the worker is skipped.** It is tempting to run analysis on the main
thread because the module is right there and the bench page does exactly that. The bench
page is a dev tool with one user.

**A vocals stem is not guaranteed.** Loading a zip with no vocals lane, or a single
unseparated song, must hide the button rather than fail on a null buffer.


---

## Amendment — audio, height and a zoomed pane (2026-08-30)

Requested after the ribbon was working and reviewed in the browser. Recorded here rather
than as a new spec, because it changes this feature rather than adding another.

**The lane plays.** It gained a `GainNode` into `master`, muted by default and toggled from
its own name, plus a volume slider in the third column. It stays out of `tracks`, so
mute-all and solo continue to ignore it — pressing `0` must not silence the reference you
are checking against. `lib/sonify.js` gained lap generation so the synth follows A–B
repeat: a BufferSource loops on the audio thread via `src.loop`, which a sequence of
oscillators cannot do, so lap *k* of a note is computed as a pure `+ k · period` offset
from the same `t0`.

**Height is drag state**, persisted in `localStorage`, clamped 96–600 px. The grid became a
piano roll — a band per semitone, black keys shaded, C brighter, names overlaid at the left
edge. A gutter would have moved `x = 0` away from `t = 0` and broken alignment with the
waveform lanes, which every other decision here protects.

**A zoomed pane** sits directly above the lane, showing a window (default 10 s, 2–60 s by
wheel) rather than the whole song. It follows the playhead while playing and pans by
dragging when stopped. This does **not** cost the shared time grid: the full-width lanes
keep it and the pane has its own mapping, which is why a separate pane was the right answer
and zooming the lane itself was not. It needs its own peak resolution — the lane peaks are
1400 buckets across the whole song, which is ~60 buckets for a 10 s window.

**Two things the browser showed that assertions did not.** At whole-song width the contour
drawn as a polyline joins pitches ~26 frames apart and fills the lane with near-vertical
strokes; it is now a per-pixel min/max band, the same way waveforms solve the same problem.
And the pitch range is routinely ~27 semitones because octave errors stretch it, so the
per-semitone label threshold had to drop to 7 px or the common case fell back to labelling
C only.

**Follow-up requests, same session.** The zoomed pane gained `−`/`+` buttons (a trackpad
wheel overshoots, and a touch device has no wheel), click-to-seek distinguished from
drag-to-pan by distance travelled, and its own resize grip. A seek anywhere brings the zoom
window along, but only when the playhead has left it — recentring on every seek yanks the
view sideways when you click inside the pane you were already reading. A show/hide toggle
replaces **Find notes** once notes exist, mirroring the separation panel's Separate → Save
swap, and **hiding also mutes**: a pane you cannot see must not still be sounding, since
nothing on screen would stop it. Showing again does not unmute, because that was a separate
decision.

**A second temporal-dead-zone failure.** Refactoring two storage readers from `function`
declarations to `const` arrows moved them below the state that calls them, and the page
again loaded doing nothing at all. They are function declarations now, with a comment
saying why the shape matters rather than only what it does.
