# Bass Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the bass stem its own independent note-detection/edit/sonify channel, alongside vocals — both lanes visible and mutable simultaneously in the full-song view, one shared zoomed pane that shows exactly one channel's notes at a time via a mutually-exclusive chip pair.

**Architecture:** `notes.js` becomes a two-instance factory (`createNotesChannel(stem, els)`), called once each for `'vocals'` and `'bass'`, with tempo state/controls pulled out to shared module-level code since tempo is drums-derived and stem-agnostic. `app.js`'s singular ribbon/zoom-notes state becomes a per-stem `noteLanes` map plus a single `zoomNotesStem` selector; the zoomed pane and its edit toolbar stay singular, always operating on whichever channel `zoomNotesStem` points at. `lib/pitch.js` gains a second YIN search range for bass's lower fundamentals; `lib/sonify.js` gains a bass timbre.

**Tech Stack:** Vanilla JS (no build step, no npm), classic scripts (`app.js`, `lib/i18n.js`, `lib/stems.js`) + ES modules (`notes.js`, `notes.worker.js`, `lib/pitch.js`, `lib/sonify.js`), tested via `tests/test.html` over `./scripts/serve.sh`.

**Spec:** [`docs/superpowers/specs/2026-09-01-bass-notes-design.md`](../specs/2026-09-01-bass-notes-design.md) — read alongside this plan; the plan argues from it and does not repeat its rationale in full.

## Global Constraints

- No build step, no bundler, no npm, no new dependencies — every change is a plain `.js`/`.html` edit.
- `notes.js`, `notes.worker.js`, `lib/pitch.js`, `lib/sonify.js` are ES modules; `app.js`, `lib/i18n.js`, `lib/stems.js` are classic scripts and cannot `import` them — cross-file calls go through `window.sansBass` / `window.SansI18n` / `window.SansPitch`, exactly as today.
- Every new or changed UI string needs entries in **both** `zh-TW` and `en` in `lib/i18n.js` — `tests/i18n.test.js` fails otherwise. Stem ids and filenames are never translated.
- Version lockstep: `index.html` (15 versioned refs), `separate.js` (3), `separate.worker.js` (1), `notes.js` (4), `notes.worker.js` (1) — 24 occurrences of `?v=1.17.2` across these 5 files must all move to `?v=1.18.0` **together**, in one commit, at the very end (Task 10; that task also corrects a stale `notes.js (3)` / `23 in all` count baked into a comment in `index.html` itself — the real count has been 4 / 24 since the tempo-grid feature added a second `new Worker(...)` call site to `notes.js`, predating this plan). Every earlier task leaves `?v=1.17.2` untouched so `tests/versions.test.js` keeps passing at every intermediate commit.
- Neither note lane is ever added to `tracks` — mute-all, solo and the stem count must keep ignoring both, for free, by construction.
- Tests run via `tests/test.html` (`window.__testResults`) over `./scripts/serve.sh` (`http://localhost:8777`) — there is no other runner.
- `docs/behaviour.md` documents UI behaviour no unit test reaches; it is part of the diff for any UI-behaviour change (Task 9 here).
- **A note on testability of Tasks 5–7 (index.html / notes.js / app.js):** these three files are mutually load-bearing — new suffixed ids in `index.html` only work against the rewritten `notes.js`, whose `window.sansBass` calls only work against the rewritten `app.js`. There is no way to land one without the app being broken until the other two also land, and none of the three is exercised by the automated suite (which only covers pure functions in `lib/*.js` and the worker protocol). Each of these three tasks is still its own commit, for reviewability, but its "verification" step is limited to running the existing automated suite (confirming the untouched pure-function contracts still hold) plus a manual sanity load — full behavioural verification happens once all three are done, formally in Task 11.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/pitch.js` | + `BASS_RANGE`, `stemMismatch`; reworded `medianFilterVoiced` doc comment. Everything else unchanged. |
| `lib/sonify.js` | + `TIMBRES.bass`. Everything else unchanged. |
| `lib/i18n.js` | + 4 new keys × 2 locales for the two-chip zoomed-pane selector and the stem-mismatch import warning. |
| `notes.worker.js` | `analyse` message accepts an optional `range`, threaded into `f0Track`. |
| `index.html` | `<section id="notes">` splits into `<section id="notes-vocals">` / `<section id="notes-bass">` (duplicated per-channel controls) + one shared `<section id="notes-tempo">` (tempo grid controls, pulled out — not duplicated). |
| `notes.js` | Restructured into `createNotesChannel(stem, els)` + shared module-level tempo state/wiring. Two instances created at the bottom, for `'vocals'` and `'bass'`. |
| `app.js` | Singular `ribbon`/`ribbonEl`/`ribbonGain`/`ribbonMuted`/`ribbonVisible`/`ribbonVolume`/`ribbonHeight`/`ribbonRangeHint` become a per-stem `noteLanes` map; `zoomLaneSel`'s `'notes'` member becomes `zoomNotesStem` (tri-state); the zoomed pane's Notes chip becomes two, mutually exclusive on select, independent on mute; **Edit notes** becomes one global toggle beside them; `window.sansBass` surface gains a `stem` parameter on `setNotes`/`ribbonMuted`/`setRibbonVisible`/`ribbonVisible`/`notesAudio`. |
| `docs/transcription.md` | + a measured row for the bass YIN window-size sweep. |
| `docs/behaviour.md` | Notes lane / Note editing sections rewritten for two independent channels sharing one zoomed pane. |

---

### Task 1: `BASS_RANGE`, threaded through the analysis worker

**Files:**
- Modify: `lib/pitch.js` (near `YIN_DEFAULTS`, and `medianFilterVoiced`'s doc comment)
- Modify: `notes.worker.js` (the `analyse` message handler)
- Test: `tests/pitch.test.js`, `tests/notes.test.js`

**Interfaces:**
- Produces: `export const BASS_RANGE = { tauMin: 27, tauMax: 269, window: 1024 }` from `lib/pitch.js` — consumed by Task 6 (`notes.js` passes it as the `range` field on the bass channel's `analyse` postMessage) and by Task 8 (the measurement task may revise `window`).
- Consumes: nothing new — `yinFrame`/`f0Track` already read `opts.tauMin`/`opts.tauMax`/`opts.window` off a flat bag, falling back to `YIN_DEFAULTS`.

`window` is added to `BASS_RANGE` beyond the spec's literal `{ tauMin, tauMax }` snippet: the spec explicitly flags that the 512-sample default window may starve the difference function of cycles for a low bass fundamental, and says whatever value is picked "becomes a documented row in docs/transcription.md" — i.e. it has to live somewhere machine-readable that the worker threads through, and `f0Track`/`yinFrame` already read `opts.window` from the same flat options bag `tauMin`/`tauMax` come from. Folding it into `BASS_RANGE` avoids inventing a second constant and a second plumbing path. `1024` is the arithmetic starting guess (spec's own math: E1 ≈ 267 samples at the decimated 11025 Hz rate; 1024/267 ≈ 3.8 periods, matching the vocal range's ~3.7) — Task 8 runs the real measurement against `stems/` audio and may revise it.

- [ ] **Step 1: Write the failing tests**

In `tests/pitch.test.js`, add near the existing `yinFrame`/`f0Track` tests (after `test('pitch: yinFrame resolves sines across the whole search range', ...)`):

```js
import { BASS_RANGE } from '../lib/pitch.js';

test('pitch: BASS_RANGE finds a fundamental the vocal range cannot see', () => {
  const SR = 11025;
  const hz = 41.2;   // open E1
  const buf = sine(hz, 0.2, SR);
  const vocalRange = yinFrame(buf, 0, SR);                 // YIN_DEFAULTS: tauMax 138 -> 79.9 Hz floor
  const bassRange = yinFrame(buf, 0, SR, BASS_RANGE);
  assert(vocalRange.confidence < 0.5, 'the vocal range cannot find a period this long — no true minimum inside [10,138]');
  assertClose(centsFromHz(bassRange.f0), centsFromHz(hz), 20, 'the bass range resolves it within 20 cents');
  assert(bassRange.confidence > 0.9, 'and reads as strongly periodic');
});

test('pitch: BASS_RANGE\'s window is wide enough to keep the vocal range\'s period-count ratio', () => {
  // The vocal range gets ~3.7 periods per window at its own floor (512 / 138*sampleRate/tauMax-ish
  // arithmetic is approximate by design — this pins the INTENT, not an exact ratio): a bass window
  // that regressed back toward the vocal default would starve the difference function of cycles.
  assert(BASS_RANGE.window >= 2 * 512, 'the bass window is meaningfully wider than the vocal default');
});
```

In `tests/notes.test.js`, add after `test('notes: the worker carries candidates across postMessage', ...)`:

```js
import { BASS_RANGE } from '../lib/pitch.js';

