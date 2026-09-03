# Bass-Derived Chord Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print a best-effort chord label above each bar (and each bar-half) of a 簡譜
export, guessed from the *bass* channel's notes — regardless of which channel (vocals or
bass) is being exported.

**Architecture:** A new pure module, `lib/chords.js`, exports `detectChords(bassNotes,
barBounds, tonicPc, mode)` — for each bar, split at its time midpoint into two halves, pick
the longest-duration note in each half as the root, look up its diatonic triad quality in
the bass channel's own detected key, and override to a suspension when a 4th or 2nd sounds
without the 3rd. `notes.js` gains one accessor on `createNotesChannel`'s return value
(`chordSource()`), the shared `listExport` click handler looks up the bass channel and calls
it, and `jianpuHtml`/a new `chordsHtml` helper render an optional chord row above each bar's
existing note fragments.

**Tech Stack:** Vanilla JS ES modules (`lib/chords.js`, real `import`/`export`, no
`window.SansX` bridge — mirrors `lib/jianpu.js`), Vitest (`npm test`, node tier).

**Spec:** [`docs/superpowers/specs/2026-09-03-bass-chord-detection-design.md`](../specs/2026-09-03-bass-chord-detection-design.md)

## Global Constraints

- Chord labels come **only** from the bass channel's notes, using the bass channel's own
  `jianpu.tonic`/`jianpu.mode` — never the exporting channel's, and vocals never drive a
  chord label even when exporting the vocal list.
- Chord quality is triads + sus2/sus4 **only** — no 7ths, no extensions, no
  inversions/slash chords.
- No UI for correcting or overriding a chord guess — it is a best-effort label on a static
  export, nothing more.
- `lib/jianpu.js`'s `layoutBars` and the vocal/bass channel's own key computation
  (`detectKey`/`jianpu.tonic`/`jianpu.mode`) are unchanged by this feature.
- `lib/chords.js` is pure — no DOM — and a real ES module (`export function ...`), mirroring
  `lib/jianpu.js`: no `window.SansX` bridge, testable in isolation, imported directly by
  `notes.js`.
- An export from a song with **no bass stem loaded, or a bass stem never analysed**, must be
  unaffected: `jianpuHtml` renders no `.chords` element on any bar, and the note-fragment
  markup and `.bar`'s visual height/appearance stay exactly what they are today.
- No new i18n strings. The export is English-only already (`STEM_WORD`, `PITCH_CLASSES`, the
  major/minor word) and chord labels are music notation (`G`, `Am`, `Gsus4`), not translated
  UI text — `tests/i18n.test.js` needs no new keys.
