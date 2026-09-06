# React migration evidence

## Phase 3a — React player header and loading

Status: implementation and PR-preview verification complete; production acceptance pending.
Evidence collected 2026-09-06 America/Los_Angeles. Implementation source:
`8892b87cf73e25d60fa2ed6b6988cca04e6b43bf`; branch
`feat/react-phase-3-header-loading`. Starting source:
`02aca2022ff8e99f8b510c6e92de17d27179d67d`. Accepted rollback boundary remains Phase 2 at
`6657528afdac67f75c5b3118bbd651d4d6684b6b`. The pre-existing untracked `demo.md` remains
outside this slice.

### Bounded plan and ownership transfer

The source audit and implementation boundary are recorded in
[react-phase-3-header-loading-plan.md](react-phase-3-header-loading-plan.md).
`components/PlayerShell.jsx` is now the sole runtime owner of the player header descendants,
one real file input and its change listener, empty/loading affordance, status/error node, and
drag overlay plus its five document listeners. One React root reconciles those regions through
explicit portal hosts without claiming or rebuilding the intervening legacy player markup.
`components/SiteHeader.jsx` is shared by the player and the existing `DemoHeader` wrapper.

`app.js` remains the sole authoritative owner of decoded tracks, accepted song, the 44.1 kHz
AudioContext, audio graph, routing, transport/loop/rate values, Workers/service state, lanes,
and canvases. Its `lastSay` value remains a stable status key/params/error projection, but it
no longer writes a status node. `lib/legacy-player-controls.js` now owns only play and speed;
the old file-input listener was removed with `lib/header.js` and the legacy drag/status writes.

Play/pause, seek, master volume, speed, A/B loop controls, mode menus, lanes, canvases,
separation, detection, notes, and DSP remain legacy-owned. This is an accepted-size Phase 3
increment candidate, not a claim that all of Phase 3 is complete.

### Application seam, cleanup, and temporary adapters

File selection and valid drop call `playerApplication.commands.load()` and continue through
the Phase 2 loader/token barrier. The facade gained only `rejectLoad(reason, details)`, with
the closed reasons `folder`, `multiple`, and `unsupported`: this extension is required because
React now owns drop validation but the authoritative application still owns status publication
and the fixed `folder-drop` analytics event. React does not import or mutate `app.js` state.

Shell unmount removes the application/locale subscriptions and drag listeners, clears the
portal descendants, and leaves the application, current song, canvases, AudioContext, Workers,
and legacy controls alive. Remount is idempotent and creates one current input/listener set.
The existing `window.sansBass.playerShell` harness adapter names the browser tests as its only
consumer; production mounting imports the ESM function. `window.sansBass` otherwise remains
for `notes.js`, `separate.js`, and the browser harness, and `sansbass:transport` remains for the
vocals/bass sonifiers. The legacy adapter remains temporarily for the play/rate controls until
their later Phase 3 slices.

### Automated and local-build evidence

Environment: Apple M4 Max, macOS 26.6.2, Node v26.7.0, npm 11.19.0, Vitest 4.1.11,
Vite 8.2.2, Playwright headless Chromium 151.0.7922.34.

| Command / boundary | Result |
|---|---|
| Failing-first Chromium run | 5 new cases failed against the legacy owner: missing React shell/remount surface, missing React drop path, and retained header focus |
| `npx vitest run --project node tests/player-application.test.js` | 1 file, 6 tests passed |
| `npx vitest run --project jsdom tests/demo-header.test.jsx` | 1 file, 4 tests passed; expected Node experimental localStorage warning |
| `npx vitest run --project browser tests/player.test.js` | 1 file, 21 tests passed |
| `npm test` | 31 files, 402 tests passed |
| `npm run build` | Passed; 57 modules transformed; existing intentional worklet URL warning only |
| Existing isolated build harness at `/` and `/pr-phase-1/` | 12 route/layout/locale/storage checks passed at displayed `8892b87`, with no page/HTTP errors |
| `git diff --check` | Passed |

