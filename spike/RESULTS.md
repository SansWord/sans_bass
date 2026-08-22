# Spike results — htdemucs_6s in the browser (2026-08-20)

Throwaway spike on branch `spike/onnx-separation`. Question: is in-browser 6-stem
separation fast and accurate enough to build into the player?

**Verdict: yes, decisively.** Matches native Demucs on both speed and output.

## Setup

- Model: `kramp/htdemucs-6s-webgpu-onnx` (285 MB, MIT), constant-folded copy of
  `StemSplitio/htdemucs-6s-onnx`. Contract: `mix [1,2,343980]` → `stems [1,6,2,343980]`.
- Runtime: `onnxruntime-web@1.27.0` WebGPU bundle from jsDelivr, `numThreads = 1`.
- Machine: Apple Silicon, Chrome. Served over plain HTTP, **not** cross-origin isolated.
- Material: `rips/reborn/1 基隆路.flac` (200.4 s). Ground truth: `stems/reborn/1 基隆路/`,
  produced by native `htdemucs_6s` via `prep-stems.sh`.

## Results

| Metric | 30 s excerpt | Full track (200.4 s) |
|---|---|---|
| Backend | **WebGPU** | **WebGPU** |
| Session create | 2.1 s | ~1 s (cached model) |
| Median segment (7.8 s audio) | 0.64 s | 0.65 s |
| Total separation | 5.3 s | **23.8 s** |
| Realtime factor | 5.7× | **8.4×** |
| Projected per 3-min song | ~30 s | **~24 s** |
| JS heap peak | 242 MB | **812 MB** |

Native `prep-stems.sh` on Apple Silicon MPS is ~22 s for a 3-minute song. **The browser is
the same speed.**

## Accuracy vs native htdemucs_6s

Pearson correlation, best over ±4096 samples of lag, edges excluded:

| Stem | Correlation | Lag | Ours | Native |
|---|---|---|---|---|
| vocals | **0.996** | 0 | −16.3 dB | −16.3 dB |
| bass | **0.997** | 0 | −15.7 dB | −15.7 dB |
| guitar | **0.993** | 0 | −13.6 dB | −15.0 dB |

Zero lag on all three: the pipeline is sample-aligned with native output.

All six stem levels, full track: drums −18.2, vocals −16.5, bass −16.0, guitar −14.0,
other −43.3, piano −64.9 dB. The near-silent `other`/`piano` match what native produces for
a band with no keyboards, as documented in the devlog.

## Findings that shape the design

- **WebGPU works and is the whole story.** timcsy/demucs-web reports 0.1–0.3× realtime on
  WASM because ORT's WebGPU backend chokes on `Conv1d`; this model was constant-folded
  specifically to remove the blocking `ConstantOfShape` op. We measured 8.4× realtime —
  roughly **30× faster** than the WASM path.
- **No COOP/COEP needed.** `crossOriginIsolated` was `false` throughout. `numThreads = 1`
  sidesteps SharedArrayBuffer entirely, so a plain static server is enough.
- **Cache Storage handles 285 MB.** Second run loaded from cache, no download.
- **Memory is the real constraint, not speed.** 812 MB JS heap for a 3:20 track, on top of
  the model. Six full-length fp32 stereo stems is ~424 MB by itself. The player then holds
  its own ~380 MB of decoded audio. Separation must run in a Worker and hand off buffers.
- **`decodeAudioData` resamples to the AudioContext rate.** A default 48 kHz context would
  silently feed the model stretched audio. Must construct `new AudioContext({sampleRate: 44100})`.

## Open question

Guitar comes out **1.4 dB hotter than native** (consistent across both runs) while vocals and
bass match to 0.1 dB. Correlation is still 0.993, so it is the same signal, not a separation
failure. Most likely cause: native Demucs overlap-adds with a raised-cosine transition
weighting, while `infer.py` (and therefore this spike) uses a plain trapezoid — the two differ
most on transient-dense material, which guitar is. Not blocking, but worth an A/B listen
before shipping, and worth trying the raised-cosine window.

