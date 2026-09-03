# Expected behaviour

What the player is supposed to do, written so a later session can check it still does.
Every item is phrased as an observable outcome with a way to observe it — not as a
description of the code, which would just rot alongside it.

**Keep this current.** Changing behaviour means changing this file in the same commit.
If you find an item here that no longer matches the app, one of the two is a bug; decide
which before moving on.

Last exercised end-to-end: **v1.2.2**; the Loading and Loading-the-page-itself rows were re-run in **v1.4.0**, and the Loading / Lanes / Unmute-all / Play-dropdown rows touched by v1.6.0 were re-run in **v1.6.0**. E19, E24 and E25 were re-run in **v1.16.2**. E27-E32 were run in **v1.16.3**; E27, E28 and E33 were run in **v1.16.4**. T1-T14 and T16 (tempo grid) were run in **v1.17.0** against a synthetic vocals+drums stems set (120 BPM click track); T15 was reasoned rather than run, for lack of a real narrated-intro track short enough to exercise through browser automation. N56-N62 (zoomed-pane lane selector) were run in **v1.17.1** against `6 南國的風 (test).zip`, in both locales. T17-T18 (sub-beat dotted lines) were run in **v1.17.2** against a synthetic vocals+drums stems set (120 BPM, no phase offset), verified both visually and by sampling canvas pixel data at the expected sub-beat x-coordinates. N5, N18 and N63-N66 (overview lane, always-visible zoomed pane, Notes-chip/Edit-toggle detection gating, master-volume mirror) were run in **v1.18.5** against a synthetic vocals+bass+drums stems set, including sampling the overview canvas's own pixel data to confirm the playhead clip boundary. E37 (drag-to-grid snap) was run in **v1.22.0** against a synthetic bass+drums stems set (120 BPM click track), by dispatching real `PointerEvent`s at calibrated canvas coordinates and reading the exact millisecond values back from the Start/End fields — confirming a resize-end snap to the beat grid, no snap with the grid off, and a move snapping to the finer half-beat grid while preserving duration exactly. Items marked ⚠ were reasoned from the code rather
than run in that session, so treat them as the least trustworthy rows here.

---

## The test harness

`npm test` (Vitest) covers the pure functions and runs from the CLI, no browser tool
needed — see `vitest.config.js` and [`docs/deployment.md`](deployment.md) for how it splits
tests across node/jsdom/headless-Chromium tiers. Everything below is a different thing:
behaviour that only shows up in a real, interactive browser, observed by hand or via
browser automation. `npm run dev` first — separation and ES modules need HTTP.

Five things that will waste an hour if you don't know them:

- **`el.hidden` is the state, not the appearance.** Assert on
  `getComputedStyle(el).display !== 'none'`. A `hidden` property reading `true` while the
  user still sees the button is exactly the bug that shipped in v1.2.1.
- **Take a screenshot.** Four property assertions passed against a visibly broken panel in
  v1.2.2. The picture caught it immediately.
- **A same-URL navigation can reuse the cached stylesheet.** This is a browser navigation
  cache quirk, independent of which dev server serves the page. Force it:
  `link.href = 'styles.css?v=' + Date.now()` (a one-off diagnostic override — unrelated to
  the retired production `?v=` convention).
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
input has no `multiple`. To load a set of stems instead of faking a separation result, use
`loadStemsZip()` below; there is one picker for both and `app.js` dispatches on the
extension.

### Synthesising stems on the fly

No fixture files are committed for this. Most rows need a different stem combination
(vocals-only, bass-only, both, ± drums, …), so a folder of pre-built `.zip`s either stays
incomplete or grows into a large parallel matrix — and a checked-in binary fixture can drift
silently out of sync with `encodeWav`/`buildZip`'s actual current output, with nothing to
catch it the way `versions.test.js` catches a stale `?v=`. This recipe has no such file to go
stale: it always calls the real encoder fresh. Paste it once per page load, then call
`loadStemsZip()` for whatever row is being exercised:

```js
function sine(freq, seconds, sr = 44100) {
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.3 * Math.sin(2 * Math.PI * freq * i / sr);
  return out;
}

/** A synthetic stems .zip Blob, built straight in the page. `stems` is `{name: freqHz}` —
 *  e.g. `{ vocals: 440, bass: 110, drums: 80 }` — each becoming `<name>.wav`, mono duplicated
 *  to stereo, `seconds` long (default 3; use longer for tempo detection, which needs several
 *  beats). Imports lib/wav.js and lib/zip.js by their real dev-server path — needs
 *  `npm run dev` (see above); Vite serves both as real files there, no build/hash step
 *  in the way, unlike a `npm run build` + `npm run preview` copy. */
async function buildStemsZip(stems, seconds = 3) {
  const { encodeWav } = await import('/lib/wav.js');
  const { buildZip } = await import('/lib/zip.js');
  const entries = Object.entries(stems).map(([name, freq]) => {
    const ch = sine(freq, seconds);
    return { name: `${name}.wav`, bytes: encodeWav(ch, ch, 44100) };
  });
  return buildZip(entries);
}

/** Builds the zip above and feeds it through the real picker, exactly like a user drop. */
async function loadStemsZip(stems, seconds) {
  const blob = await buildStemsZip(stems, seconds);
  const file = new File([blob], 'synthetic.zip', { type: 'application/zip' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.getElementById('file-input');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
```

`loadStemsZip({ vocals: 440, bass: 110 })` loads a two-melodic-stem song in one call; drop a
key to omit that stem (`loadStemsZip({ bass: 110, drums: 80 })` has no vocals, for exercising
N22a). `#file-input` clears its own `value` after every change, so a second call fires again
rather than being swallowed — but reload the page between unrelated scenarios rather than
relying on that, since `buildUI()` doesn't reset everything a fresh load does (tempo range,
edit history, etc. — see the songload reset rows).

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

## Deployment smoke test

A fast, narrow pass for one specific question: **is the build/deploy wiring intact** —
every script tag resolving, every `new Worker(new URL(...))` / `addModule(new URL(...))`
reference actually loading its module — as opposed to "does the app still behave
correctly," which is the rest of this file's job. Run this after touching
`vite.config.js`, an entry HTML file, a Worker/worklet instantiation, or a CI workflow;
after a real deploy (a PR preview or `main` going live); or as a quick health check
instead of the full matrix when nothing UI-shaped has changed. It does **not** replace
the full matrix for an actual behaviour change — it asserts a clock advances and the
console stays clean, not gain ramps or computed styles or exact message text.

Each step below cross-references the fuller row(s) it draws from rather than repeating
their assertions. First assembled as the live-deployment check for the v1.20.0 npm +
Vite migration, which is exactly what motivates it existing as a named, reusable
sequence: that migration shipped two bugs — a script tag Vite's build silently left
unprocessed, and an `AudioWorkletNode`'s import Vite silently left unbundled — that
`npm run dev` and even `npm run build` + `npm run preview` didn't catch, and only a
real deploy did. See the devlog's v1.20.0 entry.

**Important:** unlike the full matrix, do **not** use the "Faking a separation run"
recipe above for the separation step below. That recipe exists to skip a slow model
download when what's under test is `separate.js`'s *message handling* — but here the
thing under test is whether `separate.worker.js` itself loads at all, which faking the
`Worker` constructor bypasses entirely. A worker that's broken at the module level would
pass a faked run and fail a real one. Same logic for `notes.worker.js`.

1. Load the page fresh. Console has zero errors. (G1, G2)
2. Every entry HTML's script/link tags resolve to files that actually exist — check the
   Network tab (every request 200, none 404), or against a built copy, that
   `dist/index.html`'s hashed `<script src>`/`<link href>` names match files present in
   `dist/assets/`. (G3, G4)
3. Load one whole-song audio file. Confirm exactly one lane labelled **Full mix**, and
   that `AudioContext.sampleRate` reads `44100`. (L1, L7)
4. Click a lane's name block. Confirm it dims and nothing else does. (M1)
5. Move the speed slider off 100%. Confirm the transport clock keeps advancing and the
   console stays clean — this is the one `AudioWorkletNode` load in the whole app, and
   the exact thing that broke silently in dev/preview but not in production. (S1, S4, S5
   under Playback speed)
6. Set an A–B loop (`a` then `b`) and **sample the playhead across two laps** — confirms
   it actually wraps, not just that the bounds got set. (R1)
7. Click **Separate into 6 stems** for real (see the note above — don't fake the
   worker here) and wait for it to finish. Confirm the status line goes empty and
   exactly six lanes replace the one, with no Full mix left over. This exercises
   `separate.js`'s own `Worker`. (S4, S7 under Separation panel)
