# Configurable harmonic stems for chord detection

**Status:** design, approved 2026-09-08
**Scope:** `notes.js` (`HARMONIC_STEMS` → per-song configurable state + commands + reset +
export/import wiring), `lib/notes-edits.js` (payload format v6), `components/
ChordStemsPanel.jsx` (new), `components/PlayerShell.jsx` (mount the new panel), `index.html`
(new `#chord-stems-ui-root` host), `lib/i18n.js` (new keys, both locales),
`docs/chord-detection.md` (Inputs section), `docs/test-coverage.md` (`EDIT-001`). No change to
`lib/chords.js`, `lib/chroma.js`, the tempo grid, capo, or the zoomed pane.

## Motivation

Chord detection mixes down whichever of the `guitar`/`piano`/`bass` stems are loaded
(`HARMONIC_STEMS` in `notes.js`) into one harmonic signal. A real-song investigation against
`examples/nov_you.zip` (this session, 2026-09-07/08) found that some persistent multi-second
"no chord" gaps in that mix are not silence and not a tempo-grid artifact — raw evidence
inside them shows real signal level (−13 to −18 dBFS) with template correlation just under
the 0.55 "strong match" threshold. Trying different stem combinations directly against the
real detection code showed the fullest mix (`guitar+piano+bass+vocals+other`) produced the
fewest and shortest blank gaps of everything tried on that song.

