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

## Two octave errors, and they are opposites

YIN's `d(tau)` measures how similar the signal is to itself `tau` samples later. A signal with
true period `T` is self-similar at **every integer multiple** of `T` — and, when its
fundamental is weak, it also looks self-similar at `T/n`. Both produce a dip, so the curve
offers wrong answers in *both* directions. The project has now hit each of them, and they need
different fixes.

| | 次諧波 subharmonic | 泛音 harmonic / overtone |
|---|---|---|
| the dip picked | `2T` — twice the true period | `T/2`, `T/4`, `T/8` |
| the pitch reads | an octave **low** | 1–3 octaves **high** |
| where it bit us | `6 南國的風` — 20% of note time an octave low | `ng_kipin` — 23 of 184 notes far too high |
| the fix | `hmm-v1`: keep both dips as candidates and let a whole-sequence optimum choose (v1.12.0) | octave folding: correct at the **note** layer using neighbouring notes |

The subharmonic case is fixable at the frame layer because the true period's dip is still in
the curve, merely above the 0.1 absolute threshold. **The harmonic case is not.** Measured on
the F#5 at t=62.1 in `ng_kipin`, whose neighbours (F2, G2) make F#2 almost certain: F#2's dip
only appears at `candidateThreshold` 1.2 with `maxCandidates` 20, ranked fifteenth at
p = 0.04 — while the frame still prefers the wrong F#5 at p = 0.10, by two and a half to one.
Separation and the 4:1 decimation leave a ~92 Hz male fundamental so weak that the waveform
genuinely *is* more periodic at its 8th harmonic. No frame-local method can conclude
otherwise, because within that frame it is not true.

### Why folding by whole octaves is the right operation

Because the errors land on **powers of two**. Measured across every outlier `ng_kipin` produces:

- 19 notes sit on the **2nd, 4th or 8th** harmonic. Those are octave-related, so folding by
  whole octaves reaches them and **pitch class is preserved** — the note name was right all
  along, only the octave was wrong, which is why the key estimate survives folding untouched.
- 4 notes sit on the **3rd or 6th** harmonic — an octave *plus a fifth*. B4 with G3/D3 either
  side implies E3 (3rd harmonic, 0.5 semitones off); A#4 between two D#2s implies D#2 (6th,
  exactly 0). Whole-octave folding **cannot** reach these, and correcting them would change
  pitch class, breaking the property that makes folding safe for key detection.

The confidence test in the fold design — does the best octave shift land within a fourth of
the neighbours? — turns out to separate those two populations exactly, without knowing
anything about harmonics. Notes it declines to fold are not noise; they are the odd-harmonic
cases, and they are marked rather than guessed.

## Layer 4 — edits (human)

Not built yet. When it is: overrides anchored to time ranges, layered over derived notes, so
that re-deriving with different parameters — or swapping the interpreter entirely — leaves
them standing.

### The actions to support

The intended scope, recorded so the layer is designed for all of it at once rather than
grown one verb at a time. Nothing here is built.

| # | action | what it does |
|---|---|---|
| 1 | **高/低 8 度** | Move a note up or down a whole octave. Preserves pitch class, so the key estimate stays valid. The manual counterpart to automatic octave folding — see the note below. **Must clear or replace `fix`:** a note left tagged `fix.state === 'doubt'` stays permanently silent (`lib/sonify.js` skips it), so hand-correcting one without touching `fix` produces a note that looks corrected and cannot be heard. |
| 2 | **刪除** | Remove one note. |
| 3 | **分割** | Split one note into two at a point in time. The inverse of a merge, which is not on this list. |
| 4 | **新增** | Create a note where detection found none. |
| 5 | **平移** | Nudge a note. **Undecided:** whether this moves it in time, in pitch, or both — settle it before designing the override format, because a pitch move and a time move want different anchors. |
| 6 | **range select and delete** | Select a time range and delete every note inside it. The only action here that is not per-note, so selection is a first-class concept, not an afterthought. |

Two consequences for the override format, both worth settling early. Actions 3, 4 and 6
change *which notes exist*, not just their pitch — so an override keyed only to an existing
note's identity cannot express them; anchoring to time ranges can. And action 1 is the same
operation the planned automatic octave-fold performs, so the two should share one code path
and one representation: a guess the user can then correct by hand is worth more than two
mechanisms that disagree.

## The interpretation the field uses — built, as `hmm-v1`