test('notes: analyse threads an optional range into f0Track', async () => {
  const hz = 41.2;   // open E1 - below YIN_DEFAULTS' 79.9 Hz floor
  const withoutRange = await analyse([sine(hz, 1.5, SR)], SR);
  const data = await roundTrip({
    type: 'analyse', channels: [sine(hz, 1.5, SR)], sampleRate: SR, range: BASS_RANGE,
  });
  const voicedWithout = [...withoutRange.cents].filter((c) => c !== 0).length;
  const voicedWith = [...data.frames.cents].filter((c) => c !== 0).length;
  assert(voicedWith > voicedWithout,
    `a wider range finds far more voiced frames for a low tone the default misses (${voicedWith} vs ${voicedWithout})`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./scripts/serve.sh` (background), open `http://localhost:8777/tests/test.html`, read `window.__testResults`.
Expected: FAIL — `BASS_RANGE is not exported` (pitch.test.js) and the worker ignores `range` entirely so the two frame counts come back equal (notes.test.js).

- [ ] **Step 3: Add `BASS_RANGE` to `lib/pitch.js`**

Insert immediately after `YIN_DEFAULTS` (after its closing `};`, before the `// ---------------------------------------------------------------- YIN` section's `yinFrame` function):

```js
/* Bass fundamentals run far below the vocal range YIN_DEFAULTS is tuned for: open E1 is
 * 41.2 Hz, versus the vocal window's 80 Hz floor. tauMax = 269 is the decimated-rate
 * (11025 Hz) period for ~41 Hz; window is widened to keep roughly the vocal range's own
 * ratio of periods-per-window (~3.7) rather than starving the difference function of
 * cycles to compare. `window` here is a starting guess from the arithmetic, not yet a
 * measurement — see docs/transcription.md for the sweep that validates or revises it. */
export const BASS_RANGE = { tauMin: 27, tauMax: 269, window: 1024 };
```

- [ ] **Step 4: Reword `medianFilterVoiced`'s doc comment**

In `lib/pitch.js`, find:

```js
/**
 * Median-filter a cents array in place, skipping unvoiced frames.
 *
 * Zero is the unvoiced sentinel. That is safe because real sung cents run roughly
 * 2000-9000 and can never legitimately be 0 (which would be 8.2 Hz).
 */
```

Replace with:

```js
/**
 * Median-filter a cents array in place, skipping unvoiced frames.
 *
 * Zero is the unvoiced sentinel. That is safe for any real pitch this module is ever
 * asked to track, vocal or instrumental: 0 cents is 8.2 Hz, well below both the vocal and
 * bass search ranges, so no legitimate f0 can collide with the sentinel.
 */
```

- [ ] **Step 5: Thread `range` through `notes.worker.js`**

In `notes.worker.js`, find:

```js
    if (m.type === 'analyse') {
      if (!m.channels || !m.channels.length) throw new Error('no audio channels supplied');
      const dec = decimate(m.channels, m.sampleRate);
      const track = f0Track(dec.samples, dec.sampleRate);
      const tempo = m.drums ? computeTempo(m.drums.channels, m.drums.sampleRate) : null;
```

Replace with:

```js
    if (m.type === 'analyse') {
      if (!m.channels || !m.channels.length) throw new Error('no audio channels supplied');
      const dec = decimate(m.channels, m.sampleRate);
      const track = f0Track(dec.samples, dec.sampleRate, m.range || {});
      const tempo = m.drums ? computeTempo(m.drums.channels, m.drums.sampleRate) : null;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: reload `http://localhost:8777/tests/test.html`, read `window.__testResults`.
Expected: PASS — all `pitch:` and `notes:` tests green, including the two new ones. Also spot-check nothing else regressed: `window.__testResults.failed === 0`.

- [ ] **Step 7: Commit**

```bash
git add lib/pitch.js notes.worker.js tests/pitch.test.js tests/notes.test.js
git commit -m "$(cat <<'EOF'
feat: BASS_RANGE for low-register YIN detection, threaded through the worker

Bass fundamentals sit below YIN_DEFAULTS' 80 Hz floor. Adds a second
range constant (tauMin/tauMax/window) and an optional `range` field on
the worker's analyse message; vocals keeps today's defaults untouched.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bph1E6jMTnBMWFipFpBTzf
EOF
)"
```

---

### Task 2: `TIMBRES.bass`

**Files:**
- Modify: `lib/sonify.js`
- Test: `tests/sonify.test.js`

**Interfaces:**
- Produces: `TIMBRES.bass` — consumed by Task 6 (`notes.js`'s bass channel passes `timbre: 'bass'` to `scheduleNotes`).
- The existing generic test `'sonify: every timbre builds a PeriodicWave'` already loops `Object.keys(TIMBRES)`, so it covers `bass` automatically with no change.

- [ ] **Step 1: Write the failing test**

In `tests/sonify.test.js`, add after `test('sonify: every timbre builds a PeriodicWave', ...)`:

```js
test('sonify: TIMBRES.bass is distinct from TIMBRES.piano and TIMBRES.guitar', () => {
  assert(TIMBRES.bass, 'a bass timbre exists');
  assert(TIMBRES.bass.decay > TIMBRES.piano.decay, 'bass sustains longer than piano — a plucked-string feel, not a pluck-and-stop');
  assert(TIMBRES.bass.partials.length < TIMBRES.guitar.partials.length,
    'bass carries fewer harmonics than guitar, for a duller tone');
  assert(JSON.stringify(TIMBRES.bass.partials) !== JSON.stringify(TIMBRES.piano.partials),
    'bass and piano do not share a harmonic spectrum');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: reload `tests/test.html`.
Expected: FAIL — `TIMBRES.bass` is `undefined`.

- [ ] **Step 3: Add `TIMBRES.bass`**

In `lib/sonify.js`, find:

```js
export const TIMBRES = {
  piano:  { partials: [1, 0.5, 0.28, 0.12, 0.07, 0.04, 0.02], decay: 0.85, release: 0.04 },
  guitar: { partials: [1, 0.7, 0.45, 0.32, 0.2, 0.14, 0.1, 0.06], decay: 1.0, release: 0.08 },
};
```

Replace with:

```js
export const TIMBRES = {
  piano:  { partials: [1, 0.5, 0.28, 0.12, 0.07, 0.04, 0.02], decay: 0.85, release: 0.04 },
  guitar: { partials: [1, 0.7, 0.45, 0.32, 0.2, 0.14, 0.1, 0.06], decay: 1.0, release: 0.08 },
  bass:   { partials: [1, 0.35, 0.12, 0.05], decay: 1.3, release: 0.12 },
};
```

Fewer, faster-rolling-off partials than either existing timbre (duller, per the design spec); the longest `decay` and `release` of the three (a low plucked string rings longer, and a short release on a low fundamental reads as an abrupt click rather than a note ending).

- [ ] **Step 4: Run the test to verify it passes**

Run: reload `tests/test.html`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sonify.js tests/sonify.test.js
git commit -m "$(cat <<'EOF'
feat: add a bass timbre to lib/sonify.js

Duller and longer-sustaining than piano/guitar, so the bass notes lane
is audibly distinct from the vocals lane's piano tone at a glance.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bph1E6jMTnBMWFipFpBTzf
EOF
)"
```

---

### Task 3: `stemMismatch` helper

**Files:**
- Modify: `lib/pitch.js` (near `applyEdits`, in the edits/layer-4 section)
- Test: `tests/pitch.test.js`

**Interfaces:**
- Produces: `export function stemMismatch(data, stem): boolean` — consumed by Task 6 (`notes.js`'s import handler calls it to decide whether to show the stem-mismatch warning).

- [ ] **Step 1: Write the failing test**

In `tests/pitch.test.js`, add after the `applyEdits` test block (after `test('pitch: applyEdits preserves fix.from already set by foldOctaves', ...)`):

```js
import { stemMismatch } from '../lib/pitch.js';

test('pitch: stemMismatch flags a real mismatch and nothing else', () => {
  assertEq(stemMismatch({ stem: 'bass' }, 'vocals'), true, 'different stem is a mismatch');
  assertEq(stemMismatch({ stem: 'vocals' }, 'vocals'), false, 'matching stem is not a mismatch');
  assertEq(stemMismatch({}, 'vocals'), false,
    'a file with no stem field never mismatches — nothing about importing an old edit history should change behavior');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: reload `tests/test.html`.
Expected: FAIL — `stemMismatch is not exported`.

- [ ] **Step 3: Add `stemMismatch`**

In `lib/pitch.js`, add immediately after the `applyEdits` function's closing `}` (end of file):

```js

/**
 * Whether an imported edits file was made for a different stem than the panel importing it.
 * Absent `data.stem` (a file exported before this field existed) never mismatches — nothing
 * about importing an old edit history should change behavior.
 */
export function stemMismatch(data, stem) {
  return data.stem !== undefined && data.stem !== stem;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: reload `tests/test.html`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pitch.js tests/pitch.test.js
git commit -m "$(cat <<'EOF'
feat: add stemMismatch helper for imported note-edits files

Pure predicate the bass/vocals import handlers use to warn when a file
made for one stem's panel is dropped into the other's import button.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bph1E6jMTnBMWFipFpBTzf
EOF
)"
```

---

### Task 4: i18n keys for the two-stem UI

**Files:**
- Modify: `lib/i18n.js`

**Interfaces:**
- Produces: `notes.zoomNotesChipFor`, `notes.zoomNotesChipForTip`, `notes.zoomNotesMuteTipFor`, `notes.importStemMismatch` in both locales — consumed by Task 7 (the two zoomed-pane Notes chips) and Task 6 (the import-mismatch warning).
- The existing `notes.edit` / `notes.editTip` keys are reused as-is for the new global Edit-notes toggle — reviewed against the spec's "review for wording that assumed 'the' panel" instruction: both read as generic instructions ("Edit notes" / "Select a note to correct its pitch or timing, or add and delete notes.") with no panel-specific wording, so no change is needed. The two per-panel headers reuse the existing `stem.vocals` / `stem.bass` keys — also no new key.
- The 簡譜 list export's stem word (`Vocals` / `Bass` baked into the exported `.md` file's header line and filename) is **not** a new i18n key: it follows the exact existing convention the major/minor word already uses — hardcoded English, never routed through `tr()`, because the file is read outside the app where the current UI locale doesn't apply. It is a plain `STEM_WORD` map added in Task 6's `notes.js`, not a dictionary entry.

Four new keys, following the `{lane}: ...` interpolation pattern the existing `notes.zoomLaneShowTip` / `notes.zoomLaneMuteTip` keys already use for the per-stem waveform chips:

- [ ] **Step 1: Add the four keys to the `zh-TW` dictionary**

In `lib/i18n.js`, find (inside `DICT['zh-TW']`):

```js
      'notes.zoomNotesMuteTip': '播放音符合成音／靜音',
      'notes.hide': '隱藏音符',
```

Replace with:

```js
      'notes.zoomNotesMuteTip': '播放音符合成音／靜音',
      'notes.zoomNotesChipFor': '{lane}音符',
      'notes.zoomNotesChipForTip': '{lane}：顯示／隱藏偵測到的音符；開啟時，其他波形會轉為灰色',
      'notes.zoomNotesMuteTipFor': '{lane}：播放音符合成音／靜音',
      'notes.hide': '隱藏音符',
```

Then find (inside the same `zh-TW` block):

```js
      'notes.importMismatch': '這個檔案看起來是給「{song}」用的，與目前載入的歌曲不同。',
```

Replace with:

```js
      'notes.importMismatch': '這個檔案看起來是給「{song}」用的，與目前載入的歌曲不同。',
      'notes.importStemMismatch': '這個檔案看起來是給「{stem}」面板用的，不是這一個。',
```

- [ ] **Step 2: Add the four keys to the `en` dictionary**

In `lib/i18n.js`, find (inside `DICT.en`):

```js
      'notes.zoomNotesMuteTip': 'Play/mute the synthesised notes',
      'notes.hide': 'Hide notes',
```

Replace with:

```js
      'notes.zoomNotesMuteTip': 'Play/mute the synthesised notes',
      'notes.zoomNotesChipFor': '{lane} notes',
      'notes.zoomNotesChipForTip': '{lane}: show/hide its detected notes; while on, other waveforms turn gray',
      'notes.zoomNotesMuteTipFor': '{lane}: play/mute its synthesised notes',
      'notes.hide': 'Hide notes',
```

Then find (inside the same `en` block):

```js
      'notes.importMismatch': 'This file looks like it was made for "{song}", not the song currently loaded.',
```

Replace with:

```js
      'notes.importMismatch': 'This file looks like it was made for "{song}", not the song currently loaded.',
      'notes.importStemMismatch': 'This file looks like it was made for the {stem} panel, not this one.',
```

- [ ] **Step 3: Run the test suite to verify the dictionaries stay in sync**

Run: `./scripts/serve.sh` (if not already running), reload `http://localhost:8777/tests/test.html`, read `window.__testResults`.
Expected: PASS on every `i18n:` test — `'both locales define exactly the same keys'`, `'no value is empty'`, `'each key uses the same {placeholders} in both locales'` all still green (the fourth i18n test, "every key used in index.html exists in both locales", isn't exercised yet since nothing references these new keys from markup until Task 7 — that's fine, it only checks keys markup *does* use).

- [ ] **Step 4: Commit**

```bash
git add lib/i18n.js
git commit -m "$(cat <<'EOF'
feat: i18n keys for the two-stem zoomed-pane Notes chips

Adds {lane}-qualified variants of the existing single Notes-chip
strings, plus a stem-mismatch import warning — both locales.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bph1E6jMTnBMWFipFpBTzf
EOF
)"
```

---

### Task 5: `index.html` — two duplicated notes panels + one shared tempo section

**Files:**
- Modify: `index.html`
- Modify: `styles.css` (one new rule for the panel header label)

**Interfaces:**
- Produces: the id set `notes-{go,count,show,jianpu,key-tonic,key-mode,key-rel,tune,min,min-out,clip,hmm,fold,fold-tol,fold-tol-out,fold-stats,edits,edits-summary,edit-undo,edit-rows,export,import,import-file,list-secs,list-export}-{vocals,bass}`, plus the panel ids `notes-vocals`/`notes-bass`, plus the **unchanged** shared tempo ids `notes-tempo{,-on,-bpm,-half,-double,-phase,-phase-back,-phase-fwd,-beats,-range,-redetect,-status}` now living in their own `<section id="notes-tempo">`. Consumed by Task 6's `createNotesChannel(stem, els)` (per-stem ids) and shared tempo wiring (unchanged ids).
- Does **not** yet touch `?v=1.17.2` anywhere in this file — Task 10 bumps every occurrence in lockstep across all 5 version-tracked files.
- Per Global Constraints: the `notes-edit` checkbox is deleted outright (not duplicated) — it becomes a JS-built global control in Task 7, not static markup.

This task is markup-only; `notes.js`/`app.js` still reference the *old*, now-nonexistent ids until Task 6 lands, so the page does not run correctly between this task and Task 6. See the Global Constraints note on this three-task group.

- [ ] **Step 1: Replace the single `<section id="notes">` with two duplicated panels + a shared tempo section**

In `index.html`, replace the entire block from the `<!-- Detection is button-triggered ... -->` comment through the closing `</section>` of `id="notes"` (currently lines 133–267) with:

```html
    <!-- Detection is button-triggered, never automatic: the first run is ~7 s of CPU on a
         4-minute track, and unbidden CPU that size is a surprise rather than a convenience.
         Two independent panels — one per note-capable stem — each gated on its own stem's
         presence exactly as the single panel was gated before. Edit notes moves to one
         global toggle beside the zoomed pane's two Notes chips (built by app.js), since only
         one channel is ever edited at a time; the tempo grid moves to its own shared section
         below, since it is derived from drums and has never depended on which melodic stem
         is being read. See docs/superpowers/specs/2026-09-01-bass-notes-design.md. -->
    <section id="notes-vocals" class="notes" hidden>
      <div class="notes-row">
        <strong class="notes-panel-label" data-i18n="stem.vocals">Vocals</strong>
      </div>
      <div class="notes-row">
        <button id="notes-go-vocals" class="btn" data-i18n="notes.find">Find notes</button>
        <span id="notes-count-vocals" class="notes-count"></span>
        <button id="notes-show-vocals" class="btn ghost" data-i18n="notes.hide" hidden>Hide notes</button>
        <label class="notes-ctl">
          <input id="notes-jianpu-vocals" type="checkbox">
          <span data-i18n="notes.jianpu">簡譜</span>
        </label>
        <span class="notes-ctl notes-key">
          <span data-i18n="notes.keyIs">1 =</span>
          <select id="notes-key-tonic-vocals" disabled></select>
          <select id="notes-key-mode-vocals" disabled>
            <option value="major" data-i18n="notes.major">major</option>
            <option value="minor" data-i18n="notes.minor">minor</option>
          </select>
          <button id="notes-key-rel-vocals" class="mini" type="button" disabled
                  data-i18n-attr="title:notes.relativeTip">⇄</button>
        </span>
      </div>
      <div id="notes-tune-vocals" class="notes-row" hidden>
        <label class="notes-ctl">
          <span data-i18n="notes.shortest">Shortest note</span>
          <input id="notes-min-vocals" type="range" min="20" max="300" step="5" value="120">
          <output id="notes-min-out-vocals" class="notes-val">120 ms</output>
        </label>
        <details class="notes-adv">
          <summary data-i18n="notes.advanced">Advanced</summary>
          <label class="notes-ctl">
            <input id="notes-clip-vocals" type="checkbox" checked>
            <span data-i18n="notes.clip">Fit the lane to the melody</span>
          </label>
          <label class="notes-ctl">
            <input id="notes-hmm-vocals" type="checkbox" checked>
            <span data-i18n="notes.hmm">Whole-phrase detection</span>
          </label>
          <div class="notes-ctl">
            <label class="notes-ctl">
              <input id="notes-fold-vocals" type="checkbox">
              <span data-i18n="notes.fold">Fix octave outliers</span>
            </label>
            <span id="notes-fold-stats-vocals" class="notes-stats" hidden></span>
          </div>
          <label class="notes-ctl notes-sub">
            <span data-i18n="notes.foldTol">Fold tolerance</span>
            <input id="notes-fold-tol-vocals" type="range" min="0.5" max="8" step="0.25" value="1.5" disabled>
            <output id="notes-fold-tol-out-vocals" class="notes-val">1.5 semitones</output>
          </label>
        </details>
      </div>
      <details id="notes-edits-vocals" class="notes-edit-list" hidden>
        <summary id="notes-edits-summary-vocals"></summary>
        <div class="notes-row notes-edit-panel">
          <button id="notes-edit-undo-vocals" class="mini" type="button" disabled
                  data-i18n-attr="title:notes.editUndoTip">&#8630;</button>
          <ol id="notes-edit-rows-vocals" class="edit-rows"></ol>
        </div>
      </details>
      <div id="notes-io-vocals" class="notes-row">
        <button id="notes-export-vocals" class="mini" type="button" disabled data-i18n="notes.export">Export edits</button>
        <button id="notes-import-vocals" class="mini" type="button" disabled data-i18n="notes.import">Import edits</button>
        <input id="notes-import-file-vocals" type="file" accept="application/json,.json" hidden>
      </div>
      <div id="notes-list-io-vocals" class="notes-row">
        <label class="notes-ctl">
          <span data-i18n="notes.listSecs">Seconds per line</span>
          <input id="notes-list-secs-vocals" type="number" min="3" max="60" step="1" value="10">
        </label>
        <button id="notes-list-export-vocals" class="mini" type="button" disabled data-i18n="notes.exportList">Export list</button>
      </div>
    </section>

    <section id="notes-bass" class="notes" hidden>
      <div class="notes-row">
        <strong class="notes-panel-label" data-i18n="stem.bass">Bass</strong>
      </div>
      <div class="notes-row">
        <button id="notes-go-bass" class="btn" data-i18n="notes.find">Find notes</button>
        <span id="notes-count-bass" class="notes-count"></span>
        <button id="notes-show-bass" class="btn ghost" data-i18n="notes.hide" hidden>Hide notes</button>
        <label class="notes-ctl">
          <input id="notes-jianpu-bass" type="checkbox">
          <span data-i18n="notes.jianpu">簡譜</span>
        </label>
        <span class="notes-ctl notes-key">
          <span data-i18n="notes.keyIs">1 =</span>
          <select id="notes-key-tonic-bass" disabled></select>
          <select id="notes-key-mode-bass" disabled>
            <option value="major" data-i18n="notes.major">major</option>
            <option value="minor" data-i18n="notes.minor">minor</option>
          </select>
          <button id="notes-key-rel-bass" class="mini" type="button" disabled
                  data-i18n-attr="title:notes.relativeTip">⇄</button>
        </span>
      </div>
      <div id="notes-tune-bass" class="notes-row" hidden>
        <label class="notes-ctl">
          <span data-i18n="notes.shortest">Shortest note</span>
          <input id="notes-min-bass" type="range" min="20" max="300" step="5" value="120">
          <output id="notes-min-out-bass" class="notes-val">120 ms</output>
        </label>
        <details class="notes-adv">
          <summary data-i18n="notes.advanced">Advanced</summary>
          <label class="notes-ctl">
            <input id="notes-clip-bass" type="checkbox" checked>
            <span data-i18n="notes.clip">Fit the lane to the melody</span>
          </label>
          <label class="notes-ctl">
            <input id="notes-hmm-bass" type="checkbox" checked>
            <span data-i18n="notes.hmm">Whole-phrase detection</span>
          </label>
          <div class="notes-ctl">
            <label class="notes-ctl">
              <input id="notes-fold-bass" type="checkbox">
              <span data-i18n="notes.fold">Fix octave outliers</span>
            </label>
            <span id="notes-fold-stats-bass" class="notes-stats" hidden></span>
          </div>
          <label class="notes-ctl notes-sub">
            <span data-i18n="notes.foldTol">Fold tolerance</span>
            <input id="notes-fold-tol-bass" type="range" min="0.5" max="8" step="0.25" value="1.5" disabled>
            <output id="notes-fold-tol-out-bass" class="notes-val">1.5 semitones</output>
          </label>
        </details>
      </div>
      <details id="notes-edits-bass" class="notes-edit-list" hidden>
        <summary id="notes-edits-summary-bass"></summary>
        <div class="notes-row notes-edit-panel">
          <button id="notes-edit-undo-bass" class="mini" type="button" disabled
                  data-i18n-attr="title:notes.editUndoTip">&#8630;</button>
          <ol id="notes-edit-rows-bass" class="edit-rows"></ol>
        </div>
      </details>
      <div id="notes-io-bass" class="notes-row">
        <button id="notes-export-bass" class="mini" type="button" disabled data-i18n="notes.export">Export edits</button>
        <button id="notes-import-bass" class="mini" type="button" disabled data-i18n="notes.import">Import edits</button>
        <input id="notes-import-file-bass" type="file" accept="application/json,.json" hidden>
      </div>
      <div id="notes-list-io-bass" class="notes-row">
        <label class="notes-ctl">
          <span data-i18n="notes.listSecs">Seconds per line</span>
          <input id="notes-list-secs-bass" type="number" min="3" max="60" step="1" value="10">
        </label>
        <button id="notes-list-export-bass" class="mini" type="button" disabled data-i18n="notes.exportList">Export list</button>
      </div>
    </section>

    <!-- Shared: tempo is derived from the drums stem and has never depended on which melodic
         stem is being read, so it lives once regardless of how many note panels exist above.
         Ids are unchanged from the single-panel version. -->
    <section id="notes-tempo" class="notes" hidden>
      <div class="notes-row">
        <label class="notes-ctl">
          <input id="notes-tempo-on" type="checkbox" checked>
          <span data-i18n="notes.tempoOn">Show tempo grid</span>
        </label>
        <label class="notes-ctl">
          <span data-i18n="notes.tempoBpm">BPM</span>
          <input id="notes-tempo-bpm" type="number" min="20" max="400" step="0.1" value="120" disabled>
        </label>
        <span class="notes-ctl">
          <button id="notes-tempo-half" class="mini" type="button" disabled
                  data-i18n-attr="title:notes.tempoHalfTip">&times;&#189;</button>
          <button id="notes-tempo-double" class="mini" type="button" disabled
                  data-i18n-attr="title:notes.tempoDoubleTip">&times;2</button>
        </span>
        <label class="notes-ctl">
          <span data-i18n="notes.tempoPhase">Phase</span>
          <button id="notes-tempo-phase-back" class="mini" type="button" disabled
                  data-i18n-attr="title:notes.tempoPhaseBackTip">&#9664;</button>
          <input id="notes-tempo-phase" type="number" step="1" value="0" disabled>
          <button id="notes-tempo-phase-fwd" class="mini" type="button" disabled
                  data-i18n-attr="title:notes.tempoPhaseFwdTip">&#9654;</button>
        </label>
        <label class="notes-ctl">
          <span data-i18n="notes.tempoBeats">Beats/bar</span>
          <select id="notes-tempo-beats" disabled>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4" selected>4</option>
            <option value="6">6</option>
          </select>
        </label>
        <button id="notes-tempo-range" class="mini" type="button" disabled
                data-i18n="notes.tempoRange" data-i18n-attr="title:notes.tempoRangeTip">Select BPM range</button>
        <button id="notes-tempo-redetect" class="mini" type="button" disabled
                data-i18n="notes.tempoRedetect">Re-detect tempo</button>
        <span id="notes-tempo-status" class="notes-stats"></span>
      </div>
    </section>
```

The `notes-tune`/`notes-io`/`notes-list-io` wrapper `<div>` ids also gain `-vocals`/`-bass` suffixes (`notes-tune-vocals`, `notes-io-vocals`, `notes-list-io-vocals`, and the `-bass` equivalents) even though nothing currently queries them by id — they were unnamed-but-id'd wrapper divs in the original (`id="notes-tune"`, `id="notes-io"`, `id="notes-list-io"`) that would otherwise collide across the two panels; suffixing keeps every id on the page unique, which HTML requires and which `document.getElementById` depends on to be unambiguous.

- [ ] **Step 2: Add the panel-header label style**

In `styles.css`, find:

```css
.notes { margin: 10px 0 0; display: flex; flex-direction: column; gap: 8px; }
.notes-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
```

Replace with:

```css
.notes { margin: 10px 0 0; display: flex; flex-direction: column; gap: 8px; }
.notes-panel-label { font: 600 12px var(--mono); color: var(--fg); }
.notes-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
```

- [ ] **Step 3: Run the automated test suite (limited value at this checkpoint — see Global Constraints)**

Run: reload `http://localhost:8777/tests/test.html`.
Expected: PASS on every `pitch:`/`sonify:`/`i18n:`/`analytics:`/`stems:`/etc. test (none of them load `notes.js` against `index.html`'s ids, so none of them see the now-stale ids `notes.js` still references). `tests/i18n.test.js`'s `'every key used in index.html exists in both locales'` test specifically re-scrapes `index.html` fresh — confirm it still passes, since the new `data-i18n="stem.vocals"` / `data-i18n="stem.bass"` attributes on the panel labels reference keys that already exist in both locales.
Do **not** attempt to load the app in a browser yet — `notes.js` still queries the old unsuffixed ids and will throw at its first `document.getElementById(...).addEventListener(...)` call, per the Global Constraints note.

- [ ] **Step 4: Commit**

```bash
git add index.html styles.css
git commit -m "$(cat <<'EOF'
feat: split the notes panel into per-stem vocals/bass panels

Two duplicated panels (suffixed ids) plus one shared tempo section,
per the bass-notes design spec. notes.js/app.js are updated in the
next two commits — the page does not run correctly until both land.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bph1E6jMTnBMWFipFpBTzf
EOF
)"
```

---

### Task 6: `notes.js` — `createNotesChannel` factory + shared tempo module

**Files:**
- Modify: `notes.js` (full rewrite)

**Interfaces:**
- Consumes: `BASS_RANGE`, `stemMismatch` from `lib/pitch.js` (Tasks 1, 3); `TIMBRES.bass` indirectly via the `'bass'` timbre name passed to `scheduleNotes` (Task 2); the suffixed DOM ids from `index.html` (Task 5); `window.sansBass.setNotes(stem, payload)` / `.ribbonMuted(stem)` / `.setRibbonVisible(stem, on)` / `.ribbonVisible(stem)` / `.notesAudio(stem)` — **not implemented until Task 7**, so this task alone does not produce a runnable page (see Global Constraints).
- Produces: two `createNotesChannel(stem, els)` instances (`'vocals'`, `'bass'`), each dispatching `sansbass:editmode` (now carrying `{ on, stem }`) only when it becomes the editable channel, and listening for `sansbass:noteedit`/`sansbass:editundo` gated on an internal `editable` flag set from that `stem` field — consumed by Task 7's global edit-toggle and zoomed-pane editing code. Also produces `sansbass:ribbonmute` listener filtering on `e.detail.stem === stem` (Task 7 is the one that now includes `stem` in that event's detail).

**A note on test coverage for the export/import stem tag:** the spec's Testing section asks for "exported edits carry a stem field; import warns on a mismatch without blocking" as one unit-testable item. The import-mismatch half is covered by `stemMismatch()` (Task 3, unit-tested in `pitch.test.js`). The export half — the `stem` field landing in the downloaded JSON — is not extracted into a separate pure function here: `els.exportBtn`'s click handler already reads several other DOM-coupled values (`el.clip.checked`, `currentMix()`, the shared `tempo`/`tempoRange`) to build that same payload, so isolating just the `stem` field into its own testable unit would be a disproportionate abstraction for one added line in an existing object literal. It is verified in Task 11's manual pass (Step 6) instead, alongside the mismatch warning it pairs with.

**A note on the `sansbass:noteedit`/`sansbass:editmode`/`sansbass:ribbonmute` event design:** the spec says these events need no `stem` tag on `noteedit`/`editundo` themselves, "since there is only ever one editable channel at a time by construction" — but both channel instances listen on the same `window`-level events, so without *some* per-channel gate, an edit meant for the currently-selected channel would also land in the other channel's `editGroups`. The gate is `editmode`'s own `stem` field: each channel tracks a private `editable` boolean, set to `true` only while `sansbass:editmode`'s `detail.stem` matches its own stem and `detail.on` is true. `noteedit`/`editundo` then check that flag and no stem tag is needed on them, matching the spec's actual claim.

- [ ] **Step 1: Replace the entire contents of `notes.js`**

```js
/* Notes panel: owns the analysis worker and the interpretation on top of it, for one
 * melodic stem — see createNotesChannel() below.
 *
 * The split matters and is the whole point of the design — see docs/transcription.md.
 * ANALYSIS (decimate + YIN) runs once in the worker and its result is immutable.
 * INTERPRETATION (interpret()) runs here on the main thread, because at ~12 ms it is
 * cheaper to run than to message, and that is what lets a slider re-derive live.
 *
 * A module, so it cannot share scope with app.js. It talks to the player only through
 * window.sansBass, exactly as separate.js does.
 *
 * Two independent channels — one per note-capable stem — are created at the bottom of this
 * file. Everything that is genuinely per-song state (frames, notes, edits, jianpu, the
 * worker) lives inside createNotesChannel()'s closure. Tempo is the one exception: it is
 * derived from the drums stem and has never depended on which melodic stem is being read,
 * so its state and DOM wiring stay shared, module-level code below the channel factory.
 * See docs/superpowers/specs/2026-09-01-bass-notes-design.md. */

import { interpret, applyEdits, detectKey, notesToChroma, relativeKey, stemMismatch, BASS_RANGE }
  from './lib/pitch.js?v=1.17.2';
import { scheduleNotes } from './lib/sonify.js?v=1.17.2';

const tr = (key, params) => window.SansI18n.t(key, params);

/* Note names are never translated in this app — a saved zip is `vocals.wav` in every
 * language, and C# is C# in every language too. */
const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const STEM_TIMBRE = { vocals: 'piano', bass: 'bass' };
const STEM_RANGE = { vocals: undefined, bass: BASS_RANGE };   // undefined -> the worker keeps YIN_DEFAULTS

/* English-only, like the major/minor word below — this file is read outside the app, where
 * the current UI language doesn't apply. Not routed through tr(); a dictionary key would
 * imply it is meant to be translated, which it deliberately never is. */
const STEM_WORD = { vocals: 'Vocals', bass: 'Bass' };

function mmss(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- shared: tempo grid
//
// Derived from the drums stem; refresh(), the tempo grid state, and its DOM wiring stay
// module-level rather than living inside either channel's closure, because both channels'
// note lanes draw the SAME beat/bar grid from the SAME detected tempo.

const tempoEl = {
  panel: document.getElementById('notes-tempo'),
  on: document.getElementById('notes-tempo-on'),
  bpm: document.getElementById('notes-tempo-bpm'),
  half: document.getElementById('notes-tempo-half'),
  double: document.getElementById('notes-tempo-double'),
  phase: document.getElementById('notes-tempo-phase'),
  phaseBack: document.getElementById('notes-tempo-phase-back'),
  phaseFwd: document.getElementById('notes-tempo-phase-fwd'),
  beats: document.getElementById('notes-tempo-beats'),
  rangeToggle: document.getElementById('notes-tempo-range'),
  redetect: document.getElementById('notes-tempo-redetect'),
  status: document.getElementById('notes-tempo-status'),
};

/* The tempo grid. `auto` stays true until the user touches a control (or presses Re-detect,
 * which always re-adopts auto). */
let tempo = { on: true, auto: true, bpmValue: 120, phaseMs: 0, beatsPerBar: 4, confidence: 0 };
let tempoRange = null;        // { from, to } in seconds, or null = whole song (the default)
let tempoRangeArmed = false;  // "Select BPM range" toggle; mirrored to app.js for the drag UI

const channels = [];   // filled at the bottom of this file; tempo handlers re-derive every channel

/** The drums stem's audio, sliced to `tempoRange` if one is set — sliced BEFORE handing to
 *  the worker, not after, so the protocol stays simple (the worker never knows about ranges)
 *  and less data crosses the postMessage boundary for a narrow selection. Returns null when
 *  there is no drums stem to analyse. */
function currentTempoRangeChannels() {
  const stem = window.sansBass.stemBuffer('drums');
  if (!stem) return null;
  const buffer = stem.buffer;
  const chans = [];
  for (let i = 0; i < buffer.numberOfChannels; i++) {
    const data = buffer.getChannelData(i);
    if (tempoRange) {
      const from = Math.max(0, Math.floor(tempoRange.from * buffer.sampleRate));
      const to = Math.min(data.length, Math.ceil(tempoRange.to * buffer.sampleRate));
      chans.push(data.slice(from, to));
    } else {
      chans.push(data.slice());
    }
  }
  return { channels: chans, sampleRate: buffer.sampleRate };
}

/** Adopts a fresh { bpmValue, phaseSec, confidence } from the worker. */
function applyTempoResult(result) {
  tempo = {
    on: true,
    auto: true,
    bpmValue: +result.bpmValue.toFixed(1),
    phaseMs: +(((tempoRange ? tempoRange.from : 0) * 1000) + result.phaseSec * 1000).toFixed(1),
    beatsPerBar: tempo.beatsPerBar,
    confidence: result.confidence,
  };
}

/* Every control but the panel-level checkbox is meaningless without a drums stem, so they go
 * visibly inert rather than silently doing nothing. */
function syncTempoControls() {
  const hasDrums = !!window.sansBass.stemBuffer('drums');
  for (const c of [tempoEl.bpm, tempoEl.half, tempoEl.double, tempoEl.phase,
                    tempoEl.phaseBack, tempoEl.phaseFwd, tempoEl.beats,
                    tempoEl.rangeToggle, tempoEl.redetect]) c.disabled = !hasDrums;
  tempoEl.on.checked = tempo.on;
  tempoEl.bpm.value = tempo.bpmValue;
  tempoEl.phase.value = tempo.phaseMs;
  tempoEl.beats.value = String(tempo.beatsPerBar);
  tempoEl.status.textContent = tempo.confidence > 0
    ? tr('notes.tempoStatus', { bpm: tempo.bpmValue.toFixed(1), pct: Math.round(tempo.confidence * 100) })
    : tr('notes.tempoStatusNone');
}

function reinterpretAll() { for (const c of channels) c.reinterpret(); }

tempoEl.on.addEventListener('change', () => { tempo.on = tempoEl.on.checked; reinterpretAll(); });
tempoEl.bpm.addEventListener('input', () => {
  const v = Number(tempoEl.bpm.value);
  if (Number.isFinite(v) && v > 0) { tempo.bpmValue = v; tempo.auto = false; }
  reinterpretAll();
});
tempoEl.half.addEventListener('click', () => {
  tempo.bpmValue = +(tempo.bpmValue / 2).toFixed(1);
  tempo.auto = false;
  reinterpretAll();
});
tempoEl.double.addEventListener('click', () => {
  tempo.bpmValue = +(tempo.bpmValue * 2).toFixed(1);
  tempo.auto = false;
  reinterpretAll();
});
const PHASE_NUDGE_MS = 10;
tempoEl.phase.addEventListener('input', () => {
  const v = Number(tempoEl.phase.value);
  if (Number.isFinite(v)) { tempo.phaseMs = v; tempo.auto = false; }
  reinterpretAll();
});
tempoEl.phaseBack.addEventListener('click', () => {
  tempo.phaseMs -= PHASE_NUDGE_MS;
  tempo.auto = false;
  reinterpretAll();
});
tempoEl.phaseFwd.addEventListener('click', () => {
  tempo.phaseMs += PHASE_NUDGE_MS;
  tempo.auto = false;
  reinterpretAll();
});
tempoEl.beats.addEventListener('change', () => {
  tempo.beatsPerBar = Number(tempoEl.beats.value);
  tempo.auto = false;
  reinterpretAll();
});
tempoEl.rangeToggle.addEventListener('click', () => {
  tempoRangeArmed = !tempoRangeArmed;
  tempoEl.rangeToggle.classList.toggle('note-tbtn-armed', tempoRangeArmed);
  window.dispatchEvent(new CustomEvent('sansbass:temporangemode', { detail: { on: tempoRangeArmed } }));
});
tempoEl.redetect.addEventListener('click', () => {
  const drums = currentTempoRangeChannels();
  if (!drums) return;
  const w = new Worker('./notes.worker.js?v=1.17.2', { type: 'module' });
  tempoEl.redetect.disabled = true;
  w.onmessage = (e) => {
    w.terminate();
    if (e.data.type === 'tempo') applyTempoResult(e.data.tempo);
    else if (e.data.type === 'error') window.sansBass.say('notes.failed', { message: e.data.message }, true);
    syncTempoControls();
    reinterpretAll();
  };
  w.onerror = (e) => {
    w.terminate();
    window.sansBass.say('notes.failed', { message: e.message || 'worker error' }, true);
    syncTempoControls();
  };
  w.postMessage({ type: 'tempo', channels: drums.channels, sampleRate: drums.sampleRate });
});
/* app.js owns the drag surface (the drums stem's own lane) and dispatches this once a
 * selection commits or the caption's Clear button is pressed. Mirrored here because this
 * copy is what persists across export/import and reset — see
 * docs/superpowers/specs/2026-09-01-tempo-grid-design.md. */
window.addEventListener('sansbass:temporange', (e) => { tempoRange = e.detail; });

function refreshTempo() {
  const anyMelodic = !!(window.sansBass?.stemBuffer?.('vocals') || window.sansBass?.stemBuffer?.('bass'));
  tempoEl.panel.hidden = !anyMelodic;
  syncTempoControls();
}

// ---------------------------------------------------------------- per-channel factory

function createNotesChannel(stem, els) {
  const timbre = STEM_TIMBRE[stem];
  const range = STEM_RANGE[stem];

  /* Populated per channel — each has its own <select>. */
  for (let i = 0; i < 12; i++) {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = PITCH_CLASSES[i];
    els.keyTonic.appendChild(o);
  }

  /* On the label, not the input: the checkbox itself is a 13 px target and the sentence
   * beside it is what the pointer actually rests on. */
  const syncTips = () => {
    els.hmm.parentElement.title = tr('notes.hmmTip');
    els.clip.parentElement.title = tr('notes.clipTip');
    els.fold.parentElement.title = tr('notes.foldTip');
    els.foldTol.parentElement.title = tr('notes.foldTolTip');
    els.jianpu.parentElement.title = tr('notes.jianpuTip');
    els.keyRel.title = tr('notes.relativeTip');
  };
  syncTips();

  let worker = null;
  let frames = null;           // the immutable analysis result
  let notes = [];
  let analysedBuffer = null;   // identity of the AudioBuffer `frames` was computed from
  let sonifier = null;         // the running note schedule, or null
  let editable = false;        // this channel is the one currently in edit mode

  /* The 簡譜 reading. `auto` stays true until the user touches a control, so a fresh detection
   * on a newly loaded song adopts its key — but never overrides a choice already made. */
  let jianpu = { on: false, tonic: 0, mode: 'major', auto: true };

  /* The edit list, as GROUPS — see docs/superpowers/specs/2026-08-31-note-editing-design.md. */
  let editGroups = [];
  let orphaned = [];
  let nextEditId = 1;

  function currentParams() {
    return {
      interpreter: els.hmm.checked ? 'hmm-v1' : 'threshold-v1',
      params: {
        minDurationMs: Number(els.min.value),
        fold: els.fold.checked,
        confidentWithin: Number(els.foldTol.value),
      },
    };
  }

  function syncFoldControls() {
    const on = els.fold.checked;
    els.foldTol.disabled = !on;
    els.foldTolOut.textContent = tr('notes.foldTolVal', { n: els.foldTol.value });
    els.foldTolOut.classList.toggle('risky', Number(els.foldTol.value) >= 2.5);
    els.foldStats.hidden = !on;
    if (!on) return;
    let folded = 0;
    let muted = 0;
    for (const n of notes) {
      if (!n.fix) continue;
      if (n.fix.state === 'folded') folded++;
      else if (n.fix.state === 'doubt') muted++;
    }
    const frag = (key, n, cls) => {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = tr(key, { n });
      return span;
    };
    els.foldStats.replaceChildren(
      frag('notes.foldStatsFolded', folded, 'n-fold'),
      document.createTextNode(' · '),
      frag('notes.foldStatsMuted', muted, 'n-mute'),
    );
  }

  function editTypeLabel(edit) {
    const KEYS = {
      octave: edit.dir > 0 ? 'notes.editOctaveUp' : 'notes.editOctaveDown',
      pitchNudge: edit.semitones > 0 ? 'notes.editPitchUp' : 'notes.editPitchDown',
      timeAdjust: 'notes.editTimeAdjustLabel',
      delete: 'notes.editDeleteLabel',
      add: 'notes.editAddLabel',
      rangeDelete: 'notes.editRangeDeleteLabel',
    };
    return tr(KEYS[edit.type]);
  }

  function groupLabel(group) {
    return group.edits.length > 1 ? tr('notes.editSplitLabel') : editTypeLabel(group.edits[0]);
  }

  function groupTimeLabel(group) {
    const e = group.edits[0];
    if (e.type === 'rangeDelete') return `${e.from.toFixed(2)}–${e.to.toFixed(2)}s`;
    if (e.type === 'add') return `${e.start.toFixed(2)}s`;
    return `${e.at.toFixed(2)}s`;
  }

  function renderEditList() {
    els.editsRow.hidden = editGroups.length === 0;
    els.editsSummary.textContent = tr('notes.editsSummary', { n: editGroups.length });
    els.editUndo.disabled = editGroups.length === 0;
    els.editRows.replaceChildren(...editGroups.map((g) => {
      const li = document.createElement('li');
      li.className = 'edit-row';
      if (g.edits.some((e) => orphaned.includes(e))) {
        const warn = document.createElement('span');
        warn.className = 'edit-warn';
        warn.textContent = '⚠';
        warn.title = tr('notes.editOrphanTip');
        li.appendChild(warn);
      }
      const label = document.createElement('span');
      label.textContent = `${groupLabel(g)} · ${groupTimeLabel(g)}`;
      li.appendChild(label);
      const rm = document.createElement('button');
      rm.className = 'mini edit-remove';
      rm.type = 'button';
      rm.textContent = '✕';
      rm.title = tr('notes.editRemoveTip');
      rm.addEventListener('click', () => {
        editGroups = editGroups.filter((x) => x.id !== g.id);
        reinterpret();
      });
      li.appendChild(rm);
      return li;
    }));
  }

  function syncJianpuControls() {
    els.keyTonic.value = String(jianpu.tonic);
    els.keyMode.value = jianpu.mode;
    for (const c of [els.keyTonic, els.keyMode, els.keyRel]) c.disabled = !jianpu.on;
    els.listExport.disabled = !notes.length;
  }

  /** Re-derive notes from the existing frames. No worker, no re-analysis. */
  function reinterpret() {
    if (!frames) return;
    const p = currentParams();
    notes = interpret(frames, p);
    const applied = applyEdits(notes, editGroups.flatMap((g) => g.edits));
    notes = applied.notes;
    orphaned = applied.orphaned;
    els.count.textContent = tr('notes.count', { n: notes.length });
    els.minOut.textContent = `${els.min.value} ms`;
    syncFoldControls();
    if (jianpu.auto && notes.length) {
      const k = detectKey(notesToChroma(notes));
      jianpu.tonic = k.tonic;
      jianpu.mode = k.mode;
    }
    syncJianpuControls();
    window.sansBass.setNotes(stem, {
      notes, frames, params: p, clip: els.clip.checked,
      jianpu: { on: jianpu.on, tonic: jianpu.tonic, mode: jianpu.mode },
      tempo: { on: tempo.on, bpmValue: tempo.bpmValue, phaseMs: tempo.phaseMs, beatsPerBar: tempo.beatsPerBar },
    });
    resync();
    renderEditList();
  }

  /* Start (or restart) the synth against the transport's OWN t0 and offset. */
  function resync() {
    if (sonifier) { sonifier.stop(); sonifier = null; }
    if (!frames || !notes.length) return;
    if (window.sansBass.ribbonMuted(stem)) return;
    const audio = window.sansBass.notesAudio(stem);
    const t = window.sansBass.transport();
    if (!audio || !t.playing) return;
    sonifier = scheduleNotes(audio.ctx, audio.destination, notes, {
      timbre, when: t.t0, offset: t.offset, loopA: t.loopA, loopB: t.loopB,
    });
  }

  function syncShowLabel() {
    els.show.textContent = tr(window.sansBass.ribbonVisible(stem) ? 'notes.hide' : 'notes.show');
  }

  function reset() {
    if (sonifier) { sonifier.stop(); sonifier = null; }
    if (worker) { worker.terminate(); worker = null; els.go.disabled = false; }
    els.show.hidden = true;
    els.go.hidden = false;
    frames = null;
    notes = [];
    analysedBuffer = null;
    els.tune.hidden = true;
    els.count.textContent = '';
    jianpu.auto = true;
    editGroups = [];
    orphaned = [];
    els.exportBtn.disabled = true;
    els.importBtn.disabled = true;
    /* Only announce if THIS channel believed it was the editable one — otherwise a reset on
     * the channel that ISN'T currently selected would blank editmode out from under whichever
     * channel actually is (every 'on:false' clears editable everywhere, stem match or not). */
    if (editable) window.dispatchEvent(new CustomEvent('sansbass:editmode', { detail: { on: false, stem: null } }));
    renderEditList();
    syncJianpuControls();
  }

  function analyse() {
    const stemAudio = window.sansBass.stemBuffer(stem);
    if (!stemAudio) return;

    els.go.disabled = true;
    window.sansBass.say('notes.working');

    const buffer = stemAudio.buffer;
    const chans = [];
    for (let i = 0; i < buffer.numberOfChannels; i++) chans.push(buffer.getChannelData(i).slice());

    const drums = currentTempoRangeChannels();

    worker = new Worker('./notes.worker.js?v=1.17.2', { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      worker.terminate();
      worker = null;
      els.go.disabled = false;
      if (m.type === 'error') {
        window.sansBass.say('notes.failed', { message: m.message }, true);
        return;
      }
      window.sansBass.say('');
      frames = m.frames;
      if (m.tempo) { applyTempoResult(m.tempo); syncTempoControls(); }
      els.tune.hidden = false;
      els.go.hidden = true;
      els.show.hidden = false;
      els.exportBtn.disabled = false;
      els.importBtn.disabled = false;
      syncShowLabel();
      // Not just reinterpret(): a tempo result above belongs to BOTH channels, so the other
      // channel (if it already has frames) must also pick up the fresh grid.
      reinterpretAll();
    };
    worker.onerror = (e) => {
      if (worker) { worker.terminate(); worker = null; }
      els.go.disabled = false;
      window.sansBass.say('notes.failed', { message: e.message || 'worker error' }, true);
    };
    analysedBuffer = buffer;
    worker.postMessage({
      type: 'analyse', channels: chans, sampleRate: buffer.sampleRate,
      ...(drums ? { drums } : {}),
      ...(range ? { range } : {}),
    });
  }

  /* The panel is only meaningful with this stem loaded, and there is no load event to hang
   * this on — separate.js polls the same way, for the same reason. */
  function refresh() {
    const stemAudio = window.sansBass?.stemBuffer?.(stem);
    els.panel.hidden = !stemAudio;
    if (frames && (!stemAudio || stemAudio.buffer !== analysedBuffer)) reset();
  }

  els.go.addEventListener('click', analyse);
  els.min.addEventListener('input', reinterpret);
  els.clip.addEventListener('change', reinterpret);
  els.hmm.addEventListener('change', reinterpret);
  els.fold.addEventListener('change', reinterpret);
  els.foldTol.addEventListener('input', reinterpret);
  els.jianpu.addEventListener('change', () => {
    jianpu.on = els.jianpu.checked;
    syncJianpuControls();
    reinterpret();
  });
  els.show.addEventListener('click', () => {
    window.sansBass.setRibbonVisible(stem, !window.sansBass.ribbonVisible(stem));
    syncShowLabel();
  });
  for (const c of [els.keyTonic, els.keyMode]) {
    c.addEventListener('change', () => {
      jianpu.auto = false;
      jianpu.tonic = Number(els.keyTonic.value);
      jianpu.mode = els.keyMode.value;
      reinterpret();
    });
  }
  els.keyRel.addEventListener('click', () => {
    const r = relativeKey(jianpu.tonic, jianpu.mode);
    jianpu.auto = false;
    jianpu.tonic = r.tonic;
    jianpu.mode = r.mode;
    syncJianpuControls();
    reinterpret();
  });
  window.addEventListener('sansbass:langchange', () => {
    if (frames) {
      els.count.textContent = tr('notes.count', { n: notes.length });
      syncShowLabel();
    }
    syncTips();
  });
  /* The player broadcasts its transport because app.js is a classic script and this file is
   * a module — the same seam the language switch uses. */
  window.addEventListener('sansbass:transport', (e) => {
    if (!e.detail.playing) {
      if (sonifier) { sonifier.stop(); sonifier = null; }
      return;
    }
    resync();
  });
  window.addEventListener('sansbass:ribbonmute', (e) => {
    if (e.detail.stem === stem) resync();
  });
  window.addEventListener('sansbass:editmode', (e) => {
    editable = e.detail.stem === stem && e.detail.on;
  });
  window.addEventListener('sansbass:noteedit', (e) => {
    if (!editable) return;
    editGroups.push({ id: nextEditId++, edits: e.detail.edits });
    reinterpret();
  });
  els.editUndo.addEventListener('click', () => {
    editGroups.pop();
    reinterpret();
  });
  window.addEventListener('sansbass:editundo', () => {
    if (!editable) return;
    editGroups.pop();
    reinterpret();
  });
  document.addEventListener('pointerdown', (e) => {
    if (els.editsRow.open && !els.editsRow.contains(e.target)) els.editsRow.open = false;
  });

  els.exportBtn.addEventListener('click', () => {
    const mix = window.sansBass.currentMix ? window.sansBass.currentMix() : null;
    const payload = {
      version: 1,
      stem,
      ...(mix ? { song: mix.name } : {}),
      ...currentParams(),
      clip: els.clip.checked,
      jianpu: { on: jianpu.on, tonic: jianpu.tonic, mode: jianpu.mode },
      tempo: { on: tempo.on, bpmValue: tempo.bpmValue, phaseMs: tempo.phaseMs, beatsPerBar: tempo.beatsPerBar },
      tempoRange,
      edits: editGroups.map((g) => g.edits),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${mix ? mix.name : 'song'}-${stem}-edits.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });

  els.listExport.addEventListener('click', () => {
    const secs = Number(els.listSecs.value) || 10;
    const mix = window.sansBass.currentMix ? window.sansBass.currentMix() : null;
    const refOct = window.SansJianpu.referenceOctave(notes, jianpu.tonic);

    const windows = new Map();
    for (const n of notes) {
      const idx = Math.floor(n.start / secs);
      if (!windows.has(idx)) windows.set(idx, []);
      windows.get(idx).push(n);
    }

    const modeWord = jianpu.mode === 'minor' ? 'minor' : 'major';
    const lines = [`## ${mix ? mix.name + ' — ' : ''}${STEM_WORD[stem]} — 1=${PITCH_CLASSES[jianpu.tonic]} ${modeWord}`, ''];
    for (const idx of [...windows.keys()].sort((a, b) => a - b)) {
      const from = idx * secs;
      const to = from + secs;
      lines.push(`### ${mmss(from)} - ${mmss(to)}`);
      lines.push(windows.get(idx)
        .map((n) => window.SansJianpu.degreeToken(n.midi, jianpu.tonic, jianpu.mode, refOct))
        .join(' '));
      lines.push('');
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${mix ? mix.name : 'song'}-${stem}-notes.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });

  els.importBtn.addEventListener('click', () => els.importFile.click());

  els.importFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      window.sansBass.say('notes.importFailed', { message: err.message }, true);
      return;
    }
    if (!data || data.version !== 1 || !Array.isArray(data.edits)) {
      window.sansBass.say('notes.importFailed', { message: 'not a note-edits file' }, true);
      return;
    }

    const mix = window.sansBass.currentMix ? window.sansBass.currentMix() : null;
    if (data.song && mix && data.song !== mix.name) {
      window.sansBass.say('notes.importMismatch', { song: data.song }, true);
    }
    if (stemMismatch(data, stem)) {
      window.sansBass.say('notes.importStemMismatch', { stem: tr('stem.' + data.stem) }, true);
    }

    if (data.params) {
      if (data.params.minDurationMs != null) els.min.value = data.params.minDurationMs;
      els.fold.checked = !!data.params.fold;
      if (data.params.confidentWithin != null) els.foldTol.value = data.params.confidentWithin;
    }
    els.hmm.checked = data.interpreter !== 'threshold-v1';
    els.clip.checked = data.clip !== false;
    if (data.jianpu) {
      jianpu.on = !!data.jianpu.on;
      jianpu.auto = false;
      jianpu.tonic = data.jianpu.tonic ?? 0;
      jianpu.mode = data.jianpu.mode || 'major';
      els.jianpu.checked = jianpu.on;
    }
    if (data.tempo) {
      tempo.on = !!data.tempo.on;
      tempo.auto = false;
      if (data.tempo.bpmValue != null) tempo.bpmValue = data.tempo.bpmValue;
      if (data.tempo.phaseMs != null) tempo.phaseMs = data.tempo.phaseMs;
      if (data.tempo.beatsPerBar != null) tempo.beatsPerBar = data.tempo.beatsPerBar;
      syncTempoControls();
    }
    if (data.tempoRange !== undefined) {
      tempoRange = data.tempoRange || null;
      window.sansBass.setTempoRange(tempoRange);
    }
    editGroups = data.edits.map((edits) => ({ id: nextEditId++, edits }));
    syncJianpuControls();
    // Not just reinterpret(): an imported tempo (shared across both channels) may have
    // changed, and the sibling channel needs to redraw its own grid too.
    reinterpretAll();
  });

  syncJianpuControls();      // the selectors are inert until 簡譜 is ticked, from the first paint

  return { refresh, reinterpret };
}

