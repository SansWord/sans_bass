# Expected behaviour

What the player is supposed to do, written so a later session can check it still does.
Every item is phrased as an observable outcome with a way to observe it — not as a
description of the code, which would just rot alongside it.

**Keep this current.** Changing behaviour means changing this file in the same commit.
If you find an item here that no longer matches the app, one of the two is a bug; decide
which before moving on.

Last exercised end-to-end: **v1.2.2**; the Loading and Loading-the-page-itself rows were re-run in **v1.4.0**, and the Loading / Lanes / Unmute-all / Play-dropdown rows touched by v1.6.0 were re-run in **v1.6.0**. Items marked ⚠ were reasoned from the code rather
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
as a WAV `File` and feed it through `#file-input` with a `DataTransfer` — one file only, the
input has no `multiple`. To load a set of stems instead, zip them with `buildZip` from
`lib/zip.js` and feed the same input a `.zip` Blob; there is one picker for both and
`app.js` dispatches on the extension. Note `#file-input` clears its own `value` after every
change, so re-feeding the same `File` fires again rather than being swallowed.

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
| L2 | Stems named `vocals`/`guitar`/`bass`/`drums`/`piano`/`other` land in those lanes in that order, whatever order they sit in inside the zip. | Lane labels top to bottom. |
| L3 | An unrecognised filename still gets its own lane, labelled with the filename. | Lane label equals the name minus extension. |
| L4 | A file whose name matches `mix`/`full`/`master`/`original` **and** which sits alongside stems becomes the Full mix lane, and is muted whenever anything else is unmuted. | Its gain ramps to 0 when any stem is on. Never both. |
| L5 | An undecodable file is skipped with a message naming it; the rest still load. | Status line names the file. |
| L6 | ⚠ Dropping a **folder** is unsupported on every protocol and must not be "fixed" — it says so and tells the user to zip it. | Status line reads "Dropping a folder is not supported…". |
| L7 | The `AudioContext` is 44100 Hz regardless of the machine's default. | `audio.sampleRate`. Wrong rate silently produces wrong stems. |
| L8 | A `.zip` of stems loads to exactly the lanes the same folder would, and the song title comes from the folder name **inside** the zip. | Lane labels, and `#title` reads the inner folder name — not the zip's own filename, and not `6 tracks`. |
| L8a | A **flat** zip — stems at the root, no enclosing folder — is titled from the zip's own filename, minus `.zip`. | Zip `我的歌 flat.zip` holding `vocals.wav`… at the root gives `#title` = `我的歌 flat`. The `${n} tracks` count is the last resort only, and is deliberately left in English: it means the loader found neither a folder nor a filename, which is a bug to report, not copy to read. |
| L9 | Both stored and deflated zips load — the app's own Save stems output and anything from Finder "Compress" or `zip -r`. | `zip -0` and `zip -r` of the same folder give identical lanes. |
| L10 | Finder's `__MACOSX/._*` sidecars are ignored, so a Finder-made six-stem zip gives six lanes, not twelve. | Lane count is 6. A seventh lane labelled `._bass` means the filter is broken. |
| L11 | A zip that is unreadable says why: not a zip, a damaged directory, Zip64, encrypted, unsupported compression, truncated, corrupt, or no audio inside. | Status line names the actual cause and is visibly shown. "Codec not supported" for a *read* failure is wrong, and an empty message hides the bar entirely. |
| L12 | A drop with nothing usable in it names which case it was: a folder, more than one file, or neither a song nor a zip. None is silent. | Status line, and its computed `display` is not `none`. |
| L13 | Exactly two things load, by button or by drop: **one** audio file (a whole song), or **one** `.zip` of stems. | `#file-input` has no `multiple`. Dropping two audio files is refused, not loaded. |
| L18 | There is **one** load button, not two. It accepts either kind and picks the behaviour from the extension: `.zip` → `loadZip`, anything else → `loadSong`. | One `.btn` in `.loadzone`; `#file-input`'s `accept` lists both the audio extensions and `.zip`. Feed it a zip and a song in turn through the same input — both load. |
| L19 | Picking the **same** file twice in a row loads it twice. | Feed one `File`, then feed the identical `File` again: two loads, not one. The input clears `value` on change; without that the second pick is silent, which reads as a broken button. |
| L14 | A set of loose stem files is **not** a supported input — the user is told to zip them. Six files dropped together give a message, not six lanes. | Status line names the file count and says to zip them. |
| L15 | Dragging a file anywhere over the window shows `#drag-overlay`, and the window accepts the drop. A dropped file must **never** make the browser navigate to it. | `getComputedStyle('#drag-overlay').display === 'flex'` during the drag. Dispatch a cancelable `dragover` and assert `defaultPrevented` — that one call is what stops the navigation. |
| L16 | The overlay is the drop target in **both** states, before a song loads and after. Dropping a second song over a loaded player is the common case and `#dropzone` is hidden by then. | Load a song, then drag over the player: the overlay still appears. |
| L17 | The overlay does not flicker while the cursor crosses lanes and panels. | `dragenter` on a child then `dragleave` on the parent leaves it visible. `app.js` counts enters; `.drag-overlay` is `pointer-events: none` so it never fires a pair of its own. |

