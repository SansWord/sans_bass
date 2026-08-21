# In-browser stem separation — design

**Date:** 2026-08-20
**Target version:** v1.2.0
**Status:** approved, ready for planning
**Spike evidence:** [`spike/RESULTS.md`](../../../spike/RESULTS.md) on branch `spike/onnx-separation`

## Goal

Let the player separate a song into six stems **in the browser**, so getting stems no longer
requires a terminal, Python, Homebrew, or a Demucs venv. Drop in an audio file, wait about as
long as the native pipeline takes, and get the same six lanes you get today.

The native pipeline is not replaced. It stays the efficient path for whole albums and the
reference for quality. What changes is that a single song no longer needs it.

## Motivation

This idea was raised once before and deferred — prompt 5 of the original build session asked
"is it possible to drag and drop a single file then got the stem on the fly?" and the answer at
the time was "not practically." That answer is now wrong, and the spike proves it.

## Why not `timcsy/demucs-web`

The request that started this was to integrate that project. We are not going to, and the
reason should be on the record.

Its JS strips STFT/iSTFT **out** of the ONNX graph and reimplements them by hand in `fft.js`,
so it requires a specially-surgered model with two outputs. Consequences:

1. **It is 4-stem only** — drums, bass, other, vocals. Guitar is buried in "other", which is
   the exact failure this project chose `htdemucs_6s` to avoid. No 6-stem export of that shape
   exists, so using it means redoing their PyTorch surgery ourselves: an open-ended ML project.
2. **It runs on WASM at 0.1–0.3× realtime** (their own figure) — 10–30 minutes per song —
   because ORT's WebGPU backend cannot run `Conv1d` in their graph.
3. **Its hand-rolled STFT is bug surface we would inherit.** Their experience report documents
   2049-vs-2048 bin mismatches and iSTFT `center=True` offset errors.

We use the same underlying technology (`onnxruntime-web`) with a better model, and end up
with *less* code, not more.

## The model

