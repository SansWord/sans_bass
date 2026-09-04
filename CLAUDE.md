# CLAUDE.md — sans_bass

Orientation for a fresh session. Read this instead of re-deriving the project from scratch.

## What this is

A local, dependency-free multitrack **stem player** for practising along to records. You rip
a CD you own, run Demucs AI source separation on it to get per-instrument tracks, then load
those into a browser page that shows a waveform per instrument and lets you solo any one of
them and loop a phrase.

```
CD  →  rip to FLAC  →  Demucs (htdemucs_6s)  →  encode .m4a  →  index.html
```

The point is drilling a part: solo the bass, set A/B around the four bars you keep fluffing,
loop it. Not a DAW, not a mixer, not a library manager — one song at a time.

## Hard constraints — do not break these

- **npm + Vite build the site; no UI framework.** `npm run dev` for local dev, `npm run
  build` for `dist/`, both CI workflows build before publishing. The player core is
  `index.html`, `styles.css`, `app.js` plus `lib/stems.js` and `lib/unzip.js`. Vanilla JS
  stays the default for code this project writes — React/Vue/etc. are still out. `file://`
  support was dropped in v1.5.0. `app.js` and every `lib/*.js` file (`stems.js`, `i18n.js`,
  `platform.js`, `unzip.js`, `ribbon.js`, `jianpu.js`, `transport-math.js`, `analytics.js`)
  are real ES modules as of v1.21.0 — actual `import`/`export`, not just the
  `type="module"` loading mechanism the npm + Vite migration (v1.20.0) switched them to.
  `separate.js` and `notes.js` (already ESM themselves) import these `lib/*.js` files
  directly too, as of v1.21.1 — see the next bullet.
