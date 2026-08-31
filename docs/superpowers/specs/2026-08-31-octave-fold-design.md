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

`Fit the lane to the melody` (formerly `Clip octave outliers`) does not help. It is display-only — it sets the lane's vertical scale
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

This is the **泛音 / harmonic** error — the detector locking onto an overtone and reading too
high. It is the mirror image of the **次諧波 / subharmonic** error that `hmm-v1` was built for
in v1.12.0, which reads an octave *low*. Both dips sit in the same CMND curve; only the
subharmonic one is reachable from inside a frame. See
[`transcription.md` → Two octave errors](../../transcription.md) for the full comparison.

### Why whole octaves is the right operation

Measured across every outlier in `ng_kipin`, the errors land on **powers of two**:

| harmonic | notes | interval | octave-foldable? |
|---|---|---|---|
| 2nd, 4th, 8th | **19** | 1, 2, 3 octaves | yes — pitch class preserved |
| 3rd, 6th | **4** | octave + a fifth | **no** — and they are not cleanly separable; see the correction below |

All 19 power-of-two cases preserve pitch class, which is exactly why folding leaves the key
estimate untouched. The four odd-harmonic cases are unreachable by any whole-octave shift:
B4 between G3 and D3 implies E3 (3rd harmonic, 0.5 semitones off), and A#4 between two D#2s
implies D#2 (6th, exactly 0).

**Correction (2026-08-31, after code review).** An earlier draft of this spec claimed the
confidence test "separates those two populations exactly". That was circular: notes were
classified as power-of-two *because* they folded within the threshold, so the separation was
true by construction and could not have come out otherwise.

Classified independently — by which harmonic actually explains each note given its
neighbours — the populations **overlap**:

| | foldable (2nd/4th/8th) | unfoldable (3rd/6th) |
|---|---|---|
| `threshold-v1` | residual 0 – 3.5 | residual 2 – 7 |
| `hmm-v1` | residual 0 – 3 | residual 1.5 – 7 |

**Read those lower bounds with caution.** A second, independent measurement — a different
harmonic classifier and an ffmpeg rather than `decodeAudioData` decode path — put the
unfoldable minimum at **2.5 on both interpreters**, not 2 and 1.5. The exact figure is
sensitive to how a note is attributed to a harmonic and to how the audio was decoded, so
neither run is authoritative to a half semitone. What both agree on is the shape: the
populations overlap, and the overlap begins above the chosen threshold. Both runs also agree
that `confidentWithin: 2` still admits no odd-harmonic error, so 1.5 has real margin rather
than sitting on a boundary — which was the failure of the original 5.

The arithmetic explains why. A power-of-two error leaves a residual of exactly **0** after the
right octave shift; a 3rd- or 6th-harmonic error leaves **4.98** — just under the original
threshold of 5, which therefore sat *on* the failure mode rather than between the populations.
At that setting, 10 of 14 odd-harmonic errors on `threshold-v1` were folded and tagged
confident: drawn blue, sounded as trusted, a fifth wrong. Exactly what Goal 3 forbids.

The threshold bounds the **residual**, not the error. When the neighbours themselves sit a
fifth from the truth, a 6th-harmonic error lands on them with residual 0 and no threshold can
see it — inherent to a neighbour-only method, and the reason this can reduce the problem but
never eliminate it. Melodic movement blurs both distributions further, so **no threshold
separates them cleanly**. The
design therefore errs toward never lying: `confidentWithin` is **1.5**, which on this material
admits no odd-harmonic error at all, at the cost of roughly half the true corrections — those
become doubtful instead, marked in gray for the editing phase to resolve. Raising it trades
that guarantee for coverage.

Correcting the odd-harmonic cases properly would change pitch class and so break the
key-detection guarantee; it remains out of scope.

## Goals

1. Correct octave-outlier notes using melodic context, when that context is clear.
2. Leave every note **visible**, whether corrected or not, so the later editing phase has a
   record of what the detector actually said.
3. Never silently invent a pitch: a correction we cannot justify is marked, not guessed.

## Non-goals

- Replacing the lane-scale control. It stays display-only; it was renamed from `Clip octave
  outliers` to `Fit the lane to the melody` because the old name read as though it removed
  notes, and sat one word from `Fix octave outliers`.
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
| **folded** | corrected | `{ from: 78, state: 'folded', shift: -3 }` | **blue** `#6cc5e0` (dim `#3a7186`) | yes, at the folded pitch |
| **doubtful** | left as detected | `{ from: 78, state: 'doubt', doubt: true }` |

**Is gray actually reachable?** A code review raised the concern that a doubtful note, being
by definition far from the median, would always fall outside the lane's clipped display range
and so draw in the out-of-band orange instead — which would mean the "you can see where to
intervene" promise was not delivered in the default view. Measured on `ng_kipin` at
`minDurationMs: 100`, it does not hold: **12 of 16** doubtful notes draw gray under
`threshold-v1` and **27 of 32** under `hmm-v1`; every folded note draws blue. The two windows
are different — the fold band is a robust median ± max(12, 3×MAD), while the lane range is
`pitchRange`'s duration-weighted 3rd–97th percentile ±1.5, which here is the wider of the two
(37.5–76.5 against the fold band's ~36–66).

The minority that *do* draw orange are correct: a note you cannot see at all is a more urgent
fact than a note we could not correct, so out-of-band keeps precedence over provenance.

**Contrast.** The gray must clear the 3:1 floor for a non-text graphical object in **both**
variants, not just the active one — `paint()` blits the idle (dim) layer across the whole lane
and clips the active layer only over the played portion, so dim is what a note looks like for
most of a listen, and the note name is drawn on top of the fill. The first values chosen
(`#5a5a68` / `#3a3a44`) measured 2.7:1 and 1.6:1 against the lane background, i.e. below the
floor in both, with the name at 1.5:1 when dim — illegible on exactly the note the user is
being asked to judge. Shipped values are `#a8a8b8` / `#70707f`, measuring **7.8:1 and 3.8:1**,
still clearly recessive beside plain green's 11.7:1. **gray** `#5a5a68` (dim `#3a3a44`) | **no** |

Blue sits far from both green and the orange already used for out-of-range notes and the A–B
loop, so a folded note reads as neither "trusted" nor "off-scale". Gray recedes without
vanishing — the hint the editing phase needs: *here was a note, we did not trust it, you
decide.*

`fix.from` is the provenance record, and a fold shifts the measured `cents` rather than
re-quantising them, so the singer's detune survives. Together they allow recovering what the
detector said,
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
4. If that distance is **at most** `confidentWithin` (**1.5** semitones) and `k ≠ 0` →
   **fold** (the comparison is `bestD > confidentWithin` → doubt, so exactly 1.5 folds).
   Otherwise, or if neither neighbour exists → **doubtful**. See the correction above for why
   this is 1.5 and not the 5 an earlier draft specified.

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
