# Bass notes — a second note lane, alongside vocals

**Status:** design, approved 2026-09-01
**Scope:** `notes.js`, `notes.worker.js`, `lib/pitch.js`, `lib/sonify.js`, the lane/zoomed-pane
machinery in `app.js`, `index.html`, `lib/i18n.js`.

## Motivation

The notes pipeline (`docs/transcription.md`) only ever runs on the vocals stem. Bass lines
are exactly as drillable as a vocal melody — arguably more so, since bass practice is a
repeated stated use case for this player — and the pipeline underneath (YIN → frames →
`segmentNotes`/`segmentNotesHmm` → edits → sonify) has nothing vocals-specific in it except
the frequency window YIN searches and the panel wiring that assumes exactly one melodic stem.

Read [`docs/transcription.md`](../../transcription.md) first — this spec extends the layer
model it defines to a second stem, it does not change the model itself.

## Goals

1. Detect, display, edit, and sonify notes for the **bass** stem, independently of vocals.
2. Both stems' notes can be found, held in memory, and shown in the full-song view **at the
   same time** — each in its own lane, each independently visible/hidden and muted/unmuted.
3. The **zoomed pane** — the only place notes are read closely or edited — shows exactly one
   stem's notes at a time. Editing is inherently single-target; this spec does not attempt
   simultaneous editing of two note streams in one view.
4. Bass notes play back as a bass-like tone, not the vocals lane's piano tone.

## Non-goals

- A third or Nth note-capable stem (guitar, piano, other). The panel/lane duplication this
  spec introduces is stem-parametric internally, but only vocals and bass get UI entry points.
- Simultaneous editing of both note streams in the zoomed pane.
- Any change to `segmentNotes`/`segmentNotesHmm`/`foldOctaves`/tempo detection themselves —
  they already operate on a `frames`/`notes` list with no stem-specific assumption baked in.
- Cross-stem features (e.g. showing vocals and bass contours overlaid in one zoomed view).

## Success criteria

With a song that has both vocals and bass stems: pressing **Find notes** in each panel
independently populates two lanes, both visible in the full-song view simultaneously, each
mutable/mutable on its own. The zoomed-pane "Notes" selector shows exactly one lane's contour
and note blocks at a time and switching it does not lose the other lane's edits. Bass notes
audibly play a distinct, bass-register tone. A song with only one of the two stems shows only
that one panel/lane, exactly as today's vocals-only behaviour does when no vocals stem exists.

## Architecture

### `notes.js` becomes a two-instance factory

Today `notes.js` is one flat module with module-level state (`frames`, `notes`,
`analysedBuffer`, `editGroups`, `jianpu`, …) hardcoded to `stemBuffer('vocals')`. None of that
state, nor `analyse()`/`reinterpret()`/`resync()`/export/import, is actually vocals-specific —
it is a function of *which stem* only through that one `stemBuffer('vocals')` call and the
export/panel copy.

`notes.js` is restructured into `createNotesChannel(stem, els)`, a closure holding exactly
today's per-song state, called once for `'vocals'` and once for `'bass'` against two
duplicated sets of DOM controls. `refresh()`, the tempo grid, and the new zoomed-pane
selector (below) stay as shared, module-level code — tempo is derived from drums and has never
depended on which melodic stem is being read.

Two independent channels means **both stems' frames/notes/edits/params are held in memory
simultaneously** once analysed — switching which one feeds the zoomed pane costs nothing and
loses nothing, because there is no shared mutable state to overwrite. This directly satisfies
"both lanes can exist at once."

### Two duplicated panels in `index.html`

The existing `<section id="notes">` becomes two sections — `id="notes-vocals"` /
`id="notes-bass"` — each a copy of today's controls with `-vocals`/`-bass` suffixed ids
(`notes-go-vocals`, `notes-min-bass`, …), each gated on its own stem exactly as the single
panel is gated today (`hidden` until that stem is loaded). The **Edit notes** checkbox is
removed from both panels — editing moves to one global control near the zoomed pane, since
only one stem is ever edited at a time (see below).

Panel copy stays generic ("Find notes", "437 notes", …) since each panel's own header/position
already says which stem it is; no new translatable string needs the word "vocals" or "bass"
baked into a template beyond a label naming the panel itself.

### Full-song lanes: the singular "ribbon" becomes per-stem

`app.js` currently builds one lane (`ribbonEl`), one `GainNode` (`ribbonGain`), and one set of
flags (`ribbonMuted`, `ribbonVisible`, `ribbonVolume`, `ribbonHeight`) — built once, only if a
vocals stem exists, inserted directly under the vocals waveform lane.

