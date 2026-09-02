# Tempo grid — BPM detection from the drums stem, visualised on the notes lane

**Status:** design, approved 2026-09-01
**Phase:** new — fills the `beat / tempo | not built` row in `docs/transcription.md`'s status
table.
**Branch:** `feat/tempo-grid`
**Scope:** a new `lib/tempo.js`; extensions to `notes.worker.js`, `notes.js`, `lib/ribbon.js`,
`app.js`; new controls in the notes panel; new i18n keys in both locales.

## Motivation

The notes lane already draws a pitch contour and 簡譜 degrees, but has no notion of *when*
the beat falls — every rhythmic question ("is this note early or on the beat?") has to be
answered by ear alone. `docs/transcription.md` already names this: `beat / tempo | not built`,
and the 簡譜 roadmap entry names rhythm notation (beams/dashes) as blocked on it.

This phase builds the first, display-only slice: detect BPM from the drums stem's onset
pattern, draw a beat/bar grid over the notes lane and the zoomed pane, and let the user correct
both the tempo and where beat 1 falls when detection gets it wrong — which, per
`docs/transcription.md`'s account of the *pitch* octave-error problem, tempo detection is
structurally prone to as well (locking onto 2× or ½× the true BPM).

A second, concrete problem this design solves: some songs carry spoken narration or a
rubato intro/outro with no steady pulse. Feeding the whole song to a tempo detector lets that
material drag the estimate off the song's actual tempo, so the user needs to be able to mark
which part of the song *is* the beat-carrying part — defaulting to the whole song, since most
tracks don't have this problem.

This is explicitly the **display groundwork**, not the rhythm-notation feature itself — see
Non-goals.

## Goals

1. Detect BPM and beat phase from the drums stem's audio, automatically, as part of the
   existing vocals analysis flow.
2. Draw a beat/bar grid on both the full-song notes lane and the zoomed pane, using the same
   blit-and-clip / live-draw split every other overlay there already uses.
3. Let the user correct BPM, phase, and beats-per-bar by hand, live, with no re-analysis.
4. Let the user restrict *what audio the detector looks at* to a sub-range of the song, to
   exclude a non-metrical intro/outro/narration section — default: the whole song.
5. Persist all of the above (detected or overridden) in the existing edits export/import JSON.

## Non-goals

- **No quantization of anything.** The grid never touches `interpret()`, `segmentNotes`, or the
  note list. A note's start/end time and pitch are exactly as detected or edited today,
  regardless of the grid. `docs/transcription.md` is explicit about why: singers push and lag
  against the band on purpose, and naive quantization to a beat grid adds errors rather than
  removing them. This design does not revisit that conclusion.
- **No 簡譜 rhythm notation** (beams/dashes for note duration). That is the next phase this one
  is groundwork for, and it needs its own design — assigning a *duration class* to a note from
  the grid is a different problem than drawing the grid.
- **No metronome / audio click.** Verification is visual, against the drums waveform lane the
  player already draws.
- **No time-signature changes mid-song, no tempo changes mid-song (rubato, ritardando).** One
  BPM and one phase for the whole song. A song with a tempo change is a known limitation, not
  silently mishandled — the grid will visibly drift out of alignment in the affected section,
  which is itself information.

## Design

### Architecture

```
drums stem buffer (optionally range-sliced)
    │
    │  lib/tempo.js: onsetEnvelope() → estimateTempo()      runs in notes.worker.js
    ▼
{ bpmValue, phaseSec, confidence }              phaseSec is relative to the ANALYSED SLICE
    │
    │  notes.js stores as tempo.{bpmValue, phaseMs, ...}, converts phaseSec to
    │  song-absolute time by adding the slice's start offset
    ▼
tempo state (auto until user edits, like jianpu)
    │
    │  lib/ribbon.js: beatTimes(tempo, duration) — pure geometry, same pattern as
    │  pitchRange/contourColumns
    ▼
[{ t, bar }, …]
    │
    │  app.js draws into the ribbon's pre-rendered layers + the zoomed pane's live paint()
    ▼
grid lines on the notes lane and zoomed pane
```

