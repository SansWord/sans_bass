# Pitch detection — notes and key from a vocal stem

**Status:** design, approved 2026-08-30
**Scope:** proof of concept. `lib/pitch.js` + `tests/notes.html` + `tests/pitch.test.js`. No app wiring.

## Motivation

Separation already produces an isolated, near-monophonic vocal stem. Pitch tracking on a
full mix is hard because of polyphony; on a solo vocal it is a solved problem. That makes
note extraction — and eventually 簡譜 — reachable without leaving the constraints of this
repo.

This PoC exists to answer one question: **are the extracted notes good enough to build on?**
Feasibility is not in doubt. Output quality is.

## Goals

1. Extract note events (pitch, start, duration) from a vocal stem.
2. Estimate the key, and say how confident that estimate is.
3. Present both in a form that can be checked against a guitar by hand.

## Non-goals

Explicitly out of scope, to be revisited only after the PoC is judged:

- Tempo, beat tracking, rhythmic quantization, barlines.
- 簡譜 rendering.
- Any change to `index.html`, `app.js`, `separate.js`, or the UI.
- Bass or any non-vocal stem (the interface admits it; no code for it now).
- Sonification of detected notes.
- i18n. The bench page is a developer tool, like `tests/parity.html`, and is English-only.

## Success criteria

The PoC succeeds if, on a track from `stems/reborn/`, the phrase view is recognisable
enough to play along with on guitar, and the key estimate is correct or is wrong with a
visibly small margin. Judgement is manual and by ear; there is no automated accuracy metric
at this stage.

## Architecture

### `lib/pitch.js` — ESM, pure

Sits with `lib/overlap.js` and `lib/wav.js` as an ESM analysis module. It touches no DOM,
no `AudioContext`, and no Worker. It takes a `Float32Array` and returns data.

That purity is the whole point of the boundary: the bench page calls it on the main thread,
and when the app adopts it later the same module goes inside a Worker unchanged.

```js
export function detectNotes(samples, sampleRate, opts) → { notes, frames }
//   notes:  [{ start, end, midi, cents, name, confidence }]
//     start/end seconds; midi integer; cents absolute (MIDI 69 = 6900); name "E4"
//     equal-temperament deviation is derived: cents − midi×100, range −50..+50
//   frames: { t, f0, conf }   parallel Float32Arrays, for diagnosing a bad note

export function notesToChroma(notes) → Float32Array(12)   // duration-weighted
export function detectKey(chroma)    → { key, tonic, mode, margin, ranked }
```

**`detectKey` takes a bare 12-vector.** It does not know or care whether that vector came
from vocal notes or from a chromagram. Extending to bass later means adding a
`chroma(samples, sampleRate)` that returns the same shape, and nothing in `detectKey`
changes. This is the only concession to the future in the design, and it costs nothing now.

A consequence worth stating: because a duration-weighted note histogram is cleaner than a
chromagram on monophonic material, **the PoC needs no FFT at all**.

### Where the app would wire it in, later

`app.js` is a classic script and cannot import an ESM module. The separation panel
(`separate.js`) is already ESM and is where the "after separation" flow lives, so that is
the natural host. Deferred; noted here so the module's format is not mistaken for an
oversight.

## Algorithm

### 1. Decimate 4:1, 44100 → 11025 Hz

Downmix to mono by averaging channels. Apply a 63-tap Hamming-windowed sinc lowpass with a
5 kHz cutoff, then keep every 4th sample.

The lowpass is load-bearing. Decimating without it aliases content above 5512 Hz straight
down into the f0 search range, where it is indistinguishable from a real fundamental.

Sung f0 spans roughly 80–1100 Hz, so an 11025 Hz rate (Nyquist 5512) leaves ample headroom
while cutting the cost of the lag search by ~16×.

### 2. YIN per frame

Window 512 samples (46 ms), hop 128 (11.6 ms → 86 frames/sec). Each frame reads
512 + 138 = 650 samples. Lag search τ ∈ [10, 138], which is 1102 Hz down to 79.9 Hz.

1. Difference function: `d(τ) = Σ_{j<W} (x[j] − x[j+τ])²`
2. Cumulative mean normalised difference: `d'(0) = 1`,
   `d'(τ) = d(τ) / ((1/τ) Σ_{j=1..τ} d(j))`
3. Absolute threshold: first local minimum with `d'(τ) < 0.1`; if none, the global minimum.
4. Parabolic interpolation around that τ for sub-sample precision.
5. `confidence = 1 − d'(τ)`

Cost: 512 × 128 ≈ 65 k operations per frame, ~20,600 frames for a 4-minute song,
≈ **1.3×10⁹** total. Single-digit seconds on the main thread. No Worker for the bench page.

For contrast, the same search undecimated at 44.1 kHz — window 2048, τ ∈ [40, 552], at the
same 11.6 ms hop — is ~2.1×10¹⁰ operations, the 16× noted above, and tens of seconds rather
than single digits. That difference is what makes the pure-DSP approach viable and a
downloaded model unnecessary.

### 3. Voicing gate and smoothing

