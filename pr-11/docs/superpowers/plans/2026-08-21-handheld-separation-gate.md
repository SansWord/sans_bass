# Handheld Separation Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a phone or tablet, replace the in-browser separation controls with one honest sentence, so tapping Separate can no longer kill the tab.

**Architecture:** A new pure predicate in `lib/platform.js` answers "is this a handheld?" from `pointer: coarse` plus `maxTouchPoints`. `separate.js` reads it once and, when true, hides the four controls and shows a message in the panel's place. `app.js` swaps the drop zone's `data-i18n-html` key to a handheld variant — `SansI18n.apply()` re-reads that attribute on every language switch, so the toggle keeps working with no change to `apply()` and no branch inside `t()`.

**Tech Stack:** Vanilla JS, no build step, no dependencies. Classic scripts for `lib/` and `app.js`, ES modules for `separate.js`. Tests are browser pages read via `window.__testResults`.

**Spec:** `docs/superpowers/specs/2026-08-21-handheld-separation-gate-design.md`

---

## Before you start

This project has **no npm and no CLI test runner**, and none may be added. Every test is a
browser page:

```bash
./scripts/serve.sh          # http://localhost:8777, leave running in its own terminal
```

Then open <http://localhost:8777/tests/test.html> and read the `<pre>`, or read
`window.__testResults` in the console. The page prints `N/N passed` at the end.

`serve.sh` sends `Cache-Control: no-store` deliberately — without it Chrome serves a stale
ES module after an edit and the test page silently checks the old code, which looks exactly
like a correct fix failing.

**Branch first.** Never commit to `main`:

```bash
git checkout main && git pull --ff-only
git checkout -b feat/handheld-gate
```

## File structure

| File | Change | Responsibility |
|---|---|---|
| `lib/platform.js` | **create** | One pure predicate: is this a phone or tablet? |
| `tests/platform.test.js` | **create** | Five cases against a fake window |
| `tests/test.html` | modify | Load `lib/platform.js`, import the new test module |
| `lib/i18n.js` | modify | Two new keys in both locales |
| `index.html` | modify | `#sep-handheld` line, `id` on the drop explain, `platform.js` tag |
| `app.js` | modify | Swap the drop zone's i18n key on a handheld |
| `separate.js` | modify | Gate the panel, fire the analytics event |
| `docs/behaviour.md` | modify | Amend S1, add S14–S16 |
| `docs/devlog.md` | modify | v1.8.0 entry + TL;DR row |

Tasks 1–6 keep every `?v=` at `1.7.0` so `tests/versions.test.js` passes at **every** commit.
Task 7 does the release bump to `1.8.0` in one clean commit.

---

### Task 1: The handheld predicate

**Files:**
- Create: `lib/platform.js`
- Create: `tests/platform.test.js`
- Modify: `tests/test.html`

- [ ] **Step 1: Write the failing test**

Create `tests/platform.test.js`:

```js
import { test, assertEq } from './assert.js';

const P = window.SansPlatform;

/* isHandheld is pure and takes the window to read, so nothing about the real browser needs
 * stubbing — the same trick that makes SansI18n.detectLocale(langs) testable. */
function fakeWin({ coarse = false, touchPoints = 0, noMatchMedia = false, noNavigator = false } = {}) {
  const w = {};
  if (!noMatchMedia) w.matchMedia = (q) => ({ matches: q === '(pointer: coarse)' && coarse });
  if (!noNavigator) w.navigator = { maxTouchPoints: touchPoints };
  return w;
}

test('platform: a coarse pointer AND multi-touch is a handheld', () => {
  assertEq(P.isHandheld(fakeWin({ coarse: true, touchPoints: 5 })), true);
});

test('platform: a fine pointer is not a handheld even with touch', () => {
  // A touchscreen laptop: touch present, but the primary pointer is a trackpad.
  assertEq(P.isHandheld(fakeWin({ coarse: false, touchPoints: 5 })), false);
});

test('platform: a coarse pointer without multi-touch is not a handheld', () => {
  // A TV or a kiosk remote.
  assertEq(P.isHandheld(fakeWin({ coarse: true, touchPoints: 0 })), false);
});

test('platform: no matchMedia is not a handheld', () => {
  assertEq(P.isHandheld(fakeWin({ coarse: true, touchPoints: 5, noMatchMedia: true })), false);
});

test('platform: no navigator is not a handheld', () => {
  assertEq(P.isHandheld(fakeWin({ coarse: true, touchPoints: 5, noNavigator: true })), false);
});
```

