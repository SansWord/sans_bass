# React migration evidence

## Phase 0 — automated, ownership, visual and local-build baseline

Status: phase-0 baseline recorded locally, with the omissions below. No React migration
or release parity is claimed. Slice 0a recorded the automated/ownership baseline; slice 0b
added browser evidence and simplified progress reporting.
Evidence collected 2026-09-05 UTC (2026-09-04 evening America/Los_Angeles).
Source: `9636b06c2e64bc1eafd82582c42ac3f1ae0b2f19`; branch
`docs/react-phase-0-baseline`. The pre-existing untracked `demo.md` is outside this slice.
No production ownership transfer, React dependency, or product behaviour change.

### Bounded plan

1. Record the unchanged suite/build and inspect the first migration boundaries.
2. Inventory current DOM, state, event, and lifetime owners from source.
3. Add missing non-rendering header assertions in jsdom; retain existing storage and
   browser audio/canvas assertions without duplicating them.
4. Capture representative screens and local-build/milestone measurements, record omissions,
   and hand off the isolated demo pilot. LOC tracking was dropped following user feedback.

### Automated and build evidence

Environment: macOS 26.6.2 (25G83), Node v26.7.0, npm 11.19.0,
Vitest 4.1.11, Vite 8.2.2; installed Playwright headless Chromium provider.

| Revision / command | Result |
|---|---|
| Unchanged source: `npm test` | 29 files, 379 tests passed, 1.79 s |
| Unchanged source: `npm run build` | Passed; 42 modules transformed, Vite reported 96 ms; one demo generated |
| Slice: `npx vitest run --project jsdom tests/header.test.js` | 1 file, 2 tests passed |
| Slice final: `npm test` | 30 files, 381 tests passed, 1.99 s |
| Slice final: `npm run build` | Passed; same worklet warning, 42 modules, 100 ms |
| Slice final: `git diff --check` | Passed |

The first sandboxed suite attempt passed 326 Node/jsdom tests but could not bind the
browser server (`listen EPERM ::1`). Retrying with local-server permission passed the full
suite. This was an environment restriction, not a baseline application failure.
The targeted jsdom run emitted Node's experimental localStorage warning.

Existing build warning: `new URL('./stretch-processor.js', import.meta.url)` is unresolved
at build time. `vite.config.js` deliberately emits `assets/stretch-processor.js` as a
separate bundled entry. Build success alone does not verify runtime worklet loading.
No failing automated product assertion was observed.

Emitted JS baseline: **178,369 bytes** across all 11 `dist/assets/*.js` files, including
Worker/worklet and test-page chunks; this is total emitted JS, not startup transfer size.
Main chunk 100,280 bytes; shared header chunk 29,439 bytes; demo chunk 319 bytes.
Reproduce after `npm run build` with Python 3:

```python
from pathlib import Path
files = sorted(Path('dist/assets').glob('*.js'))
for file in files:
    print(file.name, file.stat().st_size)
print('total', sum(file.stat().st_size for file in files))
```

### Current ownership map

Line references and named regions below refer to the source commit above. They are an
inventory, not a proposed wholesale extraction.