---

# iOS spike — why separation kills a Safari tab (2026-08-21)

Branch `spike/ios-webgpu`. Question: separation crashes the tab on an iPhone. Where, and
can a refactor fix it? Page: `spike/ios-webgpu.html`.

## What the iPhone reported before the spike existed

iPhone18,2, iOS 26.6, Safari. Web Inspector → Timelines, separating a full song:

| Reading | Value |
|---|---|
| Peak footprint before the kill | **1.42 GB** |
| `頁面` — non-JS: wasm heap + ArrayBuffer backing stores | 21.71 MB → **1.19 GB** |
| JavaScript heap | 213.54 MB → 330.99 MB → 228 MB |
| CPU during the final plateau | 400–500% sustained, ~3.5 s |

Then, separately, a **30-second clip crashed too** — status went
`載入模型中…` → `使用 GPU 分離中…` → reload, inside 3 seconds.

`使用 GPU 分離中…` is posted on the worker's `ready` message, which is sent *after*
`InferenceSession.create()` returns. So on the 30 s clip the model loaded, the session was
created on WebGPU, and the kill landed inside the **first `session.run()`**. A 30 s clip
allocates only ~69 MB of accumulators, so the length-scaled memory is not what killed it.

**Two independent ceilings, same symptom:**

1. Full song → WebContent process at 1.42 GB. Length-scaled: 13 full-length fp32
   accumulators at 2.29 MB per second of audio (`separate.worker.js:108-113`), plus a
   285 MB model `ArrayBuffer` that is never released, plus a wasm heap that never shrinks.
2. 30 s clip → almost certainly `com.apple.WebKit.GPU`, a **separate process the Web
   Inspector memory graph does not show**, dying during first-run shader compilation and
   intermediate-tensor allocation. Fixed cost. Independent of song length.

`N_SAMPLES = 343980` is baked into the ONNX graph's input shape, so the segment cannot be
made smaller to shrink the GPU working set. That knob does not exist.

## Desktop baseline (Apple Silicon, Chrome) — measured by this spike

Read the iPhone numbers against these.

| Backend | Session create | First run | Second run | Steady state |
|---|---|---|---|---|
| `webgpu` | 506 ms | 1389 ms | 805 ms | **9.69× realtime** |
| `wasm`   | 307 ms | 11249 ms | 11088 ms | **0.70× realtime** |

- Model out of Cache Storage: 271.6 MiB in 216 ms.
- 30 s loop, WebGPU, accumulators on: 6 segments, 4.7 s, 6.35× realtime.
- WebGPU adapter: `vendor=apple arch=metal-3`, `maxBufferSize` and
  `maxStorageBufferBindingSize` both **4096 MiB**. The iOS figures are the ones to compare.
- **The first-run penalty is the tell.** WebGPU's first run carries 584 ms of extra work
  over its second; WASM's carries only 161 ms. That extra 584 ms *is* shader compilation
  and GPU allocation — precisely the step the iPhone does not survive.

## Probes

Run one at a time, with Timelines → Memory recording. Each announces its stage to
`localStorage` *before* running it, so a process kill still reports where it died.

| # | Probe | Answers |
|---|---|---|
| 1 | WebGPU limits | what iOS actually reports vs the Mac's 4096 MiB |
| 2 | Session, then idle | the fixed memory floor with nothing else allocated |
| 3 | One segment, first vs second run | does iOS survive first-run compilation at all |
| 4 | Full segment loop | throughput, and whether the accumulators are the binding cost |
| 5 | GPU allocation ladder | how much GPU memory iOS hands over before OOM |

Options vary what production hard-codes: execution provider (production always prefers
WebGPU), whether the 285 MB model `ArrayBuffer` is released after session creation
(production never releases it), and whether the full-length accumulators exist at all.

## Results from the iPhone

_To be filled in._