Wire it into `tests/test.html`. Add the script tag after `lib/analytics.js`:

```html
  <script src="../lib/analytics.js"></script>
  <script src="../lib/platform.js"></script>
```

and the import after `analytics.test.js`:

```js
    await import('./analytics.test.js');
    await import('./platform.test.js');
```

- [ ] **Step 2: Run the tests and verify the new ones fail**

Open <http://localhost:8777/tests/test.html>.

Expected: the five `platform:` tests FAIL with `Cannot read properties of undefined (reading 'isHandheld')` — `window.SansPlatform` does not exist yet. Every pre-existing test still passes.

- [ ] **Step 3: Write the implementation**

Create `lib/platform.js`:

```js
/* Which device class is this? Currently one question: is this a phone or a tablet, where
 * in-browser separation cannot run.
 *
 * Why separation is gated at all: on iOS 26.6 the FIRST session.run() kills the Safari tab
 * on every ORT runtime and execution provider tested, while ~1.9 GiB of WASM heap was
 * still available on the same device. The accumulators, the 285 MB model, the memory
 * floor, iOS's WebGPU backend and asyncify instrumentation were each ruled out by
 * measurement — see spike/RESULTS.md. What remains is the working set of one segment on a
 * fixed [1, 2, 343980] input, and N_SAMPLES is baked into the ONNX graph, so nothing in
 * this repo can shrink it.
 *
 * The test is capability-shaped, not vendor-shaped. Android phones are untested and very
 * likely fail the same way, and iPadOS reports itself as a Mac — any /iPhone|iPad/ test
 * would miss it entirely.
 *
 * Classic script, not ESM, for the same reason lib/stems.js is: app.js (classic) and
 * separate.js (module) both need it, and the ESM migration is a separate change. */
(function (global) {
  'use strict';

  /**
   * True for a phone or tablet. BOTH conditions are required: a coarse primary pointer
   * alone matches a TV, and maxTouchPoints > 1 alone matches a touchscreen desktop.
   *
   * PURE — it reads the window you hand it, so the whole truth table can be unit-tested
   * without stubbing the real navigator. Same shape as SansI18n.detectLocale(langs).
   * @param {Window} [win] defaults to the real window
   * @returns {boolean}
   */
  function isHandheld(win) {
    const w = win || global;
    const coarse = !!(w.matchMedia && w.matchMedia('(pointer: coarse)').matches);
    const touch = !!(w.navigator && w.navigator.maxTouchPoints > 1);
    return coarse && touch;
  }

  global.SansPlatform = { isHandheld };
})(window);
```

- [ ] **Step 4: Run the tests and verify they pass**

Reload <http://localhost:8777/tests/test.html>.

Expected: all five `platform:` tests PASS, total count up by 5, `0` failures.

- [ ] **Step 5: Commit**

```bash
git add lib/platform.js tests/platform.test.js tests/test.html
git commit -m "feat: a pure handheld predicate

Coarse primary pointer AND maxTouchPoints > 1. Both are required: coarse alone
matches a TV, multi-touch alone matches a touchscreen desktop.

Capability-shaped rather than a UA test, because Android phones are untested and
very likely fail separation the same way iOS does, and iPadOS reports itself as a
Mac so /iPhone|iPad/ would miss it entirely.

Pure and parameterised like SansI18n.detectLocale, so the truth table unit-tests
against a fake window with no navigator stubbing."
```

---

### Task 2: The two new strings

**Files:**
- Modify: `lib/i18n.js` (zh-TW block near line 30, en block near line 114, plus the `sep.*` blocks)