| Region / state | Authoritative current owner | Initialization and migration seam |
|---|---|---|
| Player static shell, loadzone/input, transport, separation and notes markup | `index.html` authors nodes; runtime owners below update them | Inline i18n init plus module entries. Preserve startup order and existing IDs until each owner transfers. |
| Header navigation, language button listeners/pressed state | `lib/header.js:initHeader` | Eager call at `app.js:23`; replaces header markup but moves the existing `.loadzone` and input back. `dataset.ready` prevents repeat initialization of the same node; no disposer. |
| File selection, drop overlay, loading/status/title | `app.js:loading`, `say`, input section | Module-init `el` captures input/controls/canvas at lines 148–160. Change handler clears input value before `loadAny`. Document drop listeners accept/reject input. Header does not own decoding. |
| Audio clock, decoded tracks, gains, transport, loop, rate, routing | `app.js:state`, loading, transport, A-B repeat, routing | Module singleton; AudioContext lazily created at 44100 Hz. Sources/worklets follow playback lifecycle, `playGen` guards stale play work. No application-wide mount/dispose API. |
| Lane/overview/zoom DOM and canvas references | `app.js:buildUI`, render/paint functions, input handlers | Song rebuild replaces lane nodes and clears song caches. `mainWave` captured eagerly; dynamic canvas refs retained in track/notes/zoom state. rAF draws; native audio owns loop/end. |
| Selection, editor toolbar, canvas gestures, shortcuts | `app.js:input`, `syncEditToolbar`, `syncNoteFields` | Document keydown plus per-canvas pointer/wheel handlers. Focus exclusions protect editable fields. No second keyboard owner should be added during migration. |
| Notes frames, interpretation, edit groups, sonifiers | `notes.js:createNotesChannel` (vocals and bass) | Eager control lookup and listeners; lazy per-channel Workers. Reset stops sonifier, terminates worker, clears analysis/edits. `refreshAll` polls every 400 ms; buffer identity determines analysed-song changes. |
| Shared tempo, chord timeline/corrections, capo, edit import/export | `notes.js` shared regions | Songload resets tempo; chord detection uses a delayed callback and waits for running channels. Tempo re-detection creates its own Worker. Player receives presentation state through events. |
| Separation controls, phase/progress, saved results, Worker | `separate.js` | Eager DOM captures and handheld predicate; lazy reusable Worker, cancel message, error/result handlers; 400 ms refresh reads player state. No disposer or general song-generation guard. |
| Dictionary, active/saved locale, document language | `lib/i18n.js` | Explicit `init`; guarded storage reads/writes. `setLocale` traverses **the whole document**, then emits language event. Confine traversal before React owns annotated descendants. |
| Demo discovery/list markup, page links, build SHA | `scripts/build-demos.js` | Build-time scan of direct HTML files in `public/demos`; escaping and encoded relative links; generated `demos/index.html` is not authored source. |
| Demo title and count | `demos.js` | Calls i18n init then header init; eager refresh and language listener, no disposer. Phase 1 must transfer these writes only if its pilot owns those nodes. |
| Shared responsive styling and hidden visibility | `styles.css`; generator's inline demo styles | Retain global `[hidden]` override and verify rendered layout in Chromium. |

The existing `window.sansBass` surface at the end of `app.js` has real consumers:
`notes.js`, `separate.js`, and browser harnesses. It exposes separated loading, mix/stem
buffers, notes/ribbon operations, tempo range, audio destinations, transport snapshot,
and status. Its classic-script comment is stale: the consumers are now modules. Record
this as existing migration debt; do not invent another global or remove it before consumers
move. The guide's statement about removed `window.SansX` globals does not remove this
lowercase player bridge.

### Custom event inventory

All names have prefix `sansbass:` and dispatch on `window`.

| Events | Producer → consumer |
|---|---|
| `langchange` | i18n → header, demos, app retranslation, notes, separation |
| `songload` | app buildUI → notes shared tempo reset |
| `transport`, `ribbonmute` | app → per-channel notes sonifiers |
| `temporange` | app drum/selection UI → notes |
| `temporangemode`, `tempo` | notes → app drawing/interaction state |
| `chords` | notes → app timeline/editor |
| `chordedit`, `chordredetect`, `capochange` | app controls → notes |
| `editmode` | app controls and notes reset/import paths → app and both notes channels |
| `noteedit`, `editundo` | app editor/keyboard → notes channels |
| `exportedits`, `importedits` | app shared controls → notes persistence |

Listeners and pollers are page-lifetime today. React subscription cleanup must not destroy
song/audio state, and UI remount must not accumulate these listeners. Stale load/analysis/
separation results are a source-inspection risk requiring explicit tests in phases 2/5;
this slice did not reproduce or fix those races.

### Coverage audit and additions

