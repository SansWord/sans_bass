# 簡譜 — notes as scale degrees, in a key you can choose

**Status:** design, approved 2026-08-31
**Phase:** C3. Follows octave folding (v1.13.0, merged as #16).
**Scope:** a new `lib/jianpu.js`; key detection wired into the player for the first time;
three controls in the notes row; three draw sites in `app.js`.

## Motivation

The notes lane names pitches absolutely — `G F D# F D# D C# D# F G A#3 C F …`. That is the
right output for checking a transcription against a keyboard, and the wrong one for reading a
melody. A player reading 簡譜 wants **scale degrees**: the same phrase as `5 4 ♭3 4 ♭3 2 …`,
where the shape of the line is visible and the key is stated once at the top.

Absolute names also carry an octave on every block, which is noise at reading speed — the
octave belongs on the axis, not repeated on each note.

**Half of this already exists and has never been used.** `detectKey()` (Krumhansl-Schmuckler
over a duration-weighted chroma) and `notesToChroma()` have been in `lib/pitch.js` since
v1.10.0, exercised only by the bench page. `docs/transcription.md` has listed the key estimate
as "**bench page only**; no player UI" ever since. This is that UI.

## Goals

1. Show each note as a scale degree instead of an absolute name.
2. Pick a sensible key automatically, and make it trivial to overrule.
3. Keep octave information where it is still needed — on the axis — in proper 簡譜 form.

## Non-goals

- Rhythm notation. 簡譜 proper carries beams, dashes and dots for duration; this shows pitch
  only, on the existing time axis. Rhythm needs beat tracking, which is a separate phase.
- Export, printing, or a 簡譜 *document*. This is a display mode for the lane.
- Changing detection, folding, or any note data. Nothing here alters `notes`; it is a
  presentation layer over the same list.
- Persisting the choice across reloads.

## Success criteria

- With 簡譜 on, `1=C major` renders C as `1`, C♯ as `♯1`, E♭ as `♭3`; `1=C minor` renders
  E♭ as `3`; `1=G major` renders C as `4`.
- The detected key is the initial selection, and one click swaps it for its relative.
- The pitch axis distinguishes octaves; the note blocks do not repeat them.
- Switching display mode never re-**analyses**: no worker, no YIN, no new frames.

  > **Amended after implementation (v1.14.0).** This criterion originally also forbade
  > calling `interpret()` and required the switch to complete "under a frame". Both were
  > wrong to demand. Every other display-only control in the panel — `clip` above all —
  > already routes through `reinterpret()`, and inventing a second path for 簡譜 alone would
  > have made the notes panel keep two ways of issuing a payload that must not disagree.
  > Measured cost of the re-interpretation is ~40 ms, which cannot disturb the transport
  > (that lives on the audio clock, not on rAF). The criterion that actually protects the
  > user is the analysis one, which holds. The real cost is that `resync()` restarts the
  > note tones and `setNotes()` re-centres the zoom window on a pure display toggle — worth
  > fixing if a display-only path is ever built for other reasons, and not before.

## Design

### The mapping — `lib/jianpu.js`

A **classic script** (`window.SansJianpu`), matching `lib/ribbon.js` and for the same reason:
`app.js` does the drawing and cannot `import`. Pure, no DOM, unit-testable.

```js
degreeOf(midi, tonicPc, mode) -> { digit, accidental, octave }
```

`digit` is `1`–`7`, `accidental` is `''`, `'#'` or `'b'`, and `octave` is a signed offset from
the reference octave (see below). Scale degrees follow the **mode's own scale**:

| mode | semitones from 1 that are degrees 1–7 |
|---|---|
| major | 0 2 4 5 7 9 11 |
| natural minor | 0 2 3 5 7 8 10 |

Everything else is spelled by convention:

| | chromatic notes |
|---|---|
| major | ♯1 ♭3 ♯4 ♭6 ♭7 |
| minor | ♯1 ♯3 ♯4 ♯6 ♯7 |

Minor takes sharps because its flat degrees are already *in* the scale — ♭3, ♭6 and ♭7 are
degrees 3, 6 and 7 — so the chromatic notes above them are raised, not lowered. This is why
the mode selector genuinely changes the numbers rather than just relabelling: in `1=C major`
E♭ is `♭3`, and in `1=C minor` the same pitch is `3`.

### Octaves, and where they go

The note blocks show **no octave**. The axis shows it in proper 簡譜 form: a dot above the
number for each octave up, below for each octave down, bare in the reference octave.

**The reference octave is the one containing the duration-weighted median pitch** — the same
statistic `pitchBand` and `pitchRange` already use, so the bare-number band is the one the
singer actually lives in rather than an arbitrary C-to-B.

### Controls

Three, in the **main notes row** beside the count — not under Advanced, since this is a
reading preference rather than a tuning knob:

```
229 notes  [Hide notes]   [☐ 簡譜]   1 = [C ▾]  [major ▾]  [⇄]
```

- **簡譜** — a checkbox. Off by default; the lane shows absolute names as it does today.
- **1 =** — twelve pitch classes. Which pitch class is degree 1.
- **major / minor** — two options. Changes what the degrees *mean*, per the table above.
- **⇄ relative** — one click swaps the current selection for its relative: `1=A minor` becomes
  `1=C major`, and again returns. `relativeKey()` already exists in `lib/pitch.js` and
  round-trips exactly, so this is a call, not new logic.

The three key controls are disabled and dimmed while 簡譜 is off, following the Fold tolerance
pattern from v1.13.0.

**Why the relative button earns its place.** A key and its relative contain the same seven
pitch classes and are separated only by which degrees carry weight. On a vocal stem that
margin is often thin, so detection cannot reliably choose between them — `detectKey` returns
`relative` precisely to say so. Rather than pretend the guess is authoritative, the button
turns the ambiguity into a one-click choice between the two real candidates.

### Defaults

Both selectors are initialised **from `detectKey()`** on the notes, whenever a detection run
completes: `A minor` sets `1=A` and `minor`. Major is only the markup default, before any song
is loaded.

The alternative considered was pinning the mode to major always and letting `1=` follow the
relative major. Rejected because it would leave the minor option reachable only by hand, and
make the automatic default ignore half of what detection found. The ⇄ button makes the other
reading one click away either way, so nothing is lost.

### Where it plugs in

`notes.js` computes the key after each interpretation — `detectKey(notesToChroma(notes))` — and
puts the current 簡譜 selection into the `setNotes` payload beside `clip`, since like `clip`
it is a **display choice that never reaches `interpret()`**. `app.js` reads it at the three
sites that render note identity:

| site | today | with 簡譜 on |
|---|---|---|
| lane note blocks (`app.js:805`) | `n.name` — `A#3` | `♭7` |
| zoom pane blocks (`:925`) | `n.name` | `♭7` |
| lane pitch axis (`:~758`) | `NOTE_LETTERS[pc] + octave` | digit + octave dots |
| zoom pane pitch axis (`:~920`) | `NOTE_LETTERS[pc] + octave` | digit + octave dots |

> **Amended after implementation (v1.14.0).** This table originally listed one axis, and the
> first implementation converted only the lane's — leaving the zoom pane drawing degree
> blocks against a note-name axis. That is the pane a pitch is actually read off (this spec
> says so itself, under Controls), so it is the one place the feature's whole thesis — *the
> octave belongs on the axis* — most needed to hold. Both axes now carry degrees and dots.
> The bright gridline moved with them: it marked C in every key, which is meaningless in
> 1=G and put the highlighted rule and the highlighted label on different rows.

### Interaction with octave folding

A folded note's degree comes from its **corrected** pitch, which is the point — a note fixed
from F♯5 to F♯2 should read as the degree it actually is. The consequence worth knowing: the
簡譜 reading changes when the fold controls change, because folding changes `midi`. That is
correct behaviour, not a bug, and belongs in the behaviour docs so it is not mistaken for one.

Folding preserves pitch class, so a fold never changes a note's *digit* — only which octave
dot it carries.

## Testing

Units in a new `tests/jianpu.test.js`, browser behaviour in `docs/behaviour.md`:

- The three worked examples from the request: `1=C major` → C♯ is ♯1 and E♭ is ♭3;
  `1=C minor` → E♭ is 3; `1=G major` → C is 4.
- All twelve pitch classes in both modes, against the tables above.
- Every tonic: transposing the tonic by *n* semitones transposes every input by *n* and leaves
  the degree unchanged — the property that makes it a movable-do system.
- Octave offsets are signed and relative to the reference octave, and a note an octave up
  keeps its digit.
- `relativeKey` round-trips: applying the ⇄ swap twice returns the original selection.
- Off by default: with the checkbox unticked the lane draws the same absolute names as before,
  byte-for-byte.

## Deferred

Rhythm notation, export, persistence, and using the detected key for anything other than the
initial selection. Showing detection confidence (`margin`) in the UI — worth doing once there
is evidence about what a useful threshold looks like on real material.