- [ ] **Step 1: Add both keys to the zh-TW dictionary**

After the `'drop.explain'` line in the zh-TW block, add:

```js
      'drop.explainHandheld': '<strong>音訊檔</strong>：會以單一軌道播放。<br/><strong>分軌.zip</strong>：音軌已分離的 zip 檔。分離功能需要電腦。',
```

After the `'sep.cancel'` line in the zh-TW block, add:

```js
      'sep.handheld': '分離功能需要電腦。在電腦上分離後，把 .zip 載入這裡即可。',
```

- [ ] **Step 2: Add both keys to the en dictionary**

After the `'drop.explain'` line in the en block, add:

```js
      'drop.explainHandheld': '<strong>One audio file</strong> — a whole song — plays as a single track. <strong>A .zip</strong> of stems already separated loads them as one lane each. Separating stems needs a computer.',
```

After the `'sep.cancel'` line in the en block, add:

```js
      'sep.handheld': 'Separating stems needs a computer. Separate there, then load the .zip here.',
```

- [ ] **Step 3: Run the tests**

Reload <http://localhost:8777/tests/test.html>.

Expected: `0` failures. In particular `i18n: both locales define exactly the same keys` and
`i18n: no value is empty` must pass — they are what catches a key added to one locale only.

Deliberately add the key to only one locale for a moment and reload if you want to see the
guard work; then put it back.

- [ ] **Step 4: Commit**

```bash
git add lib/i18n.js
git commit -m "i18n: strings for the handheld separation gate

Neither string mentions iOS, matching a gate that is capability-shaped rather than
vendor-shaped — the same message is right for an Android phone.

drop.explainHandheld drops only the 'right here in the browser' clause; the rest of
the drop zone copy is unchanged, so the two variants stay easy to diff."
```

---

### Task 3: Markup

**Files:**
- Modify: `index.html` (line 57, the `#sep` section near line 104, the script block at the end)

- [ ] **Step 1: Give the drop explanation an id**

Change line 57 from:

```html
    <p class="dim" data-i18n-html="drop.explain"><strong>One audio file</strong> &mdash; a whole song &mdash; plays as a single track,
```

to:

```html
    <p id="drop-explain" class="dim" data-i18n-html="drop.explain"><strong>One audio file</strong> &mdash; a whole song &mdash; plays as a single track,
```

Leave the rest of the paragraph untouched.

- [ ] **Step 2: Add the handheld line inside the separation panel**

In the `<section id="sep" class="sep" hidden>` block, add this as the **first** child, before `<div class="sep-row">`:

```html
      <!-- Shown instead of the controls on a phone or tablet, where the first
           session.run() kills the tab. See lib/platform.js and spike/RESULTS.md.
           The literal English matches DICT.en exactly, like every other string here —
           it is the no-JS fallback and the readable source of truth. -->
      <p id="sep-handheld" class="dim" hidden data-i18n="sep.handheld">Separating stems needs a computer. Separate there, then load the .zip here.</p>
```

- [ ] **Step 3: Load the new script before app.js**

In the script block at the end of `<body>`, add `lib/platform.js` **before** `app.js` —
`app.js` calls `isHandheld()` during parse, so `SansPlatform` must already exist:

```html
<script src="lib/stems.js?v=1.7.0"></script>
<script src="lib/unzip.js?v=1.7.0"></script>
<script src="lib/analytics.js?v=1.7.0"></script>
<script src="lib/platform.js?v=1.7.0"></script>
<script src="app.js?v=1.7.0"></script>
<script type="module" src="separate.js?v=1.7.0"></script>
```

Also update the comment above that block: it says "Bump the version in ALL of these on
release: index.html (7)". It is now **8**.

- [ ] **Step 4: Run the tests**

Reload <http://localhost:8777/tests/test.html>.

Expected: `0` failures. Two tests specifically cover this step —
`versions: every local asset URL carries a ?v=` (the new tag must have one) and
`i18n: every key used in index.html exists in both locales` (it scans `data-i18n`
attributes, so `sep.handheld` is now checked).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "ui: markup for the handheld separation gate

