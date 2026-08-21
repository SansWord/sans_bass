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
| [v1.1.0](#v110--a-b-repeat-loop-2026-08-13) | A-B repeat: `a`/`b` set loop points, looping runs on the audio thread so all six stems stay sample-locked |
| [v1.0.1](#v101--drag-and-drop-repair-2026-08-13) | Fixed folder drag-and-drop dying silently; a callback-pair API wrapped without its error path hung the handler forever |
| [v1.0.0](#v100--cd-to-browser-stem-player-2026-08-13) | CD → FLAC → Demucs stems → browser multitrack player with per-instrument waveforms and solo |

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
