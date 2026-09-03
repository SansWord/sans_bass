# Bass-derived guitar chords in the 簡譜 export

**Status:** design, approved 2026-09-03
**Scope:** `lib/chords.js` (new) + `notes.js`'s 簡譜 export (`jianpuHtml`, `fragmentHtml`,
the `listExport` click handler, `createNotesChannel`'s return value) + `tests/chords.test.js`
(new). No change to the live app UI, the ribbon, or the zoomed pane — this only affects the
HTML file produced by each channel's "Export list" button.

## Motivation

The 簡譜 export already lays vocal or bass notes into bars (`lib/jianpu.js`'s `layoutBars`).
A player reading that export on guitar still has to work out what chord to strum underneath
by ear. The bass line already implies that chord — its root, and often enough of its motion
(a walk up to the 4th, say) to imply a suspension — so the export can print the chord guess
directly above each bar without the player doing that work themselves.

## Goals

1. For every bar in a 簡譜 export (vocals' or bass's), detect a chord label from the *bass*
   channel's notes, independent of which channel is being exported.
2. Detect independently for each half of the bar, so a bar that moves from one chord to
   another (e.g. G → Gsus4) shows both.
3. Print the first half's chord at the top-left of the bar, and the second half's chord
   (only when it differs from the first) centered above the bar.
4. Do all of this with zero effect on an export when the bass channel has no analysed notes
   — same output as today.

## Non-goals

- Chord detection from anything other than the bass channel. Vocals never drive chord
  labels, even when exporting the vocal list.
- Any chord quality beyond triads + sus2/sus4 (no 7ths, no extensions, no inversions/slash
  chords). The bass line is monophonic; there usually isn't enough information in it to
  support more than that, and guessing further is more likely to mislead than help.
- Any UI for correcting or overriding a wrong chord guess. It's a best-effort label on a
  static export, not an editable field.
- Changing anything about how notes are laid into bars (`lib/jianpu.js`'s `layoutBars` is
  unchanged) or how the vocal/bass channel's own key (`jianpu.tonic`/`jianpu.mode`) is
  computed.

## Data model

### `lib/chords.js` — ESM, pure (mirrors `lib/jianpu.js`: no DOM, testable in isolation)

```js
export function detectChords(bassNotes, barBounds, tonicPc, mode) → Array<{ first, second }>
//   One entry per bar (barBounds.length - 1 entries, same convention as layoutBars).
//   first/second: a chord label string ("G", "Am", "Gsus4", "Bdim") or null.
//   `second` is already null whenever that half is silent OR resolves to the same label
//   as `first` — the caller renders whatever isn't null with no comparison of its own.
```

`tonicPc`/`mode` are the **bass channel's own** detected key (its `jianpu.tonic`/`jianpu.mode`
— populated automatically once the bass channel has notes, whether or not its 簡譜 checkbox
is on), not the exporting channel's.

### Per-half algorithm

For each half of each bar (split at the bar's time midpoint, not by beat count — this stays
correct under a non-4/4 `beatsPerBar`):

1. Collect every bass note overlapping the half window `[halfStart, halfEnd)`.
2. If none, this half's label is `null` (a rest stays a rest).
3. **Root:** the note with the greatest overlap duration inside the window
   (`min(note.end, halfEnd) - max(note.start, halfStart)`); ties broken by earliest `start`.
   Its pitch class (`note.midi % 12`, normalized 0–11) is the root.
