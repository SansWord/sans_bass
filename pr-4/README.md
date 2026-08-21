# sans_bass

A local HTML/JS player for punk rock stems. Load a song, see its waveform, and play the
full mix or solo the vocals, guitar, bass and drums.

Everything runs in the browser. No build step and no upload — your audio never leaves your
machine. In-browser separation fetches a model *in*, but nothing about your audio ever goes
*out*. It is built for learning a part: solo one instrument, set an A–B loop around the
phrase you keep fluffing, and drill it.

**Already have stems?** `open index.html`, click **Load folder**, pick the folder, and skip
to [Controls](#controls). Steps 1–3 below are the one-time job of getting stems out of a CD.

---

## The one thing to know first

**A CD does not contain separate instrument tracks.** Every commercial CD is a stereo
mixdown: two channels with the whole band already blended together. There is no vocal
track hiding on the disc to extract.

To get per-instrument tracks you run **AI source separation** on the ripped audio. The
tool is [Demucs](https://github.com/adefossez/demucs) (free, from Meta Research). It
listens to the stereo mix and reconstructs each instrument as its own file.

So the pipeline is:

```
CD  →  rip to FLAC  →  Demucs separation  →  encode to .m4a  →  drop into the player
```

Separation is a one-time offline step: about **20–25 seconds per song** on an Apple
Silicon GPU (measured on a 3-minute track), a few minutes on CPU. Quality is good but not
magic — expect some bleed, especially cymbals into vocals and distorted guitar into
"other". On dense, loud punk mixes it is noticeably harder than on sparse recordings,
which is worth calibrating your expectations around.

---

## Step 1 — Rip the CD

Insert the disc in your USB drive and wait for it to mount.

### Option A: the script (fastest)

macOS exposes an audio CD as a folder of `.aiff` files, so ripping is just a lossless
transcode:

```bash
brew install ffmpeg          # if you don't have it
./scripts/rip-cd.sh          # auto-detects the mounted disc, writes rips/*.flac
```

### Option B: XLD (best for scratched discs)

[XLD](https://tmkk.undo.jp/xld/index_e.html) does AccurateRip verification and re-reads
damaged sectors, which the simple copy above does not.

```bash
brew install --cask xld
```

Set **Output format → FLAC**, **Ripper mode → CDParanoia III 10.2 (XLD)**, then Open
Audio CD → Extract.

### Option C: Music.app (no extra tools)

Music → Settings → Files → Import Settings → **Import Using: Apple Lossless Encoder**,
and tick **Use error correction when reading Audio CDs**. Then insert the disc and click
Import CD.

**Format for ripping: FLAC or Apple Lossless (ALAC), 16-bit / 44.1 kHz.** Both are
lossless — bit-identical to the disc — and about half the size of WAV. Do not rip to MP3
or AAC at this stage: separation quality suffers when you feed it lossy audio.

Eject when done:

```bash
diskutil eject "/Volumes/Audio CD"
```

---

## Step 2 — Install Demucs

```bash
brew install ffmpeg python@3.12

/opt/homebrew/bin/python3.12 -m venv ~/.venvs/demucs
~/.venvs/demucs/bin/pip install -U demucs numpy soundfile
```

Details that actually bite:

- **Use Python 3.12, not 3.13/3.14.** PyTorch has no wheels for 3.14, so `pip install
  demucs` fails outright there. Call the full path `/opt/homebrew/bin/python3.12` —
  Homebrew does not put a bare `python3.12` on your `PATH`.
- **Install `numpy` explicitly.** demucs 4.1.0 imports numpy but forgets to declare it as
  a dependency, so a plain `pip install demucs` gives you a broken `demucs` command.
- **You do not need `torchaudio`.** demucs 4.1.0 uses `sphn` for I/O instead; asking for
  torchaudio drags in an old pinned torch and can wedge the resolver.
- **No `activate` needed.** `prep-stems.sh` finds `~/.venvs/demucs` on its own. Activate
  only if you want to run `demucs` by hand.

Check it worked:

```bash
~/.venvs/demucs/bin/demucs --help | head -2
```

The first separation downloads model weights (52 MB for `htdemucs_6s`) and caches them
in `~/.cache/huggingface/hub/`, so the first run is slower than the rest.

---

## Step 3 — Split a song into stems

```bash
./scripts/prep-stems.sh "rips/03 Blitzkrieg Bop.flac"
```

This writes:

```
stems/03 Blitzkrieg Bop/
  vocals.m4a  guitar.m4a  bass.m4a  drums.m4a  piano.m4a  other.m4a
```

The default model is **`htdemucs_6s`**, the 6-stem model — it is the only one that
separates **guitar** and **piano** as their own tracks. The more common `htdemucs` gives
you 4 stems (vocals / bass / drums / other) with all guitars buried inside "other", which
is not what you want for a guitar band.

For a band with no keyboards, `piano.m4a` and `other.m4a` come out near-silent (around
−42 dB against −15 dB for the real instruments). That is the model working correctly, not
a failure — it found no piano because there is none. Delete those two files if you want
fewer lanes:

```bash
rm "stems/<song>/piano.m4a" "stems/<song>/other.m4a"
```

Useful flags:

| Flag | Effect |
|---|---|
| `-s 2` | Two shifts — slightly cleaner separation, ~2× the time |
| `-m htdemucs_ft` | Fine-tuned 4-stem model; best vocals/drums/bass, no guitar split |
| `-d cpu` | Force CPU if the Apple Silicon GPU path misbehaves |
| `-f wav` | Lossless stems (big, but zero encoder involvement) |
| `-b 192k` | Higher bitrate than the 160k default |

### Batch a whole album

`prep-stems.sh` takes one song at a time. Loop it, and use `-o` to keep each album in its
own folder so track names from different discs cannot collide:

```bash
for f in rips/reborn/*.flac; do
  ./scripts/prep-stems.sh -o stems/reborn "$f"
done
```

That gives `stems/reborn/<track name>/{vocals,guitar,bass,drums,piano,other}.m4a`, one
folder per track — which is exactly what the player's **Load folder** button expects. A
12-track album takes roughly five minutes end to end on Apple Silicon.

### Which format for the player?

**`.m4a` (AAC, 160 kbps) is the default and the right choice.** Six stems at 160 kbps is
roughly 7 MB per minute of song, and AAC decodes in every browser including Safari.

- `wav` — lossless and bulletproof, but ~6× larger. Use it if you plan to do critical
  listening or want to be certain no encoder is touching the audio.
- `opus` — smallest files at equal quality, but older Safari cannot decode it. Fine if you
  only ever use Chrome or Firefox.

Encoder delay is identical across all six stems, so they stay in sync regardless of which
you pick.

---

## Step 3b — or skip all that: separate in the browser

Steps 2 and 3 are the fast path for a whole album. For a single song you can skip Python,
Homebrew and Demucs entirely and let the browser do it.

```bash
./scripts/serve.sh          # http://localhost:8777
```

Open that URL, click **Load files**, pick any audio file, then **Separate into 6 stems**.
The six lanes replace the track you loaded — they sum back to it, so nothing is lost —
and a **Save stems (.zip)** button appears that writes
`<song>/{vocals,guitar,bass,drums,piano,other}.wav` — unzip it and it loads with
**Load folder**.

It uses [`kramp/htdemucs-6s-webgpu-onnx`](https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx),
the same `htdemucs_6s` weights as the local pipeline, exported to ONNX and run through WebGPU.

Details worth knowing:

- **It is as fast as the native pipeline.** Measured on Apple Silicon: 23.9 s for a 200 s
  song and 26.7 s for a 206 s song — roughly 8x realtime, against ~22 s for `prep-stems.sh`.
- **It closely matches the native output**, at zero sample lag on every stem measured.
  Correlation against locally produced stems: vocals 0.996–0.997, bass 0.997,
  guitar 0.992–0.993, drums 0.984–0.985. Note the ground truth is 160 kbps AAC, which by
  itself caps correlation at about 0.995 for drums and 0.996 for guitar, so most of that
  gap is the comparison, not the separation.
- **Guitar comes out about 1.5 dB hotter** than the native pipeline (drums vary by song).
  Not audible as wrong, but if you are matching levels against `prep-stems.sh` output, know
  it is there.
- **First run downloads a 285 MB model**, then caches it in the browser. Later runs start
  immediately.
- **Requires the local server**, not a `file://` page: browsers block module loading and
  Cache Storage from disk. The player itself still works double-clicked; only separation
  needs the server.
- **Needs WebGPU** to be quick. Without it the run falls back to CPU and takes many minutes;
  the page tells you which one you got.
- **Saved stems are WAV, so they are big** — roughly 218 MB per song against 25 MB for the
  `.m4a` files `prep-stems.sh` writes. Re-encode with ffmpeg if that matters.
- **Whole albums still belong in `prep-stems.sh`.** The browser does one song at a time.

### Hosting it

The whole thing is static, so GitHub Pages serves it with no backend and no build step —
push the repo and enable Pages. Inference runs on the visitor's GPU.

This works only because `numThreads = 1` avoids SharedArrayBuffer and therefore COOP/COEP,
which Pages cannot set. Do not "optimise" that setting without re-reading
[`CLAUDE.md`](CLAUDE.md).

Two rules for a public deployment:

- **Never commit the model.** GitHub rejects files over 100 MB and it is 285 MB. It is
  fetched from Hugging Face at runtime and cached in the browser.
- **`rips/` and `stems/` stay gitignored.** Publishing the repo must not publish the
  recordings.

## Step 4 — Play

```bash
open index.html
```

Then click **Load folder** and pick one song's folder — `stems/<song>/`, or
`stems/<album>/<song>/` if you batched an album. **Load files** is the same thing for a
hand-picked set of files rather than a whole folder.

### Dragging a folder in doesn't work when opened from disk

This is a Chrome restriction, not a bug in the player. A page opened as `file://…` is
generally not allowed to read a dropped *folder* — Chrome refuses the directory read, so
nothing loads. Three ways around it, in order of convenience:

1. **Use the "Load folder" button.** Native file pickers always work, on `file://` too.
2. **Drag the audio files themselves** rather than the folder containing them. Plain file
   drops are fine on `file://`; only folders are restricted.
3. **Serve the directory over http**, where folder drag-and-drop works normally:

   ```bash
   python3 -c "from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler; \
   ThreadingHTTPServer(('127.0.0.1',8777), SimpleHTTPRequestHandler).serve_forever()"
   # then open http://localhost:8777
   ```

   Use `ThreadingHTTPServer` as above rather than a plain `python3 -m http.server`. The
   default server is single-threaded, and with files this size the browser can wedge it —
   `fetch` then hangs forever while `curl` on the same URL returns instantly.

### Controls

| Action | How |
|---|---|
| Play / pause | Click the big button, or press **space** |
| Seek | Click or drag anywhere on any waveform |
| Mute / unmute a lane | Click its name, or press **1**–**6** |
| Solo one instrument | Pick it from the **Play** dropdown |
| Back to the full mix | Press **0** |
| Nudge 5 seconds | **←** / **→** |
| Per-instrument level | The slider at the right of each lane |
| Set loop start / end | **a** / **b** at the playhead |
| Clear the loop | **c** or **Esc**, or the Clear button |

### A–B repeat

Press **a** where a phrase starts and **b** where it ends, and that section repeats until
you clear it. The intended workflow is to press **a**, keep listening, and press **b** the
moment the phrase finishes — the playhead is already at B, so it jumps straight back to A.

Combine it with soloing to drill one part: pick **guitar only** from the **Play**
dropdown, `a`/`b` around the solo, and it loops that phrase on the guitar track alone.

Details worth knowing:

- The region is shaded on every lane, with amber **A** and **B** markers on the overview.
- While a loop is armed the playhead stays inside it — seeking outside snaps back in.
  Press **c** to roam freely again.
- Points can be set in either order; a B before an A swaps itself.
- Move either point at any time, including mid-playback; the change applies immediately
  without an audible gap.
- Loading a new song clears the points.

Looping runs on the audio thread via the Web Audio node's own loop parameters, not from a
JavaScript timer. That keeps all six stems sample-locked to each other across every lap,
with no drift and no gap at the wrap, and it keeps working when the tab is in the
background.

The **Play** dropdown is the select box for whole-track vs. single-instrument listening.
Touching any individual lane switches it to "Custom…", so you can also build your own
blend — bass and drums only, guitar with no vocals, and so on.

### How files are recognised

Lane names come from the filename, so anything containing `vocal`, `guitar`, `bass`,
`drum`, `piano` or `other` lands in the right lane. That is exactly what Demucs outputs,
so the folder works untouched.

- A single file on its own is treated as the full song and plays normally.
- Names that aren't recognised still get their own lane, labelled with the filename.
- If a file's name contains `mix`, `full`, `master` or `original` **and** stems are also
  present, it is treated as an alternative to the stems rather than an extra layer — so
  "Full mix" plays that file, and soloing switches over to the stems. You don't need such
  a file: the six stems sum back to the original recording on their own.

---

## How the sync works

Every stem is decoded into memory and played from a single `AudioContext` clock, with all
buffer sources scheduled to start at the same timestamp. That makes alignment
sample-accurate and drift-free — unlike six `<audio>` elements, which will slowly slide
apart. Muting is done with gain nodes, so tracks stay locked to the timeline whether or
not you can hear them.

The cost is memory: every stem is held decoded as 32-bit float. Six stems of a 3-minute
song is roughly 380 MB of RAM. Fine for one song at a time, which is what this is for.

---

## Files

```
index.html                markup
styles.css                styling
app.js                    player: decode, waveform render, transport, mixing
lib/stems.js              stem identity (classic script — shared with app.js and tests)
lib/wav.js                Float32 → 16-bit PCM WAV
lib/zip.js                CRC-32 + store-method ZIP writer
lib/overlap.js            segment planning + overlap-add windows
separate.js               in-browser separation panel
separate.worker.js        ONNX Runtime + htdemucs_6s inference loop
tests/test.html           unit tests   (read window.__testResults)
tests/parity.html         separation accuracy vs native stems (read window.__parity)
scripts/serve.sh          serve over http://localhost:8777
scripts/rip-cd.sh         mounted audio CD  → lossless FLAC
scripts/prep-stems.sh     one song          → separated, web-ready stems
rips/                     your ripped tracks; one subfolder per album
  <track>.flac
  <album>/<track>.flac
stems/                    separated stems, one folder per song
  <album>/<track>/vocals.m4a  guitar.m4a  bass.m4a  drums.m4a  piano.m4a  other.m4a
docs/devlog.md            what was built each version, and what was learned
docs/session-prompts.md   the prompts that produced the original build
```

Everything under `rips/` and `stems/` is your own audio — hundreds of megabytes of it, and
not this project's to redistribute. The folders ship with a `.gitkeep` and nothing else.

## Docs

- [`docs/devlog.md`](docs/devlog.md) — version-by-version log of what was built, with the
  Web Audio and Demucs gotchas that cost real time. Read this before changing the transport.
- [`docs/session-prompts.md`](docs/session-prompts.md) — the eight prompts that produced
  v1.0.0–v1.1.0, timestamped from filesystem evidence.

## Legal note

Ripping a CD you own for your own use is generally fine in most places, and separating it
for practice or study is the same kind of private use. Distributing the stems is a
different question — those are still the band's recordings.