### `lib/tempo.js` (new, ESM — mirrors `lib/pitch.js`'s split)

Two pure functions, unit-testable without a worker:

- **`onsetEnvelope(channels, sampleRate)`** → `{ env: Float32Array, hopSeconds }`. Downmixes to
  mono (same summing approach as `decimate()`), then computes short-time RMS energy in ~10 ms
  hops and half-wave-rectifies the frame-to-frame difference. This is **broadband energy flux**,
  not spectral flux — deliberately, since implementing an FFT by hand is unwarranted extra
  surface area when broadband energy is already a strong signal on a stem that Demucs has
  already isolated to be percussion-dominant. No low-pass filtering: unlike `decimate()` (built
  for pitch, where high frequencies are noise), onset detection wants the transient energy that
  a low-pass would blur.
- **`estimateTempo(env, hopSeconds, opts)`** → `{ bpmValue, phaseSec, confidence }`.
  Autocorrelates the envelope over the lag range corresponding to **40–240 BPM**, picks the lag
  with the strongest normalised peak as the beat period, then finds `phaseSec` by testing
  offsets within one period and choosing the one that maximises the envelope's value at the
  predicted beat times. `confidence` is the normalised autocorrelation peak height — surfaced in
  the UI as a rough "how sure" signal, not gated on (detection always returns a value; a low
  confidence is the user's cue to check it by eye and adjust manually).

Neither function touches the DOM, a worker, or `notes.js` state — same isolation rule as
`lib/pitch.js`.

### Worker protocol (`notes.worker.js`)

Two changes:

1. The existing `{ type: 'analyse', channels, sampleRate }` message grows an optional
   `drums: { channels, sampleRate }` field. When present, the worker also runs
   `onsetEnvelope` + `estimateTempo` on it and includes `tempo` in the response:
   `{ type: 'frames', frames, tempo: { bpmValue, phaseSec, confidence } | null }`. This is the
   path the existing Go button uses — one worker round trip computes both vocals frames and
   drum tempo, per the earlier decision to bundle detection into Go.
2. A new standalone message type, `{ type: 'tempo', channels, sampleRate }` →
   `{ type: 'tempo', tempo: {...} }`, used by the **"Re-detect tempo"** button (see below) so
   that narrowing the analysed range doesn't require re-running the ~7 s vocals pass to get a
   fresh tempo estimate. `notes.js` spins a short-lived worker instance for this the same way
   `analyse()` already does, just posting a different message type.

`notes.js` is the caller in both cases: it reads `stemBuffer('drums')`, and if a `tempoRange`
is set, **slices the channel arrays to that range before posting** (not after) — this both
keeps the protocol simple (the worker never needs to know about ranges, only the audio it was
given) and reduces the data transferred for a narrow selection. `frames.candidates`-style
structured-clone caveats don't apply here: `tempo` is a small plain object, no typed arrays
cross back.

**Absolute time correction.** `phaseSec` returned by `estimateTempo` is relative to the start
of whatever slice was analysed. `notes.js` converts it to song-absolute time by adding
`tempoRange ? tempoRange.from : 0` before storing it as `tempo.phaseMs`. Getting this wrong
would make the grid line up inside the analysed window and drift everywhere else — called out
explicitly here because it is the one place a silent off-by-`range.from` bug would hide.

### State in `notes.js`

Two new pieces of state, following the existing `jianpu` pattern (`auto` stays true until the
user edits a control, at which point it becomes an override good for *this song only* and is
discarded on the next load — same reasoning `jianpu.auto` already documents):

```js
let tempo = { on: true, auto: true, bpmValue: 120, phaseMs: 0, beatsPerBar: 4, confidence: 0 };
let tempoRange = null;   // { from, to } in seconds, or null = whole song (the default)
```

- `tempo.on` defaults to **true** once a value exists — unlike `jianpu.on` (a reading-mode
  transform, opt-in by design), the grid is a passive overlay like the pitch contour, so there
  is no surprise in showing it as soon as it's available.
- Touching the BPM field, phase field, or beats-per-bar selector sets `tempo.auto = false` —
  same effect as touching the key selectors does for `jianpu.auto`.
- `reset()` (on song change) restores both `tempo` and `tempoRange` to their defaults, exactly
  as it already does for `jianpu`.
- `reinterpret()`'s existing `window.sansBass.setNotes({ notes, frames, params, clip, jianpu })`
  call grows a `tempo` field carrying `{ on, bpmValue, phaseMs, beatsPerBar }` — `app.js` reads
  it from the `ribbon` object exactly the way it already reads `ribbon.jianpu`.

### BPM range selection

A new toggle, **"Select BPM range"**, enabled once a drums stem exists. While armed, dragging
on the **drums stem's own waveform lane** (one of the six per-stem lanes, not the notes ribbon)
draws a selection — reusing the amber-band visual language `paintRangeBand` already established
for the notes ribbon's range-delete, but as new, independent state (`tempoRangeDrag` /
`tempoRange`) and its own toggle, not the note-editing `rangeSelection`. Unlike the ribbon's
range-select (confined to a bottom strip because the rest of the canvas has competing note-edit
gestures), the drums lane has no such conflict, so the whole lane is the drag surface once the
mode is armed; with the mode off, the lane's existing click/drag-to-scrub behaviour
(`attachSeek`) is unchanged.

