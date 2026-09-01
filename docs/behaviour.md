# Expected behaviour

What the player is supposed to do, written so a later session can check it still does.
Every item is phrased as an observable outcome with a way to observe it — not as a
description of the code, which would just rot alongside it.

**Keep this current.** Changing behaviour means changing this file in the same commit.
If you find an item here that no longer matches the app, one of the two is a bug; decide
which before moving on.

Last exercised end-to-end: **v1.2.2**; the Loading and Loading-the-page-itself rows were re-run in **v1.4.0**, and the Loading / Lanes / Unmute-all / Play-dropdown rows touched by v1.6.0 were re-run in **v1.6.0**. E19, E24 and E25 were re-run in **v1.16.2**. Items marked ⚠ were reasoned from the code rather
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
| R8 | A note **still sounding at A** plays its remainder rather than being skipped, on every lap. | Set A one third into a held note: the tone sounds each lap. Offline, `tests/sonify.test.js` renders four laps and asserts RMS > 0 after each lap's A. |
| R9 | It **resumes** the envelope rather than re-attacking — quieter at A than the same note played from its start. | Render from `offset = 0` and from mid-note; the peak in the first 10 ms is strictly lower for the mid case. This is the only assertion separating "resume" from "re-attack, shortened". |
| R10 | A note is **cut at B**, not left ringing across the restart. | Loop with a 1 s note starting 100 ms before B and nothing in the next lap's first 150 ms: the window after B is silent. The stems hard-cut at `loopEnd`, so a tone overhanging B desynchronises from them. Use a note whose envelope is still loud at B — a short one has already fallen to the 1e-4 floor there and reads as silent either way. |
| R11 | **Seeking** into a note does the same thing as entering at A. | `offset` mid-note, no loop: the remainder sounds. One rule for every entry point. |
| R12 | A remainder under **10 ms** is dropped, and no whole note ever is. | Entering 5 ms before a *short* note ends makes no sound. `interpret()` enforces `minDurationMs >= 20`, so the shortest real note is twice the floor — pinned by a test. |
| R13 | An untrusted note straddling A stays **silent**, as N36 requires. | A `fix.state === 'doubt'` note spanning A renders to silence. "It was already playing" is not an exception to the fold's judgement. |

## Separation panel

Served over HTTP like the rest of the site. `separate.js` loads as a plain
`<script type="module">` — the `file://` injection guard went with `file://` support
in v1.5.0.

S14–S16 are verified two ways, because a real handheld cannot be driven from automation:
`isHandheld(fakeWindow)` covers the predicate's truth table in `tests/platform.test.js`,
and DevTools device emulation plus one manual pass on a real phone against the PR preview
covers the DOM. This is the same fault-injection approach the project already uses for
`file://`.

| # | Expected | How to observe |
|---|---|---|
| S1 | The panel appears only for a single unseparated track. A stems folder loaded from disk shows no panel. On a handheld the same rule holds, but the panel's *contents* are the explanation — see S14. | Computed `display` of `#sep`. |
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
| S14 | On a handheld, a loaded single song shows `#sep` containing only the explanation. **Separate**, **Save**, **Cancel** and the progress bar are all gone. | Computed `display` of all four must be `none`. Never `.hidden` — a class that sets `display` beats the attribute, and that has already cost this project a debugging session. |
| S15 | On a handheld the drop zone makes no in-browser-separation promise. | `#drop-explain` renders `drop.explainHandheld`, not `drop.explain`. |
| S16 | Both handheld strings follow the language toggle like every other string. | Switch locale with a song loaded; the panel line and the drop zone must both re-render. |

## Notes lane

`notes.js` loads as a plain `<script type="module">` and reaches the player only through
`window.sansBass`, the same seam `separate.js` uses. The lane itself is built by `app.js`
inside `buildUI()`, not declared in `index.html` — `el.lanes.innerHTML = ''` destroys
anything parked inside `#lanes`, so a static element would survive exactly one song.

