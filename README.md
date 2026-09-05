# sans_bass

A browser-based music practice player. Load a song or separated stems, isolate a part,
loop a phrase, and build an editable numbered-notation (簡譜) reference.

Everything runs in the browser. No upload — your audio never leaves your machine.
In-browser separation fetches a model *in*, but nothing about your audio ever goes *out*.
It is built for learning a part: solo one instrument, set an A–B loop around the phrase you
keep fluffing, and drill it.

**Already have stems?** Zip the folder, start the server with `npm run dev`, open
<http://localhost:8777>, click **Load song or zip**, pick the zip, and skip to [Controls](#controls).
Steps 1–3 below are the one-time job of getting stems out of a CD.

---

## Core features

- **Load music:** open or drop one audio file or a ZIP of stems. Standard lanes include
  vocals, guitar, bass, drums, piano, and other instruments.
- **Practise individual parts:** synchronized waveforms, solo/mute controls, per-lane and
  master volume, seeking, keyboard shortcuts, and continuous A–B loops.
- **Change speed:** practise at 10–150% speed without changing pitch.
- **Separate locally:** split a whole song into six stems on a supported desktop browser
  and save them as a ZIP. Phones and tablets can load prepared stems for playback.
- **Find notes and rhythm:** analyse vocals and bass independently, listen to detected
  notes as reference tones, and inspect an editable tempo grid when drums are available.
- **Edit the reference:** add, remove, move, resize, repitch, split, and snap notes; undo
  edits and export/import the editing session.
- **Work with chords and capo:** inspect and correct estimated chords, and choose a capo
  fret to show playable shapes while retaining concert pitch.
- **Export 簡譜:** save self-contained HTML notation with rhythm, octave markings, bars,
  available chord estimates, and an interactive capo selector.
- **Browse examples:** open published notation examples from the shared header. Both
  pages support English and Traditional Chinese and remember your language choice.

Notes, tempo, and chords are assistive estimates you can review and correct.

## Quick start

