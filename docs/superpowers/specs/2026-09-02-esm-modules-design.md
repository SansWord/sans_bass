# ESM modules: app.js + classic-script lib/*.js → real import/export

## Why

The npm + Vite migration (v1.20.0) switched every `<script>` tag that needed bundling to
`type="module"`, because Vite's HTML plugin only bundles and content-hashes a script tag
carrying that attribute. It deliberately did **not** touch the *content* of those files —
`app.js` and the classic-script `lib/*.js` files are still `(function (global) {...})(window)`
IIFEs assigning `window.SansX`, with zero `import`/`export`. That was flagged as deferred
work in [`docs/roadmap.md`](../../roadmap.md), "Migrate to npm + a build step" → "Still
wanted". This spec is that deferred work.

## Scope

**Convert to real ES modules:** `app.js` and these 8 files —
`lib/stems.js`, `lib/i18n.js`, `lib/platform.js`, `lib/unzip.js`, `lib/ribbon.js`,
`lib/jianpu.js`, `lib/transport-math.js`, `lib/analytics.js`.

**Out of scope, do not touch:** `separate.js`, `notes.js`, and the lib files already under
them (`wav.js`, `zip.js`, `overlap.js`, `pitch.js`, `sonify.js`, `tempo.js`,
`stretch-processor.js`) — already real ESM. `window.sansBass` (app.js's export consumed by
those two) and `window.SansPitch` (`lib/pitch.js`'s export consumed by app.js) are the
intentional public boundaries between this conversion and that already-ESM code; neither
changes.

**Non-goal:** no change to app behavior. 267 unit tests and the manual verification pass
(playback, mute, A-B loop, speed, separation, notes) must pass identically in both
`npm run dev` and `npm run build` + `npm run preview`.

## The dependency map

Reading every current cross-reference (`window.Sans*` reads across app.js, separate.js,
notes.js, tests/*.test.js, tests/notes.html, and lib-to-lib reads inside the 8 files):

| Lib | Read by app.js | Read by separate.js/notes.js (out of scope) | Read by lib-to-lib |
|---|---|---|---|
| `stems.js` | yes (destructured) | no | `unzip.js` reads `AUDIO_RE` |
| `i18n.js` | yes | yes — both, `t()` | — |
| `platform.js` | yes | yes — separate.js, `isHandheld()` | — |
| `unzip.js` | yes (`extract`) | no | — |
| `ribbon.js` | yes | no (only `tests/notes.html`, a test harness) | — |
| `jianpu.js` | yes | yes — notes.js, `referenceOctave`/`degreeToken` | — |
| `transport-math.js` | yes | no | — |
| `analytics.js` | yes (optional) | yes — separate.js, `track`/`once` (optional) | — |

Four files — `i18n.js`, `platform.js`, `analytics.js`, `jianpu.js` — have a real consumer
outside this conversion's scope that can only reach them through `window`. The other four —
`stems.js`, `unzip.js`, `ribbon.js`, `transport-math.js` — do not.

## Design

### 1. Export shape, per file

Every file drops its `(function (global) {...})(window)` (or, for `transport-math.js`, its
`window.SansTransportMath = (function () {...})()`) wrapper. Every current member of the
`window.SansX` object becomes a top-level `export const` / `export function`. No function
body changes.

**`i18n.js`, `platform.js`, `analytics.js`, `jianpu.js` additionally keep:**
```js
// Bridge for separate.js/notes.js (out of scope for this refactor, already ESM, still read
// this via window) — not part of this module's own design.
window.SansX = { ...same members as today... };
```

**`stems.js`, `unzip.js`, `ribbon.js`, `transport-math.js` drop the global entirely** — pure
exports, nothing assigned to `window`. Nothing outside this conversion reads them once tests
switch to importing directly (§5).

A module's public surface is its exports. A global read is invisible to every tool that
works off the import graph (bundler, type-checker, "find usages"), and a global nobody reads
is speculative surface kept on the chance a future consumer wants it — the same
hypothetical-future-requirement the project's own conventions say not to design for. The
bridge on the 4 files is a deliberate, narrow, commented exception for two specific
out-of-scope files, not a default kept for uniformity.

### 2. Cross-lib dependency

`lib/unzip.js` currently reads `global.SansStems.AUDIO_RE`. Becomes:
```js
import { AUDIO_RE } from './stems.js';
```

### 3. app.js's own imports

Every current `window.SansX` read in app.js (47 occurrences) becomes a real static import.
This includes `analytics.js` and `platform.js`, which app.js currently reads defensively
(`window.SansAnalytics?.track(n)`, `window.SansPlatform?.isHandheld()`) so that a script
which 404s independently in dev mode degrades to a no-op instead of crashing app.js. A
static import can't be conditional — if it fails, app.js's whole module fails to evaluate.
This is an accepted, disclosed trade-off: production already bundles everything into one
atomic chunk (per the npm+Vite migration), so this scenario is already impossible there
today; only dev-mode-only robustness for these two files is being traded for a real import
graph.

Import style is chosen per how each lib is already called at its use sites, to keep the
diff mechanical:

- `lib/stems.js`: named import matching the existing destructure —
  `import { STEMS, EXTRA_COLORS, AUDIO_RE, detectStem, assignStems, hasMixPlusStems } from
  './lib/stems.js';` (app.js:6 today). Zero call-site changes elsewhere in the file.
- `lib/unzip.js`: `import { extract } from './lib/unzip.js';`
- `lib/i18n.js`, `lib/platform.js`, `lib/analytics.js`, `lib/ribbon.js`, `lib/jianpu.js`,
  `lib/transport-math.js`: namespace imports — `import * as SansI18n from './lib/i18n.js';`
  etc. Every call site becomes a mechanical `window.SansX.` → `SansX.` find-replace.

  Namespace imports specifically avoid a real hazard: `i18n.js` exports a function named
  `t`, and app.js already uses `t` everywhere as a loop variable for "track"
  (`tracks.find((t) => ...)`). A destructured `import { t }` would still work (a local
  param shadows the module-level binding), but reads as a landmine to the next person in
  the file. `SansI18n.t(...)` keeps the existing `tr()` wrapper's meaning obvious, and
  matches how every call site already reads today (`window.SansI18n.t(...)`).

**Cleanup that falls out of this:** app.js has two guards that check `window.SansRibbon` /
`window.SansJianpu` truthiness before using them (around line 1301 and line 2140),
deliberately protecting "optional decoration" call sites against a script that failed to
load — see the comment at line ~2140: *"Guarded on the library, not just on duration...
A stale-cache mismatch that drops one script must not take seeking away."* Once these are
static imports, that guard is unreachable-false: if the import had failed, app.js's module
would never have evaluated far enough to run the check at all. Drop the
`&& window.SansRibbon` / `|| !window.SansJianpu` clauses; keep the rest of each condition
(`duration &&` / `!jianpu || !jianpu.on`) exactly as-is — those guard real, still-live
states.

`window.SansPitch` (line 2905) and the `window.sansBass = {...}` export (line 3237) are
untouched — outside this conversion's boundary.

### 4. index.html — no changes

The 8 `<script type="module" src="lib/*.js">` tags in `<body>` and the
`<script type="module">window.SansI18n.init();</script>` in `<head>` stay exactly as they
are.

Why this is safe: ES modules are singletons keyed by resolved URL. app.js importing the
same files these tags already load causes no duplicate evaluation and no second network
request under the module cache. Execution order is spec-guaranteed, not a document-order
coincidence this project happened to rely on: per the HTML spec, a module script's
dependency subgraph evaluates before its own top-level body runs, and independent top-level
module scripts still execute in relative document order. Concretely:

- The head's `init()` call still runs after `lib/i18n.js`'s own script tag has evaluated
  (unchanged relative order), so `window.SansI18n` exists when `init()` is called.
- app.js's imports (§3) force `i18n.js`, `platform.js`, `analytics.js`, `jianpu.js`, etc. to
  be evaluated before app.js's own top-level code runs — before app.js's script tag's
  position in the document, which precedes separate.js and notes.js. So the `window.SansX`
  bridges those two files read are guaranteed populated by the time they run, exactly as
  today.

This is verified directly (§7), not just reasoned about — it's the one item in this
refactor where a wrong assumption would fail silently rather than throw.

### 5. Tests

The 7 named test files — `tests/i18n.test.js`, `tests/stems.test.js`,
`tests/platform.test.js`, `tests/analytics.test.js`, `tests/ribbon.test.js`,
`tests/jianpu.test.js`, `tests/transport-math.test.js` — plus `tests/unzip.test.js` switch
from reading `window.SansX` to importing the real exports directly. This is the idiomatic
choice now that there's something real to import, and it stops every test depending on
`<script>` tag order in `tests/test.html`.

`i18n.test.js`, `platform.test.js`, `analytics.test.js`, and `jianpu.test.js` each gain one
small additional assertion: that `window.SansX` still exists and its members still match the
real exports. This is regression insurance for the bridge in §1 — cheap protection against
someone deleting it later and silently breaking separate.js/notes.js, which have no test
coverage of their own for this.

`tests/i18n.test.js` reads `window.SansStems` as well as `window.SansI18n` (it checks that
translated labels never rename a stem id) — it gains an import from `lib/stems.js`
alongside its `lib/i18n.js` import.

`tests/test.html`'s 8 `<script type="module" src="../lib/*.js">` tags become redundant once
every test file imports directly (module singleton semantics mean the import alone is
sufficient to load and evaluate each file) — removed.

`tests/notes.html` reads `window.SansRibbon` via its own separate
`<script src="../lib/ribbon.js">` tag and an inline module script. Not one of the 7 named
test files, but the same shape: converts to
`import * as SansRibbon from '../lib/ribbon.js'` alongside its existing `pitch.js`/
`sonify.js` imports; the separate script tag is dropped.

`tests/parity.html` does not reference any of the 8 files — no changes needed there.

### 6. Docs, same commits

- `CLAUDE.md`: update the repo-layout table and architecture-notes prose that currently
  calls these files "classic script" / describes the `window.SansX` pattern.
- `docs/roadmap.md`: mark the "Migrate to npm + a build step" entry's "Still wanted" item as
  built, same pattern as the entry's own `**Built in vX.Y.0**` line.
- `docs/devlog.md`: new version entry, tagged learnings (`[note]`/`[insight]`/`[gotcha]`),
  TL;DR table row with an anchor link.

## Risks, and how this design addresses each

- **Execution order** (index.html's `init()` and the separate.js/notes.js bridge
  timing) — addressed in §4; verified in §7, not just reasoned about.
- **Tree-shaking silently dropping a module** — every module in this conversion is either
  (a) statically imported by app.js for real use (§3), (b) statically imported by a test
  file (§5), or (c) still reached via its own `<script type="module" src="...">` entry in
  `index.html`/`tests/test.html`/`tests/notes.html`, which Vite treats as its own bundle
  entry point regardless of whether anything imports it. No file in scope depends solely on
  a side-effect-only bare import (`import './lib/x.js'` with nothing used) for its inclusion
  — the one place that pattern would have been needed (analytics.js, if app.js only read it
  via `window`) is moot because app.js now imports it directly for real use (§3, per the
  fail-soft decision).
- **Test harness access pattern** — resolved in §5: tests import directly; the 4 files with
  no out-of-scope consumer lose the global entirely, so a test importing them is the only
  way to reach them at all (verifying the global's absence is implicit in this — a stale
  test reading `window.SansStems` would simply fail).

## Verification

7. **Manual pass, once, at the end** — not per-task. `npm run dev`: confirm the page boots
   with translated text visible before the first paint (i18n order), then exercise playback,
   mute, A-B loop, speed, in-browser separation, and notes (separate.js/notes.js still work
   against the bridged globals). Repeat against `npm run build` + `npm run preview` for
   production-parity. Run the full `tests/test.html` suite (267 tests today) in both modes
   and confirm identical pass count.
