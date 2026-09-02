# Tuning cases — where music-domain knowledge changes the right answer

A log of cases where the pitch/note pipeline (`lib/pitch.js`) produced a wrong or missing
result not because of a coding bug, but because a parameter encoded an assumption about the
music — an instrument's tuning, its playable range, a genre convention — that turned out not
to hold for a specific song. Generic DSP work (get the FFT right, get the thresholds right)
can't catch these; they need someone who knows the instrument.

The pattern to watch for: a note is visibly missing or wrong, the pitch *contour* still looks
plausible, and the true note turns out to sit right at the edge of — or just past — a range
the code assumed was wide enough. Read this file before assuming a new "note missing" report
is a fresh bug; it may be another instance of the same shape.

## Case 1 — a half-step-down bass reaches below standard E1

**Symptom:** `6 南國的風`'s bass stem, note detection shows a pitch contour at 1:42 and
2:07–2:09 but no note. The user identified the pitch by ear as D#1.

**Domain fact:** a standard 4-string bass (E-A-D-G) bottoms out at open E1, 41.2 Hz. But
tuning the whole instrument down a half step — Eb/D# standard — is a common choice in rock
and metal, and it moves every open string down with it: the low E string becomes D#1
(38.9 Hz). A 5-string bass goes lower still with a low B string (B0, 30.9 Hz standard, lower
again if also down-tuned). None of this is visible from the audio alone without either
knowing the song or trying a wide-enough search range.

**Root cause:** `BASS_RANGE.tauMax` in `lib/pitch.js` was set to 269 (a floor of 41.0 Hz),
tuned specifically to reach open E1 on a *standard-tuned* 4-string bass — see
`docs/transcription.md`'s original `BASS_RANGE` measurement. D#1 sits below that floor, so
YIN's search window never contains a lag long enough to represent its true period. It doesn't
fail as silence: it locks onto a boundary-clamped reading near the edge of the range
(~41 Hz, ~90 cents off true pitch, but with deceptively high confidence), which is why a
contour was visible but never held together into a clean note.

**Fix:** widened `tauMax` to 300 (a 36.7 Hz floor, one whole tone below standard E1) — enough
margin for a half-step-down tuning without extending arbitrarily far. Measured on the real
stem: 269 misses the note, 285 (barely below D#1) finds it but fragments it near the search
edge, 300 resolves it as one clean note, and 320 (more margin) gives an identical result to
300 — so 300 is the floor, not a round number picked in advance. Full measurement table in
`docs/transcription.md` under "The `tauMax` floor was tuned to standard E1". Shipped in
v1.18.6, then superseded the same session by Case 2 below — `tauMax` now sits at 379.

**Where it's encoded:** `BASS_RANGE` in `lib/pitch.js`; the comment there records the specific
tuning this was chosen to cover to date. `tests/pitch.test.js` pins the D#1 case with a unit
test so a future regression is caught immediately rather than rediscovered by ear.

**If this happens again:** before touching parameters, ask what tuning or instrument could
put the true note below the current floor — drop tunings (drop D puts the low string at D1,
36.7 Hz), a 6-string's low B or high C, or a baritone guitar. Re-run the measurement
methodology in `docs/transcription.md` (the bench page at
`tests/notes.html?stem=bass&tauMin=...&tauMax=...&window=...`) against the real stem rather
than guessing a new constant — the project's own history (this case, and the original
`BASS_RANGE`/`window` tuning) is that the right value only reveals itself by measuring the
actual audio, and that "wider is safer" is false once the search range starts finding
harmonics instead of missing notes.

## Case 2 — widening ahead of a confirmed case: 5-string low B, an accepted accuracy trade

**This one is different in kind from Case 1: nothing was broken.** No song in this project
has a 5-string bass. This case is here because the decision to widen anyway — and the
measured cost of doing so — is exactly the kind of thing a future session (or a future
contributor) needs to find before re-deriving it from scratch.

**Domain fact:** a 5-string bass adds a low B string below standard E-A-D-G, at B0
(30.9 Hz standard — lower again if also down-tuned). Common in metal and modern
hardcore/metalcore, less traditional in classic punk, but plausible for a band on the heavier
end of the genre.

**Decision:** `BASS_RANGE` was widened to `tauMax: 379, window: 1408` (B0 with one semitone
of margin, holding the periods-per-window ratio near ~3.7) *before* any song required it,
purely to have headroom ready. This inverts Case 1's methodology: Case 1 only shipped after
proving a real note on real audio was recovered with no regression elsewhere; this one
shipped on cost analysis and a documented, accepted risk, because no 5-string stem exists
here to prove the benefit against.

**The accepted cost, measured on the two tracks Case 1 was validated against — neither of
which contains a B0:** octave-outlier time share rises (2.8%→3.4% on `6 南國的風`,
6.9%→7.2% on `9 繼續向前行`), near-zero-gap note fragmentation ticks up, and on
`9 繼續向前行` the whole track's duration-weighted median note shifts down a semitone
(B1→A#1) — a small systematic pull toward lower readings, not just isolated edge noise.
Decode cost roughly doubles (+88.6% vs the 300/1024 floor). None of this is severe, and the
D#1 case from Case 1 stays clean under the wider settings — but it is a real, measured
accuracy cost paid on every song, for a case none of the current songs have. Full tables in
`docs/transcription.md` under "Widened again for 5-string headroom".

**Where it's encoded:** `BASS_RANGE` in `lib/pitch.js` (comment records both widenings and
the trade); `tests/pitch.test.js` pins B0 resolving correctly, alongside the still-passing
D#1 and E1 pins from Case 1.

**If this trade reads wrong for a future song** — a normal-range bass track that used to
transcribe cleanly now shows more fragmented or octave-confused notes — the fix is *not* to
narrow `BASS_RANGE` back down globally, which would just resurrect Case 1's D#1 problem. It's
to make the range a per-song override (not built as of this writing — the interpretation
layer in `docs/transcription.md` already supports per-call `opts`, so this is a matter of
exposing it, not architecting it) so a normal 4-string song and a down-tuned 5-string song
can each get the floor that fits them, instead of one shared constant serving both.
