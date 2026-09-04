# Chord detection

The Find notes action also calculates a chord label for every half-bar. Results appear as a
time-aligned band in the zoomed panel, can be corrected there, and the current edited labels
are reused by 簡譜 export. Chord calculation does not alter playback or note detection.
Full-bar grid lines continue through that band, with lighter half-bar separators between
adjacent chord windows.
The shared edits JSON stores manual chord corrections as `{start, label}` entries. The audio-
derived candidates are recalculated on import and corrections are reapplied by interval start.
It also stores the song-level capo setting. Detected labels and corrections remain in concert
pitch; the zoom band and notation export transpose only their displayed play shapes downward
by the selected fret count, including both sides of slash chords.

The implementation is split between `lib/chroma.js` (audio to chord candidates),
`lib/chords.js` (candidate sequence to labels), and `notes.js` (audio/key/bass wiring).

## Inputs

`notes.js` mixes every loaded `guitar`, `piano`, and `bass` `AudioBuffer` into mono. It
averages each buffer's channels first, then sums the stems and zero-pads shorter stems. The
mix is deliberately independent of the notes channel being exported: a vocals export and a
bass export see the same harmony.

The bass notes are a separate, optional input. They are only used to render slash notation.
If bass analysis has not run, chords still export from guitar/piano/bass audio, just without
`Root/Bass` labels.

The key is also separate. It comes only from the vocal channel's current 簡譜 key:

- after vocal analysis, that is the automatic vocal-key estimate unless the user changes it;
- after a user changes the vocal tonic or mode picker, the user choice is used;
- before either condition, there is no key prior rather than an invented C-major prior.

The bass key is intentionally never read for chord matching.

When Find notes starts both vocals and bass workers, chord calculation waits for both to
finish. This lets its first and only pass use all available vocal-key and bass-inversion
evidence. The chord UI reports **Waiting for note detection…** during that dependency, then
**Detecting chords…** while the actual chroma/sequence calculation runs. With only one melodic
stem present, calculation begins as soon as that channel finishes.

## Hierarchical bar and half-bar candidates

`detectChords()` decimates the whole harmonic mix once from 44.1 kHz to 22.05 kHz. It measures
both halves and the full bar. For each window it:

1. gates silence below -50 dBFS RMS;
2. applies a Hann window and calculates Goertzel power at MIDI 36--83 (C2--B5);
3. folds the 48 frequency powers into twelve pitch classes and normalizes them;
4. scores all 72 templates with Pearson correlation.

The vocabulary is deliberately limited to `maj`, `min`, `7`, `min7`, `sus2`, and `sus4`.
Templates are ranked rather than immediately collapsed to one answer. A window needs at
least -42 dBFS RMS and a winning raw template correlation of 0.55 to count as strong; the
older -50 dBFS chroma gate remains the hard definition of digital silence. Matches within 0.12
of the best local rank (up to four) are retained as editing suggestions. A diatonic major/minor
triad for the vocal key receives a modest `KEY_BONUS` of 0.25. That is a preference for sparse
arrangements, not a hard key constraint: a strong borrowed chord such as `Dm7` can still win
on its audio evidence.

Half-bars remain the primary change detector, while the full bar is supporting evidence:

- two strong halves with the same chord and bass spelling merge into one full-bar interval
  when the full bar agrees;
- one strong and one weak half become one full-bar interval when the full bar supports the
  strong half;
- two different strong halves remain separate, as do matching roots whose slash bass changes;
- two weak halves produce one blank full-bar interval, even if normalization could force a
  recognizable shape from their residue.

This avoids inventing a second chord from a quiet tail without mixing two real half-bar chords
into one averaged label.

## Sequence decoder

Local half-bar audio is often incomplete. For example, a window with only E and G# cannot distinguish
`E/G#` from `C#m/G#` reliably. `decodeChordProgression()` therefore runs a small Viterbi pass
over the top 18 candidates in every contiguous non-silent run of half-bars.

The local template rank remains the emission score. Transition scores are intentionally small:
they prefer staying put, circle-of-fifths motion, nearby root movement, and (when a major vocal
key exists) common I--V--vi--IV / ii--V movement plus IV--iv--I modal mixture. Silence breaks
the sequence; the decoder never smooths through a silent half-bar.

This is a prior, not musical truth. It should help decide between nearly plausible local
answers, never replace clearly contradictory audio.

## Rendering slash chords

After the sequence decoder picks a template, the bass note that overlaps the half-bar longest
is selected. If its pitch class differs from the selected root, the label adds a slash, such
as `E/G#`. The slash note is not used as the root and does not alter the key.

Each export bar remains `{ first, second }`. `second` is omitted when silent or equal to
`first`, preserving the renderer's original contract.

## Capo display transform

Capo is a presentation and export transform, never a detector input. For fret `n`, roots and
slash bass notes are shifted down `n` semitones using the app's sharp pitch-class spelling;
quality suffixes such as `m7`, `7`, `sus2`, and `sus4` are unchanged. The vocal key remains
the detected concert key while the zoom UI additionally shows the transposed play key.
Unrecognized free-form corrections are left unchanged rather than guessed at.

## Known limitations and future work

- Separation can leave chord tones weak or absent. No local chroma/key/bass method can prove a
  distinction when two chords share all audible pitch classes; the sequence prior is only a
  best guess.
- The current Goertzel chroma includes harmonic overtones as independent pitch-class energy.
  Overtone-corrected chroma (for example, a harmonic dictionary or NNLS approach) is the most
  promising signal-level follow-up.
- The transition model is a compact hand-written major-key prior. It has no learned corpus,
  no explicit minor-key functional grammar, and no user control.
- Chords are currently calculated on the main thread after note detection. If this becomes
  noticeable on long songs, move the pure calculation to a worker.

## Regression check

Use `examples/nov_you.zip` for a real-song check:

1. Run `npm run dev`, load the zip, and run **Find notes**.
2. Set the vocal key to A major for the known reference chart.
3. Correct the detected tempo from 48 to 96 BPM before exporting; the automatic estimate can
   return the half-tempo pulse for this song.
4. Export either notes channel and compare early labels with the reference progression:
   `A, E/G#, F#m, E, D, Dm7, A, F#m, Bm7, E...`.

The current implementation is better than the former bass-root-only approach and reaches the
early `A` / `E/G#` inversion, but the entire chart is not yet a strict acceptance pass. Record
any mismatch with its bar time, BPM/phase, vocal key setting, and the loaded stems before
tuning scores: that distinguishes a grid error from an audio-evidence limitation.
