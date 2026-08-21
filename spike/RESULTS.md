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