The explanation lives inside #sep rather than replacing it, so the panel keeps its
existing show/hide rule — it appears for a single unseparated song and nowhere else.
Only its contents differ by device.

lib/platform.js loads before app.js because app.js calls isHandheld() during parse."
```

---

### Task 4: Swap the drop zone key on a handheld

**Files:**
- Modify: `app.js` (insert after line 56, the `gcBump` definition)

- [ ] **Step 1: Add the swap**

`app.js` already defines `gcTrack`, `gcOnce` and `gcBump` at lines 54–56. Insert directly
after line 56, before the `laneLabel` comment block:

```js

/* The drop zone promises that a song "can be split into six stems right here in the
 * browser". On a phone that is false — see lib/platform.js. Swap the KEY rather than the
 * text: SansI18n.apply() re-reads data-i18n-html from the element on every run, so the
 * language toggle keeps working for free and t() needs no branch.
 *
 * app.js is a classic script at the end of <body>, so this runs during parse — before
 * DOMContentLoaded, and therefore before apply() first walks the document. */
if (window.SansPlatform?.isHandheld()) {
  const explain = document.getElementById('drop-explain');
  if (explain) explain.setAttribute('data-i18n-html', 'drop.explainHandheld');
}
```

The `?.` and the `if (explain)` are the same defensive posture as `on()` and `gcTrack`
above: a missing script or a renamed element must degrade, never throw. A throw here lands
in `app.js`'s flat run of top-level statements and silently kills every listener below it —
the v1.4.0 failure mode.

- [ ] **Step 2: Verify on desktop that nothing changed**

Open <http://localhost:8777/> in a normal desktop browser.

Expected: the drop zone reads exactly as before, mentioning in-browser separation. The
swap must not fire on a machine with a fine pointer.

- [ ] **Step 3: Verify the handheld branch by fault injection**

Handhelds cannot be driven from browser automation, so emulate one. Open DevTools, toggle
device emulation (**Cmd-Shift-M**), pick **iPhone 15 Pro**, then **reload**.

Emulation is what you want here rather than monkey-patching `SansPlatform.isHandheld`: the
swap runs during parse, so it has already happened by the time a console command could
change anything, and a reload restores the real function. Emulation sets `pointer: coarse`
and `maxTouchPoints` before the page runs, which is the real code path.

Expected: the drop zone no longer claims in-browser separation. Switch language with the
中文 / EN toggle — the handheld wording must follow, in both directions.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "ui: drop zone stops promising in-browser separation on a handheld

Swaps the i18n KEY on the element, not the text. SansI18n.apply() re-reads
data-i18n-html on every run, so the language toggle keeps working with no change to
apply() and no branch inside t() — which would have made one key mean two strings
and muddied the same-keys-in-both-locales test.

Runs during parse, before apply() first walks the document."
```

---

### Task 5: Gate the panel and count it

**Files:**
- Modify: `separate.js` (the `el` object near line 7, the `gcTrack` helper near line 30, `refresh()` near line 74, the init at the end of the file)

- [ ] **Step 1: Add the element and the gate**

Add `handheld` to the `el` object:

```js
const el = {
  panel:  document.getElementById('sep'),
  go:     document.getElementById('sep-go'),
  save:   document.getElementById('sep-save'),
  cancel: document.getElementById('sep-cancel'),
  status: document.getElementById('sep-status'),
  bar:    document.getElementById('sep-bar'),
  fill:   document.getElementById('sep-fill'),
  handheld: document.getElementById('sep-handheld'),
};
```

Directly after the `el` object, add:

```js
/* Separation cannot run on a phone or tablet — the first session.run() kills the tab. See
 * lib/platform.js for the evidence. Read once: the answer cannot change within a page
 * load, and refresh() runs every 400 ms. */
const HANDHELD = window.SansPlatform?.isHandheld() ?? false;
```

- [ ] **Step 2: Add a `once` analytics helper**