This becomes a small per-stem map (`noteLanes.vocals`, `noteLanes.bass`), each entry holding
exactly what the singular versions hold today: its own lane element, gain node, mute/visible/
volume/height, and localStorage keys (`sans_bass.ribbonVisible.vocals` /
`sans_bass.ribbonVisible.bass`, same split for `ribbonHeight`). Lane construction loops over
`['vocals', 'bass']`, building a lane for a stem only if that stem exists in the loaded song
(mirrors today's `if (vocals)` gate exactly, just per stem), inserted directly under **that
stem's own** waveform lane — so a bass-notes lane sits under the bass waveform, a vocals-notes
lane under the vocals waveform, same visual grouping principle as today.

Both lanes stay out of `tracks`, exactly as today's single ribbon is — mute-all and solo must
continue to skip them, and both can play simultaneously if both are unmuted (no exclusivity
here; the user asked specifically for this).

`renderRibbon()` itself needs no change — it already draws purely from the `payload` it's
handed (`notes`, `frames`, `jianpu`, `tempo`, `clip`), with no stem-specific branch anywhere in
it. It is simply called once per populated lane instead of once.

### The zoomed pane: shared, single-stem selector

The zoomed pane (`zoomEl`) stays **singular** — one pane, drawing whichever stem is currently
selected. It docks above the first notes lane that exists (vocals takes priority as anchor
when both do), built once per song if at least one of vocals/bass exists.

Today's single "notes" chip in the zoomed pane's lane-selector row (`zoomNotesChipEl` +
`zoomNotesMuteEl`, a show/hide toggle for the notes overlay plus a mute button wired to
`toggleRibbon`) becomes **two** chips, one per stem that has a lane — "Notes: Vocals" /
"Notes: Bass" — built the same way the per-waveform-stem chips already are (colour dot, label,
speaker-mute button). The difference from those chips: the two Notes chips' **select** dots
are mutually exclusive with each other (picking one clears the other), while their **mute**
buttons stay independent — each mutes its own lane's audio exactly as it does today, unrelated
to which one the zoomed pane is currently displaying. This reuses the existing chip visual
language rather than inventing a new control, and is exactly where the user asked for it: "in
the zoom panel, we can select only one kind of notes."

`zoomNotesStem` (module-level, `'vocals' | 'bass' | null`) replaces the boolean
`zoomLaneSel.has('notes')`. `renderZoom()` reads whichever channel's `frames`/`notes`
`zoomNotesStem` points at; `null` (neither chip selected, or the selected stem has no notes
yet) draws no overlay, same as `ribbon === null` does today. Not persisted across page loads —
this mirrors `zoomLaneSel` (the closest existing analog), which also resets fresh each song
rather than being a `localStorage` flag like `ribbonVisible` is. `zoomNotesStem` is set the
first time either channel finishes analysis (vocals wins if both happen to finish in the same
tick); analysing the *second* channel afterward does not steal the selection away from
whichever channel is already showing.

**Edit notes** becomes one global toggle living beside these two chips rather than inside
either panel. It is enabled only once `zoomNotesStem` points at a channel that has notes, and
edits are always applied to that channel — `sansbass:noteedit`/`sansbass:editundo` need no
stem tag, since there is only ever one editable channel at a time by construction.

### `window.sansBass` surface

```js
stemBuffer(stem)                    // unchanged
setNotes(stem, payload)             // stem tag added — which lane this call updates
ribbonMuted(stem) / setRibbonVisible(stem, on) / ribbonVisible(stem)
notesAudio(stem)                    // → { ctx, destination } for that stem's gain node
```

`sansbass:ribbonmute` gains a `stem` field in its `detail`, so each channel's `resync()`
listener reacts only to its own lane's mute changes. `sansbass:transport` stays global
(playback state isn't per-stem) — both channels' `resync()` listeners already run
independently off the same event today in the single-channel version.

### Pitch detection: a second frequency range

Bass fundamentals run far below the vocal range `YIN_DEFAULTS` is tuned for (open E1 is
41.2 Hz; the current window is 80–1102 Hz). `lib/pitch.js` gains a second range constant:

```js
export const BASS_RANGE = { tauMin: 27, tauMax: 269 };   // ~41–408 Hz
```

`YIN_DEFAULTS`' own `tauMin: 10, tauMax: 138` (80–1102 Hz) stays untouched — vocals keeps
exactly the detection behaviour already measured in `docs/transcription.md`. No signature
changes are needed in `yinFrame`/`f0Track`: both already read `tauMin`/`tauMax` off `opts`,
falling back to `YIN_DEFAULTS`. `notes.worker.js`'s `analyse` message gains an optional
`range` field, passed straight through to `f0Track(samples, sampleRate, m.range || {})`; the
bass channel sends `BASS_RANGE`, the vocals channel sends nothing (keeping today's defaults).

The window size (`opts.window`, default 512 samples / 46 ms) may also need widening for bass —
at 512 samples the lowest bass note gets only ~1.9 periods in-window versus the vocal range's
~3.7, which could be too little for a stable difference-function minimum. This is exactly the
kind of parameter `docs/transcription.md` insists gets validated by measurement, not guessed:
during implementation, run analysis against a real ripped bass stem in `stems/`, sweep the
window size, and record what actually moves note count/octave-error rate before picking a
final value — the same discipline the vocal-range table in that doc already documents. Whatever
value is chosen becomes a documented row in `docs/transcription.md`, alongside the existing
vocal measurements.

`medianFilterVoiced`'s doc comment ("real sung cents run roughly 2000–9000") is vocals-specific
prose, not logic — the `cents === 0` unvoiced sentinel holds for any real pitch on either
stem. Reword it to say what's actually invariant (zero is unreachable by any real f0) rather
than reference singing specifically.

### Sonification: a bass timbre

`lib/sonify.js`'s `TIMBRES` gains a `bass` entry — duller/fewer harmonics than `guitar`,
longer decay than `piano`, aiming for a plucked-string feel distinct enough from the vocals
lane's `piano` default to be told apart by ear at a glance (this player's whole verification
culture is "observe audio, not parameters" — the final manual-verification pass listens to
confirm this, not just that the timbre object differs). Each channel's `resync()` passes its
own fixed timbre: `'piano'` for vocals (unchanged), `'bass'` for bass. Not user-selectable —
the two lanes are visually and now audibly distinct by construction, and adding a picker is
scope this spec doesn't need.

No changes to `scheduleNotes()` itself — `timbre` is already a parameter it accepts; only the
caller changes.

### Export, import, and the 簡譜 list export

Each channel exports/imports independently (each panel keeps its own Export/Import buttons —
this is per-channel state, not tied to the zoomed-pane selector). The edits JSON payload gains
a `"stem"` field:

```json
{ "version": 1, "stem": "bass", "song": "...", "interpreter": "hmm-v1", ... }
```

Filenames become `<song>-vocals-edits.json` / `<song>-bass-edits.json` (and
`<song>-vocals-notes.md` / `<song>-bass-notes.md` for the 簡譜 list export, whose header line
also names the stem — `## Song — Bass — 1=C major` — since that file is read outside the app
with no other way to tell which instrument it transcribes). On import, a channel warns (does
not block, mirroring the existing song-name-mismatch warning) if `data.stem` is present and
does not match the panel doing the import — this catches dragging a bass-edits file into the
vocals panel's import button.

## i18n

Every new/changed string lands in both locales in `lib/i18n.js` — `tests/i18n.test.js` fails
otherwise. This includes: the two Notes-chip labels and their tooltips, the global Edit-notes
toggle's label, the stem-mismatch import warning, and the 簡譜 list export's stem word (kept
English-only in the file itself per the existing convention, but the UI trigger needs both
locales). Note names, stem ids, and filenames are never translated, unchanged from today.

## Testing

Unit-testable, in `tests/notes.test.js` / `tests/pitch.test.js` (or wherever the existing
suites for these live):

- `BASS_RANGE` is threaded through `f0Track`/`yinFrame` and actually changes the searched tau
  range (a synthetic low sine detected under `BASS_RANGE` that the default vocal range
  misses entirely).
- Exported edits carry a `stem` field; import warns on a mismatch without blocking.
- `TIMBRES.bass` exists and produces a distinguishable `PeriodicWave` spec from `piano`.

Everything about the lane/panel/zoomed-pane UI is not unit-testable and belongs in
`docs/behaviour.md`, **updated in the same commit**: two panels gated independently on their
own stem's presence; two lanes visible/mutable independently and simultaneously; the zoomed
pane's Notes-chip pair is mutually exclusive on select but independent on mute; the global Edit
toggle follows whichever chip is selected; switching the selected chip preserves the other
channel's edits untouched.

Manual verification (one consolidated pass, per this project's convention of keeping
browser-based verification to a single end-of-plan task): load a song with both vocals and
bass stems, find notes on both, confirm both lanes render and play simultaneously with audibly
distinct timbres, confirm the zoomed pane and Edit toggle follow the chip selection, edit a
bass note, switch to vocals and back, confirm the bass edit survived.

## Versioning

This is a main-release feature — `?v=1.18.0` across `index.html`, `notes.js`,
`notes.worker.js`, `separate.js`, `separate.worker.js` (all files `tests/versions.test.js`
checks must move together, per the existing convention).

## Risks

**The frequency-range split is unvalidated until implementation runs it against real bass
audio.** `BASS_RANGE`'s numbers above are a starting point from the arithmetic (E1 = 41.2 Hz →
tau ≈ 267 samples at the decimated 11025 Hz rate), not a measurement. Treat them as a
first guess to sweep, exactly as `docs/transcription.md` already treats every other detection
parameter.

**Doubling the lane/gain/mute bookkeeping in `app.js` is the largest mechanical surface here.**
Every call site that currently reads the singular `ribbonEl`/`ribbonGain`/`ribbonMuted`/
`ribbonVisible` needs to become stem-keyed. Miss one and the bug is silent — e.g. a stale
closure still reading the vocals gain node for both lanes would make the bass lane inaudible
with no error, exactly the class of bug this codebase's gotchas list already warns about
elsewhere (`[hidden]` display, callback-pair APIs). The implementation plan should enumerate
every such call site explicitly rather than relying on grep-as-you-go.

**Two simultaneous synths plus up to six stems is more oscillators live at once than this
player has run before.** Not expected to be a real performance problem (a handful of
oscillators is cheap), but worth confirming during manual verification rather than assuming.