- Version target for this feature is **v1.28.0** (a main release — new feature, three-part
  semver per this project's convention). The devlog heading, its TL;DR anchor, and this
  plan's own references all use that version.

## File structure

New files:
- `lib/chords.js` — `detectChords(bassNotes, barBounds, tonicPc, mode)`, pure, ESM.
- `tests/chords.test.js` — node-tier Vitest tests for `detectChords`.

Modified files:
- `vitest.config.js` — add `'chords'` to `NODE_TESTS`.
- `notes.js` — import `detectChords`; add `chordSource()` to `createNotesChannel`'s return;
  add a `chordsHtml` helper; extend `jianpuHtml` with an optional `chords` param and the
  two-row `.bar` markup/CSS; the `listExport` click handler looks up the bass channel and
  passes its chords into `jianpuHtml`.
- `docs/behaviour.md` — one new row under "Notes lane" documenting the chord row in
  **Export list**.
- `docs/devlog.md` — new v1.28.0 entry + TL;DR row.

---

### Task 1: `lib/chords.js` — chord detection

**Files:**
- Create: `lib/chords.js`
- Create: `tests/chords.test.js`
- Modify: `vitest.config.js:16-17` (`NODE_TESTS` list)

**Interfaces:**
- Produces: `export function detectChords(bassNotes, barBounds, tonicPc, mode) →
  Array<{ first: string|null, second: string|null }>` — one entry per bar
  (`barBounds.length - 1` entries). `second` is `null` whenever that half is silent or
  resolves to the same label as `first`. Consumed by `notes.js` in Task 2.

- [ ] **Step 1: Write the failing tests**

Create `tests/chords.test.js`:

```javascript
import { test, assert, assertEq } from './assert.js';
import { detectChords } from '../lib/chords.js';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const n = (start, end, midi) => ({ start, end, midi });

// One bar, midpoint at 2s: first half [0,2), second half [2,4).
const ONE_BAR = [0, 4];

test('chords: the longest-duration note in the half wins the root, over a shorter earlier note', () => {
  // C major (tonicPc 0). Root candidate: F (pc 5, midi 41), 0.3-2s (long).
  // Also present: G (pc 7, midi 43), 0-0.3s (short, earlier) — should NOT win.
  const notes = [n(0, 0.3, 43), n(0.3, 2, 41)];
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'F', 'longer note (F, IV, major) wins the root over the shorter G');
});

test('chords: an exact duration tie breaks to the earliest onset', () => {
  // Both notes overlap [0,2) for exactly 1s each: C (pc 0) at 0-1, D (pc 2) at 1-2.
  const notes = [n(0, 1, 60), n(1, 2, 62)];
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'C', 'tied overlap breaks to the earlier-onset note (C, not D)');
});

test('chords: only the overlapping portion inside the half counts toward duration', () => {
  // A note starting in the first half and running deep into the second: 1.5-3.5s (2s total),
  // but only 0.5s of it overlaps the first half [0,2). A second note fully inside the first
  // half, 0-1s (1s), has MORE overlap in that half and should win there.
  const longNote = n(1.5, 3.5, 45);   // A (pc 9) — 0.5s overlap in half 1, 1.5s in half 2
  const shortInHalf1 = n(0, 1, 43);   // G (pc 7) — 1s overlap in half 1
  const notes = [longNote, shortInHalf1];
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'G', 'the note with more OVERLAP in half 1 wins, not the longer overall note');
  assertEq(bar.second, 'Am', 'in half 2 only the long note is present, at its own full overlap there');
});

test('chords: diatonic quality is correct for all 7 degrees in a major key', () => {
  const steps = [0, 2, 4, 5, 7, 9, 11];
  const want = ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'];
  for (let i = 0; i < 7; i++) {
    const notes = [n(0, 2, 36 + steps[i])];   // isolated root, first half only
    const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
    assertEq(bar.first, want[i], `scale step ${i} in 1=C major`);
  }
});

test('chords: diatonic quality is correct for all 7 degrees in a natural minor key', () => {
  const steps = [0, 2, 3, 5, 7, 8, 10];
  const want = ['Cm', 'Ddim', 'D#', 'Fm', 'Gm', 'G#', 'A#'];
  for (let i = 0; i < 7; i++) {
    const notes = [n(0, 2, 36 + steps[i])];
    const [bar] = detectChords(notes, ONE_BAR, 0, 'minor');
    assertEq(bar.first, want[i], `scale step ${i} in 1=C minor`);
  }
});

test('chords: a chromatic root (not diatonic to the key) gets the bare root name, no suffix', () => {
  // C major; root C# (pc 1) is not one of [0,2,4,5,7,9,11].
  const notes = [n(0, 2, 37)];
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'C#', 'chromatic passing tone: bare root name, no major/minor/dim suffix');
});

test('chords: sus4 override — a 4th present without the 3rd relabels the diatonic triad', () => {
  // C major; root G (pc 7, V, diatonic major). C (pc 0) is the 4th above G (7+5=12%12=0),
  // present with no B (pc 11, the 3rd) sounding alongside it.
  const notes = [n(0, 2, 43), n(0, 1, 36)];   // G (long/root), C (short, the 4th)
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'Gsus4', '4th present, 3rd absent: relabel to sus4');
});

test('chords: sus4 does NOT override when the 3rd is also present', () => {
  const notes = [n(0, 2, 43), n(0, 1, 36), n(0, 1, 47)];   // G root, C (4th), B (3rd, pc 11)
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'G', '3rd present alongside the 4th: the diatonic major quality stands');
});

test('chords: sus2 override — a major 2nd present without the 3rd relabels the diatonic triad', () => {
  // C major; root G (pc 7). A (pc 9) is the major 2nd above G (7+2=9), 3rd (B, pc 11) absent.
  const notes = [n(0, 2, 43), n(0, 1, 45)];   // G (root), A (the 2nd)
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'Gsus2', '2nd present, 3rd absent: relabel to sus2');
});

test('chords: sus2 does NOT override when the 3rd is also present', () => {
  const notes = [n(0, 2, 43), n(0, 1, 45), n(0, 1, 47)];   // G root, A (2nd), B (3rd)
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'G', '3rd present alongside the 2nd: the diatonic major quality stands');
});

test('chords: a silent half is null', () => {
  const notes = [n(0, 1, 36)];   // only in the first half
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'C');
  assertEq(bar.second, null, 'no notes in the second half');
});

test('chords: the same chord in both halves comes back with second === null', () => {
  const notes = [n(0, 1, 36), n(2, 3, 36)];   // C in both halves
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'C');
  assertEq(bar.second, null, 'same label both halves: second is deduped to null');
});

test('chords: different chords in each half are both returned', () => {
  const notes = [n(0, 1, 36), n(2, 3, 43)];   // C then G
  const [bar] = detectChords(notes, ONE_BAR, 0, 'major');
  assertEq(bar.first, 'C');
  assertEq(bar.second, 'G');
});

test('chords: a bar splits at its time MIDPOINT, not by beat count (a non-4/4 bar)', () => {
  // A 3-second bar: [0,3]. Midpoint is 1.5s regardless of beats-per-bar.
  const notes = [n(0, 1.4, 36), n(1.6, 3, 43)];   // C just before 1.5, G just after
  const [bar] = detectChords(notes, [0, 3], 0, 'major');
  assertEq(bar.first, 'C', 'first half [0, 1.5)');
  assertEq(bar.second, 'G', 'second half [1.5, 3)');
});

test('chords: multiple bars each get their own entry, same convention as layoutBars', () => {
  const notes = [n(0, 1, 36), n(4, 5, 43)];   // C in bar 0, G in bar 1
  const bars = detectChords(notes, [0, 4, 8], 0, 'major');
  assertEq(bars.length, 2);
  assertEq(bars[0].first, 'C');
  assertEq(bars[1].first, 'G');
});

test('chords: no bass notes at all produces every bar/half null', () => {
  const bars = detectChords([], [0, 4, 8], 0, 'major');
  assertEq(bars.length, 2);
  for (const bar of bars) {
    assertEq(bar.first, null);
    assertEq(bar.second, null);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/chords.test.js
```

Expected: fails to resolve `../lib/chords.js` (module not found) — the file doesn't exist yet.

- [ ] **Step 3: Implement `lib/chords.js`**

Create `lib/chords.js`:

```javascript
/* Chord labels guessed from a monophonic bass line, printed above each bar of a 簡譜
 * export. Pure, no DOM — mirrors lib/jianpu.js, so it's testable in isolation and imported
 * directly by notes.js alongside it. See
 * docs/superpowers/specs/2026-09-03-bass-chord-detection-design.md. */
import { roundSeconds } from './time.js';

/* Note names are never translated in this app, same convention as notes.js's own
 * PITCH_CLASSES — sharps only. */
const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/* Scale steps in semitones, and the triad quality sitting on each degree — same shape as
 * lib/jianpu.js's MAJOR/MINOR degree tables, but keyed by scale STEP (0-6) rather than
 * semitone offset, and yielding a chord quality instead of a degree digit. See the design
 * spec's "Diatonic triad table". */
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MAJOR_QUALITY = ['major', 'minor', 'minor', 'major', 'major', 'minor', 'dim'];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
const MINOR_QUALITY = ['minor', 'dim', 'major', 'minor', 'minor', 'major', 'major'];

const QUALITY_SUFFIX = { major: '', minor: 'm', dim: 'dim' };

/** The root pitch class's diatonic triad quality in the given key, or `null` when the root
 *  is chromatic to it (the longest-overlap note happened to be a passing tone). */
function diatonicQuality(rootPc, tonicPc, mode) {
  const interval = ((rootPc - tonicPc) % 12 + 12) % 12;
  const steps = mode === 'minor' ? MINOR_STEPS : MAJOR_STEPS;
  const quality = mode === 'minor' ? MINOR_QUALITY : MAJOR_QUALITY;
  const idx = steps.indexOf(interval);
  return idx === -1 ? null : quality[idx];
}

/** The note with the greatest overlap duration inside `[halfStart, halfEnd)` — ties broken
 *  by earliest `start`. `notes` is every note already known to overlap the window at all
 *  (so every candidate's overlap here is > 0). */
function pickRoot(notes, halfStart, halfEnd) {
  let best = notes[0];
  let bestOverlap = Math.min(best.end, halfEnd) - Math.max(best.start, halfStart);
  for (let i = 1; i < notes.length; i++) {
    const note = notes[i];
    const overlap = Math.min(note.end, halfEnd) - Math.max(note.start, halfStart);
    if (overlap > bestOverlap || (overlap === bestOverlap && note.start < best.start)) {
      best = note;
      bestOverlap = overlap;
    }
  }
  return best;
}

/** One half-bar's chord label, or `null` if silent — see the design spec's "Per-half
 *  algorithm". `notes` is every note overlapping `[halfStart, halfEnd)` at all. */
function labelForHalf(notes, halfStart, halfEnd, tonicPc, mode) {
  if (!notes.length) return null;
  const root = pickRoot(notes, halfStart, halfEnd);
  const rootPc = ((root.midi % 12) + 12) % 12;
  const rootName = PITCH_CLASSES[rootPc];
  const quality = diatonicQuality(rootPc, tonicPc, mode);
  if (quality === null) return rootName;   // chromatic root: bare name, no suffix

  // Suspension override — only reached when step 4 (above) found a diatonic quality.
  const others = new Set();
  for (const note of notes) {
    const pc = ((note.midi % 12) + 12) % 12;
    if (pc !== rootPc) others.add(pc);
  }
  const third = (rootPc + (quality === 'major' ? 4 : 3)) % 12;
  const fourth = (rootPc + 5) % 12;
  const second = (rootPc + 2) % 12;
  if (others.has(fourth) && !others.has(third)) return `${rootName}sus4`;
  if (others.has(second) && !others.has(third)) return `${rootName}sus2`;
  return rootName + QUALITY_SUFFIX[quality];
}

/**
 * A chord guess for each half of each bar, from the BASS channel's own notes/key —
 * independent of which channel is being exported. One `{ first, second }` entry per bar
 * (`barBounds.length - 1` entries, same convention as lib/jianpu.js's layoutBars).
 * `second` is `null` whenever that half is silent OR resolves to the same label as `first`
 * — the caller renders whatever isn't null with no comparison of its own.
 *
 * Each half is split at the bar's time MIDPOINT, not by beat count, so this stays correct
 * under a non-4/4 beatsPerBar. `barBounds` is rounded through roundSeconds first, same
 * precision every note's own start/end is stored at and the same treatment
 * lib/jianpu.js's layoutBars gives its own bar boundaries (see that file's doc comment for
 * why: an unrounded boundary compared against a rounded note time can disagree by a
 * sub-millisecond sliver).
 */
export function detectChords(bassNotes, barBounds, tonicPc, mode) {
  const notes = bassNotes || [];
  const bounds = barBounds.map(roundSeconds);
  const result = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const barStart = bounds[i];
    const barEnd = bounds[i + 1];
    const mid = roundSeconds((barStart + barEnd) / 2);
    const halves = [[barStart, mid], [mid, barEnd]];
    const [first, second] = halves.map(([hs, he]) => {
      const inWindow = notes.filter((note) => note.start < he && note.end > hs);
      return labelForHalf(inWindow, hs, he, tonicPc, mode);
    });
    result.push({ first, second: second === first ? null : second });
  }
  return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/chords.test.js
```

Expected: all tests in `tests/chords.test.js` PASS.

- [ ] **Step 5: Wire the file into the node test tier**

In `vitest.config.js`, find:

```javascript
const NODE_TESTS = [
  'soundtouch', 'transport-math', 'overlap', 'tempo', 'pitch', 'ribbon', 'zip', 'unzip', 'stems',
  'jianpu', 'platform', 'notes-edits', 'time',
].map((name) => `tests/${name}.test.js`);
```

Replace with:

```javascript
const NODE_TESTS = [
  'soundtouch', 'transport-math', 'overlap', 'tempo', 'pitch', 'ribbon', 'zip', 'unzip', 'stems',
  'jianpu', 'platform', 'notes-edits', 'time', 'chords',
].map((name) => `tests/${name}.test.js`);
```

- [ ] **Step 6: Run the full suite to confirm nothing else broke**

```bash
npm test
```

Expected: all tests pass, including every `chords:` test from this task.

- [ ] **Step 7: Commit**

```bash
git add lib/chords.js tests/chords.test.js vitest.config.js
git commit -m "$(cat <<'EOF'
feat: add bass-derived chord detection (lib/chords.js)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ddor3fg829cVgGYTE3ftyL
EOF
)"
```

---

### Task 2: Wire chord labels into the 簡譜 export (`notes.js`)

**Files:**
- Modify: `notes.js:19-25` (imports)
- Modify: `notes.js:70-133` (`fragmentHtml`, new `chordsHtml`, `jianpuHtml`)
- Modify: `notes.js:675-708` (`listExport` click handler)
- Modify: `notes.js:757-760` (`createNotesChannel`'s return value)

**Interfaces:**
- Consumes: `detectChords(bassNotes, barBounds, tonicPc, mode)` (Task 1).
- Produces: `chordSource()` on each channel's return object — `() => { notes, tonicPc,
  mode } | null`. `jianpuHtml({ ..., chords })` — `chords` is an optional array, same
  length as `bars`, of `{ first, second }` (or `undefined` to render exactly as before).

No automated test for this task — `notes.js` reaches into the DOM at module load
(`document.getElementById` for `tempoEl` and inside `createNotesChannel`), and no test file
in this project imports `notes.js` itself (the one browser-tier test that shares its name,
`tests/notes.test.js`, only imports `lib/pitch.js` and drives `notes.worker.js` directly —
DOM-adjacent code in this file has never had unit coverage; it's covered by
`docs/behaviour.md`'s manual matrix instead, same convention this task follows). Covered by
Task 4's consolidated manual pass.

- [ ] **Step 1: Import `detectChords`**

In `notes.js`, find:

```javascript
import { interpret, applyEdits, detectKey, notesToChroma, relativeKey, BASS_RANGE }
  from './lib/pitch.js';
import { scheduleNotes } from './lib/sonify.js';
import * as SansI18n from './lib/i18n.js';
import * as SansJianpu from './lib/jianpu.js';
import { beatTimes } from './lib/ribbon.js';
import { buildEditsPayload, planImport } from './lib/notes-edits.js';
```

Replace with:

```javascript
import { interpret, applyEdits, detectKey, notesToChroma, relativeKey, BASS_RANGE }
  from './lib/pitch.js';
import { scheduleNotes } from './lib/sonify.js';
import * as SansI18n from './lib/i18n.js';
import * as SansJianpu from './lib/jianpu.js';
import { beatTimes } from './lib/ribbon.js';
import { buildEditsPayload, planImport } from './lib/notes-edits.js';
import { detectChords } from './lib/chords.js';
```

- [ ] **Step 2: Add `chordsHtml` and extend `jianpuHtml`**

In `notes.js`, find (`fragmentHtml` through the end of `jianpuHtml`):

```javascript
function fragmentHtml(frag) {
  const octUp = `<span class="oct-up">${frag.octave > 0 ? octaveDots(frag.octave) : ''}</span>`;
  const octDown = `<span class="oct-down">${frag.octave < 0 ? octaveDots(-frag.octave) : ''}</span>`;
  const digit = `<span class="digit ul${frag.underline}">${escapeHtml(frag.token)}</span>`;
  const note = `<span class="note">${octUp}${digit}${octDown}</span>`;
  const dot = frag.dot ? '<span class="dot">.</span>' : '';
  const dashes = '<span class="dash">-</span>'.repeat(frag.dashes);
  const tie = frag.tie ? '<span class="tie">⌣</span>' : '';
  return `<span class="frag">${note}${dot}${dashes}${tie}</span>`;
}

/** A self-contained HTML page for a 簡譜 export: `bars` (from lib/jianpu.js's layoutBars)
 *  wrapped into lines of `barsPerLine`, each bar a bordered cell of rhythm-marked fragments,
 *  under a tempo/time-signature line (`♩ = <bpm> <beatsPerBar>/4` — every bar in this app's
 *  grid is `beatsPerBar` quarter-note beats, so the note value is always fixed at 4, same
 *  assumption noteRhythm's GRID_UNITS_PER_BEAT already makes). No external assets — every
 *  rule needed to read it lives in the inlined <style>. */
function jianpuHtml({ title, bars, barsPerLine, bpm, beatsPerBar }) {
  const lines = [];
  for (let i = 0; i < bars.length; i += barsPerLine) {
    const cells = bars.slice(i, i + barsPerLine)
      .map((frags) => `<span class="bar">${frags.map(fragmentHtml).join('')}</span>`)
      .join('');
    lines.push(`<div class="line">${cells}</div>`);
  }
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
       background: #faf9f6; color: #1a1a1a; padding: 32px; line-height: 2.2; }
h1 { font-size: 18px; margin: 0 0 4px; font-weight: 600; }
.tempo { font-size: 14px; color: #555; margin: 0 0 20px; }
/* Every bar keeps its own right border and the line itself carries a left border, so each
   line reads as a self-contained "| bar | bar | bar |" — the wrap between one line's last
   bar and the next line's first is never mistaken for the absence of a barline. A full
   blank line's worth of margin separates one system from the next. */
.line { display: flex; border-left: 2px solid #333; }
.line:not(:last-child) { margin-bottom: 40px; }
.bar { display: flex; flex: 1 1 0; min-width: 0; align-items: center; justify-content: flex-start;
       flex-wrap: wrap; gap: 12px; padding: 4px 16px; border-right: 2px solid #333; min-height: 1.6em; }
.frag { position: relative; display: inline-flex; align-items: center; }
/* .note stacks standard 簡譜 octave dots above/below the digit. .oct-up/.oct-down keep a
   fixed minimum height (empty or not) so every digit in a bar sits on the same baseline
   regardless of how many dots its neighbours carry. */
.note { display: inline-grid; grid-template-rows: auto auto auto; justify-items: center; row-gap: 2px; }
.oct-up, .oct-down { display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 5px; }
.oct-dot { width: 4px; height: 4px; border-radius: 50%; background: #1a1a1a; }
.digit { position: relative; display: inline-block; font-size: 20px; font-weight: 600;
         line-height: 1; padding-bottom: 5px; }
.digit.ul1::after, .digit.ul2::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 1.5px; background: #1a1a1a; }
.digit.ul2::before {
  content: ""; position: absolute; left: 0; right: 0; bottom: -4px; height: 1.5px; background: #1a1a1a; }
.dot { font-weight: 900; margin-left: 1px; align-self: flex-end; }
.dash { margin-left: 3px; font-weight: 700; }
.tie { margin-left: 2px; color: #888; font-size: 14px; }
</style></head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="tempo">♩ = ${bpm.toFixed(1)} &nbsp;&nbsp; ${beatsPerBar}/4</p>
${lines.join('\n')}
</body></html>
`;
}
```

Replace with:

```javascript
function fragmentHtml(frag) {
  const octUp = `<span class="oct-up">${frag.octave > 0 ? octaveDots(frag.octave) : ''}</span>`;
  const octDown = `<span class="oct-down">${frag.octave < 0 ? octaveDots(-frag.octave) : ''}</span>`;
  const digit = `<span class="digit ul${frag.underline}">${escapeHtml(frag.token)}</span>`;
  const note = `<span class="note">${octUp}${digit}${octDown}</span>`;
  const dot = frag.dot ? '<span class="dot">.</span>' : '';
  const dashes = '<span class="dash">-</span>'.repeat(frag.dashes);
  const tie = frag.tie ? '<span class="tie">⌣</span>' : '';
  return `<span class="frag">${note}${dot}${dashes}${tie}</span>`;
}

/** One bar's chord row: the first half's label at the top-left, the second half's label
 *  (only when present — lib/chords.js's detectChords() already nulls it out when it's
 *  silent or matches the first half) centered above the bar. `pair` is one entry from
 *  detectChords()'s return array, `{ first, second }`. Always renders the (possibly empty)
 *  `.chords` wrapper — see jianpuHtml below for when this is called at all — so every bar
 *  in an export that HAS chord data reserves the same vertical space, matching the
 *  `.oct-up`/`.oct-down` convention fragmentHtml already uses for octave dots. */
function chordsHtml(pair) {
  const first = pair && pair.first ? `<span class="chord-first">${escapeHtml(pair.first)}</span>` : '';
  const second = pair && pair.second ? `<span class="chord-second">${escapeHtml(pair.second)}</span>` : '';
  return `<span class="chords">${first}${second}</span>`;
}

/** A self-contained HTML page for a 簡譜 export: `bars` (from lib/jianpu.js's layoutBars)
 *  wrapped into lines of `barsPerLine`, each bar a bordered cell of rhythm-marked fragments,
 *  under a tempo/time-signature line (`♩ = <bpm> <beatsPerBar>/4` — every bar in this app's
 *  grid is `beatsPerBar` quarter-note beats, so the note value is always fixed at 4, same
 *  assumption noteRhythm's GRID_UNITS_PER_BEAT already makes). No external assets — every
 *  rule needed to read it lives in the inlined <style>.
 *
 *  `chords` (optional, same length as `bars`) is lib/chords.js's detectChords() output for
 *  the BASS channel — passed regardless of which channel this export is actually for. When
 *  present, every bar gets a `.chords` row (see chordsHtml above); when omitted entirely
 *  (no bass stem loaded, or it was never analysed), no `.chords` element is rendered on any
 *  bar and `.bar`'s visual height/appearance match what they were before this feature. */
function jianpuHtml({ title, bars, barsPerLine, bpm, beatsPerBar, chords }) {
  const lines = [];
  for (let i = 0; i < bars.length; i += barsPerLine) {
    const cells = bars.slice(i, i + barsPerLine)
      .map((frags, j) => {
        const chordRow = chords ? chordsHtml(chords[i + j]) : '';
        return `<span class="bar">${chordRow}<span class="frags">${frags.map(fragmentHtml).join('')}</span></span>`;
      })
      .join('');
    lines.push(`<div class="line">${cells}</div>`);
  }
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
       background: #faf9f6; color: #1a1a1a; padding: 32px; line-height: 2.2; }
h1 { font-size: 18px; margin: 0 0 4px; font-weight: 600; }
.tempo { font-size: 14px; color: #555; margin: 0 0 20px; }
/* Every bar keeps its own right border and the line itself carries a left border, so each
   line reads as a self-contained "| bar | bar | bar |" — the wrap between one line's last
   bar and the next line's first is never mistaken for the absence of a barline. A full
   blank line's worth of margin separates one system from the next. */
.line { display: flex; border-left: 2px solid #333; }
.line:not(:last-child) { margin-bottom: 40px; }
/* .bar is a two-row flex column: an optional .chords row (only present when this export
   carries chord data at all) above .frags, which now does the flex-row layout .bar itself
   used to do directly — moving it here rather than duplicating it keeps a chord-less export
   visually identical to before this feature (no .chords element, .frags alone lays out
   exactly like .bar did). */
.bar { display: flex; flex-direction: column; flex: 1 1 0; min-width: 0;
       border-right: 2px solid #333; padding: 4px 16px; }
.chords { position: relative; height: 15px; margin-bottom: 2px; }
.chord-first { position: absolute; left: 0; top: 0; font-size: 13px; font-weight: 700; }
.chord-second { position: absolute; left: 50%; top: 0; transform: translateX(-50%);
                font-size: 13px; font-weight: 700; }
.frags { display: flex; align-items: center; justify-content: flex-start;
         flex-wrap: wrap; gap: 12px; min-height: 1.6em; }
.frag { position: relative; display: inline-flex; align-items: center; }
/* .note stacks standard 簡譜 octave dots above/below the digit. .oct-up/.oct-down keep a
   fixed minimum height (empty or not) so every digit in a bar sits on the same baseline
   regardless of how many dots its neighbours carry. */
.note { display: inline-grid; grid-template-rows: auto auto auto; justify-items: center; row-gap: 2px; }
.oct-up, .oct-down { display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 5px; }
.oct-dot { width: 4px; height: 4px; border-radius: 50%; background: #1a1a1a; }
.digit { position: relative; display: inline-block; font-size: 20px; font-weight: 600;
         line-height: 1; padding-bottom: 5px; }
.digit.ul1::after, .digit.ul2::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 1.5px; background: #1a1a1a; }
.digit.ul2::before {
  content: ""; position: absolute; left: 0; right: 0; bottom: -4px; height: 1.5px; background: #1a1a1a; }
.dot { font-weight: 900; margin-left: 1px; align-self: flex-end; }
.dash { margin-left: 3px; font-weight: 700; }
.tie { margin-left: 2px; color: #888; font-size: 14px; }
</style></head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="tempo">♩ = ${bpm.toFixed(1)} &nbsp;&nbsp; ${beatsPerBar}/4</p>
${lines.join('\n')}
</body></html>
`;
}
```

- [ ] **Step 3: Add `chordSource()` to `createNotesChannel`'s return value**

In `notes.js`, find:

```javascript
  return {
    refresh, reinterpret, analyse, needsAnalyse, busy, hasStem, stem,
    hasFrames, exportEntry, importEntry,
  };
}
```

Replace with:

```javascript
  /** This channel's notes and key, for another channel's export to derive chord labels
   *  from — `null` when this channel has nothing analysed yet. Populated automatically once
   *  the channel has notes (jianpu.tonic/mode are always kept current, whether or not this
   *  channel's own 簡譜 checkbox is on) — see lib/chords.js's detectChords(). */
  function chordSource() {
    return hasFrames() ? { notes, tonicPc: jianpu.tonic, mode: jianpu.mode } : null;
  }

  return {
    refresh, reinterpret, analyse, needsAnalyse, busy, hasStem, stem,
    hasFrames, exportEntry, importEntry, chordSource,
  };
}
```

- [ ] **Step 4: Pass bass-derived chords into the export**

In `notes.js`, find:

```javascript
    const bars = SansJianpu.layoutBars(notes, barStarts, jianpu.tonic, jianpu.mode, refOct, beatSec);

    const modeWord = jianpu.mode === 'minor' ? 'minor' : 'major';
    const title = `${mix ? mix.name + ' — ' : ''}${STEM_WORD[stem]} — 1=${PITCH_CLASSES[jianpu.tonic]} ${modeWord}`;

    const blob = new Blob([jianpuHtml({ title, bars, barsPerLine, bpm: tempo.bpmValue, beatsPerBar: tempo.beatsPerBar })],
      { type: 'text/html' });
```

Replace with:

```javascript
    const bars = SansJianpu.layoutBars(notes, barStarts, jianpu.tonic, jianpu.mode, refOct, beatSec);

    // Chord labels always come from the BASS channel's own notes/key, regardless of which
    // channel is being exported — see lib/chords.js's detectChords() and the design spec.
    // `undefined` (no bass stem loaded, or it was never analysed) means this export carries
    // no chord data at all, and jianpuHtml renders exactly as it did before this feature.
    const bassChannel = channels.find((c) => c.stem === 'bass');
    const chordSrc = bassChannel ? bassChannel.chordSource() : null;
    const chords = chordSrc
      ? detectChords(chordSrc.notes, barStarts, chordSrc.tonicPc, chordSrc.mode)
      : undefined;

    const modeWord = jianpu.mode === 'minor' ? 'minor' : 'major';
    const title = `${mix ? mix.name + ' — ' : ''}${STEM_WORD[stem]} — 1=${PITCH_CLASSES[jianpu.tonic]} ${modeWord}`;

    const blob = new Blob([jianpuHtml({ title, bars, barsPerLine, bpm: tempo.bpmValue, beatsPerBar: tempo.beatsPerBar, chords })],
      { type: 'text/html' });
```

- [ ] **Step 5: Run the full automated suite**

```bash
npm test
```

Expected: all tests pass — this task touches no test file, so this is a "nothing regressed"
check (`notes.js` itself has no unit coverage, per this task's note above).

- [ ] **Step 6: `npm run build` sanity check**

```bash
npm run build
```

Expected: succeeds with no errors — catches a stray syntax mistake in the edits above before
Task 4's manual pass.

- [ ] **Step 7: Commit**

```bash
git add notes.js
git commit -m "$(cat <<'EOF'
feat: render bass-derived chord labels in the 簡譜 export

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ddor3fg829cVgGYTE3ftyL
EOF
)"
```

---

### Task 3: Docs — `docs/behaviour.md` and `docs/devlog.md`

**Files:**
- Modify: `docs/behaviour.md` (new row after E34, in the "Note editing" section)
- Modify: `docs/devlog.md` (new v1.28.0 entry + TL;DR row)

- [ ] **Step 1: Add a `docs/behaviour.md` row**

In `docs/behaviour.md`, find the `E34` row (the **Export list** row, in the "Note editing"
section) and insert this new row immediately after it:

```markdown
| E44 | **Export list** prints a bass-derived chord guess above each bar, from the bass channel's own notes/key (`lib/chords.js`'s `detectChords()`), regardless of which channel is being exported — vocals never drive a chord label, even when exporting the vocal list. Each bar is split at its time MIDPOINT into two halves; each half's label is the longest-overlap note's pitch class (root), with a diatonic triad quality (major/minor/dim, from the bass channel's own detected key) or a bare root name when that note is chromatic to the key, further relabelled to `sus4`/`sus2` when a 4th or major 2nd sounds without the 3rd. The bar's `.chords` row shows the first half's label top-left and the second half's label (only when it differs from the first) centered above the bar — `second` comes back `null` from `detectChords()` whenever that half is silent or matches the first half, so the caller never compares labels itself. With no bass stem loaded, or a bass stem never analysed, no `.chords` element is rendered on any bar and the export is byte-for-byte what it was before this feature (`chords` is `undefined`, not an array of nulls). | Detect notes on both channels of a song with a clear chord progression, export the vocal list: each bar shows a chord label top-left, and a bar where the bass line moves mid-bar (e.g. a walk from the root to its 4th) shows a second, centered label. Export the bass channel's own list: it is annotated with the SAME chords (derived from itself). Load a song with only a vocals stem (no bass), export: no chord row appears above any bar, and the bar's height/spacing matches a pre-chords export exactly. Load a bass stem but don't run **Find notes** on it, export the vocals list: same as above, no chord row. |
```

- [ ] **Step 2: Commit the behaviour doc update**

```bash
git add docs/behaviour.md
git commit -m "$(cat <<'EOF'
docs: behaviour row for bass-derived chord labels in the export

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ddor3fg829cVgGYTE3ftyL
EOF
)"
```

- [ ] **Step 3: Add the devlog entry**

In `docs/devlog.md`, add this new entry at the top of the version-entries section (right
after the `## TL;DR` table, before the current top entry — `v1.27.0`). Get the actual
timestamp from `git log` on this branch's final commit before opening the PR (the format
is `YYYY-MM-DD HH:MM`); the entry below uses a placeholder time to be replaced with that
real value:

```markdown
## v1.28.0 — Bass-derived chords in the 簡譜 export (YYYY-MM-DD HH:MM)

**Review:** not yet

**Design docs:**
- Bass Chord Detection: [Spec](superpowers/specs/2026-09-03-bass-chord-detection-design.md) [Plan](superpowers/plans/2026-09-03-bass-chord-detection.md)

**What was built:**
- A new pure module, `lib/chords.js`, guesses a chord label for each half of each bar from
  the BASS channel's notes — independent of which channel (vocals or bass) is being
  exported.
- **Export list** now prints that guess above each bar: the first half's label top-left, the
  second half's label (only when it differs from the first) centered above the bar — so a
  bar where the bass line moves mid-bar (e.g. a walk up to the 4th) shows both.
- Chord quality is triads (major/minor/diminished) plus sus2/sus4 only — no 7ths,
  extensions, or inversions — with a bare root name (no suffix) when the longest-duration
  note in a half is chromatic to the bass channel's own detected key.
- An export from a song with no bass stem loaded, or a bass stem never analysed, is
  unaffected: no `.chords` element renders on any bar, and `.bar`'s markup/appearance match
  exactly what they were before this feature.

**Key technical learnings:**
- `[note]` Each half is split at the bar's time MIDPOINT, not by beat count — the same
  reasoning `lib/jianpu.js`'s `layoutBars` already applies to bar boundaries themselves —
  so this stays correct under a non-4/4 `beatsPerBar` with no special-casing.
- `[note]` The suspension override (sus4/sus2) only ever runs after a diatonic quality was
  already found for the root; a chromatic root's label is always just the bare root name,
  since there's no diatonic 3rd to compare a candidate 4th/2nd against.
- `[insight]` The `.chords` row is rendered as a reserved (possibly empty) slot on every bar
  whenever an export carries chord data at all — same convention `fragmentHtml`'s
  `.oct-up`/`.oct-down` spans already use for octave dots — so bars stay aligned along a
  line even when one bar's bass line is silent through both halves.
- `[note]` `jianpuHtml`'s new `.frags` wrapper (holding what `.bar`'s own CSS used to do
  directly) keeps a chord-less export visually identical to before: with `chords` omitted,
  no `.chords` element exists at all, and `.frags` alone lays out exactly as `.bar` did.

---
```

Also update the `## TL;DR` table at the top of `docs/devlog.md`, adding this row right above
the current `v1.27.0` row:

```markdown
| [v1.28.0](#v1280--bass-derived-chords-in-the-簡譜-export-yyyy-mm-dd-hhmm) | **Export list** now prints a chord guess above each bar, derived from the bass channel's own notes/key regardless of which channel is being exported — split at the bar's time midpoint so a mid-bar chord change (e.g. G → Gsus4) shows both halves. Triads + sus2/sus4 only; a chromatic passing tone gets a bare root name. An export with no analysed bass stem is unaffected. |
```

(Replace `yyyy-mm-dd-hhmm` in the anchor with the real timestamp slug once Step 3's
placeholder heading is filled in with the actual `git log` timestamp — GitHub's anchor
algorithm lowercases the heading and turns spaces/colons into hyphens.)

- [ ] **Step 4: Commit the devlog update**

```bash
git add docs/devlog.md
git commit -m "$(cat <<'EOF'
docs: v1.28.0 devlog entry for bass-derived chord detection

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ddor3fg829cVgGYTE3ftyL
EOF
)"
```

---

### Task 4: Manual verification pass (consolidated, whole-feature)

Per this project's convention, all browser/manual verification for this feature happens in
one pass here, not per-task.

**Files:** none — verification only; fix forward in the relevant task's files if something's
wrong, then re-run this task.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Load a song with both stems and detect notes on both**

Open `http://localhost:8777/`. Load a zip (or separate a song) with both `vocals` and
`bass` stems. In the Notes panel, click **Find notes**, wait for both channels to finish.

- [ ] **Step 3: Export the vocal list and confirm the chord row**

Click the vocals panel's **Export list**. Open the downloaded HTML file in a browser.
Confirm:
- Each bar shows a chord label at its top-left (e.g. `G`, `Am`, `C#`), above the note
  fragments, not overlapping them.
- At least one bar (find one where the bass line audibly moves mid-bar, or scan a few) shows
  a SECOND, centered label — confirm by ear/eye that the bass note driving each half's label
  matches what you hear/see in the app's own bass lane at that time.
- No bar shows two identical labels stacked (that half's `second` should have come back
  `null` and rendered nothing).
- A bar where the bass channel is silent through both halves reserves the same vertical
  space as one with labels (blank `.chords` row, not a collapsed one) — bars in the same
  line stay aligned along their top edge.

- [ ] **Step 4: Export the bass channel's own list**

Click the bass panel's **Export list**. Confirm it is annotated with the same chords as the
vocals export from Step 3 (same bars, same song) — the bass line is now labelled with the
chords it itself implies.

- [ ] **Step 5: No-bass-data case — unaffected export**

Load a different song/zip with only a `vocals` stem (no bass). Run **Find notes**, export
the vocal list. Confirm no chord row appears above any bar and the bar layout (height,
spacing, borders) looks identical to a bar in a pre-chord-feature export — compare visually
against the Step 3 file if unsure.

- [ ] **Step 6: Bass stem loaded but not analysed**

Load a song with both stems, but only run **Find notes** on vocals (leave bass
un-analysed). Export the vocal list. Confirm the same "no chord row" result as Step 5.

- [ ] **Step 7: Chromatic and suspension cases (best-effort, spot-check)**

If the loaded song's bass line has an audible passing tone or a walk-up to a 4th/2nd
somewhere, find the corresponding bar in an export and confirm: a passing tone shows a bare
root letter with no `m`/`dim` suffix; a walk-up to the 4th (with no 3rd sounding alongside
it) shows a `sus4` label instead of the plain diatonic quality. This is best-effort by
nature (per the spec's non-goals) — the point of this step is confirming the mechanism
fires on real audio, not exhaustively validating every label.

- [ ] **Step 8: Run the full automated suite once more**

```bash
npm test
```

Expected: all tests pass, including `tests/chords.test.js`.

- [ ] **Step 9: `npm run build` + `npm run preview`**

```bash
npm run build
npm run preview
```

Repeat Steps 2–6 against `http://localhost:8777/` (now served from `dist/`) for
production-parity.

- [ ] **Step 10: Report**

If every check in Steps 3–7 passes identically between dev and build/preview, this plan is
complete. If anything differs, use superpowers:systematic-debugging to find which task
introduced it before fixing it.

---

## Post-merge verification (not part of the task-by-task checklist — run when triggered)

This feature does not touch `vite.config.js`, an entry HTML file, or a Worker/worklet
instantiation, so `docs/behaviour.md`'s narrower **Deployment smoke test** section (build/
deploy wiring only) is not strictly required by its own stated trigger — but per `CLAUDE.md`
every plan still ends with it against a real deploy, twice, on top of Task 4's local pass.
Whoever finishes this branch (`superpowers:finishing-a-development-branch`) should run both,
at the two moments below. **Before either**, check the on-page `#build-sha` corner badge
against the commit you expect (see `CLAUDE.md`'s `#build-sha` gotcha) — a workflow reporting
`success` does not by itself mean the page in front of you is that build yet.

### A. Once the PR is open, against its preview

1. Confirm the PR exists and find its number: `gh pr view --json number,url -q
   '"\(.number) \(.url)"'`.
2. Wait for `pr-preview.yml` to finish and confirm its `conclusion` is `success` (not just
   that it ran): `gh run list --workflow=pr-preview.yml --limit 1 --json status,conclusion`.
3. Check `#build-sha` against `gh pr view <N> --json mergeCommit --jq .mergeCommit.oid`
   (short form) at `https://sansword.github.io/sans_bass/pr-<N>/`.
4. Run `docs/behaviour.md`'s Deployment smoke test section against that URL, then repeat
   Task 4's Steps 3–7 (the actual chord-detection behaviour) against it too — the smoke
   test alone would not catch a chord-rendering regression.
5. If it finds a regression: fix it on the branch, push, and rerun from step 2.

### B. Once the PR is merged to `main`, against production

1. Confirm `deploy-main.yml`'s latest run succeeded (not just ran):
   `gh run list --workflow=deploy-main.yml --limit 1 --json status,conclusion`.
2. Check `#build-sha` against `git rev-parse --short HEAD` on `main` (after pulling) at
   `https://sansword.github.io/sans_bass/`.
3. Run `docs/behaviour.md`'s Deployment smoke test section against that URL, then repeat
   Task 4's Steps 3–7 against it too.
4. If it finds a regression, it's now live — treat it as urgent: open a fix branch
   immediately rather than batching it with unrelated work.

---

## Plan self-review notes

- **Spec coverage:** Goal 1 (bar-level detection from bass notes, any exporting channel) →
  Task 2 Step 4 (`bassChannel` lookup, independent of `stem`). Goal 2 (independent per-half
  detection) → Task 1's `detectChords` splitting at the midpoint. Goal 3 (first top-left,
  second centered, only when different) → Task 2's `chordsHtml`/CSS. Goal 4 (zero effect
  with no bass data) → Task 2's `chords: undefined` path and Task 4 Steps 5–6. Non-goals
  (no 7ths/extensions/inversions, no correction UI, `layoutBars`/key computation unchanged)
  → not built anywhere; Global Constraints call them out explicitly. The full "Testing"
  bullet list and "Edge cases" section of the spec each map to a named test in
  `tests/chords.test.js` or a step in Task 4.
- **Placeholder scan:** no TBD/TODO markers; every step has real code or an exact command.
- **Type/name consistency:** `detectChords(bassNotes, barBounds, tonicPc, mode)` signature
  matches between its Task 1 definition and Task 2 Step 4's call site. `chordSource()`
  (no args, returns `{ notes, tonicPc, mode } | null`) matches between Task 2 Step 3's
  definition and Step 4's `bassChannel.chordSource()` call. `jianpuHtml`'s `chords` param
  and `chordsHtml(pair)`'s `{ first, second }` shape match `detectChords`'s return shape
  exactly (same field names, same array indexing by bar).