- **A module's public surface is its `export`s — a `window.SansX` global is a bridge, never
  a default.** Every ESM file in this repo (`lib/pitch.js`, `lib/wav.js`, `lib/zip.js`,
  `lib/overlap.js`, `lib/sonify.js`, `lib/tempo.js`, `app.js`, `separate.js`, `notes.js`, and
  every `lib/*.js` file) exports what it wants read; it does not also assign a global on the
  chance something might want one later — that is designing for a hypothetical future
  consumer, the same thing this project's conventions already rule out for features. No file
  in this repo currently carries a `window.SansX` bridge — the last five
  (`lib/i18n.js`'s `window.SansI18n`, `lib/platform.js`'s `window.SansPlatform`,
  `lib/analytics.js`'s `window.SansAnalytics`, `lib/jianpu.js`'s `window.SansJianpu`, and
  `lib/pitch.js`'s `window.SansPitch`) were removed in v1.21.1 once `separate.js` and
  `notes.js` were converted to import them directly (and `app.js`'s one remaining
  `window.SansPitch.parseNoteName` read, in `commitPitchDropdown()`, was converted the same
  way — that bridge's actual reader had drifted from what its own comment claimed). See
  [`docs/superpowers/specs/2026-09-02-esm-modules-design.md`](superpowers/specs/2026-09-02-esm-modules-design.md)
  for the original design. The exception this rule still allows is a **documented, named
  bridge** for a specific consumer that genuinely cannot `import` yet — none currently exist,
  but if a real one shows up, add it back narrowly and commented, the way these were; never a
  global "for consistency with the other files" or "in case something needs it."
- **Nothing leaves the machine.** No audio egress ever. No uploads of user content. One
  cookieless, anonymous usage beacon (GoatCounter) reports **event names only** — never
  audio, never filenames, never song titles. Every event name is a compile-time constant
  or a stem id from a fixed set of seven; see `lib/analytics.js`. Inbound fetches are
  allowed and necessary: the ONNX runtime from jsDelivr and the ~285 MB model from
  Hugging Face. Keep the distinction — "no outbound audio", not "no network calls".
- **Deployable as a static site.** GitHub Pages hosts it with no backend. This depends on
  `ort.env.wasm.numThreads = 1` (no SharedArrayBuffer → no COOP/COEP, which Pages cannot
  set). Never commit the 285 MB model; it is fetched at runtime.
- **Audio never touches the main thread's timing.** See below.

## Architecture in one pass

`app.js` (~700 lines, sectioned by comment banners: helpers / loading / UI / transport /
A-B repeat / routing / input).

- **Sync model.** Every stem is decoded to an `AudioBuffer` and played from *one*
  `AudioContext` clock — all `BufferSource`s `start(t0, offset)` at the same `t0`
  (`LOOKAHEAD` = 60 ms). That is what makes six stems sample-locked. Six `<audio>` elements
  would drift audibly.
- **Muting is gain, never stop.** Each track has its own `GainNode` into a master gain.
  Muting ramps gain to 0 (`setTargetAtTime`) so the track stays locked to the timeline.
- **Transport lives on the audio graph, not in `requestAnimationFrame`.** rAF is throttled in
  background tabs. End-of-song comes from `onended` on the longest source; A–B repeat uses
  the node's own `loop`/`loopStart`/`loopEnd`. **rAF is for drawing and only drawing.** This
  project has learned that lesson three separate times — see the devlog.
- **Waveforms** are peak envelopes on a fixed time grid (`BUCKETS` = 1400) so lanes of
  different lengths stay aligned. Each lane is normalised to its own peak (capped at 8×),
  because a bass stem at natural level draws as a flat line; the overview keeps true dynamics.
  Idle and active versions are pre-rendered offscreen, so a frame is a blit plus a clip.
- **In-browser separation** (`separate.js`, `separate.worker.js`) is additive and optional.
  The worker owns ONNX Runtime and `htdemucs_6s`; `lib/overlap.js` plans the segments;
  `lib/wav.js` and `lib/zip.js` handle saving. It loads as a plain
  `<script type="module">`; the conditional injection that guarded `file://` went with
  `file://` support in v1.5.0. `app.js` and `lib/stems.js`/`lib/i18n.js`/`lib/platform.js`
  are real ES modules too (since v1.21.0), imported directly by app.js and the tests alike.
  Since v1.8.0 the whole panel is **gated to desktop** — see the handheld gotcha below.
- **Stem identity comes from the filename** (`detectStem`). Demucs' output names land in the
  right lanes untouched. The `mix` pattern is deliberately narrow (`\bmix\b|\bfull\b|…`) —
  a false positive there suppresses every other track.

- **Deployment is CI-owned.** `main` publishes to the root of the Pages site and every pull
  request gets a live preview at `/pr-<N>/`, both written to the `gh-pages` branch by
  `.github/workflows/`. Never hand-edit `gh-pages`. See [`docs/deployment.md`](docs/deployment.md).

`scripts/rip-cd.sh` — mounted audio CD (macOS presents it as `.aiff`) → lossless FLAC.
`scripts/prep-stems.sh` — one FLAC → 6 stems → `.m4a`, with MPS/CPU auto-detection.

## Repo layout

```
index.html  styles.css  app.js     the player (app.js: ESM, real import/export)
lib/stems.js                       stem identity — ESM, no window bridge
lib/unzip.js                       zip reading — ESM, no window bridge
lib/i18n.js                        zh-TW/en dictionary + runtime — ESM, no window bridge
lib/platform.js                    isHandheld() device predicate — ESM, no window bridge
lib/{wav,zip,overlap}.js           ESM — WAV encode, ZIP write, segment planning
lib/pitch.js                       ESM — YIN, candidates, Viterbi decoding, segmentation,
                                   octave folding, key
lib/sonify.js                      ESM — plays detected notes back as tones
lib/ribbon.js                      ribbon geometry — ESM, no window bridge
lib/jianpu.js                      簡譜 degrees — ESM, no window bridge
separate.js  separate.worker.js    ESM — separation panel and the ORT inference loop
notes.js  notes.worker.js          ESM — notes panel and the analysis worker
tests/*.test.js                    units      → `npm test` (Vitest; see vitest.config.js)
tests/parity.html                  accuracy   → window.__parity
tests/notes.html                   notes+key  → window.__notes
.github/workflows/                 Pages deploy + per-PR previews + `npm test` gate
                                   (see docs/deployment.md)
package.json  vite.config.js       npm scripts (dev/build/preview/test), Vite multi-page
                                   build config
vitest.config.js                   unit test config — three tiers (node/jsdom/browser),
                                   see the comment at its top for which tier a file needs
dist/                               build output (git-ignored; CI builds it, never committed)
scripts/rip-cd.sh                  CD → rips/*.flac
scripts/prep-stems.sh              one song → stems/<song>/*.m4a
rips/    <track>.flac, <album>/<track>.flac      ~560 MB, local only
stems/   <album>/<track>/{vocals,guitar,bass,drums,piano,other}.m4a
docs/                              see below
```

`rips/` and `stems/` hold the user's own ripped audio. Never publish, upload, or copy them
out of the project; never commit them.

## Docs

- [`README.md`](README.md) — the user-facing pipeline: ripping, Demucs setup, batching an
  album, controls, A–B repeat.
- [`docs/product-contract.md`](docs/product-contract.md) — the durable promises the product
  makes to users, without selectors or test procedure. Use `docs/behaviour.md` for executable
  smoke/acceptance scenarios and this contract to decide whether a proposed behaviour change
  changes what the product promises.
- [`docs/testing.md`](docs/testing.md) — the authoritative test-layer placement guide: Node
  for pure logic, jsdom for non-rendering DOM/storage, headless Chromium for browser APIs and
  player integration, local/deployed smoke for build boundaries, and manual acceptance for
  irreducibly auditory or physical-device behavior. **Read this before adding or moving
  tests.**
- [`docs/devlog.md`](docs/devlog.md) — version-by-version log with tagged learnings
  (`[note]` / `[insight]` / `[gotcha]`). **Read the v1.0.0 and v1.1.0 entries before touching
  the transport or the loader** — most of the non-obvious traps are already written down there.
- [`docs/behaviour.md`](docs/behaviour.md) — what the player is supposed to *do*, as
  observable outcomes with a way to observe each one, plus the browser-test harness (faking
  a separation run, reading gain ramps, the traps that make a working app look broken).
  **Read this before changing UI behaviour, and update it in the same commit when you do.**
  Its **Deployment smoke test** section is a different, narrower thing — a fast build/deploy
  wiring check (module loading, a real Worker/AudioWorklet actually instantiating, asset
  paths resolving), for after touching `vite.config.js`/CI/an entry HTML file or after a
  real deploy. Run that instead of the full matrix when nothing UI-shaped changed; run the
  full matrix for an actual behaviour change.
- [`docs/transcription.md`](docs/transcription.md) — how a stem becomes notes: the four
  layers (audio → frames → notes → edits), which are re-derivable and which can be lost,
  what each interpretation parameter measurably does, and why beat tracking is not the fix
  for spiky notes. **Read this before touching `lib/pitch.js` or anything consuming it.**
- [`docs/tuning-cases.md`](docs/tuning-cases.md) — a log of cases where a missing or wrong
  note came from a music-domain assumption (an instrument's tuning or range) baked into a
  detection parameter, not a coding bug. **Check this before chasing a "note missing" report
  as a fresh bug** — it may be the same shape as one already solved.
- [`docs/chord-detection.md`](docs/chord-detection.md) — the export-time chroma, vocal-key,
  bass-slash, and sequence-decoder pipeline; its real-fixture regression check and known
  limitations. **Read this before changing chord scoring or progression priors.**
- [`docs/deployment.md`](docs/deployment.md) — how the site is hosted: GitHub Pages off the
  `gh-pages` branch, the three CI workflows, per-PR preview URLs, and the rules that keep
  `rips/`, `stems/` and the model unpublished. **Read this before touching
  `.github/workflows/`.**
- [`docs/roadmap.md`](docs/roadmap.md) — work that is wanted but not built: note editing,
  automatic octave folding, YouTube-link ingest. An index pointing at where each is
  specified, plus the question that has to be settled before each can be designed.
- [`docs/session-prompts.md`](docs/session-prompts.md) — the prompts that produced the
  original build, timestamped from filesystem evidence.

## Gotchas that will bite again

- **There are exactly two ways in, and that is the design.** One audio file (a whole song,
  which is also the separation entry point), or one `.zip` of stems. Since v1.6.0 both go
  through a single **Load song or zip** button and a single `#file-input`; `loadAny()`
  dispatches on the extension. Drop accepts the same two things and nothing else. Don't
  re-add multi-file loading or folder drop "for convenience" — each extra path was a way to
  fail silently. And keep `#file-input` clearing its own `value` on change, or picking the
  same file twice in a row is a silent no-op.
- **Folder drop is deliberately unsupported — don't add it back.** It needed the directory
  entries API, which Chrome blocks on `file://`, so it only ever worked over http and failed
  silently otherwise. v1.3.0 deleted the recursive walk (`walkEntry`/`fsCall`, ~40 lines); a
  zip does the same job on every protocol. A dropped folder is still *detected*, purely to
  tell the user to zip it — that message is the feature, not a leftover.
- **Callback-pair DOM APIs need their error callback wired.** No longer live in this repo —
  `fsCall` went with the folder walk — but the lesson is why that code existed:
  `new Promise(res => reader.readEntries(res))` hung forever on a blocked read, with no error
  anywhere. If you ever wrap a `(successCb, errorCb)` API, wire both and add a timeout.
- **`AudioContext` stays `suspended` until a real user gesture.** Under browser automation,
  synthetic clicks on the play button silently fail to unlock it; a real `space` keypress
  works. If the clock reads 0 while `playing` is true, this is why.
- **A looping source never fires `onended`** — end-of-song detection is attached only when
  `!src.loop`.
- **The AudioContext must be 44.1 kHz.** `decodeAudioData` resamples to the context rate,
  and the separation model requires 44100. A default context is often 48 kHz on macOS,
  which would feed the model stretched audio and produce wrong stems with no error at all.
- **A mix file alongside stems must carry `stem: 'mix'` explicitly.** With seven tracks the
  lone-file rule in `assignStems` does not fire, and a real song title matches none of the
  deliberately narrow mix patterns — so the mix would be summed on top of its own six stems
  at double volume. Covered by a test in `tests/stems.test.js`. In-browser separation avoids
  the question by dropping the original: `loadSeparated` builds lanes from the six stems
  only, which is also why `__hasStems` is false there and every lane starts unmuted.
- **Cache-busting is now Vite's content hash, not a hand-written `?v=`.** GitHub Pages still
  pins everything to `max-age=600` with no way to override it, but every asset Vite's build
  touches — every entry HTML's `<script src>`/`<link href>`/`<img src>`, and every
  `new Worker(new URL(...))` / `addModule(new URL(...))` reference — gets a content hash
  baked into its filename, so a stale `app.js` against a fresh `index.html` is no longer
  reachable: the fresh `index.html` points at the fresh `app.js`'s hashed name, not the old
  one. There is no version to bump by hand, and no `tests/versions.test.js`-shaped test is
  needed — it was deleted along with the manual `?v=` convention it guarded.
- **Separation is desktop-only, and that is not fixable from this repo.** On iOS the first
  `session.run()` kills the tab; the accumulators, the 285 MB model, the memory floor,
  WebGPU and asyncify were each ruled out by measurement, and `N_SAMPLES = 343980` is baked
  into the ONNX graph. `lib/platform.js` answers the question — coarse primary pointer AND
  `maxTouchPoints > 1`, both required — and `separate.js` reads it **once** at module init
  (`refresh()` runs every 400 ms). The test is capability-shaped on purpose: iPadOS reports
  itself as a Mac, so `/iPhone|iPad/` would miss it entirely, and Android phones very likely
  fail the same way. Don't try to make separation run there.
- **UI strings live in `lib/i18n.js`, and both locales must move together.** `data-i18n`
  sets `textContent`, `data-i18n-html` sets `innerHTML` (our own dictionary values only,
  never user data), `data-i18n-attr` sets attributes. Adding a key to one locale and
  forgetting the other is caught by `tests/i18n.test.js`, as is a `{placeholder}` that
  drifts between them. Lane labels translate; **stem ids and filenames never do** — a
  saved zip is `vocals.wav` in every language.
- **Top-level wiring goes through `on()`, never `addEventListener` directly.** Same reason: a
  single null element must not be able to take out the rest of the app. If you add a listener
  at the top level of `app.js`, use the helper.
- **A class that sets `display` silently defeats the `hidden` attribute.** `[hidden]` is a
  UA-stylesheet rule, and *any* author rule beats it — `.btn { display: inline-block }` left
  Save, Cancel and the loop badge on screen while their `.hidden` property read `true`.
  Verifying with `el.hidden` or `hasAttribute('hidden')` passes while the user still sees the
  button; check `getComputedStyle(el).display`. `styles.css` now carries a global
  `[hidden] { display: none !important; }` that every hidden-toggle in the app depends on.
- **`numThreads = 1` is load-bearing, not a performance tweak.** It avoids SharedArrayBuffer,
  which avoids COOP/COEP, which is what makes static hosting (GitHub Pages) possible at all.
- **ZIP filenames need general purpose bit 11 set.** Without it the spec says names are
  CP437, and every Chinese song title extracts as mojibake. macOS's bundled Info-ZIP
  `unzip` ignores the bit anyway and still displays garbage — verify with `ditto -xk`,
  `bsdtar` or Python's `zipfile`, not `unzip -l`.
- **The overlap window barely matters.** Overlap-add normalises by the weight sum, so the
  output is a weighted average of near-identical predictions. Trapezoid and raised cosine
  measured identical to three decimals. Don't spend time tuning it.
- **Check a workflow's *conclusion*, not that it ran.** Two workflows sharing a concurrency
  group let GitHub cancel one as "pending"; the v1.2.0 merge deployed nothing and reported
  no failure anywhere. Same rule as audio here: observe the outcome, not the parameters.
- **Before testing ANYTHING against a real deploy — smoke test or otherwise — check the
  page's own `#build-sha` corner badge first**, not just that the workflow's conclusion was
  `success`. GitHub Pages pins `index.html` itself to `Cache-Control: max-age=600`
  independent of the content-hashed asset names, and a v1.24.0 verification session was
  fooled by exactly this: `deploy-main.yml` had already succeeded, but the loaded page kept
  serving the previous build's `main-*.js` and silently reproduced the pre-fix bug, looking
  like a real regression. Compare `#build-sha`'s text against the commit you expect —
  `git rev-parse --short HEAD` on `main` for a production check, or
  `gh pr view <N> --json mergeCommit --jq .mergeCommit.oid` for a PR preview (its badge is
  GitHub's synthetic merge-commit SHA, not the branch's own tip — see the v1.25.0 devlog
  entry). On a mismatch, reload with a cache-busting query string or a fresh tab and check
  again before concluding anything — a `deploy-main.yml`/`pr-preview.yml` success does not
  by itself mean the browser in front of you is showing that build yet.
- **`rsync -a` skips a changed file of the same size** (it compares size + mtime). The deploy
  workflows use `-c`. Without it the site serves stale content and nothing errors.
- **Demucs setup:** Python 3.12 (no PyTorch wheels for 3.14), install `numpy` explicitly
  (demucs 4.1.0 doesn't declare it), skip `torchaudio`. Probe for MPS with the venv's own
  interpreter — a bare `python3` is the system one and has no torch, which silently drops
  every run to CPU.
- **Near-silent `piano`/`other` stems are correct** for a guitar band, not a bug. Verify with
  `ffmpeg -af volumedetect` before chasing it.
- **`htdemucs_6s` is the only model that splits out guitar.** Don't switch to plain `htdemucs`.
- **`allow_local` is deliberately not set.** GoatCounter filters localhost and private-IP
  requests, so events fired from `npm run dev` silently vanish — which looks exactly
  like broken instrumentation. Verify with `SansAnalytics.setSink(console.log)` instead;
  flip `allow_local` only if the network leg itself needs proving, and never commit it.
- **`play` is instrumented in `toggle()`, not `play()`.** `play()` is re-entered by `seek()`
  and `refreshLoop()`, so counting there would fire on every scrub during playback.
- **No event name may carry user content.** Stem ids come from `t.stem`, never
  `laneLabel()`. An empty `title` is passed to GoatCounter explicitly: it fills that field
  from the surrounding element or the document title when omitted. Harmless today, because
  `document.title` is always the static `app.title` string — but making the title dynamic
  (`"<song> — sans_bass"`) is an obvious future change, and it would silently start putting
  song names in the payload. Pin the field rather than relying on the title staying static.

## Working conventions

- **Git repository** with `rips/` and `stems/` gitignored (the `.gitkeep` files are kept).
  Devlog timestamps come from `git log`.
- **Every session starts on a branch and lands on `main` through a PR.** Never commit to
  `main` directly — not for code, not for docs, not for a one-line fix. Branch first, before
  the first commit, using the existing prefixes: `feat/`, `fix/`, `ui/`, `docs/`, `spike/`.
  This is not ceremony. Each PR gets its own live preview at `/pr-<N>/`
  (see [`docs/deployment.md`](docs/deployment.md)), so the branch is the only way to click
  through a change before it reaches the published site — and `main` publishes to the root
  the moment it moves. A design-only session branches too; the spec is reviewed the same way
  the code is.
- **Executing a plan ends with the Deployment smoke test against a real deploy, twice —
  not just local verification.** Once the PR is open and `pr-preview.yml` succeeds, run
  [`docs/behaviour.md`](docs/behaviour.md)'s Deployment smoke test section against
  `https://sansword.github.io/sans_bass/pr-<N>/`; once merged and `deploy-main.yml`
  succeeds, run it again against `https://sansword.github.io/sans_bass/`. Check each
  workflow's *conclusion*, not just that it ran (see the gotcha below — a cancelled run
  reports no failure anywhere) — **and check `#build-sha` against the expected commit
  before the smoke test's own step 1** (see the `#build-sha` gotcha below); a workflow
  succeeding does not mean the page you're about to test is that build yet. This catches
  what only a real HTTPS deploy exposes —
  cross-origin fetches (the ONNX runtime, the model), WebGPU, Cache Storage — on top of,
  not instead of, `npm run dev` / `npm run build` + `npm run preview` during the work
  itself. A plan can note these as its own final steps, but the routine holds regardless of
  whether the plan spells it out.
- **Unit tests run under `npm test` (Vitest), CI-gated on every PR.** `vitest.config.js`
  splits `tests/*.test.js` into three tiers by what each file actually needs — plain Node,
  jsdom (for the files that assign a `window.SansX` bridge or touch `document` at module
  load), or headless Chromium via Playwright (for real `AudioContext`/`OfflineAudioContext`
  or a real module `Worker`, neither of which Node or jsdom implements) — see the comment
  at the top of that file before moving a test between tiers. `tests/parity.html` is a
  separate, manual browser page for separation accuracy against the native stems in the
  repo (read `window.__parity`); it needs `npm run dev` (or `npm run build` plus
  `npm run preview`) and is not part of `npm test` since it needs local-only `rips/`/`stems/`
  audio that CI never has. Everything the unit tests cannot reach — the whole UI — is
  specified in [`docs/behaviour.md`](docs/behaviour.md), harness included.
- **Versioning:** three-part semver. `vX.Y.0` for releases, `vX.Y.1` for follow-up sessions,
  `vX.Y.0-design` for design-only sessions. Devlog headings, TL;DR anchors, and any tags match.
- **Devlog at end of session.** Newest-first, update the TL;DR table with an anchor link, and
  tag every learning bullet `[note]` / `[insight]` / `[gotcha]`.
- **[`docs/behaviour.md`](docs/behaviour.md) is part of the diff.** A behaviour change that
  does not update it leaves the two disagreeing, and the doc is what the next session trusts.
- **Verify audio behaviour by observing audio, not parameters.** Loop bounds being set is not
  evidence the audio wraps; sampling the playhead across laps is. Fault-inject where the real
  environment can't be reproduced (`file://` is not reachable from browser automation).
