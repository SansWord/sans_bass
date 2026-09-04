# Chord detection

The 簡譜 export can print a chord label above every half-bar. This is an offline export-time
analysis: it does not affect playback, the waveform, or note detection.

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

## Local chroma candidates

`detectChords()` decimates the whole harmonic mix once from 44.1 kHz to 22.05 kHz. For each
half-bar it then:

1. gates silence below -50 dBFS RMS;
2. applies a Hann window and calculates Goertzel power at MIDI 36--83 (C2--B5);
3. folds the 48 frequency powers into twelve pitch classes and normalizes them;
4. scores all 72 templates with Pearson correlation.

The vocabulary is deliberately limited to `maj`, `min`, `7`, `min7`, `sus2`, and `sus4`.
Templates are ranked rather than immediately collapsed to one answer. A diatonic major/minor
triad for the vocal key receives a modest `KEY_BONUS` of 0.25. That is a preference for sparse
arrangements, not a hard key constraint: a strong borrowed chord such as `Dm7` can still win
on its audio evidence.

## Sequence decoder

Local audio is often incomplete. For example, a window with only E and G# cannot distinguish
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

## Known limitations and future work

- Separation can leave chord tones weak or absent. No local chroma/key/bass method can prove a
  distinction when two chords share all audible pitch classes; the sequence prior is only a
  best guess.
- The current Goertzel chroma includes harmonic overtones as independent pitch-class energy.
  Overtone-corrected chroma (for example, a harmonic dictionary or NNLS approach) is the most
  promising signal-level follow-up.
- The transition model is a compact hand-written major-key prior. It has no learned corpus,
  no explicit minor-key functional grammar, and no user control.
- Chords are calculated on export and can make a long export pause briefly. If this becomes
  noticeable, move the pure calculation to a worker or cache the half-bar candidate sets.
- There is no correction UI. A future UI should edit labels after detection rather than change
  the audio or note-analysis data.

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