The player Chromium cases use the production entry, real AudioContext, and the documented
`stemsZip()`/WAV/ZIP encoders through the real `#file-input` or cancelable drop events. New
coverage proves input identity across language and status publications, same-file repeat,
language changes before and after loading, retained song/canvas identity, visible loading and
hidden success, malformed ZIP and unsupported/multiple/folder rejection, English/Chinese
command errors, overlay visibility/depth/cleanup, focus restoration and legacy field shortcut
exclusion, idempotent shell remount, and one load after remount. The retained stale-decode case
proves an older completion cannot replace a newer song; fake stale notes/separation results
remain lifetime evidence rather than real-Worker/model evidence.

The exact-commit isolated build emitted **375,976 bytes** across all JavaScript assets versus
Phase 2's 374,997 (+979, +0.26%); React was already present in the shared demo build. The player
route now intentionally loads that runtime: five no-store samples measured median player JS
transfer at **343,436 bytes** versus 151,028 (+192,408, +127.4%, including HTTP overhead),
DOMContentLoaded at **21.6 ms** versus 18.7 (+2.9 ms), and automation-observed ready at
**43.8 ms** versus 33.7 (+10.1 ms). The shared React/header chunk is 218,021 emitted bytes;
the player main chunk is 108,984 bytes. The startup increase is the expected Phase 3 milestone
cost of bringing the already accepted React runtime onto the player route, with no measured
audio/drawing claim implied by local startup timing.

### PR-preview deployment evidence

