# Configurable harmonic stems for chord detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user independently opt `vocals` and/or `other` into the harmonic mix chord
detection runs against, per song — on top of the fixed `guitar`+`piano`+`bass` baseline that
is always included whenever loaded.

**Architecture:** `notes.js` gains a `harmonicExtras` `Set` (subset of `['vocals', 'other']`)
alongside the existing fixed `HARMONIC_BASE_STEMS`, combined by a new `harmonicStemIds()`
helper that replaces every read of the old constant `HARMONIC_STEMS`. A new `chordStems`
store — same `subscribe`/`getSnapshot`/`commands` shape as the existing `tempoGrid`/
`detection`/`separation` stores — publishes the two checkbox states; toggling either one calls
the existing `scheduleChordDetection()` (never the destructive `chordredetect` path), which
already reapplies `chordEdits` by interval start. `lib/notes-edits.js` gains a v6 field so the
choice round-trips through the shared edits JSON exactly like `capo` already does, and resets
to empty on every song load in `resetTempo()`. A new `components/ChordStemsPanel.jsx`, mirroring
`components/TempoPanel.jsx`'s shape exactly, renders two checkboxes in a new row directly below
the tempo panel.

**Tech Stack:** Vanilla ES modules, React (portal-hosted panel, same pattern as every other
`components/*Panel.jsx`), Vitest (Node tier for the `lib/notes-edits.js` format tests), no new
dependencies.

**Spec:** [`docs/superpowers/specs/2026-09-08-configurable-harmonic-stems-design.md`](../specs/2026-09-08-configurable-harmonic-stems-design.md)

## Global Constraints

- `guitar`/`piano`/`bass` remain the fixed baseline — always included whenever loaded, exactly
  as today. No UI to turn any of these three off; only `vocals`/`other` are configurable.
- Toggling an extra re-runs chord detection in place via the existing `scheduleChordDetection()`
  — never `chordredetect` (that path intentionally clears `chordEdits`; a stem toggle only
  changes the input audio, not the user's intent to keep their corrections).
- The chosen extras are per-song: reset to empty (both off) in `resetTempo()`, the same place
  `capo` already resets to 0.
- The chosen extras round-trip through the shared notes-edits JSON the same way `capo` already
  does — a missing `harmonicExtras` field (v3–v5) means "no extras", not "clear the current
  choice".
- New UI is two checkboxes in a new row directly below `#tempo-ui-root`, not inside the zoomed
  pane and not added into `TempoPanel.jsx` (which CLAUDE.md documents as owning only the
  tempo/grid panel).
- No change to `lib/chords.js`, `lib/chroma.js`, the tempo grid itself, capo, or the zoomed pane.
- This repo's standing rules apply throughout: real ESM `import`/`export` (no `window.SansX`
  bridges), vanilla JS outside React component files, `npm test` (Vitest) plus `npm run build`
  as the automated gate.
- **Divergence from the design spec's illustrative snippets:** the spec was drafted against a
  simplified sketch of `notes.js` (export-time chord computation, a `HARMONIC_STEMS` constant
  used only at two call sites). The real `notes.js` already computes chords continuously via
  `scheduleChordDetection()`/`chordTimeline` (chords became part of detection, not export, in
  an earlier change) and reads the harmonic stem list at those same conceptual two points
  (`scheduleChordDetection`'s `loaded` lookup, `exportList`'s `loadedHarmonic` lookup) under
  slightly different names. This plan targets the actual current code; the design's *goals* and
  *data model shape* (fixed baseline + `Set` of extras + `harmonicStemIds()`) carry over exactly
  — only exact line numbers and a couple of call-site names differ from the spec's prose.

---

## File Structure

