# Export 簡譜 note list as Markdown — design

**Status:** approved, ready for planning
**Related:** [`docs/transcription.md`](../../transcription.md), `lib/jianpu.js`, `notes.js`

## Problem

The Notes panel can already export the edit history as JSON (`#notes-export` /
`notes-edits.json`), for round-tripping edits between sessions. That format is not meant to be
read by a person.

There is no way to get a human-readable list of the 簡譜 (numbered notation) sequence out of the
app — something to print or read on a second screen while singing along, without needing the
player open. This adds that: a second, independent export that turns the current note
interpretation into a plain-text/Markdown list of scale degrees, chunked into fixed-length time
blocks with a timecode header per block.

## UI

A new row `#notes-list-io`, placed immediately after the existing `#notes-io` row (JSON
export/import), so it reads as a distinct feature rather than a variant of the edits export:

```
[10] sec/line   [Export list]
```

- `#notes-list-secs` — `<input type="number" min="3" max="60" step="1" value="10">`. The line
  duration in seconds. Persists only for the session (no localStorage) — same lifetime as every
  other notes-panel control.
- `#notes-list-export` — `<button class="mini">`. Disabled whenever the key selectors are
  disabled: no 簡譜 key set, or no notes yet. Enablement piggybacks on the existing
  `syncJianpuControls()` group (`el.keyTonic`/`el.keyMode`/`el.keyRel`) — add this button to that
  same disabled/enabled list. The list is meaningless without a key, so it should never be
  clickable while the key selectors are greyed out.

Both controls get `data-i18n`/`data-i18n-attr` entries in `lib/i18n.js`, in both `en` and
`zh-TW`, following the file's existing key-naming pattern (`notes.listSecs`, `notes.exportList`,
plus a tooltip key if the number input needs one — check the file's convention for whether plain
number inputs get tooltips elsewhere before adding one).

## Data flow

Triggered entirely from existing in-memory state in `notes.js` — no worker call, no
re-analysis:

1. Read `secs = Number(el.listSecs.value)` (fall back to 10 if empty/NaN — the input has `min`/
   `max`/`step` but a user can still clear it).
2. Guard: if `!notes.length || !jianpu.on`, do nothing (button should already be disabled, but
   the handler stays defensive like the rest of this file).
3. `const refOct = window.SansJianpu.referenceOctave(notes, jianpu.tonic);` — the same call
   `app.js` uses for the ribbon, so the export's octave-0 register always matches what's on
   screen.
4. Sort is not needed — `notes` is already time-ordered (interpret()/applyEdits() preserve
   order; confirm this holds, or add `.slice().sort((a,b) => a.start - b.start)` defensively if
   not).
5. Bucket notes into fixed windows of `secs` seconds starting at 0 (`windowIndex =
   Math.floor(note.start / secs)`), grouping by **start** time only — a note that runs past its
   window's end stays in the window it started in. This falls out naturally from bucketing by
   start time; no special-casing needed.
6. Skip any window index with zero notes (no header emitted for a silent stretch).
7. Format each note as a degree token:
   - `const d = SansJianpu.degreeOf(note.midi, jianpu.tonic, jianpu.mode);`
   - `const dots = d.octaveIndex - refOct;`
   - token = `','.repeat(Math.max(0, -dots)) + d.accidental + d.digit + "'".repeat(Math.max(0, dots))`
   - e.g. reference octave → `3`, one octave up → `3'`, one down → `,3`, flat-three one octave up
     → `b3'`.
8. Format each window's timecode as `MM:SS - MM:SS` using `windowIndex*secs` and
   `(windowIndex+1)*secs` (touching boundaries — the *next* line's start equals this line's end,
   even though the last note actually placed in this line may run a bit past it). Use the same
   zero-padded `MM:SS` formatting style used elsewhere in the app if one already exists in
   `notes.js`/`app.js`; otherwise write a small local helper (`Math.floor(s/60)` : `s%60`, both
   zero-padded to 2 digits).