8. Click **Find notes** for real. Confirm both note counts populate and, with a drums
   stem present, the tempo panel appears with a BPM. This exercises `notes.js`'s
   `Worker` — a second, independent module boundary from step 7's. (N1–N3 under Notes
   lane; T1–T2 under Tempo grid)
9. Switch language mid-playback. Confirm the transport clock keeps advancing across the
   switch. (N4 under Language)

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

## Playback speed

| # | Expected | How to observe |
|---|---|---|
| S1 | A speed control (slider, 10–150%, step 5) is present in the controls bar, alongside Volume. | `#speed` exists with `min=10 max=150 step=5`. |
| S2 | Always starts at 100% when a song loads — never persisted across songs or reloads. | Set it to e.g. 70%, load a different song: reads 100% again. |
| S3 | ⚠ Changing speed away from 100% audibly changes tempo while the pitch stays the same. | Play a held note at 70% and at 130%: the tone is slower/faster but not lower/higher — the thing native `playbackRate` cannot do. |
| S4 | At exactly 100% the native, unprocessed playback path runs — zero behaviour change from before this feature. | No `AudioWorkletNode` is created; `stretchNodes` stays empty. |
| S5 | ⚠ Crossing the 100% ↔ non-100% boundary rebuilds the audio graph (same `stop()`→`play()` pattern as a loop-bounds change); staying on one side of it while dragging the slider does **not** restart the audio. | Drag the slider between two non-100% values during playback: no audible glitch/restart. Cross 100% itself: a brief rebuild is expected, same as pressing `a`/`b`. |
| S6 | `[` / `]` nudge the rate ±5%, clamped to [10, 150]; Shift+`[` / Shift+`]` nudge ±1% over the same range; `\` resets to 100%. | Press repeatedly past either bound: it stops at 10 or 150, for both the coarse and fine step. `\` from any value returns to 100. |
| S7 | A–B looping and seeking still work at non-100% rates. | Set a loop, change speed, seek inside and outside the loop: behaves like at 100%, aside from the known loop-seam limitation (S9). |
| S8 | Sonify reference tones (Notes lane) stay locked to the (possibly slowed/sped) stems. | With a Notes lane active, play at 70%: the tone timing tracks the slowed audio rather than the original tempo. |
| S9 | A time-stretched A–B loop can have a faint discontinuity at the seam — accepted, not fixed by this feature. Native 100% looping is unaffected. | Loop tightly at a non-100% rate and listen at the wrap point; a native 100% loop over the same points stays glitch-free. |
| S10 | Returning to 100% falls back to native playback with no lingering artifacts. | Play at 70%, then reset to 100% mid-playback: sounds identical to a song that was never rate-changed. |
| S11 | The current speed is shown next to every time-code — the main transport, and the Overview/Zoom lanes when present — always visible, not just away from 100%. | `#t-speed` reads e.g. `70%`; the Overview/Zoom `.time-code` text ends `· 70%`. Updates live while playing and immediately on a paused rate change. |
| S12 | When a drums stem has a confidently detected tempo (see Tempo grid, T-series below), a calculated/original BPM readout appears next to the speed tag — the BPM a metronome would need at the CURRENT rate, over the BPM notes.js reports (auto-detected or manually overridden). Absent until then. | `#t-bpm` reads e.g. `84.0/120.0 BPM` at 70% on a 120 BPM song; hidden while `tempo.confidence` is 0 (no drums stem, or not yet analysed). Typing a manual override in the tempo panel changes the second number within ~400ms (`sansbass:tempo`'s poll interval); the first number rescales the moment the speed changes, no poll delay. |

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
`window.sansBass`, the same seam `separate.js` uses. It creates two independent channels —
`createNotesChannel('vocals', ...)` and `createNotesChannel('bass', ...)` — each with its own
frames, notes, edits, jianpu state and worker. Tempo state is the one exception: it is
shared, module-level code in `notes.js`, since it is derived from drums and does not depend
on which melodic stem is being read. Each channel's lane is built by `app.js` inside
`buildUI()`, not declared in `index.html` — `el.lanes.innerHTML = ''` destroys anything
parked inside `#lanes`, so a static element would survive exactly one song. The one shared
zoomed pane and its editing toolbar always operate on whichever channel `app.js`'s
`zoomNotesStem` currently points at — see the design spec,
[`2026-09-01-bass-notes-design.md`](superpowers/specs/2026-09-01-bass-notes-design.md).

The layer model these rows exercise is in [`docs/transcription.md`](transcription.md):
analysis is immutable, interpretation is re-derived, and the two must stay separable.

| # | Expected | How to observe |
|---|---|---|
| N1 | Each panel appears only once that channel actually **has notes** — not merely once its stem is loaded, same principle as the meta/tune rows inside it (N22b) and `#notes-tempo` (T1). `#notes-vocals` needs vocals notes, `#notes-bass` needs bass notes, independently of each other. A song with only one melodic stem never shows the other panel at all, before or after Find Notes; a stem that IS loaded still shows nothing — label, Export/Import, Export list, all of it — until its own detection completes. | Computed `display` of `#notes-vocals` and `#notes-bass`. Never `.hidden` — `.notes` sets `display: flex`, so only the global `[hidden] { display: none !important }` keeps the attribute working. Load a two-melodic-stem zip: both hidden right after `buildUI()`, before Find Notes; each becomes visible independently once that channel's `#notes-count-*` populates. |
| N2 | Detection never starts by itself, for either channel. It costs ~7 s of CPU on a cold first run, which is a surprise rather than a convenience. | Load a stems zip with both stems, wait 10 s: every `.lane.ribbon` (`document.querySelectorAll('.lane.ribbon')`) is still `hidden`. |
| N3 | While analysing: the shared **Find notes** button (`#notes-go-all`) disabled, a spinner, and a "Detecting: …" hint next to it naming exactly which stem(s) are still in flight — not a generic message, and not the old shared `#status` line, so one channel finishing first is never mistaken for the whole run being done. No progress bar: `f0Track` reports no progress, and a bar that jumps 0 → 100 is worse than none. | `#notes-go-all.disabled`, `#notes-detect-spinner` computed `display`, `#notes-detect-status.textContent`. With both vocals and bass pending: text names both; once vocals lands, it narrows to naming bass alone while `#notes-go-all` stays disabled and the spinner keeps spinning. |
| N4 | On success the status line goes **empty** — the lane appearing is the confirmation. | `#status.textContent === ''`. |
| N5 | Each stem's own notes lane sits directly under that stem's own waveform lane — a bass-notes lane under the bass waveform, a vocals-notes lane under the vocals waveform. The one shared **overview** lane and, directly below it, the one shared **zoomed pane** dock above whichever comes first, vocals-priority: DOM order at the top of `#lanes` is `[.lane.overview, .lane.ribbon-zoom, vocals waveform, vocals .ribbon]`, with the bass `.ribbon` lane elsewhere in `#lanes`, directly under the bass waveform lane. | With both stems loaded: `document.querySelector('.lane.overview').nextElementSibling` is `.lane.ribbon-zoom`, whose own next sibling is the vocals waveform lane, whose next sibling is the vocals `.lane.ribbon`. Separately, `document.querySelectorAll('.lane.ribbon')[1]` (bass)'s previous sibling is the bass waveform lane, with no `.ribbon-zoom` anywhere near it. |
| N6 | The ribbon is on the same time grid as every waveform: its canvas is the same CSS width, and it reflows with them on resize. | Compare `getBoundingClientRect().width` against a `.lane:not(.ribbon) canvas.wave`, before and after a resize. Must match both times. |
| N7 | Clicking the ribbon seeks, like any other lane. | Click at 50% of its width; `#t-cur` must read half the track length. |
| N8 | Moving **Shortest note** changes the note count **without re-running analysis**. | Time it: the count must change in tens of milliseconds, not seconds. That the slider moved is not evidence of anything — read `#notes-count-vocals` (or `-bass`). Measured on `6 南國的風`: 120 ms → 228 notes, 200 ms → 99, 80 ms → 437, each in 11–15 ms. |
| N9 | **Fit the lane to the melody** is **off by default** — ticking it narrows the lane's vertical range to the melody, rather than the reverse. | `#notes-clip-vocals`/`-bass.checked` is `false` right after Find Notes, before either checkbox is ever touched. `SansRibbon.pitchRange(notes, {clip:false})` must span more than with `clip:true`. |
| N10 | A note outside the clipped range is drawn at the lane edge in the A–B orange, never dropped. A hidden note would be a silent lie. | Load a track with octave errors; orange marks appear on the edge. |
| N10a | Clip is **display only**. It feeds `pitchRange()` and nothing else: it is not passed to `interpret()`, so the note list is identical either way, and a clipped note still *sounds* at its detected pitch. | Toggle it: `#notes-count-vocals` (or `-bass`) does not change, and the payload's `notes` array is unchanged. It rides in the `setNotes` payload, never in `params`. |
| N11 | The contour breaks at every unvoiced run and never bridges one, in both panes. | The lane uses `SansRibbon.contourColumns`, which returns `null` for a column holding no voiced frame — assert a null between two non-null columns. The zoomed pane breaks its polyline inline; observe it by rendering a window containing a rest and checking the line does not cross it. |
| N12 | Loading a new song clears both lanes, even when the new song has the same stems. The old frames describe the old audio. | Load a second zip; every `.lane.ribbon` computed `display` is `none` and each one's canvas `__layers` is `null`. |
| N13 | Neither lane is in `tracks`. Each has its own mute and volume but **no number key**, and mute-all, solo and the stem count all ignore both. | Press `0`: every `.lane:not(.ribbon):not(.ribbon-zoom)` gains `.muted` while `window.sansBass.ribbonMuted('vocals')` and `.ribbonMuted('bass')` are both unchanged. Neither ribbon lane has a `.kbd` child. |
| N14 | The lane label follows the language toggle. The note **names** drawn inside it never translate, exactly as stem ids and filenames do not. | Switch locale: the label changes, the block labels stay `C#4`. |
| N15 | Each lane plays its own notes as tones, **muted by default**, independently of the other. Clicking a lane's name toggles only that lane. | `window.sansBass.ribbonMuted('vocals')` and `.ribbonMuted('bass')` are both `true` on load; clicking the vocals lane's `.lane-name` flips only `ribbonMuted('vocals')` to `false`, leaving bass untouched. |
| N16 | The synth is locked to the same `t0` as the stems, and follows A–B repeat by generating laps. | Set A–B, play with the lane unmuted: the notes repeat with the audio rather than drifting or stopping after one pass. |
| N17 | Dragging the lane's bottom grip resizes it, and the height survives a reload. | Drag `.ribbon-grip`; the canvas `style.height` changes and `localStorage['sans_bass.ribbonHeight']` is written. |
| N18 | One shared zoomed pane sits directly above whichever note lane comes first (vocals-priority), showing a window of the song rather than all of it. Unlike the per-stem note lanes, it is **always visible** — from the moment a vocals or bass stem loads, before Find Notes has ever run — since it's useful as a plain-waveform tool on its own; only the Notes chips and Edit toggle *inside* it wait for detection (N63). It follows the playhead while playing, panning by dragging when stopped. | `.ribbon-zoom` exists exactly once even with both stems loaded, and its computed `display` is never `none` — right after `buildUI()`, before any click on Find Notes. Drag `.zoomwave` and the ruler labels change while the lanes below do not move. Mute/hide every note lane: the pane itself stays open (only N63's chips/toggle react). |
| N19 | The wheel zooms the pane about the cursor, between 2 s and 60 s, and the width survives a reload. | Scroll on `.zoomwave`; `.zoom-secs` changes and `localStorage['sans_bass.zoomSeconds']` is written. |
| N20 | At whole-song width the lane draws the contour as a per-pixel band, not a polyline. A polyline there joins pitches ~26 frames apart and buries the notes under vertical strokes. | Compare: `SansRibbon.contourColumns` is what the lane uses; the zoomed pane draws the line directly. |
| N21 | Note names are labelled on every semitone at ≥7 px per semitone, fall back to C only between 6 and 7 px, and disappear entirely below 6 px. | Shrink the lane to its 96 px minimum: over a typical ~27-semitone range that is ~3.5 px per semitone, so **no** labels remain. C-only needs the narrow 6–7 px band. |
| N22 | One shared **Find notes** button (`#notes-go-all`), not one per panel: clicking it runs analysis on every channel that still needs it (has a stem, no notes yet) and leaves the rest alone. Once notes are found in a panel, that panel's own show/hide toggle appears — the same swap the separation panel does with Separate → Save. Once **every** melodic stem present has been analysed, the whole `#notes-detect` section hides outright (N22a) rather than sitting there disabled — nothing it could still do for this song. Loading a new song brings the section and both toggles back. | Computed `display` of `#notes-show-vocals` / `#notes-show-bass`; computed `display` of `#notes-detect` after analysing only one of two loaded stems (still visible) vs. after both (hidden). |
| N22a | `#notes-detect` has three states, not two: **disabled** (visible) when no melodic stem was ever loaded — nothing this button could ever do for this song, so it stays legible rather than vanishing; **enabled** when at least one present stem still needs analysis; **hidden** once every present stem has been analysed. A zip with only a bass stem (no vocals) leaves it enabled and, clicked, analyses bass only — `#notes-vocals` stays hidden throughout, per its own has-notes gate (N1), and is never touched; once that bass run lands, the section hides (there is no vocals left to wait for). A zip with **neither** melodic stem disables it immediately on load, with no click needed to observe it, and it never hides since there is nothing to ever finish. | Load a bass-only zip: `#notes-detect` visible, `#notes-go-all.disabled` is `false`, `#notes-vocals.hidden` is `true`; click it, wait for `#notes-count-bass` to populate: `#notes-detect`'s computed `display` becomes `none`. Load a zip with neither vocals nor bass (e.g. drums+guitar+piano+other only): `#notes-detect` stays visible with `#notes-go-all.disabled` `true` right after `buildUI()`, before any click, and stays that way indefinitely. |
| N22b | Each panel's count/toggle/簡譜/key row (`#notes-meta-vocals` / `-bass`) is hidden until that channel actually has notes, same as its advanced tune row (`#notes-tune-vocals` / `-bass`) already was — an empty count and disabled key selectors sitting there from the moment the stem loads would look like output before there is any. | Load a zip with vocals+bass: immediately after `buildUI()`, `#notes-meta-vocals` and `#notes-meta-bass` are both hidden (computed `display: none`); after **Find notes**, each becomes visible independently, in whichever order that channel's analysis actually lands. |
| N23 | Hiding a lane also **mutes** it, independently of the other lane. A pane you cannot see must not still be sounding, because nothing on screen would stop it. | Unmute vocals, then Hide it: `window.sansBass.ribbonMuted('vocals')` becomes `true`; bass is unaffected. |
| N24 | Showing a lane again does **not** unmute it. The mute is a separate decision, per lane. | Hide then Show: still muted. |
| N25 | Seeking anywhere brings the zoomed window with it, but only when the playhead has left the window — clicking *inside* the zoom pane does not yank the view sideways. | Seek from the main overview; the playhead is drawn at the centre of `.zoomwave`. Then click inside the pane; the window does not recentre. |
| N26 | The zoomed pane resizes by its own grip, independently of the lane, and the height persists. | Drag `.ribbon-zoom .ribbon-grip`; `localStorage['sans_bass.zoomHeight']` is written. **Check the grip's position, not just that dragging works:** it is absolutely positioned, so a lane missing `position: relative` puts it over a *different* lane while the drag still functions. Assert its rect sits inside its own lane's rect. |
| N27 | The zoom width is driven by the `−`/`+` buttons as well as the wheel, and persists. | Click both; `.zoom-secs` changes and `localStorage['sans_bass.zoomSeconds']` is written. |
| N28 | A click in the zoomed pane seeks; a drag pans without seeking. | Click: the clock moves. Drag >4 px: the clock does not. |
| N29 | **Whole-phrase detection** under Advanced switches interpreters without re-analysing. | Tick it and time the change: the note count in `#notes-count-vocals` (or `-bass`) must move within tens of milliseconds, not seconds. Measured 229 → 268 in 22.5 ms on `6 南國的風`. |
| N30 | It is **on** by default as of v1.14.0, so `hmm-v1` is the shipped interpreter. | Load a song, run detection: `#notes-hmm-vocals.checked` (or `-bass`) is `true` and the payload's `params.interpreter` is `hmm-v1`. It shipped off and marked experimental in v1.12.0 because its one regression was octave-**up** errors; octave folding (v1.13.0) is the pass that corrects exactly those, so the tradeoff that justified the default no longer holds. Unticking still returns the full `threshold-v1` output, which is what makes the change safe to reverse per-song. |
| N31 | The **Shortest note** slider stays meaningful in both modes — a duration floor for `threshold-v1`, an onset cost for `hmm-v1`. | Drag it with the box both ticked and unticked; the count moves in the same direction both times. Measured at 20/80/200/400 ms: 1162/437/99/48 unticked, 928/357/196/142 ticked. |
| N32 | An unknown interpreter name degrades to `threshold-v1` rather than failing. | `interpret(track, { interpreter: 'nonesuch-v9', params: {} })` returns notes. So does a track carrying no `candidates` — an analysis from before they existed still opens. |
| N33 | **Fix octave outliers** never changes the note count. It corrects pitches and marks what it will not correct; it adds and removes nothing. | Tick it: `#notes-count-vocals` (or `-bass`) does not move. Verified on four tracks × both interpreters — 187/187, 313/313, 270/270, 342/342 and the `hmm-v1` equivalents. This is the strongest single check on the feature; a moved count is a real bug. |
| N34 | It is **off** by default. | Load a song, run detection: `#notes-fold-vocals.checked` (or `-bass`) is `false`, and no note carries a `fix` field at all (test `!('fix' in n)`, not `!n.fix`). |
| N35 | A folded note draws **blue**, a doubtful one **gray** — but only while the note is inside the lane's vertical range. **Out-of-band beats provenance:** a note you cannot see at all is the more urgent fact, so it stays orange at the edge whatever its `fix`. | Pin the scale state before asserting a colour, the way N9 does. With **Fit the lane to the melody** ticked on `ng_kipin`, 12 of 16 doubtful notes draw gray and 4 draw orange — so a row asserting gray unconditionally would be flaky. Read `canvas.__layers`, **not** the composited canvas: `renderRibbon` only ever draws to the layers and `paint()` composites them, so sampling the visible canvas at frac 0 sees the idle layer alone. |
| N36 | A **doubtful note makes no sound** but stays visible. | Count `OscillatorNode.prototype.start` calls, or better, render offline and measure RMS in the note's window — `tests/sonify.test.js` does the latter. Check with an A–B loop set too: `scheduleNotes` has two collection loops and only one runs without a loop. |
| N37 | The silence in N36 is **not negligible**: at the shipped `confidentWithin` of 1.5, doubtful notes are **7.5–8.1% of note time**, roughly one note in ten on the worst track. That is the deliberate cost of never claiming a pitch we cannot justify. | Measured on `ng_kipin` (7.5%) and `9 繼續向前行` (8.1%). The earlier figure of 1.6% was taken at `confidentWithin: 5`, before that value was found to fold octave-plus-a-fifth errors. |
| N38 | Folding **never changes pitch class**, so the detected key is unaffected. | `notesToChroma(notes)` is byte-identical with and without `fold: true`. This is what makes changing the note list safe, and it holds because every shift is a whole number of octaves. |
| N39 | Both colours and the silence are **reversible**. Unticking restores the previous note list exactly. | Untick: `#notes-count-vocals` (or `-bass`) returns to its previous value and the blue and gray pixels disappear from `canvas.__layers.active`. A one-way control would be a defect. |
| N40 | **Fold tolerance** adjusts `confidentWithin` live, and the readout beside the checkbox updates as it moves. | Drag `#notes-fold-tol-vocals` (or `-bass`); `#notes-fold-stats-vocals` (or `-bass`) changes while `#notes-count-vocals` (or `-bass`) does not. Measured on `6 南國的風` at 120 ms: 0.5 → 1 corrected/13 muted, 1.0 and 1.5 and 2.0 → 3/11, 3.0 → 6/8. |
| N41 | The tolerance slider is **inert while folding is off** — disabled and dimmed, not silently ignored — and the readout is hidden. | Untick `#notes-fold-vocals` (or `-bass`): `#notes-fold-tol-vocals.disabled` (or `-bass`) is `true` and `#notes-fold-stats-vocals.hidden` (or `-bass`) is `true`. |
| N42 | The slider runs to **8**, so the whole range can be explored — but the readout turns **orange** from 2.5 up, where corrections start being trusted that cannot be justified. | `#notes-fold-tol-vocals.max === '8'` (or `-bass`); `#notes-fold-tol-out-vocals` (or `-bass`) gains `.risky` and `var(--loop)` at ≥ 2.5. Measured on `ng_kipin` at 100 ms, folded / muted / **provably wrong** (folded onto a 3rd or 6th harmonic, classified independently): 0.5 → 2/21/0, 1.5 → 9/14/0, 2.5 → 11/12/**0**, 3 → 14/9/**3**, 5 → 21/2/**8**, 8 → 23/0/**10**. The first unjustifiable fold appears at 3; at 8 nothing is marked and roughly half the corrections are wrong. |
| N43 | The readout's two numbers carry the **lane's own colours** — folded blue, muted gray — so the count and the picture agree without a legend. | `getComputedStyle` on `#notes-fold-stats-vocals` (or `-bass`) children gives `rgb(108,197,224)` and `rgb(168,168,184)`, matching `NOTE_FILL.folded.normal` and `NOTE_FILL.doubt.normal`. |
| N44 | **簡譜** replaces note names with scale degrees and is **off** by default. | Load a song, run detection: `#notes-jianpu-vocals.checked` (or `-bass`) is `false` and the lane draws `A#3`-style names. |
| N45 | The key selectors are set from `detectKey()` on the notes, and go **inert** while 簡譜 is off. | After detection, `#notes-key-tonic-vocals` and `#notes-key-mode-vocals` (or their `-bass` equivalents) carry the detected key and are `disabled`; ticking the box enables them. |
| N46 | The mode selector changes what the **numbers mean**, not just which note is 1. | In `1=C major` an E♭ note draws `♭3`; switch to `minor` and the same note draws `3`. |
| N47 | **⇄** swaps the current key for its relative, and swapping twice returns. | From `1=A minor`, one click gives `1=C major`; a second returns to `1=A minor`. |
| N48 | Touching a key control **stops** the detected key from being re-adopted. | Set the tonic by hand, then drag Shortest note to force a re-interpretation: the chosen tonic survives. |
| N49 | The octave is shown **only on the axis**, as 簡譜 dots — never on the note blocks. | With 簡譜 on, no block label contains a digit-plus-octave like `13`; the axis has exactly one dotless band. |
| N50 | When the lane is too tight for every semitone, the axis labels the **tonic**, not C. | Set `1=G` and shrink the lane: the sparse labels fall on G. Labelling C in every key would be meaningless. |
| N51 | With octave folding on, degrees follow the **corrected** pitch, so the 簡譜 reading changes when the fold controls do. This is correct, not a bug. | Tick Fix octave outliers with 簡譜 on: some block labels change. Folding preserves pitch class, so a fold never changes a digit — only which octave dot it carries. |
| N52 | Loading a **new song** hands each channel's key back to automatic detection, independently, even after an override. The 簡譜 checkbox itself survives the load, per channel. | Override the vocals tonic on song A, load song B, run detection on vocals: its selectors show B's own detected key, not A's, and bass (if also present) does its own independent detection. `jianpu.auto` is reset in each channel's own `reset()`. |
| N53 | The **zoom pane's** axis matches the lane's: degrees and octave dots, not note names. | With 簡譜 on, capture `fillText` on the zoom canvas — the axis reads `2 b3 3 4 #4 5 …`, not `D2 D#2 E2`. The zoom pane is the view a pitch is read off; degree blocks against a note-name axis put both notations side by side in the one place it matters. |
| N54 | The **bright gridline follows the tonic**, so the highlighted rule and the highlighted label sit on the same row. | In `1=G` the bright rules move off the C rows onto the G rows (measured: y 114/286/457 → 14/186/357/529). With 簡譜 off they are back on C. |
| N55 | A disabled **⇄** looks disabled. | With 簡譜 off, `getComputedStyle(#notes-key-rel-vocals)` (or `-bass`) gives `opacity: .45` and `cursor: default`, and the hover rule does not brighten it. `.btn[disabled]` does not match `.mini`, so without an explicit rule the button read as live while doing nothing — the same trap as the `[hidden]` one. |
| N56 | The zoomed pane's header carries a **lane selector** on its own row, below the title/seconds row: one labelled chip per stem actually loaded, plus **one "`<lane>` notes" chip per note-capable stem that has a lane** (up to two — vocals and bass), plus the one global Edit-notes toggle. A colour dot alone doesn't say which stem it is, so every plain-waveform chip also carries the stem's own name, and each Notes chip names which channel it selects. Nothing is selected before either channel has notes; the plain-waveform selector's own default is unchanged (`vocals`). | `.zoom-lane-sel .zoom-chip` count matches `tracks.filter(t => t.stem).length` plus the number of note-capable stems with a lane; each `.zoom-notes-chip`'s text equals `{lane} notes` for its stem (e.g. "Bass notes"). |
| N56a | Exactly one Notes chip can be **selected** at a time — clicking one clears the other (`zoomNotesStem` holds a single value, never a set); clicking the already-selected chip clears the selection entirely, removing the pitch grid/contour/note blocks from the pane while the pane itself stays open (N59). Selection is claimed automatically by whichever channel **finishes analysis first**; analysing the other channel afterward does not steal it away. | Find notes on bass only: its chip becomes `.active`; there is no vocals chip to steal selection from yet. With both found, click the bass chip while vocals is `.active`: vocals loses `.active`, bass gains it, and vocals' own edit list is untouched. Click the active chip again: neither chip is `.active`, and the pane falls back to plain waveforms (N59). |
| N56b | Each Notes chip's **mute** glyph is independent of the other's, and independent of which chip is currently *selected* — muting bass's synthesised notes does not affect whether the pane is currently *showing* bass's pitch overlay, or vice versa. | With bass selected and unmuted, click vocals' mute glyph: `window.sansBass.ribbonMuted('vocals')` toggles; the pane keeps showing bass's overlay throughout. |
| N56c | The **Edit notes** toggle is one global control beside the two Notes chips, not duplicated per panel. It is disabled until the currently-selected chip's channel has notes, and switching chips while it is on turns editing off rather than leaving it silently pointed at an unselected (or note-less) channel. | With nothing selected, the toggle is `disabled`. Select a channel with notes and tick it: `.note-toolbar` and the inline fields appear. Switch to the other Notes chip while still ticked and that channel has no notes yet: the toggle un-ticks itself and the toolbar hides again. |
| N56d | Switching which chip is selected **never loses the other channel's edits** — they are held independently in each channel's own `editGroups`, never overwritten. | Edit a bass note, switch to vocals, edit a vocals note, switch back to bass: the bass edit made before switching away is still present in `#notes-edits-bass`'s list and still visible in the lane. |
| N57 | Clicking a stem's chip adds or removes **its waveform** from the pane; any combination can be selected at once. | Call `toggleZoomLane('bass')` (or click the chip): `.zoom-chip-select.on` toggles, and the canvas shows a second overlaid waveform. |
| N58 | While **Notes** is selected, every selected stem's waveform renders **gray** behind the note blocks, whatever its own stem colour — the notes are the thing this pane exists to show. With Notes off, each selected waveform renders in its **own stem colour**, one or many at once. | Sample `canvas.__ctx`-free: read pixel colour in the waveform's vertical band via `getImageData` on the zoomed canvas with Notes on vs. off for the same lane selection — the fill goes from `rgba(255,255,255,.1)`-ish gray to the stem's own hue (`lib/stems.js` colours). |
| N59 | With **no** Notes chip selected, the pitch grid, contour line and note blocks disappear entirely — there is nothing pitched to plot them against, and drawing an axis with nothing on it would be worse than no axis. The pane itself stays open, still showing whatever plain waveforms are checked and the time ruler. **The beat/bar grid is the exception**: it draws whenever any channel that has notes has `tempo.on` true — read from `anyRibbon()`, not the selection — because it's a tempo reference for whatever waveform(s) are on screen, not something the pitch view owns or something that vanishes just because no channel is selected. | Deselect whichever Notes chip is active (click it again): the piano-roll shading and note-name gutter vanish from the canvas; plain waveform(s), the beat grid (if tempo is on for either found channel), and the time ruler all remain, and the pane's `hidden` attribute does not change. |
| N60 | A speaker glyph beside each stem chip mutes/unmutes that lane exactly like clicking its row in the main lane list, and both stay in sync regardless of which one is clicked. **Each** Notes chip carries the same glyph, wired to its own channel's mute (`ribbonMuted(stem)`) — a separate decision from whether that channel's notes overlay is currently shown at all. | Click `.zoom-chip-mute` for vocals: the main `人聲`/`Vocals` row gains `.muted` and the glyph gains `.muted`; click the main lane row instead and the glyph updates the same way — both route through `applyGains()`. Click the bass Notes chip's glyph: `window.sansBass.ribbonMuted('bass')` toggles and so does clicking the bass `.lane.ribbon .lane-name` — both route through `applyRibbonGain('bass')`, leaving vocals' mute untouched. |
| N61 | The plain-waveform lane selection is **not persisted** — it resets to `vocals` on every page load, unlike the zoom width and pane height. `zoomNotesStem` is likewise never persisted — a fresh page load starts with nothing selected until a channel finishes analysis (N56a). | Toggle a plain-waveform chip, reload the page and load a song: it is back to just `vocals` on, and `localStorage` carries no `zoomLaneSel`- or `zoomNotesStem`-shaped key. |
| N62 | The zoom lane's own label ("局部放大" / "Zoom") sits on the **same row as the seconds readout and zoom buttons**, never truncated — the bug this replaced squeezed all three into a 128px column. The lane selector is a **separate row below**, so it reads as its own control rather than a caption for the title. | Load a song, run Find notes: `.zoom-top-row` contains both `.lane-name .txt` and `.zoom-secs-group`, and the text is never clipped (`scrollWidth <= clientWidth` on the `.txt` span); `.zoom-lane-sel` is a sibling row beneath `.zoom-top-row`. |
| N63 | The per-stem **Notes chip** (`.zoom-notes-chip`, wrapped in its `.zoom-chip`) and the one global **Edit notes** toggle (`.zoom-edit-toggle`) are hidden until detection actually has something for them to control — unlike the zoomed pane and overview lane around them, which are always visible (N18, N64). Each chip is hidden independently: it appears once its own channel is both visible and populated. The Edit toggle appears once **at least one** channel is. | Right after `buildUI()`, before Find Notes: both `.zoom-notes-chip`'s `.zoom-chip` parent and `.zoom-edit-toggle` have `hidden === true`. Find notes on vocals only (bass still pending): the vocals chip's `.zoom-chip.hidden` becomes `false` and `.zoom-edit-toggle.hidden` becomes `false`, while the bass chip stays hidden until its own detection lands. Hide a populated channel's ribbon lane (`setRibbonVisible(stem, false)`): its Notes chip hides again. |
| N64 | A shared **overview** lane sits directly above the zoomed pane (N5) — a full-song, never-windowed waveform combining whichever stems are selected below: every stem toggled on via the zoom pane's plain-waveform chips (`zoomLaneSel`), plus whichever channel's Notes chip is selected (`zoomNotesStem`) if any, each overlaid in its own colour. A stem selected only via its Notes chip still draws as a **plain waveform** here — the overview never draws pitch/notes, regardless of what the zoomed pane below it is showing. It is always visible under the same condition as the zoomed pane (N18), independent of note detection, and click/drag-to-seek like any other lane. | `.lane.overview` exists whenever `.lane.ribbon-zoom` does, immediately after `buildUI()`. `overviewStems().map(t => t.stem)` reflects the union of `zoomLaneSel` and `zoomNotesStem` with no duplicates. Deselect a stem's plain-waveform chip while its Notes chip stays selected: `overviewStems()` still includes it. Click at 50% of `.lane.overview .wave`'s width: `#t-cur` reads half the track length. |
| N65 | The overview lane's canvas is exactly the same width, at the same page x-position, as every other lane's — it shares the plain `.lane` grid (label / wave / vol columns) rather than a custom layout, so the playhead lands at the same x on every row including this one. | Compare `getBoundingClientRect()` of `.lane.overview .wave` against any `.lane:not(.overview):not(.ribbon-zoom) .wave` — `width` and `left` must match exactly. |
| N66 | The overview lane's volume slider is not a per-stem control — it's a combination of several stems, so there's nothing single to mute or fade — it mirrors the **master** volume (`#master-vol`) instead, live and in both directions. | Drag `#master-vol`: `.lane.overview .lane-vol input`'s value updates to match. Drag the overview lane's own slider instead: `#master-vol.value` and the actual master gain (via the existing `input` listener) update to match. |

## Tempo grid

`lib/tempo.js` detects BPM/phase from the drums stem inside `notes.worker.js`, bundled into
the same round trip as vocals analysis. `notes.js` owns the resulting `tempo`/`tempoRange`
state; `app.js` draws the grid via `lib/ribbon.js`'s `beatTimes()` and owns the drag-to-select
UI on the drums stem's own lane. Design:
[`2026-09-01-tempo-grid-design.md`](superpowers/specs/2026-09-01-tempo-grid-design.md).

| # | Expected | How to observe |
|---|---|---|
| T1 | `#notes-tempo` itself is hidden — not merely disabled — until a real detection has actually produced a confident result (`tempo.confidence > 0`), same principle as the notes panels: default-120 BPM controls sitting there before any drums audio has been examined would be output before there is any. Resets to hidden on every song load (`resetTempo()` zeroes `confidence`). | Load vocals+bass+drums: `#notes-tempo.hidden` is `true` immediately after `buildUI()`. It stays hidden if the zip has no drums stem at all, indefinitely — there is nothing it could ever detect. |
| T2 | Running **Find notes** with a drums stem present detects tempo in the same pass — no separate button press needed — and that is also the moment `#notes-tempo` first becomes visible (T1), already populated rather than appearing empty first. | After Go, `#notes-tempo.hidden` flips to `false` and `#notes-tempo-status` shows a BPM and confidence percentage. |
| T3 | The grid is **on** by default once detected. | `#notes-tempo-on.checked` is `true` after Go; beat ticks are visible on `.lane.ribbon`'s canvas. |
| T4 | Toggling **Show tempo grid** off removes the grid from both panes without touching the notes. | Untick it: `canvas.__layers.active` loses the vertical tick pixels; `#notes-count-vocals` (or `-bass`) is unchanged. |
| T5 | Editing BPM, phase, or beats-per-bar updates the grid **live, with no re-analysis**. | Time it: changing `#notes-tempo-bpm` must re-space the grid within tens of milliseconds, not seconds — same class of check as N8. |
| T6 | **×½ / ×2** halve/double the BPM field and the grid re-spaces to match. | Click each; `#notes-tempo-bpm.value` halves/doubles and the on-canvas beat spacing visibly changes. |
| T7 | The grid **never changes the note list**. This is the design's central non-goal. | `#notes-count-vocals` (or `-bass`) and the payload's `notes` array are byte-identical with the grid on, off, or with BPM/phase edited. |
| T8 | **Select BPM range** arms a drag surface across the **whole** drums lane, distinct from the note-editing range-select's bottom-strip-only band. Reachable only after the panel's first appearance (T1) — a range can no longer be pre-selected before ever running detection once, only narrowed afterward and re-detected (T12). | Toggle it on: the drums lane's canvas tints faintly across its full height, not just a bottom strip. |
| T9 | Dragging on the armed drums lane commits a selection and updates the caption underneath it; the caption reads "whole song" when nothing is selected. | Drag, release: caption text changes to a `mm:ss–mm:ss` range; **Clear** becomes enabled. |
| T10 | **Clear** reverts to the whole song, both in the caption and in what a subsequent Re-detect analyses. | Click Clear: caption returns to "whole song"; `#notes-tempo-range` button.mini (Clear) becomes disabled again. |
| T11 | Selecting a range does **not** itself trigger detection. | Drag a selection without pressing Re-detect: `#notes-tempo-status` and the drawn grid are unchanged. |
| T12 | **Re-detect tempo** re-runs detection using the current range **without re-running vocals analysis**. | Press it after narrowing the range: `#notes-count-vocals` does not change, but `#notes-tempo-status`'s BPM can. |
| T13 | With the drums-lane range-select off, the lane's normal click-to-seek behaviour is unaffected. | With **Select BPM range** untoggled, clicking the drums lane still moves the playhead, same as any other stem lane. |
| T14 | Export/import round-trips `tempo` and `tempoRange` exactly — both now hoisted to the top of the shared edits file, not duplicated per stem. | Export edits, change BPM/phase/beats-per-bar, re-import the same file: all three return to the exported values. |
| T15 | ⚠ A song with a non-metrical intro (e.g. spoken narration) detects a materially different — and by ear, better — BPM once the range excludes the intro. | Using a real narrated-intro track from `stems/`: compare `#notes-tempo-status`'s BPM over the whole song vs. over a range starting after the narration. |
| T16 | The grid also draws — very faintly, bars only — across each **stem lane's own waveform**, not just the notes lane; the overview wave at the top never gets it. | Zoom into any stem lane's canvas after Go: faint vertical lines recur at the bar period. The overview wave above the lanes stays clean. Toggling **Show tempo grid** off clears lane grids too; editing BPM re-spaces them live, same as the notes lane. |
| T17 | Two toggle buttons (**½** / **¼**) beside the zoomed pane's zoom in/out controls show dotted sub-beat lines **in the zoomed pane only** — off by default. **¼** draws all three quarter-beat points per beat (which includes the half-beat point, drawn fainter); **½** draws just the half-beat point, in a slightly stronger dash, layered on top. Neither appears on the whole-song ribbon or the per-lane grid — those stay bars/beats only. **¼ implies ½**: clicking **¼** on also switches **½** on (so the half-beat point it draws is never contradicted by an off ½ button); clicking **½** off also switches **¼** off. **½** alone is a valid state; **¼** alone is not reachable through the UI. | Click **¼**: dotted lines appear between each pair of solid beat lines, at 1/4-beat spacing, and **½** gains `.active` too. Click **½** off: both buttons lose `.active` and every sub-beat line disappears. Turn **½** back on alone (with **¼** left off): only the midpoint dotted line remains per beat. |
| T18 | The ½/¼ toggle buttons persist for the session (not across a page reload) — same as the zoomed pane's lane selection — and follow the beat grid's own on/off and BPM/phase live-editing, since they share `beatTimes`'s math via `subdivisionTimes`. | Toggle **¼** on, then edit `#notes-tempo-bpm`: the sub-beat dots re-space immediately, same frame as the beat lines. Untick **Show tempo grid**: sub-beat dots disappear along with the beat/bar lines, even though the buttons stay marked active. |

## Note editing

`applyEdits()` (`lib/pitch.js`) runs after `interpret()`/`foldOctaves()` inside each
channel's own `reinterpret()`. `app.js` owns the zoomed pane's selection, toolbar, and
pointer/keyboard interactions, and talks to whichever channel is currently editable through
`sansbass:noteedit` / `sansbass:editundo` / `sansbass:editmode` — the last of these now
carries a `stem` field naming which channel is entering or leaving edit mode, since editing
is inherently single-target across two channels. Each channel gates its own reaction to the
first two events on a private `editable` flag, set from that `stem` field, rather than
reacting to every edit broadcast regardless of who it was for. The original single-channel
design is in
[`docs/superpowers/specs/2026-08-31-note-editing-design.md`](superpowers/specs/2026-08-31-note-editing-design.md),
extended to two channels by
[`docs/superpowers/specs/2026-09-01-bass-notes-design.md`](superpowers/specs/2026-09-01-bass-notes-design.md).
The inline Start/End/Pitch fields beside the toolbar (rows E27-E32) are a later addition — see
[`docs/superpowers/specs/2026-09-01-note-inline-fields-design.md`](superpowers/specs/2026-09-01-note-inline-fields-design.md).

| # | Expected | How to observe |
|---|---|---|
| E1 | The one global **Edit notes** toggle (`#notes-edit`, beside the two Notes chips, not inside either panel) is disabled until the currently-selected channel has completed a note detection run, and resets (disabled, unticked) whenever a channel that was being edited resets on a new song. | `#notes-edit.disabled` before/after **Find notes** on whichever channel is selected; load a second zip and it is `disabled` and unticked again. |
| E2 | Ticking it turns on note selection in the zoomed pane; clicking a note outlines it in white. Clicking empty space still seeks, exactly as before edit mode existed. | Tick, click a note block: outline appears. Click empty space: `#t-cur` changes, no outline appears anywhere. |
| E3 | The toolbar is hidden while edit mode is off, and every button but **+ Add note** is disabled until a note is selected. | `.note-toolbar.hidden` toggles with `#notes-edit.checked`; with it ticked and nothing selected, `.note-tbtn:not(.note-tbtn-armed)` (excluding Add) are all `disabled`. |
| E4 | **↑ 8ve** / **↓ 8ve** move the selected note a full octave and recolour it purple (`NOTE_FILL.manual`), without changing `#notes-count-vocals` (or `-bass`). | Select a note, click, compare `midi` before/after via the outline's position; count unchanged. |
| E5 | **♯** / **♭** move the selected note one semitone, same recolouring rule. | As E4, one semitone of vertical movement instead of twelve. |
| E6 | **◀t** / **▶t** move the selected note in time without changing its duration, and recolour it purple (`NOTE_FILL.manual`) — same rule as E4/E5, since a time-adjust is as much a human override as a pitch change. | `end - start` unchanged; both edges shift by the same amount; fill colour changes to purple. |
| E7 | Dragging the BODY of a selected note moves it in time; dragging within ~8px of an EDGE resizes just that edge. Neither ever shrinks a note below a 20ms floor. Either drag recolours the note purple, same as E6. | Drag the middle: both edges move equally. Drag near the left edge: only `start` moves. Drag it past the floor: it stops at 20ms rather than crossing zero. Fill colour changes to purple in every case, including on a previously folded (blue) or doubt (gray) note. |
| E8 | **✕** deletes the selected note, `#notes-count-vocals` (or `-bass`) drops by one, the toolbar disables. | Click it; compare counts; toolbar buttons `disabled` again. |
| E9 | **✂** splits the selected note at the current playhead position, composing a shrink plus a new note — unless the cut is within 5ms of either edge, in which case it only shrinks (no new note). Both the shrunk original and the new tail note end up purple, since a time-adjust now recolours too. | Seek inside a note, click ✂: count +1, two purple notes where one was. Seek within 5ms of an edge, click ✂: count unchanged, the note just moved that edge and is now purple. |
| E10 | A split note can be split again — the tail piece is an ordinary note, not a special case. | Split once, select the new tail note, split it again: count +1 again. |
| E11 | **+ Add note** arms placement (its label and colour change); the next drag in the pane places a new purple note at the dragged span and pitch row, then disarms. Clicking it again without dragging cancels. | Arm, drag: preview follows the pointer, count +1 on release, button reverts. Arm, click without dragging: no note added, button reverts. |
| E12 | The bottom ~16px band is visibly marked at rest (a faint tinted strip with a top border) while edit mode is on, with a caption below the pane naming what it's for — not just discoverable by trial and error. Dragging it selects a time range (a brighter amber highlight, distinct from the resting strip) and enables **Delete range**; clicking it removes every note overlapping that range. | With edit mode on and nothing selected, the strip and caption are visible immediately. Drag the band: a brighter highlight appears, button enables. Click it: count drops by however many notes overlapped, highlight clears back to the resting strip. |
| E13 | The edit list shows one row per action (a split is ONE row, not two), each removable with its own ✕; removing one re-derives without it. | Make three edits including one split: three rows, not four. Remove the split row: both its underlying changes revert together. |
| E26 | Each channel's own edit list (`#notes-edits-vocals` / `#notes-edits-bass`) is a collapsible `<details>`, collapsed by default even with edits present, so a long editing session doesn't keep pushing the zoomed pane down the page. Its summary names the count. Making a new edit or removing one never re-collapses a panel the user opened. When open, the row of controls floats over the page (`position: absolute`) rather than displacing anything below it, and a pointerdown anywhere outside the open `<details>` closes it again — clicking the summary itself, or a row's own ✕/↺ button, does not count as "outside". | Make a vocals edit: `#notes-edits-vocals` becomes visible but `.open` is `false`; summary reads "Edit history (1)". Click the summary to open it, make a second edit: still open, summary now reads "(2)"; the zoomed pane's position on screen hasn't moved. Click anywhere else on the page: `.open` becomes `false` again. Click a row's ✕ instead: the row is removed and the panel stays open. |
| E27 | Each of Start, End, Pitch shows a visible label above it. Selecting a note populates Start (`m:ss.mmm`), End (`m:ss.mmm`) and Pitch's three dropdowns (letter, accidental, octave — e.g. `D`/*(blank)*/`4` for D4) with its current values, and enables everything plus Apply — same as the toolbar buttons (E3). Selecting a different note updates every field/dropdown to the new note's values. Everything stays populated and enabled until the note itself is gone (deleted, or Edit notes toggled off) — clicking empty space seeks the playhead (E2) without deselecting, so nothing blanks either. | Tick Edit notes: a label reads above each of Start/End/Pitch. Select a note: Start/End fill in, Pitch's three dropdowns show its letter/accidental/octave, everything becomes enabled. Click empty space: playhead seeks, everything keeps showing the same values and stays enabled. Select a different note: everything updates to its values. Delete the selected note, or untick Edit notes: everything goes blank/disabled again. |
| E28 | Changing Start and/or End and pressing Enter (in either) or clicking Apply dispatches exactly one `timeAdjust` if the resulting values differ from the note's current ones, and nothing if they don't. Changing any of the three Pitch dropdowns commits immediately — no Enter or Apply needed — dispatching one `pitchNudge` if the resulting note differs from the current pitch, same as the toolbar's ♯/♭ buttons, and nothing if it resolves to the same pitch (e.g. re-picking an equivalent spelling). | Change only Start and press Enter: the edit list gains one `timeAdjust` row. Change Start and End together and click Apply: still exactly one new row, not two. Re-commit without changing anything: no new row. Pick a different Pitch letter: the edit list immediately gains one `pitchNudge` row with no Enter/Apply needed. Pick the current pitch's equivalent spelling (no actual change): no new row appears. |
| E29 | An unparseable value in any field (bad time format, unrecognised note name), or a Start/End pair that would violate the 20ms floor or go negative, reverts that field to the note's current value and dispatches nothing for it — without blocking a valid edit in the other field(s). | Type "bogus" into Pitch, valid values into Start/End, press Enter: Pitch snaps back to its prior value, a `timeAdjust` row still appears. Type a Start past End (crossing the 20ms floor) alongside a valid Pitch change: both time fields snap back and no `timeAdjust` appears, but the pitch edit still lands. |
| E30 | Pressing Escape while any field has focus reverts all three fields to the note's current values without committing anything. | Type a new value into any field, press Escape: the field's value reverts, no new row appears in the edit list. |
| E31 | While a field has focus, no redraw or selection-sync tick overwrites what's being typed — including during playback, when `draw()` runs every animation frame. | Select a note, start typing a new Start value, let the song play for a few seconds without pressing Enter: the field keeps showing exactly what was typed, not the note's live value. |
| E32 | Changing both Start and End together and committing produces exactly one `timeAdjust` edit-list row, not two — mirroring how a two-edge drag is already one edit. | Change both time fields to values different from what's shown, click Apply: exactly one new row appears in the edit list. |
| E33 | Picking a flat accidental resolves to the same pitch as its sharp spelling, including the two letters whose flat crosses an octave boundary: `Cb` is the same pitch as the B *below* it, and `Fb` is the same pitch as E in the same octave. | Select a note, set Pitch's letter to C, octave to some value N, accidental to ♭: the resulting note lands on the same pitch B/(N-1) would. Set letter to F, same octave, accidental to ♭: lands on the same pitch as E in that same octave. |
| E14 | An edit whose target no longer exists shows a warning glyph in the list rather than silently vanishing. | Edit a note, then delete that same note via a different edit: the first edit's row gains the warning glyph. |
| E15 | Cmd/Ctrl+Z undoes the most recent edit, list-order. The same button (↺) does the same thing. | Make two edits, press Cmd/Ctrl+Z once: only the second is undone. |
| E16 | With a note selected, ↑/↓ nudge pitch, Shift+↑/↓ shift octave, Delete/Backspace deletes. ←/→ do NOT nudge a selected note's time — since the ergonomics batch (v1.16.1) they always seek the transport instead (see E20); time is adjusted via the toolbar's ◀t/▶t buttons or by dragging. | Select a note, press ↑: pitch moves. Press →: the transport seeks (proportional to zoom span), the note's `start`/`end` are unchanged either way — selection makes no difference to ←/→. |
| E17 | **Export edits** — one shared button in the zoomed pane, beside the Edit-notes toggle, covering every analysed channel — downloads a single JSON file: `version: 2`, one shared `tempo`/`tempoRange`, and a `stems` object keyed by stem id, each entry holding `interpreter`, `params`, `clip`, `jianpu`, and `edits` (one array per list entry, two elements for a split). **Import edits**, the matching shared button, restores every control and the edit list for each stem the file and the currently loaded song both have, then re-derives each one's note list. See `lib/notes-edits.js` for the format and `docs/superpowers/specs/2026-08-31-note-editing-design.md`/the notes-shared-edit-io work for how it replaced the old per-panel pair. | Detect both channels, make an edit on each, export, reload the same zip, re-run detection, import the file: `#notes-count-vocals`/`#notes-count-bass` and both channels' edit-list rows match. |
| E34 | **Export list** (`#notes-list-export-vocals` / `#notes-list-export-bass`) downloads a Markdown file of that channel's current 簡譜 reading, chunked into fixed-length blocks by note start time — a separate, human-readable export from **Export edits**' JSON round-trip. Disabled **only** while there are zero notes (via `syncJianpuControls()`) — unlike the key selectors, it does NOT need 簡譜 itself to be on: `jianpu.tonic`/`jianpu.mode` always hold a real value, either the auto-detected key (once notes exist) or the C-major default before any override, so there's always a key to export against. The "seconds per line" field (`#notes-list-secs-vocals` / `#notes-list-secs-bass`, default 10) sets block width. The first line is an H2 naming the song, the channel, and the key — see E35 for its exact filename and header text. Each block is an H3, `### MM:SS - MM:SS`, followed by a line of space-separated 簡譜 tokens as its own paragraph — real Markdown headings, not a `==`-style plain-text marker, so a Markdown previewer renders the timestamp and the notes as visibly separate lines instead of merging them into one paragraph. Each token carries its own octave marks (`'` suffix per octave above the reference, `,` prefix per octave below — see N49). A note is bucketed only by its start time, never split across or duplicated between blocks even when its duration crosses a boundary. Within a block, tokens are always printed in start-time order — the export sorts a copy before bucketing (same reason and same pattern as `lib/sonify.js`, see E23), so an `add`ed or split-off note prints at its correct position in the line instead of at the end regardless of how late `applyEdits()` appended it to the note list. | With zero notes, `#notes-list-export-vocals.disabled` (or `-bass`) is `true`. Run **Find notes** without ever ticking 簡譜: it enables as soon as notes exist. Click it: the file downloads using the auto-detected key exactly as if 簡譜 had been ticked, its header line starting `## ` and each block starting `### ` (see E35 for the exact filename and header text). Change "seconds per line" from 10 to 5 and export again: every block is half as wide, and the tokens from an old 10s block split cleanly across the two new 5s blocks with none lost or repeated. Split a note (or otherwise trigger an `add` edit) early in the song, then export list: the added token appears between its chronological neighbours in its block's line, not tacked on at the end. |
| E18 | Loading a new song clears each channel's own edit list independently, exactly as its parameters and 簡譜 key already reset. | Make a vocals edit, load a second zip: `#notes-edits-vocals` is `hidden` again and empty; the same holds for `#notes-edits-bass` if a bass edit was also made. |
| E19 | With two notes overlapping in time, a click resolves to the note whose pitch matches the click's vertical position — not an arbitrary array-order match. Only when two overlapping notes share the exact same pitch too (an exact duplicate) does it fall back to whichever is drawn on top (the later array entry). | Overlap two notes at different pitches (add a note over an existing one, a few semitones away, same time span): click near each one's row and confirm the outline lands on the pitch-matching note, not the other. Add a note directly on top of an existing one at the same pitch and span: click the overlap and confirm the outline lands on the new (topmost) one. |
| E20 | In the zoomed pane, plain scroll seeks the playhead; Shift+scroll zooms. Arrow Left/Right always seek — proportional to the current zoom span (`zoomSeconds × 0.15`); Shift is a fixed 1ms step for placing a cut inside a word — whether or not a note is selected. | Scroll with no modifier: `currentTime()` changes, zoom level doesn't. Shift+scroll: the reverse. At a 40s zoom, press →: seeks ~6s. Narrow the zoom to 2s, press →: seeks ~0.3s. Select a note, press →: it still seeks proportionally, the note's `start`/`end` are unchanged. |
| E21 | Range-select-and-delete works identically in the full-song notes lane as in the zoomed pane: a resting-state strip and caption whenever edit mode is on, a brighter highlight while dragging or committed, and the same **Delete range** button. | Tick Edit notes with the lane visible: strip and caption appear immediately. Drag the lane's bottom band, click Delete range: notes overlapping the range are removed. |
| E22 | Clicking an unselected note seeks the playhead to the exact clicked point, not the note's midpoint. Tapping (no real movement) an already-selected note's body/edge also seeks, dispatching no edit; an actual drag still moves/resizes as before. | Click near one edge of a wide note: `currentTime()` matches the click, not the midpoint. Click the same spot again without dragging: playhead moves again, edit list gains no new row. Drag a real distance: the note moves and a row appears. |
| E23 | An `add`ed or split-off note sounds through the notes lane's reference tone (with the lane unmuted), even though it sits appended at the end of the note list regardless of its own chronological position. | Split a note early in a long song, play from before the cut with the notes lane unmuted: both halves are audible, not just the one that kept its original array position. |
| E24 | The selection outline draws on exactly the selected note — never on a different note that happens to share the same time point at a different pitch. | Select a note, then add a second note spanning the same time range a few semitones away: only the originally selected note keeps the white outline; the new overlapping note has none, even though it shares the same time span. |
| E25 | A toolbar button or keyboard shortcut (octave, semitone, time nudge, delete, split) always acts on the exact note carrying the outline — never a different note that happens to share the outlined note's anchor time. | Select a note, add a second note overlapping it in time at a different pitch, then press a toolbar button (e.g. ↑ 8ve): only the outlined note's pitch/position changes; the overlapping note is untouched. |
| E35 | **Export edits** downloads one shared filename, `<song>-notes-edits.json` (or `song-notes-edits.json` with no mix track loaded) — not per-stem, and there is no top-level `"stem"` field any more; each stem's own data lives at `stems.<id>` instead. **Export list** is unaffected by this change and stays per-channel: filename and header line still name which channel it came from — `<song>-vocals-notes.md` / `<song>-bass-notes.md` — with the stem word always in English (`Vocals`/`Bass`) regardless of UI language, matching the existing English-only major/minor convention. | Export edits with both channels analysed: the filename ends `-notes-edits.json`, and the parsed JSON has `stems.vocals` and `stems.bass` keys with no top-level `stem` field. Export the 簡譜 list from the bass panel: the filename still ends `-bass-notes.md` and its first line reads `## <song> — Bass — 1=<tonic> <major\|minor>` even under the 中文 UI. |
| E36 | A v2 edits file naming a stem the current song doesn't have loaded (e.g. a saved `guitar` entry, before guitar note detection exists) **skips just that stem and warns**, naming it — every stem the file and the song both have still imports normally. An old single-stem v1 file (from before the shared button replaced the per-panel pair) still imports if its `stem` is loaded in this song; if that `stem` isn't loaded at all — including a legacy file with no `stem` field, which the old per-panel button let through unrouted — the import is **rejected outright** with a warning naming the unroutable stem, since a shared button has no per-panel fallback target the way the old buttons did. | Hand-craft a v2 file with `stems.bass` and `stems.guitar` and import it into a song with only vocals/bass loaded: bass imports normally, and a warning names guitar as skipped. Import an old single-stem `<song>-bass-edits.json` from before this change: it applies straight to the bass channel. Edit that same file's `"stem"` to `"guitar"` and import again: nothing changes, and a warning says nothing was imported. |
| E37 | In the zoomed pane, dragging a note's edge (resize) or body (move) snaps to the tempo grid whenever it's on — to the finest enabled resolution (beat, or half/quarter if those toggles are lit). A move snaps its start and carries the same offset into its end, so duration is preserved exactly; a resize snaps only the edge being dragged. With the grid off, dragging is unsnapped exactly as before. | With the tempo grid on at 120 BPM (0.5s/beat) and no ½/¼ toggle, drag a note's body a small amount: `start`/`end` land on multiples of 0.5s, and `end - start` matches the pre-drag duration exactly. Turn the tempo grid off and repeat: the note lands wherever the cursor was released, off-grid. Turn ½ on and drag an edge: it lands on a 0.25s multiple instead. |

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
| G3 | Every asset Vite's build touches is content-hashed, and a fresh `index.html` never references a stale hashed file. | Run `npm run build`, inspect `dist/index.html` — every `<script src>`/`<link href>` points at a `-<hash>.js`/`.css` filename that matches a file actually present in `dist/assets/`. |
| G4 | The page is served over HTTP — GitHub Pages, or `npm run dev` locally. `file://` is no longer supported (dropped in v1.5.0); opening `index.html` from disk is not expected to work. | `separate.js` now loads as a plain `<script type="module">` with no protocol guard. |

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
  through `npm run dev`, which separation already required.
- npm-managed dependencies and a Vite build step; still no UI framework.
- No audio ever leaves the machine, and no filename or song title does either. The one
  outbound beacon is GoatCounter, carrying event names from a fixed set — see the
  Analytics section above. Inbound fetches (ORT from jsDelivr, model from Hugging Face)
  are fine and necessary.
- `ort.env.wasm.numThreads = 1`, so no SharedArrayBuffer, so no COOP/COEP, so GitHub Pages
  can host it at all.
- `rips/` and `stems/` are never committed, published, or copied out of the project.
