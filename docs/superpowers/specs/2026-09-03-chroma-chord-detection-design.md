# Chroma-based chord detection for the 簡譜 export

**Status:** design, approved 2026-09-03
**Supersedes:** [`2026-09-03-bass-chord-detection-design.md`](2026-09-03-bass-chord-detection-design.md)
**Scope:** `lib/chroma.js` (new), `lib/chords.js` (rewritten — same exported name
`detectChords`, new signature and internals), `lib/pitch.js` (export the existing `pearson`
helper — no behavior change, just an added `export` keyword so `lib/chroma.js` can reuse it
instead of duplicating it), `notes.js`'s `listExport` click handler and
`createNotesChannel`'s `chordSource()`, `tests/chroma.test.js` (new), `tests/chords.test.js`
(rewritten). No change to `lib/jianpu.js`, the rendering markup/CSS in `notes.js`
(`jianpuHtml`/`fragmentHtml`/the `.chords`/`.chord-first`/`.chord-second` structure), the
live app UI, the ribbon, or the zoomed pane.

## Motivation

The bass-derived approach shipped in the superseded spec picks the longest-overlapping bass
note per half-bar and force-fits its pitch class onto a fixed diatonic-triad table for the
song's detected key. Measured against a real reference chord chart (`examples/nov_you.zip`,
transcribed by ear — A, E/G#, F#m, E, D, Dm7, A, F#m, Bm7, E... in A major), this produces
audibly wrong labels for three structural reasons, not tuning:

1. **The bass note isn't always the chord root.** `E/G#` is a first-inversion E chord — the
   bass deliberately plays the 3rd. Picking "the note that occupied the window longest" and
   calling it the root has no way to represent that; it mislabels the chord entirely rather
   than just missing the inversion.
2. **The diatonic table is closed-world.** Every chord is forced onto one of 7 triads in a
   single fixed key. `Dm7` is a borrowed iv7 (modal mixture from A minor) — not diatonic to A
   major — and the table can't produce a 7th regardless, since it only stores triad quality.
3. **A single pitch cannot carry chord quality.** Root, 3rd, 5th, and (for a 7th chord) 7th
   all have to sound together for major/minor/7th to be distinguishable at all. One bass note
   per half-bar, however accurately tracked, is the wrong *kind* of signal for this question.

This redesign replaces the bass-note-as-root approach with the MIR-standard technique:
extract a chromagram (12-bin pitch-class energy) directly from the harmonic instruments'
audio, and match it against a dictionary of chord templates. This needs multiple
simultaneous notes as input — which the harmony instruments (guitar/piano/bass, not bass
alone) actually provide — rather than a single tracked pitch.

## Goals

1. For every bar in a 簡譜 export, detect a chord label per half-bar from a chromagram
   computed over whichever of the `guitar`/`piano`/`bass` stems are loaded for the current
   song (mixed together), independent of which channel is being exported.
2. Support a chord vocabulary of `{maj, min, 7, min7, sus2, sus4}` — covers everything in the
   reference chart plus the two sus qualities the superseded approach already had.
3. When the bass channel has analysed notes, detect slash chords: if the actual bass note in
   a half-bar differs from the chroma-matched chord's root, label it `Root/BassNote` (e.g.
   `E/G#`) instead of just `Root`.
4. Chord detection no longer depends on the song's detected key at all — template matching is
   against absolute chord shapes, so a wrong key estimate can no longer produce a wrong chord
   guess the way the diatonic-table approach could.
5. Degrade gracefully: any subset of `{guitar, piano, bass}` being loaded (down to just one)
   still produces chords from whatever is mixed in; zero of the three loaded produces no
   chord data at all, identical in effect to today's "no bass stem" case.
6. Keep `detectChords()`'s per-bar `{first, second}` output contract exactly as it is today,
   so `notes.js`'s rendering side (`jianpuHtml`/`fragmentHtml`, the `.chords` markup and CSS)
   needs no changes.

## Non-goals