// ---------------------------------------------------------------- two instances

channels.push(createNotesChannel('vocals', {
  panel: document.getElementById('notes-vocals'),
  go: document.getElementById('notes-go-vocals'),
  count: document.getElementById('notes-count-vocals'),
  tune: document.getElementById('notes-tune-vocals'),
  min: document.getElementById('notes-min-vocals'),
  minOut: document.getElementById('notes-min-out-vocals'),
  clip: document.getElementById('notes-clip-vocals'),
  hmm: document.getElementById('notes-hmm-vocals'),
  fold: document.getElementById('notes-fold-vocals'),
  foldTol: document.getElementById('notes-fold-tol-vocals'),
  foldTolOut: document.getElementById('notes-fold-tol-out-vocals'),
  foldStats: document.getElementById('notes-fold-stats-vocals'),
  show: document.getElementById('notes-show-vocals'),
  editsRow: document.getElementById('notes-edits-vocals'),
  editsSummary: document.getElementById('notes-edits-summary-vocals'),
  editUndo: document.getElementById('notes-edit-undo-vocals'),
  editRows: document.getElementById('notes-edit-rows-vocals'),
  exportBtn: document.getElementById('notes-export-vocals'),
  importBtn: document.getElementById('notes-import-vocals'),
  importFile: document.getElementById('notes-import-file-vocals'),
  listSecs: document.getElementById('notes-list-secs-vocals'),
  listExport: document.getElementById('notes-list-export-vocals'),
  jianpu: document.getElementById('notes-jianpu-vocals'),
  keyTonic: document.getElementById('notes-key-tonic-vocals'),
  keyMode: document.getElementById('notes-key-mode-vocals'),
  keyRel: document.getElementById('notes-key-rel-vocals'),
}));

channels.push(createNotesChannel('bass', {
  panel: document.getElementById('notes-bass'),
  go: document.getElementById('notes-go-bass'),
  count: document.getElementById('notes-count-bass'),
  tune: document.getElementById('notes-tune-bass'),
  min: document.getElementById('notes-min-bass'),
  minOut: document.getElementById('notes-min-out-bass'),
  clip: document.getElementById('notes-clip-bass'),
  hmm: document.getElementById('notes-hmm-bass'),
  fold: document.getElementById('notes-fold-bass'),
  foldTol: document.getElementById('notes-fold-tol-bass'),
  foldTolOut: document.getElementById('notes-fold-tol-out-bass'),
  foldStats: document.getElementById('notes-fold-stats-bass'),
  show: document.getElementById('notes-show-bass'),
  editsRow: document.getElementById('notes-edits-bass'),
  editsSummary: document.getElementById('notes-edits-summary-bass'),
  editUndo: document.getElementById('notes-edit-undo-bass'),
  editRows: document.getElementById('notes-edit-rows-bass'),
  exportBtn: document.getElementById('notes-export-bass'),
  importBtn: document.getElementById('notes-import-bass'),
  importFile: document.getElementById('notes-import-file-bass'),
  listSecs: document.getElementById('notes-list-secs-bass'),
  listExport: document.getElementById('notes-list-export-bass'),
  jianpu: document.getElementById('notes-jianpu-bass'),
  keyTonic: document.getElementById('notes-key-tonic-bass'),
  keyMode: document.getElementById('notes-key-mode-bass'),
  keyRel: document.getElementById('notes-key-rel-bass'),
}));

function refreshAll() {
  refreshTempo();
  for (const c of channels) c.refresh();
}
setInterval(refreshAll, 400);
refreshAll();
```

- [ ] **Step 2: Run the automated test suite (limited value at this checkpoint — see Global Constraints)**

Run: reload `http://localhost:8777/tests/test.html`.
Expected: PASS on every `pitch:`/`sonify:`/`i18n:`/`analytics:`/`stems:`/`tempo:`/`ribbon:`/`jianpu:`/`overlap:`/`wav:`/`zip:`/`unzip:`/`platform:` test — none of them load `notes.js` in a way that exercises `window.sansBass`, so its still-missing per-stem methods (Task 7) don't surface here. `tests/notes.test.js` only imports `../notes.worker.js` and `../lib/pitch.js` directly, never `../notes.js` itself (confirmed by its imports), so it is unaffected by this rewrite.
Do **not** attempt to load the app in a browser yet — `notes.js` now calls `window.sansBass.setNotes(stem, ...)` etc., which `app.js` (unmodified) does not yet provide with that signature.

- [ ] **Step 3: Commit**

```bash
git add notes.js
git commit -m "$(cat <<'EOF'
feat: restructure notes.js into a two-instance channel factory

createNotesChannel(stem, els) holds per-song state; tempo grid state
and its DOM wiring stay shared, since tempo is drums-derived and
stem-agnostic. Two instances are created, for vocals and bass.
Exports/imports gain a stem tag; the bass channel uses BASS_RANGE and
the 'bass' timbre. app.js is updated in the next commit — the page
does not run correctly until it lands.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bph1E6jMTnBMWFipFpBTzf
EOF
)"
```

---

### Task 7: `app.js` — per-stem note lanes, two-chip zoomed-pane selector, `window.sansBass` surface

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: `notes.js`'s calls to `window.sansBass.setNotes(stem, payload)` / `.ribbonMuted(stem)` / `.setRibbonVisible(stem, on)` / `.ribbonVisible(stem)` / `.notesAudio(stem)` (Task 6); the suffixed-but-shared tempo ids are untouched by this task (Task 5/6 own them entirely — `app.js` never referenced `#notes-tempo-*` ids directly, only the `sansbass:temporange`/`sansbass:temporangemode` events, which are unaffected here).
- Produces: the final `window.sansBass` surface (Task 6 already assumes this shape); `noteLanes`, `zoomNotesStem`, `currentRibbon()` as the seams every zoomed-pane/editing function now goes through instead of a bare singular `ribbon` variable.