The layer model these rows exercise is in [`docs/transcription.md`](transcription.md):
analysis is immutable, interpretation is re-derived, and the two must stay separable.

| # | Expected | How to observe |
|---|---|---|
| N1 | The panel appears only when a **vocals** stem is loaded. A single unseparated song shows nothing. | Computed `display` of `#notes`. Never `.hidden` — `.notes` sets `display: flex`, so only the global `[hidden] { display: none !important }` keeps the attribute working. |
| N2 | Detection never starts by itself. It costs ~7 s of CPU on a cold first run, which is a surprise rather than a convenience. | Load a stems zip, wait 10 s: `document.querySelector('.lane.ribbon').hidden` is still `true`. |
| N3 | While analysing: **Find notes** disabled, one status message, no progress bar. `f0Track` reports no progress, and a bar that jumps 0 → 100 is worse than none. | `#notes-go.disabled`, `#status.textContent`. |
| N4 | On success the status line goes **empty** — the lane appearing is the confirmation. | `#status.textContent === ''`. |
| N5 | The notes panes sit directly under the vocals lane, zoomed pane first. DOM order is `[vocals, .ribbon-zoom, .ribbon]`. | `document.querySelector('.lane.ribbon').previousElementSibling` is `.lane.ribbon-zoom`, and *its* previous sibling is the vocals lane. |
| N6 | The ribbon is on the same time grid as every waveform: its canvas is the same CSS width, and it reflows with them on resize. | Compare `getBoundingClientRect().width` against a `.lane:not(.ribbon) canvas.wave`, before and after a resize. Must match both times. |
| N7 | Clicking the ribbon seeks, like any other lane. | Click at 50% of its width; `#t-cur` must read half the track length. |
| N8 | Moving **Shortest note** changes the note count **without re-running analysis**. | Time it: the count must change in tens of milliseconds, not seconds. That the slider moved is not evidence of anything — read `#notes-count`. Measured on `6 南國的風`: 120 ms → 228 notes, 200 ms → 99, 80 ms → 437, each in 11–15 ms. |
| N9 | Unticking **Fit the lane to the melody** widens the lane's vertical range. | `SansRibbon.pitchRange(notes, {clip:false})` must span more than with `clip:true`. |
| N10 | A note outside the clipped range is drawn at the lane edge in the A–B orange, never dropped. A hidden note would be a silent lie. | Load a track with octave errors; orange marks appear on the edge. |
| N10a | Clip is **display only**. It feeds `pitchRange()` and nothing else: it is not passed to `interpret()`, so the note list is identical either way, and a clipped note still *sounds* at its detected pitch. | Toggle it: `#notes-count` does not change, and the payload's `notes` array is unchanged. It rides in the `setNotes` payload, never in `params`. |
| N11 | The contour breaks at every unvoiced run and never bridges one, in both panes. | The lane uses `SansRibbon.contourColumns`, which returns `null` for a column holding no voiced frame — assert a null between two non-null columns. The zoomed pane breaks its polyline inline; observe it by rendering a window containing a rest and checking the line does not cross it. |
| N12 | Loading a new song clears the ribbon, even when the new song also has vocals. The old frames describe the old audio. | Load a second zip; `.lane.ribbon` computed `display` is `none` and its canvas `__layers` is `null`. |
| N13 | The lane is not in `tracks`. It has its own mute and volume but **no number key**, and mute-all, solo and the stem count all ignore it. | Press `0`: every `.lane:not(.ribbon):not(.ribbon-zoom)` gains `.muted` while `window.sansBass.ribbonMuted()` is unchanged. The ribbon lane has no `.kbd` child. |
| N14 | The lane label follows the language toggle. The note **names** drawn inside it never translate, exactly as stem ids and filenames do not. | Switch locale: the label changes, the block labels stay `C#4`. |
| N15 | The lane plays its notes as tones, **muted by default**. Clicking the lane name toggles it. | `window.sansBass.ribbonMuted()` is `true` on load; after clicking `.lane.ribbon .lane-name` it is `false` and the lane loses `.muted`. |
| N16 | The synth is locked to the same `t0` as the stems, and follows A–B repeat by generating laps. | Set A–B, play with the lane unmuted: the notes repeat with the audio rather than drifting or stopping after one pass. |
| N17 | Dragging the lane's bottom grip resizes it, and the height survives a reload. | Drag `.ribbon-grip`; the canvas `style.height` changes and `localStorage['sans_bass.ribbonHeight']` is written. |
| N18 | A zoomed pane sits directly above the notes lane, showing a window of the song rather than all of it. It follows the playhead while playing and pans by dragging when stopped. | `.ribbon-zoom` exists; drag `.zoomwave` and the ruler labels change while the lanes below do not move. |
| N19 | The wheel zooms the pane about the cursor, between 2 s and 60 s, and the width survives a reload. | Scroll on `.zoomwave`; `.zoom-secs` changes and `localStorage['sans_bass.zoomSeconds']` is written. |
| N20 | At whole-song width the lane draws the contour as a per-pixel band, not a polyline. A polyline there joins pitches ~26 frames apart and buries the notes under vertical strokes. | Compare: `SansRibbon.contourColumns` is what the lane uses; the zoomed pane draws the line directly. |
| N21 | Note names are labelled on every semitone at ≥7 px per semitone, fall back to C only between 6 and 7 px, and disappear entirely below 6 px. | Shrink the lane to its 96 px minimum: over a typical ~27-semitone range that is ~3.5 px per semitone, so **no** labels remain. C-only needs the narrow 6–7 px band. |
| N22 | Once notes are found, **Find notes** disappears and a show/hide toggle takes its place — the same swap the separation panel does with Separate → Save. Loading a new song brings it back. | Computed `display` of `#notes-go` and `#notes-show`. |
| N23 | Hiding the notes panes also **mutes** them. A pane you cannot see must not still be sounding, because nothing on screen would stop it. | Unmute, then Hide: `window.sansBass.ribbonMuted()` becomes `true`. |
| N24 | Showing them again does **not** unmute. The mute is a separate decision. | Hide then Show: still muted. |
| N25 | Seeking anywhere brings the zoomed window with it, but only when the playhead has left the window — clicking *inside* the zoom pane does not yank the view sideways. | Seek from the main overview; the playhead is drawn at the centre of `.zoomwave`. Then click inside the pane; the window does not recentre. |
| N26 | The zoomed pane resizes by its own grip, independently of the lane, and the height persists. | Drag `.ribbon-zoom .ribbon-grip`; `localStorage['sans_bass.zoomHeight']` is written. **Check the grip's position, not just that dragging works:** it is absolutely positioned, so a lane missing `position: relative` puts it over a *different* lane while the drag still functions. Assert its rect sits inside its own lane's rect. |
| N27 | The zoom width is driven by the `−`/`+` buttons as well as the wheel, and persists. | Click both; `.zoom-secs` changes and `localStorage['sans_bass.zoomSeconds']` is written. |
| N28 | A click in the zoomed pane seeks; a drag pans without seeking. | Click: the clock moves. Drag >4 px: the clock does not. |
| N29 | **Whole-phrase detection** under Advanced switches interpreters without re-analysing. | Tick it and time the change: the note count in `#notes-count` must move within tens of milliseconds, not seconds. Measured 229 → 268 in 22.5 ms on `6 南國的風`. |
| N30 | It is **on** by default as of v1.14.0, so `hmm-v1` is the shipped interpreter. | Load a song, run detection: `#notes-hmm.checked` is `true` and the payload's `params.interpreter` is `hmm-v1`. It shipped off and marked experimental in v1.12.0 because its one regression was octave-**up** errors; octave folding (v1.13.0) is the pass that corrects exactly those, so the tradeoff that justified the default no longer holds. Unticking still returns the full `threshold-v1` output, which is what makes the change safe to reverse per-song. |
| N31 | The **Shortest note** slider stays meaningful in both modes — a duration floor for `threshold-v1`, an onset cost for `hmm-v1`. | Drag it with the box both ticked and unticked; the count moves in the same direction both times. Measured at 20/80/200/400 ms: 1162/437/99/48 unticked, 928/357/196/142 ticked. |
| N32 | An unknown interpreter name degrades to `threshold-v1` rather than failing. | `interpret(track, { interpreter: 'nonesuch-v9', params: {} })` returns notes. So does a track carrying no `candidates` — an analysis from before they existed still opens. |
| N33 | **Fix octave outliers** never changes the note count. It corrects pitches and marks what it will not correct; it adds and removes nothing. | Tick it: `#notes-count` does not move. Verified on four tracks × both interpreters — 187/187, 313/313, 270/270, 342/342 and the `hmm-v1` equivalents. This is the strongest single check on the feature; a moved count is a real bug. |
| N34 | It is **off** by default. | Load a song, run detection: `#notes-fold.checked` is `false`, and no note carries a `fix` field at all (test `!('fix' in n)`, not `!n.fix`). |
| N35 | A folded note draws **blue**, a doubtful one **gray** — but only while the note is inside the lane's vertical range. **Out-of-band beats provenance:** a note you cannot see at all is the more urgent fact, so it stays orange at the edge whatever its `fix`. | Pin the scale state before asserting a colour, the way N9 does. With **Fit the lane to the melody** ticked (the default) on `ng_kipin`, 12 of 16 doubtful notes draw gray and 4 draw orange — so a row asserting gray unconditionally would be flaky. Read `canvas.__layers`, **not** the composited canvas: `renderRibbon` only ever draws to the layers and `paint()` composites them, so sampling the visible canvas at frac 0 sees the idle layer alone. |
| N36 | A **doubtful note makes no sound** but stays visible. | Count `OscillatorNode.prototype.start` calls, or better, render offline and measure RMS in the note's window — `tests/sonify.test.js` does the latter. Check with an A–B loop set too: `scheduleNotes` has two collection loops and only one runs without a loop. |
| N37 | The silence in N36 is **not negligible**: at the shipped `confidentWithin` of 1.5, doubtful notes are **7.5–8.1% of note time**, roughly one note in ten on the worst track. That is the deliberate cost of never claiming a pitch we cannot justify. | Measured on `ng_kipin` (7.5%) and `9 繼續向前行` (8.1%). The earlier figure of 1.6% was taken at `confidentWithin: 5`, before that value was found to fold octave-plus-a-fifth errors. |
| N38 | Folding **never changes pitch class**, so the detected key is unaffected. | `notesToChroma(notes)` is byte-identical with and without `fold: true`. This is what makes changing the note list safe, and it holds because every shift is a whole number of octaves. |
| N39 | Both colours and the silence are **reversible**. Unticking restores the previous note list exactly. | Untick: `#notes-count` returns to its previous value and the blue and gray pixels disappear from `canvas.__layers.active`. A one-way control would be a defect. |
| N40 | **Fold tolerance** adjusts `confidentWithin` live, and the readout beside the checkbox updates as it moves. | Drag `#notes-fold-tol`; `#notes-fold-stats` changes while `#notes-count` does not. Measured on `6 南國的風` at 120 ms: 0.5 → 1 corrected/13 muted, 1.0 and 1.5 and 2.0 → 3/11, 3.0 → 6/8. |
| N41 | The tolerance slider is **inert while folding is off** — disabled and dimmed, not silently ignored — and the readout is hidden. | Untick `#notes-fold`: `#notes-fold-tol.disabled` is `true` and `#notes-fold-stats.hidden` is `true`. |
| N42 | The slider runs to **8**, so the whole range can be explored — but the readout turns **orange** from 2.5 up, where corrections start being trusted that cannot be justified. | `#notes-fold-tol.max === '8'`; `#notes-fold-tol-out` gains `.risky` and `var(--loop)` at ≥ 2.5. Measured on `ng_kipin` at 100 ms, folded / muted / **provably wrong** (folded onto a 3rd or 6th harmonic, classified independently): 0.5 → 2/21/0, 1.5 → 9/14/0, 2.5 → 11/12/**0**, 3 → 14/9/**3**, 5 → 21/2/**8**, 8 → 23/0/**10**. The first unjustifiable fold appears at 3; at 8 nothing is marked and roughly half the corrections are wrong. |
| N43 | The readout's two numbers carry the **lane's own colours** — folded blue, muted gray — so the count and the picture agree without a legend. | `getComputedStyle` on `#notes-fold-stats` children gives `rgb(108,197,224)` and `rgb(168,168,184)`, matching `NOTE_FILL.folded.normal` and `NOTE_FILL.doubt.normal`. |
| N44 | **簡譜** replaces note names with scale degrees and is **off** by default. | Load a song, run detection: `#notes-jianpu.checked` is `false` and the lane draws `A#3`-style names. |
| N45 | The key selectors are set from `detectKey()` on the notes, and go **inert** while 簡譜 is off. | After detection, `#notes-key-tonic` and `#notes-key-mode` carry the detected key and are `disabled`; ticking the box enables them. |
| N46 | The mode selector changes what the **numbers mean**, not just which note is 1. | In `1=C major` an E♭ note draws `♭3`; switch to `minor` and the same note draws `3`. |
| N47 | **⇄** swaps the current key for its relative, and swapping twice returns. | From `1=A minor`, one click gives `1=C major`; a second returns to `1=A minor`. |
| N48 | Touching a key control **stops** the detected key from being re-adopted. | Set the tonic by hand, then drag Shortest note to force a re-interpretation: the chosen tonic survives. |
| N49 | The octave is shown **only on the axis**, as 簡譜 dots — never on the note blocks. | With 簡譜 on, no block label contains a digit-plus-octave like `13`; the axis has exactly one dotless band. |
| N50 | When the lane is too tight for every semitone, the axis labels the **tonic**, not C. | Set `1=G` and shrink the lane: the sparse labels fall on G. Labelling C in every key would be meaningless. |
| N51 | With octave folding on, degrees follow the **corrected** pitch, so the 簡譜 reading changes when the fold controls do. This is correct, not a bug. | Tick Fix octave outliers with 簡譜 on: some block labels change. Folding preserves pitch class, so a fold never changes a digit — only which octave dot it carries. |
| N52 | Loading a **new song** hands the key back to automatic detection, even after an override. The 簡譜 checkbox itself survives the load. | Override the tonic on song A, load song B, run detection: the selectors show B's own detected key, not A's. `jianpu.auto` is reset in `reset()`. An override is a statement about one song; carried forward it labels every note from an unrelated key with nothing on screen saying so. |
| N53 | The **zoom pane's** axis matches the lane's: degrees and octave dots, not note names. | With 簡譜 on, capture `fillText` on the zoom canvas — the axis reads `2 b3 3 4 #4 5 …`, not `D2 D#2 E2`. The zoom pane is the view a pitch is read off; degree blocks against a note-name axis put both notations side by side in the one place it matters. |
| N54 | The **bright gridline follows the tonic**, so the highlighted rule and the highlighted label sit on the same row. | In `1=G` the bright rules move off the C rows onto the G rows (measured: y 114/286/457 → 14/186/357/529). With 簡譜 off they are back on C. |
| N55 | A disabled **⇄** looks disabled. | With 簡譜 off, `getComputedStyle(#notes-key-rel)` gives `opacity: .45` and `cursor: default`, and the hover rule does not brighten it. `.btn[disabled]` does not match `.mini`, so without an explicit rule the button read as live while doing nothing — the same trap as the `[hidden]` one. |

## Note editing

`applyEdits()` (`lib/pitch.js`) runs after `interpret()`/`foldOctaves()` inside
`notes.js`'s `reinterpret()`. `app.js` owns the zoomed pane's selection, toolbar, and
pointer/keyboard interactions, and talks to `notes.js` through `sansbass:noteedit` /
`sansbass:editundo` / `sansbass:editmode` — the design is in
[`docs/superpowers/specs/2026-08-31-note-editing-design.md`](superpowers/specs/2026-08-31-note-editing-design.md).

| # | Expected | How to observe |
|---|---|---|
| E1 | **Edit notes** is disabled until a note detection run has completed, and resets (disabled, unticked) on a new song. | `#notes-edit.disabled` before/after **Find notes**; load a second zip and it is `disabled` and `unchecked` again. |
| E2 | Ticking it turns on note selection in the zoomed pane; clicking a note outlines it in white. Clicking empty space still seeks, exactly as before edit mode existed. | Tick, click a note block: outline appears. Click empty space: `#t-cur` changes, no outline appears anywhere. |
| E3 | The toolbar is hidden while edit mode is off, and every button but **+ Add note** is disabled until a note is selected. | `.note-toolbar.hidden` toggles with `#notes-edit.checked`; with it ticked and nothing selected, `.note-tbtn:not(.note-tbtn-armed)` (excluding Add) are all `disabled`. |
| E4 | **↑ 8ve** / **↓ 8ve** move the selected note a full octave and recolour it purple (`NOTE_FILL.manual`), without changing `#notes-count`. | Select a note, click, compare `midi` before/after via the outline's position; count unchanged. |
| E5 | **♯** / **♭** move the selected note one semitone, same recolouring rule. | As E4, one semitone of vertical movement instead of twelve. |
| E6 | **◀t** / **▶t** move the selected note in time without changing its duration, and recolour it purple (`NOTE_FILL.manual`) — same rule as E4/E5, since a time-adjust is as much a human override as a pitch change. | `end - start` unchanged; both edges shift by the same amount; fill colour changes to purple. |
| E7 | Dragging the BODY of a selected note moves it in time; dragging within ~8px of an EDGE resizes just that edge. Neither ever shrinks a note below a 20ms floor. Either drag recolours the note purple, same as E6. | Drag the middle: both edges move equally. Drag near the left edge: only `start` moves. Drag it past the floor: it stops at 20ms rather than crossing zero. Fill colour changes to purple in every case, including on a previously folded (blue) or doubt (gray) note. |
| E8 | **✕** deletes the selected note, `#notes-count` drops by one, the toolbar disables. | Click it; compare counts; toolbar buttons `disabled` again. |
| E9 | **✂** splits the selected note at the current playhead position, composing a shrink plus a new note — unless the cut is within 5ms of either edge, in which case it only shrinks (no new note). Both the shrunk original and the new tail note end up purple, since a time-adjust now recolours too. | Seek inside a note, click ✂: count +1, two purple notes where one was. Seek within 5ms of an edge, click ✂: count unchanged, the note just moved that edge and is now purple. |
| E10 | A split note can be split again — the tail piece is an ordinary note, not a special case. | Split once, select the new tail note, split it again: count +1 again. |
| E11 | **+ Add note** arms placement (its label and colour change); the next drag in the pane places a new purple note at the dragged span and pitch row, then disarms. Clicking it again without dragging cancels. | Arm, drag: preview follows the pointer, count +1 on release, button reverts. Arm, click without dragging: no note added, button reverts. |
| E12 | The bottom ~16px band is visibly marked at rest (a faint tinted strip with a top border) while edit mode is on, with a caption below the pane naming what it's for — not just discoverable by trial and error. Dragging it selects a time range (a brighter amber highlight, distinct from the resting strip) and enables **Delete range**; clicking it removes every note overlapping that range. | With edit mode on and nothing selected, the strip and caption are visible immediately. Drag the band: a brighter highlight appears, button enables. Click it: count drops by however many notes overlapped, highlight clears back to the resting strip. |
| E13 | The edit list shows one row per action (a split is ONE row, not two), each removable with its own ✕; removing one re-derives without it. | Make three edits including one split: three rows, not four. Remove the split row: both its underlying changes revert together. |
| E26 | The edit list (`#notes-edits`) is a collapsible `<details>`, collapsed by default even with edits present, so a long editing session doesn't keep pushing the zoomed pane down the page. Its summary names the count. Making a new edit or removing one never re-collapses a panel the user opened. When open, the row of controls floats over the page (`position: absolute`) rather than displacing anything below it, and a pointerdown anywhere outside `#notes-edits` closes it again — clicking the summary itself, or a row's own ✕/↺ button, does not count as "outside". | Make an edit: `#notes-edits` becomes visible but `.open` is `false`; summary reads "Edit history (1)". Click the summary to open it, make a second edit: still open, summary now reads "(2)"; the zoomed pane's position on screen hasn't moved. Click anywhere else on the page: `.open` becomes `false` again. Click a row's ✕ instead: the row is removed and the panel stays open. |
| E14 | An edit whose target no longer exists shows a warning glyph in the list rather than silently vanishing. | Edit a note, then delete that same note via a different edit: the first edit's row gains the warning glyph. |
| E15 | Cmd/Ctrl+Z undoes the most recent edit, list-order. The same button (↺) does the same thing. | Make two edits, press Cmd/Ctrl+Z once: only the second is undone. |
| E16 | With a note selected, ↑/↓ nudge pitch, Shift+↑/↓ shift octave, Delete/Backspace deletes. ←/→ do NOT nudge a selected note's time — since the ergonomics batch (v1.16.1) they always seek the transport instead (see E20); time is adjusted via the toolbar's ◀t/▶t buttons or by dragging. | Select a note, press ↑: pitch moves. Press →: the transport seeks (proportional to zoom span), the note's `start`/`end` are unchanged either way — selection makes no difference to ←/→. |
| E17 | **Export edits** downloads a JSON file with `version`, `params`, `clip`, `jianpu`, and `edits` (one array per list entry, two elements for a split); **Import edits** restores every control and the edit list from it, re-deriving the same note list. | Export, reload, re-load the same zip, re-run detection, import: `#notes-count` and the edit-list rows match. |
| E18 | Loading a new song clears the edit list and both toolbar/list panels, exactly as parameters and the 簡譜 key already reset. | Make an edit, load a second zip: `#notes-edits` is `hidden` again and empty. |
| E19 | With two notes overlapping in time, a click resolves to the note whose pitch matches the click's vertical position — not an arbitrary array-order match. Only when two overlapping notes share the exact same pitch too (an exact duplicate) does it fall back to whichever is drawn on top (the later array entry). | Overlap two notes at different pitches (add a note over an existing one, a few semitones away, same time span): click near each one's row and confirm the outline lands on the pitch-matching note, not the other. Add a note directly on top of an existing one at the same pitch and span: click the overlap and confirm the outline lands on the new (topmost) one. |
| E20 | In the zoomed pane, plain scroll seeks the playhead; Shift+scroll zooms. Arrow Left/Right always seek — proportional to the current zoom span (`zoomSeconds × 0.15`); Shift is a fixed 1ms step for placing a cut inside a word — whether or not a note is selected. | Scroll with no modifier: `currentTime()` changes, zoom level doesn't. Shift+scroll: the reverse. At a 40s zoom, press →: seeks ~6s. Narrow the zoom to 2s, press →: seeks ~0.3s. Select a note, press →: it still seeks proportionally, the note's `start`/`end` are unchanged. |
| E21 | Range-select-and-delete works identically in the full-song notes lane as in the zoomed pane: a resting-state strip and caption whenever edit mode is on, a brighter highlight while dragging or committed, and the same **Delete range** button. | Tick Edit notes with the lane visible: strip and caption appear immediately. Drag the lane's bottom band, click Delete range: notes overlapping the range are removed. |
| E22 | Clicking an unselected note seeks the playhead to the exact clicked point, not the note's midpoint. Tapping (no real movement) an already-selected note's body/edge also seeks, dispatching no edit; an actual drag still moves/resizes as before. | Click near one edge of a wide note: `currentTime()` matches the click, not the midpoint. Click the same spot again without dragging: playhead moves again, edit list gains no new row. Drag a real distance: the note moves and a row appears. |
| E23 | An `add`ed or split-off note sounds through the notes lane's reference tone (with the lane unmuted), even though it sits appended at the end of the note list regardless of its own chronological position. | Split a note early in a long song, play from before the cut with the notes lane unmuted: both halves are audible, not just the one that kept its original array position. |
| E24 | The selection outline draws on exactly the selected note — never on a different note that happens to share the same time point at a different pitch. | Select a note, then add a second note spanning the same time range a few semitones away: only the originally selected note keeps the white outline; the new overlapping note has none, even though it shares the same time span. |
| E25 | A toolbar button or keyboard shortcut (octave, semitone, time nudge, delete, split) always acts on the exact note carrying the outline — never a different note that happens to share the outlined note's anchor time. | Select a note, add a second note overlapping it in time at a different pitch, then press a toolbar button (e.g. ↑ 8ve): only the outlined note's pitch/position changes; the overlapping note is untouched. |

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

## Analytics

| # | Behaviour | How to observe |
|---|---|---|
| A1 | Analytics never breaks the player. With `window.SansAnalytics` deleted, every control still works. | `delete window.SansAnalytics` in the console, then load a song, play, seek, toggle a lane. No console errors, no dead listeners. |
| A2 | `play` fires once per page load, from the user gesture only. | `SansAnalytics.reset(); SansAnalytics.setSink(console.log)`, then press space twice and scrub while playing. Exactly one `play`. |
| A3 | Interaction counts emit power-of-two buckets. | Toggle one lane eight times: `toggle`, `toggle-2`, `toggle-4`, `toggle-8` and nothing else. |
| A4 | No event name carries user content. | Load a song with a distinctive filename, exercise every control, and confirm no logged name contains any part of it. |
| A5 | Events fired before GoatCounter loads are not lost. | `SansAnalytics.reset()` (clears the sink), fire events, then `SansAnalytics.setSink(console.log)`. The queued names appear in order. |
| A6 | Events do not reach GoatCounter from localhost. | Expected and deliberate — `allow_local` is not set. Use the sink recipe above to verify locally. |
| A7 | `separate-handheld-blocked` fires **once** per visitor shown the message, never once per poll. | `refresh()` runs every 400 ms, so it uses `once()`. With the sink attached, load a song on a handheld and wait several seconds: exactly one. |

## Constraints that are not features

Breaking any of these breaks the project, not just a behaviour.

- The site is served over HTTP. `file://` support was dropped in v1.5.0 — local use goes
  through `./scripts/serve.sh`, which separation already required.
- No build step, no dependencies, no npm, no framework.
- No audio ever leaves the machine, and no filename or song title does either. The one
  outbound beacon is GoatCounter, carrying event names from a fixed set — see the
  Analytics section above. Inbound fetches (ORT from jsDelivr, model from Hugging Face)
  are fine and necessary.
- `ort.env.wasm.numThreads = 1`, so no SharedArrayBuffer, so no COOP/COEP, so GitHub Pages
  can host it at all.
- `rips/` and `stems/` are never committed, published, or copied out of the project.
