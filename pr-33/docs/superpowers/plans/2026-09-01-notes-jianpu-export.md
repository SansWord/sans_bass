# Export 簡譜 note list as Markdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, human-readable export to the Notes panel — a Markdown file listing the current 簡譜 (numbered-notation) note sequence, chunked into fixed-length timecoded blocks, downloaded on click.

**Architecture:** A pure formatting function (`degreeToken`) added to `lib/jianpu.js` next to `degreeOf`/`referenceOctave`, unit-tested the same way those already are. `notes.js` gets two new DOM refs, one line added to the existing `syncJianpuControls()` gate, and one new click handler that buckets the in-memory `notes` array by start time and writes a Blob download — no worker, no re-analysis, no new script tag.

**Tech Stack:** Vanilla JS (classic script `lib/jianpu.js`, ES module `notes.js`), existing i18n dictionary, existing test harness (`tests/test.html` / `tests/jianpu.test.js`).

**Design doc:** [`docs/superpowers/specs/2026-09-01-notes-jianpu-export-design.md`](../specs/2026-09-01-notes-jianpu-export-design.md)

---

### Task 1: `degreeToken` in `lib/jianpu.js`

**Files:**
- Modify: `lib/jianpu.js:62` (just before the `global.SansJianpu = ...` line)
- Test: `tests/jianpu.test.js`

- [ ] **Step 1: Write the failing tests**

Open `tests/jianpu.test.js` and add these tests at the end of the file (after the last existing `test(...)` call, before end of file):

```javascript
test('jianpu: degreeToken has no octave marks in the reference octave', () => {
  const ref = J().degreeOf(C4, 0, 'major').octaveIndex;
  assertEq(J().degreeToken(C4, 0, 'major', ref), '1', 'C4 in 1=C, reference octave');
});

test('jianpu: degreeToken appends an apostrophe per octave above the reference', () => {
  const ref = J().degreeOf(C4, 0, 'major').octaveIndex;
  assertEq(J().degreeToken(C4 + 12, 0, 'major', ref), "1'", 'one octave up');
  assertEq(J().degreeToken(C4 + 24, 0, 'major', ref), "1''", 'two octaves up');
});

test('jianpu: degreeToken prepends a comma per octave below the reference', () => {
  const ref = J().degreeOf(C4, 0, 'major').octaveIndex;
  assertEq(J().degreeToken(C4 - 12, 0, 'major', ref), ',1', 'one octave down');
  assertEq(J().degreeToken(C4 - 24, 0, 'major', ref), ',,1', 'two octaves down');
});

test('jianpu: degreeToken keeps the accidental between the octave marks and the digit', () => {
  const ref = J().degreeOf(C4, 0, 'major').octaveIndex;
  // C4+3 = Eb4 = b3 in 1=C major (see the worked-examples test above).
  assertEq(J().degreeToken(C4 + 3, 0, 'major', ref), 'b3', 'flat degree, reference octave');
  assertEq(J().degreeToken(C4 + 3 + 12, 0, 'major', ref), "b3'", 'flat degree, one octave up');
  assertEq(J().degreeToken(C4 + 3 - 12, 0, 'major', ref), ',b3', 'flat degree, one octave down');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./scripts/serve.sh` (in one terminal, if not already running), then open `http://localhost:8777/tests/test.html` in a browser and check `window.__testResults` via the page's own pass/fail summary, or run:

```bash
python3 -c "
import urllib.request
print(urllib.request.urlopen('http://localhost:8777/tests/test.html').status)
"
```

then load `tests/test.html` in a real browser tab (the suite runs on load and renders PASS/FAIL per test on the page — there is no CLI runner, see `CLAUDE.md`). Expected: the four new tests FAIL with `TypeError: J().degreeToken is not a function`, all other tests still PASS.

- [ ] **Step 3: Implement `degreeToken`**