## Lanes and muting

| # | Expected | How to observe |
|---|---|---|
| M1 | Clicking a lane's name block toggles **only** that lane. Others are untouched. | Ramps: one value changes, five stay. |
| M2 | The click target is the whole left column — full lane height, flush to the lane's left edge, through the number badge. | `getBoundingClientRect()` of `.lane-name` vs `.lane`; click the top-left corner specifically, it was dead before v1.2.2. |
| M2a | That target is visibly a target **without hovering**: its own background tint, distinct from the lane, and a divider against the waveform. | `getComputedStyle('.lane-name').backgroundColor !== getComputedStyle('.lane').backgroundColor`, with no pointer over it. Hover-only affordance is invisible on touch, and is what beta testers failed to find. |
| M2b | The player says in words that the name block toggles the track. | `.hint-click` is present and visible, in both locales, and stays visible at ≤640px where `.hint-keys` is hidden. |
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
| U5 | Everything on with **nothing saved** — the state a freshly loaded or freshly separated song starts in — the press **mutes every lane**, and the label reads **Mute all**. Pressing again brings them all back. The button is never disabled. | Ramps: all to 0, then all to 1. `disabled === false` throughout. This replaced a disabled no-op in v1.6.0: on a separated song every lane starts on, so the very first `0` was always the dead one and read as a broken key. |
| U5a | All lanes off does **not** take a snapshot — "restore previous" meaning "silence again" is not offered. After mute-all → unmute-all the label is **Mute all** again, not **Restore previous**. | `textContent` after the second press. |
| U6 | A new song clears the snapshot. | Load a second file; the label is back to **Unmute all** or **Mute all**, never **Restore previous**. |
| U7 | With a full-mix file present, "unmute all" unmutes the stems and drives the mix lane to 0 — never both. | Last ramp in the batch is the mix lane at 0. |
| U8 | The button is styled identically to **Save stems (.zip)** (`btn ghost`). | Computed font, padding, radius, colours match. |

## Play dropdown

| # | Expected | How to observe |
|---|---|---|
| P1 | Picking an instrument solos it — every other lane mutes. | One ramp at 1, rest at 0. |
| P2 | **Full mix** turns every lane on, or plays the mix file if one exists. | See L4. |
| P3 | Any per-lane change switches the dropdown to **Custom…**. | `#mode.value === 'custom'`. |
| P5 | After choosing from the dropdown, the keyboard shortcuts still work. The select does not keep focus. | Change `#mode`, then press `space` with no click in between: playback toggles. `document.activeElement` is not `#mode`. The global keydown handler ignores `<select>` targets on purpose — arrows have to move the selection, not seek — so a select that kept focus silently disabled every hotkey. |
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

Served over HTTP like the rest of the site. `separate.js` loads as a plain
`<script type="module">` — the `file://` injection guard went with `file://` support
in v1.5.0.

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

## Language