Delivery review: [PR #69](https://github.com/SansWord/sans_bass/pull/69). The initial required
checks passed (`test`, 56 seconds; `deploy`, 11 seconds). The nested preview at
`https://sansword.github.io/sans_bass/pr-69/` displayed exact synthetic merge source
`f9d3084d722346a77a34858d8772cb28fcffcc59` (`f9d3084`) before the boundary run. This
evidence-only documentation change requires refreshed checks and a final displayed synthetic
merge-SHA assertion before merge; that result will be recorded with the accepted anchor.

Chrome exercised the player root and `/pr-69/demos/` at the preview base, and both routes
displayed `f9d3084`; header navigation stayed below `/pr-69/`. A clean startup retained the
saved Traditional Chinese choice, rendered exactly one React player shell and one file input,
and produced no first-party warning or error. The exact-commit normal/nested build harness
separately injected throwing `localStorage` and proved boot plus both language choices; live
GitHub Pages has no user-visible control that can revoke storage for fault injection.

A generated 0.2-second two-stem WAV/ZIP fixture loaded through the real input as `Preview
synthetic`. Switching English to Traditional Chinese after load retained the song, lanes,
seven canvases, one input, and one React root, and returned focus to the document. An
unsupported `.txt` rendered the established Chinese rejection, which rerendered in English
without a new input; a three-byte ZIP rendered the established damaged-ZIP recovery. The PR's
production-entry Chromium gate supplies the cancelable file-drop/data-transfer boundary that
cannot be driven by the deployed page's native file picker: valid drop, unsupported/multiple/
folder rejection, overlay depth and cleanup, fixed folder-drop analytics, and one listener/load
set after remount all passed against this source.

The committed `examples/nov_you.zip` was used only for the real-song deployment smoke. It
decoded as `9 十二月的妳`, 4:23, with six named stems; the cleared input accepted the identical
file a second time, while input/root counts stayed one. A subsequent language render retained
the same title, lanes, and eleven canvases. A 390-by-844 visual check showed the existing
stacked header/load affordance without horizontal clipping. The intentional malformed-ZIP run
logged its caught parser error; a separate fresh navigation established the clean first-party
console result. Browser-extension warnings were excluded by source URL.

### Evidence categories and omissions

| Category | Local evidence / omission |
|---|---|
| Synthetic | Generated folder ZIPs cover file input, repeat selection, valid drop, partial decode, song replacement, stable canvases, remount, and stale completion through production encoders. |
| Malformed input | Three-byte malformed ZIP plus unsupported, multiple-file, and folder-shaped drops render established recovery copy; partial invalid WAV retains usable lanes. Exhaustive ZIP mutations remain in Node unzip tests. |
| Storage/locale | Both languages before/after load and bilingual status pass in the player; jsdom plus the isolated root/nested build harness cover saved and throwing storage. |
| Handheld | Existing capability predicate tests pass and the React shell uses the same once-per-page handheld explanation. No physical device was run. |
| Worker | Existing deterministic stale notes/separation Worker cases pass. No real Worker or model was required for the local UI boundary. |
| Visual | Computed overlay/hidden visibility and desktop/narrow shared-header layout pass; the 390-by-844 preview header/load affordance was visually reviewed without clipping. Full subjective player comparison remains out of scope. |
| Auditory | Not run; audio scheduling/DSP ownership did not move. Trusted unlock, background timing, pitch/seam, and note-tone listening remain omitted. |
| Real song | Preview-only deployment smoke: `examples/nov_you.zip` decoded to the 4:23 six-stem song and accepted identical repeat selection. It is not synthetic-matrix evidence. |

Production acceptance and a Phase 3a rollback anchor remain pending; no accepted-complete-
Phase-3 claim is made here.

## Phase 2 — player command and subscription boundary

Status: accepted in production. Evidence collected 2026-09-05 America/Los_Angeles
(2026-09-06 UTC). Implementation source: `174fffbdc59c9cfd0d7b696ae333566bda6e0275`;
branch `feat/react-migration-phase-2`. Accepted production source:
`6657528afdac67f75c5b3118bbd651d4d6684b6b`. Starting source:
`e108c681513ea6004199efac4f0f56ca264e1800`. Previous rollback boundary: Phase 1 at
`5de58b634e4a11b0baf2bfca6f4a1e98f3eae31d`. The pre-existing untracked `demo.md`
remains outside this slice.

### Bounded plan and ownership

The source audit and implementation plan are recorded in
[react-phase-2-plan.md](react-phase-2-plan.md). No DOM region transferred to React. `app.js`
deliberately retains sole ownership of decoded tracks, the one AudioContext and gain graph,
transport/loop/rate/routing state, lane/canvas DOM, drawing, status, and song UI. Audio buffers,
sources, Workers, worklets, peaks, and note renderers remain outside any component lifetime.

Ownership transferred only at the interaction seam: `lib/player-application.js` now owns the
application lifecycle, command-error value, listener/cleanup registries, and monotonic song
operation identity. `lib/legacy-player-controls.js` owns the existing file-input, play-button,
and playback-rate listeners and renders those transport controls from snapshots. It does not
own or copy engine state. The legacy adapter is mounted by `app.js`; unmount/remount affects
only its listeners/subscription and preserves the AudioContext, current song, routing, and
work already in flight.

### Public ESM interface

`lib/player-application.js` exports the production singleton `playerApplication`, the test
factory `createPlayerApplication()`, and `PlayerCommandError`.

| Surface | Contract |
|---|---|
| `getSnapshot()` | Returns one immutable snapshot, stable by identity until the owner publishes. Fields are `lifecycle`, `song`, `loading`, `transport`, `status`, and `commandError`. The snapshot is a read-only projection; commands always act on `app.js`'s authoritative values. |
| `subscribe(listener)` | Notifies after publications and returns an idempotent unsubscribe. It does not initialize, reset, or dispose the engine. |
| `commands.load(file)` | Begins a new song operation and routes the one accepted File to existing ZIP/song loading. |
| `commands.play()` / `pause()` / `togglePlayback()` | Reach the existing synchronous trusted-gesture unlock and shared scheduling path. |
| `commands.seek(seconds)` | Uses seconds on the existing transport and preserves running/stopped state. |
| `commands.setPlaybackRate(rate)` | Uses a `0.10`–`1.50` multiplier and delegates to the existing native/worklet transition logic. |
| `commands.replaceSong(original, stems)` | Replaces a mix with separated stems through the same song-lifetime boundary. |
| `currentSongToken()` / `isCurrentSongToken(token)` | Let asynchronous services reject a completion belonging to an older operation or disposed application. |
| `registerCleanup(fn)` | Registers application-lifetime service cleanup; removing a UI subscription does not run it. |
| `dispose()` | Idempotently invalidates song work, runs service cleanup, unmounts the legacy controls, stops sources/drawing, and closes the AudioContext. |

Command validation and delegated failures become `PlayerCommandError`, are observable as
`commandError`, and are rendered through the bilingual `status.commandFailed` message. A
failure from an older load token is ignored after replacement rather than overwriting the
current song's status.

### Song and asynchronous lifetime guarantees

Every load request advances the application song token before ZIP extraction or audio decode.
Progress, decode completion, and failure are published only while that token remains current.
The accepted song records the token that built its lanes. A later load, separated replacement,
or application disposal invalidates older work.

`notes.js` captures the current token for note analysis, tempo re-detection, deferred chord
detection, and asynchronous edits import. Worker handlers also capture their exact Worker
instance, preventing a terminated old worker from clearing or overwriting a newer run.
Application disposal terminates both note-channel Workers and sonifiers and clears their
poll/chord timers. `separate.js` subscribes to loading/song publications instead of polling,
terminates an invalidated run, and ignores stale messages. Successful replacement advances
song identity only after the result has become final, preserving save availability.

### Temporary adapters and named consumers

- `sansbass:transport` remains the exact-clock adapter from `app.js` to the vocals and bass
  sonifiers in `notes.js`. It carries the shared `t0`, offset, valid loop bounds, and rate;
  removing it before an equivalent service seam exists could desynchronize reference tones.
- `window.sansBass` remains for `notes.js` (`currentMix`, stem/audio/ribbon/tempo/status
  operations), `separate.js` (`currentMix`, `isSingleTrack`), and the browser harness. The
  harness-only `application` and `legacyControls` members expose lifecycle/remount assertions.
  Loading and transport production UI use the ESM facade, and the obsolete separated-load
  bridge member was removed.
- Existing note/edit/tempo/chord/ribbon custom events remain page-lifetime adapters with their
  current named `app.js`/`notes.js` consumers. Their ownership was not broadened in Phase 2.

### Automated and local-build evidence

Environment: Apple M4 Max, macOS 26.6.2, Node v26.7.0, npm 11.19.0, Vitest 4.1.11,
Vite 8.2.2, Playwright headless Chromium 151.0.7922.34.

| Command / boundary | Result |
|---|---|
| Failing-first facade test | Failed because `lib/player-application.js` did not exist |
| `npx vitest run --project node tests/player-application.test.js` | 1 file, 6 tests passed |
| `npx vitest run --project browser tests/player.test.js` | 1 file, 16 tests passed |
| Saved/blocked locale target | `tests/i18n.test.js` + `tests/header.test.js`: 17 tests passed |
| `npm test` | 32 files, 399 tests passed |
| `npm run build` | Passed; 56 modules transformed; existing intentional worklet URL warning only |
| Existing isolated build harness at root and `/pr-phase-1/` | Passed 12 route/layout/locale/storage checks with no page/HTTP errors; current branch source was copied to a temporary build |
| `git diff --check` | Passed |

The browser project uses the documented Vite harness and the real `#file-input`, production
WAV/ZIP encoders, real AudioContext, and deterministic fake Workers for protocol races. It
exercised folder ZIPs; standard vocals/bass/guitar/drums combinations; unequal durations;
one invalid WAV entry with partial recovery; one whole-song WAV; synchronized source starts;
play/pause/seek; an invalid then valid A/B point; 95% rate; routing gain ramps; replacement;
legacy unmount/remount; same singleton/one reusable input and repeat selection; stale held decode; stale notes completion;
and separation completion after disposal. Existing Node ZIP/stem tests cover flat archives,
stored/deflated entries, unknown lanes, sidecars, explicit mix, and malformed mutations.
Fake Workers prove protocol handling, not deployed module/model execution.

Phase 1 emitted 368,854 bytes across `dist/assets/*.js`; the final isolated Phase 2 build
emits 374,997 bytes, +6,143 bytes (+1.7%). The player main chunk is 108,415 bytes. Five
no-store local samples measured player startup transfer at 151,028 bytes versus Phase 1's
144,885 (+6,143, +4.2% including HTTP overhead), median DOMContentLoaded 18.7 ms versus
17.7 ms (+1.0 ms), and median automation-observed ready 33.7 ms versus 33.1 ms (+0.6 ms).
The time differences are noise-level; the byte increase matches the facade/guard code. React
still does not load on the player route.

### PR-preview deployment evidence

Delivery review: [PR #67](https://github.com/SansWord/sans_bass/pull/67). Both final required PR
checks passed (`test`, 39 seconds; `deploy`, 19 seconds). The published preview at
`https://sansword.github.io/sans_bass/pr-67/` displayed exact synthetic merge source
`b35971b1b706af4b07dd28c08b3425e7184a3c52` (`b35971b`) before the full behavior run. The only
subsequent change recorded this evidence; refreshed checks passed and the preview displayed
the resulting exact synthetic merge source `ca63080fdfea7f211d1186386e6269bbc5f30a3f`
(`ca63080`) before the final assertion.

Chrome 151.0.7922.34 loaded the committed `examples/nov_you.zip` through the real file input,
decoded the 4:23 song into six lanes, advanced playback from a trusted click, paused, changed
speed to 95%, and muted bass through the documented `3` shortcut. The selection changed to
Custom and the all-track action changed to Unmute all. The 95% playback path completed without
a status or console error, exercising the deployed AudioWorklet-relative asset boundary.

The deployed note Worker path returned the accepted musical regression values: 374 vocal
notes, 357 bass notes, and 48.0 BPM at 54% confidence. A generated 1.25-second WAV then replaced
that song through the same real input. Cached-model separation completed into six named stem
lanes and exposed Save stems without downloading the model again. The `/pr-67/demos/` nested
route loaded, preserved the preview base path, displayed the same `b35971b` source, and returned
to the player route. The first-party warning/error console remained empty after playback,
note detection, separation, and nested navigation.

The real-song ZIP and generated short WAV are deployment-smoke evidence, not a claim that the
full behavior matrix ran in preview. The full local automated matrix is reported above.

### Production deployment evidence

PR #67 squash-merged at 2026-09-06T06:41:11Z as exact source
`6657528afdac67f75c5b3118bbd651d4d6684b6b`. The exact-SHA main workflows passed: Deploy main
[run 34017141774](https://github.com/SansWord/sans_bass/actions/runs/34017141774) in 19 seconds
and Test [run 34017141763](https://github.com/SansWord/sans_bass/actions/runs/34017141763)
in 36 seconds. Production at `https://sansword.github.io/sans_bass/?phase2=6657528`
displayed `6657528` before assertions.

The required production tier repeated the boundaries changed by this slice. The real-song ZIP
decoded to six lanes at 4:23; trusted-click playback advanced and paused; 95% worklet playback
succeeded; and bass routing changed Full mix to Custom/Unmute all. Production note Workers
returned 374 vocal notes, 357 bass notes, and 48.0 BPM at 54% confidence. Cached-model
separation of the generated 1.25-second WAV completed into six named lanes and exposed Save
stems. `/demos/` resolved at the production base, displayed `6657528`, and exposed its player
return link.

No first-party warning/error was logged. Warnings from
`chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/` were identified as browser-extension
output and excluded from the site result. Exact preview and production observations, including
explicit skips, were also recorded as comments on PR #67.

### Accepted and explicitly skipped evidence

The Phase 2 exit gate, PR checks, preview verification, merge, exact production verification,
and rollback-anchor requirement have passed.

Not run locally: uncached 285 MB model download; physical handheld; trusted human audio unlock;
background-tab longest-source end/native loop timing; subjective visual review; subjective
native/stretched seam and pitch preservation; auditory note-tone alignment; real-song musical
accuracy; comprehensive pointer/edit/export scenarios. The generated fixtures and committed
real-song deployment smoke are different evidence categories; neither is described as the full
behavior matrix. Those omissions remain visible for later release acceptance and are not Phase
2 parity claims.

## Phase 1 — isolated React demo header pilot

Status: accepted in production. Evidence collected 2026-09-05 America/Los_Angeles
(2026-09-06 UTC). Implementation source: `b9b5670`; branch `feat/react-demo-pilot`.
Accepted production source: `5de58b634e4a11b0baf2bfca6f4a1e98f3eae31d`; complete
rollback anchor before React implementation: `087f0cc64bf25f46b97081f5befcf41529431b45`.
Delivery review: [PR #65](https://github.com/SansWord/sans_bass/pull/65). The pre-existing
untracked `demo.md` remained outside the slice.

### Bounded plan

1. Give React sole ownership of the demo page's header descendants, leaving the player
   header, demo discovery/list content, audio, Workers, and canvas UI unchanged.
2. Add React/React DOM plus the Vite React plugin and a JSX demo entry without changing the
   multi-page, relative-base, build-SHA, Worker, or AudioWorklet boundaries.
3. Subscribe to the existing i18n store through one cleaned hook; expose one mount disposer
   covering both React and the still-legacy demo title/count listener.
4. Add jsdom outcome coverage, then exercise both languages, saved/blocked storage,
   desktop/narrow layouts, demo discovery/exports, and normal/nested production builds.
5. Compare the pilot's emitted JavaScript and startup observations with phase 0; because
   entry composition/static assets changed, run the full deployed tier on PR and production.

### Ownership and conventions

`components/DemoHeader.jsx` is now the only runtime owner of every descendant of the demo
page's `#site-header`: player link, demo link, repository link, language group, translated
copy, and pressed/current-page state. The player page still uses `lib/header.js`, including
its file-input move and legacy language listener. No React code loads on the player route.

Locale state remains authoritative in `lib/i18n.js`. `components/useLocale.js` adapts its
public `sansbass:langchange` event with `useSyncExternalStore`; unmount removes that listener.
React-owned descendants deliberately carry no `data-i18n` annotations, so the legacy whole-
document `apply()` traversal cannot write inside the React region. `demos.jsx` retains the
legacy title/count write outside that region and returns one disposer that removes its event
listener and unmounts the root. Vite hot disposal uses the same path. Strict Mode is enabled
in development and production; tests prove the temporary double mount leaves one active hook
subscription and that disposing/remounting returns the total active language-listener count
from two to zero between mounts.

The pilot reuses the established header classes in `styles.css`, avoiding a visual redesign.
Future component-only styles should be imported beside their component; genuinely shared
player/demo styles remain global. Build-time discovery, filename escaping/encoding, generated
list markup, demo content, and `#build-sha` remain owned by `scripts/build-demos.js`.

### Automated and local-build evidence

Environment matches phase 0: Apple M4 Max, macOS 26.6.2, Node v26.7.0, npm 11.19.0,
Vitest 4.1.11, Vite 8.2.2, Playwright headless Chromium **151.0.7922.34**.

| Command / boundary | Result |
|---|---|
| Failing-first targeted test | Failed because `components/DemoHeader.jsx` did not exist |
| `npx vitest run --project jsdom tests/demo-header.test.jsx tests/header.test.js` | 2 files, 6 tests passed |
| `npm test` | 31 files, 385 tests passed, 1.83 s |
| `npm run build` | Passed; 54 modules transformed, 106 ms; existing intentional stretch-processor URL warning only |
| `git diff --check` | Passed |
| `node docs/react-phase-1/verify.mjs docs/react-phase-1/artifacts` | Passed; normal/nested static mounts, 12 recorded route/layout/locale/storage checks, no page/HTTP errors |

The first sandboxed full-suite attempt passed the 332 Node/jsdom assertions it reached but
could not bind the Chromium server (`listen EPERM ::1`). The permitted retry passed all 385
tests. This is the same environment restriction recorded in phase 0, not an application
failure. The jsdom tests retain Node's experimental localStorage warning.

[Raw Phase 1 report](react-phase-1/artifacts/report.json) and four reviewed full-page images
retain the exact checks and samples:
[desktop English](react-phase-1/artifacts/desktop-en-demos.png),
[desktop Chinese](react-phase-1/artifacts/desktop-zh-TW-demos.png),
[narrow English](react-phase-1/artifacts/narrow-en-demos.png), and
[narrow Chinese](react-phase-1/artifacts/narrow-zh-TW-demos.png).
At 1440×900 and 390×844, both locales retained the phase-0 header/list appearance and had
no document-level horizontal overflow. This is reviewed visual evidence, not pixel equality.

The isolated harness uses a temporary copy. It adds a Unicode/space/ampersand HTML demo and
a non-HTML file, proves only the HTML entry is encoded/listed/copied and opens, removes both,
rebuilds, and proves the list plus `dist/` are clean. At `/` and `/pr-phase-1/`, desktop and
narrow runs boot from each saved locale, switch and persist the other locale across reload,
retain active-page/relative-link semantics, open the committed export, exercise its capo
selector, return to the player, and find exactly one player file input. Separate contexts
with throwing storage boot and switch both locales. External requests are blocked.

### Phase-0 performance comparison

Fresh browser contexts, local static server with `Cache-Control: no-store`, five samples;
no CPU/network throttling. Resource Timing transfer includes HTTP overhead. Values are local
comparison signals, not user-facing budgets.

| Measurement | Phase 0 | Phase 1 | Change / interpretation |
|---|---:|---:|---|
| All emitted `dist/assets/*.js` | 178,369 B | 368,854 B | +190,485 B (+106.8%); React foundation is isolated in the demo entry |
| Demo entry emitted JS | 319 B | 192,069 B | +191,750 B; React/React DOM dominate, accepted as the explicit foundation cost |
| Player startup JS transfer | 146,150 B | 144,885 B | −1,265 B (−0.9%); chunk factoring noise, no React route load |
| Player DOMContentLoaded median | 19.9 ms | 17.7 ms | −2.2 ms; noise-level, no regression indicated |
| Player ready median | 35.8 ms | 33.1 ms | −2.7 ms; noise-level, no regression indicated |
| Demo DOMContentLoaded median | not captured in phase 0 | 20.7 ms | New pilot reference |
| Demo React-header ready median | not captured in phase 0 | 44.6 ms | New pilot reference |
| Demo startup JS transfer | not captured in phase 0 | 219,704 B | New pilot reference |

The size increase was investigated: the new demo entry is the only route importing
`react-dom/client`; player HTML does not reference the demo/React chunk, and its measured
startup transfer did not increase. A CDN would trade local static reliability and privacy
for a smaller repository build, while a compatibility substitute would not demonstrate the
requested React architecture. The isolated route cost is accepted for this migration pilot
and should be revisited when player components begin sharing that runtime.

### PR-preview deployment evidence

The full deployed tier ran in Chrome against the nested PR preview at
`https://sansword.github.io/sans_bass/pr-65/`. The preview displayed synthetic merge SHA
`7de7869` before any product assertion; branch head was `b157e08`. Hashed scripts and worker
assets resolved below `/pr-65/assets/`, and the app logged no first-party warning or error.

| Boundary | Preview result |
|---|---|
| Pilot/demo route | Header/list booted with build SHA `7de7869`, no horizontal overflow; English/Chinese switch worked and English persisted across reload |
| Published export | Opened from the generated listing; capo `0`→`3` changed the first chord `Fm`→`Dm` and play key `D#`→`C`; return navigation found exactly one player file input |
| Real-song path | `examples/nov_you.zip` loaded locally as 4:23 with six named lanes; trusted click advanced playback, bass mute changed custom routing, and 95% speed played without status error |
| Analysis/export | Real notes Worker produced 374 vocal and 357 bass notes at 48.0 BPM / 54% confidence; the visible vocal list export was invoked without page or status error |
| Cached-model separation | A locally generated 1.25-second WAV separated through the cached model into six named stems; save-stems became available and `separate.worker-Bxzm2fuX.js` was observed |
| Nested dynamic assets | `notes.worker-Ch3qR4G6.js` was observed after detection; 95% playback exercised the production AudioWorklet path with an empty status and clean first-party console |

The uncached 285 MB model download remained opt-in and was not run because the cached-model
path was available. Physical handheld, background-end/loop timing, exhaustive malformed-input,
subjective visual, and auditory scenarios were not run and are not implied by this deployed
smoke. The committed real-song fixture and generated short WAV are deployment evidence, not
the full behaviour matrix.

### Production deployment evidence

After PR #65 was squash-merged, both the `Deploy main` and post-merge `Test` workflows passed
for `5de58b634e4a11b0baf2bfca6f4a1e98f3eae31d`; preview cleanup also passed. The production
root displayed `5de58b6` before assertions. The same full deployed boundary passed there:
both locales and persistence, generated listing/export/capo, real-song playback and routing,
95% AudioWorklet playback, 374/357-note Worker analysis and export, and cached-model six-stem
separation. Status and first-party console output remained clean. The preview omissions listed
above remain omissions; this was deployment smoke, not the full behaviour matrix.

### Exit gate and next work

The local Phase 1 exit gate is met: both languages, saved/blocked storage, desktop/narrow
layout, normal/nested build paths, discovery/removal, demo export/capo, relative navigation,
build SHA, React cleanup/remount behavior, and baseline performance comparison have direct
evidence. The player header and every audio/data UI region remain legacy-owned, so the pilot
does not create a competing owner or couple React to audio.

The complete Phase 1 exit gate and both deployed tiers passed. Roll back the entire React
migration to `087f0cc64bf25f46b97081f5befcf41529431b45`, or roll later phases back to the
accepted Phase 1 boundary `5de58b634e4a11b0baf2bfca6f4a1e98f3eae31d`, using revert PRs
rather than rewriting shared history. There is no data migration. Next bounded slice: Phase 2's
player command/subscription boundary, with the legacy player UI unchanged first.

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
