# Playback speed control — design

**Status:** approved, not yet implemented.

## Goal

Let a user slow down or speed up playback (50%–150%) while practising, with pitch held
constant — a slowed-down bass line should sound in the same key, just slower, the way
Amazing Slow Downer / Transcribe! behave, not the way a turntable or tape does.

## Why this is architectural, not bounded

The obvious first idea — set each stem's native `BufferSource.playbackRate` — is a one-line
change, but native `playbackRate` also shifts pitch, which the user explicitly does not want.
Pitch-preserving time-stretch has no native Web Audio primitive, so this requires a real DSP
pipeline sitting inside the existing multitrack sync model — a new signal-processing
subsystem, not a UI control wired to an existing knob.

## Constraint change

The project's CLAUDE.md previously stated "no dependencies." The user has explicitly relaxed
this for this feature: a JS dependency is acceptable as long as the site still deploys as a
static site with no build step (loaded as a vendored/static file or CDN script, the same
pattern `separate.js` already uses for the ONNX runtime — no npm, no bundler). All other hard
constraints (no audio egress, no SharedArrayBuffer/COOP/COEP, GitHub Pages hosting) still
apply and shaped the design below.

## Architecture

Two playback paths, selected by whether the active rate is exactly 100%:

- **Rate = 100% (default; always the state on load, since speed does not persist):** the
  existing code path, completely unchanged. `play()` builds native `BufferSource`s exactly as
  it does today. Zero regression risk to existing playback.
- **Rate ≠ 100%:** each stem's `BufferSource` is replaced by a **stretch node** — a custom
  `AudioWorkletNode` wrapping a vendored, pure-JS pitch-preserving time-stretch DSP core
  (SoundTouchJS's `SoundTouch`/`SimpleFilter` classes, MIT licensed — vendored as static
  files under `lib/vendor/`, not installed via a package manager). The stretch node connects
  straight into the existing per-track `GainNode`, so solo/mute/volume routing is completely
  untouched.

Crossing the 100% ↔ non-100% boundary rebuilds the audio graph, reusing the existing
`stop(true)` → `play()` pattern already used by `refreshLoop()` and `seek()` for other
structural changes. Changing the rate *while already* in the stretched path does **not**
rebuild the graph — it's a live `postMessage` to each running worklet node, so dragging the
speed slider around while time-stretched playback is running has no audible restart.

### Why per-stem nodes stay sample-locked

Today's six `BufferSource`s stay sample-locked because they're started from one
`AudioContext` clock (`t0`, `LOOKAHEAD`). The same guarantee extends to stretch nodes: every
node in a given `AudioContext` — regardless of type — is processed by the browser's audio
thread in the same 128-sample render quantum, synchronously, once per quantum, for the whole
graph. That per-quantum lockstep is what actually keeps six independent nodes in sync; it
does not depend on the node type being `BufferSourceNode` specifically. Six independent
stretch nodes, each fed the same rate, stay locked to each other the same way six
`BufferSource`s do today.

## Components

- `lib/vendor/soundtouch-core.js` — vendored DSP classes only (`SoundTouch`, `SimpleFilter`,
  and their supporting buffer classes) from the SoundTouchJS project
  (github.com/cutterbl/SoundTouchJS, MIT). No ScriptProcessorNode wrapper from the library is
  used; only the pure algorithm. Vendor the file with its MIT license notice kept intact at
  the top, and add a `lib/vendor/LICENSE-soundtouchjs` file recording the license and source
  URL, matching how a vendored third-party file should be attributed.
- `lib/stretch-processor.js` — an ES module registering a custom `AudioWorkletProcessor`
  (`registerProcessor('stretch-processor', ...)`) that imports the vendored DSP core. Loaded
  once via `audioContext.audioWorklet.addModule(...)` inside `ensureAudio()`, before any
  stretch node is created.
- A thin per-stem wrapper (new module or a section of `app.js`) creating one
  `AudioWorkletNode` per stem when entering the stretched path, and messaging it for:
  - **load**: a *copy* of the stem's decoded channel data (`Float32Array` per channel),
    posted once when the node is created.
  - **start(offsetSample, loopAiSample, loopBSample, rate)**: begin producing stretched
    output from a given sample position, honoring loop bounds (see below).
  - **setRate(rate)**: live rate change, no restart.

## Data flow

- **Position tracking.** `currentTime()` scales elapsed wall-clock time by the active rate:
  `offset + elapsed * rate` (and the existing loop-wrap formula gets the same `elapsed * rate`
  substitution). At rate = 1 this is the identity, so the formula applies unconditionally —
  no branching needed in `currentTime()` itself.
- **Seeking and A–B loop changes** always tear down and recreate the active node(s) at the new
  position — the same rebuild-on-structural-change pattern `seek()` and `refreshLoop()` already
  use today, just extended to cover stretch nodes as well as native sources.