```
lib/notes-edits.js               (modified) — format v6: harmonicExtras
tests/notes-edits.test.js        (modified) — v6 round-trip/validation tests
notes.js                         (modified) — harmonicStemIds(), chordStems store, reset/
                                    export/import wiring
index.html                       (modified) — new #chord-stems-ui-root host
lib/i18n.js                      (modified) — notes.chordStemsLabel, both locales
components/ChordStemsPanel.jsx   (new)      — the two-checkbox row
components/PlayerShell.jsx       (modified) — mount the new panel
docs/chord-detection.md          (modified) — Inputs section
docs/test-coverage.md            (modified) — E44 row
docs/behaviour.md                (modified) — NOTE-001/EDIT-001 rows
docs/roadmap.md                  (modified) — status line for this feature
```

---

### Task 1: `lib/notes-edits.js` — format v6 (`harmonicExtras`)

**Files:**
- Modify: `lib/notes-edits.js`
- Test: `tests/notes-edits.test.js`

**Interfaces:**
- Produces: `buildEditsPayload({..., harmonicExtras}) → {..., harmonicExtras}` and
  `planImport(data, loadedStems) → {..., hasHarmonicExtras, harmonicExtras}`, consumed by
  Task 2's `notes.js` export/import handlers.

- [ ] **Step 1: Write the failing tests**

In `tests/notes-edits.test.js`, add after the existing capo test
(`'notes-edits: capo round-trips and older v4 files leave it unchanged'`):

```js
test('notes-edits: harmonicExtras round-trips through buildEditsPayload', () => {
  const payload = buildEditsPayload({
    tempo: {}, tempoRange: null, stems: {}, harmonicExtras: ['other', 'vocals'],
  });
  assertEq(payload.harmonicExtras.length, 2);
  assert(payload.harmonicExtras.includes('vocals'));
});

test('notes-edits: buildEditsPayload defaults harmonicExtras to an empty array', () => {
  const payload = buildEditsPayload({ tempo: {}, tempoRange: null, stems: {} });
  assertEq(payload.harmonicExtras.length, 0);
});

test('notes-edits: planImport carries validated harmonicExtras with an explicit presence flag', () => {
  const withExtras = planImport(
    { version: NOTES_EDITS_VERSION, stems: {}, harmonicExtras: ['vocals'] }, [],
  );
  assert(withExtras.ok);
  assert(withExtras.hasHarmonicExtras);
  assertEq(withExtras.harmonicExtras.length, 1);
  assertEq(withExtras.harmonicExtras[0], 'vocals');

  const withoutExtras = planImport({ version: NOTES_EDITS_VERSION, stems: {} }, []);
  assert(!withoutExtras.hasHarmonicExtras, 'no key at all means no opinion, not "clear it"');
  assertEq(withoutExtras.harmonicExtras.length, 0);
});

test('notes-edits: planImport rejects a malformed harmonicExtras value', () => {
  assertEq(
    planImport({ version: NOTES_EDITS_VERSION, stems: {}, harmonicExtras: 'vocals' }, []).ok,
    false, 'must be an array, not a bare string',
  );
  assertEq(
    planImport({ version: NOTES_EDITS_VERSION, stems: {}, harmonicExtras: ['drums'] }, []).ok,
    false, 'only vocals/other are valid entries',
  );
});

test('notes-edits: a v5 file with no harmonicExtras field imports with no opinion', () => {
  const plan = planImport({ version: 5, stems: {} }, []);
  assert(plan.ok);
  assert(!plan.hasHarmonicExtras);
  assertEq(plan.harmonicExtras.length, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/notes-edits.test.js`
Expected: FAIL — `buildEditsPayload` doesn't write `harmonicExtras` yet, and `planImport`
doesn't validate or return it.

- [ ] **Step 3: Bump the format version and add the field**

In `lib/notes-edits.js`, change:

```js
/* v5 adds the song-level capo setting. v3/v4 remain readable because missing newer fields
 * have unambiguous meanings. Older structural formats remain rejected. */
export const NOTES_EDITS_VERSION = 5;
const READABLE_VERSIONS = new Set([3, 4, 5]);
```