In `lib/jianpu.js`, add this function right after `referenceOctave` and before the `global.SansJianpu = { degreeOf, referenceOctave };` line:

```javascript
  /**
   * A MIDI note as a printable 簡譜 token: accidental + digit, wrapped with octave marks
   * relative to `refOctaveIndex` — an apostrophe suffix per octave above it, a comma prefix
   * per octave below. Used by the plain-text note-list export in notes.js; the on-screen
   * ribbon draws the same information as dots instead (see drawOctaveDots in app.js) because
   * a rendered dot can't appear in a downloaded text file.
   */
  function degreeToken(midi, tonicPc, mode, refOctaveIndex) {
    const d = degreeOf(midi, tonicPc, mode);
    const dots = d.octaveIndex - refOctaveIndex;
    const up = dots > 0 ? "'".repeat(dots) : '';
    const down = dots < 0 ? ','.repeat(-dots) : '';
    return down + d.accidental + d.digit + up;
  }
```

Then update the export line at the bottom of the file:

```javascript
  global.SansJianpu = { degreeOf, referenceOctave, degreeToken };
```

- [ ] **Step 4: Run tests to verify they pass**

Reload `http://localhost:8777/tests/test.html`. Expected: all tests PASS, including the four new ones and every pre-existing `jianpu:` test.

- [ ] **Step 5: Commit**

```bash
git add lib/jianpu.js tests/jianpu.test.js
git commit -m "$(cat <<'EOF'
feat: add degreeToken for plain-text 簡譜 octave marks

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019fYqVBrggrWcjKuR5dUFo3
EOF
)"
```

---

### Task 2: i18n strings

**Files:**
- Modify: `lib/i18n.js:166` (zh-TW block) and `lib/i18n.js:322` (en block) — line numbers shift after Task 1's edits don't touch this file, so they should still be accurate; if not, locate by the `notes.importMismatch` / `notes.show` pair in each locale block.

- [ ] **Step 1: Add the zh-TW keys**

In `lib/i18n.js`, find this line (in the zh-TW block):

```javascript
      'notes.importMismatch': '這個檔案看起來是給「{song}」用的，與目前載入的歌曲不同。',
      'notes.show': '顯示音符',
```

Replace it with:

```javascript
      'notes.importMismatch': '這個檔案看起來是給「{song}」用的，與目前載入的歌曲不同。',
      'notes.listSecs': '每行秒數',
      'notes.exportList': '匯出簡譜列表',
      'notes.show': '顯示音符',
```

- [ ] **Step 2: Add the matching English keys**

In `lib/i18n.js`, find this line (in the en block):

```javascript
      'notes.importMismatch': 'This file looks like it was made for "{song}", not the song currently loaded.',
      'notes.show': 'Show notes',
```

Replace it with:

```javascript
      'notes.importMismatch': 'This file looks like it was made for "{song}", not the song currently loaded.',
      'notes.listSecs': 'Seconds per line',
      'notes.exportList': 'Export list',
      'notes.show': 'Show notes',
```

- [ ] **Step 3: Run the i18n test to verify both locales agree**

Reload `http://localhost:8777/tests/test.html`. `tests/i18n.test.js` checks that every key in one locale exists in the other with matching `{placeholder}`s. Expected: PASS (these two keys carry no placeholders, so this is mostly a sanity check that both blocks got edited).

- [ ] **Step 4: Commit**

```bash
git add lib/i18n.js
git commit -m "$(cat <<'EOF'
i18n: add notes.listSecs / notes.exportList strings

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019fYqVBrggrWcjKuR5dUFo3
EOF
)"
```

---

### Task 3: markup — `#notes-list-io` row

**Files:**
- Modify: `index.html:214-218` (the existing `#notes-io` row)

- [ ] **Step 1: Insert the new row**

In `index.html`, find:

```html
      <div id="notes-io" class="notes-row">
        <button id="notes-export" class="mini" type="button" disabled data-i18n="notes.export">Export edits</button>
        <button id="notes-import" class="mini" type="button" disabled data-i18n="notes.import">Import edits</button>
        <input id="notes-import-file" type="file" accept="application/json,.json" hidden>
      </div>
    </section>
```

Replace it with:

```html
      <div id="notes-io" class="notes-row">
        <button id="notes-export" class="mini" type="button" disabled data-i18n="notes.export">Export edits</button>
        <button id="notes-import" class="mini" type="button" disabled data-i18n="notes.import">Import edits</button>
        <input id="notes-import-file" type="file" accept="application/json,.json" hidden>
      </div>
      <!-- A separate export from the JSON edits row above: this one is a human-readable
           簡譜 note list, not a round-trippable edit history. Disabled together with the key
           selectors in syncJianpuControls() — a number list means nothing without a key. -->
      <div id="notes-list-io" class="notes-row">
        <label class="notes-ctl">
          <span data-i18n="notes.listSecs">Seconds per line</span>
          <input id="notes-list-secs" type="number" min="3" max="60" step="1" value="10">
        </label>
        <button id="notes-list-export" class="mini" type="button" disabled data-i18n="notes.exportList">Export list</button>
      </div>
    </section>
```

- [ ] **Step 2: Verify the page still loads with no console errors**

With `./scripts/serve.sh` running, open `http://localhost:8777/` in a browser, open devtools console. Expected: no errors — `notes.js` doesn't reference `#notes-list-secs`/`#notes-list-export` yet, so the new elements simply sit inert on the page. Load a song with a vocals stem and confirm the two new controls are visible in the Notes panel, the number input showing `10`, both looking styled consistently with the row above (same `.notes-row`/`.mini` classes, no new CSS needed).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
ui: add seconds-per-line input and Export list button to Notes panel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019fYqVBrggrWcjKuR5dUFo3
EOF
)"
```

---

### Task 4: wire up `notes.js`

**Files:**
- Modify: `notes.js:14-40` (the `el` object), `notes.js:95-141` (`syncJianpuControls`... actually see exact anchor below), `notes.js:209-231` (`reinterpret`), and a new listener block near the existing `el.exportBtn`/`el.importBtn` listeners (`notes.js:425-442`)

- [ ] **Step 1: Add the two new DOM refs**

In `notes.js`, find:

```javascript
  exportBtn: document.getElementById('notes-export'),
  importBtn: document.getElementById('notes-import'),
  importFile: document.getElementById('notes-import-file'),
```

Replace with:

```javascript
  exportBtn: document.getElementById('notes-export'),
  importBtn: document.getElementById('notes-import'),
  importFile: document.getElementById('notes-import-file'),
  listSecs: document.getElementById('notes-list-secs'),
  listExport: document.getElementById('notes-list-export'),