This is the task that makes the page runnable again — after this commit, Tasks 5–7 together reproduce every existing single-vocals behaviour (with `notes-vocals`/`notes-bass` both wired) plus the new bass channel and two-chip selector.

Steps below are ordered top-to-bottom through `app.js` as it stands before this task (line numbers are approximate — match on the quoted text, which is unique).

- [ ] **Step 1: Replace the singular ribbon/zoom-notes state declarations**

Find:

```js
let ribbon = null;         // { notes, frames, params, clip } from notes.js, or null
let ribbonEl = null;       // { lane, canvas, txt, grip } — rebuilt with the lanes each load
let ribbonGain = null;     // GainNode for the synthesised notes, into master
let ribbonMuted = true;    // silent until asked for: the lane is a reference, not a part
let ribbonVolume = 1;
let ribbonHeight = readRibbonHeight();
```

Replace with:

```js
const NOTE_STEMS = ['vocals', 'bass'];   // vocals-priority order — anchors the zoomed pane,
                                          // and breaks the (practically unreachable) exact-tie
                                          // in setNotes() below
let noteLanes = {};        // stem -> { ribbon, el: {lane,canvas,txt,grip}, gain, muted, rangeHint }
                            // (volume lives in ribbonVolume[stem] below, not snapshotted here)
let zoomNotesStem = null;  // which channel's notes the zoomed pane currently shows: 'vocals' | 'bass' | null
let zoomNotesChipEls = {}; // stem -> { select, spk } for the zoomed pane's "Notes: <lane>" chip pair
let editToggleEl = null;   // the one global Edit-notes checkbox, beside the two Notes chips
let ribbonVolume = { vocals: 1, bass: 1 };
let ribbonHeight = { vocals: readStoredNumber(`${RIBBON_H_KEY}.vocals`, RIBBON_H_DEFAULT, clampRibbonH),
                      bass: readStoredNumber(`${RIBBON_H_KEY}.bass`, RIBBON_H_DEFAULT, clampRibbonH) };
```

- [ ] **Step 2: Drop `'notes'` from `zoomLaneSel`'s default and its comment**

Find:

```js
/* What the zoomed pane shows: any mix of stem ids (their waveform, gray while 'notes' is
 * also selected, in their own colour when it isn't) plus the literal 'notes' entry (the
 * detected-pitch overlay this pane was originally built around). Not persisted — every
 * fresh page load starts back at the default. A stem id it contains that the current song
 * doesn't have is simply never drawn. */
let zoomLaneSel = new Set(['vocals', 'notes']);
let zoomChipEls = [];      // [{ stem, select, label, spk }] for the current song's lane chips
let zoomNotesChipEl = null;
let zoomNotesMuteEl = null;
```

Replace with:

```js
/* What the zoomed pane shows as plain waveforms: any mix of stem ids (their waveform, gray
 * while a Notes chip is also selected — see zoomNotesStem above — in their own colour when
 * none is). Not persisted — every fresh page load starts back at the default. A stem id it
 * contains that the current song doesn't have is simply never drawn. */
let zoomLaneSel = new Set(['vocals']);
let zoomChipEls = [];      // [{ stem, select, label, spk }] for the current song's lane chips
```

- [ ] **Step 3: Remove the singular `ribbonRangeHint` declaration**

Find:

```js
let zoomRangeHint = null;   // the "drag along the bottom" caption under the zoomed canvas
let ribbonRangeHint = null; // the same caption under the full-song notes lane
```

Replace with:

```js
let zoomRangeHint = null;   // the "drag along the bottom" caption under the zoomed canvas
```

(the per-lane equivalent now lives at `noteLanes[stem].rangeHint`).

- [ ] **Step 4: Make `ribbonVisible` per-stem**

Find:

```js
let ribbonVisible = readStoredFlag(RIBBON_SHOW_KEY, true);
```

Replace with:

```js
let ribbonVisible = { vocals: readStoredFlag(`${RIBBON_SHOW_KEY}.vocals`, true),
                       bass: readStoredFlag(`${RIBBON_SHOW_KEY}.bass`, true) };
```

- [ ] **Step 5: Delete the now-unused `readRibbonHeight()` function**

Find:

```js
function readRibbonHeight() {
  return readStoredNumber(RIBBON_H_KEY, RIBBON_H_DEFAULT, clampRibbonH);
}

function readZoomSeconds() {
```

Replace with:

```js
function readZoomSeconds() {
```

- [ ] **Step 6: `ensureAudio()` no longer creates a singular ribbon gain node**

Find:

```js
function ensureAudio() {
  if (!audio) {
    // MUST be 44100: decodeAudioData resamples to the context rate, and the separation
    // model requires 44.1 kHz. A default 48 kHz context on macOS would feed it stretched
    // audio and produce quietly wrong stems with no error anywhere.
    audio = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    master = audio.createGain();
    master.gain.value = parseFloat(el.masterVol.value);
    master.connect(audio.destination);
    // Into master, so master volume governs the synth exactly as it governs the stems.
    ribbonGain = audio.createGain();
    ribbonGain.gain.value = ribbonMuted ? 0 : ribbonVolume;
    ribbonGain.connect(master);
  }
  if (audio.state === 'suspended') audio.resume();
  return audio;
}
```

Replace with:

```js
function ensureAudio() {
  if (!audio) {
    // MUST be 44100: decodeAudioData resamples to the context rate, and the separation
    // model requires 44.1 kHz. A default 48 kHz context on macOS would feed it stretched
    // audio and produce quietly wrong stems with no error anywhere.
    audio = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    master = audio.createGain();
    master.gain.value = parseFloat(el.masterVol.value);
    master.connect(audio.destination);
    // Each stem's synthesised-notes gain node is created per lane, in buildUI() — no lane
    // exists yet the first time ensureAudio() runs, before any song is loaded.
  }
  if (audio.state === 'suspended') audio.resume();
  return audio;
}
```

- [ ] **Step 7: `buildUI()` — replace the teardown lines and the whole `if (vocals) { ... }` block**

Find:

```js
  // lanes
  /* The previous song's frames describe the previous song's audio; drawn against the new
   * duration they would be silently wrong. Drop them before the lanes are rebuilt. */
  ribbon = null;
  zoomPeaksByStem = {};
```

Replace with:

```js
  // lanes
  /* The previous song's frames describe the previous song's audio; drawn against the new
   * duration they would be silently wrong. Drop them before the lanes are rebuilt. */
  zoomPeaksByStem = {};
```

Then find the entire block from `ribbonEl = null;` through the closing `}` that ends the `if (vocals) { ... }` construction (immediately followed by `attachSeek(el.mainWave);`):

```js
  ribbonEl = null;
  zoomEl = null;
  zoomChipEls = [];
  zoomNotesChipEl = null;
  zoomNotesMuteEl = null;
  const vocals = tracks.find((t) => t.stem === 'vocals');
  if (vocals) {
    const lane = document.createElement('div');
    lane.className = 'lane ribbon';
    lane.hidden = true;

    const name = document.createElement('div');
    name.className = 'lane-name';
    name.title = tr('notes.muteTip');
    const dot = document.createElement('span');
    dot.className = 'dot';
    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = tr('notes.lane');
    name.append(dot, txt);
    name.addEventListener('click', toggleRibbon);

    const canvas = document.createElement('canvas');
    canvas.className = 'wave';

    const vol = document.createElement('div');
    vol.className = 'lane-vol';
    const slider = document.createElement('input');
    Object.assign(slider, { type: 'range', min: 0, max: 1.5, step: 0.01, value: ribbonVolume });
    slider.addEventListener('input', () => { ribbonVolume = parseFloat(slider.value); applyRibbonGain(); });
    vol.appendChild(slider);

    /* Drag the bottom edge to grow the lane. Height is the only way to read pitch: at the
     * default the range can span 27 semitones, and note names need roughly 9 px each. */
    const grip = document.createElement('div');
    grip.className = 'ribbon-grip';
    grip.title = tr('notes.resizeTip');
    attachResize(grip, () => ribbonHeight, (v) => { ribbonHeight = v; }, RIBBON_H_KEY);

    /* Names the bottom range-select band, same reasoning as the zoomed pane's equivalent
     * caption (see 'sansbass:editmode' listener) — the band alone doesn't say what it's for. */
    const rHint = document.createElement('div');
    rHint.className = 'note-range-hint';
    rHint.textContent = tr('notes.rangeTip');
    rHint.hidden = !editMode;
    ribbonRangeHint = rHint;

    lane.append(name, canvas, rHint, vol, grip);
    el.lanes.insertBefore(lane, vocals.laneEl.nextSibling);
    attachSeek(canvas, { rangeBand: true });
    ribbonEl = { lane, canvas, txt, grip };
    lane.classList.toggle('muted', ribbonMuted);

    /* The zoomed pane. It shares the lane grid so its canvas starts on the same pixel as
     * every waveform, but NOT the time mapping — it shows a window, which is the whole
     * point. That is why zoom is a separate pane rather than a zoom of the lane itself:
     * the full-width lanes keep one shared grid, and this gets its own. */
    const zLane = document.createElement('div');
    zLane.className = 'lane ribbon-zoom';

    const zName = document.createElement('div');
    zName.className = 'lane-name';
    const zTxt = document.createElement('span');
    zTxt.className = 'txt';
    zTxt.textContent = tr('notes.zoom');

    const zOut = document.createElement('span');
    zOut.className = 'zoom-secs';

    /* Buttons as well as the wheel: a trackpad wheel is easy to overshoot, and on a
     * touch device there is no wheel at all. Both routes go through zoomBy. */
    const zBtns = document.createElement('span');
    zBtns.className = 'zoom-btns';
    const mkBtn = (label, factor, key) => {
      const b = document.createElement('button');
      b.className = 'zoom-btn';
      b.textContent = label;
      b.title = tr(key);
      b.addEventListener('click', () => zoomBy(factor));
      return b;
    };
    zBtns.append(mkBtn('−', 1.5, 'notes.zoomOut'), mkBtn('+', 1 / 1.5, 'notes.zoomIn'));

    /* Sub-beat dotted-line toggles — view options for this pane, same family as the zoom
     * level buttons beside them, not a lane selection (which is why they sit here rather
     * than in zLaneSel below). */
    const zSubBtns = document.createElement('span');
    zSubBtns.className = 'zoom-btns zoom-sub-btns';
    halfBeatBtn = document.createElement('button');
    halfBeatBtn.type = 'button';
    halfBeatBtn.className = 'mini zoom-sub-btn';
    halfBeatBtn.classList.toggle('active', showHalfBeat);
    halfBeatBtn.textContent = '½';
    halfBeatBtn.title = tr('notes.zoomHalfBeatTip');
    halfBeatBtn.addEventListener('click', toggleHalfBeat);
    quarterBeatBtn = document.createElement('button');
    quarterBeatBtn.type = 'button';
    quarterBeatBtn.className = 'mini zoom-sub-btn';
    quarterBeatBtn.classList.toggle('active', showQuarterBeat);
    quarterBeatBtn.textContent = '¼';
    quarterBeatBtn.title = tr('notes.zoomQuarterBeatTip');
    quarterBeatBtn.addEventListener('click', toggleQuarterBeat);
    zSubBtns.append(halfBeatBtn, quarterBeatBtn);

    /* The label stays with what it actually names — the seconds readout and the zoom
     * buttons — on one row. It used to sit alone above a second row of lane chips, which
     * read as if it were labelling THEM instead. */
    const zTopRow = document.createElement('div');
    zTopRow.className = 'zoom-top-row';
    const zSecsGroup = document.createElement('span');
    zSecsGroup.className = 'zoom-secs-group';
    zSecsGroup.append(zOut, zBtns, zSubBtns);
    zTopRow.append(zTxt, zSecsGroup);

    /* Which stem(s) — and whether the detected-notes overlay — the pane below draws. One
     * chip per stem actually in this song, plus a 'notes' chip: a coloured dot AND its
     * stem name (a colour alone doesn't say which lane it is), toggling it into the pane,
     * plus (stems only) a speaker glyph that mutes/unmutes the lane exactly like clicking
     * its row in the main list does (see toggleTrack). Its own row below the title/seconds
     * row, so it reads as a distinct control — lane selection, not a caption for anything
     * above it — and so six-plus chips have room without crowding that row. */
    const zLaneSel = document.createElement('span');
    zLaneSel.className = 'zoom-lane-sel';
    zoomChipEls = tracks.filter((t) => t.stem).map((t) => {
      const chip = document.createElement('span');
      chip.className = 'zoom-chip';
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'zoom-chip-select';
      select.style.setProperty('--chip-color', t.color);
      select.title = tr('notes.zoomLaneShowTip', { lane: laneLabel(t) });
      const dot = document.createElement('span');
      dot.className = 'zoom-chip-dot';
      const label = document.createElement('span');
      label.className = 'zoom-chip-label';
      label.textContent = laneLabel(t);
      select.append(dot, label);
      select.addEventListener('click', () => toggleZoomLane(t.stem));
      const spk = document.createElement('button');
      spk.type = 'button';
      spk.className = 'zoom-chip-mute';
      spk.textContent = '♪';
      spk.title = tr('notes.zoomLaneMuteTip', { lane: laneLabel(t) });
      spk.addEventListener('click', () => toggleTrack(t));
      chip.append(select, spk);
      zLaneSel.appendChild(chip);
      return { stem: t.stem, select, label, spk };
    });
    const notesChip = document.createElement('span');
    notesChip.className = 'zoom-chip';
    zoomNotesChipEl = document.createElement('button');
    zoomNotesChipEl.type = 'button';
    zoomNotesChipEl.className = 'mini zoom-notes-chip';
    zoomNotesChipEl.textContent = tr('notes.zoomNotesChip');
    zoomNotesChipEl.title = tr('notes.zoomNotesChipTip');
    zoomNotesChipEl.addEventListener('click', toggleZoomNotes);
    /* The synthesised-notes lane has its own mute (see ribbonMuted) — a separate decision
     * from whether this pane shows the notes overlay at all. Same speaker glyph as a stem
     * chip's, wired to toggleRibbon rather than toggleTrack. */
    zoomNotesMuteEl = document.createElement('button');
    zoomNotesMuteEl.type = 'button';
    zoomNotesMuteEl.className = 'zoom-chip-mute';
    zoomNotesMuteEl.textContent = '♪';
    zoomNotesMuteEl.title = tr('notes.zoomNotesMuteTip');
    zoomNotesMuteEl.addEventListener('click', toggleRibbon);
    notesChip.append(zoomNotesChipEl, zoomNotesMuteEl);
    zLaneSel.appendChild(notesChip);
    syncZoomChips();

    zName.append(zTopRow, zLaneSel);

    const zCanvas = document.createElement('canvas');
    zCanvas.className = 'wave zoomwave';
    zCanvas.title = tr('notes.zoomTip');

    /* Names the bottom range-select band for anyone who hasn't found it by trial and error —
     * the band itself is hinted on-canvas (see renderZoom's idle strip), but a highlighted
     * strip alone doesn't say what it's FOR. Hidden while edit mode is off, alongside the
     * toolbar (see the 'sansbass:editmode' listener). */
    const zRangeHint = document.createElement('div');
    zRangeHint.className = 'note-range-hint';
    zRangeHint.textContent = tr('notes.rangeTip');
    zRangeHint.hidden = !editMode;
    zoomRangeHint = zRangeHint;

    const zSpacer = document.createElement('div');
    const zGrip = document.createElement('div');
    zGrip.className = 'ribbon-grip';
    zGrip.title = tr('notes.resizeTip');
    attachResize(zGrip, () => zoomHeight, (v) => { zoomHeight = v; }, ZOOM_H_KEY);

    /* The edit toolbar. Hidden while edit mode is off (see the 'sansbass:editmode' listener);
     * each button disabled until a note is selected. */
    const zToolbar = document.createElement('div');
    zToolbar.className = 'note-toolbar';
    zToolbar.hidden = !editMode;

    const mkEditBtn = (label, titleKey, fn) => {
      const b = document.createElement('button');
      b.className = 'mini note-tbtn';
      b.type = 'button';
      b.textContent = label;
      b.title = tr(titleKey);
      b.disabled = true;
      b.addEventListener('click', fn);
      return b;
    };

    const octUp = mkEditBtn('↑ 8ve', 'notes.editOctUpTip', () => editOctave(1));
    const octDown = mkEditBtn('↓ 8ve', 'notes.editOctDownTip', () => editOctave(-1));
    const pitchUp = mkEditBtn('♯', 'notes.editPitchUpTip', () => editPitchNudge(1));
    const pitchDown = mkEditBtn('♭', 'notes.editPitchDownTip', () => editPitchNudge(-1));
    const timeBack = mkEditBtn('◄t', 'notes.editTimeBackTip', () => editTimeNudge(-1));
    const timeFwd = mkEditBtn('▶t', 'notes.editTimeFwdTip', () => editTimeNudge(1));
    const split = mkEditBtn('✂', 'notes.editSplitTip', editSplit);
    const del = mkEditBtn('✕', 'notes.editDeleteTip', editDeleteNote);
    del.classList.add('note-tbtn-danger');
    const addBtn = mkEditBtn('+ ' + tr('notes.editAdd'), 'notes.editAddTip', toggleAddArmed);
    addBtn.disabled = false;   // always available while edit mode is on, selection or not

    const rangeDel = mkEditBtn(tr('notes.editRangeDelete'), 'notes.editRangeDeleteTip', editRangeDelete);
    rangeDel.classList.add('note-tbtn-danger');

    zToolbar.append(addBtn, octUp, octDown, pitchUp, pitchDown, timeBack, timeFwd, split, del, rangeDel);

    /* Inline Start/End/Pitch fields, next to the toolbar. Same hidden-until-edit-mode and
     * disabled-until-selected rules as the toolbar buttons above — see docs/superpowers/
     * specs/2026-09-01-note-inline-fields-design.md and its labels/flat-pitch follow-up. */
    const zFields = document.createElement('div');
    zFields.className = 'note-fields';
    zFields.hidden = !editMode;

    const mkFieldInput = (titleKey) => {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'note-field';
      inp.title = tr(titleKey);
      inp.setAttribute('aria-label', tr(titleKey));
      inp.disabled = true;
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitFields();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          inp.blur();
          fieldsShownFor = null;
          syncEditToolbar();
        }
      });
      return inp;
    };

    /* Wraps a field in a <label> so the visible caption also focuses the control on click —
     * no id/for plumbing needed, this project doesn't put ids on dynamically-built elements. */
    const mkFieldGroup = (titleKey, control) => {
      const label = document.createElement('label');
      label.className = 'note-field-group';
      const span = document.createElement('span');
      span.className = 'note-field-label';
      span.textContent = tr(titleKey);
      label.append(span, control);
      return label;
    };

    const fieldStart = mkFieldInput('notes.editFieldStart');
    const fieldEnd = mkFieldInput('notes.editFieldEnd');
    const startGroup = mkFieldGroup('notes.editFieldStart', fieldStart);
    const endGroup = mkFieldGroup('notes.editFieldEnd', fieldEnd);

    /* Pitch is three selects, not a text field — a flat accidental is an explicit choice here,
     * not a guess a free-text parser would have to interpret. Auto-commits on change (see
     * commitPitchDropdown), so it never joins Start/End's Enter/Apply-staged path. */
    const mkFieldSelect = (options, titleKey) => {
      const sel = document.createElement('select');
      sel.className = 'note-field note-field-select';
      sel.title = tr(titleKey);
      sel.setAttribute('aria-label', tr(titleKey));
      sel.disabled = true;
      for (const opt of options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        sel.append(o);
      }
      sel.addEventListener('change', commitPitchDropdown);
      return sel;
    };

    const PITCH_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const PITCH_ACCIDENTALS = [
      { value: '#', label: '♯' },
      { value: '', label: '♮' },
      { value: 'b', label: '♭' },
    ];
    const PITCH_OCTAVES = Array.from({ length: 11 }, (_, i) => String(i - 1));   // "-1".."9"

    const fieldPitchLetter = mkFieldSelect(PITCH_LETTERS.map((l) => ({ value: l, label: l })), 'notes.editFieldPitch');
    const fieldPitchAccidental = mkFieldSelect(PITCH_ACCIDENTALS, 'notes.editFieldPitch');
    const fieldPitchOctave = mkFieldSelect(PITCH_OCTAVES.map((o) => ({ value: o, label: o })), 'notes.editFieldPitch');

    const pitchGroupInner = document.createElement('div');
    pitchGroupInner.className = 'note-field-pitch-group';
    pitchGroupInner.append(fieldPitchLetter, fieldPitchAccidental, fieldPitchOctave);

    const pitchLabel = document.createElement('span');
    pitchLabel.className = 'note-field-label';
    pitchLabel.textContent = tr('notes.editFieldPitch');

    const pitchGroup = document.createElement('div');
    pitchGroup.className = 'note-field-group';
    pitchGroup.append(pitchLabel, pitchGroupInner);

    const applyBtn = document.createElement('button');
    applyBtn.className = 'mini note-tbtn';
    applyBtn.type = 'button';
    applyBtn.textContent = tr('notes.editFieldApply');
    applyBtn.disabled = true;
    applyBtn.addEventListener('click', commitFields);

    zFields.append(startGroup, endGroup, pitchGroup, applyBtn);

    zoomToolbar = { root: zToolbar, fields: zFields, add: addBtn, octUp, octDown, pitchUp,
                     pitchDown, timeBack, timeFwd, split, del, rangeDel,
                     fieldStart, fieldEnd, fieldPitchLetter, fieldPitchAccidental,
                     fieldPitchOctave, applyBtn };

    zLane.append(zName, zCanvas, zRangeHint, zToolbar, zFields, zSpacer, zGrip);
    el.lanes.insertBefore(zLane, lane);
    attachZoom(zCanvas);
    zoomEl = { lane: zLane, canvas: zCanvas, out: zOut };
    zLane.hidden = true;
  }

  attachSeek(el.mainWave);
```

Replace with:

```js
  noteLanes = {};
  /* zoomNotesStem must reset here too, not just noteLanes — it is module-level state that
   * otherwise survives across buildUI() calls (song loads). Left stale (e.g. still 'bass'
   * from the previous song), the new song's vocals channel finishing first would never
   * auto-claim the selection: setNotes()'s `if (zoomNotesStem === null && lane.ribbon)`
   * guard would see a non-null (but now meaningless) value and skip the assignment — the
   * pane would show plain waveforms only, silently missing the pitch overlay N56a promises. */
  zoomNotesStem = null;
  zoomEl = null;
  zoomChipEls = [];
  zoomNotesChipEls = {};
  editToggleEl = null;
  let anchorTrack = null;   // the first (vocals-priority) stem with a note lane — the zoomed
                             // pane's DOM anchor
  for (const stem of NOTE_STEMS) {
    const track = tracks.find((t) => t.stem === stem);
    if (!track) continue;
    if (!anchorTrack) anchorTrack = track;

    const lane = document.createElement('div');
    lane.className = 'lane ribbon';
    lane.hidden = true;

    const name = document.createElement('div');
    name.className = 'lane-name';
    name.title = tr('notes.muteTip');
    const dot = document.createElement('span');
    dot.className = 'dot';
    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = tr('notes.lane');
    name.append(dot, txt);
    name.addEventListener('click', () => toggleRibbon(stem));

    const canvas = document.createElement('canvas');
    canvas.className = 'wave';

    const vol = document.createElement('div');
    vol.className = 'lane-vol';
    const slider = document.createElement('input');
    Object.assign(slider, { type: 'range', min: 0, max: 1.5, step: 0.01, value: ribbonVolume[stem] });
    slider.addEventListener('input', () => { ribbonVolume[stem] = parseFloat(slider.value); applyRibbonGain(stem); });
    vol.appendChild(slider);

    /* Drag the bottom edge to grow the lane. Height is the only way to read pitch: at the
     * default the range can span 27 semitones, and note names need roughly 9 px each. */
    const grip = document.createElement('div');
    grip.className = 'ribbon-grip';
    grip.title = tr('notes.resizeTip');
    attachResize(grip, () => ribbonHeight[stem], (v) => { ribbonHeight[stem] = v; }, `${RIBBON_H_KEY}.${stem}`,
      () => {
        const l = noteLanes[stem];
        if (l && l.ribbon) renderRibbon(l.el.canvas, l.ribbon, l.el.canvas.clientWidth, ribbonHeight[stem]);
        draw();
      });

    /* Names the bottom range-select band, same reasoning as the zoomed pane's equivalent
     * caption (see 'sansbass:editmode' listener) — the band alone doesn't say what it's for.
     * Shown only while THIS stem is the one currently selected for editing — see
     * syncRangeHints(). */
    const rHint = document.createElement('div');
    rHint.className = 'note-range-hint';
    rHint.textContent = tr('notes.rangeTip');
    rHint.hidden = true;

    lane.append(name, canvas, rHint, vol, grip);
    el.lanes.insertBefore(lane, track.laneEl.nextSibling);
    attachSeek(canvas, { rangeBand: true, stem });

    noteLanes[stem] = {
      ribbon: null, el: { lane, canvas, txt, grip }, gain: null,
      muted: true, rangeHint: rHint,
    };
    // Volume itself is NOT snapshotted onto the lane object: applyRibbonGain(stem) reads
    // ribbonVolume[stem] directly, so the slider's live updates to that module-level map
    // are what it always sees — a copy here would go stale the moment the slider moved.
    if (audio) {
      const gain = audio.createGain();
      gain.connect(master);
      noteLanes[stem].gain = gain;
    }
    applyRibbonGain(stem);
  }

  if (anchorTrack) {
    /* The zoomed pane. It shares the lane grid so its canvas starts on the same pixel as
     * every waveform, but NOT the time mapping — it shows a window, which is the whole
     * point. One shared instance, docked above the first (vocals-priority) note lane that
     * exists — see docs/superpowers/specs/2026-09-01-bass-notes-design.md. */
    const zLane = document.createElement('div');
    zLane.className = 'lane ribbon-zoom';

    const zName = document.createElement('div');
    zName.className = 'lane-name';
    const zTxt = document.createElement('span');
    zTxt.className = 'txt';
    zTxt.textContent = tr('notes.zoom');

    const zOut = document.createElement('span');
    zOut.className = 'zoom-secs';

    /* Buttons as well as the wheel: a trackpad wheel is easy to overshoot, and on a
     * touch device there is no wheel at all. Both routes go through zoomBy. */
    const zBtns = document.createElement('span');
    zBtns.className = 'zoom-btns';
    const mkBtn = (label, factor, key) => {
      const b = document.createElement('button');
      b.className = 'zoom-btn';
      b.textContent = label;
      b.title = tr(key);
      b.addEventListener('click', () => zoomBy(factor));
      return b;
    };
    zBtns.append(mkBtn('−', 1.5, 'notes.zoomOut'), mkBtn('+', 1 / 1.5, 'notes.zoomIn'));

    /* Sub-beat dotted-line toggles — view options for this pane, same family as the zoom
     * level buttons beside them, not a lane selection (which is why they sit here rather
     * than in zLaneSel below). */
    const zSubBtns = document.createElement('span');
    zSubBtns.className = 'zoom-btns zoom-sub-btns';
    halfBeatBtn = document.createElement('button');
    halfBeatBtn.type = 'button';
    halfBeatBtn.className = 'mini zoom-sub-btn';
    halfBeatBtn.classList.toggle('active', showHalfBeat);
    halfBeatBtn.textContent = '½';
    halfBeatBtn.title = tr('notes.zoomHalfBeatTip');
    halfBeatBtn.addEventListener('click', toggleHalfBeat);
    quarterBeatBtn = document.createElement('button');
    quarterBeatBtn.type = 'button';
    quarterBeatBtn.className = 'mini zoom-sub-btn';
    quarterBeatBtn.classList.toggle('active', showQuarterBeat);
    quarterBeatBtn.textContent = '¼';
    quarterBeatBtn.title = tr('notes.zoomQuarterBeatTip');
    quarterBeatBtn.addEventListener('click', toggleQuarterBeat);
    zSubBtns.append(halfBeatBtn, quarterBeatBtn);

    const zTopRow = document.createElement('div');
    zTopRow.className = 'zoom-top-row';
    const zSecsGroup = document.createElement('span');
    zSecsGroup.className = 'zoom-secs-group';
    zSecsGroup.append(zOut, zBtns, zSubBtns);
    zTopRow.append(zTxt, zSecsGroup);

    /* Which stem(s) — as plain waveforms — the pane below draws, plus the two Notes chips
     * below. One chip per stem actually in this song: a coloured dot AND its stem name,
     * toggling it into the pane, plus a speaker glyph that mutes/unmutes the lane exactly
     * like clicking its row in the main list does. */
    const zLaneSel = document.createElement('span');
    zLaneSel.className = 'zoom-lane-sel';
    zoomChipEls = tracks.filter((t) => t.stem).map((t) => {
      const chip = document.createElement('span');
      chip.className = 'zoom-chip';
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'zoom-chip-select';
      select.style.setProperty('--chip-color', t.color);
      select.title = tr('notes.zoomLaneShowTip', { lane: laneLabel(t) });
      const dot2 = document.createElement('span');
      dot2.className = 'zoom-chip-dot';
      const label = document.createElement('span');
      label.className = 'zoom-chip-label';
      label.textContent = laneLabel(t);
      select.append(dot2, label);
      select.addEventListener('click', () => toggleZoomLane(t.stem));
      const spk = document.createElement('button');
      spk.type = 'button';
      spk.className = 'zoom-chip-mute';
      spk.textContent = '♪';
      spk.title = tr('notes.zoomLaneMuteTip', { lane: laneLabel(t) });
      spk.addEventListener('click', () => toggleTrack(t));
      chip.append(select, spk);
      zLaneSel.appendChild(chip);
      return { stem: t.stem, select, label, spk };
    });

    /* One "Notes: <lane>" chip per stem that actually has a note lane this song — mutually
     * exclusive on select (picking one clears the other, see toggleZoomNotes), independent
     * on mute (each mutes only its own lane). Built the same way the stem chips above are. */
    zoomNotesChipEls = {};
    for (const stem of NOTE_STEMS) {
      if (!noteLanes[stem]) continue;
      const chip = document.createElement('span');
      chip.className = 'zoom-chip';
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'mini zoom-notes-chip';
      select.textContent = tr('notes.zoomNotesChipFor', { lane: tr('stem.' + stem) });
      select.title = tr('notes.zoomNotesChipForTip', { lane: tr('stem.' + stem) });
      select.addEventListener('click', () => toggleZoomNotes(stem));
      const spk = document.createElement('button');
      spk.type = 'button';
      spk.className = 'zoom-chip-mute';
      spk.textContent = '♪';
      spk.title = tr('notes.zoomNotesMuteTipFor', { lane: tr('stem.' + stem) });
      spk.addEventListener('click', () => toggleRibbon(stem));
      chip.append(select, spk);
      zLaneSel.appendChild(chip);
      zoomNotesChipEls[stem] = { select, spk };
    }

    /* The one global Edit-notes toggle, beside the two Notes chips — editing is inherently
     * single-target, so one control suffices regardless of how many note-capable stems exist. */
    const editLabel = document.createElement('label');
    editLabel.className = 'notes-ctl zoom-edit-toggle';
    editLabel.title = tr('notes.editTip');
    editToggleEl = document.createElement('input');
    editToggleEl.type = 'checkbox';
    editToggleEl.disabled = true;
    const editSpan = document.createElement('span');
    editSpan.textContent = tr('notes.edit');
    editLabel.append(editToggleEl, editSpan);
    editToggleEl.addEventListener('change', () => {
      window.dispatchEvent(new CustomEvent('sansbass:editmode', { detail: { on: editToggleEl.checked, stem: zoomNotesStem } }));
    });
    zLaneSel.appendChild(editLabel);

    syncZoomChips();

    zName.append(zTopRow, zLaneSel);

    const zCanvas = document.createElement('canvas');
    zCanvas.className = 'wave zoomwave';
    zCanvas.title = tr('notes.zoomTip');

    const zRangeHint = document.createElement('div');
    zRangeHint.className = 'note-range-hint';
    zRangeHint.textContent = tr('notes.rangeTip');
    zRangeHint.hidden = !editMode;
    zoomRangeHint = zRangeHint;

    const zSpacer = document.createElement('div');
    const zGrip = document.createElement('div');
    zGrip.className = 'ribbon-grip';
    zGrip.title = tr('notes.resizeTip');
    attachResize(zGrip, () => zoomHeight, (v) => { zoomHeight = v; }, ZOOM_H_KEY, () => draw());

    const zToolbar = document.createElement('div');
    zToolbar.className = 'note-toolbar';
    zToolbar.hidden = !editMode;

    const mkEditBtn = (label, titleKey, fn) => {
      const b = document.createElement('button');
      b.className = 'mini note-tbtn';
      b.type = 'button';
      b.textContent = label;
      b.title = tr(titleKey);
      b.disabled = true;
      b.addEventListener('click', fn);
      return b;
    };

    const octUp = mkEditBtn('↑ 8ve', 'notes.editOctUpTip', () => editOctave(1));
    const octDown = mkEditBtn('↓ 8ve', 'notes.editOctDownTip', () => editOctave(-1));
    const pitchUp = mkEditBtn('♯', 'notes.editPitchUpTip', () => editPitchNudge(1));
    const pitchDown = mkEditBtn('♭', 'notes.editPitchDownTip', () => editPitchNudge(-1));
    const timeBack = mkEditBtn('◄t', 'notes.editTimeBackTip', () => editTimeNudge(-1));
    const timeFwd = mkEditBtn('▶t', 'notes.editTimeFwdTip', () => editTimeNudge(1));
    const split = mkEditBtn('✂', 'notes.editSplitTip', editSplit);
    const del = mkEditBtn('✕', 'notes.editDeleteTip', editDeleteNote);
    del.classList.add('note-tbtn-danger');
    const addBtn = mkEditBtn('+ ' + tr('notes.editAdd'), 'notes.editAddTip', toggleAddArmed);
    addBtn.disabled = false;   // always available while edit mode is on, selection or not

    const rangeDel = mkEditBtn(tr('notes.editRangeDelete'), 'notes.editRangeDeleteTip', editRangeDelete);
    rangeDel.classList.add('note-tbtn-danger');

    zToolbar.append(addBtn, octUp, octDown, pitchUp, pitchDown, timeBack, timeFwd, split, del, rangeDel);

    const zFields = document.createElement('div');
    zFields.className = 'note-fields';
    zFields.hidden = !editMode;

    const mkFieldInput = (titleKey) => {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'note-field';
      inp.title = tr(titleKey);
      inp.setAttribute('aria-label', tr(titleKey));
      inp.disabled = true;
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitFields();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          inp.blur();
          fieldsShownFor = null;
          syncEditToolbar();
        }
      });
      return inp;
    };

    const mkFieldGroup = (titleKey, control) => {
      const label = document.createElement('label');
      label.className = 'note-field-group';
      const span = document.createElement('span');
      span.className = 'note-field-label';
      span.textContent = tr(titleKey);
      label.append(span, control);
      return label;
    };

    const fieldStart = mkFieldInput('notes.editFieldStart');
    const fieldEnd = mkFieldInput('notes.editFieldEnd');
    const startGroup = mkFieldGroup('notes.editFieldStart', fieldStart);
    const endGroup = mkFieldGroup('notes.editFieldEnd', fieldEnd);

    const mkFieldSelect = (options, titleKey) => {
      const sel = document.createElement('select');
      sel.className = 'note-field note-field-select';
      sel.title = tr(titleKey);
      sel.setAttribute('aria-label', tr(titleKey));
      sel.disabled = true;
      for (const opt of options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        sel.append(o);
      }
      sel.addEventListener('change', commitPitchDropdown);
      return sel;
    };

    const PITCH_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const PITCH_ACCIDENTALS = [
      { value: '#', label: '♯' },
      { value: '', label: '♮' },
      { value: 'b', label: '♭' },
    ];
    const PITCH_OCTAVES = Array.from({ length: 11 }, (_, i) => String(i - 1));   // "-1".."9"

    const fieldPitchLetter = mkFieldSelect(PITCH_LETTERS.map((l) => ({ value: l, label: l })), 'notes.editFieldPitch');
    const fieldPitchAccidental = mkFieldSelect(PITCH_ACCIDENTALS, 'notes.editFieldPitch');
    const fieldPitchOctave = mkFieldSelect(PITCH_OCTAVES.map((o) => ({ value: o, label: o })), 'notes.editFieldPitch');

    const pitchGroupInner = document.createElement('div');
    pitchGroupInner.className = 'note-field-pitch-group';
    pitchGroupInner.append(fieldPitchLetter, fieldPitchAccidental, fieldPitchOctave);

    const pitchLabel = document.createElement('span');
    pitchLabel.className = 'note-field-label';
    pitchLabel.textContent = tr('notes.editFieldPitch');

    const pitchGroup = document.createElement('div');
    pitchGroup.className = 'note-field-group';
    pitchGroup.append(pitchLabel, pitchGroupInner);

    const applyBtn = document.createElement('button');
    applyBtn.className = 'mini note-tbtn';
    applyBtn.type = 'button';
    applyBtn.textContent = tr('notes.editFieldApply');
    applyBtn.disabled = true;
    applyBtn.addEventListener('click', commitFields);

    zFields.append(startGroup, endGroup, pitchGroup, applyBtn);

    zoomToolbar = { root: zToolbar, fields: zFields, add: addBtn, octUp, octDown, pitchUp,
                     pitchDown, timeBack, timeFwd, split, del, rangeDel,
                     fieldStart, fieldEnd, fieldPitchLetter, fieldPitchAccidental,
                     fieldPitchOctave, applyBtn };

    zLane.append(zName, zCanvas, zRangeHint, zToolbar, zFields, zSpacer, zGrip);
    el.lanes.insertBefore(zLane, anchorTrack.laneEl.nextSibling);
    attachZoom(zCanvas);
    zoomEl = { lane: zLane, canvas: zCanvas, out: zOut };
    zLane.hidden = true;
  }

  syncRangeHints();
  attachSeek(el.mainWave);
```

- [ ] **Step 8: Add `currentRibbon()` and rewrite `setNotes()`**

Find:

```js
/* The interpretation layer hands its result over here. Called again on every change of a
 * detection parameter — see docs/transcription.md — so it must be cheap and idempotent. */
function setNotes(payload) {
  ribbon = payload && payload.notes && payload.frames ? payload : null;
  if (!ribbonEl) return;
  applyRibbonVisibility();
  if (!ribbon) { ribbonEl.canvas.__layers = null; return; }
  zoomCenter = currentTime();
  renderRibbon(ribbonEl.canvas, ribbon, ribbonEl.canvas.clientWidth);
  draw();
}
```

Replace with:

```js
/** The channel the zoomed pane's PITCH OVERLAY and the editing toolbar currently operate
 *  on, or null when no chip is selected (or the selected channel has no notes yet). Editing
 *  always needs this exact channel — there is no "any" fallback for it. */
function currentRibbon() {
  const lane = zoomNotesStem && noteLanes[zoomNotesStem];
  return lane ? lane.ribbon : null;
}

/** Any channel that currently has notes, vocals first — used ONLY for the zoomed pane's
 *  beat/bar grid, which is a tempo reference for whatever waveform(s) are on screen and
 *  must keep drawing even while no Notes chip is selected (see renderZoom). Tempo is the
 *  same shared object mirrored into every channel's payload, so it does not matter which
 *  channel answers as long as one exists. */
function anyRibbon() {
  for (const stem of NOTE_STEMS) {
    const lane = noteLanes[stem];
    if (lane && lane.ribbon) return lane.ribbon;
  }
  return null;
}

/* The interpretation layer hands its result over here, per stem. Called again on every
 * change of a detection parameter — see docs/transcription.md — so it must be cheap and
 * idempotent. */
function setNotes(stem, payload) {
  const lane = noteLanes[stem];
  if (!lane) return;
  lane.ribbon = payload && payload.notes && payload.frames ? payload : null;
  /* First channel to finish analysis claims the zoomed pane; vocals wins only because it
   * tends to finish first in practice — see docs/superpowers/specs/2026-09-01-bass-notes-design.md. */
  if (zoomNotesStem === null && lane.ribbon) zoomNotesStem = stem;
  applyRibbonVisibility(stem);
  applyZoomVisibility();
  syncZoomChips();
  syncEditToggle();
  if (!lane.ribbon) { lane.el.canvas.__layers = null; draw(); return; }
  zoomCenter = currentTime();
  renderRibbon(lane.el.canvas, lane.ribbon, lane.el.canvas.clientWidth, ribbonHeight[stem]);
  draw();
}
```

- [ ] **Step 9: `renderAll()` — loop over `noteLanes`**

Find:

```js
  if (ribbon && ribbonEl) renderRibbon(ribbonEl.canvas, ribbon, ribbonEl.canvas.clientWidth);
  draw();
}
```

Replace with:

```js
  for (const stem of NOTE_STEMS) {
    const lane = noteLanes[stem];
    if (lane && lane.ribbon) renderRibbon(lane.el.canvas, lane.ribbon, lane.el.canvas.clientWidth, ribbonHeight[stem]);
  }
  draw();
}
```

- [ ] **Step 10: `renderRibbon()` takes an explicit `height` parameter**

Find:

```js
function renderRibbon(canvas, payload, cssWidth) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(cssWidth || canvas.clientWidth || 600));
  const h = ribbonHeight;
```

Replace with:

```js
function renderRibbon(canvas, payload, cssWidth, height) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(cssWidth || canvas.clientWidth || 600));
  const h = height;
```

- [ ] **Step 11: `renderZoom()` — the pitch overlay follows the selected channel; the beat grid and plain waveforms do not**

The pane must stay open and keep drawing plain waveforms + the beat/bar grid even when no
Notes chip is selected — exactly the behaviour today's single Notes-chip toggle already has
(see `docs/behaviour.md` N59, unchanged by this feature). Only the pitch-specific overlay
(grid, contour, note blocks) depends on a channel actually being selected.

Find the entire function, from its declaration through the destructuring line:

```js
function renderZoom(canvas) {
  if (!ribbon || !duration) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth || 600));
  const h = zoomHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = h + 'px';
  }
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  const win = window.SansRibbon.zoomWindow(zoomCenter, zoomSeconds, duration);
  const span = win.to - win.from || 1;
  const x = (t) => ((t - win.from) / span) * w;

  const { notes, frames } = ribbon;
  /* Whether the 'notes' chip is on. When it is, the note blocks are the thing this pane
   * exists to show, so every selected stem's waveform behind them renders gray instead of
   * competing in colour. When it's off there's nothing pitched to plot, so the whole
   * pitch-grid/contour/note-block machinery below is skipped in favour of each selected
   * waveform in its own stem colour — see the lane selector this draws for (app.js's zLane
   * construction) and docs/behaviour.md. */
  const showNotes = zoomLaneSel.has('notes');
  let loM, hiM, y, semi;
  if (showNotes) {
    [loM, hiM] = window.SansRibbon.pitchRange(notes, { clip: ribbon.clip !== false });
    const pitchSpan = hiM - loM || 1;
    y = (midi) => h - ((midi - loM) / pitchSpan) * h;
    semi = Math.abs(y(0) - y(1));
  }
```

Replace with:

```js
function renderZoom(canvas) {
  if (!duration) return;
  const ribbon = currentRibbon();   // the SELECTED channel — null if no chip is selected
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth || 600));
  const h = zoomHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = h + 'px';
  }
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  const win = window.SansRibbon.zoomWindow(zoomCenter, zoomSeconds, duration);
  const span = win.to - win.from || 1;
  const x = (t) => ((t - win.from) / span) * w;

  /* Whether a channel is selected. When it is, the note blocks are the thing this pane
   * exists to show, so every selected stem's waveform behind them renders gray instead of
   * competing in colour. When it's off there's nothing pitched to plot, so the whole
   * pitch-grid/contour/note-block machinery below is skipped in favour of each selected
   * waveform in its own stem colour — see the lane selector this draws for (app.js's zLane
   * construction) and docs/behaviour.md. The beat/bar grid further below is independent of
   * this — it reads `anyRibbon()`, not `ribbon`, so it keeps drawing either way. */
  const showNotes = !!ribbon;
  const notes = ribbon ? ribbon.notes : null;
  const frames = ribbon ? ribbon.frames : null;
  let loM, hiM, y, semi;
  if (showNotes) {
    [loM, hiM] = window.SansRibbon.pitchRange(notes, { clip: ribbon.clip !== false });
    const pitchSpan = hiM - loM || 1;
    y = (midi) => h - ((midi - loM) / pitchSpan) * h;
    semi = Math.abs(y(0) - y(1));
  }
```

Then, further down the same function, find:

```js
  /* The beat/bar grid, independent of whether Notes is selected — it's a tempo reference
   * for whatever waveform(s) are on screen, not something the pitch view owns. Drawn over
   * the waveform but under the pitch grid/note blocks, same order as before this was
   * pulled out of the showNotes block. */
  if (ribbon.tempo && ribbon.tempo.on) {
    const beats = window.SansRibbon.beatTimes(ribbon.tempo, duration);
    for (const b of beats) {
      if (b.t < win.from || b.t > win.to) continue;
      const bx = x(b.t);
      c.fillStyle = b.bar ? 'rgba(255,255,255,.30)' : 'rgba(255,255,255,.12)';
      c.fillRect(bx, 0, b.bar ? 2 : 1, h);
    }

    /* Sub-beat dotted lines, gated behind the ½/¼ toggle buttons beside the zoom controls —
     * off by default, since quarter-beat ticks are clutter until asked for. Quarter drawn
     * first, fainter, since it already includes the half-beat point at its centre; half
     * drawn on top of it in a slightly stronger dash. */
    if (showQuarterBeat || showHalfBeat) {
      const drawDotted = (t, color) => {
        const bx = Math.round(x(t)) + 0.5;
        c.strokeStyle = color;
        c.beginPath();
        c.moveTo(bx, 0);
        c.lineTo(bx, h);
        c.stroke();
      };
      c.lineWidth = 1;
      c.setLineDash([2, 2]);
      if (showQuarterBeat) {
        for (const t of window.SansRibbon.subdivisionTimes(ribbon.tempo, duration, 4)) {
          if (t >= win.from && t <= win.to) drawDotted(t, 'rgba(255,255,255,.07)');
        }
      }
      if (showHalfBeat) {
        for (const t of window.SansRibbon.subdivisionTimes(ribbon.tempo, duration, 2)) {
          if (t >= win.from && t <= win.to) drawDotted(t, 'rgba(255,255,255,.14)');
        }
      }
      c.setLineDash([]);
    }
  }
```