- Overtone-corrected chroma (NNLS-style least-squares fitting against a harmonic dictionary,
  as Chordino does). Naive Goertzel-summed chroma is a known-simpler baseline with a known
  failure mode (a note's odd harmonics land partly in other pitch classes, biasing toward
  fifth/relative confusions). This is deliberately deferred: implement naive chroma, measure
  it against the `examples/nov_you.zip` reference chart, and only add overtone correction if
  that specific error pattern actually shows up — not speculatively.
- Any confidence threshold or "uncertain" marker on a chord guess. Always render the top
  template match, same as the superseded approach never gated on confidence either.
- Beat-synchronous or HMM-smoothed chord tracking across bars. Bar boundaries are already
  known (`barBounds`, from the existing tempo grid) before chord detection runs; there is no
  separate frame-rate chord layer and no cross-bar smoothing pass.
- Any UI for correcting or overriding a wrong chord guess — unchanged from the superseded
  spec's non-goal.
- Chord qualities beyond the agreed vocabulary (no maj7, dim, aug, 6, add9, ...).
- Using the song's detected key to disambiguate a near-tied template match. Worth revisiting
  later (see Goal 4's note), not built now.

## Data model

### `lib/chroma.js` — new, ESM, pure (mirrors `lib/tempo.js`: no DOM, no AudioContext, no Worker — signal in, symbolic answer out)

```js
export function chromaFromAudio(samples, sampleRate, tStart, tEnd, opts) → Float32Array(12)
//   One chroma bin per pitch class (index 0 = C, same convention as notesToChroma() in
//   lib/pitch.js), normalized to sum 1. All-zero when the window is silent.

export function matchChordTemplate(chroma) → { rootPc, quality, score } | null
//   null when chroma is all-zero (silent window). Otherwise the best-scoring template.
```

**`chromaFromAudio`:**

1. Target frequencies: MIDI notes 36 (C2, 65.41 Hz) through 83 (B5, 987.77 Hz) inclusive — 48
   notes, 4 full octaves, 12 pitch classes × 4. Frequencies computed via `hzFromCents` from
   `lib/pitch.js` (`hzFromCents(midi * 100)`), reusing the existing A4=440 anchor rather than
   a second conversion convention.
2. For each target frequency, a Hann-windowed Goertzel power computation over
   `samples[tStart*sampleRate, tEnd*sampleRate)` — one multiply-add pass per sample, same
   shape as `yinFrame`'s own difference-function loop in `lib/pitch.js`. No FFT.
3. Fold: `chroma[midi % 12] += power` for each of the 48 targets.
4. Silence gate: compute the window's RMS *before* Goertzel folding (same window of samples).
   If RMS falls under `silenceDb: -50` (converted to linear RMS the same way
   `TRACK_DEFAULTS.silenceDb` already is in `lib/pitch.js`'s `f0Track`), skip straight to
   returning an all-zero 12-vector — matches the "silent half → null" convention the
   superseded spec already established, and reuses its exact threshold value/conversion.
5. Otherwise normalize the 12-bin vector to sum 1 (same normalization `notesToChroma()`
   already uses), and return it.

**`matchChordTemplate`:**

1. `CHORD_QUALITIES`: interval sets in semitones from the root —
   `maj: [0,4,7]`, `min: [0,3,7]`, `7: [0,4,7,10]`, `min7: [0,3,7,10]`, `sus2: [0,2,7]`,
   `sus4: [0,5,7]`.
2. Build 72 templates (12 roots × 6 qualities): a 12-bin vector with `1` at each interval's
   pitch class (rooted at that root), `0` elsewhere.
3. Score every template against the input chroma via the same Pearson-correlation helper
   `detectKey()` already uses internally in `lib/pitch.js` — exported as part of this change
   (see Scope) and imported here, rather than duplicating a second correlation
   implementation.
4. Return the highest-scoring `{rootPc, quality, score}`. All-zero input chroma (from the
   silence gate above) short-circuits to `null` before scoring.

### `lib/chords.js` — rewritten, same isolation rules as before

```js
export function detectChords(harmonicSamples, sampleRate, barBounds, bassNotes)
  → Array<{ first, second }>
//   harmonicSamples: mono Float32Array, the sum of whichever of guitar/piano/bass are
//   loaded (assembled by the caller — see Integration below). sampleRate: harmonicSamples'
//   own rate (44100, per this project's fixed AudioContext rate).
//   bassNotes: the bass channel's tracked notes for slash-chord fusion, or null when the
//   bass channel has no analysis yet. Same per-bar `{first, second}` shape as before —
//   `second` is null whenever that half is silent OR resolves to the same label as `first`.
```

First, once for the whole song (not repeated per half-bar): decimate `harmonicSamples` via
the existing `decimate()` from `lib/pitch.js`, factor 2 (44100 → 22050 Hz — comfortably above
the ~988 Hz top target frequency, unlike the pitch-tracking default factor of 4, which is
tuned for a different frequency range). `decimate()`'s cost is linear in signal length
regardless of how the result is sliced afterward, so there's no benefit to decimating each
half-bar's audio separately.

Then, per half-bar (same split-at-midpoint convention as the superseded spec — by time, not
beat count, so a non-4/4 `beatsPerBar` still works):

1. Call `chromaFromAudio()` on the decimated audio for `[halfStart, halfEnd)`.
2. Call `matchChordTemplate()`. `null` (silent window) → this half's label is `null`.
3. **Slash-chord fusion** (only when `bassNotes` is non-null): find the bass note with the
   greatest overlap duration inside `[halfStart, halfEnd)` (this is the superseded spec's
   `pickRoot()`, kept verbatim but re-described — it now answers "what note is actually in
   the bass," not "what is the chord root"). If no bass note overlaps the window, no fusion
   happens for this half (chroma-matched root+quality renders alone). If the bass note's
   pitch class differs from `matchChordTemplate()`'s `rootPc`, the label becomes
   `{root}{qualitySuffix}/{bassNoteName}`; otherwise the slash is omitted.
4. Suffix table: `{maj: '', min: 'm', 7: '7', min7: 'm7', sus2: 'sus2', sus4: 'sus4'}`
   (extends the superseded spec's `{major: '', minor: 'm', dim: 'dim'}` — `dim` drops out
   since it's not in the agreed vocabulary).
5. `second` is set to `null` whenever it's silent or its rendered label string equals
   `first`'s — same convention as before.

## Integration in `notes.js`

### Assembling the harmonic mix

Replaces `bassChannel.chordSource()`'s single lookup with two independent inputs, both
gathered in the `listExport` click handler:

```js
// Sum whichever of guitar/piano/bass are loaded for this song. Plain sample-for-sample sum
// — no per-stem weighting, since chromaFromAudio() normalizes its output regardless of
// input loudness. Empty array (none loaded) → no chord data at all.
const HARMONIC_STEMS = ['guitar', 'piano', 'bass'];
const loaded = HARMONIC_STEMS
  .map((stem) => window.sansBass.stemBuffer(stem))
  .filter(Boolean);
const harmonicSamples = loaded.length ? mixDown(loaded.map((s) => s.buffer)) : null;
// harmonicSamples: { samples: Float32Array, sampleRate } | null
```

`mixDown` is a small new helper alongside the click handler (not exported — only used here):
sums each loaded `AudioBuffer`'s channels to mono first (same averaging `onsetEnvelope()`
already does for multi-channel input in `lib/tempo.js`), then sums those mono signals
sample-for-sample, zero-padding the shorter ones to the longest buffer's length (stems can
differ slightly in length after separation). `sampleRate` on the returned object is read from
any one of the input buffers — this project's fixed 44100 Hz `AudioContext` rate (see
`CLAUDE.md`'s hard constraints) means every loaded stem's buffer already shares one rate, so
there's nothing to resample or reconcile between them.

### Slash-chord input

```js
const bassChannel = channels.find((c) => c.stem === 'bass');
const bassNotes = bassChannel && bassChannel.chordSource() ? bassChannel.chordSource().notes : null;
```

`chordSource()` on `createNotesChannel`'s returned object narrows to just what fusion needs
— `{ notes }` — dropping `tonicPc`/`mode` (no longer needed anywhere in chord detection,
per Goal 4). Still `null` when the bass channel has no analysed notes yet; that now only
costs the slash notation, not the whole chords row (Goal 5).

### Calling detectChords

```js
const chords = harmonicSamples
  ? detectChords(harmonicSamples.samples, harmonicSamples.sampleRate, barStarts, bassNotes)
  : undefined;
```

Same `undefined`-means-"no `.chords` element on any bar" convention as before — unchanged on
the `jianpuHtml`/`fragmentHtml` rendering side.

## Testing

`tests/chroma.test.js`, plain Node tier (pure functions, no DOM — same tier as
`tests/chords.test.js`/`tests/jianpu.test.js`):

- `chromaFromAudio`: a synthetic 440 Hz sine tone over a window produces its peak bin at
  pitch class A (9); a synthetic tone one octave up (880 Hz) folds into the same pitch class;
  a silent (all-zero) window returns an all-zero vector; the RMS-based silence gate rejects a
  very quiet but non-zero signal below `silenceDb: -50`.
- `matchChordTemplate`: a hand-built chroma vector with energy only at C/E/G returns
  `{rootPc: 0, quality: 'maj'}`; one at C/D#/G returns `min`; one at C/E/G/A# returns `7`; one
  at C/D#/G/A# returns `min7`; one at C/D/G returns `sus2`; one at C/F/G returns `sus4`; an
  all-zero vector returns `null`.

`tests/chords.test.js`, rewritten, same tier:

- Per-half-bar labeling from synthetic summed-sine-wave buffers at known chord-tone
  frequencies (e.g. an A-major triad's frequencies for one half, an E-major triad's the
  next) → expects `"A"` then `"E"`.
- Slash-chord fusion: synthetic `bassNotes` whose pitch class deliberately differs from the
  chroma-matched root (the E/G# case) → expects `"E/G#"`. Matching pitch class → no slash.
- `bassNotes: null` (bass not analysed) → plain root+quality labels, no slash, on the same
  chroma input that produces a slash when `bassNotes` is supplied.
- Silent half (all-zero harmonic audio in that window) → `null`.
- Same chord label both halves of a bar → `second` comes back `null`.
- A bar split at a non-4/4 midpoint still splits by time, not beat count (kept from the
  superseded spec's test list — the split logic is unchanged).

**Manual verification (single task, end of implementation, per this project's convention of
consolidating browser verification rather than repeating it per task):** run the real export
flow against `examples/nov_you.zip` (Detect run on guitar, piano, and bass; export the 簡譜
list) and compare the generated chord row against the reference chart transcribed in this
conversation (`A, E/G#, F#m, E, D, Dm7, A, F#m, Bm7, E...` in A major). This is the actual
acceptance check for whether the redesign fixes the real problem — not a per-task substitute
for it.

## Edge cases

- None of guitar/piano/bass loaded for the current song: no chord data, export unchanged
  from having no bass stem today.
- Exactly one of the three loaded (e.g. only bass, if a song's separation is incomplete):
  chord detection still runs on that single stem's chroma — a strictly better signal than
  the superseded approach's single-note-as-root (template matching against whatever chroma
  energy is actually present, rather than a forced diatonic lookup), though still weaker than
  having all three; no special-cased code path, same pipeline either way.
- Bass stem loaded but never analysed (Detect never run, or still running): chords still
  render from whichever of guitar/piano are loaded (if any); slash notation is simply absent,
  same as the "bass not analysed" case in Goal 5.
- A harmonic-stem buffer shorter than the bar grid's last boundary (separation sometimes
  trims silence): `mixDown`'s zero-padding means the tail half-bars see silence there, which
  the RMS silence gate already handles as `null` — no separate bounds check needed.
- A bass note whose duration spans past a half-bar boundary: only the overlapping portion
  inside the half counts toward "longest duration" for slash-fusion purposes, same treatment
  the superseded spec already gave this case.