```

- [ ] **Step 2: Extend `syncJianpuControls()` to gate the new button**

Find:

```javascript
function syncJianpuControls() {
  el.keyTonic.value = String(jianpu.tonic);
  el.keyMode.value = jianpu.mode;
  for (const c of [el.keyTonic, el.keyMode, el.keyRel]) c.disabled = !jianpu.on;
}
```

Replace with:

```javascript
function syncJianpuControls() {
  el.keyTonic.value = String(jianpu.tonic);
  el.keyMode.value = jianpu.mode;
  for (const c of [el.keyTonic, el.keyMode, el.keyRel]) c.disabled = !jianpu.on;
  /* Meaningless without both a key AND at least one note — unlike the key selectors, which
   * only need 簡譜 to be on (they still work before any analysis has run). */
  el.listExport.disabled = !jianpu.on || !notes.length;
}
```

- [ ] **Step 3: Call `syncJianpuControls()` unconditionally at the end of `reinterpret()`**

`el.listExport`'s disabled state depends on `notes.length`, which changes on every re-interpretation (a slider drag, a fold toggle, an edit) — not just on the auto-key-detect path that currently calls `syncJianpuControls()`. Find:

```javascript
  if (jianpu.auto && notes.length) {
    const k = detectKey(notesToChroma(notes));
    jianpu.tonic = k.tonic;
    jianpu.mode = k.mode;
    syncJianpuControls();
  }
  window.sansBass.setNotes({
```

Replace with:

```javascript
  if (jianpu.auto && notes.length) {
    const k = detectKey(notesToChroma(notes));
    jianpu.tonic = k.tonic;
    jianpu.mode = k.mode;
  }
  syncJianpuControls();
  window.sansBass.setNotes({
```

- [ ] **Step 4: Verify existing behaviour is unchanged (manual, quick check)**

With `./scripts/serve.sh` running, load a song with a vocals stem, click "Find notes", tick 簡譜. Expected: works exactly as before — key selectors enable, a key is auto-detected. This step exists because Step 3 moves a call site; it doesn't test new functionality yet (the click handler isn't wired until Step 5), only that nothing broke.

- [ ] **Step 5: Add the export click handler**

Find the end of the existing `el.exportBtn`/import listener block:

```javascript
el.exportBtn.addEventListener('click', () => {
  const mix = window.sansBass.currentMix ? window.sansBass.currentMix() : null;
  const payload = {
    version: 1,
    ...(mix ? { song: mix.name } : {}),
    ...currentParams(),
    clip: el.clip.checked,
    jianpu: { on: jianpu.on, tonic: jianpu.tonic, mode: jianpu.mode },
    edits: editGroups.map((g) => g.edits),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${mix ? mix.name : 'song'}-edits.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
});

el.importBtn.addEventListener('click', () => el.importFile.click());
```

Insert a new block immediately after it (before `el.importBtn.addEventListener(...)`, so the two export handlers stay adjacent — order in the file doesn't affect behaviour, this is purely for readability):

```javascript
/* A human-readable export, independent of the JSON edits round-trip above: the current
 * 簡譜 reading, chunked into fixed-length timecoded lines, for reading (e.g. while singing)
 * without the player open. See docs/superpowers/specs/2026-09-01-notes-jianpu-export-design.md. */
function mmss(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

el.listExport.addEventListener('click', () => {
  const secs = Number(el.listSecs.value) || 10;
  const mix = window.sansBass.currentMix ? window.sansBass.currentMix() : null;
  const refOct = window.SansJianpu.referenceOctave(notes, jianpu.tonic);

  const windows = new Map();
  for (const n of notes) {
    const idx = Math.floor(n.start / secs);
    if (!windows.has(idx)) windows.set(idx, []);
    windows.get(idx).push(n);
  }

  const modeWord = tr(jianpu.mode === 'minor' ? 'notes.minor' : 'notes.major');
  const lines = [`# ${mix ? mix.name + ' — ' : ''}1=${PITCH_CLASSES[jianpu.tonic]} ${modeWord}`, ''];
  for (const idx of [...windows.keys()].sort((a, b) => a - b)) {
    const from = idx * secs;
    const to = from + secs;
    lines.push(`== ${mmss(from)} - ${mmss(to)}`);
    lines.push(windows.get(idx)
      .map((n) => window.SansJianpu.degreeToken(n.midi, jianpu.tonic, jianpu.mode, refOct))
      .join(' '));
    lines.push('');
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${mix ? mix.name : 'song'}-notes.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
});
```

`PITCH_CLASSES` and `tr` are both already defined earlier in this file (lines 44 and 52) — no new imports needed. `window.SansJianpu` is available because `lib/jianpu.js` (a classic script) is loaded before `notes.js` (a deferred module) in `index.html`.

- [ ] **Step 6: Commit**

```bash
git add notes.js
git commit -m "$(cat <<'EOF'
feat: wire up 簡譜 note-list markdown export in notes.js

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019fYqVBrggrWcjKuR5dUFo3
EOF
)"
```

---

### Task 5: manual verification (consolidated, whole-feature pass)

Per this project's convention, all browser/manual verification for this feature happens in one pass here, not per-task.

**Files:** none (verification only — fix forward in the relevant task's files if something's wrong, then re-run this task)

- [ ] **Step 1: Start the server**

```bash
./scripts/serve.sh
```

- [ ] **Step 2: Load a song and analyse**

Open `http://localhost:8777/` in a browser. Load a song (or zip) that has a `vocals` stem. In the Notes panel, click "Find notes" and wait for it to finish. Confirm the new row (`10` in the seconds field, "Export list" button) is visible but the button is disabled (簡譜 isn't on yet).

- [ ] **Step 3: Turn on 簡譜 and export at the default 10s**

Tick the 簡譜 checkbox. Confirm "Export list" becomes enabled (a key was auto-detected). Click it. Confirm a `<song>-notes.md` file downloads.

Open the downloaded file. Confirm:
- First line is `# <song name> — 1=<letter> <major|minor>`, second line blank.
- Each block is `== MM:SS - MM:SS` followed by a line of space-separated tokens (digits, some with `#`/`b`, some with trailing `'` or leading `,`), then a blank line.
- Block boundaries are exactly 10 seconds apart starting at `00:00`.
- Spot-check 2-3 tokens against what the on-screen ribbon shows at that timestamp (same digit; an on-screen note with dots above/below should show trailing `'`/leading `,` in the file) — scrub the player to that time and compare the ribbon's label.

- [ ] **Step 4: Change the line length and re-export**

Set the seconds field to `5`, click "Export list" again. Confirm the new file's blocks are 5 seconds wide (`00:00 - 00:05`, `00:05 - 00:10`, ...) and that a note whose start fell in, say, the old `00:05-00:10` half now lands in whichever 5s block its start time falls into.

- [ ] **Step 5: Confirm a note that runs past its block's end is not split or bumped**

Find (from the exported file or the ribbon) a note whose start is a few tenths of a second before a block boundary and whose duration crosses it. Confirm in the exported file that note's token appears once, in the block matching its start time, not duplicated or moved to the next block.

- [ ] **Step 6: No-mix-name case**

Load a bare zip of stems with no original mix filename (or whatever this app treats as "no `currentMix()` name" — check `window.sansBass.currentMix()` in devtools console after loading such a file, or use `separate.js`'s in-browser separation output, which the design doc notes has no mix name). Export again. Confirm the header line is `# 1=<letter> <major|minor>` with no leading song name or stray `—`.

- [ ] **Step 7: Run the full automated suite once more**

Open `http://localhost:8777/tests/test.html`. Expected: all tests PASS (including `tests/versions.test.js`, `tests/i18n.test.js`, and the new `degreeToken` tests from Task 1).

- [ ] **Step 8: Update `docs/behaviour.md`**

This is a UI behaviour change, so per `CLAUDE.md` it must be documented in `docs/behaviour.md` in the same commit. Read the file's existing structure (it's organized as observable-outcome rows with an "E##" id scheme, per the references to "E27/E28/E33" in recent commits) and add a row describing: the Export list button, its disabled condition (no key set, or no notes), the file it produces, and the fixed-window/octave-mark format. Follow the exact row format already used for the neighboring `notes.export`/`notes.import` behaviour, if one exists — if not, follow the nearest analogous row (e.g. the 簡譜 toggle's row) for column layout and tone.

- [ ] **Step 9: Commit the behaviour doc update**

```bash
git add docs/behaviour.md
git commit -m "$(cat <<'EOF'
docs: behaviour row for 簡譜 note-list export

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019fYqVBrggrWcjKuR5dUFo3
EOF
)"
```

---

### Task 6: devlog entry and PR

**Files:**
- Modify: `docs/devlog.md`

- [ ] **Step 1: Determine the version**

This is a follow-up session on the current release. Per `CLAUDE.md`, bump the third component: check `index.html`'s current `?v=` value (was `1.16.4` as of this plan's writing — confirm it hasn't moved) and use the next patch, e.g. `v1.16.5`. If this feature ships bundled with other unreleased work already on this branch, use whatever the next appropriate version is instead — check `docs/devlog.md`'s most recent entry for the current version in flight.

- [ ] **Step 2: Bump the asset version across all 23 locations**

Per `CLAUDE.md`'s versioning gotcha, every local asset URL's `?v=` must match: `index.html` (15 occurrences), `separate.js` (3), `separate.worker.js` (1), `notes.js` (3), `notes.worker.js` (1). Since this feature edited `notes.js`, its own `?v=` references (the `import` lines at the top, e.g. `./lib/pitch.js?v=1.16.4`) need bumping too, along with every other file's. Use a project-wide find/replace of the old version string with the new one across exactly these five files:

```bash
grep -rl '?v=1\.16\.4' index.html separate.js separate.worker.js notes.js notes.worker.js
```

Confirm that lists all five files, then replace (adjust the old/new version strings to whatever Step 1 determined):

```bash
sed -i '' 's/?v=1\.16\.4/?v=1.16.5/g' index.html separate.js separate.worker.js notes.js notes.worker.js
```

- [ ] **Step 3: Run `tests/versions.test.js` to confirm no drift**

Reload `http://localhost:8777/tests/test.html`. Expected: PASS — every asset URL carries the new version consistently.

- [ ] **Step 4: Write the devlog entry**

Add a new entry at the top of the version-entries section of `docs/devlog.md` (newest-first), following the file's existing heading/section format exactly (see `CLAUDE.md`'s Devlog rules for the heading format, tag reference, and required subsections). Use `git log` on this branch's commits to get an accurate timestamp for the heading. Content should cover:
- **What was built:** the `degreeToken` helper, the new `#notes-list-io` row, the export handler, i18n strings.
- **Key technical learnings**, tagged `[note]`/`[insight]`/`[gotcha]` as appropriate — e.g. an `[insight]` on why bucketing by note-start-time (rather than clipping notes to their window) makes the "note crosses a boundary" rule fall out for free with no special-casing, and a `[note]` on the apostrophe/comma ASCII-jianpu octave convention chosen over Unicode combining dots for markdown-viewer portability.
- Also update the TL;DR table at the top of `docs/devlog.md` with a one-line summary and a section-anchor link, per `CLAUDE.md`'s format.

- [ ] **Step 5: Commit the devlog**

```bash
git add docs/devlog.md index.html separate.js separate.worker.js notes.js notes.worker.js
git commit -m "$(cat <<'EOF'
docs: vX.Y.Z devlog entry for 簡譜 note-list export; bump asset version

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019fYqVBrggrWcjKuR5dUFo3
EOF
)"
```

(Replace `vX.Y.Z` in the commit message with the actual version from Step 1.)

- [ ] **Step 6: Open the PR**

Push the branch and open a PR to `main` following this repo's normal flow (see `CLAUDE.md`'s "Working conventions" — every session lands via PR, never a direct commit to `main`). Use `gh pr create`, summarizing the feature and linking the design doc and this plan.

---

## Plan self-review notes

- **Spec coverage:** every section of the design doc maps to a task — UI (Task 3), data flow/formatting (Tasks 1 and 4), edge cases (verified explicitly in Task 5 steps 3/5/6), testing (Tasks 1 and 5), out-of-scope items are simply not built (no task adds rests, persistence, or a textarea preview).
- **Type/name consistency check:** `degreeToken(midi, tonicPc, mode, refOctaveIndex)` signature is identical between its Task 1 definition and every Task 4/5 call site. `el.listSecs`/`el.listExport` names are consistent between Task 4's `el` object and its later references. `#notes-list-secs`/`#notes-list-export` ids match between Task 3's markup and Task 4's `document.getElementById` calls.