The historical map preserves 255 original rows; its dash entries are not proof of failure,
and a scenario's file-level coverage does not mean every assertion is automated.
Existing `tests/i18n.test.js` proves saved-choice precedence and blocked storage handling.
Existing `tests/player.test.js` proves language changes retain canvas identity and routing,
synthetic loading, gain ramps, drag visibility, and fake separation success.

Added `tests/header.test.js` in jsdom: player input identity and existing change listener
survive initialization and both language switches; pressed states and active-page links
are correct; player/demo links resolve inside a nested base; demo header has no load input.
These are DOM semantics, not file-picker, layout, audio, or deployed-path evidence.

Slice 0b exercised actual generated demo-page title/count, stored/blocked storage wiring,
generator add/remove/Unicode/non-HTML discovery, narrow layouts, and normal/nested static
build navigation. React remount/unsubscribe assertions remain phase-1 work because no React
boundary exists yet. The generator's zero-demo empty state was not exercised.

### Lightweight progress record

React owns no region yet. All current owners and existing bridges are listed above.
No temporary migration adapters were added. The next ownership transfer is the isolated
**demo-page header/navigation/language UI**; the player header stays legacy-owned.

Per user feedback, LOC is optional and is no longer a phase gate. No dedicated counter,
per-region line inventory, or mandatory per-slice scorecard is retained. Use ownership,
relevant behavioural checks and milestone performance comparisons instead.

### Slice 0b — browser and local-build evidence

Collected 2026-09-05 20:31–20:34 UTC; Apple M4 Max, macOS 26.6.2, Playwright headless
Chromium **151.0.7922.34**, device scale 1. Source and displayed SHA: **9636b06**.
Production files are unchanged from that revision. External browser requests were blocked.

[Raw browser results](react-baseline/artifacts/report.json) and
[raw build results](react-baseline/artifacts/build-report.json) retain samples and outcomes.
Archival reproduction scripts: [capture.mjs](react-baseline/capture.mjs) and
[build-smoke.mjs](react-baseline/build-smoke.mjs). These are one-off baseline tools, outside
`npm test`; do not rerun the entire capture for each small migration slice.

```sh
npm run dev -- --host 127.0.0.1
# In another terminal, from the repository root:
node docs/react-baseline/capture.mjs /tmp/sans-bass-react-baseline
node docs/react-baseline/build-smoke.mjs /tmp/sans-bass-react-baseline
```

The scripts pin the baseline SHA; update that assertion when deliberately collecting a
later milestone. Build smoke uses an isolated temporary copy, creates/removes its fixture
there, and serves built output at `http://127.0.0.1:8780/` and `/pr-baseline/`.
It never publishes or modifies the real demo directory.

| Boundary | Actual evidence |
|---|---|
| Desktop/narrow, EN/zh-TW | 28 full-page reference PNGs: seven states × two locales × 1440×900 / 390×844. No document-level horizontal overflow in any capture. |
| LOAD-001 subset | Real input receives production-encoded 10-second vocals 440 Hz, bass 110 Hz and drums 120 BPM click ZIP; a subsequent non-ZIP byte payload produces a visible translated error. |
| MIX/LOOP subsets | Bass mode selected; A/B badge visibly establishes 0–1.5 s loop. These screens do not prove gain/audio looping. Suite gain tests remain separate evidence. |
| NOTE/EDIT subsets | Real local notes Workers process synthetic audio; both channel panels appear; edit mode and ribbons are visible. No musical-accuracy or comprehensive edit-gesture claim. |
| LANG/BOOT subsets | Saved locale survives player → demos; player and demos boot/switch both languages with storage throwing. No uncaught page errors. |
| Built demo discovery | Unicode/space/ampersand HTML filename is encoded/listed and copied unchanged; non-HTML is not listed; fixture removal removes the entry and stale build file. |
| Normal/nested static paths | Both languages: SHA, demo title/count, sample export/capo and return-to-player navigation pass. No local HTTP errors. |
| Built AudioWorklet | `audioWorklet.addModule` loads the explicit bundled entry at both base paths; 44100 Hz context. This is module-load evidence, not stretched-audio listening or node processing. |

