# HMM note decoding — a second interpreter, switchable at runtime

**Status:** design, approved 2026-08-30
**Phase:** C1. Follows the notes ribbon (v1.11.0, merged as #14).
**Scope:** `lib/pitch.js` gains candidates and two Viterbi decoders; one checkbox; a
comparison table on the bench page.

## Motivation

The current segmenter makes ~437 independent local decisions per song: *is this frame more
than 60 cents from the running median, and has that held for 3 frames?* It cannot see that
a note dipped an octave for 16 frames and came straight back, because it never looks at
more than three frames at once.

Measured on `6 南國的風`, that shows up as **4.8% of note time an octave below the melody,
in notes averaging 186 ms** — sustained errors, not blips. A percentile clip cannot remove
them, `minDurationMs` cannot remove them, and they are what stretches the lane's pitch range
to ~27 semitones. [`docs/transcription.md`](../../transcription.md) records why threshold
tuning has reached its ceiling.

pYIN, and [Tony](https://sonicvisualiser.org/tony/) built on it, answer a different
question: *what sequence of notes best explains this whole recording?* Viterbi finds the
single most likely path, so a spurious octave dip pays a transition cost twice — down and
back — while staying put pays nothing.

## Goals

1. A second interpreter, `hmm-v1`, that decodes notes from a whole-sequence optimum.
2. Switchable at runtime against the same immutable analysis, so the two can be compared on
   identical input.
3. Evidence, not impressions: objective counts for both, side by side.

## Non-goals

- Replacing `threshold-v1`. It stays, works unchanged, and remains the default.
- Editing, tempo, beat tracking, 簡譜, persistence.
- True pYIN threshold marginalisation — see "Approximation" below.
- Any change to the ribbon, the zoomed pane, or the transport.

## Success criteria

The checkbox switches interpreters with no re-analysis and a visible change in note count.
The bench page prints both interpreters' metrics side by side. **Whether `hmm-v1` wins is an
outcome, not a requirement** — if the octave numbers do not move, that is a finding worth
having cheaply, and it tells us the candidate stage is not doing its job.

## Architecture

### Everything is additive

`yinFrame` keeps returning `{ tau, f0, confidence }` and *gains* a `candidates` array.
`f0Track` keeps returning `{ t, f0, conf, cents, frameSeconds }` and gains candidate
storage. Nothing existing changes shape.

This is not politeness — it is what makes the comparison honest. If `threshold-v1`'s input
changed, we would be comparing two interpreters against two different analyses and could not
attribute a difference to either.

### Candidates, and where they come from

Today `yinFrame` finds the first CMND dip below 0.1, refines it, and **throws the rest of
the curve away**. That discarded curve is exactly what is needed.

A YIN octave error is picking the dip at *twice* the true period. The true period's dip is
still there — it just sat above the absolute threshold. Keeping it alive is the whole
mechanism:

```
cmnd(τ)
  │      ╲        ╲                     ← dip at the true period, d' = 0.14 (above 0.1,
  │       ╲__╱     ╲__╱                   so today it is discarded)
  │        A        B                   ← dip at 2x the period, d' = 0.08 (below 0.1,
  └──────────────────────── τ             so today it wins, and reads an octave low)
```

So: collect every local minimum of `cmnd` in `[tauMin, tauMax]` with `d' < 0.6` — generous
on purpose — parabolic-interpolate each, and give each a probability from its depth,
`p ∝ (1 − d')`, normalised. Keep the best `CANDIDATES_PER_FRAME = 4`.

**Approximation, stated plainly.** Real pYIN marginalises over the threshold itself, running
YIN many times with thresholds drawn from a beta distribution and counting how often each τ
wins. Reading local minima off one curve is cheaper and captures the part that matters — the
competing candidate survives — but it is not the same thing, and if `hmm-v1` underperforms
the published results this is the first place to look.

**Storage:** 4 candidates × 20,086 frames × 2 floats = **0.64 MB** for a 4-minute track,
against 0.16 MB today. Irrelevant.

### Stage 1 — `viterbiPitch(frames, opts)`

States per frame: that frame's candidates, plus one unvoiced state.

- **Observation cost** `−log(p)` for a candidate; a fixed cost for unvoiced, scaled by the
  frame's RMS so silence prefers it.
- **Transition cost** `PITCH_STEP_COST × |Δ semitones|` between voiced states, plus a fixed
  `VOICING_COST` for crossing voiced↔unvoiced.

An octave excursion therefore costs `2 × 12 × PITCH_STEP_COST`, which the alternative path
does not pay. That is the entire reason this fixes sustained octave errors and the 5-frame
median filter does not.

Returns a `cents` array of the same shape `f0Track` produces, so everything downstream is
unchanged.

### Stage 2 — `segmentNotesHmm(track, opts)`

States: one per semitone across the track's occupied range, plus silence.

- **Observation cost** distance in cents from the frame's pitch to the state's centre.
- **Transition cost** zero to stay, `ONSET_COST` to change note.

`ONSET_COST` is what makes short notes expensive, replacing the hard `minDurationMs` floor
with a price. Same intent, expressed as a preference rather than a cliff.

**The shortest-note control keeps working in both modes.** With `hmm-v1` it maps to
`ONSET_COST` rather than to a duration floor — a different mechanism with the same felt
effect, so one control stays meaningful and the user is not asked to learn two. The mapping is
`ONSET_COST = minDurationMs / 20`, chosen so both interpreters land within roughly 20% of
each other's note count at the slider's midpoint on `6 南國的風`. It is a calibration
against one track, not a law; the bench table is what checks it, and it may need adjusting
once the decoder exists.

### Cost

Both stages are O(frames × states²) with tiny state counts: 20,086 × 4² ≈ 320k for the
pitch stage. Microseconds — it stays in the interpretation layer, on the main thread, and
the checkbox is instant.

## UI

One checkbox beside **Shortest note**, labelled for what it does rather than for the
algorithm behind it. Off by default: nothing about current behaviour changes until the
comparison earns the switch.

Params carry `interpreter: 'hmm-v1'` or `'threshold-v1'`, which is what the tag was added
for. Both remain readable.

## Measurement — the bench page

`tests/notes.html` runs **both** interpreters over the same frames and prints:

| metric | why it is here |
|---|---|
| note count | the headline, and the thing the slider moves |
| octave outliers | notes ≥ 10 semitones from *both* neighbours — the isolated-error count |
| time an octave below the melody | fraction of note time below (median pitch − 8 semitones); **4.8% today**, and the number this phase exists to move |
| touching same-pitch pairs | fragmentation; **8 of 437 today** |
| pitch-range width | the clipped percentile band; **~27 semitones today**, and directly what makes the lane unreadable |
| decode time | must stay in the milliseconds, or the live control is gone |

Those five current values are the baseline. If `hmm-v1` does not move the third and fifth,
the candidate stage is not working and no amount of transition-cost tuning will save it.

## Testing

Unit-testable in `tests/pitch.test.js`, all synthetic:

- `yinFrame` on a signal with a strong subharmonic returns **both** the true period and the
  double-period candidate, with the true one present even when it is not the winner.
- Candidate probabilities are normalised and ordered.
- `viterbiPitch` on a synthetic track holding a steady pitch with a planted 16-frame octave
  dip **removes the dip**, where `medianFilterVoiced` with any span does not. This is the
  central claim of the phase and must be a test, not a demo.
- `viterbiPitch` follows a genuine octave leap that is sustained and unambiguous — it must
  smooth errors without flattening real melody.
- `segmentNotesHmm` on the two-pitch track from the existing segmentation tests returns the
  same two notes.
- Raising `ONSET_COST` reduces the note count monotonically.
- `threshold-v1` output is byte-identical before and after this change, proving the
  additions are additive.

That last one is the guard on the whole design.

## Risks

**The approximation may not be enough.** If reading one curve's minima does not surface the
true-period candidate often enough, the pitch stage has nothing to choose and the octave
numbers will not move. The metrics table finds this out in one run, before any tuning.

**Two costs replace three thresholds.** `PITCH_STEP_COST`, `VOICING_COST` and `ONSET_COST`
are parameters like any others. The claim is not "no tuning" — it is that a whole-sequence
optimum reaches results local rules cannot, at comparable tuning effort.

**A wrong transition cost flattens real melody.** Too high and every leap is suppressed,
turning a melody into a drone. The "follows a genuine octave leap" test exists for this, and
it is the failure mode to listen for first.