A frame is unvoiced when `confidence < 0.5`, or when frame RMS falls below about −50 dBFS
(the silence between phrases). Voiced f0 is converted to cents and passed through a 5-frame
median filter, which is what removes isolated octave errors.

`cents = 1200·log2(f0 / 440) + 6900`  (MIDI 69 = A4 = 6900 cents)

### 4. Segmentation

Walk the voiced frames, holding a running median of the current note's cents. Close the
current note and open a new one when either:

- an unvoiced gap of ≥ 2 frames occurs, or
- pitch departs the running median by more than 60 cents for ≥ 3 consecutive frames.

A closed note takes the median of its frames as its pitch. Notes shorter than 80 ms are
discarded.

Every threshold above — 0.1, 0.5, −50 dBFS, 5, 2, 60, 3, 80 — is a starting guess, exposed
through `opts` and overridable from the bench page's query string, in the manner of
`parity.html`'s `?window=`.

### 5. Key — Krumhansl-Schmuckler

Build a 12-bin pitch-class histogram from the notes, weighted by duration. Normalise.
Pearson-correlate against 24 candidates: the Krumhansl-Kessler major and minor profiles,
each rotated to all 12 tonics.

```
major: 6.35 2.23 3.48 2.33 4.38 4.09 2.52 5.19 2.39 3.66 2.29 2.88
minor: 6.33 2.68 3.52 5.38 2.60 3.53 2.54 4.75 3.98 2.69 3.34 3.17
```

Return the ranked list and the **margin** between first and second place. Also print the
winner's relative major or minor explicitly as a caveat.

That caveat is the known weak point: a key and its relative share all seven pitch classes,
so A minor and C major are separable only by which degrees carry weight. K-S guesses from
tonic and dominant emphasis, and on pop vocals it guesses wrong a fair amount. Reporting
the margin is what turns a silent error into a visible one.

## Bench page — `tests/notes.html`

Modelled on `tests/parity.html`: standalone ESM page, `?track=<name>&stem=vocals`, fetches
from `/stems/reborn/<track>/<stem>.m4a`, decodes through an `AudioContext` pinned to 44100,
and publishes `window.__notes` on completion.

Three output blocks:

1. **Key** — winner, margin, top 5 ranked, relative-key caveat line.
2. **Phrase view** — note names in sequence, starting a new line on any gap > 300 ms. This
   is the block that gets read while holding a guitar.
3. **Note table** — index, start (mm:ss.mmm), duration (ms), name with octave (`E4`), MIDI,
   cents deviation from equal temperament, confidence.

The cents-deviation column earns its place. If every note reads about +30 cents, the record
sits sharp of A440, and without that column the detector takes the blame for a tuning offset.

## Tests — `tests/pitch.test.js`

Added to the dynamic-import list in `tests/test.html`. All inputs synthesised, so no audio
files and no network:

- YIN on sines at 82.41, 220 and 1046.5 Hz resolves within 1 cent (both ends of the range).
- White noise and digital silence both read unvoiced.
- The anti-alias filter passes 300 Hz and attenuates 8 kHz.
- A synthetic f0 track holding two steady pitches with a gap segments into exactly two notes.
- A sub-80 ms blip is dropped.
- `detectKey` returns C major and A minor for the corresponding synthetic histograms.
- `detectKey` results are ordered and carry a margin.
- `notesToChroma` weights bins by duration rather than by note count.

No `?v=` bump this round: nothing new is referenced from `index.html`, so
`tests/versions.test.js` is unaffected. The bump belongs to the commit that wires the module
into the app.

## Risks

**Vibrato is the main one.** The 60-cent threshold and the median filter absorb moderate
vibrato, but a singer swinging ±100 cents will fragment into repeated notes. This is the
most likely way the output disappoints, and measuring it is what the PoC is for. Possible
responses — a longer analysis window, or detecting the vibrato rate and collapsing across it
— stay deferred until there is real output to look at.

**Portamento.** Sung slides between notes produce a ramp with no steady median. Expect
spurious short notes along the slide; the 80 ms floor removes some of them.

**Consonants and breath.** Plosives and sibilance are aperiodic and should fall to the
voicing gate, at the cost of clipping the start of some notes.

## Later — what to do with the notes

Kept here so the PoC stays small, in rough dependency order:

- **Sonify the detected notes** through an `OscillatorNode`, played against the stem.
  Errors become audible immediately; a much higher-bandwidth check than reading a table.
- **Bass chromagram into `detectKey`.** Bass notes land on chord roots and supply the tonal
  centre a melody lacks. The strongest available fix for the relative-key ambiguity, and
  something only a stem player can do.
- **Beat tracking on the drums stem** → tempo and a beat grid → note durations, then
  barlines. Beat tracking on an isolated drum stem is far easier than on a mix.
- **簡譜 rendering.** Movable-do from the detected key. Digits, underlines for subdivision,
  dots for octave, dashes for held beats, `0` for rests. More amenable to HTML and CSS than
  staff notation.
- **Pitch ribbon on the vocal lane**, synced to the playhead — the read-along form, useful
  for practice without needing a correct rhythmic transcription.
- **Export.** MIDI, MusicXML, or plain 簡譜 text.