A caption under the drums lane names the current selection (or "whole song") with a "Clear"
action back to `tempoRange = null`. Selecting a range does **not** itself trigger detection —
the user presses Go (first run) or **"Re-detect tempo"** (subsequent runs) to act on it.

### Grid geometry — `lib/ribbon.js`

One new pure function, same shape as `pitchRange`/`contourColumns`:

```js
/**
 * Beat and bar times across the song, in seconds, given a tempo config and duration.
 * `phaseMs` is normalised into [0, periodMs) before generating — so a nudge that pushes
 * it negative or past one period is still well-defined, rather than needing to be clamped
 * at the UI layer.
 */
function beatTimes(tempo, duration) {
  // → [{ t, bar }, …] for every beat from the normalised first beat to `duration`,
  //   `bar: true` every `beatsPerBar`-th one.
}
```

Pure arithmetic — no autocorrelation, no worker — so it re-runs on every keystroke/nudge with
no perceptible cost, the same "cheap enough to re-derive live" property `reinterpret()` already
relies on for note interpretation.

### Rendering — `app.js`

- **Full-song lane:** grid lines drawn into the ribbon's pre-rendered idle/active layers
  alongside the pitch contour, using `beatTimes` — same blit-and-clip pattern as every other
  ribbon overlay. Bar lines drawn taller/stronger than plain beat ticks.
- **Zoomed pane:** drawn live in the existing per-frame `paint()`, the same as the pitch
  contour and note boxes there — a beat tick or bar line only needs `beatTimes` filtered to the
  pane's visible window.
- Both read `ribbon.tempo` (the payload `reinterpret()` now sends) and skip drawing entirely
  when `tempo.on` is false or `ribbon.tempo` is absent (drums stem never analysed).

### Controls

New row in the notes panel, alongside the existing 簡譜 row:

| control | behaviour |
|---|---|
| **Show tempo grid** (checkbox) | `tempo.on`; on by default once detected |
| **BPM** (number input, step 0.1) | `tempo.bpmValue`; editing sets `tempo.auto = false` |
| **×2 / ÷2** (mini buttons beside BPM) | halves/doubles the current BPM value — the single most common correction for the tempo-doubling failure mode |
| **Phase** (number input, ms, can be negative) + **±** nudge buttons | `tempo.phaseMs`; editing sets `tempo.auto = false` |
| **Beats per bar** (select: 2/3/4/6, default 4) | `tempo.beatsPerBar` |
| **Select BPM range** (toggle button) | arms drag-select on the drums lane, see above |
| **Re-detect tempo** (button) | re-runs tempo-only detection using the current `tempoRange`, without re-running vocals analysis |
| status line | shows detected BPM/confidence, so auto vs overridden is visible — same role `foldStats` already plays |

