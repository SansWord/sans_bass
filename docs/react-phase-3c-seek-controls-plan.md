# React migration Phase 3c — seek controls plan

Status: implemented locally; deployment acceptance pending. Planned from
`9292f0f9688d7763e5fe9e49fced78b23ac5bd2b` on 2026-09-06.
Previous accepted rollback anchor: Phase 3b at
`99ac653ec20de0d54035c0c89cb5dfb7ab40a77d`.
Implementation source: `4a3c9d278cf8788a5571125620fdba6485105aea`.

## Bounded outcome

Give React sole DOM and interaction ownership of the primary full-song seek/progress canvas
and its visible and accessible current-time presentation. Add that region to the existing
`PlayerShell` root through explicit canvas and time portal hosts. Pointer and keyboard seeks continue through
`playerApplication.commands.seek()`; React renders the authoritative transport projection,
while `app.js` retains the audio clock, seek/loop/rate algorithms, analytics, and imperative
waveform painting.

Do not migrate master volume, A/B controls, mode/routing, lane/overview/zoom controls or
canvases, separation, detection, notes, Workers, AudioWorklets, or DSP. This is a bounded
Phase 3 increment, not completion of Phase 3.

## Current-source ownership audit

| Region / behavior | Owner at plan source | Transfer or retention in Phase 3c |
|---|---|---|
| Primary progress DOM | `index.html` authors `#main-wave`; `app.js` captures it at module initialization, installs pointer listeners in `buildUI()`, and paints waveform/progress/loop markers. | React authors one semantic, focusable `#main-wave` canvas and its pointer listeners. `app.js` remains the explicit imperative painter through a lifecycle-safe application attachment; it owns canvas pixels/intrinsic dimensions but not accessibility attributes, listeners, or children. |
| Primary current-time presentation | `index.html` authors `#t-cur`, `#t-dur`, `#t-speed`, and `#t-bpm`; `app.js:buildUI()` and every `draw()` write their text/visibility directly. | React authors and renders all four from the authoritative transport clock projection, including rate-aware BPM. Remove every legacy DOM write. Add bilingual seek labeling and current/total accessible value text without an announcing live region. |
| Primary pointer seeking | `app.js:attachSeek()` installs pointerdown/move/up/cancel listeners on `#main-wave`. Pointerdown and pointerup use the facade seek command; pointermove previews the clamped offset without another analytics event or audio-graph rebuild. | React owns the same pointer sequence. Add the smallest preview command needed to preserve drag behavior; the final seek and analytics remain in `app.js`. Other lane, overview, tempo-range, note-range, and zoom pointer listeners retain the existing imperative owner. |
| Keyboard seeking and focus exclusions | One document `keydown` listener in `app.js` owns transport arrows together with loop, routing, speed, and editor shortcuts. It ignores focused inputs/selects/textareas (except Space) and buttons. | Retain this shared keyboard owner. The React seek canvas supplies slider semantics and focusability; focused arrows reach the existing one document owner once. Existing field/button exclusions remain unchanged, so there is no competing React key listener. |
| Transport clock and publications | `app.js:currentTime()` derives position from the 44.1 kHz AudioContext, playback rate, and native loop bounds. The main application snapshot publishes only on state changes; `draw()` directly writes the per-frame time DOM. | Keep `currentTime()` authoritative. Add a narrow transport-frame subscription to `playerApplication`, published by the existing draw path and consumed only by the seek/time component, so the whole shell does not rerender each animation frame and no second mutable clock exists. |
| Audio, loops, rate, analytics, waveform data | `app.js` owns scheduling, current position, source/worklet rebuilds, loop clamping, `seek` analytics, mix peaks, cached canvas layers, and painting. | Retain exactly. Canvas attachment/remount only reconnects and repaints the view; it never seeks, starts/stops audio, bumps analytics, or changes song state. |
| Adjacent UI | React owns loading, play/pause, and speed; legacy code owns volume, A/B UI, mode/routing, lanes, overview/zoom, separation, and notes. | Retain all existing owners. The master title also remains legacy-owned in this slice. |

## Legacy retirement and remaining adapters

Replace the parser-authored primary canvas/time block with explicit portal hosts. Remove the
primary `attachSeek()` call and all `#t-cur`/`#t-dur`/`#t-speed`/`#t-bpm` captures and writes.
Keep `attachSeek()` and its shared `scrubbing` state because lane, overview, tempo-range, and
note-range canvases still consume them; keep the document keyboard listener because it owns
every unmigrated shortcut group.

The application facade gains only two narrow capabilities: a deduplicated transport-frame
projection/subscription and an explicit primary-canvas renderer attachment whose cleanup is
independent of application lifetime. `components/PlayerShell.jsx` is the renderer attachment's
only production consumer. `window.sansBass.playerShell` remains the named browser-harness
remount adapter, and `sansbass:transport` remains the exact-clock adapter for the two notes
sonifiers.

## Failing-first and implementation increments

1. Add production-entry Chromium assertions for React-authored seek/time uniqueness,
   bilingual semantics/current-time copy, click and focused keyboard seeking at bounds,
   paused and playing seeks, rate-aware clock/BPM display, loop clamping, existing focused
   control exclusions, locale publication, shell remount, song replacement/stale completion,
   and one seek listener/analytics sequence after repeated remounts. Run them against the
   legacy owner and retain the expected failures.
2. Add the focused transport-frame subscription and primary-canvas renderer lifecycle to the
   existing player application facade. Keep its projections immutable and stable between
   changed publications; mounting or unmounting the UI must not dispose the owner.
3. Add the seek/time portal to `PlayerShell`, with one React-authored canvas, pointer gesture
   state local to the component, translated slider semantics, and the established visible
   time/rate/BPM formatting. Repaint the attached canvas from the current song without a seek
   or analytics event.
4. Remove the parser-authored controls and matching legacy captures, pointer listeners,
   scrubbing writes, and time-label writes only after the React path is green. Leave every
   other `attachSeek()` consumer and canvas writer intact.
5. Run the focused Chromium file, full automated suite, production build, diff check, and
   exact-source local root/nested smoke with documented generated WAV/ZIP fixtures. Record
   emitted JavaScript change against accepted Phase 3b.

## Verification boundary and explicit omissions

Exercise affected TRN-001, LOOP-001, SPD-001, LANG-001, BOOT-001, LOAD-001, and
ANALYTICS-001 outcomes. Automated generated fixtures cover click/drag and keyboard seeks at
both bounds while paused/playing, rate-scaled clock movement, loop clamping and laps,
focused-control exclusions, bilingual semantics, remount preservation, replacement/stale
completion, uniqueness, and analytics/listener deduplication. Retain malformed/rejected input,
storage/locale, fake-Worker stale-result, and unchanged loading-control coverage in the same
production-entry suite.

Because this moves a structural and trusted transport surface, verify the PR preview at its
exact displayed synthetic merge SHA before assertions: root and nested demo/player routes,
saved locale, generated synthetic load, `examples/nov_you.zip` real-song load, genuine-keyboard
play and seek, focused controls, loop interaction, remount/state preservation, unchanged
loading controls, one React seek owner/control, and a clean first-party console. After squash
merge, wait for the exact merged SHA and repeat the required production acceptance boundary.

Report synthetic, malformed-input, locale/storage, handheld, Worker, visual, auditory, and
real-song evidence separately. The generated WAV/ZIP matrix is automated evidence;
`examples/nov_you.zip` is only real-song deployment smoke. Physical handheld, uncached
separation/model download, exhaustive visual comparison, background transport, and subjective
pitch/loop-seam/note-tone listening remain explicit omissions unless actually performed.