`separate.js` has only `gcTrack`. Add `gcOnce` directly beneath it:

```js
const gcTrack = (n) => { try { window.SansAnalytics?.track(n); } catch (e) { /* never */ } };
const gcOnce  = (n) => { try { window.SansAnalytics?.once(n);  } catch (e) { /* never */ } };
```

- [ ] **Step 3: Gate `refresh()`**

Add the early return as the first thing in `refresh()`:

```js
function refresh() {
  if (HANDHELD) {
    // Same visibility rule as below — the panel belongs to a single unseparated song —
    // but its contents are the explanation, and the controls never come back.
    const single = window.sansBass?.isSingleTrack?.();
    el.panel.hidden = !single;
    // once(), not track(): refresh() runs on a 400 ms interval and track() would fire all
    // session. This counts visitors who were shown the message, exactly once each.
    if (single) gcOnce('separate-handheld-blocked');
    return;
  }

  const single = window.sansBass?.isSingleTrack?.();
  ...rest of the existing body, unchanged...
}
```

- [ ] **Step 4: Hide the controls at init**

At the very end of the file, replace:

```js
setInterval(refresh, 400);
refresh();
```

with:

```js
if (HANDHELD) {
  el.handheld.hidden = false;
  // #sep-go is the only control the markup leaves visible; save, cancel and the progress
  // bar already start hidden. styles.css carries the global
  // [hidden] { display: none !important } that this depends on.
  el.go.hidden = true;
}

setInterval(refresh, 400);
refresh();
```

- [ ] **Step 5: Verify on desktop that nothing changed**

Open <http://localhost:8777/>, load any single audio file.

Expected: the **Separate into 6 stems** button appears exactly as before, and separation
still runs. This task must be invisible on a desktop.

- [ ] **Step 6: Verify the handheld branch**

With DevTools device emulation on ("iPhone 15 Pro"), reload and load a single audio file.

Expected: `#sep` appears containing only the sentence. In the console, all four controls
must be *computed* as hidden — check `display`, never `.hidden`, because a class that sets
`display` beats the `hidden` attribute and has bitten this project before:

```js
['sep-go','sep-save','sep-cancel','sep-bar'].map(
  (id) => [id, getComputedStyle(document.getElementById(id)).display]);
```

Expected: every entry `"none"`.

And confirm the event fires exactly once:

```js
SansAnalytics.setSink(console.log);   // GoatCounter filters localhost, so use a sink
```

Expected: `separate-handheld-blocked` logged once, and not again after several seconds of
the 400 ms poll.

- [ ] **Step 7: Commit**

```bash
git add separate.js
git commit -m "feat: hide separation on a handheld, show why instead

The panel keeps its existing rule — it belongs to a single unseparated song — but on
a phone or tablet it holds only the explanation and the controls never appear.

once(), not track(): refresh() runs on a 400 ms interval, so track() would count the
same visitor all session. once() is the 'did this visitor ever reach X' verb.

HANDHELD is read once at module init because the answer cannot change within a page
load and refresh() runs 2.5 times a second."
```

---

### Task 6: Document the behaviour

**Files:**
- Modify: `docs/behaviour.md` (the S-row table, currently S1–S13)

- [ ] **Step 1: Amend S1**

S1 currently reads:

> | S1 | The panel appears only for a single unseparated track. A stems folder loaded from disk shows no panel. | Computed `display` of `#sep`. |

Replace with:

```markdown
| S1 | The panel appears only for a single unseparated track. A stems folder loaded from disk shows no panel. On a handheld the same rule holds, but the panel's *contents* are the explanation — see S14. | Computed `display` of `#sep`. |
```

- [ ] **Step 2: Add S14–S16 after S13**

```markdown
| S14 | On a handheld, a loaded single song shows `#sep` containing only the explanation. **Separate**, **Save**, **Cancel** and the progress bar are all gone. | Computed `display` of all four must be `none`. Never `.hidden` — a class that sets `display` beats the attribute, and that has already cost this project a debugging session. |
| S15 | On a handheld the drop zone makes no in-browser-separation promise. | `#drop-explain` renders `drop.explainHandheld`, not `drop.explain`. |
| S16 | Both handheld strings follow the language toggle like every other string. | Switch locale with a song loaded; the panel line and the drop zone must both re-render. |
```

- [ ] **Step 3: Note how these are verified**

Handhelds are not reachable from browser automation. Add a line to the section's preamble,
alongside however the file already frames verification:

```markdown
S14–S16 are verified two ways, because a real handheld cannot be driven from automation:
`isHandheld(fakeWindow)` covers the predicate's truth table in `tests/platform.test.js`,
and DevTools device emulation plus one manual pass on a real phone against the PR preview
covers the DOM. This is the same fault-injection approach the project already uses for
`file://`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/behaviour.md
git commit -m "docs: behaviour rows for the handheld separation gate

S14-S16, and S1 amended — the panel's visibility rule is unchanged, only its
contents differ by device.

Each row names computed display rather than .hidden, because that distinction is
what made the v1.6.0 hidden-toggle bug invisible to verification."
```

---

### Task 7: Release version bump to v1.8.0

Tasks 1–6 deliberately left every `?v=` at `1.7.0` so `tests/versions.test.js` passed at
each commit. Now move them together.

**Files:**
- Modify: `index.html` (8 URLs), `separate.js` (3 URLs), `separate.worker.js` (1 URL)

- [ ] **Step 1: Bump all three files**

```bash
sed -i '' 's/?v=1\.7\.0/?v=1.8.0/g' index.html separate.js separate.worker.js
```

- [ ] **Step 2: Verify the count**

```bash
grep -c "?v=1.8.0" index.html separate.js separate.worker.js
```

Expected exactly:

```
index.html:8
separate.js:3
separate.worker.js:1
```

And no stragglers:

```bash
grep -rn "?v=1.7.0" index.html separate.js separate.worker.js || echo "none left"
```

Expected: `none left`.

- [ ] **Step 3: Run the tests**

Reload <http://localhost:8777/tests/test.html>.

Expected: `0` failures, and specifically `versions: all three files agree on one version`
passes. That test reads the shipped files over HTTP, so it checks what the browser actually
gets rather than a constant.

- [ ] **Step 4: Commit**

```bash
git add index.html separate.js separate.worker.js
git commit -m "chore: bump every asset URL to v1.8.0

index.html now carries 8 versioned URLs rather than 7 — lib/platform.js joined the
block. GitHub Pages pins everything to max-age=600 with no way to override it, so a
returning visitor can run a stale app.js against fresh markup for ten minutes; that
is a dead page, not a degraded one."
```

---

### Task 8: Verify on a real phone, then write the devlog

**Files:**
- Modify: `docs/devlog.md`

- [ ] **Step 1: Open the PR**

```bash
git push -u origin feat/handheld-gate
gh pr create --title "Hide separation on handhelds (v1.8.0)" --body "See docs/superpowers/specs/2026-08-21-handheld-separation-gate-design.md"
```

Wait for the **PR preview** workflow and check its *conclusion*, not that it ran — two
workflows sharing a concurrency group let GitHub cancel one as "pending", and the v1.2.0
merge deployed nothing while reporting no failure anywhere:

```bash
gh run list --branch feat/handheld-gate --limit 3
```

- [ ] **Step 2: Verify on the phone**

Open `https://sansword.github.io/sans_bass/pr-<N>/` on the iPhone. GitHub Pages caches for
ten minutes; if the page looks unchanged, wait and reload rather than assuming a bad deploy.

Confirm, in order:

1. The drop zone does **not** promise in-browser separation.
2. Load a song — it plays, and where **分離成 6 軌** used to be there is now the sentence
   `分離功能需要電腦。在電腦上分離後，把 .zip 載入這裡即可。`
3. There is no tappable Separate control anywhere.
4. Switch to EN — both the drop zone and the panel line follow.
5. Load a stems `.zip` — six lanes, playback and A–B repeat all still work.

