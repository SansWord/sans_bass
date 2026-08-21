# Expected behaviour

What the player is supposed to do, written so a later session can check it still does.
Every item is phrased as an observable outcome with a way to observe it — not as a
description of the code, which would just rot alongside it.

**Keep this current.** Changing behaviour means changing this file in the same commit.
If you find an item here that no longer matches the app, one of the two is a bug; decide
which before moving on.

Last exercised end-to-end: **v1.2.2**. Items marked ⚠ were reasoned from the code rather
than run in that session, so treat them as the least trustworthy rows here.

---

## The test harness

There is no runner. `tests/test.html` covers the pure functions; everything below is
observed in a real browser. `./scripts/serve.sh` first — separation and ES modules need
HTTP.

Five things that will waste an hour if you don't know them:

- **`el.hidden` is the state, not the appearance.** Assert on
  `getComputedStyle(el).display !== 'none'`. A `hidden` property reading `true` while the
  user still sees the button is exactly the bug that shipped in v1.2.1.
- **Take a screenshot.** Four property assertions passed against a visibly broken panel in
  v1.2.2. The picture caught it immediately.
- **A same-URL navigation can reuse the cached stylesheet**, even though `serve.sh` sends
  `no-store` and `curl` shows the new bytes. Force it:
  `link.href = 'styles.css?v=' + Date.now()`.
- **`setInterval` is throttled to ~1 Hz in a backgrounded tab**, and an automation tab is
  always backgrounded. `separate.js` polls `refresh()` every 400 ms; under automation give
  it several seconds before concluding anything. Same for `requestAnimationFrame`, which
  is why `t-cur` can read stale while audio is genuinely playing.
- **Playback needs a real key press.** Synthetic clicks do not unlock the `AudioContext`.
  Click once into the page to focus it, then send a real `space`. If `playing` is true but
  the clock reads 0, this is why.

### Faking a separation run

Never download the 285 MB model to test the UI. `getWorker()` constructs lazily on click,
so replacing the constructor first exercises every line of `separate.js`'s real message
handling:

```js
window.__fake = null;
window.Worker = class {
  constructor() { window.__fake = this; this.sent = []; }
  postMessage(m) { this.sent.push(m.type); }
  terminate() {}
};
document.getElementById('sep-go').click();          // builds the fake
window.__fake.onmessage({ data: { type: 'result', stems } });   // lands the result
```

Build `stems` as six `{left, right}` Float32Array pairs at 44100. Synthesise input audio
as a WAV `File` and feed it through `#file-input` with a `DataTransfer`.

### Observing audio rather than parameters

Mute state is a gain ramp, so read the ramp:

```js
const orig = AudioParam.prototype.setTargetAtTime;
let ramps = [];
AudioParam.prototype.setTargetAtTime = function (v, t, c) { ramps.push(v); return orig.call(this, v, t, c); };
```

`tracks` is a classic-script local and unreachable from the console, so this is also the
only way to see per-lane gain at all. For "did playback actually stop", patch
`AudioBufferSourceNode.prototype.stop` and count calls.

---

## Loading

| # | Expected | How to observe |
|---|---|---|
| L1 | One audio file loads as a single lane labelled **Full mix**. | Lane list is `["Full mix"]`. |
| L2 | Files named `vocals`/`guitar`/`bass`/`drums`/`piano`/`other` land in those lanes in that order, whatever order they were picked in. | Lane labels top to bottom. |
| L3 | An unrecognised filename still gets its own lane, labelled with the filename. | Lane label equals the name minus extension. |
| L4 | A file whose name matches `mix`/`full`/`master`/`original` **and** which sits alongside stems becomes the Full mix lane, and is muted whenever anything else is unmuted. | Its gain ramps to 0 when any stem is on. Never both. |
| L5 | An undecodable file is skipped with a message naming it; the rest still load. | Status line names the file. |
| L6 | ⚠ Loading a folder over `file://` works via **Load folder**. Drag-and-drop of a folder does not, and must not be "fixed". | Chrome refuses the directory read. |
| L7 | The `AudioContext` is 44100 Hz regardless of the machine's default. | `audio.sampleRate`. Wrong rate silently produces wrong stems. |