9. Assemble text:
   ```
   # <song name> — 1=<TonicLetter> <major|minor>

   == MM:SS - MM:SS
   <degree tokens joined by single spaces>

   == MM:SS - MM:SS
   <degree tokens>
   ```
   - Title line: `# ` + song name (from `window.sansBass.currentMix?.()?.name`, omitted
     entirely — no dangling `—`) if no mix name — plus `1=` + the tonic's letter name (reuse
     `notes.js`'s existing `PITCH_CLASSES` array indexed by `jianpu.tonic`) + a translated
     major/minor word. Match capitalization/wording already used by the `notes.keyIs` /
     `notes.major` / `notes.minor` i18n strings rather than inventing new wording — read the
     values of those keys in both locales and reuse them so the header agrees with what the UI
     already showed the user.
   - One blank line between the title and the first block, and between every block.
   - Degree tokens on their own line below each `==` line, space-separated, no trailing
     duration/rest markers.
10. `Blob([text], { type: 'text/markdown' })`, download-triggered exactly like `#notes-export`
    does today (`URL.createObjectURL` → temporary `<a download>` → click → revoke after 30s).
    Filename: `${mix ? mix.name : 'song'}-notes.md`.

## Edge cases

- **No mix name available** (`window.sansBass.currentMix` missing or returns null): title line
  is just `# 1=C major` (no song name, no leading `—`). Mirrors how `#notes-export`'s JSON
  payload already omits `song` when there's no mix.
- **Key is minor**: `jianpu.mode === 'minor'` — use the `notes.minor` i18n string, and `degreeOf`
  already reads the right table (`MINOR` in `lib/jianpu.js`) since it's called with
  `jianpu.mode`.
- **Every note lands in one window** (song shorter than `secs`, or `secs` set very large):
  a single `==` block. No special-casing needed — falls out of the bucketing loop.
- **`secs` cleared or invalid in the number input**: treat as 10 (the input's default/placeholder
  value), not as "do nothing" — a button click should never silently no-op when the guard
  conditions (notes exist, key is on) are otherwise satisfied.
- **Octave marks stack**: three or more octaves in one song is very unlikely for a vocal stem,
  but the comma/apostrophe repeat is unbounded — no cap needed (unlike the on-screen dot
  renderer, which caps visual dots at 3; text has no such rendering constraint).

## Out of scope (explicitly not building)

- No rests/silence markers — confirmed with the user: durations aren't tracked in this export at
  all, so a bare `0` with no duration wouldn't convey anything useful.
- No persistence of the `secs` value across page loads (no localStorage) — matches every other
  control in this panel.
- No change to the existing `#notes-export`/`#notes-import` JSON edits flow — this is a fully
  separate export living in its own row.
- No inline preview/textarea — download only, per the user's choice.

## Testing

- `tests/i18n.test.js` already checks every `data-i18n` key exists in both locales with matching
  `{placeholder}`s — the new keys must be added to both `en` and `zh-TW` in `lib/i18n.js` or this
  suite fails.
- `tests/versions.test.js` checks every local asset URL's `?v=` — if this feature ends up needing
  any new script tag (it shouldn't; this is a few functions and two DOM elements added to
  existing files), bump the version everywhere per `CLAUDE.md`'s 23-location list. If it doesn't
  add a new script tag, no version bump is needed for this feature alone (but bump anyway if it
  ships bundled with an unrelated change that already needs one).
- No existing unit-test file covers text/markdown formatting logic in `notes.js` (it's UI glue,
  not `lib/pitch.js`); if the bucketing/token-formatting logic ends up non-trivial (more than a
  few lines), consider factoring it into a small pure function that `tests/test.html` can cover
  directly — the same pattern `lib/jianpu.js` already follows for `degreeOf`/`referenceOctave`.
- Manual verification (single consolidated pass, per project convention): load a song, run
  analysis, enable 簡譜, click Export list with the default 10s, confirm the downloaded `.md`
  file's timecodes and degree tokens match what's drawn in the ribbon at those timestamps;
  change the seconds input and re-export to confirm blocks re-chunk; try a song with no mix name
  loaded (a bare zip) to confirm the header omits it cleanly.