to:

```js
/* v6 adds the song-level harmonicExtras setting (which optional stems — vocals, other — are
 * mixed into chord detection alongside the fixed guitar/piano/bass baseline). v3-v5 remain
 * readable; a missing harmonicExtras means "no extras", the same way a missing capo already
 * means fret 0. */
export const NOTES_EDITS_VERSION = 6;
const READABLE_VERSIONS = new Set([3, 4, 5, 6]);
```

Change:

```js
export function buildEditsPayload({ song, tempo, tempoRange, stems, chordEdits = [], capo = 0 }) {
  return {
    version: NOTES_EDITS_VERSION,
    ...(song ? { song } : {}),
    tempo,
    tempoRange: tempoRange ?? null,
    chordEdits,
    capo,
    stems,
  };
}
```

to:

```js
export function buildEditsPayload({ song, tempo, tempoRange, stems, chordEdits = [], capo = 0, harmonicExtras = [] }) {
  return {
    version: NOTES_EDITS_VERSION,
    ...(song ? { song } : {}),
    tempo,
    tempoRange: tempoRange ?? null,
    chordEdits,
    capo,
    harmonicExtras,
    stems,
  };
}
```

Change:

```js
  if (data.capo !== undefined && (!Number.isInteger(data.capo) || data.capo < 0 || data.capo > 11)) {
    return { ok: false, reason: 'invalid' };
  }
```

to:

```js
  if (data.capo !== undefined && (!Number.isInteger(data.capo) || data.capo < 0 || data.capo > 11)) {
    return { ok: false, reason: 'invalid' };
  }
  if (data.harmonicExtras !== undefined && (!Array.isArray(data.harmonicExtras) ||
      data.harmonicExtras.some((id) => id !== 'vocals' && id !== 'other'))) {
    return { ok: false, reason: 'invalid' };
  }
```

Change:

```js
    hasCapo: data.capo !== undefined,
    capo: data.capo || 0,
    apply,
    skipped,
  };
```

to:

```js
    hasCapo: data.capo !== undefined,
    capo: data.capo || 0,
    hasHarmonicExtras: data.harmonicExtras !== undefined,
    harmonicExtras: data.harmonicExtras || [],
    apply,
    skipped,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/notes-edits.test.js`
