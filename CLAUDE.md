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

- **No build step, no dependencies, no framework.** Vanilla JS, no bundler, no npm, nothing
  installed. The player core is `index.html`, `styles.css`, `app.js` plus `lib/stems.js`
  and `lib/unzip.js`. The site is served over HTTP — GitHub Pages, or `./scripts/serve.sh`
  locally. `file://` support was dropped in v1.5.0; `lib/stems.js`, `lib/unzip.js` and
  `lib/i18n.js` are still classic scripts only because the ESM migration is a separate
  change.
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
  `file://` support in v1.5.0. `app.js` stays a classic script, and `lib/stems.js`,
  `lib/i18n.js` and `lib/platform.js` are classic too so both they and the tests can use
  them. Since v1.8.0 the whole panel is **gated to desktop** — see the handheld gotcha below.
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
index.html  styles.css  app.js     the player (classic scripts)
lib/stems.js                       stem identity, classic script, shared with the tests
lib/unzip.js                       zip reading, classic script — window.SansUnzip.extract
lib/i18n.js                        zh-TW/en dictionary + runtime, classic script
lib/platform.js                    isHandheld() device predicate, classic script
lib/{wav,zip,overlap}.js           ESM — WAV encode, ZIP write, segment planning
lib/pitch.js                       ESM — YIN, candidates, Viterbi decoding, segmentation,
                                   octave folding, key
lib/sonify.js                      ESM — plays detected notes back as tones
lib/ribbon.js                      ribbon geometry, classic script — window.SansRibbon
lib/jianpu.js                      簡譜 degrees, classic script — window.SansJianpu
separate.js  separate.worker.js    ESM — separation panel and the ORT inference loop
notes.js  notes.worker.js          ESM — notes panel and the analysis worker
tests/test.html                    units      → window.__testResults
tests/parity.html                  accuracy   → window.__parity
tests/notes.html                   notes+key  → window.__notes
.github/workflows/                 Pages deploy + per-PR previews (see docs/deployment.md)
scripts/serve.sh                   http://localhost:8777 (required for separation)
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
- [`docs/devlog.md`](docs/devlog.md) — version-by-version log with tagged learnings
  (`[note]` / `[insight]` / `[gotcha]`). **Read the v1.0.0 and v1.1.0 entries before touching
  the transport or the loader** — most of the non-obvious traps are already written down there.
- [`docs/behaviour.md`](docs/behaviour.md) — what the player is supposed to *do*, as
  observable outcomes with a way to observe each one, plus the browser-test harness (faking
  a separation run, reading gain ramps, the traps that make a working app look broken).
  **Read this before changing UI behaviour, and update it in the same commit when you do.**
- [`docs/transcription.md`](docs/transcription.md) — how a stem becomes notes: the four
  layers (audio → frames → notes → edits), which are re-derivable and which can be lost,
  what each interpretation parameter measurably does, and why beat tracking is not the fix
  for spiky notes. **Read this before touching `lib/pitch.js` or anything consuming it.**
- [`docs/tuning-cases.md`](docs/tuning-cases.md) — a log of cases where a missing or wrong
  note came from a music-domain assumption (an instrument's tuning or range) baked into a
  detection parameter, not a coding bug. **Check this before chasing a "note missing" report
  as a fresh bug** — it may be the same shape as one already solved.
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
- **Serve with `ThreadingHTTPServer`, not `python3 -m http.server`.** The single-threaded
  default wedges on files this size: browser `fetch` hangs forever while `curl` returns instantly.
- **The AudioContext must be 44.1 kHz.** `decodeAudioData` resamples to the context rate,
  and the separation model requires 44100. A default context is often 48 kHz on macOS,
  which would feed the model stretched audio and produce wrong stems with no error at all.
- **A mix file alongside stems must carry `stem: 'mix'` explicitly.** With seven tracks the
  lone-file rule in `assignStems` does not fire, and a real song title matches none of the
  deliberately narrow mix patterns — so the mix would be summed on top of its own six stems
  at double volume. Covered by a test in `tests/stems.test.js`. In-browser separation avoids
  the question by dropping the original: `loadSeparated` builds lanes from the six stems
  only, which is also why `__hasStems` is false there and every lane starts unmuted.
- **Every local asset URL carries `?v=<version>` and they must all match.** GitHub Pages pins
  everything to `max-age=600` with no way to override it, so for ten minutes after a deploy a
  returning visitor can run a stale `app.js` against a fresh `index.html`. That is not a
  degraded page — the old script throws on an element the new markup dropped, and because
  `app.js` wires everything from one flat run of top-level statements, every listener *below*
  the throw silently never registers. Bump the version in `index.html` (16), `app.js` (1),
  `lib/stretch-processor.js` (1), `separate.js` (3), `separate.worker.js` (1), `notes.js` (4)
  and `notes.worker.js` (2) — 28 in all; `tests/versions.test.js` fails if they drift — and
  it covers `.png` and `.svg` as well as `.js`/`.css`, so the icons are included. Currently
  `v1.19.0`.
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
- **`serve.sh` sends `Cache-Control: no-store`** because Chrome otherwise serves a stale
  ES module after you edit it, and the test page silently checks the old code — which looks
  exactly like a correct fix failing.
- **Check a workflow's *conclusion*, not that it ran.** Two workflows sharing a concurrency
  group let GitHub cancel one as "pending"; the v1.2.0 merge deployed nothing and reported
  no failure anywhere. Same rule as audio here: observe the outcome, not the parameters.
- **`rsync -a` skips a changed file of the same size** (it compares size + mtime). The deploy
  workflows use `-c`. Without it the site serves stale content and nothing errors.
- **Demucs setup:** Python 3.12 (no PyTorch wheels for 3.14), install `numpy` explicitly
  (demucs 4.1.0 doesn't declare it), skip `torchaudio`. Probe for MPS with the venv's own
  interpreter — a bare `python3` is the system one and has no torch, which silently drops
  every run to CPU.
- **Near-silent `piano`/`other` stems are correct** for a guitar band, not a bug. Verify with
  `ffmpeg -af volumedetect` before chasing it.
- **`htdemucs_6s` is the only model that splits out guitar.** Don't switch to plain `htdemucs`.
- **GoatCounter's script tag must be `https://`, not protocol-relative.** Their docs give
  `//gc.zgo.at/count.js`. `tests/versions.test.js` exempts external URLs with
  `url.startsWith('http')`, so a protocol-relative URL is treated as a local asset missing
  its `?v=` and fails the suite.
- **`allow_local` is deliberately not set.** GoatCounter filters localhost and private-IP
  requests, so events fired from `scripts/serve.sh` silently vanish — which looks exactly
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
- **Tests are browser pages, not a runner.** `tests/test.html` for units (read
  `window.__testResults`), `tests/parity.html` for separation accuracy against the native
  stems in the repo (read `window.__parity`). Both need `./scripts/serve.sh`. There is no
  npm and none may be added. Everything the unit tests cannot reach — the whole UI — is
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
