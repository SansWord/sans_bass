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

iPhone18,2, Safari 26.6. (The UA reports `CPU iPhone OS 18_7` — Apple freezes that token
now; `Version/26.6` is the real one, and it is why `navigator.gpu` exists at all.)

| Probe | Backend | Result |
|---|---|---|
| 1 · WebGPU limits | — | survived |
| 2 · session + idle | webgpu | **survived** |
| 3 · one segment | webgpu | **crashed** at `FIRST session.run` |
| 3 · one segment | wasm | **crashed** at `FIRST session.run` |

Model out of Cache Storage in 19–20 ms. Session created in 1361 ms (webgpu) and 667 ms
(wasm). Both crashes were self-inflicted page reloads, confirmed by the operator, with the
breadcrumb naming the step.

### WebGPU limits, iOS vs the Mac

| Limit | iOS 26.6 | Mac (Chrome) |
|---|---|---|
| `maxBufferSize` | **1024 MiB** | 4096 MiB |
| `maxStorageBufferBindingSize` | **1024 MiB** | 4096 MiB |
| `maxUniformBufferBindingSize` | 1024 MiB | 65536 |
| `maxComputeWorkgroupStorageSize` | 32768 | 32768 |
| `maxComputeInvocationsPerWorkgroup` | 1024 | 1024 |
| `maxBindGroups` | 11 | 4 |
| adapter | `vendor=apple arch=apple` | `vendor=apple arch=metal-3` |

### What this rules out

**Probe 2 surviving is the load-bearing result.** The 285 MB model loads, the session
builds, the `ArrayBuffer` is released, and the tab sits there stable — on *both* backends.
So the fixed memory floor is not fatal, and neither is the model itself.

**Probe 3 crashing on both backends is the wall.** With `accumulate:false` not one
accumulator byte is allocated, so the length-scaled memory that explains the full-song
1.42 GB crash is absent here. The only thing between a stable probe 2 and a dead probe 3
is the working set of a single `session.run()` on a fixed `[1, 2, 343980]` input.

That kills the two obvious fixes outright:

- **Streaming the accumulators** — the refactor this spike was meant to justify — would not
  have helped. Probe 3 allocates none and still dies.
- **Forcing the WASM path on iOS** would not have helped either. It dies too, so this is
  not iOS's new WebGPU implementation misbehaving.

And `N_SAMPLES = 343980` is baked into the ONNX graph's input shape, so the segment cannot
be shrunk to reduce the working set. That knob does not exist.

### What is left

Nothing in *our* code. The remaining levers all change the model:

- a quantized or smaller `htdemucs_6s` export (int8 would be ~100 MB rather than 285 MB),
  at some cost in separation quality;
- an export with a smaller fixed segment length;
- or accept that separation is a desktop feature, and point iOS users at
  "separate on a computer, load the zip here" — which already works well on the phone.

### Probe 6 — the WASM heap ceiling is not the wall

The heap grew and committed **1920 MiB**, then the process died growing to 1984 MiB.
Whole ladder: 0.71 s.

That is far more than a 285 MB model plus its intermediates should ever need, and it is
*higher* than the 1.42 GB total footprint the full-song crash reached. So iOS is not
refusing to give this tab memory. Raw capacity is not the constraint.

This weakens the case for chasing a quantized export: the problem does not appear to be
"285 MB is too much to hold", because the phone will hold 1.9 GiB quite happily.

### Probe 3 on WASM — dies before finishing one segment

Re-run under spike-2, which writes a `still alive at Ns` line into the saved log every ten
seconds. The crashed log contains **no such line**, so it died **under 10 s** in — while
one WASM segment takes **11.2 s on a desktop**. It never completed a single inference.

**Caveat, and it is the operator's own sequencing error:** this run followed probe 6
immediately, so the phone had just committed 1.9 GiB and had a process killed. Memory
pressure and compressor state were poor. Needs one clean re-run — force-quit Safari or
reboot, then run probe 3 on `wasm` alone with nothing before it — before this number is
taken as read.
