# Octave folding — correcting outlier notes without hiding them

**Status:** design, approved 2026-08-31
**Phase:** C2. Follows the HMM decoder (v1.12.0, merged as #15).
**Branch:** `feat/octave-fold`
**Scope:** a note-level post-pass in `lib/pitch.js`; two new draw colours in `app.js`; one
control; the note record gains a provenance field.

## Motivation

On `stems/ng_kipin.zip` the singer sits roughly F2–D4, but detection scatters notes across
MIDI 68–79 — a fifth to two octaves above anything sung. With a robust band (below), that is
**23 of 184 notes, 16.6% of note time** under `threshold-v1`, and 40 of 303 (13.7%) under
`hmm-v1`. One note in eight is wrong, and wrong loudly: the notes lane sounds them, so a
practice pass is punctuated by shrieks.

`Clip octave outliers` does not help. It is display-only — it sets the lane's vertical scale
and never reaches `interpret()` — so the note list, and what you hear, are unchanged.

### Why this is not fixable upstream

The obvious instinct is to fix detection rather than patch its output. Measured, that door is
closed. Taking the F#5 at t=62.1 (neighbours F2 and G2, so the truth is almost certainly
F#2), YIN was re-run on that exact frame with progressively looser candidate settings:

| settings | is F#2 among the candidates? |
|---|---|
| shipped (`candidateThreshold` 0.6, `maxCandidates` 4) | no — `F#5 E3 B2 D3` |
| `maxCandidates` 12 | no |
| `candidateThreshold` 0.95, `maxCandidates` 12 | no |
| `candidateThreshold` 1.2, `maxCandidates` 20 | **yes — ranked 15th, p = 0.04** |

F#2's dip exists but is so shallow it needs a threshold above 1.0 to surface, and even then
the frame-local evidence still prefers F#5 (p = 0.10) by 2.5×. Recovering it inside
`viterbiPitch` would mean ~17 candidates per frame — that pass is O(candidates²), so roughly
13× slower — and reaching F#2 costs 36 semitones × 0.55 ≈ 20 in transition, which a gap that
small will never overcome.

**The frame does not contain the answer. The neighbouring notes do.** That signal exists only
at the note layer, which is why the correction belongs there and is not a workaround for
insufficient effort at the frame layer.

## Goals

1. Correct octave-outlier notes using melodic context, when that context is clear.
2. Leave every note **visible**, whether corrected or not, so the later editing phase has a
   record of what the detector actually said.
3. Never silently invent a pitch: a correction we cannot justify is marked, not guessed.

## Non-goals

- Replacing `Clip octave outliers`. It stays, unchanged, and stays display-only.
- Manual editing (layer 4). This produces the provenance that editing will consume; it does
  not add any editing UI. See [`docs/roadmap.md`](../../roadmap.md).
- Correcting anything other than whole-octave errors. A note a third out is out of scope.
- Changing detection, either interpreter, or the analysis layer.

## Success criteria

- On `ng_kipin`, the share of note time outside the band drops from 16.6% to under 2%.
  The residue is exactly the doubtful population, which by design keeps its detected
  pitch and therefore stays out of band — the criterion is met by folding the confident
  majority, not by moving everything.
- No folded note changes pitch class — verified by asserting `notesToChroma` is unchanged.
- Every flagged note is still drawn, in a colour distinct from an untouched note.
- The whole pass is under 5 ms on a 4-minute track: it runs on the main thread during a
  slider drag, like the rest of interpretation.

## Design

### Three states, and nothing is deleted

Every detected note stays in the list. A new optional `fix` field records what was done:

| state | `midi` | `fix` | lane colour | sounds? |
|---|---|---|---|---|
| untouched | as detected | absent | green `#8ee0ad` (dim `#4c8f6c`) | yes |
| **folded** | corrected | `{ from: 78, shift: -3 }` | **blue** `#6cc5e0` (dim `#3a7186`) | yes, at the folded pitch |
| **doubtful** | left as detected | `{ from: 78, doubt: true }` | **gray** `#5a5a68` (dim `#3a3a44`) | **no** |

Blue sits far from both green and the orange already used for out-of-range notes and the A–B
loop, so a folded note reads as neither "trusted" nor "off-scale". Gray recedes without
vanishing — the hint the editing phase needs: *here was a note, we did not trust it, you
decide.*

`fix.from` is the provenance record. It always allows recovering what the detector said,
which is what "overrides layered over derived notes" in
[`transcription.md`](../../transcription.md) requires of layer 4. It is present in **both**
non-empty states, even for a doubtful note where it necessarily equals `midi` — a consumer
should be able to read `fix.from` without first checking which state it is in.

Note that "delete" from the original discussion is **not** implemented as deletion. Removing
the notes would destroy exactly the evidence the editing phase needs.

### Choosing the band

Duration-weighted **median ± max(12, 3 × MAD)** semitones, computed **once, from the original
note list**, before any folding.

Weighted by duration for the same reason `pitchRange` is: a held tonic should define the
range, forty passing sixteenths should not.

A percentile band does **not** work here and the reason is worth recording: the outliers are
numerous enough to inflate their own band. At the 5th/95th percentile the band stretched to
E2–D#5 and caught only 14 of the 23 notes — it absorbed the very population it was meant to
exclude. Median and MAD are robust to a contaminated tail; percentiles at these fractions are
not. The `max(12, …)` floor stops a very steady singer producing a band so tight that ordinary
melodic movement reads as an outlier.

Measured bands: `threshold-v1` → C2–F#4 (median D#3, MAD 5); `hmm-v1` → D#2–D#4 (MAD 4).

### Choosing the fold

For each out-of-band note:

1. Find the nearest **in-band** note on each side. In-band, not merely adjacent — an outlier
   next to another outlier must not be judged against it.
2. Let `target` be the mean of whichever of those two exist.
3. Among octave shifts `k` in [−4, +4] whose result `midi + 12k` lands **inside the band**,
   pick the one minimising `|midi + 12k − target|`. On a tie, prefer the smaller `|k|`, and
   on a further tie the negative `k` — every shift measured on real material is downward, so
   an exact tie should not silently resolve upward.
4. If that distance ≤ 5 semitones (a fourth) and `k ≠ 0` → **fold**. Otherwise, or if neither
   neighbour exists → **doubtful**.

The band is fixed before this loop, so the result does not depend on the order notes are
visited. Because step 3 only considers shifts landing inside the band, no folded note can
still be out of band, and no second pass is needed.

Measured on `ng_kipin`: `threshold-v1` → 19 folded (15% of note time), 4 doubtful (1.6%);
`hmm-v1` → 36 folded (11.9%), 4 doubtful (1.8%). Every shift is downward, −1 to −3 octaves.

### Where it runs

A post-pass over the note list, applied inside `interpret()` after the chosen interpreter has
produced its notes. Both interpreters therefore get it, and it is governed by the same
interpretation parameters that already re-derive live on a slider drag.

It **changes the note list**, unlike clip. It has to: the synth reads `notes`, and the whole
point is that the corrected pitch is what sounds.

This is safe for key detection. Folding moves a note by whole octaves, so its pitch class is
unchanged and `notesToChroma` — which folds octaves together anyway — produces an identical
chroma vector. That is asserted in the tests rather than assumed.

### Audio

- A **folded** note sounds at its corrected pitch.
- A **doubtful** note is **not scheduled at all**. Sounding a note already flagged as
  untrusted would re-introduce precisely the wrong-octave blurt this feature removes. The
  cost is that ~1.6% of note time goes quiet; the note stays visible throughout.

### Controls

A new checkbox in the Advanced disclosure, **off by default**, beside the existing two:

- `notes.fold` — "Fix octave outliers" / 「修正八度異常值」
- `notes.foldTip` — states that it moves notes by whole octaves using neighbouring notes,
  that corrected notes are drawn in blue and untrusted ones in gray, and that nothing is
  removed.

Fold and Clip stay **separate controls**, because they answer different questions: clip
chooses the lane's *scale*, fold corrects a *pitch*. They compose — with fold on there is
simply far less left for clip to do.

## Testing

Units in `tests/pitch.test.js`, browser behaviour in `docs/behaviour.md`:

- A synthetic list with a planted 2-octave outlier between two in-band neighbours folds to
  the expected pitch, with `fix.from` preserved.
- An outlier with no in-band neighbour on either side becomes doubtful, not folded.
- An outlier whose best shift still lands more than a fourth from its neighbours becomes
  doubtful.
- The band is unchanged by the presence of outliers — build two lists differing only in an
  added outlier population and assert the same band, which is the property a percentile band
  fails.
- `notesToChroma` is byte-identical before and after folding.
- Note count is unchanged by the pass: nothing is added or removed.
- Off by default: with the box unticked the note list is identical to today's.
- Both new colours appear in the lane and the zoomed pane (`app.js` draws notes in two
  places — both need the new cases).

## Deferred

Manual editing of any of this, including accepting or rejecting an individual fold. Merging
adjacent notes. Correcting non-octave errors. Persisting corrections across a reload.