This is not evidence that `other` (Demucs's catch-all bucket) or `vocals` should become part
of the *default* mix, though. `other` can just as easily hold non-harmonic noise or effects on
a different song, and mixing in the melody vocals changes what a "chord under this passage"
even means. One hardcoded default cannot be right for every song. The fix is giving the user
per-song control over which extra stems feed the harmonic mix, rather than picking a new
fixed default from a one-song sample.

## Goals

1. `guitar`+`piano`+`bass` remain the fixed baseline — always included whenever loaded, exactly
   as today. No UI to turn any of these three off.
2. The user can independently opt `vocals` and/or `other` into the harmonic mix, per song.
3. Toggling an extra re-runs chord detection immediately (`scheduleChordDetection()`), without
   discarding existing manual chord corrections — the same "audio-derived candidates are
   recalculated, corrections are reapplied by interval start" behavior `docs/chord-
   detection.md` already documents for import. This is *not* the destructive `chordredetect`
   path (that one intentionally clears `chordEdits` for an explicit user-requested full
   re-detect); a stem toggle only changes the input audio, not the user's intent to keep their
   corrections.
4. The chosen extras are a per-song setting: reset to the default (both off) on a new song
   load, in the same place `resetTempo()` already resets `capo` to 0.
5. The chosen extras round-trip through the shared notes-edits JSON, the same way `capo`
   already does — importing a file reproduces the same detection inputs it was exported with.
6. New UI: two checkboxes, in a new row directly below the tempo panel (`#tempo-ui-root`), not
   inside the zoomed pane. This is a new, separately-owned component/host — not added into
   `TempoPanel.jsx`, which CLAUDE.md documents as owning only the tempo/grid panel.

## Non-goals

- Making `guitar`/`piano`/`bass` themselves toggleable. Only the two extras are configurable.
- Any automatic suggestion of when an extra would help (e.g. flagging blank gaps and
  recommending "try including other"). Manual control only, this iteration.
- Any change to which stems Find Notes analyses (`vocals`/`bass` channels) — this setting only
  affects the harmonic mix chords are detected from, not note detection itself.
- Overtone-corrected chroma or vocabulary changes — orthogonal to this change, already tracked
  as a known limitation in `docs/chord-detection.md`.

## Data model

### `notes.js`

```js
const HARMONIC_BASE_STEMS = ['guitar', 'piano', 'bass'];   // was HARMONIC_STEMS, now fixed
let harmonicExtras = new Set();                             // subset of ['vocals', 'other']

function harmonicStemIds() {
  return [...HARMONIC_BASE_STEMS, ...harmonicExtras];
}
```

Both existing call sites that currently map over `HARMONIC_STEMS` (`scheduleChordDetection`'s
`loaded` lookup, `exportList`'s `loadedHarmonic` lookup) switch to `harmonicStemIds()`. Neither
site needs any other change — both already treat the stem list generically (map to buffer,
filter, mix down), which is what makes this a config change rather than a restructuring.

**Reset.** `resetTempo()` (called on every song load) additionally sets `harmonicExtras = new
Set()`, in the same statement group that already resets `capo = 0` and clears `chordEdits`.

**New state surface**, same `subscribe`/`getSnapshot`/`commands` shape as `tempoGrid`/
`detection`/`separation` — a store of its own since this state has no owner other than
`notes.js` and no natural home inside the existing `tempoGrid`/`chord` stores (it's neither
tempo-grid state nor the per-frame chord-editor projection):

```js
export const chordStems = {
  subscribe(listener) { /* same pattern as tempoGrid.subscribe */ },
  getSnapshot() {
    return {
      visible: tempo.confidence > 0,   // same gate TempoPanel already uses — chord-relevant
                                        // state only exists once detection has run once
      vocals: harmonicExtras.has('vocals'),
      other: harmonicExtras.has('other'),
    };
  },
  commands: {
    setVocals(on) { setExtra('vocals', on); },
    setOther(on) { setExtra('other', on); },
  },
};

function setExtra(id, on) {
  if (on) harmonicExtras.add(id); else harmonicExtras.delete(id);
  publishChordStems();
  scheduleChordDetection();   // recompute in place; chordEdits are preserved and reapplied
}
```

### `lib/notes-edits.js` — format v6

```js
/* v6 adds the song-level harmonicExtras setting (which optional stems — vocals, other — are
 * mixed into chord detection alongside the fixed guitar/piano/bass baseline). v3-v5 remain
 * readable; a missing harmonicExtras means "no extras", the same way a missing capo already
 * means fret 0. */
export const NOTES_EDITS_VERSION = 6;
const READABLE_VERSIONS = new Set([3, 4, 5, 6]);
```

`buildEditsPayload` gains a `harmonicExtras = []` parameter, included in the output object
next to `capo`. `planImport` validates it (array, every entry one of `'vocals'`/`'other'`,
otherwise `{ok: false, reason: 'invalid'}` — same strictness as the existing `capo` bounds
check) and returns `hasHarmonicExtras`/`harmonicExtras` the same way it returns `hasCapo`/
`capo` today.

`notes.js`'s `sansbass:exportedits` handler passes `harmonicExtras: [...harmonicExtras]`
(sorted, for stable output) into `buildEditsPayload`. Its `sansbass:importedits` handler adds:

```js
if (plan.hasHarmonicExtras) {
  harmonicExtras = new Set(plan.harmonicExtras);
  publishChordStems();
  scheduleChordDetection();
}
```

— placed alongside the existing `if (plan.hasCapo) capo = plan.capo;` line, but (like the
imported-tempo case just above it, unlike the capo case) followed by a recompute, since this
setting changes detection *input* rather than just a presentation transform.

## UI

### `index.html`

New host immediately after `#tempo-ui-root`, before `#lanes`:

```html
<!-- Shared: which extra stems (vocals, other) are mixed into chord detection alongside the
     fixed guitar/piano/bass baseline. Global per-song setting, not per-channel — same
     reasoning as the tempo host just above. See components/ChordStemsPanel.jsx. -->
<div id="chord-stems-ui-root" class="react-portal-host"></div>
```

### `components/ChordStemsPanel.jsx` (new)

Mirrors `TempoPanel.jsx`'s shape exactly, reading `chordStems` instead of `tempoGrid`:

```jsx
export function ChordStemsPanel() {
  useLocale();
  const view = useSyncExternalStore(chordStems.subscribe, chordStems.getSnapshot, chordStems.getSnapshot);
  return <section id="notes-chord-stems" className="notes" hidden={!view.visible}>
    <div className="notes-row">
      <span>{t('notes.chordStemsLabel')}</span>
      <label className="notes-ctl">
        <input type="checkbox" checked={view.vocals}
          onChange={(e) => chordStems.commands.setVocals(e.target.checked)} />
        <span>{t('stem.vocals')}</span>
      </label>
      <label className="notes-ctl">
        <input type="checkbox" checked={view.other}
          onChange={(e) => chordStems.commands.setOther(e.target.checked)} />
        <span>{t('stem.other')}</span>
      </label>
    </div>
  </section>;
}
```

Reuses the existing `stem.vocals`/`stem.other` translated labels rather than inventing new
ones for the same two stem ids. One new key, `notes.chordStemsLabel` (e.g. "Also include in
chords:" / 也納入和弦判斷：), added to both locales in `lib/i18n.js` — checked by the existing
`tests/i18n.test.js` parity test.

### `components/PlayerShell.jsx`

```js
import { ChordStemsPanel } from './ChordStemsPanel.jsx';
// ...
hosts.chordStems = doc.getElementById('chord-stems-ui-root');
// ...
{createPortal(<ChordStemsPanel />, hosts.chordStems)}
```

## Docs to update as part of this change

- `docs/chord-detection.md`'s **Inputs** section: replace "mixes every loaded `guitar`,
  `piano`, and `bass` `AudioBuffer`" with a description of the fixed baseline plus the two
  user-toggleable extras, and their per-song reset/export behavior.
- `docs/test-coverage.md`'s `EDIT-001` scenario: "With none of guitar/piano/bass loaded, no
  chord row is rendered" needs to become "with no stem in the current harmonic set (baseline
  plus any enabled extras) loaded" — since a song with only `other` toggled on and no
  guitar/piano/bass could now render a chord row.
- Devlog entry on completion, per this project's standing convention.

## Edge cases

- An extra toggled on for a stem that isn't loaded for the current song (e.g. `vocals` checked
  but the song has no vocals stem): `harmonicStemIds()` still includes `'vocals'`, but
  `stemBuffer('vocals')` returns nothing and it's filtered out same as any other unloaded stem
  today — no special-casing needed, same as an unloaded `guitar`/`piano`/`bass` today.
- Toggling an extra while chord detection is mid-flight (`scheduleChordDetection`'s existing
  debounce/song-token guard already handles a new request superseding an old one — no new
  concurrency handling needed).
- Importing a v6 file with `harmonicExtras` naming a stem this song doesn't have loaded: same
  as above — it's recorded as "on" but has no effect until/unless that stem loads.
- Importing an older (v3-v5) file with no `harmonicExtras` field: `hasHarmonicExtras` is
  `false`, current extras are left untouched (same convention as every other optional field).

## Testing

`tests/notes-edits.test.js` (or wherever `buildEditsPayload`/`planImport` are currently
covered), same tier: round-trips `harmonicExtras` through export/import; rejects a malformed
value (non-array, or containing a stem id other than `vocals`/`other`); confirms a v5 file
without the field imports with `hasHarmonicExtras: false` and leaves current extras alone.

Whatever tier already covers `notes.js`'s `tempoGrid`/`chordredetect` wiring should gain
matching coverage for `chordStems.commands.setVocals`/`setOther`: toggling recomputes
`chordTimeline` (via a fake/stub `detectChordTimeline`) while preserving an existing
`chordEdits` entry, and toggling does not clear it (contrast with the `chordredetect` path,
which does).

`tests/i18n.test.js` already catches a locale-parity gap in the new key automatically.

**Manual verification (single task, end of implementation):** against `examples/nov_you.zip`
— run Find notes, confirm the new row appears below the tempo panel; toggle "other" on and
confirm the chord row updates and at least one previously-blank gap now resolves (per this
session's investigation); make a manual chord correction, then toggle "vocals" on/off and
confirm the correction survives; export edits, reload the song (extras reset to off), import
the file back, and confirm both extras are restored to what was exported.
