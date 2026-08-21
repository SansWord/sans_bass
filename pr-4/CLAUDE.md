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
  installed. The player core is `index.html`, `styles.css`, `app.js` plus `lib/stems.js`,
  and it must keep working when opened as `file://` by double-clicking it. Separation adds
  ES modules that load only over HTTP and never touch that path.
- **Nothing leaves the machine.** No uploads, no analytics, no audio egress ever. Inbound
  fetches are allowed and necessary: the ONNX runtime from jsDelivr and the ~285 MB model
  from Hugging Face. Keep the distinction — "no outbound audio", not "no network calls".
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
  `lib/wav.js` and `lib/zip.js` handle saving. It is loaded **only over HTTP** — `index.html`
  injects the module conditionally, because Chrome blocks `<script type="module">` on
  `file://` and the player must survive being double-clicked. `app.js` therefore stays a
  classic script, and `lib/stems.js` is a classic script too so both it and the tests can
  use it.
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
index.html  styles.css  app.js     the player (classic scripts — file:// safe)
lib/stems.js                       stem identity, classic script, shared with the tests
lib/{wav,zip,overlap}.js           ESM — WAV encode, ZIP write, segment planning
separate.js  separate.worker.js    ESM — separation panel and the ORT inference loop
tests/test.html                    units      → window.__testResults
tests/parity.html                  accuracy   → window.__parity
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
- [`docs/deployment.md`](docs/deployment.md) — how the site is hosted: GitHub Pages off the
  `gh-pages` branch, the three CI workflows, per-PR preview URLs, and the rules that keep
  `rips/`, `stems/` and the model unpublished. **Read this before touching
  `.github/workflows/`.**
- [`docs/session-prompts.md`](docs/session-prompts.md) — the prompts that produced the
  original build, timestamped from filesystem evidence.

## Gotchas that will bite again

- **Folder drag-and-drop cannot work on `file://`.** Chrome refuses the directory read. The
  Load folder button (`<input webkitdirectory>`) always works. Don't "fix" the drop path.
- **Callback-pair DOM APIs need their error callback wired.** `fsCall` in `app.js` exists
  because `new Promise(res => reader.readEntries(res))` hung forever on a blocked read, with
  no error anywhere. There is a 5 s timeout as a backstop.
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

## Working conventions

- **Git repository** with `rips/` and `stems/` gitignored (the `.gitkeep` files are kept).
  Devlog timestamps come from `git log`.
- **Tests are browser pages, not a runner.** `tests/test.html` for units (read
  `window.__testResults`), `tests/parity.html` for separation accuracy against the native
  stems in the repo (read `window.__parity`). Both need `./scripts/serve.sh`. There is no
  npm and none may be added.
- **Versioning:** three-part semver. `vX.Y.0` for releases, `vX.Y.1` for follow-up sessions,
  `vX.Y.0-design` for design-only sessions. Devlog headings, TL;DR anchors, and any tags match.
- **Devlog at end of session.** Newest-first, update the TL;DR table with an anchor link, and
  tag every learning bullet `[note]` / `[insight]` / `[gotcha]`.
- **Verify audio behaviour by observing audio, not parameters.** Loop bounds being set is not
  evidence the audio wraps; sampling the playhead across laps is. Fault-inject where the real
  environment can't be reproduced (`file://` is not reachable from browser automation).