4. **Diatonic quality:** look up the root's scale degree in the given key. `interval =
   ((rootPc - tonicPc) % 12 + 12) % 12`. If `interval` matches one of the key's 7 diatonic
   scale steps, its triad quality comes from a fixed per-mode table (below). If it doesn't
   (the longest note happened to be a chromatic passing tone), there is no diatonic quality
   — the label is the bare root name, no suffix.
5. **Suspension override — only when step 4 found a diatonic quality.** A chromatic root
   (no diatonic quality) skips this step entirely; its label is just the bare root name.
   Otherwise, the diatonic 3rd's pitch class is `rootPc + 3` for a minor or diminished
   triad, `rootPc + 4` for a major triad. Look at the OTHER distinct pitch classes sounding
   in the same half window (excluding the root's own pitch class). If any equals
   `(rootPc + 5) % 12` (perfect 4th above root) and none equals the diatonic 3rd, relabel as
   `sus4`. Else if any equals `(rootPc + 2) % 12` (major 2nd above root) and none equals the
   3rd, relabel as `sus2`. Otherwise the diatonic quality from step 4 stands.
6. Render the label: root name (`PITCH_CLASSES`-style, sharps only) + suffix — none for
   major, `m` for minor, `dim` for diminished, `sus2`/`sus4` for a suspension.

### Diatonic triad table

Same shape as `lib/jianpu.js`'s `MAJOR`/`MINOR` degree tables, but keyed by scale step
(0–6, not semitone) and yielding a quality instead of a scale-degree digit:

| Degree | Major key | Natural minor key |
|---|---|---|
| I / i | major | minor |
| II / ii | minor | dim |
| III / III | minor | major |
| IV / iv | major | minor |
| V / v | major | minor |
| VI / VI | minor | major |
| VII / VII | dim | major |

(Scale steps in semitones: major `[0,2,4,5,7,9,11]`, natural minor `[0,2,3,5,7,8,10]` — same
values `lib/jianpu.js` already uses to build its `MAJOR`/`MINOR` tables, just interpreted as
scale membership here instead of degree-digit lookup.)

## Integration in `notes.js`

### Exposing the bass channel's notes

`createNotesChannel`'s returned object gains one accessor, alongside `hasFrames`/`exportEntry`:

```js
function chordSource() {
  return hasFrames() ? { notes, tonicPc: jianpu.tonic, mode: jianpu.mode } : null;
}
```

The `listExport` click handler (shared shape, both channels) looks up the bass channel from
the module-level `channels` array — `channels.find((c) => c.stem === 'bass')` — and calls
`.chordSource()`. `null` (no bass stem loaded, or bass never analysed) means this export
carries no chord data at all, handled identically to today's export.

### Passing chords into the render

`jianpuHtml` gains an optional `chords` array (same length as `bars`, or omitted entirely).
When present, each bar's cell renders a chord slot above its note fragments; when absent,
the bar's markup is byte-for-byte what it is today.

### Rendering: `.bar` becomes a two-row flex column

```html
<span class="bar">
  <span class="chords">
    <span class="chord-first">G</span>
    <span class="chord-second">Gsus4</span>  <!-- only when present -->
  </span>
  <span class="frags"><!-- existing fragmentHtml() output, unchanged --></span>
</span>
```

```css
.bar { display: flex; flex-direction: column; flex: 1 1 0; min-width: 0;
       border-right: 2px solid #333; padding: 4px 16px; }
.chords { position: relative; height: 15px; margin-bottom: 2px; }
.chord-first { position: absolute; left: 0; top: 0; font-size: 13px; font-weight: 700; }
.chord-second { position: absolute; left: 50%; top: 0; transform: translateX(-50%);
                font-size: 13px; font-weight: 700; }
.frags { display: flex; align-items: center; justify-content: flex-start;
         flex-wrap: wrap; gap: 12px; min-height: 1.6em; }
```

`.chords` (the reserved slot) is only emitted when this export has chord data at all — an
export with no bass data renders no `.chords` element on any bar, so `.bar`'s total height
and appearance are unchanged from today. When chord data exists but a given bar's halves are
both silent, the (empty) `.chords` slot is still emitted, so every bar in the export reserves
the same vertical space and bars stay aligned along a line — same reasoning the existing
`.oct-up`/`.oct-down` spans already use for octave dots.

## Testing

`tests/chords.test.js`, plain Node tier (pure functions, no DOM — same tier as
`jianpu.test.js`). Cases:

- Root selection: longest-duration note wins over a shorter one that starts earlier or is
  lower in pitch; a tie in duration is broken by earliest onset.
- Diatonic quality: correct quality for all 7 degrees in both major and minor keys.
- Chromatic root (not diatonic to the key): bare root name, no quality suffix.
- Sus4 override: 4th present without the 3rd → `sus4`; 4th present WITH the 3rd → diatonic
  quality stands (no override).
- Sus2 override: analogous, with the major 2nd.
- Silent half: `null`.
- Same chord both halves: `second` comes back `null`.
- Different chords each half: both returned.
- A bar split at a non-4/4 midpoint (e.g. a 3-beat bar) still splits by time, not beat count.

## Edge cases

- No bass stem loaded for the current song: no chord data, export unchanged from today.
- Bass stem loaded but never analysed (Detect never run, or still running): same as above.
- Exporting the bass channel's own list: chords are still derived from bass notes — the
  export effectively annotates the bass line with the chord it implies, which is the same
  behavior as annotating the vocal line, just applied to itself.
- A note whose duration spans past a half-bar boundary: only the OVERLAPPING portion inside
  the half counts toward "longest duration," matching how `layoutBars` already treats a note
  crossing a bar boundary as split per-bar for its own purposes (though `detectChords` does
  not need to actually split/tie the note the way `layoutBars` does — it only needs the
  overlap duration inside each half window).