## Lanes and muting

| # | Expected | How to observe |
|---|---|---|
| M1 | Clicking a lane's name block toggles **only** that lane. Others are untouched. | Ramps: one value changes, five stay. |
| M2 | The click target is the whole left column — full lane height, flush to the lane's left edge, through the number badge. | `getBoundingClientRect()` of `.lane-name` vs `.lane`; click the top-left corner specifically, it was dead before v1.2.2. |
| M3 | Clicking the waveform seeks and does **not** toggle. | Clock moves to the clicked fraction; mute state unchanged. |
| M4 | Keys `1`–`6` toggle the same lanes as clicking their names. | Same as M1. |
| M5 | A muted lane is dimmed, and its gain is 0. | `.lane.muted` **and** a 0 ramp. Class alone is not evidence. |
| M6 | The per-lane volume slider is independent of mute. | Moving it while muted leaves gain at 0. |

## Unmute all / restore

The button and the `0` key are the same action.

| # | Expected | How to observe |
|---|---|---|
| U1 | With anything muted, pressing turns **every** lane on. | All ramps to 1. |
| U2 | Pressing again returns to exactly the lanes that were on before. | Lane state matches the pre-press snapshot. |
| U3 | The snapshot is taken **when everything is turned on**, not when a lane is muted. So: all on → mute one lane → press → all on → press → back to *that one lane muted*, not to an older state. | Run the full sequence; this is the item most likely to regress. |
| U4 | Label follows state: **Unmute all** when anything is muted, **Restore previous** when everything is on and a snapshot exists. | `textContent`. |
| U5 | Everything on with nothing saved: disabled, dimmed, and both the click and `0` are no-ops. | `disabled === true`, opacity 0.5, lane state unchanged after both. |
| U6 | A new song clears the snapshot. | Load a second file; button is disabled again. |
| U7 | With a full-mix file present, "unmute all" unmutes the stems and drives the mix lane to 0 — never both. | Last ramp in the batch is the mix lane at 0. |
| U8 | The button is styled identically to **Save stems (.zip)** (`btn ghost`). | Computed font, padding, radius, colours match. |

## Play dropdown

| # | Expected | How to observe |
|---|---|---|
| P1 | Picking an instrument solos it — every other lane mutes. | One ramp at 1, rest at 0. |
| P2 | **Full mix** turns every lane on, or plays the mix file if one exists. | See L4. |
| P3 | Any per-lane change switches the dropdown to **Custom…**. | `#mode.value === 'custom'`. |
| P4 | With no mix file, "all lanes on" shows **Full mix**, not Custom — all six on *is* the full mix. | `#mode.value === 'mix'` after U1. |

## Transport

| # | Expected | How to observe |
|---|---|---|
| T1 | All lanes stay sample-locked — one clock, one `t0`. | Six `<audio>` elements would drift; this must not regress to that. |
| T2 | Muting never stops a source; it ramps gain. The track stays on the timeline. | Unmute mid-playback and it is at the right position, not restarted. |
| T3 | ⚠ End of song is detected on the audio graph (`onended` on the longest source), not in `requestAnimationFrame`. | Must still end correctly in a backgrounded tab. |
| T4 | ⚠ Seeking while playing resumes playing; seeking while stopped stays stopped. | `playing` unchanged across a seek. |
| T5 | `←`/`→` nudge 5 s. | Clock delta. |

## A–B repeat

| # | Expected | How to observe |
|---|---|---|
| R1 | ⚠ `a` and `b` set points at the playhead; the region repeats until cleared. | **Sample the playhead across laps.** Loop bounds being set is not evidence the audio wraps. |
| R2 | ⚠ Points set in either order work — a B before an A swaps itself. | Badge reads low → high. |
| R3 | ⚠ Points closer than 0.1 s are rejected with a message, and the second point is discarded. | Status line; the point stays null. |
| R4 | ⚠ Looping runs on the audio thread (`loop`/`loopStart`/`loopEnd`), so it survives a backgrounded tab. | Must keep looping with the tab hidden. |
| R5 | ⚠ A stem shorter than `loopEnd` is left unlooped and falls silent rather than wrapping early and drifting. | Its source has `loop === false`. |
| R6 | The badge is hidden when no point is set. | Computed `display`, not `.hidden`. |
| R7 | ⚠ Loading a song clears both points. | Badge hidden after load. |