All controls except the panel-level checkbox go visibly inert (disabled, not hidden) when no
drums stem is present, matching how `foldTol`/`keyTonic` etc. already go inert when their
governing checkbox is off.

### Persistence & export

The existing edits export/import JSON (`el.exportBtn`/`el.importBtn` in `notes.js`) grows two
additive, backward-compatible fields:

```json
{
  "tempo": { "on": true, "bpmValue": 128, "phaseMs": 340, "beatsPerBar": 4 },
  "tempoRange": { "from": 12.4, "to": 210.0 }
}
```

An import missing either field leaves the current/auto-detected values in place — same
tolerance the existing import handler already shows for missing `params`/`jianpu`. Both reset
to default on a new song load, same as every other per-song override in this file.

### i18n

New keys in `lib/i18n.js`, both locales, following the existing `notes.*` naming and the
label/tooltip pairing convention already used for `fold`/`jianpu`: show-grid label + tooltip,
BPM/phase/beats-per-bar labels, range-select button label + tooltip, re-detect button label,
status-line template. Exact copy is an implementation detail; `tests/i18n.test.js` already
enforces that both locales gain every new key together.

## Success criteria

- On a song with a steady drum pattern, the detected BPM is correct or a clean 2×/½× multiple
  of the correct value (verifiable by eye against the drums waveform lane's transients).
- Toggling the grid, editing BPM/phase/beats-per-bar, and re-detecting after narrowing the
  range all update the drawn grid with no re-analysis of the vocals stem.
- A song with a non-metrical intro (tested against a real narration-led track in this repo's
  `stems/`) detects a materially better BPM once the range excludes the intro than it does over
  the whole song.
- The note list, `interpret()` output, and 簡譜 degrees are byte-identical with the grid on or
  off — asserted in tests, not just claimed.
- Export → import round-trips `tempo` and `tempoRange` exactly.

## Testing

Units in a new `tests/tempo.test.js` (mirrors `tests/pitch.test.js`'s split of analysis vs.
interpretation):

- `onsetEnvelope` on a synthetic click track (impulses at a known period) produces peaks at the
  expected hops.
- `estimateTempo` on synthetic click tracks at several known BPMs (including one deliberately
  ambiguous between BPM and 2×BPM) returns the expected value or its documented ambiguity.
- `estimateTempo`'s phase output on a synthetic track with a known offset matches that offset.
- `beatTimes` (in `tests/ribbon.test.js` or wherever `pitchRange`/`contourColumns` are already
  covered): correct spacing from BPM, correct bar flagging from `beatsPerBar`, correct
  normalisation of a `phaseMs` outside `[0, periodMs)`, correct behaviour when `duration` is
  shorter than one beat.
- `tests/i18n.test.js` continues to pass with the new keys (parity is automatic, not a new
  test).
- A regression test asserting `interpret()`'s output is unaffected by any tempo state — guards
  the "no quantization" non-goal directly rather than relying on code review to keep it true.

Manual verification (one consolidated task, per this project's convention of a single
end-to-end pass rather than per-task browser checks): load a song with a drums stem via the
notes panel, run Go, confirm the grid appears and visually tracks the drum transients; use ×2/÷2
and the phase nudges and confirm the grid updates live; arm range-select, exclude a narrated
intro, press Re-detect, and confirm the BPM changes without the vocals note count changing;
export and re-import the edits file and confirm the grid state round-trips.

## Deferred

簡譜 rhythm notation (beams/dashes) built on top of this grid. A metronome click. Mid-song
tempo changes. Automatic detection of a non-metrical intro (the user marks it by hand in this
phase). Using the grid to inform note segmentation in any way.
