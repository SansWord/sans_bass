# Devlog

Running log of what was built and what was learned building it.

### Learning tags

| Tag | Meaning |
|-----|---------|
| `[note]` | Useful context, well-documented — good to have written down but you'd find it in the docs |
| `[insight]` | Non-obvious; meaningfully changes how you design or debug something |
| `[gotcha]` | A specific trap that bit you; high risk of biting you again — bookmark this |

## TL;DR

| Version | Summary |
|---------|---------|
| [v1.3.0](#v130--load-stems-from-a-zip-2026-08-21-0004) | Load zip replaces Load folder; a classic-script zip reader that never holds the whole file. |
| [v1.2.2](#v122--separation-panel-and-lane-toggle-refinements-2026-08-20-2310) | UI refinements: lane clicks toggle instead of solo, separation drops the original track and stops playback, an Unmute all / Restore previous control, and a repaired `[hidden]` rule that had been showing buttons meant to be hidden |
| [v1.2.1](#v121--github-pages-deployment-with-pr-previews-2026-08-20-2105) | Published to GitHub Pages with per-PR preview deployments; every pull request gets a live URL at `/pr-N/` before it reaches production |
| [v1.2.0](#v120--in-browser-stem-separation-2026-08-20-2043) | Six-stem separation running entirely in the browser via onnxruntime-web + htdemucs_6s, at ~8x realtime on WebGPU, with stems saveable as one ZIP of WAVs |
| [v1.1.0](#v110--a-b-repeat-loop-2026-08-13) | A-B repeat: `a`/`b` set loop points, looping runs on the audio thread so all six stems stay sample-locked |
| [v1.0.1](#v101--drag-and-drop-repair-2026-08-13) | Fixed folder drag-and-drop dying silently; a callback-pair API wrapped without its error path hung the handler forever |
| [v1.0.0](#v100--cd-to-browser-stem-player-2026-08-13) | CD → FLAC → Demucs stems → browser multitrack player with per-instrument waveforms and solo |

---

## v1.3.0 — Load stems from a zip (2026-08-21 00:04)

**Review:** not yet

**Design docs:**
- Load a zip of stems: [Spec](superpowers/specs/2026-08-20-load-zip-design.md) [Plan](superpowers/plans/2026-08-20-load-zip.md)

**What was built:**
- `lib/unzip.js` — a classic-script zip reader, `window.SansUnzip.extract`.
- **Load zip** replaces **Load folder**. Folder *drop* is kept for `http://`.
- Dropping a `.zip` works on `file://`, which folder loading never could.

**Key technical learnings:**
- `[insight]` A zip removes a `file://` limitation instead of adding one. A folder needs the
  directory entries API, which Chrome blocks from disk; a `.zip` is a plain file and arrives
  in `dataTransfer.files` anywhere.
- `[insight]` The tail-parse is load-bearing, not a micro-optimisation. Reading the whole zip
  into one ArrayBuffer costs ~848 MB peak for a 200-second six-stem WAV zip against ~636 MB
  for per-entry slices — close enough to Chrome's per-tab ceiling to fail on a longer song.
  A `File` from an `<input>` is disk-backed, so `blob.slice()` is free until awaited.
- `[insight]` `decodeAudioData` **detaches** its input, which is why eager extraction costs no
  more memory than lazy — and why every entry needs its own exact-size buffer. Two entries
  sharing one allocation would mean decoding the first detaches the second.
- `[gotcha]` The local header's extra-field length may differ from the central directory's.
  Compute the data offset from the *local* header or you land mid-file. Sizes, conversely,
  must come from the central directory — with general purpose bit 3 set the local sizes are
  zero and the real ones trail the data.
- `[gotcha]` Finder's "Compress" writes an AppleDouble `__MACOSX/._name` per file. Unfiltered,
  a six-stem zip yields twelve entries and `._bass.wav` competes for the bass lane.
- `[gotcha]` `zip -r` does **not** set general purpose bit 11, so Python's `zipfile` renders a
  Chinese song title as CP437 mojibake while the player shows it correctly. Decoding names as
  UTF-8 unconditionally is what makes `1 基隆路` survive; a spec-faithful CP437 fallback would
  have broken the real archive the feature was built for.
- `[gotcha]` Deleting a button means auditing every string that names it. Two `file://`
  messages, a code comment, and five README lines still said "Load folder" after it was gone.
- `[gotcha]` The play button's state lives in a `.playing` class on the *button*; the inner
  `<span>` keeps `class="ico-play"` and CSS swaps the glyph. Probing the span to ask "is it
  playing?" reads as paused forever — check `#play.classList.contains('playing')`.
- `[note]` `DecompressionStream('deflate-raw')` handles method 8 with no library. Store-only
  zips must still load where it is unavailable, so feature-detect per entry, not up front.

---

## v1.2.2 — Separation panel and lane toggle refinements (2026-08-20 23:10)

**Review:** not yet

**Behaviour spec:** [`docs/behaviour.md`](behaviour.md) — written this session; it is the
reference for every item below and is expected to be updated alongside future behaviour changes.

**What was built:**

- **Save stems is disabled while a run is in flight.** The stems it would have written are
  the *previous* track's, and encoding them competes with the worker for memory.
- **The Separate button disappears once a song is separated** and returns when a fresh
  single track is loaded.
- **Clicking a lane name toggles that lane** instead of soloing it. Soloing moved entirely
  to the Play dropdown; `soloTrack` is gone.
- **Removed the "Use a local .onnx" picker.** `separate.worker.js` still accepts a
  `modelBuffer`, so the capability survives if the UI is ever wanted back.
- **Separation output drops the original track.** The six stems already sum to it, so
  keeping it meant either doubled audio or permanent suppression.
- **Separation stops playback and rewinds.** The mix can still be playing when the stems
  land; its BufferSources are not in `tracks` and would keep sounding over the new lanes.
- **Fixed a CSS bug that had been suppressing every `hidden` toggle in the app**, including
  the two above (see the learnings).
- **The lane click target now fills the left column**, from the lane's left edge to the
  number badge, at full lane height. The waveform column still seeks.
- **An Unmute all button** next to the Play dropdown, doing what `0` does so the behaviour
  is not hotkey-only. Pressing it again returns to the lanes that were on before, and it
  relabels itself — **Unmute all** / **Restore previous** — from the live mute state.
- **The "done" status text is gone.** Six lanes where there was one is the confirmation.
- **The unmute-all button matches Save stems** (`btn ghost`). Its disabled style was scoped
  to `.sep .btn[disabled]` and so had never applied outside the separation panel; the rule
  moved up to `.btn[disabled]`.
- **[`docs/behaviour.md`](behaviour.md)**, a spec of every expected behaviour as an
  observable outcome plus the way to observe it, and the browser-test harness that goes with
  it. `CLAUDE.md` now requires it to be updated in the same commit as a behaviour change.

**Key technical learnings:**

- `[insight]` **Deleting the mix track was the fix for three problems at once.** "All lanes
  on by default" needed no new code: with no `mix` track, `hasMixPlusStems()` is false, so
  the existing `setMode('mix')` already leaves every stem unmuted. It also removed the
  doubled-audio trap from the separation path entirely, and removed the awkward case where
  a lane is visible but permanently forced silent by `applyGains`. The feature request was
  phrased as three UI tweaks; one deletion answered all of them.
- `[insight]` **A per-lane toggle cannot be uniform when one lane is mutually exclusive with
  the rest.** A full-mix file must never sound over its own stems, so the mix lane keeps
  mode-switching semantics inside `toggleTrack` while every other lane toggles its own gain.
  Only reachable now via a folder loaded from disk that genuinely holds both — but that is
  exactly the case nobody will be testing when they next touch this.
- `[gotcha]` **A class that sets `display` silently defeats the `hidden` attribute.**
  `[hidden] { display: none }` lives in the UA stylesheet, so *any* author rule outranks it —
  `.btn { display: inline-block }` and `.loop-badge { display: inline-flex }` meant Save,
  Cancel and the loop badge rendered while their `.hidden` property read `true`. This
  predates this session: the loop badge has shown a stray Clear button since v1.1.0. It also
  quietly voided the new "hide Separate once done" behaviour. The trap for verification is
  that `el.hidden` is the *state*, not the *appearance* — asserting on the property passes
  while the user still sees the button. A screenshot caught what four property assertions
  had missed. `styles.css` now has a global `[hidden] { display: none !important; }`.
- `[insight]` **A grid item with `align-items: center` is only as tall as its content.**
  `.lane-name` was a full-width 128px column but a ~14px strip inside a ~56px lane, so the
  toggle only really worked on the text. `align-self: stretch` plus negative margins that
  swallow the lane's own padding make the whole left block clickable.
- `[insight]` **The undo snapshot is taken when everything is turned on, not when a lane is
  muted.** That one choice is what makes the sequence behave: mute a lane while all-on, press
  `0`, press `0` again, and you land back on *that* lane state rather than on whatever was
  saved two presses earlier. Storing it at mute time instead would strand the older state.
- `[note]` The unmute-all button relabels itself inside `applyGains` rather than at each
  call site. Every mute path already routes through there, so the label cannot drift out of
  sync with the lanes — including mutes triggered by the dropdown or the number keys.
- `[gotcha]` **A scoped disabled style is invisible until something moves.**
  `.sep .btn[disabled]` had always been written that way, so it worked for Save stems and
  silently did nothing for any other button. Worth checking the scope of any state style
  before reusing the class it hangs off.
- `[note]` The `1`–`6` keys have always called `toggleTrack`, so lane clicks and the number
  keys finally agree. The README had described `2` as "mute everything but the guitar",
  which was never what the key did.

**Process learnings:**

- `[gotcha]` **Chrome throttles `setInterval` to ~1 Hz in a backgrounded tab, and the
  automation tab is always backgrounded.** `separate.js` polls `refresh()` every 400 ms;
  under automation it runs about once a second. A verification step waited 1.2 s for the
  Separate button to reappear, saw it still hidden, and looked exactly like a broken fix.
  Measured it directly — `document.visibilityState` is `hidden`, and a fresh 400 ms interval
  ticked twice in two seconds — then waited longer and the behaviour was correct all along.
  Same family as the rAF-throttling rule this project already knows; it applies to the test
  harness as much as to the player.
- `[insight]` **Stub `window.Worker`, not the model.** Replacing the constructor just before
  clicking Separate exercises every line of `separate.js`'s real message handling —
  `busy()`, the `result` branch, `loadSeparated` — with no 285 MB download and no minutes of
  inference. `getWorker()` constructs lazily at click time, which is what makes the seam
  reachable from the page.
- `[gotcha]` **A same-URL navigation can reuse the stylesheet from memory cache**, even
  though `serve.sh` sends `no-store` and `curl` shows the new bytes. The served file had the
  fix and the loaded `document.styleSheets` did not. Re-pointing the `<link>` at
  `styles.css?v=<now>` forces it. Same shape as the stale-ES-module trap already documented,
  but the existing `no-store` header does not cover it.
- `[insight]` **Verify muting on the gain values, not the CSS class.** Patching
  `AudioParam.prototype.setTargetAtTime` to record every ramp showed what actually reached
  the audio graph: clicking Vocals sent it to 1 while Drums stayed at 0. `tracks` is a
  classic-script local and unreachable from the console, so this is also the only way in.
- `[insight]` **The harness knowledge was worth more than the fixes.** Five sessions of UI
  work produced maybe eighty lines of behaviour change and a page of hard-won technique:
  stub the Worker constructor, read gain ramps, assert on computed `display`, force the
  stylesheet with a cache-buster, allow for throttled timers, send a real `space`. None of
  it is discoverable from the code. That is why it lives in
  [`docs/behaviour.md`](behaviour.md) rather than only here.

---

## v1.2.1 — GitHub Pages deployment with PR previews (2026-08-20 21:05)

**Review:** not yet

**What was built:**

- The project is public at <https://sansword.github.io/sans_bass/>, served by GitHub Pages
  from a `gh-pages` branch with no backend and no build step.
- Three workflows: `deploy-main.yml` publishes `main` to the site root, `pr-preview.yml`
  publishes every pull request to `/pr-<N>/` and posts a sticky comment with the links, and
  `pr-preview-cleanup.yml` removes the directory when the PR closes.
- [`docs/deployment.md`](deployment.md) documents the whole arrangement.
- Verified on the real deployment, not just locally: 27/27 unit tests at the deployed URL,
  the ONNX runtime loading from jsDelivr, all 285 MB of the model fetched from Hugging Face,
  `ready: webgpu`, and a second load served from Cache Storage in 0.5 s.

**Key technical learnings:**

- `[gotcha]` **Two workflows sharing a concurrency group can silently cancel a deploy.**
  Merging a pull request fires `deploy-main` (push to `main`) and `pr-preview-cleanup`
  (PR closed) simultaneously. With both in one group, one ran and the other went pending —
  and GitHub cancels a pending run the moment another joins the group. On the v1.2.0 merge
  the casualty was `deploy-main`: production never deployed, the root served a placeholder,
  and nothing anywhere reported a failure. Each workflow now owns its group. The real
  protection against concurrent writes was never the shared lock — it is the
  `git pull --rebase` retry loop plus the fact that the workflows touch disjoint paths.
- `[gotcha]` **`rsync -a` decides by size and mtime, so it skips a changed file of identical
  size.** A production sync would have published stale content. Found by fault-injecting the
  sync against a fixture rather than by watching the site: every other assertion in that test
  passed while `index.html` quietly stayed at the old version. Both workflows now use `-c`.
- `[gotcha]` **An orphan branch does not inherit `.gitignore`.** Fresh `gh-pages` did not
  ignore `rips/` or `stems/`, so a stray `git add -A` while checked out there would have
  staged ~860 MB of commercial recordings. `.gitignore` is committed on that branch now.
- `[note]` `.nojekyll` has to be recreated after every sync, because the root sync uses
  `--delete`. Protecting it with an rsync filter *and* touching it each run makes it
  impossible to lose.
- `[note]` GitHub Pages has no native per-branch preview URL — one repository gets one site
  from one source. Per-PR previews are just subdirectories of the one published branch, with
  production carefully protected from deleting them (`--filter 'protect pr-*'`).
- `[insight]` **A hosted preview tests something localhost cannot.** The one thing that
  genuinely changes between `./scripts/serve.sh` and a public HTTPS origin is cross-origin
  fetching — jsDelivr for the runtime, Hugging Face for a 285 MB model, both dependent on
  those hosts' CORS headers. That is the reason a preview deployment earns its complexity
  here; for a site with no third-party fetches it would not.

**Process learnings:**

- `[insight]` **"The workflow ran" is not "the workflow succeeded."** The deploy was reported
  as cancelled in a run list that otherwise looked healthy, and the site simply kept serving
  its previous content. Checking the *conclusion* rather than the existence of a run is the
  same discipline this project already applies to audio: observe the outcome, not the
  parameters.
- `[insight]` The fix for a CI bug is best verified by the event that exposed it. Fixing the
  concurrency collision on a branch meant the pull request re-tested previews, and merging it
  re-tested the exact scenario that had failed — `Deploy main [push] completed/success`.

---

## v1.2.0 — In-browser stem separation (2026-08-20 20:43)

**Review:** not yet

**Design docs:**
- In-browser separation: [Spec](superpowers/specs/2026-08-20-in-browser-separation-design.md) [Plan](superpowers/plans/2026-08-20-in-browser-separation.md)

**What was built:**

- Six-stem separation running entirely in the browser via `onnxruntime-web` and
  `kramp/htdemucs-6s-webgpu-onnx`, at parity with the native pipeline on speed and close
  to it on output.
- `separate.worker.js` (inference), `separate.js` (panel), `lib/overlap.js`, `lib/wav.js`,
  `lib/zip.js`, and `lib/stems.js` extracted from `app.js`.
- Save stems as one ZIP of WAVs, laid out so unzipping gives a folder **Load folder** accepts.
- First dependency-free test harness for the project: `tests/test.html` (27 unit tests) and
  `tests/parity.html`.

**Measured results** (Apple Silicon, WebGPU, `htdemucs_6s`, trapezoid window):

| Track | Time | vocals | bass | guitar | drums |
|-------|------|--------|------|--------|-------|
| `1 基隆路` (200.4 s) | 23.9 s (8.4x) | 0.996 / 0 dB | 0.997 / 0 dB | 0.993 / +1.4 dB | 0.984 / +2.9 dB |
| `2 最後兩禮拜` (205.8 s) | 26.7 s (7.7x) | 0.997 / 0 dB | 0.997 / 0 dB | 0.992 / +1.6 dB | 0.985 / +0.6 dB |

Correlation / level delta against the native stems in `stems/reborn/`, at **zero sample lag
on every stem**. Note the ground truth is 160 kbps AAC: round-tripping our own WAV output
through the same encode caps correlation at 0.995 (drums), 0.996 (guitar), 0.999 (vocals),
1.000 (bass), so most of the drums and guitar gap is the measurement, not the separation.

**Key technical learnings:**

- `[insight]` **Picking the right model mattered more than the integration.** The obvious
  starting point (`timcsy/demucs-web`) strips STFT out of the ONNX graph and reimplements it
  in JS, which locks you to a 4-stem model with no guitar and to a WASM path running at
  0.1–0.3x realtime. A model with STFT baked in as Conv1d — contract `mix [1,2,343980]` →
  `stems [1,6,2,343980]` — deleted the entire spectrogram layer from our code and ran 30x
  faster. Check what the model's I/O contract lets you *delete* before adopting a library.
- `[insight]` `numThreads = 1` is an architectural decision, not a tuning knob. It avoids
  SharedArrayBuffer, which avoids COOP/COEP, which is the only reason this can be hosted on
  GitHub Pages — a host that cannot set response headers.
- `[insight]` **The overlap window question was a red herring, and measuring it said so.**
  The spec flagged native Demucs' raised-cosine cross-fade as the likely cause of guitar
  running hot. Both windows measured *identical to three decimal places* on every stem.
  Fault injection proved the parameter was really wired — exactly 25% of samples differed,
  precisely the overlap fraction — but by at most 0.0017. Overlap-add normalises by the sum
  of weights, so the output is a weighted average of near-identical predictions and the
  window shape barely survives it. Guitar is still ~+1.5 dB; the cause lies elsewhere.
- `[gotcha]` `decodeAudioData` resamples to the AudioContext's rate. A default 48 kHz context
  on macOS silently feeds the model stretched audio: no error, just subtly wrong stems.
- `[gotcha]` After separation there are seven tracks, so the lone-file "this is the mix" rule
  never fires and a real song title matches none of the mix filename patterns. The original
  would have been summed on top of its own stems at double volume. Caught by spec review
  before any code existed, and now pinned by a test.
- `[gotcha]` **A ZIP with UTF-8 filenames must set general purpose bit 11.** We wrote UTF-8
  bytes and left the flag clear, so per spec the names are CP437 and every Chinese song title
  extracted as mojibake — `unzip` then failed outright with "Illegal byte sequence". Worse,
  macOS's bundled Info-ZIP `unzip` ignores the bit even when set, so it *still* prints
  garbage and looks unfixed. Verify with `ditto -xk`, `bsdtar`, or Python's `zipfile`.
- `[gotcha]` **A dev server with no cache headers will lie to you.** After fixing the ZIP flag,
  the test kept failing while the file on disk and the server response were both correct —
  Chrome was serving a cached ES module to the test page. `serve.sh` now sends
  `Cache-Control: no-store`. A "correct fix that still fails" is a caching question first.
- `[insight]` Ground truth we already had made verification trivial. `stems/reborn/` is native
  `htdemucs_6s` output, so correctness became a correlation measurement rather than a
  listening opinion — and quantifying the AAC ceiling separated real error from measurement
  error.
- `[note]` The plan's parity gate (all stems ≥ 0.99) does **not** pass: drums lands at
  0.984–0.985 on both tracks. Against a 0.995 AAC ceiling the real shortfall is ~0.01. Left
  as measured rather than moving the threshold to make it green.
- `[note]` WebGPU only works here because the model was constant-folded to remove a
  `ConstantOfShape` op that ORT's WebGPU backend cannot run. The same weights unfolded fall
  back to WASM and are ~30x slower.

**Process learnings:**

- `[insight]` The spike was worth more than the estimate it replaced. Published figures said
  10–30 minutes per song; measurement said 24 seconds. Both were "true" — of different
  models on different backends. One afternoon of measurement changed the feature from
  not-worth-building to at-parity-with-native.
- `[gotcha]` Computing a segment count with a formula separate from the loop that consumes it
  produced `segment 35/34` in the spike. `segmentStarts()` is now the single source of truth
  and a test asserts the two agree.
- `[gotcha]` A unit test can probe the one input where two different things agree. The
  "these two windows differ" test sampled `i = OVERLAP/2` — exactly where the trapezoid and
  the raised cosine both equal 0.5 by construction — and failed against correct code. Scan a
  range, don't probe a point.

---

## v1.1.0 — A-B repeat loop (2026-08-13)

**Review:** not yet

**What was built:**

- `a` / `b` set the loop start and end at the playhead; `c` or `Esc` clears. Points can be
  set in either order and either can be moved mid-playback.
- Looping implemented with the Web Audio node's own `loop` / `loopStart` / `loopEnd`.
- Loop region shaded on every lane, with amber A/B markers and labels on the overview, plus
  a badge showing the bounds and span and a Clear button.
- Guard rails: seeking is clamped inside an armed loop, reversed points swap themselves,
  sub-0.1s loops are rejected with an explanation, and loading a new song clears the points.

**Key technical learnings:**

- `[insight]` Reach for the platform's own loop primitive. `loop`/`loopStart`/`loopEnd` on
  `AudioBufferSourceNode` runs on the audio thread, so it is sample-accurate, gapless at the
  wrap, and identical across all six stems. The obvious alternative — watch the playhead in
  JS and seek back to A — would re-seek six sources every lap, and scheduling jitter would
  smear them apart audibly on the drum track.
- `[insight]` Third time this project has learned the same lesson: **anything transport-related
  belongs on the audio graph, not in `requestAnimationFrame`.** rAF is throttled in background
  tabs, so a JS-driven loop would silently stop wrapping — exactly how end-of-song detection
  broke in v1.0.0. rAF is for drawing, and only drawing.
- `[gotcha]` A looping source never fires `onended`. The end-of-song handler therefore has to
  be attached conditionally (`if (!src.loop)`), or you either lose end detection or wire up a
  callback that can never fire.
- `[insight]` Snapping the playhead into `[A, B)` when playback starts keeps the position math
  to one line: `A + ((offset - A + elapsed) % span)`. Without the snap you have to model the
  pre-loop segment separately, because a source starting before `loopEnd` plays forward to
  `loopEnd` and only then jumps to `loopStart`.
- `[gotcha]` A stem shorter than `loopEnd` wraps at *its own* buffer end per spec, silently
  desyncing it from the others. Such sources are left unlooped so they simply fall silent
  instead. Never arises with Demucs output (identical lengths) but would with hand-assembled
  files.
- `[note]` The snap rule also buys the ergonomics for free: because pressing `b` leaves the
  playhead exactly at B, the loop jumps straight back to A with no extra keystroke. Press `a`
  at the start of a phrase, keep listening, press `b` when it ends.

**Process learnings:**

- `[gotcha]` `AudioContext` user activation is unreliable under browser automation. Synthetic
  clicks on the play button repeatedly failed to unlock audio (context stayed `suspended`,
  no exception, no clue), while a real `space` keypress unlocked it immediately. Worth
  reaching for a keypress first when testing audio in an automated browser.
- `[insight]` Verified the loop by sampling the playhead across multiple laps, not by checking
  that the loop parameters were set. The parameters being correct is not evidence the audio
  wraps — only `45.53 → 40.03 → … → 45.54 → 40.03` is.

---

## v1.0.1 — Drag-and-drop repair (2026-08-13)

**Review:** not yet

**What was built:**

- Fixed folder drag-and-drop failing with no feedback whatsoever.
- Promisified the FileSystem entry calls properly, with error callbacks wired up and a 5s
  timeout as a backstop.
- Every drop outcome now reports itself: blocked folder on `file://`, folder with no audio,
  unsupported files, or a successful load via the plain-file fallback.
- A hint that appears only on `file://` pointing at the Load folder button, and a README
  section covering the three ways to load.

**Key technical learnings:**

- `[gotcha]` **Wrapping a callback-pair API in a promise without its error path converts a
  handled failure into an invisible one.** `new Promise(res => reader.readEntries(res))` omits
  the error callback, so when Chrome refused the directory read the promise never settled, the
  `await` blocked forever, and the drop handler died mid-execution — no message, no console
  error, nothing. Applies to any `(successCb, errorCb)` API, which is most of the older DOM
  surface.
- `[insight]` A fallback placed after a potentially-hanging `await` is not a fallback. The code
  to fall back to `dataTransfer.files` was already written and correct — it was simply
  unreachable, because execution never returned from the hung await above it. Worth asking of
  any fallback: can control actually *reach* you?
- `[gotcha]` Chrome will not let a `file://` page read a dropped **folder**; plain file drops
  are fine. So folder drag-and-drop is the one loading path that cannot work from a
  double-clicked page, which is precisely the path the UI advertised first.
- `[insight]` Add a defensive timeout to any host-provided async callback API. Some builds
  neither call back nor throw, and a silently hung UI is a far worse failure than an error
  message.
- `[note]` Native file pickers (`<input webkitdirectory>`) work everywhere, `file://` included,
  because selecting a file is an explicit user grant rather than an origin-scoped read. The
  plain button is the reliable path; the fancy drop is the fragile one.

**Process learnings:**

- `[insight]` "It doesn't work" with *zero* output is itself diagnostic: silence points at a
  hang or a swallowed error, not at wrong logic. Wrong logic produces wrong behaviour, not no
  behaviour. Re-reading the async code for unsettled promises found it faster than reproducing
  it would have.
- `[note]` Browser automation refuses `file://` URLs, so the fix was verified by fault injection
  instead — fake entry objects whose `readEntries` calls the error callback, and another that
  never calls back at all. Confirmed reject in 0 ms and timeout at 5 s. Injecting the fault beat
  trying to recreate the environment that caused it.

---

## v1.0.0 — CD to browser stem player (2026-08-13)

**Review:** not yet

**What was built:**

- `index.html` / `styles.css` / `app.js` — a dependency-free, build-step-free local player.
  Decodes stems with Web Audio, draws a per-lane waveform, and plays the full mix or any
  single instrument.
- `scripts/rip-cd.sh` — rips a mounted audio CD to lossless FLAC via ffmpeg.
- `scripts/prep-stems.sh` — one song → 6 separated stems → web-ready `.m4a`, with GPU
  auto-detection and CPU fallback.
- `README.md` — the whole CD → stems → player pipeline, including the Mac-specific setup
  traps below.
- Verified end-to-end on a real CD rip: 12 tracks ripped, one track fully separated and
  played back in-browser with all six stems in sync.

**Key technical learnings:**

- `[insight]` Scheduling every stem from one `AudioContext` clock — all `BufferSource`s
  started at the same `currentTime + lookahead` — gives sample-accurate sync for free.
  Six `<audio>` elements would drift apart audibly over a 3-minute song. Muting is done
  with gain nodes so tracks stay locked to the timeline whether or not you can hear them.
- `[gotcha]` `requestAnimationFrame` is paused in background tabs, so it cannot be trusted
  for anything transport-related. End-of-song detection lived in the rAF loop and a song
  finishing off-screen never reset. Moved onto the audio graph via `onended` on the
  longest source; rAF now only draws. Detach `onended` before your own `stop()` or it
  re-enters.
- `[gotcha]` An `AudioContext` stays `suspended` until a genuine user gesture. A scripted
  `play()` silently no-ops: `playing` flips to `true`, sources get scheduled, and the
  clock stays frozen at 0 because `audio.currentTime` doesn't advance. Cost a good while
  of debugging a "broken clock" that was just autoplay policy.
- `[note]` `decodeAudioData` runs off the main thread, so decoding stems in parallel with
  `Promise.all` instead of sequentially cut load time 13.8s → 6.2s for six 3-minute stems.
- `[insight]` Waveform lanes need per-lane normalisation to their own peak. A bass stem at
  its natural level (−15 dB) draws as an unreadable flat line next to drums. The overview
  waveform keeps true dynamics; only the lanes are normalised, capped at 8× so a silent
  stem isn't amplified into visual noise.
- `[gotcha]` Filename-matching rules that *suppress* other content must be narrow. A
  `/track|song|full|mix/` pattern meant to spot a full-mix file matched `track_A.m4a`,
  which then silently muted every other loaded file. Any heuristic whose false positive
  hides data deserves word boundaries and a deliberately small vocabulary.
- `[insight]` `htdemucs_6s` is the only Demucs model that separates **guitar** into its own
  stem. The widely-cited `htdemucs` gives 4 stems with all guitars buried inside "other" —
  useless for a guitar band. Worth checking the model's stem list against what you
  actually want before committing to a run.
- `[insight]` Near-silent stems are a *correct* result, not a failure. For a band with no
  keyboards, `piano` and `other` came out at −42/−45 dB mean against −15 to −17 dB for the
  real instruments. `ffmpeg -af volumedetect` over each stem is a fast, objective sanity
  check that separation actually worked.
- `[note]` macOS mounts an audio CD as a folder of `.aiff` files, so ripping needs no
  special tooling — it's a lossless transcode. XLD is only worth installing for scratched
  discs, where AccurateRip and sector re-reads matter.
- `[note]` Memory cost is real: stems are held decoded as 32-bit float, so six stems of a
  3-minute song is ~380 MB of RAM. Fine for one song at a time.
- `[note]` AAC `.m4a` at 160 kbps is the right delivery format — universally decodable
  including Safari, and encoder delay is identical across stems so relative sync survives.

**Toolchain learnings (macOS + Demucs, 2026-08):**

- `[gotcha]` PyTorch has no Python 3.14 wheels. Homebrew's `python@3.14` was the only
  Python installed, so `pip install demucs` could never have worked. Needs `python@3.12`,
  and Homebrew does *not* put a bare `python3.12` on `PATH` — call
  `/opt/homebrew/bin/python3.12` explicitly.
- `[gotcha]` demucs 4.1.0 imports numpy but doesn't declare it as a dependency. A plain
  `pip install demucs` reports success and leaves you with a `demucs` command that crashes
  on import. Install `numpy` explicitly.
- `[note]` demucs 4.1.0 dropped torchaudio in favour of `sphn`. Asking for `torchaudio`
  anyway drags in an old pinned torch and can wedge the resolver — the opposite of helpful.
- `[gotcha]` Probing capabilities from a shell script with a bare `python3` silently uses
  the *system* interpreter, not the venv one. `prep-stems.sh` asked system Python 3.9
  whether MPS was available, got `ModuleNotFoundError: torch`, and quietly fell back to CPU
  on every run — a 5×+ slowdown that never announces itself. Probe with the interpreter
  sitting next to the binary you're about to run.
- `[note]` Separation is much faster than the folklore suggests: ~22 seconds for a
  3-minute song on Apple Silicon MPS, against the "1–3 minutes" figure written from memory.

**Process learnings:**

- `[insight]` Synthetic test fixtures nearly produced a false bug report. ffmpeg-generated
  sine tones came out at 0.09 peak amplitude, so the lanes rendered as near-flat lines and
  it looked like a rendering bug. Reading the actual peak values out of the page first
  showed the renderer was correct and the *fixture* was quiet. Measure before fixing — but
  note the false alarm still pointed at a genuine UX problem (quiet stems are unreadable),
  which became the normalisation feature.
- `[gotcha]` `python3 -m http.server` is single-threaded. Abandoned requests wedge it, and
  the symptom is baffling: browser `fetch` hangs indefinitely while `curl` to the same URL
  returns in 5 ms. Use `ThreadingHTTPServer` when serving media for browser testing.
- `[gotcha]` A JS eval dispatched immediately after `location.reload()` loses its execution
  context and reports as a renderer timeout. Let the page settle before evaluating.
- `[insight]` Testing the real artifact beat testing the fixture. Everything looked fine on
  4 synthetic tones; loading 6 real 3-minute stems is what exposed the slow sequential
  decode, the missing progress feedback, and the true memory cost.