[`kramp/htdemucs-6s-webgpu-onnx`](https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx) (MIT),
a constant-folded copy of
[`StemSplitio/htdemucs-6s-onnx`](https://huggingface.co/StemSplitio/htdemucs-6s-onnx) (MIT).

- **285 MB**, opset 17, fp32.
- Contract: input `mix [1,2,343980]` → output `stems [1,6,2,343980]`.
- Source order: **`drums, bass, other, vocals, guitar, piano`** — note this differs from the
  player's display order; map by name, never by index.
- STFT/iSTFT are **baked into the graph as Conv1d kernels**, so there is no spectrogram maths
  in our JS at all. This is the single biggest reason to prefer it.
- The fold removed a `ConstantOfShape` op that blocks ORT's WebGPU backend. That fold is why
  we get 8.4× realtime instead of 0.3×.

## Evidence from the spike

Measured on Apple Silicon / Chrome, against `rips/reborn/1 基隆路.flac` with the existing
native `stems/reborn/1 基隆路/` as ground truth.

| Metric | Full track (200.4 s) |
|---|---|
| Backend | WebGPU |
| Median segment (7.8 s audio) | 0.65 s |
| Total separation | 23.8 s |
| Realtime factor | 8.4× |
| JS heap peak | 812 MB |

Native `prep-stems.sh` on MPS is ~22 s for a 3-minute song, so the browser is the same speed.

Accuracy versus native output — Pearson correlation, best over ±4096 samples of lag:

| Stem | Correlation | Lag |
|---|---|---|
| vocals | 0.996 | 0 |
| bass | 0.997 | 0 |
| guitar | 0.993 | 0 |

`crossOriginIsolated` was `false` throughout: **COOP/COEP are not required**, because
`ort.env.wasm.numThreads = 1` avoids SharedArrayBuffer.

## Requirements

1. Load one audio file → separate → six populated lanes, identical in behaviour to loading a
   `stems/` folder today.
2. All six stems, guitar included.
3. Offer to save the result as one ZIP of WAVs, laid out so unzipping gives a folder the
   player can load directly.
4. Progress reporting throughout: model download, then per-segment progress with an ETA.
5. The UI must stay responsive during separation — waveforms keep drawing, playback of the
   loaded mix keeps working.
6. The model downloads at most once per browser, then comes from cache.
7. **The player continues to work opened straight from disk.** Separation is unavailable there,
   and says so clearly.

## Architecture

Two new files. The player's existing structure is otherwise preserved.

```
separate.worker.js   ONNX Runtime, model lifecycle, segment loop.   Nothing else touches inference.
separate.js          UI panel, worker lifecycle, WAV + ZIP writing.
app.js               small refactor: accept tracks from buffers, not only from File objects
index.html           the separation panel
styles.css           its styling
scripts/serve.sh     already added during the spike
```

### Why a Worker

Separation runs for ~24 s. The player draws waveforms on `requestAnimationFrame` throughout.
Inference on the main thread would freeze the UI for the entire run. The worker also keeps the
285 MB model and ORT's allocations off the main thread's heap, which matters given the memory
budget below.

This is consistent with the project's standing rule that anything long-running belongs off the
main thread — the same reasoning that put transport on the audio graph rather than in rAF.

### Worker protocol

```js
// main → worker
{ type: 'init',     modelUrl }              // or { modelBuffer } for a local .onnx
{ type: 'separate', left, right }           // Float32Array, transferred
{ type: 'cancel'  }

// worker → main
{ type: 'download', loaded, total }
{ type: 'ready',    backend }               // 'webgpu' | 'wasm'
{ type: 'progress', segment, total, etaSec }
{ type: 'result',   stems }                 // { name: {left, right} }, transferred
{ type: 'error',    message }
{ type: 'log',      message }
```

Constants, fixed by the model: `N_SAMPLES = 343980`, `OVERLAP = N_SAMPLES / 4 = 85995`,
`STRIDE = 257985`.

### `app.js` refactor

`loadFiles()` currently decodes `File` objects and builds tracks in one pass. Extract the
second half:

```js
buildTracks(items, title)   // items: [{ name, buffer, stem? }]  →  lanes, waveforms, gain nodes
loadFiles(fileList)         // decode files → items → buildTracks
loadSeparated(orig, stems)  // Float32Arrays → AudioBuffers → items → buildTracks
```

`buildTracks` takes the display title explicitly, because `commonName()` (`app.js:176`) reads
`webkitRelativePath` off `File` objects that the separation path does not have.

Once six stems are added the player's existing mix-plus-stems logic does the right thing —
"Full mix" plays the original, soloing switches to the stems — but **it must be triggered
explicitly, not left to filename detection:**

- `app.js:145` only tags a track as `mix` when exactly **one** track is loaded. After
  separation there are seven, so that rule does not fire.
- `detectStem` (`app.js:85`) matches only `\bmix\b|\bfull\b|\bmaster\b|\boriginal\b`,
  deliberately narrow. A real song filename such as `1 基隆路.flac` matches none of them.

So the original would be classified as an unrecognised extra track, `window.__hasStems` would
be `false`, and **the original would play layered on top of its own six stems — doubled audio.**
`loadSeparated` must therefore pass `stem: 'mix'` for the original explicitly. Items carry an
optional `stem` field for exactly this reason.

With that one line right, A–B repeat, solo, per-lane volume and the 1–6 / 0 keyboard map all
keep working with no further change.

### Sample-rate gotcha — load-bearing

`ensureAudio()` currently creates a default `AudioContext`, which on macOS is typically
**48 kHz**. `decodeAudioData` resamples to the context rate, so the model would receive
stretched audio and produce quietly wrong output — no error, just bad stems.

It must become `new AudioContext({ sampleRate: 44100 })`, with an assertion that the decoded
buffer really is 44.1 kHz. All CD-derived material is 44.1 kHz already; other sources get
resampled on decode, which is correct behaviour.

## Memory plan

The binding constraint. Measured peak was 812 MB of JS heap for one 3:20 track, before any
saving.

- Six full-length fp32 stereo accumulators are ~424 MB and are unavoidable inside the worker.
- Stems cross to the main thread as **transferables**, never copies; the worker drops its
  references immediately.
- The inference session stays alive between songs — never download or instantiate 285 MB twice
  in a session.
- **Saving must not double the peak.** Convert each stem Float32 → Int16 (halving it), push
  each chunk into a parts array, and construct the ZIP as `new Blob(parts)` so Chrome can spill
  to disk rather than hold ~210 MB in the JS heap.
- Warn before separating tracks longer than ~8 minutes.

## Saving

One ZIP download containing six 16-bit / 44.1 kHz stereo WAVs:

```
<song>/vocals.wav  guitar.wav  bass.wav  drums.wav  piano.wav  other.wav
```

Unzipping yields a folder that **Load folder** accepts directly.

- **Uncompressed ("store") ZIP** — local file headers, central directory, EOCD, CRC-32 per
  entry. About 80 lines, no dependency. WAV is incompressible, so deflate would add complexity
  for almost no saving.
- **Clamp to ±1.0 before the Int16 conversion.** Demucs output can exceed unity, and
  unclamped conversion wraps around into loud distortion rather than clipping gracefully.
- ~210 MB per song. This is the accepted cost of avoiding a hand-written MP4/AAC muxer; the
  user can re-encode with the existing ffmpeg tooling if size matters.

## Model acquisition

`fetch` from Hugging Face → Cache Storage keyed by the model URL → progress bar on first run
only. Cache write failures (quota) are non-fatal: warn and continue uncached.

A "use a local .onnx file" input lets the model be supplied from disk, so the feature can run
fully offline once a copy is saved.

## Error handling

| Condition | Behaviour |
|---|---|
| No WebGPU | Fall back to WASM, warn that it is roughly 30× slower, offer to cancel |
| Model download fails | Explain, offer retry and the local-file option |
| Cache quota exceeded | Warn, continue without caching |
| Mono input | Duplicate the channel to stereo |
| Track longer than ~8 min | Warn about memory before starting |
| Worker dies (OOM) | Surface the failure; do not leave a silent spinner |
| Opened via `file://` | Panel hidden, one line pointing at `scripts/serve.sh` |

Cancellation: the worker checks a flag between segments; `terminate()` is the hard fallback.

## Verification

- **Parity harness.** The spike's correlation code becomes a test page: separate in-browser,
  compare against the native `stems/reborn/` output we already have, assert correlation > 0.99
  at zero lag for vocals, bass and guitar across several tracks.
- **Level check.** All six stem RMS levels within ~1.5 dB of native.
- **Memory.** Confirm a full track completes, then that saving completes without a second peak.
- **Responsiveness.** Confirm waveform drawing continues during separation.
- **`file://`.** Confirm the player still loads and plays a stems folder when double-clicked.

Evidence, not assertion: correlation numbers and timings get recorded, the way the spike did.

## Open question

Guitar comes out **1.4 dB hotter than native**, consistently, while vocals and bass match to
0.1 dB. Correlation is 0.993, so it is the same signal rather than a separation failure. Most
likely cause: native Demucs overlap-adds with a raised-cosine transition weighting while
`infer.py` — and therefore the spike — uses a plain trapezoid, and the two diverge most on
transient-dense material.

Try the raised-cosine window during implementation and re-run the parity harness. If it does
not close the gap, accept it and note it; it is not audible enough to block the feature.

## Out of scope

- Batch or whole-album separation in the browser — the native pipeline stays the efficient path.
- Model quantization (fp16/int8) to shrink the 285 MB download.
- A 4-stem model option.
- Any change to `rip-cd.sh` or `prep-stems.sh`.
- AAC/`.m4a` output from the browser.

## Constraints preserved

- No build step, no bundler, no npm. Plain ES modules, loaded directly.
- No framework.
- Audio never leaves the machine. The model download is inbound only; nothing is uploaded.
  **Note:** `CLAUDE.md` currently states "no network calls at all" — that line needs amending
  to "no outbound audio; the model is fetched inbound and cached," which does not weaken the
  privacy property.
- The player still runs from `file://`. Only separation requires the local server.