Expected: PASS, all tests including the new ones.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: PASS (no other file reads `NOTES_EDITS_VERSION`/`READABLE_VERSIONS` directly, and
every existing test constructs its own payload objects rather than asserting an exact key
count, so the new field doesn't break anything already passing).

```bash
git add lib/notes-edits.js tests/notes-edits.test.js
git commit -m "$(cat <<'EOF'
feat: add harmonicExtras to the notes-edits format (v6)

Which optional stems (vocals, other) feed chord detection alongside the fixed guitar/piano/
bass baseline is now a song-level setting that round-trips through the shared edits JSON,
the same way capo already does. v3-v5 files remain readable; a missing field means no extras.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B9KTbAsFXPmjeS2eX1qizr
EOF
)"
```

---

### Task 2: `notes.js` — configurable harmonic stems and the `chordStems` store

**Files:**
- Modify: `notes.js`

**Interfaces:**
- Consumes: `buildEditsPayload`/`planImport` from Task 1.
- Produces: `export const chordStems` (`subscribe`/`getSnapshot`/`commands.setVocals`/
  `commands.setOther`), consumed by Task 4's `components/ChordStemsPanel.jsx`.

No automated test exists (or is added) for this task: `notes.js`'s module-level stores
(`tempoGrid`, and now `chordStems`) depend on `window.sansBass`/live Workers and have no
existing unit-test harness — `tests/notes.test.js` (browser tier) only exercises the Worker
directly, never these stores. This wiring is verified by `npm run build` (syntax/bundle
check) here, and by Task 6's manual verification at the end of this plan — the same approach
Task 3 of the chroma-chord-detection plan took for this exact file's `listExport` wiring.

- [ ] **Step 1: Replace the `HARMONIC_STEMS` constant with the base/extras split and the `chordStems` store**

Find (currently at `notes.js:86-87`):

```js
/** Stems whose audio can contribute pitch classes to a chord label. */
const HARMONIC_STEMS = ['guitar', 'piano', 'bass'];
```

Replace with:

```js
/** guitar/piano/bass are the fixed baseline — always included whenever loaded, exactly as
 *  before this feature. No UI turns any of these three off; only vocals/other are
 *  configurable, per song. See
 *  docs/superpowers/specs/2026-09-08-configurable-harmonic-stems-design.md. */
const HARMONIC_BASE_STEMS = ['guitar', 'piano', 'bass'];
let harmonicExtras = new Set();   // subset of ['vocals', 'other']

/** Every stem id currently feeding chord detection: the fixed baseline plus whichever extras
 *  are opted in. Replaces every direct read of the old HARMONIC_STEMS constant. */
function harmonicStemIds() {
  return [...HARMONIC_BASE_STEMS, ...harmonicExtras];
}

const chordStemsListeners = new Set();
let lastChordStemsView = null;

/** Recompute the published chord-stems view and notify subscribers — same pattern as
 *  publishTempo() below. Gated on the same tempo.confidence > 0 signal TempoPanel already
 *  uses for its own visibility: chord-source controls are meaningless before a detection pass
 *  has actually run. */
function publishChordStems() {
  lastChordStemsView = Object.freeze({
    visible: tempo.confidence > 0,
    vocals: harmonicExtras.has('vocals'),
    other: harmonicExtras.has('other'),
  });
  for (const listener of [...chordStemsListeners]) {
    try { listener(lastChordStemsView); } catch (error) {
      console.error('sans_bass: chord-stems subscriber failed', error);
    }
  }
  return lastChordStemsView;
}

function setHarmonicExtra(id, on) {
  if (on) harmonicExtras.add(id); else harmonicExtras.delete(id);
  publishChordStems();
  // Re-derive in place, not chordredetect: scheduleChordDetection() already reapplies
  // chordEdits by interval start, so an existing manual correction survives a stem toggle.
  scheduleChordDetection();
}

/** Peer service consumed by components/ChordStemsPanel.jsx — the same subscribe/getSnapshot/
 *  commands shape tempoGrid/detection/separation already established. A store of its own
 *  since this state has no owner other than this module and no natural home inside tempoGrid
 *  (not tempo-grid state) or the chord/detection projections (not a per-frame chord-editor
 *  projection either). */
export const chordStems = {
  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('subscriber must be a function');
    chordStemsListeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      chordStemsListeners.delete(listener);
    };
  },
  getSnapshot() {
    return lastChordStemsView ?? publishChordStems();
  },
  commands: {
    setVocals(on) { setHarmonicExtra('vocals', on); },
    setOther(on) { setHarmonicExtra('other', on); },
  },
};
```

- [ ] **Step 2: Switch `scheduleChordDetection()`'s harmonic lookup**

Find (currently `notes.js:124`):

```js
  const loaded = HARMONIC_STEMS.map((id) => window.sansBass.stemBuffer(id)).filter(Boolean);
```

Replace with:

```js
  const loaded = harmonicStemIds().map((id) => window.sansBass.stemBuffer(id)).filter(Boolean);
```

- [ ] **Step 3: Reset `harmonicExtras` on every song load**

Find (`resetTempo()`, currently `notes.js:180-190`):

```js
function resetTempo() {
  clearTimeout(chordTimer);
  chordTimer = 0;
  tempo = { on: true, auto: true, bpmValue: 120, phaseMs: 0, beatsPerBar: 4, confidence: 0 };
  tempoRange = null;
  tempoRangeArmed = false;
  publishTempo();
  chordTimeline = [];
  chordEdits = new Map();
  capo = 0;
}
```

Replace with:

```js
function resetTempo() {
  clearTimeout(chordTimer);
  chordTimer = 0;
  tempo = { on: true, auto: true, bpmValue: 120, phaseMs: 0, beatsPerBar: 4, confidence: 0 };
  tempoRange = null;
  tempoRangeArmed = false;
  publishTempo();
  chordTimeline = [];
  chordEdits = new Map();
  capo = 0;
  harmonicExtras = new Set();
  publishChordStems();
}
```

- [ ] **Step 4: Switch `exportList()`'s harmonic lookup**

Find (currently `notes.js:739-741`, inside `exportList`):

```js
    const loadedHarmonic = HARMONIC_STEMS
      .map((stemId) => window.sansBass.stemBuffer(stemId))
      .filter(Boolean);
```

Replace with:

```js
    const loadedHarmonic = harmonicStemIds()
      .map((stemId) => window.sansBass.stemBuffer(stemId))
      .filter(Boolean);
```

- [ ] **Step 5: Include `harmonicExtras` in the shared export**

Find (the `sansbass:exportedits` listener):

```js
  const payload = buildEditsPayload({
    song: mix ? mix.name : undefined,
    tempo: { on: tempo.on, bpmValue: tempo.bpmValue, phaseMs: tempo.phaseMs, beatsPerBar: tempo.beatsPerBar },
    tempoRange,
    chordEdits: [...chordEdits.entries()]
      .map(([start, label]) => ({ start, label }))
      .sort((a, b) => a.start - b.start),
    capo,
    stems,
  });
```

Replace with:

```js
  const payload = buildEditsPayload({
    song: mix ? mix.name : undefined,
    tempo: { on: tempo.on, bpmValue: tempo.bpmValue, phaseMs: tempo.phaseMs, beatsPerBar: tempo.beatsPerBar },
    tempoRange,
    chordEdits: [...chordEdits.entries()]
      .map(([start, label]) => ({ start, label }))
      .sort((a, b) => a.start - b.start),
    capo,
    harmonicExtras: [...harmonicExtras].sort(),
    stems,
  });
```

- [ ] **Step 6: Restore `harmonicExtras` on import**

Find (the `sansbass:importedits` listener):

```js
  if (plan.hasCapo) capo = plan.capo;
```

Replace with:

```js
  if (plan.hasCapo) capo = plan.capo;
  if (plan.hasHarmonicExtras) {
    harmonicExtras = new Set(plan.harmonicExtras);
    publishChordStems();
  }
```

The handler's existing final `reinterpretAll()` call already re-derives every channel's
chords (each channel's `reinterpret()` ends by calling `scheduleChordDetection()`), so the
just-imported `harmonicExtras` takes effect via `harmonicStemIds()` without an extra explicit
recompute call — the same way an imported `tempo` already relies on this same trailing
`reinterpretAll()` rather than a bespoke recompute.

- [ ] **Step 7: Verify the app still builds**

Run: `npm run build`
Expected: exits 0, no bundling/import errors.

- [ ] **Step 8: Commit**

```bash
git add notes.js
git commit -m "$(cat <<'EOF'
feat: make vocals/other harmonic-stem extras configurable per song

harmonicStemIds() replaces the fixed HARMONIC_STEMS constant with a guitar/piano/bass baseline
plus a per-song harmonicExtras Set (vocals/other), consumed by both existing call sites
(scheduleChordDetection, exportList). A new chordStems store (subscribe/getSnapshot/commands,
same shape as tempoGrid) publishes the two checkbox states; toggling either re-derives chords
in place via the existing scheduleChordDetection(), preserving chordEdits. Resets to empty on
every song load and round-trips through the shared edits JSON.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B9KTbAsFXPmjeS2eX1qizr
EOF
)"
```

---

### Task 3: `index.html` + `lib/i18n.js` — new host and label

**Files:**
- Modify: `index.html`
- Modify: `lib/i18n.js`

**Interfaces:**
- Produces: `#chord-stems-ui-root` DOM host, consumed by Task 4's `mountPlayerShell`;
  `notes.chordStemsLabel` translation key, consumed by Task 4's `ChordStemsPanel.jsx`.

- [ ] **Step 1: Add the new host**

In `index.html`, find:

```html
    <!-- Shared: tempo is derived from the drums stem and has never depended on which melodic
         stem is being read, so it lives once regardless of how many note panels exist above.
         React-owned since Phase 6b — see components/TempoPanel.jsx. -->
    <div id="tempo-ui-root" class="react-portal-host"></div>

    <div id="lanes" class="lanes">
```

Replace with:

```html
    <!-- Shared: tempo is derived from the drums stem and has never depended on which melodic
         stem is being read, so it lives once regardless of how many note panels exist above.
         React-owned since Phase 6b — see components/TempoPanel.jsx. -->
    <div id="tempo-ui-root" class="react-portal-host"></div>

    <!-- Shared: which extra stems (vocals, other) are mixed into chord detection alongside the
         fixed guitar/piano/bass baseline. Global per-song setting, not per-channel — same
         reasoning as the tempo host just above. See components/ChordStemsPanel.jsx. -->
    <div id="chord-stems-ui-root" class="react-portal-host"></div>

    <div id="lanes" class="lanes">
```

- [ ] **Step 2: Add the translation key to both locales**

In `lib/i18n.js`, find (the zh-TW block):

```js
    'notes.tempoRangeSel': '{from}–{to}',
    'notes.editFieldStart': '起始時間',
```

Replace with:

```js
    'notes.tempoRangeSel': '{from}–{to}',
    'notes.chordStemsLabel': '也納入和弦判斷：',
    'notes.editFieldStart': '起始時間',
```

Find (the en block):

```js
    'notes.tempoRangeSel': '{from}–{to}',
    'notes.editFieldStart': 'Start time',
```

Replace with:

```js
    'notes.tempoRangeSel': '{from}–{to}',
    'notes.chordStemsLabel': 'Also include in chords:',
    'notes.editFieldStart': 'Start time',
```

- [ ] **Step 3: Verify locale parity and commit**

Run: `npx vitest run tests/i18n.test.js`
Expected: PASS — the new key exists in both locales with no `{placeholder}` to drift.

```bash
git add index.html lib/i18n.js
git commit -m "$(cat <<'EOF'
feat: add chord-source-extras host and translated label

New #chord-stems-ui-root host directly below the tempo panel, and notes.chordStemsLabel in
both locales, for the upcoming ChordStemsPanel component.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B9KTbAsFXPmjeS2eX1qizr
EOF
)"
```

---

### Task 4: `components/ChordStemsPanel.jsx` (new) + mount in `PlayerShell.jsx`

**Files:**
- Create: `components/ChordStemsPanel.jsx`
- Modify: `components/PlayerShell.jsx`

**Interfaces:**
- Consumes: `chordStems` from Task 2 (`notes.js`); `#chord-stems-ui-root` from Task 3
  (`index.html`); `t`/`useLocale` (existing, same imports `TempoPanel.jsx` already uses).
- Produces: the rendered two-checkbox row — the end-to-end integration point, verified by
  Task 6's manual pass.

No automated test exists for this component: no other portal-hosted panel in this repo
(`TempoPanel.jsx` included) has its own component-level test — they're verified by
`npm run build` and manual/behavioural passes. Consistent with that precedent here too.

- [ ] **Step 1: Create `components/ChordStemsPanel.jsx`**

```jsx
import { useSyncExternalStore } from 'react';
import { t } from '../lib/i18n.js';
import { chordStems } from '../notes.js';
import { useLocale } from './useLocale.js';

/** React ownership of the new `#notes-chord-stems` row: two checkboxes letting the user opt
 *  vocals/other into the harmonic mix chord detection runs against, on top of the fixed
 *  guitar/piano/bass baseline. Mirrors components/TempoPanel.jsx's shape exactly, reading
 *  notes.js's `chordStems` store instead of `tempoGrid` — see
 *  docs/superpowers/specs/2026-09-08-configurable-harmonic-stems-design.md. */
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

- [ ] **Step 2: Mount it in `PlayerShell.jsx`**

Find:

```js
import { SeparationPanel } from './SeparationPanel.jsx';
import { SiteHeaderContent } from './SiteHeader.jsx';
import { TempoPanel } from './TempoPanel.jsx';
```

Replace with:

```js
import { ChordStemsPanel } from './ChordStemsPanel.jsx';
import { SeparationPanel } from './SeparationPanel.jsx';
import { SiteHeaderContent } from './SiteHeader.jsx';
import { TempoPanel } from './TempoPanel.jsx';
```

Find:

```js
    {createPortal(<TempoPanel />, hosts.tempo)}
```

Replace with:

```js
    {createPortal(<TempoPanel />, hosts.tempo)}
    {createPortal(<ChordStemsPanel />, hosts.chordStems)}
```

Find:

```js
    tempo: doc.getElementById('tempo-ui-root'),
  };
```

Replace with:

```js
    tempo: doc.getElementById('tempo-ui-root'),
    chordStems: doc.getElementById('chord-stems-ui-root'),
  };
```

- [ ] **Step 3: Verify the app builds**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 4: Run the full suite and commit**

Run: `npm test`
Expected: PASS (no existing test asserts the exact shape of `PlayerShell`'s `hosts` object or
its portal list).

```bash
git add components/ChordStemsPanel.jsx components/PlayerShell.jsx
git commit -m "$(cat <<'EOF'
feat: render the chord-source-extras row below the tempo panel

ChordStemsPanel.jsx mirrors TempoPanel.jsx's shape, reading notes.js's chordStems store.
Mounted into the new #chord-stems-ui-root host added in the previous commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B9KTbAsFXPmjeS2eX1qizr
EOF
)"
```

---

### Task 5: Docs

**Files:**
- Modify: `docs/chord-detection.md`
- Modify: `docs/test-coverage.md`
- Modify: `docs/behaviour.md`
- Modify: `docs/roadmap.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: `docs/chord-detection.md`'s Inputs section**

Find:

```
`notes.js` mixes every loaded `guitar`, `piano`, and `bass` `AudioBuffer` into mono. It
averages each buffer's channels first, then sums the stems and zero-pads shorter stems. The
mix is deliberately independent of the notes channel being exported: a vocals export and a
bass export see the same harmony.
```

Replace with:

```
`notes.js` mixes loaded `AudioBuffer`s from the current harmonic stem set into mono. It
averages each buffer's channels first, then sums the stems and zero-pads shorter stems. The
mix is deliberately independent of the notes channel being exported: a vocals export and a
bass export see the same harmony.

`guitar`/`piano`/`bass` are the fixed baseline: always included whenever loaded, with no UI to
turn any of them off. `vocals` and `other` are optional extras the user can independently
toggle on, per song, in the row directly below the tempo panel (`components/
ChordStemsPanel.jsx`). Toggling either one re-runs chord detection immediately against the new
mix, reapplying any existing manual chord corrections by interval start — the same reuse
behaviour described above for import — rather than discarding them. The choice resets to both
extras off on every new song load, and round-trips through the shared edits JSON the same way
capo already does (a file with no `harmonicExtras` field, from before this feature, leaves the
current choice untouched on import).
```

- [ ] **Step 2: `docs/test-coverage.md`'s E44 row**

Find (search for `| E44 |`) and replace only its final sentence:

```
With none of guitar/piano/bass loaded, no chord row is rendered.
```

with:

```
With no stem in the current harmonic set (the fixed guitar/piano/bass baseline plus any
user-enabled vocals/other extras) loaded, no chord row is rendered — so a song with only
`other` toggled on and no guitar/piano/bass can still render one.
```

- [ ] **Step 3: `docs/behaviour.md`'s NOTE-001 and EDIT-001 rows**

Find (within the `NOTE-001` row's Action column):

```
Start detection, finish channels in both orders, vary interpretation/folding/display controls, mute/show lanes, choose a capo fret, edit a zoomed chord (including a near-confidence candidate), and load another song.
```

Replace with:

```
Start detection, finish channels in both orders, vary interpretation/folding/display controls, mute/show lanes, choose a capo fret, toggle the vocals/other chord-source extras, edit a zoomed chord (including a near-confidence candidate), and load another song.
```

Find (within the same row's Observable result column):

```
chord analysis waits for every running note channel so it uses vocal key and bass inversions in one complete pass; analysis is user-triggered and independent;
```

Replace with:

```
chord analysis waits for every running note channel so it uses vocal key and bass inversions in one complete pass; toggling a vocals/other chord-source extra re-derives chords in place without discarding existing corrections, and resets to both-off on a new song; analysis is user-triggered and independent;
```

Find (within the `EDIT-001` row's Observable result column):

```
note fields, chord corrections, and persistence round-trip.
```

Replace with:

```
note fields, chord corrections, chord-source extras, and persistence round-trip.
```

- [ ] **Step 4: `docs/roadmap.md`'s status line**

Find:

```
## Configurable harmonic stems for chord detection

**Designed, not yet planned or built.**
[Spec](superpowers/specs/2026-09-08-configurable-harmonic-stems-design.md).
```

Replace with:

```
## Configurable harmonic stems for chord detection

**Planned, not yet built.**
[Spec](superpowers/specs/2026-09-08-configurable-harmonic-stems-design.md)
[Plan](superpowers/plans/2026-09-08-configurable-harmonic-stems.md).
```

- [ ] **Step 5: Commit**

```bash
git add docs/chord-detection.md docs/test-coverage.md docs/behaviour.md docs/roadmap.md
git commit -m "$(cat <<'EOF'
docs: describe configurable vocals/other harmonic-stem extras

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B9KTbAsFXPmjeS2eX1qizr
EOF
)"
```

---

### Task 6: Manual verification against the real reference song (final task)

**Files:** none (verification only — per this project's convention of consolidating browser
verification into one final task rather than repeating it per task; see CLAUDE.md).

**Interfaces:** none.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Load the reference song and run detection**

Load `examples/nov_you.zip`. Run **Find notes** on vocals and bass (whichever the zip
provides). Confirm the new row — labelled "Also include in chords:" with **Vocals** and
**Other** checkboxes — appears directly below the tempo panel once detection completes.

- [ ] **Step 3: Toggle "other" on and confirm chords update**

Tick the **Other** checkbox. Confirm the chord band in the zoomed pane updates (not a full
page reload — it should recompute within about the same debounce window `scheduleChordDetection`
already uses), and that at least one previously blank ("no chord") gap now resolves to a real
label — per this session's real-song investigation recorded in the design spec's Motivation
section.

- [ ] **Step 4: Confirm a manual correction survives a toggle**

In the zoomed pane, correct one chord label by hand. Toggle **Vocals** on, then off again.
Confirm the manual correction is still showing on that same interval both times (not reverted
to the audio-derived guess).

- [ ] **Step 5: Confirm export/import round-trips the choice**

With both extras on, click **Export edits**. Reload the song (confirm both checkboxes reset to
off). Click **Import edits** and select the file just exported. Confirm both **Vocals** and
**Other** are ticked again, matching what was exported.

- [ ] **Step 6: Report the result**

No commit for this task — it is a verification gate. If every step above holds, the plan is
complete.
