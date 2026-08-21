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

- **No build step, no dependencies, no framework.** Three files: `index.html`, `styles.css`,
  `app.js`. Vanilla JS, no bundler, no npm. The page must keep working when opened as
  `file://` by double-clicking it.
- **Nothing leaves the machine.** No uploads, no CDN, no analytics, no network calls at all.
  Audio is decoded locally via Web Audio.
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
- **Stem identity comes from the filename** (`detectStem`). Demucs' output names land in the
  right lanes untouched. The `mix` pattern is deliberately narrow (`\bmix\b|\bfull\b|…`) —
  a false positive there suppresses every other track.

`scripts/rip-cd.sh` — mounted audio CD (macOS presents it as `.aiff`) → lossless FLAC.
`scripts/prep-stems.sh` — one FLAC → 6 stems → `.m4a`, with MPS/CPU auto-detection.

## Repo layout

```
index.html  styles.css  app.js     the player
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
- **Demucs setup:** Python 3.12 (no PyTorch wheels for 3.14), install `numpy` explicitly
  (demucs 4.1.0 doesn't declare it), skip `torchaudio`. Probe for MPS with the venv's own
  interpreter — a bare `python3` is the system one and has no torch, which silently drops
  every run to CPU.
- **Near-silent `piano`/`other` stems are correct** for a guitar band, not a bug. Verify with
  `ffmpeg -af volumedetect` before chasing it.
- **`htdemucs_6s` is the only model that splits out guitar.** Don't switch to plain `htdemucs`.

## Working conventions

- **Not a git repository.** There is no `.git` here, so devlog timestamps cannot come from
  `git log` — use the date, or filesystem mtimes, and say which. If the user initialises git,
  add `rips/` and `stems/` to `.gitignore` first (keep the `.gitkeep` files).
- **Versioning:** three-part semver. `vX.Y.0` for releases, `vX.Y.1` for follow-up sessions,
  `vX.Y.0-design` for design-only sessions. Devlog headings, TL;DR anchors, and any tags match.
- **Devlog at end of session.** Newest-first, update the TL;DR table with an anchor link, and
  tag every learning bullet `[note]` / `[insight]` / `[gotcha]`.
- **Verify audio behaviour by observing audio, not parameters.** Loop bounds being set is not
  evidence the audio wraps; sampling the playhead across laps is. Fault-inject where the real
  environment can't be reproduced (`file://` is not reachable from browser automation).