Replace with:

```js
  /* The beat/bar grid, independent of whether a Notes chip is selected — it's a tempo
   * reference for whatever waveform(s) are on screen, not something the pitch view owns.
   * Reads anyRibbon() rather than the selected `ribbon`: tempo is the same shared object in
   * every channel's payload, so this must keep drawing even with nothing selected — the
   * whole reason `showNotes` and this block use two different sources. Drawn over the
   * waveform but under the pitch grid/note blocks, same order as before this was pulled out
   * of the showNotes block. */
  const tempoRibbon = ribbon ?? anyRibbon();
  if (tempoRibbon && tempoRibbon.tempo && tempoRibbon.tempo.on) {
    const beats = window.SansRibbon.beatTimes(tempoRibbon.tempo, duration);
    for (const b of beats) {
      if (b.t < win.from || b.t > win.to) continue;
      const bx = x(b.t);
      c.fillStyle = b.bar ? 'rgba(255,255,255,.30)' : 'rgba(255,255,255,.12)';
      c.fillRect(bx, 0, b.bar ? 2 : 1, h);
    }

    /* Sub-beat dotted lines, gated behind the ½/¼ toggle buttons beside the zoom controls —
     * off by default, since quarter-beat ticks are clutter until asked for. Quarter drawn
     * first, fainter, since it already includes the half-beat point at its centre; half
     * drawn on top of it in a slightly stronger dash. */
    if (showQuarterBeat || showHalfBeat) {
      const drawDotted = (t, color) => {
        const bx = Math.round(x(t)) + 0.5;
        c.strokeStyle = color;
        c.beginPath();
        c.moveTo(bx, 0);
        c.lineTo(bx, h);
        c.stroke();
      };
      c.lineWidth = 1;
      c.setLineDash([2, 2]);
      if (showQuarterBeat) {
        for (const t of window.SansRibbon.subdivisionTimes(tempoRibbon.tempo, duration, 4)) {
          if (t >= win.from && t <= win.to) drawDotted(t, 'rgba(255,255,255,.07)');
        }
      }
      if (showHalfBeat) {
        for (const t of window.SansRibbon.subdivisionTimes(tempoRibbon.tempo, duration, 2)) {
          if (t >= win.from && t <= win.to) drawDotted(t, 'rgba(255,255,255,.14)');
        }
      }
      c.setLineDash([]);
    }
  }
```

Everything else inside `renderZoom` — the resting-state range-select hint, the plain-waveform loop over `zoomLaneSel`, and the entire `if (showNotes) { ... }` block (piano-roll grid, `ribbon.jianpu`, the contour line reading `frames`, the note-blocks loop reading `notes`/`ribbon.jianpu`) — is unchanged: `showNotes`/`notes`/`frames`/`ribbon` all now resolve to the values this step just defined, and inside `if (showNotes)` blocks `ribbon` is guaranteed non-null.

- [ ] **Step 12: `draw()` — loop over `noteLanes`, drop the singular zoomEl gate**

Find:

```js
function draw() {
  const t = currentTime();
  const frac = duration ? Math.min(1, t / duration) : 0;
  paint(el.mainWave, frac);
  tracks.forEach(tr => paint(tr.canvas, frac));
  if (ribbon && ribbonEl) paint(ribbonEl.canvas, frac);
  if (ribbon && zoomEl && !zoomEl.lane.hidden) {
    // Follow while playing; when stopped the window is wherever it was dragged to.
    if (playing) zoomCenter = t;
    renderZoom(zoomEl.canvas);
    zoomEl.out.textContent = `${zoomSeconds.toFixed(zoomSeconds < 10 ? 1 : 0)}s`;
  }
  if (editMode) syncEditToolbar();
  el.tCur.textContent = fmt(t);
}
```

Replace with:

```js
function draw() {
  const t = currentTime();
  const frac = duration ? Math.min(1, t / duration) : 0;
  paint(el.mainWave, frac);
  tracks.forEach(tr => paint(tr.canvas, frac));
  for (const stem of NOTE_STEMS) {
    const lane = noteLanes[stem];
    if (lane && lane.ribbon) paint(lane.el.canvas, frac);
  }
  if (zoomEl && !zoomEl.lane.hidden) {
    // Follow while playing; when stopped the window is wherever it was dragged to.
    if (playing) zoomCenter = t;
    renderZoom(zoomEl.canvas);
    zoomEl.out.textContent = `${zoomSeconds.toFixed(zoomSeconds < 10 ? 1 : 0)}s`;
  }
  if (editMode) syncEditToolbar();
  el.tCur.textContent = fmt(t);
}
```

- [ ] **Step 13: `syncEditToolbar()` resolves the selected channel locally**

Find:

```js
function syncEditToolbar() {
  if (!zoomToolbar) return;
  const sel = ribbon && selectedNote ? noteAt(ribbon.notes, selectedNote.at, selectedNote.midi) : null;
```

Replace with:

```js
function syncEditToolbar() {
  if (!zoomToolbar) return;
  const ribbon = currentRibbon();
  const sel = ribbon && selectedNote ? noteAt(ribbon.notes, selectedNote.at, selectedNote.midi) : null;
```

- [ ] **Step 14: `paint()`'s range-band special case now targets the selected stem's canvas**

Find:

```js
  if (ribbonEl && canvas === ribbonEl.canvas) paintRangeBand(c, canvas, dpr);
```

Replace with:

```js
  const selLane = zoomNotesStem && noteLanes[zoomNotesStem];
  if (selLane && canvas === selLane.el.canvas) paintRangeBand(c, canvas, dpr);
```

