# Transcription — how a stem becomes notes

What turns audio into a melody you can read, which parts of that are allowed to change,
and which part can be lost. Read this before touching `lib/pitch.js` or anything that
consumes its output.

## The four layers

```
  stem audio          the user's own recording          immutable, never leaves the machine
      │
      │  decimate 4:1 → YIN → voicing gate → median filter          ~7 s cold, ~1.1 s warm
      ▼
  frames              one pitch every 11.6 ms           ANALYSIS      re-derivable from audio
      │
      │  segmentNotes(frames, params)                                          11.9 ms
      ▼
  notes               discrete events with a pitch      INTERPRETATION  re-derivable from frames
      │
      │  a human deciding the algorithm was wrong
      ▼
  edits               overrides, anchored to time       HUMAN           derivable from nothing
```

**Every layer is a pure function of the layer above it plus parameters — except edits.**
That single rule is what the whole design rests on. It means no parameter value can ever
destroy anything: change a number, re-derive, and if you don't like it, change it back.
Edits are the one layer with no upstream to be recovered from, which is why they are
anchored to *time ranges* rather than to note indices — a note index is meaningless the
moment the notes are re-derived, but a time range still points at the same moment in the
song.

## Layer 2 — frames (analysis)

`decimate()` then `f0Track()` in `lib/pitch.js`. Produces parallel arrays:

```js
{ t, f0, conf, cents, frameSeconds }     // cents === 0 marks an unvoiced frame
```

Deterministic, and expensive enough to belong in a Worker: about 7 s on the first run for a
4-minute track, ~1.1 s once V8 has warmed up. The first run is the one a user waits for, so
size the UI for 7 s, not 1.1.

This layer deliberately keeps only the single best pitch candidate per frame. pYIN-style
decoding would want the whole candidate distribution, which is ~11 MB per song — so the
decision is to re-run analysis if that day ever comes, rather than store what we might
need. The audio is always in the stems zip; nothing is lost by not hoarding.

## Layer 3 — notes (interpretation)

`segmentNotes(frames, params)`. **11.9 ms** for a 4-minute track — 92× cheaper than the
analysis above it. That number is the reason the architecture is worth having: a parameter
control can re-derive on every frame of a drag, live, on the main thread.

Parameters are tagged with the interpreter that understands them:

```json
{ "interpreter": "threshold-v1", "params": { "minDurationMs": 120 } }
```

The tag exists because the current segmenter takes thresholds while an HMM decoder would
take transition costs — a completely different parameter set. Without the tag, a file saved
today would silently feed thresholds to an interpreter that ignores them.

### What the parameters actually do

Measured on `6 南國的風`, a 233 s vocal stem, 437 notes at defaults. **`minDurationMs` is
the only knob with real leverage.** Do not present the others as equals in a UI; they are
not.

| parameter | sweep | notes produced | verdict |
|---|---|---|---|
| `minDurationMs` | 80 → 250 | 437 → 313 → 228 → 171 → 99 → 69 | **dominant** |
| `driftCents` | 40 → 200 | 423 → 437 → 427 → 425 → 402 → 392 | nearly inert |
| `gapFrames` | 2 → 12 | 437 → 470 | nearly inert |
| `medianSpan` | 3 → 13 | 421 → 437 → 491 → 449 | non-monotonic, not a control |
| `minConfidence` | 0.3 → 0.6 | 485 → 456 → 437 → 410 | mild, and it moves voicing too |

`driftCents` reads as inert because the drift rule needs three *consecutive* frames past the
threshold, and vibrato oscillates — it rarely stays on one side that long.

### The floor on `minDurationMs`

The hard limit is the analysis frame hop, **11.61 ms** — a note cannot be shorter than one
frame, so nothing below that is representable at all.

The musical limit is higher but not by as much as it looks. In 4/4:

| tempo | quarter | sixteenth | thirty-second |
|---|---|---|---|
| 60 BPM | 1000 ms | 250 ms | 125 ms |
| 120 BPM | 500 ms | 125 ms | 62.5 ms |
| 200 BPM | 300 ms | 75 ms | 37.5 ms |
| 240 BPM | 250 ms | 63 ms | 31 ms |

So a 60 ms floor already discards a sixteenth at 240 BPM and a thirty-second at 120 — and
melismatic runs go faster still. The control ranges from 20 ms for that reason. Below
roughly 40 ms most of what appears is artefact rather than note (1191 notes at no floor
against 522 at 60 ms on `6 南國的風`), but seeing it is how you tell an artefact from a
fast passage, which is the whole reason the control is exposed.

### Where the spurious notes actually come from

Of 437 notes, **148 touch their neighbour with zero gap, and only 8 of those share a pitch.**
So the fragmentation is not mainly one held note split in two; it is *portamento chopped
into a staircase* — a slide from C4 to D4 leaving a spurious C#4 in the middle. A
merge-adjacent-same-pitch pass would fix eight notes and nothing else. `minDurationMs` is
what removes the staircase, because the steps are short.

### Choosing the default

The knob trades false positives against false negatives. Lean toward over-generating: a
wrong note is one click to delete, while a *missing* note requires the user to notice an
absence. Drawing the measured pitch contour behind the notes is what makes an absence
visible at all.

## Layer 4 — edits (human)

Not built yet. When it is: overrides anchored to time ranges, layered over derived notes, so
that re-deriving with different parameters — or swapping the interpreter entirely — leaves
them standing.

## The interpretation the field would use instead

Our segmenter makes 437 independent local decisions. [Tony](https://sonicvisualiser.org/tony/)
and pYIN instead marginalise over many threshold settings and Viterbi-decode an HMM, which
optimises the whole sequence at once: a one-frame octave jump and an 80 ms note become
*expensive* rather than *forbidden*, and no hard duration floor is needed.

This is a drop-in replacement at layer 3 and changes nothing stored. It is the highest-value
improvement available to note quality, and it is deliberately deferred.

Beat tracking is **not** that improvement. A grid is required for 簡譜 and useful for
display, but beat times derived from accompaniment are systematically offset from vocal
onsets — singers push and lag against the band on purpose — and the singing-transcription
literature is explicit that naively quantising an f0 contour to estimated tatum times adds
errors rather than removing them.

## Status

| layer | state | where it surfaces |
|---|---|---|
| frames | built — `lib/pitch.js`, `decimate()` + `f0Track()` | computed in `notes.worker.js` |
| notes | built — `segmentNotes()`, `threshold-v1` | re-derived live in `notes.js` |
| key estimate | built — `notesToChroma()` + `detectKey()`, a sibling of notes rather than a layer | **bench page only** (`tests/notes.html`); no player UI |
| sonification | built — `lib/sonify.js`, with lap generation for A–B repeat | the notes lane plays it, muted by default |
| notes lane | built — `lib/ribbon.js` geometry, drawn by `app.js` | full-song lane under vocals |
| zoomed reading pane | built | above the lane; ~10 s window, 2–60 s |
| edits | not designed | — |
| beat / tempo | not built | — |

Two views exist because one cannot do both jobs. At whole-song width a pixel spans ~0.3 s,
so the lane can only answer *where* — it draws the contour as a per-pixel band because a
polyline there degenerates into noise. The zoomed pane answers *what*: a column is a frame
or less, so it draws the real line and labels every semitone.