- **Live rate changes** (dragging the slider, or `[`/`]`) while already in the stretched path:
  rebase bookkeeping (`offset = currentTime()` under the old rate, `startedAt = audio.currentTime`,
  then update `rate`) and `postMessage` the new rate to each running node — no node
  teardown/recreate, no audible restart. Crossing the 100% boundary in either direction still
  goes through the full rebuild path described above.
- **Loop wrap inside the worklet.** The worklet feeds its DSP pipeline from its own copy of
  the stem's channel data; when the *input* read cursor reaches the loop-B sample index, it
  wraps back to loop-A, mirroring native `loopStart`/`loopEnd` but implemented on the input
  side of the stretch pipeline (see Known limitations).
- **Sonify sync.** `sansbass:transport`'s broadcast payload gains a `rate` field. `sonify.js`'s
  note-scheduling formula (currently `when + note.start - offset`) becomes
  `when + (note.start - offset) / rate`, so reference tones stay locked to the (possibly
  slowed or sped-up) stems.

## UI

- A new `.ctl`-styled control in the existing `.controls` bar, next to Volume: a slider,
  range 50–150, step 5, with a live "N%" readout. Always starts at 100% on load — no
  persistence across sessions or songs, per explicit decision.
- Keyboard shortcuts, matching the project's existing single-key style (`a`/`b`/`c` for
  loop): `[` and `]` nudge the rate ±5% (clamped to 50–150), `\` resets to 100%. Added to the
  existing `.hint-keys` text and to both locales in `lib/i18n.js`.

## Known limitation — accepted, not fixed by this design

Native looping is unprocessed PCM, so it is glitch-free. A time-stretched A–B loop can have a
faint discontinuity right at the seam, because the phase-vocoder pipeline's internal
overlap-add state has no way to know the input just jumped backward to loop-A. This is
inherent to realtime time-stretching across an arbitrary loop point in general (not specific
to this implementation) and is out of scope to eliminate here. It only affects non-100%
playback; native 100% looping is unaffected and stays exactly as glitch-free as it is today.

## Memory cost — accepted, not avoidable given other constraints

Entering the stretched path requires a *copy* of each stem's decoded channel data inside the
worklet's own scope — an `AudioWorkletProcessor` cannot read the main thread's `AudioBuffer`
object directly, and zero-copy sharing via `SharedArrayBuffer` is unavailable (it requires
COOP/COEP headers, which GitHub Pages cannot set — the same constraint that already forces
`ort.env.wasm.numThreads = 1` for the separation feature). This roughly doubles per-stem
memory while any non-100% rate is active. Those copies are dropped when the rate returns to
100%, releasing the extra memory.

## Non-goals

- No persistence of the chosen speed across songs or sessions (explicit decision).
- No attempt to remove the loop-seam artifact described above.
- No change to the in-browser separation pipeline, note detection, or tempo-grid work — this
  feature only touches transport/playback and the sonify scheduling formula it depends on.

## Documentation

Two user-facing docs need updates in the same commit as the feature, per this project's
conventions:

- **`README.md`**, `### Controls` table (around line 300–314): add a row for the speed
  slider (e.g. `Change playback speed | Drag the speed slider, or **[** / **]** / **\\**`),
  matching the existing row style. Given the loop-seam caveat above, also add a short note
  near `### A–B repeat` (or as a new subsection after it) explaining that pitch stays fixed at
  any speed, but a time-stretched loop can have a faint seam at the wrap point — the same
  kind of "how it actually behaves, not just how to use it" detail that section already
  gives for looping.
- **`docs/behaviour.md`**: a new entry describing the observable behavior (rate control
  present; changing it produces audibly pitch-preserved faster/slower playback; resets to
  100% on load; keyboard shortcuts `[`/`]`/`\`) and how to observe each one, matching that
  doc's existing format.

## Testing

- Unit-testable pieces (`tests/test.html`): the `currentTime()` rate-scaling formula, the
  sonify note-scheduling formula, and rate clamping/step logic for the slider and keyboard
  nudges — these are pure functions and should be tested the way the rest of the transport
  math already is.
- `docs/behaviour.md` needs a new entry describing the observable behavior (rate control
  present, changes audible pitch-preserved speed, resets on load, keyboard shortcuts) and how
  to observe it, per this project's convention that behaviour changes update that doc in the
  same commit.
- One consolidated manual/browser verification pass at the end of the implementation plan
  (per this user's standing preference — TDD/unit tests per task, one real-environment pass
  at the end): load a song, slow down and speed up during playback, verify pitch sounds
  unchanged, verify A–B loop and seek still work at non-100% rates, verify sonify reference
  tones (if applicable) stay in sync, verify keyboard shortcuts, verify returning to 100%
  falls back to native playback with no artifacts.