`threshold-v1` makes 437 independent local decisions. [Tony](https://sonicvisualiser.org/tony/)
and pYIN instead marginalise over many threshold settings and Viterbi-decode an HMM, which
optimises the whole sequence at once: a one-frame octave jump and an 80 ms note become
*expensive* rather than *forbidden*, and no hard duration floor is needed.

`hmm-v1` is that, approximated. It does not marginalise over a distribution of thresholds;
it reads the local minima of the one CMND curve `yinFrame` already computes and weights them
by depth. Two Viterbi passes follow — `viterbiPitch()` picks a pitch path through those
candidates, `segmentNotesHmm()` segments that path into notes — and `interpret()` selects
between the two interpreters. It is a drop-in replacement at layer 3 and changes nothing
stored.

**What it measurably does.** Both interpreters run on byte-identical frames, so every
difference below is attributable to the interpreter alone. Vocals, `minDurationMs: 80`,
percentages are the share of note time more than 8 semitones from the duration-weighted
median pitch:

| track | notes | an octave **low** | an octave **high** |
|---|---|---|---|
| 6 南國的風 | 437 → 357 | 20.2% → **8.5%** | 1.6% → 1.1% |
| 12 早安台灣 | 368 → 311 | 15.3% → **10.3%** | 1.4% → 3.2% |
| 9 繼續向前行 | 496 → 486 | 19.6% → **12.5%** | 1.8% → 4.8% |

The octave-down errors the phase set out to fix drop by a third to a half on every track.
But on two of three, part of that is **traded for octave-up errors** rather than eliminated:
the candidate list keeps the dip at half the true period as well as the one at twice it, and
the whole-sequence optimum sometimes latches onto the harmonic instead. Net off-melody time
still improves everywhere (21.8→9.6, 16.7→13.5, 21.4→17.3), so it is a real gain — but it is
a trade, not a clean win, which is why the checkbox shipped **off by default** in v1.12.0.

**Reversed in v1.14.0: `hmm-v1` is now the default.** What changed is not this measurement
but what sits downstream of it. The regression above is entirely octave-**up** errors, and
octave folding (v1.13.0) is the pass that corrects exactly that class — it moves an outlier
by whole octaves back toward its neighbours, and it never touches pitch class, so it can
undo a harmonic latch without inventing a melody. The half of the trade that argued for
leaving the better interpreter off is the half that now has a fix. The checkbox stays, so a
song where the trade goes the wrong way is one untick away from the old output.

Two traps in reading that table. The `pitch range` metric on the bench page can *widen*
under `hmm-v1` — that is this same octave-up tail, not a wider melody. And `touching
same-pitch` is always 0 for `hmm-v1` **by construction**: runs of one note state are maximal,
so two adjacent notes can never share a pitch. It measures nothing about fragmentation there.

The remaining gap to real pYIN is threshold marginalisation — running YIN across a
distribution of thresholds rather than reading one curve's minima. That is the next step if
the octave-up trade is to be closed, and it is deliberately deferred.

Beat tracking is **not** that improvement. A grid is required for 簡譜 and useful for
display, but beat times derived from accompaniment are systematically offset from vocal
onsets — singers push and lag against the band on purpose — and the singing-transcription
literature is explicit that naively quantising an f0 contour to estimated tatum times adds
errors rather than removing them.

## Status

| layer | state | where it surfaces |
|---|---|---|
| frames | built — `lib/pitch.js`, `decimate()` + `f0Track()` | computed in `notes.worker.js` |
| notes | built — `segmentNotes()` (`threshold-v1`) and `segmentNotesHmm()` (`hmm-v1`) | chosen by `interpret()`; the checkbox picks, and since v1.14.0 defaults to `hmm-v1` |
| pitch decoding | built — `viterbiPitch()` over per-frame candidates | part of `hmm-v1` |
| key estimate | built — `notesToChroma()` + `detectKey()`, a sibling of notes rather than a layer | picks the default 簡譜 key in the player; full ranking still bench-only |
| sonification | built — `lib/sonify.js`, with lap generation for A–B repeat and mid-note entry | the notes lane plays it, muted by default; a note straddling A resumes, and is cut at B |
| notes lane | built — `lib/ribbon.js` geometry, drawn by `app.js` | full-song lane under vocals; **Fit the lane to the melody** is a display choice about the vertical scale only |
| 簡譜 | built — `lib/jianpu.js`, drawn by `app.js` | a display mode over the same notes; changes nothing in the data |
| octave folding | built — `pitchBand()` + `foldOctaves()` over the note list | the **Fix octave outliers** checkbox; corrects what it can justify, marks the rest |
| zoomed reading pane | built | above the lane; ~10 s window, 2–60 s |
| edits | built — `applyEdits()` over the note list | edit mode toggle + zoomed-pane toolbar; the six actions resolved to six edit types (`split` composes from two) — see the design spec |
| beat / tempo | not built | — |

Two views exist because one cannot do both jobs. At whole-song width a pixel spans ~0.3 s,
so the lane can only answer *where* — it draws the contour as a per-pixel band because a
polyline there degenerates into noise. The zoomed pane answers *what*: a column is a frame
or less, so it draws the real line and labels every semitone.