## Separation panel

Only over HTTP. On `file://` the module is never injected and the panel never appears —
the player must still work fully.

| # | Expected | How to observe |
|---|---|---|
| S1 | The panel appears only for a single unseparated track. A stems folder loaded from disk shows no panel. | Computed `display` of `#sep`. |
| S2 | While a run is in flight: **Separate** disabled, **Cancel** shown, **Save** disabled. | All three, by computed style and `disabled`. |
| S3 | Save is disabled mid-run specifically so a *previous* track's stems can't be written, and so encoding doesn't compete with the worker for memory. | Start a second run with Save visible; it must go disabled. |
| S4 | On success the status line goes **empty** — no "done". Six lanes replacing one is the confirmation. | `#sep-status.textContent === ''`. |
| S5 | On success **Separate** disappears; **Save stems (.zip)** appears. | Computed `display` of both. |
| S6 | Loading a fresh single track brings **Separate** back and hides **Save**. | Allow several seconds — the 400 ms poll is throttled under automation. |
| S7 | The separated result has **six** lanes. The original mix track is dropped, not kept and suppressed. | Lane list has no Full mix. |
| S8 | Every lane starts unmuted after separation. | No `.muted`, all gains 1. |
| S9 | If the mix is playing when the stems land, playback stops and the playhead returns to 0. | `playing === false`, clock `0:00`, and exactly one `BufferSource.stop()` — the old sources are not in `tracks` and would otherwise keep sounding over the new lanes. |
| S10 | Cancelling leaves the panel usable and reports "cancelled". | Status line; **Separate** re-enabled. |
| S11 | A worker that dies without posting (OOM) still releases the UI. | `w.onerror` path: progress bar clears, message shown. |
| S12 | ⚠ Model download progress is reported in MB, then the backend (`webgpu` or CPU) is named. | Status line during a real run. |
| S13 | There is no local-`.onnx` picker. The worker still accepts a `modelBuffer`, but nothing in the UI supplies one. | No `#sep-model` in the DOM. |

## Saving stems

| # | Expected | How to observe |
|---|---|---|
| Z1 | ⚠ Saving writes `<song>/{vocals,guitar,bass,drums,piano,other}.wav` in one ZIP. | Extract and list. |
| Z2 | ⚠ Non-ASCII song titles survive the round trip (general purpose bit 11). | Verify with `ditto -xk`, `bsdtar`, or Python `zipfile` — **not** macOS `unzip -l`, which ignores the bit and shows mojibake either way. |
| Z3 | ⚠ Stems are encoded one at a time so the WAV bytes are never all live at once. | The UI repaints between stems. |
| Z4 | Save re-enables itself after a failure. | Status shows the error; button usable. |

## Visibility

| # | Expected | How to observe |
|---|---|---|
| V1 | Anything with the `hidden` attribute is actually invisible. | `styles.css` carries a global `[hidden] { display: none !important; }`. Author `display` rules outrank the UA `[hidden]` rule, so without it `.btn` and `.loop-badge` render regardless. |
| V2 | Every hidden-toggle in `app.js` and `separate.js` depends on V1. | If V1 is removed, S5, S6, R6 and the loop badge all silently break while their properties still read correctly. |

## Constraints that are not features

Breaking any of these breaks the project, not just a behaviour.

- Opening `index.html` from disk by double-clicking must work: player, loading, transport,
  A–B repeat, all of it. Only separation is absent.
- No build step, no dependencies, no npm, no framework.
- No audio ever leaves the machine. Inbound fetches (ORT from jsDelivr, model from Hugging
  Face) are fine and necessary.
- `ort.env.wasm.numThreads = 1`, so no SharedArrayBuffer, so no COOP/COEP, so GitHub Pages
  can host it at all.
- `rips/` and `stems/` are never committed, published, or copied out of the project.