Open the [hosted player](https://sansword.github.io/sans_bass/), then choose **Load song
or zip**. Load a prepared stems ZIP to practise immediately, or load a whole song and
use desktop separation. The CD-ripping and command-line separation guide below is optional.

To run a local checkout:

```bash
npm ci
npm run dev
```

Open <http://localhost:8777/>. Use `npm run build` followed by `npm run preview` to
check the production build locally.

## Demo examples — 匯出簡譜範例

Browse [HTML demos and notation exports](https://sansword.github.io/sans_bass/demos/).
The shared header links between the player and the list, and remembers your English/中文
choice. In Chinese, the list is labeled「匯出簡譜範例」.

### Where demo files live

Put published examples directly in [`public/demos/`](public/demos/):

```text
public/demos/
  README.md
  sans_bass_song_vocals_notes_2026_09_05_00_51.html
  your-next-example.html
```

The list discovers `.html` and `.htm` files, sorts them alphabetically by filename,
and uses each filename as its link label. Use descriptive filenames; spaces and Unicode
are supported. Subfolders and non-HTML files are not listed. `index.html` is reserved
for the generated listing.

`examples/` holds ignored local test fixtures. To publish an example, explicitly copy
the intended HTML file into `public/demos/`. Everything in the public folder is served
on the website; keep private recordings and local fixtures outside it.

### Add a new demo example

1. In the player, analyse vocals or bass, review the notes, and use **Export list** to
   save a self-contained HTML notation file. You can also supply another self-contained
   HTML demo.
2. Copy that file directly into `public/demos/`. For example, from the repository root:

   ```bash
   cp ~/Downloads/your-next-example.html public/demos/
   ```

3. Run `npm run dev` and open <http://localhost:8777/demos/>. Check that the file appears,
   opens correctly, and its controls work. Restart the dev server after adding, renaming,
   or removing files so the list regenerates.
4. Commit the new HTML file on a feature branch and open a PR. Its preview list will be
   at `https://sansword.github.io/sans_bass/pr-<PR-number>/demos/` after preview deployment.
5. Merge the PR into `main`. The existing GitHub Actions workflow rebuilds and publishes
   the list and demos automatically; no manual list edit or workflow change is needed.

Renaming or deleting a demo file updates the next deployment in the same way.
`scripts/build-demos.js` generates the ignored `demos/index.html` before dev/build;
Vite bundles that list and copies the example HTML unchanged to `dist/demos/`.
Commit the source examples, not `demos/index.html` or `dist/`.

See [deployment documentation](docs/deployment.md#publishing-html-demos) for hosting details.

## Author

Built by **SansWord**.

- Portfolio — <https://sansword.github.io/resume/>
- LinkedIn — <https://www.linkedin.com/in/sansword/>

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
folder per track — zip one of those folders and it is exactly what the player's
**Load song or zip** button expects. A 12-track album takes roughly five minutes end to end on Apple Silicon.

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
Homebrew and Demucs entirely and let the browser do it — on a desktop; see the first
bullet below.

```bash
npm run dev                 # http://localhost:8777
```

Open that URL, click **Load song or zip**, pick any audio file, then **Separate into 6 stems**.
The six lanes replace the track you loaded — they sum back to it, so nothing is lost —
and a **Save stems (.zip)** button appears that writes
`<song>/{vocals,guitar,bass,drums,piano,other}.wav` — that zip loads straight back in through
the same button, no unzipping needed.

It uses [`kramp/htdemucs-6s-webgpu-onnx`](https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx),
the same `htdemucs_6s` weights as the local pipeline, exported to ONNX and run through WebGPU.

Details worth knowing:

- **It needs a computer.** On a phone or tablet the separation controls are hidden and the
  page says so instead. iOS kills the tab at the first inference step whatever settings are
  used, and the model's input size is fixed inside the ONNX graph, so there is nothing to
  tune. Separate on a desktop, then load the saved `.zip` on the phone — playback, muting
  and A–B repeat all work there.
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
  Cache Storage from disk. As of v1.5.0 this is true of the whole page, not just separation
  — `file://` is no longer supported at all.
- **Needs WebGPU** to be quick. Without it the run falls back to CPU and takes many minutes;
  the page tells you which one you got.
- **Saved stems are WAV, so they are big** — roughly 218 MB per song against 25 MB for the
  `.m4a` files `prep-stems.sh` writes. Re-encode with ffmpeg if that matters.
- **Whole albums still belong in `prep-stems.sh`.** The browser does one song at a time.

### Hosting it

GitHub Pages serves the built `dist/` output with no backend — CI runs `npm run build`
before every deploy, so nothing unbuilt reaches `gh-pages`. Inference runs on the visitor's
GPU.

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
npm run dev                 # then open http://localhost:8777
```

Then zip one song's folder — `stems/<song>/`, or `stems/<album>/<song>/` if you batched an
album — and click **Load song or zip** to pick it.

One button takes both: a single unseparated audio file (which is also how you start a
separation), or a `.zip` of stems. The player decides which from the extension. Dropping onto
the page accepts exactly the same two things — one file at a time, and not a folder.

### Dropping a folder doesn't work

That is deliberate. Reading a dropped folder needs Chrome's directory entries API, which
Chrome blocks on `file://` — so it only ever worked when the page was served over http,
and it broke silently the rest of the time. A zip works everywhere, so folder drop was
removed rather than left as a trap.

**Drop a `.zip` instead.** On macOS, right-click the folder → **Compress**, then drag the
`.zip` onto the page or pick it with **Load song or zip**. On the command line:

```bash
cd stems/<album> && zip -r ~/Desktop/song.zip "<song>"
```

Both stored (`zip -0`) and compressed (`zip -r`) archives load, as does anything Finder's
**Compress** produces — its `__MACOSX` sidecars are filtered out.

A set of loose stem files is not a supported drop — zip them. A single audio file is, and is
read as a whole song to separate rather than as one stem.

### Serving over http

The page is served over HTTP — there is no `file://` mode. Either use the hosted copy at
<https://sansword.github.io/sans_bass/>, or run it locally:

```bash
npm run dev                 # http://localhost:8777
```

Vite's dev server is non-blocking, so it doesn't wedge on the ~285 MB model fetch the way
a naive single-threaded static server would.

### Controls

| Action | How |
|---|---|
| Play / pause | Click the big button, or press **space** |
| Seek | Click or drag anywhere on any waveform |
| Mute / unmute a lane | Click its name, or press **1**–**6** |
| Unmute every lane | The **Unmute all** button, or press **0** |
| Go back to what was on before | Press it again — it relabels to **Restore previous** |
| Solo one instrument | Pick it from the **Play** dropdown |
| Nudge 5 seconds | **←** / **→** |
| Per-instrument level | The slider at the right of each lane |
| Set loop start / end | **a** / **b** at the playhead |
| Clear the loop | **c** or **Esc**, or the Clear button |
| Change playback speed | Drag the speed slider, or **[** / **]** (±5%, hold **Shift** for ±1%) / **\\** to reset |

The notes lane has its own controls — see [Step 5](#step-5--find-the-notes).

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
- Pitch stays fixed at any playback speed. A time-stretched (non-100%) loop can have a
  faint discontinuity right at the seam, because the stretch pipeline's internal state has
  no way to know the input just jumped back to A — inherent to real-time time-stretching
  across an arbitrary loop point, not specific to this player. Native 100% looping is
  unaffected and stays exactly as glitch-free as always.

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

## Step 5 — Find and edit notes

Load stems containing vocals, bass, or both, then choose **Find notes**. Analysis runs
locally in a worker and produces an independent note reference for each supported stem.
The overview and zoomed pane let you compare that reference with the source audio.

- Show the detected notes as pitches or numbered notation (簡譜), inspect the detected
  key, and adjust interpretation settings without analysing the audio again.
- Unmute the note reference to hear it alongside the stems, or mute the stems to hear
  the reference on its own. Reference tones start muted.
- When drums are available, inspect and correct tempo, meter, and grid alignment.
- Enable note editing to add, delete, move, resize, repitch, split, or snap notes.
  Undo changes and save or restore the editing session with export/import.
- Review estimated chords when harmonic stems are available, correct chord labels,
  and select a capo fret for playable chord shapes.
- Use **Export list** to save self-contained HTML 簡譜. Its capo selector remains
  interactive after export. Follow [Add a new demo example](#add-a-new-demo-example)
  if you want to publish that file in the demo list.

Detected notes, keys, tempo, and chords can be wrong. Compare them with the recording,
inspect doubtful passages, and use your edits to create a useful practice reference.
[`docs/transcription.md`](docs/transcription.md) explains the analysis and interpretation
layers; [`docs/product-contract.md`](docs/product-contract.md) describes supported behavior.

## Files

```
index.html                markup
styles.css                styling
app.js                    player: decode, waveform render, transport, mixing
lib/header.js             shared header, navigation, and language controls
lib/i18n.js               English/Traditional Chinese dictionary and saved locale
demos.js                  demo listing localization
scripts/build-demos.js    generates demos/index.html before dev/build
public/demos/             committed HTML examples for the public demo list
lib/stems.js              stem identity (ES module shared with app.js and tests)
lib/wav.js                Float32 → 16-bit PCM WAV
lib/zip.js                CRC-32 + store-method ZIP writer
lib/overlap.js            segment planning + overlap-add windows
lib/pitch.js              pitch tracking, note segmentation, key estimation
lib/sonify.js             plays detected notes back as tones
lib/ribbon.js             notes-lane geometry (ES module shared with the tests)
separate.js               in-browser separation panel
separate.worker.js        ONNX Runtime + htdemucs_6s inference loop
notes.js                  notes panel: worker lifecycle and live re-interpretation
notes.worker.js           pitch analysis, off the main thread
icons/icon.svg            favicon + iOS home-screen artwork (source of truth)
icons/*.png               rasterised from icon.svg by scripts/make-icons.sh
tests/*.test.js           unit tests, run via `npm test` (Vitest — see vitest.config.js)
tests/parity.html         separation accuracy vs native stems (read window.__parity)
tests/notes.html          note + key detection bench (read window.__notes)
package.json              npm scripts: dev, build, preview, test
vite.config.js             Vite multi-page build config
vitest.config.js          unit test config (three tiers: node / jsdom / browser)
scripts/make-icons.sh     icons/icon.svg    → the committed PNG icons (needs librsvg)
scripts/rip-cd.sh         mounted audio CD  → lossless FLAC
scripts/prep-stems.sh     one song          → separated, web-ready stems
rips/                     your ripped tracks; one subfolder per album
  <track>.flac
  <album>/<track>.flac
stems/                    separated stems, one folder per song
  <album>/<track>/vocals.m4a  guitar.m4a  bass.m4a  drums.m4a  piano.m4a  other.m4a
docs/transcription.md     how a stem becomes notes, layer by layer
docs/behaviour.md         what the player should do, and how to observe each behaviour
docs/deployment.md        GitHub Pages hosting and the per-PR previews
docs/devlog.md            what was built each version, and what was learned
docs/session-prompts.md   the prompts that produced the original build
```

Everything under `rips/` and `stems/` is your own audio — hundreds of megabytes of it, and
not this project's to redistribute. The folders ship with a `.gitkeep` and nothing else.

## Docs

- [`docs/transcription.md`](docs/transcription.md) — how audio becomes notes: the four
  layers, which are re-derivable and which can be lost, what each detection setting
  measurably does, and why beat tracking is not the fix for spiky notes.
- [`docs/behaviour.md`](docs/behaviour.md) — what the player is supposed to do, written as
  observable outcomes with a way to observe each one.
- [`docs/deployment.md`](docs/deployment.md) — GitHub Pages hosting, the three CI
  workflows, and the per-PR preview URLs.
- [`docs/devlog.md`](docs/devlog.md) — version-by-version log of what was built, with the
  Web Audio and Demucs gotchas that cost real time. Read this before changing the transport.
- [`docs/session-prompts.md`](docs/session-prompts.md) — the eight prompts that produced
  v1.0.0–v1.1.0, timestamped from filesystem evidence.

## Legal note

Ripping a CD you own for your own use is generally fine in most places, and separating it
for practice or study is the same kind of private use. Distributing the stems is a
different question — those are still the band's recordings.