The synthetic fixture is specified in the raw report and uses the actual
`tests/helpers/audio-fixtures.js` → WAV/ZIP encoders → `#file-input` path under Vite.
No committed song or private audio appears in these images.

Representative reviewed images:

- [Desktop English empty](react-baseline/artifacts/desktop-en-empty.png)
- [Desktop English editor](react-baseline/artifacts/desktop-en-editor.png)
- [Desktop Chinese demos](react-baseline/artifacts/desktop-zh-TW-demos.png)
- [Narrow English demos](react-baseline/artifacts/narrow-en-demos.png)
- [Narrow Chinese editor](react-baseline/artifacts/narrow-zh-TW-editor.png)
- [Narrow Chinese error](react-baseline/artifacts/narrow-zh-TW-error.png)

Visual observations: the empty/player/demo layouts and translated controls remain legible;
long demo filenames wrap. The narrow player header stacks, and the loaded title truncates.
The narrow zoom toolbar is crowded, with its rightmost controls clipped in the reference;
this is an existing visual limitation, not a React regression. No redesign was made.
The error message remains below the existing loaded song/editor, making the narrow page long.
Screenshots are reference material alongside outcome assertions, not parity tests.

Two capture-harness issues were corrected before the retained run: reading demo locale
before its module initialization, and capturing a sticky header after control-induced
scrolling. The final run waits for header initialization/load and scrolls to the top.
Neither was recorded as an application regression.

### Milestone performance reference

Fresh browser context for each of five samples, warm Vite server for development;
local built server uses `Cache-Control: no-store`. No network/CPU throttling. These fast
local values are comparison references on this machine, not user performance promises.

| Measurement | Median / scope |
|---|---|
| Dev DOMContentLoaded | 34.8 ms |
| Dev automation-observed player ready | 61.3 ms; includes polling/automation overhead |
| Synthetic selection → lane update + next rAF | 27.2 ms; ZIP generation excluded |
| Built DOMContentLoaded | 19.9 ms |
| Built automation-observed player ready | 35.8 ms; includes polling/automation overhead |
| Built startup JS transfer | 146,150 bytes each run; includes Resource Timing transfer overhead, unlike emitted-byte total above |
| Foreground rAF intervals after Play | 8.4 ms median, 9.3 ms max, 120 intervals |
| Programmatic lane click → next rAF | 8.2 ms median, 9.3 ms max, 10 samples |

The last two are drawing/control scheduling proxies, not input-to-screen paint or audio
latency. The short capture reports `playing: true` but samples the integer time label as
`0:00`; it does not establish sustained audible playback or trusted unlock. Keep human
playback/background checks separate. Do not rerun these measurements for every UI edit;
compare at the pilot, player-shell and final-acceptance milestones.

### Omissions and handoff

Selected manual checks, all **not run**: trusted playback unlock (TRN-001), background native
loop and longest-source end (LOOP-001/TRN-001), native/stretched seams and pitch preservation
(SPD-001), language-switch audio continuity (LANG-001), and note-tone alignment. Later manual
comparison should use `examples/nov_you.zip` locally and record device/browser/SHA.

Physical handheld, real-song musical accuracy, real separation/model execution, deployed
PR/main smoke, comprehensive malformed-input combinations and the full behaviour matrix
remain untested in this baseline. Real notes Workers were exercised in development; real
bundled notes/separation Worker execution was not part of the static build smoke.
No model download was attempted. These omissions do not become passes through screenshots
or unit coverage. The phase-0 exit gate requires explicit omissions, not full release parity.

Baseline deliverables are recorded and each first-phase DOM region has an owner. Next bounded
slice: **phase 1 isolated demo-page React pilot**, including locale subscription cleanup,
remount behaviour and the affected demo checks. No competing player owner should be added.
No PR, merge, release, or deployed acceptance is recorded. Rollback is reverting this slice's
tests/config/docs; no user-data conversion or production-code rollback is needed.
