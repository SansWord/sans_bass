# Product contract

This document states the durable promises `sans_bass` makes to its users. It describes what
the product is and what must remain true across implementations. It deliberately does not
prescribe test steps, DOM selectors, algorithms, or internal module boundaries.

Executable acceptance and smoke scenarios live in [`behaviour.md`](behaviour.md). Technical
explanations live in the other specialist documents under `docs/`.

## Purpose and boundaries

`sans_bass` is a one-song-at-a-time practice player for listening closely to a recording,
isolating instrumental parts, looping phrases, slowing or speeding playback without changing
pitch, and deriving an editable note reference from vocals or bass.

It is not a DAW, library manager, cloud music service, or authoritative transcription tool.
Detected notes, tempo, key, and chords are assistive estimates that users can inspect and,
where supported, correct.

## Privacy and ownership

- Audio, stems, note data, song titles, and filenames remain on the user's device.
- No user audio or user-derived musical content is uploaded to a server.
- Anonymous analytics may transmit only event names from a fixed product-defined set; event
  names must never contain filenames, titles, or other user content.
- Runtime downloads needed for local processing, such as the separation model and its
  execution libraries, are allowed.
- The application remains deployable as a static site without a backend.

## Loading music

- One control accepts either one whole-song audio file or one ZIP archive of stems.
- A whole-song file loads as one Full mix lane and can be separated locally on a supported
  computer.
- A stems ZIP recognizes the standard vocals, guitar, bass, drums, piano, and other stems,
  orders them consistently, and retains usable unknown lanes rather than silently discarding
  them.
- ZIPs produced by common tools and by the application itself are supported, including
  stored and deflated entries and non-ASCII names.
- Invalid, unsupported, ambiguous, or partially unreadable input produces a visible,
  meaningful explanation. Usable content is retained when recovery is possible.
- Loading another song replaces the current song and resets song-specific playback,
  analysis, and editing state.

## Playback and routing

- All loaded lanes share one audio clock and remain sample-locked.
- Muting changes audible gain without restarting or shifting a lane on the timeline.
- A user can mute individual lanes, solo a lane, play the complete mix, mute all lanes, and
  restore the prior routing state.
- When a Full mix file and separate stems coexist, they are mutually exclusive so the same
  music is never doubled unintentionally.
- Per-lane and master volume controls remain independent of mute state.
- Playback, seeking, routing, and keyboard controls remain usable after changing modes or
  language.

## Transport, loops, and speed

- Playback can start, pause, seek, and reach the end correctly even when drawing is
  throttled.
- A–B points may be set in either order, repeat continuously when valid, and can be cleared.
- Loops and seeks keep stems and generated note tones aligned.
- Playback speed ranges from 10% to 150%, resets for each newly loaded song, and changes
  musical time without changing pitch.
- The current speed is always visible beside time displays. When a reliable tempo exists,
  the displayed effective BPM follows the current speed.
- Returning to 100% uses the native playback path and leaves no stretched-audio residue.

## Local stem separation

- On supported desktop-class devices, a whole-song file can be separated locally into six
  standard stems using the real model in the browser.
- The original Full mix lane is replaced by the six separated lanes after success; playback
  stops and returns to the beginning.
- Progress, cancellation, failure, completion, and save controls always reflect the actual
  state and recover to a usable state after failure or cancellation.
- On handheld devices where separation is unsafe, the product explains the limitation and
  directs the user to load a prepared stems ZIP instead of attempting inference.
- Separated stems can be saved as a ZIP with stable standard filenames and Unicode-safe song
  paths.

## Notes, tempo, and visual reference

- Vocal and bass analysis are independent and begin only when the user requests them.
- Analysis runs off the main UI thread and exposes clear pending, running, success, and
  failure states.
- Each detected-notes lane belongs to its source stem, while one shared overview and zoomed
  pane support detailed inspection.
- Interpretation controls re-derive notes from retained analysis rather than destroying the
  analysis. Loading a new song clears analysis that belonged to the old audio.
- Detected notes remain visually aligned with their source audio and can optionally sound as
  reference tones; reference tones begin muted.
- The UI may fit pitch display to the melody, show whole-phrase interpretation, flag octave
  corrections and doubtful notes, and render scale degrees without changing the underlying
  audio.
- Doubtful pitch claims remain visible as uncertainty but are not presented audibly as
  trusted notes.
- When drums provide reliable evidence, the application exposes an editable tempo grid,
  phase, meter, subdivisions, and an optional analysis range.

## Editing and persistence

- Editing is explicitly enabled and targets one notes channel at a time.
- Users can select, add, delete, split, move, resize, repitch, and snap notes, as well as
  operate on a selected time range.
- Note selection and range selection are mutually exclusive and the UI makes the active
  target clear.
- Edits are reversible, ordered, millisecond-stable, and anchored so re-interpreting notes
  does not silently redirect an edit to an unrelated note.
- Overlapping notes are selected and edited by both time and pitch, with exact duplicates
  resolving to the visibly topmost note.
- Shared edit export/import preserves both supported note channels, interpretation settings,
  tempo state, and human-readable batch labels. Unsupported or absent stems are skipped with
  an explanation rather than corrupting applicable data.

## Human-readable export

- Either analysed notes channel can export a self-contained, readable numbered-notation
  HTML document using the current tempo, meter, key, rhythm, octave, and bar layout.
- Export filenames are channel-specific and timestamped to avoid silent replacement.
- When harmonic stems are available, exports may include a chord estimate above each bar.
  Bass analysis may add inversion/slash notation; lack of bass analysis must not suppress
  otherwise available chord estimates.
- With no harmonic stem, no chord row is invented.
- Musical estimates remain explicitly assistive rather than guaranteed ground truth.

## Language and resilience

- The interface supports Traditional Chinese and English, including content already visible
  when the language changes.
- A stored explicit language choice takes precedence over system detection; failure to read
  or write storage must not prevent the application from starting.
- Stable data identifiers, filenames, stem IDs, and musical note names do not change with UI
  language.
- Hidden controls are actually invisible, error messages remain visible, and a missing
  optional element or analytics service must not disable unrelated controls.
- Unexpected application errors produce a visible recovery instruction rather than leaving
  a page that appears functional but is inert.

## Release integrity

- A deployed page identifies the exact source commit that produced it.
- Production assets, Workers, and AudioWorklet modules resolve from the deployed static
  build without stale cross-version references.
- The routine automated suite remains offline and deterministic; expensive real-model and
  subjective listening checks belong to an explicit release smoke procedure.