- [ ] **Step 3: Write the devlog entry**

Newest-first, at the top of the entries in `docs/devlog.md`. Get the timestamp from
`git log` on the final commit:

```markdown
## v1.8.0 — separation is a desktop feature (YYYY-MM-DD HH:MM)

**Review:** not yet

**Design docs:**
- Handheld separation gate: [Spec](superpowers/specs/2026-08-21-handheld-separation-gate-design.md) [Plan](superpowers/plans/2026-08-21-handheld-separation-gate.md)

**What was built:**
- `lib/platform.js` — a pure `isHandheld(win)` predicate, coarse pointer AND multi-touch.
- The separation panel now holds one sentence instead of four controls on a phone or tablet.
- The drop zone stops promising in-browser separation there.
- `separate-handheld-blocked`, fired with `once()`.

**Key technical learnings:**
- `[gotcha]` **Forcing `executionProviders: ['wasm']` does not change the ORT runtime binary.** `ort.webgpu.bundle.min.mjs` loads the asyncify-instrumented `ort-wasm-simd-threaded.asyncify.wasm` (24.3 MB) whatever provider you name; the plain 13.5 MB binary only ships with `ort.wasm.bundle.min.mjs`. Three rounds of "we tested WASM" were never true.
- `[insight]` **iOS separation dies at the first `session.run()`, and it is not memory capacity.** A live session idles happily, and the same device committed 1920 MiB of WASM heap. The accumulators, the model, the memory floor, WebGPU and asyncify were each ruled out by measurement. `N_SAMPLES = 343980` is baked into the ONNX graph, so nothing in this repo can shrink the working set.
- `[insight]` **Swapping an i18n *key* on the element beats branching inside `t()`.** `SansI18n.apply()` re-reads `data-i18n-html` on every run, so the language toggle keeps working for free and no key ever means two strings.
- `[gotcha]` **`track()` inside `refresh()` would fire all session** — that function runs on a 400 ms interval. `once()` is the verb for "did this visitor ever reach X".
- `[note]` Safari's Web Inspector memory graph does not show the WebKit GPU process at all, which is why the first crash looked like a WebContent problem for three rounds.

**Process learnings:**
- `[insight]` **The user's own observation broke the investigation open.** "It crashes even on a 30-second clip" falsified a memory-scaling theory that two rounds of arithmetic had made look solid. Cheap evidence from the person holding the device beat confident reasoning.
- `[gotcha]` **Running the destructive probe first poisoned the next measurement.** A 1.9 GiB allocation ladder immediately before an inference probe left the phone under memory pressure; the result had to be thrown away and re-run after a force-quit.
```

Then add the TL;DR row at the top table, linking to the anchor:

```markdown
| [v1.8.0](#v180--separation-is-a-desktop-feature-yyyy-mm-dd-hhmm) | Separation hidden on phones and tablets, with an honest message; the crash is unfixable from this repo. |
```

Match the anchor to the heading exactly: lowercase, punctuation stripped, spaces to hyphens.

- [ ] **Step 4: Commit and push**

```bash
git add docs/devlog.md
git commit -m "docs: devlog for v1.8.0"
git push
```

---

## Definition of done

- [ ] `tests/test.html` reports `0` failures, with 5 more tests than before
- [ ] Desktop behaviour is completely unchanged — Separate still appears and still works
- [ ] On a real iPhone: no Separate control, the explanation shows, both locales correct
- [ ] Zip loading and playback still work on the phone
- [ ] `grep -rn "?v=1.7.0" index.html separate.js separate.worker.js` finds nothing
- [ ] `docs/behaviour.md` carries S14–S16 and the amended S1
- [ ] `docs/devlog.md` has the v1.8.0 entry and its TL;DR row
- [ ] The PR preview workflow's **conclusion** is `success`

## Not in scope

Do not attempt to make separation work on a handheld — the spike ruled that out by
measurement. Do not touch `separate.worker.js` beyond the version bump, `lib/overlap.js`,
or anything in the playback path.