| # | Expected | How to observe |
|---|---|---|
| N1 | Default is zh-TW. English only when the system language is not Traditional Chinese. | `SansI18n.detectLocale(['ja'])` is `'en'`; `detectLocale(['zh-Hant-TW'])` is `'zh-TW'`. Simplified (`zh-CN`, `zh-Hans`, `zh-SG`) deliberately resolves to `'en'` — the copy is Taiwan terminology. |
| N2 | A stored choice beats detection; detection never reads storage. | `localStorage['sans_bass.lang']`. `detectLocale()` is pure, which is what makes N1 testable. |
| N3 | The first visit does **not** persist a locale. Only clicking the switcher does. | Load with a clean profile: `localStorage.getItem('sans_bass.lang')` is `null` but the UI is translated. Otherwise changing the system language later would never take effect. |
| N4 | ⚠ Switching language never disturbs audio. No reload, no re-decode, no re-render of waveforms. | Play, switch, and sample the AudioContext clock across the switch: it keeps advancing and the context stays `running`. Patch `AudioContext.prototype.createBufferSource` and count calls across the switch — it must be **zero**, or playback was restarted. `document.querySelectorAll('.lane canvas')` must be the same node objects, not just the same count. Audibly there is no gap. Do **not** use `#t-cur` for this: rAF is paused in a backgrounded automation tab, so the clock text reads stale while audio genuinely plays. |
| N5 | Everything already on screen re-renders: mode dropdown (selection preserved), lane names, loop badge, all-toggle label, status line, separation status. | Set an A–B loop, trigger an error, switch: badge and `#status` both change language; `loopStart`/`loopEnd` are untouched. |
| N6 | The mode dropdown's option **value** is a stable key (`mix`, a stem id, `lane:<i>`, `custom`), never the label. | `[...document.querySelectorAll('#mode option')].map(o => o.value)`. Keying on labels would break soloing on every switch. |
| N7 | ⚠ Lane labels translate; **stem ids and filenames never do**. | `tests/i18n.test.js`. A saved zip holds `vocals.wav`, `bass.wav` … in every language. |
| N8 | Zip errors are translated by their stable `code`; an unknown code falls back to the original English message. | Drop a random file renamed `.zip`. `lib/unzip.js` is not modified — three messages share `not-zip`, so the translation is less specific than the English. |
| N8a | Both halves of the hint line translate, markup included. | `.hint-click` and `.hint-keys` both carry `data-i18n-html`; switch locale and both change. `hint.keys` names the `0`, `a`/`b` and `c` keys, and `c` says what it clears — **the A–B loop**, not a bare "clear". |
| N9 | The switcher is visible and both halves are reachable. | `getComputedStyle(btn).display` on both `#lang-toggle button`s — not `.hidden`, see V1. The active half carries `aria-pressed="true"`. |
| N10 | `<html lang>` and the tab title follow the locale. | `document.documentElement.lang`, `document.title`. |
| N11 | A blocked or throwing `localStorage` degrades to detection instead of killing the app. | Block site data, reload: the UI is still translated and `window.sansBass` is still an object. Every access is inside `try/catch` — an uncaught throw during setup kills every listener below it (see G1). |
| N12 | ⚠ A status param that is itself translated is re-resolved on switch, never stored rendered. | Crash the worker with an empty message so `sep.workerFailed` falls back to `sep.oom`, then switch. The whole line must be in one language — storing the rendered param produced "worker failed: 記憶體不足？ — try a shorter track". `separate.js` passes such params as thunks. |

## Visibility

| # | Expected | How to observe |
|---|---|---|
| V1 | Anything with the `hidden` attribute is actually invisible. | `styles.css` carries a global `[hidden] { display: none !important; }`. Author `display` rules outrank the UA `[hidden]` rule, so without it `.btn` and `.loop-badge` render regardless. |
| V2 | Every hidden-toggle in `app.js` and `separate.js` depends on V1. | If V1 is removed, S5, S6, R6 and the loop badge all silently break while their properties still read correctly. |

## Loading the page itself

| # | Expected | How to observe |
|---|---|---|
| G1 | A missing element does not stop `app.js`. Every top-level listener goes through `on()`, which warns and continues. | Serve a copy of `index.html` with `id="play"` renamed. `window.sansBass` is still an object and drag & drop still works — before v1.4.0 this killed every listener below it. |
| G2 | An uncaught error puts a message on screen naming the force-reload, instead of leaving a page that looks fine and does nothing. | Throw from the console; `#status` is visible and mentions Cmd-Shift-R. |
| G3 | Every local asset URL carries `?v=<version>`, and all of them agree. | `tests/versions.test.js`. GitHub Pages pins everything to `max-age=600` with no way to change it, so without this a returning visitor can hold a stale `app.js` against a fresh `index.html` for ten minutes. |
| G4 | The page is served over HTTP — GitHub Pages, or `./scripts/serve.sh` locally. `file://` is no longer supported (dropped in v1.5.0); opening `index.html` from disk is not expected to work. | `separate.js` now loads as a plain `<script type="module">` with no protocol guard. |

## Constraints that are not features

Breaking any of these breaks the project, not just a behaviour.

- The site is served over HTTP. `file://` support was dropped in v1.5.0 — local use goes
  through `./scripts/serve.sh`, which separation already required.
- No build step, no dependencies, no npm, no framework.
- No audio ever leaves the machine. Inbound fetches (ORT from jsDelivr, model from Hugging
  Face) are fine and necessary.
- `ort.env.wasm.numThreads = 1`, so no SharedArrayBuffer, so no COOP/COEP, so GitHub Pages
  can host it at all.
- `rips/` and `stems/` are never committed, published, or copied out of the project.