- [ ] **Step 14a: `paintLaneGrid()` (the faint per-lane bar grid on every stem's own waveform, T16) reads tempo from `anyRibbon()`**

This call site was missed by a first pass over every bare `ribbon` reference and must be fixed alongside the others — it draws the same shared tempo grid `renderZoom` does, on each plain stem lane.

Find:

```js
function paintLaneGrid(c, canvas, dpr) {
  if (!ribbon || !ribbon.tempo || !ribbon.tempo.on || !duration) return;
  const w = canvas.width;
  const h = canvas.height;
  const beats = window.SansRibbon.beatTimes(ribbon.tempo, duration);
  c.fillStyle = 'rgba(255,255,255,.06)';
  for (const b of beats) {
    if (!b.bar) continue;
    const bx = Math.round((b.t / duration) * w);
    c.fillRect(bx, 0, Math.max(1, dpr), h);
  }
}
```

Replace with:

```js
function paintLaneGrid(c, canvas, dpr) {
  const ribbon = anyRibbon();   // shared tempo — any channel that has notes answers the same
  if (!ribbon || !ribbon.tempo || !ribbon.tempo.on || !duration) return;
  const w = canvas.width;
  const h = canvas.height;
  const beats = window.SansRibbon.beatTimes(ribbon.tempo, duration);
  c.fillStyle = 'rgba(255,255,255,.06)';
  for (const b of beats) {
    if (!b.bar) continue;
    const bx = Math.round((b.t / duration) * w);
    c.fillRect(bx, 0, Math.max(1, dpr), h);
  }
}
```

- [ ] **Step 15: `applyRibbonGain`/`setRibbonVisible`/`applyRibbonVisibility`/`toggleRibbon` become per-stem, plus two new helpers**

Find:

```js
/* The ribbon is deliberately NOT in `tracks`, so mute-all and solo skip it for free —
 * pressing 0 must never silence the reference you are checking against. */
function applyRibbonGain() {
  if (ribbonGain && audio) {
    ribbonGain.gain.setTargetAtTime(ribbonMuted ? 0 : ribbonVolume, audio.currentTime, 0.012);
  }
  ribbonEl?.lane.classList.toggle('muted', ribbonMuted);
  syncZoomChips();
}

/* Hiding silences. A pane you cannot see should not still be sounding — you would have
 * no way to tell what you were hearing, and no control on screen to stop it. Showing it
 * again does NOT unmute: the mute is a separate decision the user made or did not. */
function setRibbonVisible(on) {
  ribbonVisible = !!on;
  writeStored(RIBBON_SHOW_KEY, ribbonVisible ? 1 : 0);
  if (!ribbonVisible && !ribbonMuted) {
    ribbonMuted = true;
    applyRibbonGain();
    window.dispatchEvent(new CustomEvent('sansbass:ribbonmute', { detail: { muted: true } }));
  }
  applyRibbonVisibility();
  draw();
}

function applyRibbonVisibility() {
  const on = ribbonVisible && !!ribbon;
  if (ribbonEl) ribbonEl.lane.hidden = !on;
  if (zoomEl) zoomEl.lane.hidden = !on;
}
```

Replace with:

```js
/* Neither note lane is ever in `tracks`, so mute-all and solo skip both for free —
 * pressing 0 must never silence the reference you are checking against. */
function applyRibbonGain(stem) {
  const lane = noteLanes[stem];
  if (!lane) return;
  if (lane.gain && audio) {
    lane.gain.gain.setTargetAtTime(lane.muted ? 0 : ribbonVolume[stem], audio.currentTime, 0.012);
  }
  lane.el.lane.classList.toggle('muted', lane.muted);
  syncZoomChips();
}

/* Hiding silences. A pane you cannot see should not still be sounding — you would have
 * no way to tell what you were hearing, and no control on screen to stop it. Showing it
 * again does NOT unmute: the mute is a separate decision the user made or did not. */
function setRibbonVisible(stem, on) {
  ribbonVisible[stem] = !!on;
  writeStored(`${RIBBON_SHOW_KEY}.${stem}`, ribbonVisible[stem] ? 1 : 0);
  const lane = noteLanes[stem];
  if (lane && !ribbonVisible[stem] && !lane.muted) {
    lane.muted = true;
    applyRibbonGain(stem);
    window.dispatchEvent(new CustomEvent('sansbass:ribbonmute', { detail: { muted: true, stem } }));
  }
  applyRibbonVisibility(stem);
  applyZoomVisibility();
  draw();
}

function applyRibbonVisibility(stem) {
  const lane = noteLanes[stem];
  if (!lane) return;
  lane.el.lane.hidden = !(ribbonVisible[stem] && lane.ribbon);
}

/* The zoomed pane is shared: it stays visible as long as AT LEAST ONE note lane is both
 * visible and populated — dropping to zero, or gaining its first, is what flips it. This is
 * INDEPENDENT of which (if any) Notes chip is selected: deselecting both chips (see
 * toggleZoomNotes) must leave the pane open showing plain waveforms + the beat grid,
 * exactly as today's single-channel pane does when its one Notes chip is toggled off —
 * see renderZoom()'s `showNotes`/`anyRibbon()` handling below for the other half of that. */
function applyZoomVisibility() {
  if (!zoomEl) return;
  zoomEl.lane.hidden = !NOTE_STEMS.some((s) => noteLanes[s] && ribbonVisible[s] && noteLanes[s].ribbon);
}

/* The one global Edit-notes toggle is enabled only once the currently-selected chip's
 * channel actually has notes — editing nothing makes no sense. If the selection changes out
 * from under an active edit session (e.g. the user picks a chip with no notes yet), turn
 * editing off rather than leaving it stuck pointed at nothing. */
function syncEditToggle() {
  if (!editToggleEl) return;
  const lane = zoomNotesStem && noteLanes[zoomNotesStem];
  const canEdit = !!(lane && lane.ribbon);
  editToggleEl.disabled = !canEdit;
  if (!canEdit && editToggleEl.checked) {
    editToggleEl.checked = false;
    window.dispatchEvent(new CustomEvent('sansbass:editmode', { detail: { on: false, stem: zoomNotesStem } }));
  }
}

/* The full-song range-select band only makes sense on the lane currently selected for
 * editing — dragging on the OTHER stem's lane while it's not the edit target would silently
 * edit the wrong channel's notes (see attachSeek's `stem === zoomNotesStem` gate). The hint
 * strip mirrors that restriction rather than inviting a gesture that does nothing. */
function syncRangeHints() {
  for (const stem of NOTE_STEMS) {
    const lane = noteLanes[stem];
    if (lane) lane.rangeHint.hidden = !(editMode && stem === zoomNotesStem);
  }
}

function toggleRibbon(stem) {
  const lane = noteLanes[stem];
  if (!lane) return;
  lane.muted = !lane.muted;
  applyRibbonGain(stem);
  window.dispatchEvent(new CustomEvent('sansbass:ribbonmute', { detail: { muted: lane.muted, stem } }));
}
```

Note this replacement also absorbs the original standalone `toggleRibbon()` function a little further down the file (quoted next) — delete that original definition entirely once this block is in place, so there is only one.

- [ ] **Step 16: Delete the now-superseded standalone `toggleRibbon()`**

Find:

```js
function toggleRibbon() {
  ribbonMuted = !ribbonMuted;
  applyRibbonGain();
  window.dispatchEvent(new CustomEvent('sansbass:ribbonmute', { detail: { muted: ribbonMuted } }));
}

function applyGains() {
```

Replace with:

```js
function applyGains() {
```

(its replacement, per-stem `toggleRibbon(stem)`, was already added in Step 15, right after `syncRangeHints()`).

- [ ] **Step 17: `attachResize()` takes an `onResize` callback instead of hardcoding the ribbon lane**

Find:

```js
function attachResize(grip, get, set, storageKey) {
  let startY = 0;
  let startH = 0;
  let dragging = false;

  grip.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    startH = get();
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const next = clampRibbonH(startH + (e.clientY - startY));
    if (next === get()) return;
    set(next);
    if (ribbon && ribbonEl) {
      renderRibbon(ribbonEl.canvas, ribbon, ribbonEl.canvas.clientWidth);
      draw();
    }
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    writeStored(storageKey, get());
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}
```

Replace with:

```js
function attachResize(grip, get, set, storageKey, onResize) {
  let startY = 0;
  let startH = 0;
  let dragging = false;

  grip.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    startH = get();
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const next = clampRibbonH(startH + (e.clientY - startY));
    if (next === get()) return;
    set(next);
    if (onResize) onResize();
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    writeStored(storageKey, get());
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}
```

(both call sites already pass the new 5th argument — the per-stem ribbon grip in Step 7, the zoom grip also in Step 7).

- [ ] **Step 18: `attachZoom`'s pointerdown resolves the selected channel locally**

Find:

```js
  canvas.addEventListener('pointerdown', (e) => {
    if (editMode && ribbon) {
```

Replace with:

```js
  canvas.addEventListener('pointerdown', (e) => {
    const ribbon = currentRibbon();
    if (editMode && ribbon) {
```

(the rest of this callback — `noteAt(ribbon.notes, ...)` twice further down — now resolves to this local constant, no other change needed inside it).

- [ ] **Step 19: `toggleZoomNotes(stem)` replaces the boolean toggle**

Find:

```js
/** Show/hide the detected-notes overlay (pitch grid, contour and note blocks) in the
 *  zoomed pane. Whenever it's on, every selected stem's waveform behind it renders gray
 *  instead of its own colour, so the notes stay the thing your eye reads — see renderZoom. */
function toggleZoomNotes() {
  if (zoomLaneSel.has('notes')) zoomLaneSel.delete('notes'); else zoomLaneSel.add('notes');
  syncZoomChips();
  draw();
}
```

Replace with:

```js
/** Select which channel's notes the zoomed pane shows — mutually exclusive with whichever
 *  was selected before. Clicking the already-selected chip clears the selection entirely
 *  (no overlay, same as `ribbon === null` did before this feature). Whenever a channel is
 *  selected, every plain waveform behind it renders gray instead of its own colour, so the
 *  notes stay the thing your eye reads — see renderZoom. */
function toggleZoomNotes(stem) {
  zoomNotesStem = zoomNotesStem === stem ? null : stem;
  syncZoomChips();
  syncEditToggle();
  syncRangeHints();
  draw();
}
```

(no `applyZoomVisibility()` call here — the pane's visibility does not depend on which chip is selected, only on whether any note lane is visible+populated; see that function's own comment.)

- [ ] **Step 20: `syncZoomChips()` loops over the two Notes chips**

Find:

```js
/** Keeps every chip's selected/muted look in sync with zoomLaneSel, each track's own
 *  .muted, and ribbonMuted — called after a chip click, from applyGains() (a stem can be
 *  muted from its own row in the main list too) and from applyRibbonGain() likewise. */
function syncZoomChips() {
  for (const { stem, select, spk } of zoomChipEls) {
    select.classList.toggle('on', zoomLaneSel.has(stem));
    const t = tracks.find((tr) => tr.stem === stem);
    spk.classList.toggle('muted', !!t?.muted);
  }
  if (zoomNotesChipEl) zoomNotesChipEl.classList.toggle('active', zoomLaneSel.has('notes'));
  if (zoomNotesMuteEl) zoomNotesMuteEl.classList.toggle('muted', ribbonMuted);
}
```

Replace with:

```js
/** Keeps every chip's selected/muted look in sync with zoomLaneSel/zoomNotesStem, each
 *  track's own .muted, and each note lane's own .muted — called after a chip click, from
 *  applyGains() (a stem can be muted from its own row in the main list too) and from
 *  applyRibbonGain() likewise. */
function syncZoomChips() {
  for (const { stem, select, spk } of zoomChipEls) {
    select.classList.toggle('on', zoomLaneSel.has(stem));
    const t = tracks.find((tr) => tr.stem === stem);
    spk.classList.toggle('muted', !!t?.muted);
  }
  for (const stem of NOTE_STEMS) {
    const chip = zoomNotesChipEls[stem];
    if (!chip) continue;
    chip.select.classList.toggle('active', zoomNotesStem === stem);
    chip.spk.classList.toggle('muted', !!noteLanes[stem]?.muted);
  }
}
```

- [ ] **Step 21: `editTimeNudge`/`commitFields`/`commitPitchDropdown`/`editSplit`/`zoomPitchRangeNow` each resolve the selected channel locally**

Find:

```js
function editTimeNudge(dir) {
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
```

Replace with:

```js
function editTimeNudge(dir) {
  const ribbon = currentRibbon();
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
```

Find:

```js
function commitFields() {
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
```

Replace with:

```js
function commitFields() {
  const ribbon = currentRibbon();
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
```

Find:

```js
function commitPitchDropdown() {
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
```

Replace with:

```js
function commitPitchDropdown() {
  const ribbon = currentRibbon();
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
```

Find:

```js
function editSplit() {
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
```

Replace with:

```js
function editSplit() {
  const ribbon = currentRibbon();
  if (!selectedNote || !ribbon) return;
  const n = noteAt(ribbon.notes, selectedNote.at, selectedNote.midi);
```

Find:

```js
/** The zoomed pane's current pitch range, the same call renderZoom uses. */
function zoomPitchRangeNow() {
  if (!ribbon) return [48, 72];
  return window.SansRibbon.pitchRange(ribbon.notes, { clip: ribbon.clip !== false });
}
```

Replace with:

```js
/** The zoomed pane's current pitch range, the same call renderZoom uses. */
function zoomPitchRangeNow() {
  const ribbon = currentRibbon();
  if (!ribbon) return [48, 72];
  return window.SansRibbon.pitchRange(ribbon.notes, { clip: ribbon.clip !== false });
}
```

- [ ] **Step 22: `attachSeek()` gates the range-drag band on the currently-selected stem**

Find:

```js
function attachSeek(canvas, opts) {
  const rangeBand = !!(opts && opts.rangeBand);
  const tempoLane = !!(opts && opts.tempoLane);
  const posToTime = (e) => {
    const r = canvas.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * duration;
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (tempoLane && tempoRangeArmed) {
      const t = posToTime(e);
      tempoRangeDrag = { startT: t, curT: t };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (rangeBand && editMode) {
```

Replace with:

```js
function attachSeek(canvas, opts) {
  const rangeBand = !!(opts && opts.rangeBand);
  const tempoLane = !!(opts && opts.tempoLane);
  const stem = opts && opts.stem;
  const posToTime = (e) => {
    const r = canvas.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * duration;
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (tempoLane && tempoRangeArmed) {
      const t = posToTime(e);
      tempoRangeDrag = { startT: t, curT: t };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    /* Only the lane currently selected for editing accepts a range-drag — dragging on the
     * OTHER stem's full-song lane while it isn't the edit target must not silently edit the
     * SELECTED stem's notes. See syncRangeHints(), which hides the caption on the other lane
     * for the same reason. */
    if (rangeBand && editMode && stem === zoomNotesStem) {
```

- [ ] **Step 23: `retranslate()` — loop over both note lanes and both Notes chips**

Find:

```js
  // Lane labels translate; the note NAMES drawn inside the ribbon never do.
  if (ribbonEl) ribbonEl.txt.textContent = tr('notes.lane');
  if (zoomEl) zoomEl.lane.querySelector('.txt').textContent = tr('notes.zoom');
  for (const { stem, select, label: labelEl, spk } of zoomChipEls) {
    const t = tracks.find((tr) => tr.stem === stem);
    const label = t ? laneLabel(t) : stem;
    select.title = tr('notes.zoomLaneShowTip', { lane: label });
    labelEl.textContent = label;
    spk.title = tr('notes.zoomLaneMuteTip', { lane: label });
  }
  if (zoomNotesChipEl) {
    zoomNotesChipEl.textContent = tr('notes.zoomNotesChip');
    zoomNotesChipEl.title = tr('notes.zoomNotesChipTip');
  }
  if (zoomNotesMuteEl) zoomNotesMuteEl.title = tr('notes.zoomNotesMuteTip');
  syncTempoRangeHint();
```

Replace with:

```js
  // Lane labels translate; the note NAMES drawn inside a ribbon never do.
  for (const stem of NOTE_STEMS) {
    const lane = noteLanes[stem];
    if (lane) lane.el.txt.textContent = tr('notes.lane');
  }
  if (zoomEl) zoomEl.lane.querySelector('.txt').textContent = tr('notes.zoom');
  for (const { stem, select, label: labelEl, spk } of zoomChipEls) {
    const t = tracks.find((tr) => tr.stem === stem);
    const label = t ? laneLabel(t) : stem;
    select.title = tr('notes.zoomLaneShowTip', { lane: label });
    labelEl.textContent = label;
    spk.title = tr('notes.zoomLaneMuteTip', { lane: label });
  }
  for (const stem of NOTE_STEMS) {
    const chip = zoomNotesChipEls[stem];
    if (!chip) continue;
    const label = tr('stem.' + stem);
    chip.select.textContent = tr('notes.zoomNotesChipFor', { lane: label });
    chip.select.title = tr('notes.zoomNotesChipForTip', { lane: label });
    chip.spk.title = tr('notes.zoomNotesMuteTipFor', { lane: label });
  }
  if (editToggleEl) {
    editToggleEl.nextSibling.textContent = tr('notes.edit');
    editToggleEl.parentElement.title = tr('notes.editTip');
  }
  syncTempoRangeHint();
```

- [ ] **Step 24: `sansbass:editmode` listener — sync the checkbox, drop the singular range-hint line**

Find:

```js
window.addEventListener('sansbass:editmode', (e) => {
  editMode = e.detail.on;
  selectedNote = null;
  noteDrag = null;
  addArmed = false;
  addDrag = null;
  rangeDrag = null;
  rangeSelection = null;
  if (zoomToolbar) { zoomToolbar.root.hidden = !editMode; zoomToolbar.fields.hidden = !editMode; }
  if (zoomRangeHint) zoomRangeHint.hidden = !editMode;
  if (ribbonRangeHint) ribbonRangeHint.hidden = !editMode;
  if (zoomEl) { zoomEl.canvas.classList.toggle('editing', editMode); draw(); }
});
```

Replace with:

```js
window.addEventListener('sansbass:editmode', (e) => {
  editMode = e.detail.on;
  if (editToggleEl) editToggleEl.checked = editMode;
  selectedNote = null;
  noteDrag = null;
  addArmed = false;
  addDrag = null;
  rangeDrag = null;
  rangeSelection = null;
  if (zoomToolbar) { zoomToolbar.root.hidden = !editMode; zoomToolbar.fields.hidden = !editMode; }
  if (zoomRangeHint) zoomRangeHint.hidden = !editMode;
  syncRangeHints();
  if (zoomEl) { zoomEl.canvas.classList.toggle('editing', editMode); draw(); }
});
```

- [ ] **Step 25: `window.sansBass` surface**

Find:

```js
window.sansBass = {
  loadSeparated,
  /** The currently loaded full-mix track, or null. */
  currentMix: () => {
    const t = tracks.find((x) => x.stem === 'mix');
    // t.name, not t.label: assignStems relabels a lone file to "Full mix", which would
    // then become the ZIP's folder name.
    return t ? { name: t.name, buffer: t.buffer } : null;
  },
  /** True when exactly one track is loaded — i.e. an unseparated song. */
  isSingleTrack: () => tracks.length === 1,
  /** A loaded stem's buffer by name, or null. notes.js reads 'vocals' through this. */
  stemBuffer: (stem) => {
    const t = tracks.find((x) => x.stem === stem);
    return t ? { name: t.name, buffer: t.buffer } : null;
  },
  /** Hand detected notes to the player, or null to clear the lane. */
  setNotes,
  /** Restores a tempoRange imported from an edits JSON, updating the drums-lane caption. */
  setTempoRange: (range) => {
    tempoRange = range;
    syncTempoRangeHint();
    draw();
  },
  /** Where notes.js connects its oscillators, and the clock they must use. */
  notesAudio: () => (audio && ribbonGain ? { ctx: audio, destination: ribbonGain } : null),
  /** Current transport, for scheduling a synth that starts mid-playback. */
  transport: () => ({ playing, t0: startedAt, offset,
                      loopA: loopOn() ? loopA : null, loopB: loopOn() ? loopB : null }),
  /** True while the notes lane is silent. */
  ribbonMuted: () => ribbonMuted,
  /** Show or hide both notes panes. Hiding also mutes. */
  setRibbonVisible,
  ribbonVisible: () => ribbonVisible,
  say,
};
```

Replace with:

```js
window.sansBass = {
  loadSeparated,
  /** The currently loaded full-mix track, or null. */
  currentMix: () => {
    const t = tracks.find((x) => x.stem === 'mix');
    // t.name, not t.label: assignStems relabels a lone file to "Full mix", which would
    // then become the ZIP's folder name.
    return t ? { name: t.name, buffer: t.buffer } : null;
  },
  /** True when exactly one track is loaded — i.e. an unseparated song. */
  isSingleTrack: () => tracks.length === 1,
  /** A loaded stem's buffer by name, or null. notes.js reads 'vocals'/'bass' through this. */
  stemBuffer: (stem) => {
    const t = tracks.find((x) => x.stem === stem);
    return t ? { name: t.name, buffer: t.buffer } : null;
  },
  /** Hand one channel's detected notes to the player, or null to clear that lane. */
  setNotes,
  /** Restores a tempoRange imported from an edits JSON, updating the drums-lane caption. */
  setTempoRange: (range) => {
    tempoRange = range;
    syncTempoRangeHint();
    draw();
  },
  /** Where a channel connects its oscillators, and the clock they must use. */
  notesAudio: (stem) => {
    const l = noteLanes[stem];
    return (audio && l && l.gain) ? { ctx: audio, destination: l.gain } : null;
  },
  /** Current transport, for scheduling a synth that starts mid-playback. */
  transport: () => ({ playing, t0: startedAt, offset,
                      loopA: loopOn() ? loopA : null, loopB: loopOn() ? loopB : null }),
  /** True while the given stem's notes lane is silent. */
  ribbonMuted: (stem) => !!noteLanes[stem]?.muted,
  /** Show or hide one stem's notes pane. Hiding also mutes. */
  setRibbonVisible,
  ribbonVisible: (stem) => !!ribbonVisible[stem],
  say,
};
```

- [ ] **Step 26: Run the automated test suite**

Run: reload `http://localhost:8777/tests/test.html`, read `window.__testResults`.
Expected: PASS — every existing test suite (`pitch:`, `sonify:`, `notes:`, `i18n:`, `versions:` — not yet touched, still expects `v1.17.2` and will still pass since nothing has bumped it — `analytics:`, `stems:`, `tempo:`, `ribbon:`, `jianpu:`, `overlap:`, `wav:`, `zip:`, `unzip:`, `platform:`) still green. `tests/i18n.test.js`'s `'every key used in index.html exists in both locales'` test now also covers the live `data-i18n="stem.vocals"`/`data-i18n="stem.bass"` panel labels and confirms they resolve.

- [ ] **Step 27: Manual sanity load (not the full Task 11 pass — just confirm the app runs)**

With `./scripts/serve.sh` running, open `http://localhost:8777/` in a browser, load a song/zip with **both** vocals and bass stems. Confirm:
- No console errors on load.
- Both `#notes-vocals` and `#notes-bass` panels appear once loaded.
- Pressing **Find notes** in each independently populates its own lane, both visible at once.
- The zoomed pane's two "Notes: Vocals" / "Notes: Bass" chips are mutually exclusive on click, each with its own mute glyph.

This is a smoke check, not the full behaviour pass — Task 11 covers the whole feature end-to-end once `docs/behaviour.md` (Task 9) also reflects the new shape.

- [ ] **Step 28: Commit**

```bash
git add app.js
git commit -m "$(cat <<'EOF'
feat: per-stem note lanes and a two-chip zoomed-pane selector in app.js

Singular ribbon/ribbonEl/ribbonGain/ribbonMuted/ribbonVisible/
ribbonVolume/ribbonHeight become a per-stem noteLanes map. The zoomed
pane's single Notes chip becomes two, mutually exclusive on select,
independent on mute, tracked by zoomNotesStem. Edit notes becomes one
global toggle beside them. window.sansBass's setNotes/ribbonMuted/
setRibbonVisible/ribbonVisible/notesAudio all gain a stem parameter.
Neither lane is ever added to `tracks`, so mute-all/solo keep skipping
both for free. This is the commit that makes the two-channel feature
end-to-end runnable, together with the previous two.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bph1E6jMTnBMWFipFpBTzf
EOF
)"
```

---

### Task 8: Validate `BASS_RANGE.window` against real bass audio, document the sweep

**Files:**
- Modify: `lib/pitch.js` (only if the measurement below changes the shipped value — it doesn't; see Step 1)
- Modify: `docs/transcription.md`

**Interfaces:**
- Consumes: `BASS_RANGE` from Task 1; the bench page `tests/notes.html` (pre-existing, unmodified — it already supports `?stem=`, `?track=`, and a `window`/`tauMin`/`tauMax` query-string sweep via its `TUNABLE` list).
- Produces: a measured table row in `docs/transcription.md`, matching the format of the existing `minDurationMs`/`driftCents`/… table.

**This measurement has already been run** (during plan-writing, using the project's own bench page against real audio already present in `stems/reborn/`) rather than left as a to-do — the spec calls this "unvalidated until implementation runs it against real bass audio," and the tooling to do that already exists in the repo. Step 1 below records the actual results; Step 2 writes them up.

- [ ] **Step 1: The measurement (already run — reproduce to confirm, or trust and move to Step 2)**

To reproduce: `./scripts/serve.sh`, then open `http://localhost:8777/tests/notes.html?stem=bass&window=<N>&tauMin=27&tauMax=269` (and, for the baseline row, the same URL with no query parameters at all, which runs `YIN_DEFAULTS` — `window=512, tauMin=10, tauMax=138` — against the bass stem). Read the `frames`/`voiced`/`notes` summary line, the `mean deviation` line, and the `threshold-v1` column of the `== INTERPRETERS ==` table.

Measured on `stems/reborn/6 南國的風/bass.m4a` (233.3 s) and cross-checked on `stems/reborn/9 繼續向前行/bass.m4a` (249.8 s):

| range | window | voiced % | notes (threshold-v1) | octave outliers | mean deviation | decode |
|---|---|---|---|---|---|---|
| `YIN_DEFAULTS` (vocal) | 512 | 37% | 208 (159 after min-duration) | 3 | **+21.4 cents** | 10.6s |
| `tauMin:27, tauMax:269` | 512 | 86% | 435 (338) | 8 | −5.7 cents | 17.3s |
| `tauMin:27, tauMax:269` | 768 | 86% | 406 (318) | 5 | −6.8 cents | 24.8s |
| `tauMin:27, tauMax:269` | **1024** | 86% | 394 (313) | 6 | **−6.7 cents** | 30.9s |
| `tauMin:27, tauMax:269` | 1536 | 87% | 386 (312) | 4 | −6.1 cents | 45.8s |
| `tauMin:27, tauMax:269` | 2048 | 87% | 389 (319) | 8 | −6.7 cents | 63.4s |

(second-track cross-check, `9 繼續向前行`, window 1024: 89% voiced, −1.4 cents, 2 octave outliers with threshold-v1 and 1 with `hmm-v1`+fold; the vocal-range baseline on the same track: 39% voiced, +15.1 cents, 165/149 notes.)

**Reading the table:** `YIN_DEFAULTS` on a bass stem is not a smaller version of the same signal — it is qualitatively broken. `tauMax = 138` (79.9 Hz floor) cannot represent most of a bass line's fundamentals at all, so two thirds of the track goes unvoiced, and what little survives locks onto a harmonic well above the true pitch (mean deviation +21.4 cents — a systematic sharp bias, not noise). Once `tauMin`/`tauMax` are widened to the bass range, voiced coverage jumps to 86-89% regardless of window size — `window` alone was never going to fix a search range that structurally excludes the fundamental.

`window`'s own effect is real but much smaller, and it isn't monotonic: 512 samples (only ~1.9 periods of the lowest bass note, exactly the concern the design spec raised) shows the most octave outliers of any width tried (8), consistent with too little context for a stable difference-function minimum. 768/1024/1536 all land in a tight band (octave outliers 4-6, voiced 86-87%, mean deviation within a cent of each other) — the metric plateaus well before 1536. 2048 provides no further improvement (voiced 87%, octave outliers back up to 8) while more than doubling decode cost over 1024 (63.4s vs 30.9s on this synchronous bench page — the real worker path parallelises differently, but the *relative* cost still applies).

**Verdict: `window: 1024` — the value already shipped in Task 1 — sits in the plateau, one full period-count step above the noisiest setting (512), without paying 1536/2048's extra cost for no measurable gain.** No code change results from this task; `BASS_RANGE` in `lib/pitch.js` is confirmed as-is.

- [ ] **Step 2: Record the measurement in `docs/transcription.md`**

In `docs/transcription.md`, find:

```
### What the parameters actually do

Measured on `6 南國的風`, a 233 s vocal stem, 437 notes at defaults. **`minDurationMs` is
the only knob with real leverage.** Do not present the others as equals in a UI; they are
not.

| parameter | sweep | notes produced | verdict |
|---|---|---|---|
| `minDurationMs` | 80 → 250 | 437 → 313 → 228 → 171 → 99 → 69 | **dominant** |
| `driftCents` | 40 → 200 | 423 → 437 → 427 → 425 → 402 → 392 | nearly inert |
| `gapFrames` | 2 → 12 | 437 → 470 | nearly inert |
| `medianSpan` | 3 → 13 | 421 → 437 → 491 → 449 | non-monotonic, not a control |
| `minConfidence` | 0.3 → 0.6 | 485 → 456 → 437 → 410 | mild, and it moves voicing too |

`driftCents` reads as inert because the drift rule needs three *consecutive* frames past the
threshold, and vibrato oscillates — it rarely stays on one side that long.
```

Replace with:

```
### What the parameters actually do

Measured on `6 南國的風`, a 233 s vocal stem, 437 notes at defaults. **`minDurationMs` is
the only knob with real leverage.** Do not present the others as equals in a UI; they are
not.

| parameter | sweep | notes produced | verdict |
|---|---|---|---|
| `minDurationMs` | 80 → 250 | 437 → 313 → 228 → 171 → 99 → 69 | **dominant** |
| `driftCents` | 40 → 200 | 423 → 437 → 427 → 425 → 402 → 392 | nearly inert |
| `gapFrames` | 2 → 12 | 437 → 470 | nearly inert |
| `medianSpan` | 3 → 13 | 421 → 437 → 491 → 449 | non-monotonic, not a control |
| `minConfidence` | 0.3 → 0.6 | 485 → 456 → 437 → 410 | mild, and it moves voicing too |

`driftCents` reads as inert because the drift rule needs three *consecutive* frames past the
threshold, and vibrato oscillates — it rarely stays on one side that long.

### `BASS_RANGE`: search range dominates, window is a smaller, non-monotonic effect

Measured on `6 南國的風`'s bass stem (233 s) and cross-checked on `9 繼續向前行`'s (250 s).
`YIN_DEFAULTS` (`tauMin: 10, tauMax: 138` — the vocal range) applied to a bass stem is not a
smaller version of the same signal: `tauMax` cannot represent most bass fundamentals at all.

| range | window | voiced % | notes (threshold-v1) | octave outliers | mean deviation |
|---|---|---|---|---|---|
| `YIN_DEFAULTS` (vocal) | 512 | 37% | 159 | 3 | **+21.4 cents** |
| `BASS_RANGE` (`tauMin:27,tauMax:269`) | 512 | 86% | 338 | 8 | −5.7 cents |
| `BASS_RANGE` | 768 | 86% | 318 | 5 | −6.8 cents |
| `BASS_RANGE` | **1024 (shipped)** | 86% | 313 | 6 | −6.7 cents |
| `BASS_RANGE` | 1536 | 87% | 312 | 4 | −6.1 cents |
| `BASS_RANGE` | 2048 | 87% | 319 | 8 | −6.7 cents |

Widening `tauMin`/`tauMax` alone (independent of `window`) is what fixes voiced coverage —
it jumps from 37% to 86% at the *same* 512-sample window, and the vocal range's mean
deviation (+21.4 cents, a systematic sharp bias from locking onto a harmonic) collapses to
within a few cents of true pitch. `window`'s own effect is smaller and non-monotonic: 512
samples (~1.9 periods of the lowest bass note) shows the most octave outliers of any width
tried; 768/1024/1536 all land in a tight plateau; 2048 gives no further improvement while
more than doubling decode cost over 1024. **`window: 1024` ships** — one period-count step
above the noisiest setting, without paying for width that measurably buys nothing.
```

- [ ] **Step 3: Run the automated test suite**

Run: reload `http://localhost:8777/tests/test.html`.
Expected: PASS — this task changes only documentation (no source file besides the confirmed-unchanged `lib/pitch.js`), so the suite is unaffected by construction. Confirm anyway, since it's a cheap check.

- [ ] **Step 4: Commit**

```bash
git add docs/transcription.md
git commit -m "$(cat <<'EOF'
docs: measure BASS_RANGE.window against real bass audio

Confirms the 1024-sample starting guess: search-range widening (not
window size) is what fixes voiced coverage on a bass stem, and window
size plateaus well before the cost of 1536/2048 samples pays for
itself. No code change — the shipped default is already correct.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bph1E6jMTnBMWFipFpBTzf
EOF
)"
```

---

### Task 9: `docs/behaviour.md` — two independent channels sharing one zoomed pane

**Files:**
- Modify: `docs/behaviour.md`

**Interfaces:**
- Consumes: the final shape of Tasks 5-7 (ids, `window.sansBass` surface, `zoomNotesStem`/`noteLanes`/`applyZoomVisibility`/`anyRibbon` semantics) — this task only documents behaviour, it changes no code.

**A confirmed design decision this task documents:** the zoomed pane's visibility is independent of which (if any) Notes chip is selected — deselecting both chips leaves the pane open showing plain waveforms and the shared beat/bar grid, exactly as today's single Notes-chip toggle already behaves (existing row N59). Only the pitch-specific overlay (grid, contour, note blocks) depends on a chip being selected. This was confirmed against the alternative (chip deselection closes the whole pane) before writing this task, because the two read very differently in the code and both are defensible readings of the design spec's "same as ribbon === null today" line.

Below are the specific rows that change, quoted old-then-new, followed by new rows to append. Rows not listed are unaffected (colours, fold thresholds, key detection math, tempo-grid mechanics, individual edit primitives, etc. all apply per-channel exactly as written today, with no wording change needed).

- [ ] **Step 1: Update `## Notes lane`'s intro paragraph and the rows that describe singular-panel behaviour**

Find:

```
`notes.js` loads as a plain `<script type="module">` and reaches the player only through
`window.sansBass`, the same seam `separate.js` uses. The lane itself is built by `app.js`
inside `buildUI()`, not declared in `index.html` — `el.lanes.innerHTML = ''` destroys
anything parked inside `#lanes`, so a static element would survive exactly one song.

The layer model these rows exercise is in [`docs/transcription.md`](transcription.md):
analysis is immutable, interpretation is re-derived, and the two must stay separable.
```

Replace with:

```
`notes.js` loads as a plain `<script type="module">` and reaches the player only through
`window.sansBass`, the same seam `separate.js` uses. It creates two independent channels —
`createNotesChannel('vocals', ...)` and `createNotesChannel('bass', ...)` — each with its own
frames, notes, edits, jianpu state and worker. Tempo state is the one exception: it is
shared, module-level code in `notes.js`, since it is derived from drums and does not depend
on which melodic stem is being read. Each channel's lane is built by `app.js` inside
`buildUI()`, not declared in `index.html` — `el.lanes.innerHTML = ''` destroys anything
parked inside `#lanes`, so a static element would survive exactly one song. The one shared
zoomed pane and its editing toolbar always operate on whichever channel `app.js`'s
`zoomNotesStem` currently points at — see the design spec,
[`2026-09-01-bass-notes-design.md`](superpowers/specs/2026-09-01-bass-notes-design.md).

The layer model these rows exercise is in [`docs/transcription.md`](transcription.md):
analysis is immutable, interpretation is re-derived, and the two must stay separable.
```

Find:

```
| N1 | The panel appears only when a **vocals** stem is loaded. A single unseparated song shows nothing. | Computed `display` of `#notes`. Never `.hidden` — `.notes` sets `display: flex`, so only the global `[hidden] { display: none !important }` keeps the attribute working. |
| N2 | Detection never starts by itself. It costs ~7 s of CPU on a cold first run, which is a surprise rather than a convenience. | Load a stems zip, wait 10 s: `document.querySelector('.lane.ribbon').hidden` is still `true`. |
```

Replace with:

```
| N1 | Each panel appears only when its own stem is loaded — `#notes-vocals` needs a vocals stem, `#notes-bass` needs a bass stem, independently of each other. A song with only one of the two shows only that one panel, exactly as today's vocals-only behaviour does when no vocals stem exists. | Computed `display` of `#notes-vocals` and `#notes-bass`. Never `.hidden` — `.notes` sets `display: flex`, so only the global `[hidden] { display: none !important }` keeps the attribute working. |
| N2 | Detection never starts by itself, for either channel. It costs ~7 s of CPU on a cold first run, which is a surprise rather than a convenience. | Load a stems zip with both stems, wait 10 s: every `.lane.ribbon` (`document.querySelectorAll('.lane.ribbon')`) is still `hidden`. |
```

Find:

```
| N5 | The notes panes sit directly under the vocals lane, zoomed pane first. DOM order is `[vocals, .ribbon-zoom, .ribbon]`. | `document.querySelector('.lane.ribbon').previousElementSibling` is `.lane.ribbon-zoom`, and *its* previous sibling is the vocals lane. |
```

Replace with:

```
| N5 | Each stem's own notes lane sits directly under that stem's own waveform lane — a bass-notes lane under the bass waveform, a vocals-notes lane under the vocals waveform. The one shared zoomed pane docks above whichever comes first, vocals-priority: DOM order there is `[vocals waveform, .ribbon-zoom, vocals .ribbon]`, with the bass `.ribbon` lane elsewhere in `#lanes`, directly under the bass waveform lane. | With both stems loaded: `document.querySelector('.lane.ribbon-zoom').nextElementSibling` is the vocals `.lane.ribbon`, and that lane's previous sibling is the vocals waveform lane. Separately, `document.querySelectorAll('.lane.ribbon')[1]` (bass)'s previous sibling is the bass waveform lane, with no `.ribbon-zoom` anywhere near it. |
```

- [ ] **Step 2: Update the reset/mute/visibility rows to be per-lane**

Find:

```
| N12 | Loading a new song clears the ribbon, even when the new song also has vocals. The old frames describe the old audio. | Load a second zip; `.lane.ribbon` computed `display` is `none` and its canvas `__layers` is `null`. |
| N13 | The lane is not in `tracks`. It has its own mute and volume but **no number key**, and mute-all, solo and the stem count all ignore it. | Press `0`: every `.lane:not(.ribbon):not(.ribbon-zoom)` gains `.muted` while `window.sansBass.ribbonMuted()` is unchanged. The ribbon lane has no `.kbd` child. |
```

Replace with:

```
| N12 | Loading a new song clears both lanes, even when the new song has the same stems. The old frames describe the old audio. | Load a second zip; every `.lane.ribbon` computed `display` is `none` and each one's canvas `__layers` is `null`. |
| N13 | Neither lane is in `tracks`. Each has its own mute and volume but **no number key**, and mute-all, solo and the stem count all ignore both. | Press `0`: every `.lane:not(.ribbon):not(.ribbon-zoom)` gains `.muted` while `window.sansBass.ribbonMuted('vocals')` and `.ribbonMuted('bass')` are both unchanged. Neither ribbon lane has a `.kbd` child. |
```

Find:

```
| N15 | The lane plays its notes as tones, **muted by default**. Clicking the lane name toggles it. | `window.sansBass.ribbonMuted()` is `true` on load; after clicking `.lane.ribbon .lane-name` it is `false` and the lane loses `.muted`. |
```

Replace with:

```
| N15 | Each lane plays its own notes as tones, **muted by default**, independently of the other. Clicking a lane's name toggles only that lane. | `window.sansBass.ribbonMuted('vocals')` and `.ribbonMuted('bass')` are both `true` on load; clicking the vocals lane's `.lane-name` flips only `ribbonMuted('vocals')` to `false`, leaving bass untouched. |
```

Find:

```
| N18 | A zoomed pane sits directly above the notes lane, showing a window of the song rather than all of it. It follows the playhead while playing and pans by dragging when stopped. | `.ribbon-zoom` exists; drag `.zoomwave` and the ruler labels change while the lanes below do not move. |
```

Replace with:

```
| N18 | One shared zoomed pane sits directly above whichever note lane comes first (vocals-priority), showing a window of the song rather than all of it. It stays open as long as at least one note lane is visible and populated — regardless of which, or whether any, Notes chip is currently selected (N56a) — and follows the playhead while playing, panning by dragging when stopped. | `.ribbon-zoom` exists exactly once even with both stems loaded; drag `.zoomwave` and the ruler labels change while the lanes below do not move. Mute/hide the currently-anchoring stem's lane while the OTHER stem's lane is still visible+populated: the pane stays open. |
```

Find:

```
| N22 | Once notes are found, **Find notes** disappears and a show/hide toggle takes its place — the same swap the separation panel does with Separate → Save. Loading a new song brings it back. | Computed `display` of `#notes-go` and `#notes-show`. |
| N23 | Hiding the notes panes also **mutes** them. A pane you cannot see must not still be sounding, because nothing on screen would stop it. | Unmute, then Hide: `window.sansBass.ribbonMuted()` becomes `true`. |
| N24 | Showing them again does **not** unmute. The mute is a separate decision. | Hide then Show: still muted. |
```

Replace with:

```
| N22 | Once notes are found in a panel, its own **Find notes** disappears and a show/hide toggle takes its place — the same swap the separation panel does with Separate → Save, independently per panel. Loading a new song brings it back for both. | Computed `display` of `#notes-go-vocals` / `#notes-show-vocals` (and the `-bass` equivalents). |
| N23 | Hiding a lane also **mutes** it, independently of the other lane. A pane you cannot see must not still be sounding, because nothing on screen would stop it. | Unmute vocals, then Hide it: `window.sansBass.ribbonMuted('vocals')` becomes `true`; bass is unaffected. |
| N24 | Showing a lane again does **not** unmute it. The mute is a separate decision, per lane. | Hide then Show: still muted. |
```

Find:

```
| N52 | Loading a **new song** hands the key back to automatic detection, even after an override. The 簡譜 checkbox itself survives the load. | Override the tonic on song A, load song B, run detection: the selectors show B's own detected key, not A's. `jianpu.auto` is reset in `reset()`. An override is a statement about one song; carried forward it labels every note from an unrelated key with nothing on screen saying so. |
```

Replace with:

```
| N52 | Loading a **new song** hands each channel's key back to automatic detection, independently, even after an override. The 簡譜 checkbox itself survives the load, per channel. | Override the vocals tonic on song A, load song B, run detection on vocals: its selectors show B's own detected key, not A's, and bass (if also present) does its own independent detection. `jianpu.auto` is reset in each channel's own `reset()`. |
```

- [ ] **Step 3: Rewrite the zoomed-pane chip-selector rows and add new ones for the two-chip pair**

Find:

```
| N56 | The zoomed pane's header carries a **lane selector** on its own row, below the title/seconds row: one labelled chip per stem actually loaded, plus a **Notes** chip. A colour dot alone doesn't say which stem it is, so every chip also carries the stem's own name. Default selection is vocals + notes — today's fixed behaviour, unchanged unless the user picks more. | `.zoom-lane-sel .zoom-chip` count matches `tracks.filter(t => t.stem).length + 1`; each stem chip's `.zoom-chip-label` text equals `laneLabel(t)`; `.zoom-chip-select.on` and `.zoom-notes-chip.active` on load. |
```

Replace with:

```
| N56 | The zoomed pane's header carries a **lane selector** on its own row, below the title/seconds row: one labelled chip per stem actually loaded, plus **one "`<lane>` notes" chip per note-capable stem that has a lane** (up to two — vocals and bass), plus the one global Edit-notes toggle. A colour dot alone doesn't say which stem it is, so every plain-waveform chip also carries the stem's own name, and each Notes chip names which channel it selects. Nothing is selected before either channel has notes; the plain-waveform selector's own default is unchanged (`vocals`). | `.zoom-lane-sel .zoom-chip` count matches `tracks.filter(t => t.stem).length` plus the number of note-capable stems with a lane; each `.zoom-notes-chip`'s text equals `{lane} notes` for its stem (e.g. "Bass notes"). |
| N56a | Exactly one Notes chip can be **selected** at a time — clicking one clears the other (`zoomNotesStem` holds a single value, never a set); clicking the already-selected chip clears the selection entirely, removing the pitch grid/contour/note blocks from the pane while the pane itself stays open (N59). Selection is claimed automatically by whichever channel **finishes analysis first**; analysing the other channel afterward does not steal it away. | Find notes on bass only: its chip becomes `.active`; there is no vocals chip to steal selection from yet. With both found, click the bass chip while vocals is `.active`: vocals loses `.active`, bass gains it, and vocals' own edit list is untouched. Click the active chip again: neither chip is `.active`, and the pane falls back to plain waveforms (N59). |
| N56b | Each Notes chip's **mute** glyph is independent of the other's, and independent of which chip is currently *selected* — muting bass's synthesised notes does not affect whether the pane is currently *showing* bass's pitch overlay, or vice versa. | With bass selected and unmuted, click vocals' mute glyph: `window.sansBass.ribbonMuted('vocals')` toggles; the pane keeps showing bass's overlay throughout. |
| N56c | The **Edit notes** toggle is one global control beside the two Notes chips, not duplicated per panel. It is disabled until the currently-selected chip's channel has notes, and switching chips while it is on turns editing off rather than leaving it silently pointed at an unselected (or note-less) channel. | With nothing selected, the toggle is `disabled`. Select a channel with notes and tick it: `.note-toolbar` and the inline fields appear. Switch to the other Notes chip while still ticked and that channel has no notes yet: the toggle un-ticks itself and the toolbar hides again. |
| N56d | Switching which chip is selected **never loses the other channel's edits** — they are held independently in each channel's own `editGroups`, never overwritten. | Edit a bass note, switch to vocals, edit a vocals note, switch back to bass: the bass edit made before switching away is still present in `#notes-edits-bass`'s list and still visible in the lane. |
```

Find:

```
| N59 | With Notes off, the pitch grid, contour line and note blocks disappear entirely — there is nothing pitched to plot them against, and drawing an axis with nothing on it would be worse than no axis. **The beat/bar grid is the exception**: it draws whenever `ribbon.tempo.on` is true, regardless of the Notes chip, because it's a tempo reference for whatever waveform(s) are on screen, not something the pitch view owns. | Toggle `.zoom-notes-chip`: the piano-roll shading and note-name gutter vanish from the canvas; only waveform(s), the beat grid (if tempo is on) and the time ruler remain. |
```

Replace with:

```
| N59 | With **no** Notes chip selected, the pitch grid, contour line and note blocks disappear entirely — there is nothing pitched to plot them against, and drawing an axis with nothing on it would be worse than no axis. The pane itself stays open, still showing whatever plain waveforms are checked and the time ruler. **The beat/bar grid is the exception**: it draws whenever any channel that has notes has `tempo.on` true — read from `anyRibbon()`, not the selection — because it's a tempo reference for whatever waveform(s) are on screen, not something the pitch view owns or something that vanishes just because no channel is selected. | Deselect whichever Notes chip is active (click it again): the piano-roll shading and note-name gutter vanish from the canvas; plain waveform(s), the beat grid (if tempo is on for either found channel), and the time ruler all remain, and the pane's `hidden` attribute does not change. |
```

Find:

```
| N60 | A speaker glyph beside each stem chip mutes/unmutes that lane exactly like clicking its row in the main lane list, and both stay in sync regardless of which one is clicked. The Notes chip carries the same glyph, wired to the synthesised-notes lane's own mute (`ribbonMuted`) instead — a separate decision from whether the notes overlay is shown at all. | Click `.zoom-chip-mute` for vocals: the main `人聲`/`Vocals` row gains `.muted` (opacity `.38`) and the glyph gains `.muted` (struck through); click the main lane row instead and the glyph updates the same way — both route through `applyGains()`. Click the Notes chip's glyph: `window.sansBass.ribbonMuted()` toggles and so does clicking `.lane.ribbon .lane-name` — both route through `applyRibbonGain()`. |
| N61 | The lane selection is **not persisted** — it resets to vocals + notes on every page load, unlike the zoom width and pane height. | Toggle a chip, reload the page and load a song: the chips are back to vocals + notes on, and `localStorage` carries no `zoomLaneSel`-shaped key. |
```

Replace with:

```
| N60 | A speaker glyph beside each stem chip mutes/unmutes that lane exactly like clicking its row in the main lane list, and both stay in sync regardless of which one is clicked. **Each** Notes chip carries the same glyph, wired to its own channel's mute (`ribbonMuted(stem)`) — a separate decision from whether that channel's notes overlay is currently shown at all. | Click `.zoom-chip-mute` for vocals: the main `人聲`/`Vocals` row gains `.muted` and the glyph gains `.muted`; click the main lane row instead and the glyph updates the same way — both route through `applyGains()`. Click the bass Notes chip's glyph: `window.sansBass.ribbonMuted('bass')` toggles and so does clicking the bass `.lane.ribbon .lane-name` — both route through `applyRibbonGain('bass')`, leaving vocals' mute untouched. |
| N61 | The plain-waveform lane selection is **not persisted** — it resets to `vocals` on every page load, unlike the zoom width and pane height. `zoomNotesStem` is likewise never persisted — a fresh page load starts with nothing selected until a channel finishes analysis (N56a). | Toggle a plain-waveform chip, reload the page and load a song: it is back to just `vocals` on, and `localStorage` carries no `zoomLaneSel`- or `zoomNotesStem`-shaped key. |
```

- [ ] **Step 4: Update the Note editing section's intro, `E1`, and `E18`; add rows for the global toggle and stem-tagged export/import**

Find:

```
`applyEdits()` (`lib/pitch.js`) runs after `interpret()`/`foldOctaves()` inside
`notes.js`'s `reinterpret()`. `app.js` owns the zoomed pane's selection, toolbar, and
pointer/keyboard interactions, and talks to `notes.js` through `sansbass:noteedit` /
`sansbass:editundo` / `sansbass:editmode` — the design is in
[`docs/superpowers/specs/2026-08-31-note-editing-design.md`](superpowers/specs/2026-08-31-note-editing-design.md).
The inline Start/End/Pitch fields beside the toolbar (rows E27-E32) are a later addition — see
[`docs/superpowers/specs/2026-09-01-note-inline-fields-design.md`](superpowers/specs/2026-09-01-note-inline-fields-design.md).
```

Replace with:

```
`applyEdits()` (`lib/pitch.js`) runs after `interpret()`/`foldOctaves()` inside each
channel's own `reinterpret()`. `app.js` owns the zoomed pane's selection, toolbar, and
pointer/keyboard interactions, and talks to whichever channel is currently editable through
`sansbass:noteedit` / `sansbass:editundo` / `sansbass:editmode` — the last of these now
carries a `stem` field naming which channel is entering or leaving edit mode, since editing
is inherently single-target across two channels. Each channel gates its own reaction to the
first two events on a private `editable` flag, set from that `stem` field, rather than
reacting to every edit broadcast regardless of who it was for. The original single-channel
design is in
[`docs/superpowers/specs/2026-08-31-note-editing-design.md`](superpowers/specs/2026-08-31-note-editing-design.md),
extended to two channels by
[`docs/superpowers/specs/2026-09-01-bass-notes-design.md`](superpowers/specs/2026-09-01-bass-notes-design.md).
The inline Start/End/Pitch fields beside the toolbar (rows E27-E32) are a later addition — see
[`docs/superpowers/specs/2026-09-01-note-inline-fields-design.md`](superpowers/specs/2026-09-01-note-inline-fields-design.md).
```

Find:

```
| E1 | **Edit notes** is disabled until a note detection run has completed, and resets (disabled, unticked) on a new song. | `#notes-edit.disabled` before/after **Find notes**; load a second zip and it is `disabled` and `unchecked` again. |
```

Replace with:

```
| E1 | The one global **Edit notes** toggle (beside the two Notes chips, not inside either panel) is disabled until the currently-selected channel has completed a note detection run, and resets (disabled, unticked) whenever a channel that was being edited resets on a new song. | The toggle's `disabled` state before/after **Find notes** on whichever channel is selected; load a second zip and it is `disabled` and unticked again. |
```

Find:

```
| E18 | Loading a new song clears the edit list and both toolbar/list panels, exactly as parameters and the 簡譜 key already reset. | Make an edit, load a second zip: `#notes-edits` is `hidden` again and empty. |
```

Replace with:

```
| E18 | Loading a new song clears each channel's own edit list independently, exactly as its parameters and 簡譜 key already reset. | Make a vocals edit, load a second zip: `#notes-edits-vocals` is `hidden` again and empty; the same holds for `#notes-edits-bass` if a bass edit was also made. |
```

- [ ] **Step 5: Append new rows for stem-tagged export/import**

The `## Note editing` table's rows are not in strictly ascending numeric order (`E34` sits
between `E17` and `E18`, well before the end) — anchor on the table's actual **last** row by
its exact text, `E25`, rather than by assuming `E34` is final.

Find:

```
| E25 | A toolbar button or keyboard shortcut (octave, semitone, time nudge, delete, split) always acts on the exact note carrying the outline — never a different note that happens to share the outlined note's anchor time. | Select a note, add a second note overlapping it in time at a different pitch, then press a toolbar button (e.g. ↑ 8ve): only the outlined note's pitch/position changes; the overlapping note is untouched. |
```

Replace with:

```
| E25 | A toolbar button or keyboard shortcut (octave, semitone, time nudge, delete, split) always acts on the exact note carrying the outline — never a different note that happens to share the outlined note's anchor time. | Select a note, add a second note overlapping it in time at a different pitch, then press a toolbar button (e.g. ↑ 8ve): only the outlined note's pitch/position changes; the overlapping note is untouched. |
| E35 | **Export edits** downloads a filename and payload naming which channel it came from — `<song>-vocals-edits.json` or `<song>-bass-edits.json` — and the payload itself carries a `"stem"` field. **Export list**'s filename and header line do the same, with the stem word always in English (`Vocals`/`Bass`) regardless of UI language, matching the existing English-only major/minor convention. | Export edits from the bass panel: the downloaded filename ends `-bass-edits.json` and the parsed JSON has `"stem": "bass"`. Export the 簡譜 list from the same panel: the filename ends `-bass-notes.md` and its first line reads `## <song> — Bass — 1=<tonic> <major\|minor>` even under the 中文 UI. |
| E36 | Importing a file whose `stem` field doesn't match the panel doing the import **warns but does not block** — the import still applies. Absent `data.stem` (a file exported before this field existed) never warns. | Export vocals' edits, import that file into the bass panel: a warning names the mismatch, and the bass panel's edit list is populated from the file anyway. Import a pre-existing edits file with no `stem` field into either panel: no warning. |
```

- [ ] **Step 6: Run the automated test suite**

Run: reload `http://localhost:8777/tests/test.html`.
Expected: PASS — this task changes only documentation. Confirm anyway.

- [ ] **Step 7: Commit**

```bash
git add docs/behaviour.md
git commit -m "$(cat <<'EOF'
docs: update behaviour.md for two independent note channels

Notes lane / Note editing sections now describe per-stem panels and
lanes, the two-chip mutually-exclusive zoomed-pane selector, the one
global Edit-notes toggle, and stem-tagged export/import — including
the confirmed decision that the zoomed pane stays open (showing plain
waveforms) when no Notes chip is selected, unchanged from today.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bph1E6jMTnBMWFipFpBTzf
EOF
)"
```

---

### Task 10: Version bump — `v1.17.2` → `v1.18.0`

**Files:**
- Modify: `index.html`, `separate.js`, `separate.worker.js`, `notes.js`, `notes.worker.js`

**Interfaces:**
- Consumes: nothing new — this is the mechanical lockstep bump the Global Constraints section describes, done last so every earlier task's commit stays internally version-consistent.

This is a **main-release feature** per the spec's Versioning section — every `?v=` in these 5 files moves from `1.17.2` to `1.18.0` together, in one commit. Verified exact locations (confirmed by direct grep against the current tree, not the stale comment inside `index.html` — see Step 2):

| file | occurrences |
|---|---|
| `index.html` | 15 |
| `separate.js` | 3 |
| `separate.worker.js` | 1 |
| `notes.js` | 4 |
| `notes.worker.js` | 1 |
| **total** | **24** |

- [ ] **Step 1: Bump every `?v=1.17.2` to `?v=1.18.0` in all 5 files**

Run (a plain, unambiguous substitution — every occurrence in all 5 files is the same literal string with no variation to account for):

```bash
sed -i '' 's/?v=1\.17\.2/?v=1.18.0/g' index.html separate.js separate.worker.js notes.js notes.worker.js
```

- [ ] **Step 2: Correct the stale occurrence count in `index.html`'s own comment while touching this line**

`index.html`'s comment above the versioned `<script>` tags currently claims `notes.js (3)`, but `notes.js` has always had 4 occurrences (two `import` statements plus two `new Worker(...)` call sites — the redetect-tempo worker was added after this comment was last counted, in the tempo-grid feature, and the comment was never updated). Since this task is already re-deriving the exact count table above, fix the stale total in the same edit rather than propagating it.

Find:

```
     Bump the version in ALL of these on release: index.html (15), separate.js (3),
     separate.worker.js (1), notes.js (3), notes.worker.js (1) — 23 in all.
```

Replace with:

```
     Bump the version in ALL of these on release: index.html (15), separate.js (3),
     separate.worker.js (1), notes.js (4), notes.worker.js (1) — 24 in all.
```

- [ ] **Step 3: Run `tests/versions.test.js` to verify**

Run: `./scripts/serve.sh`, reload `http://localhost:8777/tests/test.html`, read `window.__testResults`.
Expected: PASS on both `versions:` tests — `'every local asset URL carries a ?v='` and `'every versioned file agrees on one version'` (now `1.18.0` everywhere, no leftover `1.17.2`). Run the **full** suite while at it — every other test file's own hardcoded `?v=` (e.g. `tests/notes.test.js`'s `Worker('../notes.worker.js?v=1.16.1', ...)`, already stale before this feature and outside `tests/versions.test.js`'s `FILES` list) is unaffected by this task and was already unaffected before it.

- [ ] **Step 4: Commit**

```bash
git add index.html separate.js separate.worker.js notes.js notes.worker.js
git commit -m "$(cat <<'EOF'
chore: bump version to v1.18.0 for the bass-notes release

Every ?v=1.17.2 across the 5 lockstep-versioned files moves to
1.18.0 together, per tests/versions.test.js. Also corrects a stale
occurrence count in index.html's own bump-reminder comment (notes.js
has always had 4 versioned references, not 3 — the redetect-tempo
worker call was added after the comment was last counted).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bph1E6jMTnBMWFipFpBTzf
EOF
)"
```

---

### Task 11: Final consolidated manual verification

**Files:** none (verification only, no code changes) — fix forward into the relevant earlier task's files if this surfaces a bug, then re-run this task.

Per this project's convention (browser-based verification lives in one consolidated pass at the end, not scattered per-task) and the spec's own Testing section, this is where the whole feature is checked end-to-end against real audio, against `docs/behaviour.md`'s new rows, and against the spec's stated success criteria and Risks.

- [ ] **Step 1: Load a song with both vocals and bass stems**

`./scripts/serve.sh`, open `http://localhost:8777/`, load a stems zip (or an unseparated song, then separate it in-browser) that has both a vocals and a bass stem. Confirm no console errors at any point in the steps below.

- [ ] **Step 2: Independent detection (spec's stated success criterion)**

Press **Find notes** in `#notes-vocals`. Confirm: the vocals lane appears under the vocals waveform, populated; the zoomed pane appears (docked above vocals), its "Vocals notes" chip auto-selects (N56a) and shows the pitch overlay; the bass panel/lane are unaffected (bass panel still shows its own **Find notes** button, no bass lane yet).

Press **Find notes** in `#notes-bass`. Confirm: the bass lane appears under the bass waveform, populated; the zoomed pane's selection **stays on vocals** (N56a: first channel to finish keeps it) even though bass finished second; both lanes are now visible simultaneously (N56/behaviour.md).

- [ ] **Step 3: Independent mute/visibility, simultaneous playback**

Unmute both lanes (click each lane's name). Press play. Confirm both synthesised tones play **simultaneously**, and are **audibly distinct** — vocals in the piano timbre, bass in the new duller/longer-sustaining bass timbre (spec's stated bass-timbre goal; this is the one thing in the whole feature that can only be judged by ear, per this project's "observe audio, not parameters" rule). Mute vocals only: bass keeps playing alone. Hide the bass lane (its show/hide toggle): it also mutes (N23) and disappears; vocals is unaffected; the zoomed pane stays open (N18) since vocals is still visible+populated.

- [ ] **Step 4: Zoomed-pane chip selection**

Click the "Bass notes" chip. Confirm: it becomes selected and "Vocals notes" deselects (N56a); the pane's pitch overlay switches to bass's contour/notes; the Edit-notes toggle (beside the chips) — if it was disabled — becomes enabled (N56c) since bass now has notes.

Click the "Bass notes" chip again (deselecting it). Confirm: no chip is selected, the pitch overlay disappears, but the pane itself stays open showing plain waveforms + the beat/bar grid if tempo is on (N59 — the confirmed design decision from Task 9).

- [ ] **Step 5: Editing follows the chip, and survives switching away**

Select the "Bass notes" chip. Tick the global **Edit notes** toggle. Click a bass note to select it; nudge its pitch with the toolbar. Confirm the edit appears in `#notes-edits-bass`'s list.

Switch to the "Vocals notes" chip. Confirm: editing turns off (or, if you re-tick it, it now applies to vocals); a vocals note can be selected and edited independently.

Switch back to "Bass notes". Confirm the earlier bass edit is **still present** — both in `#notes-edits-bass`'s list and drawn (purple) in the bass lane/zoomed pane (N56d).

- [ ] **Step 6: Export/import stem tagging**

Export edits from the bass panel; confirm the downloaded filename ends `-bass-edits.json` and its JSON has `"stem": "bass"` (E35). Import that same file into the **vocals** panel's import button; confirm a mismatch warning appears but the import still applies (E36).

- [ ] **Step 7: Single-stem-only regression check**

Load a song/zip that has a vocals stem but **no** bass stem (or vice versa). Confirm only that one panel appears, its lane/zoomed-pane behave exactly as they did before this feature (no phantom second chip, no console error referencing the missing stem), matching the spec's stated success criterion: "A song with only one of the two stems shows only that one panel, exactly as today's vocals-only behaviour does when no vocals stem exists."

- [ ] **Step 8: Performance sanity (spec's stated Risk)**

With both channels found and unmuted, play through a passage with several notes overlapping in both lanes plus all six stems' own audio also playing. Confirm no audible glitching/dropouts and no console warnings about audio context underruns — the spec flags "two simultaneous synths plus up to six stems" as more oscillators than this player has run before, though not expected to be a real problem.

- [ ] **Step 9: If any step above fails**

Fix forward in the relevant earlier task's file(s) (do not amend a prior commit — create a new fix commit per this repo's git conventions), then re-run the automated suite (`tests/test.html`) and re-run this task's steps from the top.

- [ ] **Step 10: Update the devlog**

Per this project's end-of-session convention: add a `docs/devlog.md` entry for `v1.18.0` (main release), with the TL;DR table updated and every learning bullet tagged `[note]`/`[insight]`/`[gotcha]`. Candidates worth capturing, based on what this plan surfaced: the `sansbass:editmode`/`editable`-flag pattern for gating a broadcast event to exactly one of several listeners (`[insight]`); the zoomed-pane-stays-open-on-deselection design decision and why (`[note]`); the real `BASS_RANGE.window` measurement numbers from Task 8 (`[note]`); the stale `notes.js (3)` count caught while bumping the version (`[gotcha]` — a hand-maintained count comment silently drifted from the code it describes).
