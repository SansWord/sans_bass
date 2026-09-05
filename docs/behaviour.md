# Executable behaviour scenarios

This is the browser-harness smoke and acceptance reference for `sans_bass`. Durable user
promises live in [`product-contract.md`](product-contract.md); the permanent mapping from
the former 255-row matrix to these scenarios and automated tests lives in
[`test-coverage.md`](test-coverage.md).

Run deterministic regression coverage with `npm test`. Run these scenarios against
`npm run dev` when changing observable player behavior. A real-song run alone is not the
full matrix: synthetic, malformed-input, worker, handheld, visual, auditory, and deployment
boundaries are called out separately below.

## Harness

Generate fixtures in memory with the production encoders:

```js
const { stemsZip } = await import('/tests/helpers/audio-fixtures.js');

async function loadStemsZip(stems, options = {}) {
  const blob = await stemsZip(stems, options);
  const file = new File([blob], options.filename || 'synthetic.zip',
    { type: 'application/zip' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = document.getElementById('file-input');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
```

Useful options include `layout: 'flat'`, `folder`, `order`, `mix`, `unknown`,
`sidecars`, and `invalidAudio`. A source can be a frequency, a `Float32Array`,
`{ kind: 'click', bpm, phase }`, or `{ kind: 'silence' }`.

For protocol tests, replace `window.Worker` before clicking the lazy separation control and
post deterministic `result`, `error`, or progress messages. Never download the separator
model for routine tests. Observe gain with `AudioParam.prototype.setTargetAtTime`, source
lifecycle with `AudioBufferSourceNode.prototype.start/stop`, and visibility with computed
style rather than the `hidden` property alone.

Harness gotchas:

- Use a trusted key press to unlock playback; a synthetic click may leave AudioContext suspended.
- Sample audio/clock behavior across loop laps; a badge or parameter is not proof of playback.
- Background automation throttles rAF and intervals. rAF is drawing evidence, not transport evidence.
- Keep drag events cancelable and check `defaultPrevented`; that prevents browser navigation.
- Compare canvas node identity across language changes, not only canvas count.
- A fake Worker proves UI protocol handling, never the real deployed Worker or model.

## Scenario matrix

| ID | Fixture / precondition | Action | Observable result | Automated coverage | Live coverage |
|---|---|---|---|---|---|
| LOAD-001 | Generate flat and folder ZIPs covering six standard stems, unknown names, explicit mix, Finder sidecars, stored/deflated entries, one invalid audio entry, and malformed ZIP mutations. Also prepare one whole-song WAV. | Feed each fixture through the single file input, repeat one selection, and repeat through cancelable drag/drop; try a folder, multiple loose files, and unsupported input. | Titles, order, lane retention, mix identity, recovery messages, overlay behavior, repeat selection, and the exact two accepted input shapes match the product contract. AudioContext is 44100 Hz and partial decode failure retains usable lanes. | `tests/audio-fixtures.test.js`, `tests/unzip.test.js`, `tests/stems.test.js`, `tests/player.test.js` | Local Chromium for codec-specific decode messages. |
| MIX-001 | Load ordinary stems, then a ZIP containing Full mix plus stems. Instrument gain ramps. | Toggle lane names and waveforms, keys 1–6/0, the mode menu, volume sliders, mute-all/unmute-all, and restore in partial/all-off/fresh-load states. | Only intended lanes change; classes and gains agree; mix and stems never double; snapshots restore exactly; labels/mode stay truthful; keyboard focus returns after menu selection. | `tests/routing-state.test.js`, `tests/player.test.js` | Visual hit-target/handheld affordance check. |
| TRN-001 | Load unequal-duration synthetic stems and instrument source scheduling. | Play, pause, seek by waveform and keyboard while running/stopped, then let the longest source end. | Every source shares one start time, mute never restarts it, seeks preserve running/stopped state, time labels update, and end-of-song comes from the audio graph. | `tests/transport-math.test.js`, `tests/player.test.js` | Trusted-gesture unlock and background-tab end behavior. |
| LOOP-001 | Load unequal-duration stems plus controlled notes crossing A and B. | Set A/B in both orders, attempt a sub-100ms loop, seek into notes, run several laps, clear, and load another song. | Bounds normalize, invalid second points clear with an error, short stems do not wrap early, badge visibility is computed correctly, tones resume without re-attack and cut at B, and song load clears the loop. | `tests/loop-state.test.js`, `tests/sonify.test.js` | Background looping and subjective native seam quality. |
| SPD-001 | Load a sustained tone and notes reference at 100%. | Exercise slider and coarse/fine keys across 10–150%, cross 100%, seek/loop off-speed, reset, and load another song. | Bounds and steps hold; only native↔stretched crossings rebuild; 100% is native; new songs reset; time/BPM tags follow speed; stems and tones remain aligned. | `tests/transport-math.test.js`, `tests/soundtouch.test.js`, `tests/sonify.test.js` | Subjective pitch preservation and stretched-loop seam. |
| SEP-001 | Use a whole-song WAV with a deterministic fake Worker for protocol cases; separately use a supported desktop with a cached model. | Exercise start, progress/backend, cancel, worker death, error, success, second-song reset, and save; emulate handheld capabilities. | Controls, progress, messages, six-lane replacement, stop/reset, save availability, failure recovery, and handheld explanation match actual state. No local-model picker exists. | `tests/separation-state.test.js`, `tests/player.test.js` | Real deployed Worker, cached model, optional deliberate uncached download, and physical handheld. |
| NOTE-001 | Generate vocals-only, bass-only, both, neither, and drums-assisted fixtures; include bars with agreeing halves, a real mid-bar change, one weak half, and two weak halves; use a deterministic notes Worker except for the real-Worker smoke. | Start detection, finish channels in both orders, vary interpretation/folding/display controls, mute/show lanes, choose a capo fret, edit a zoomed chord (including a near-confidence candidate), and load another song. | Panels appear only after their channel completes; pending/running labels name exact channels and chord work remains visibly busy until complete; chord analysis waits for every running note channel so it uses vocal key and bass inversions in one complete pass; analysis is user-triggered and independent; interpretation reuses frames; ribbons/overview/zoom remain aligned; agreeing strong halves collapse to one full-bar chord, a strong full bar carries one strong half across a weak partner, distinct strong halves and inversion changes remain separate, fully weak bars stay blank, capo transposes play shapes and play key without changing concert pitch, ambiguous labels use a distinct color, and edits remain visible/exportable; doubtful notes stay silent. | `tests/detection-state.test.js`, `tests/notes.test.js`, `tests/pitch.test.js`, `tests/ribbon.test.js`, `tests/sonify.test.js`, `tests/chords.test.js` | Musical accuracy and final visual readability. |
| TEMPO-001 | Load drums click tracks with known BPM/phase plus vocals/bass, including an excluded intro. | Detect, override/halve/double/nudge meter, enable subdivisions, choose/clear a range, re-detect, export/import, and load another song. | Controls gate on drums evidence; shared grids align across canvases; range and manual state behave predictably; resets and exported state are exact. | `tests/tempo.test.js`, `tests/ribbon.test.js`, `tests/notes-edits.test.js` | Auditory/metronome judgment for ambiguous real music. |
| EDIT-001 | Supply controlled notes with overlapping time/pitch and exact duplicates, plus an active tempo grid and corrected chords. | Select/click/drag/resize/add/delete/split/repitch/nudge/snap notes; select ranges on lane/overview/zoom; edit chords; use Whole song, keyboard commands, batches, undo, and import/export. | Note and range targets are mutually exclusive; hit selection respects pitch/topmost order; clicks seek while drags edit; commands act on the outline; batches undo once in reverse order; note fields, chord corrections, and persistence round-trip. | `tests/editor-state.test.js`, `tests/notes-edits.test.js`, `tests/pitch.test.js`, `tests/ribbon.test.js`, `tests/time.test.js` | Final canvas interaction/colour judgment. |
| EXPORT-001 | Analyse either channel with tempo/key/meter and optional harmonic/bass evidence; use a Unicode song title. | Export notation twice with a nonzero capo, change the exported selector to 0, 11, and back; include accompaniment-only bars and an outro beyond the melodic stem. Save stems, including an injected save failure. | HTML starts at the export-time capo; changing it updates play key and chord shapes/slash bass without changing concert key or notes. Chords appear in bars without notes through the accompaniment outro. HTML is self-contained, chronological, bar-wrapped, rhythm/octave/tie/chord marked, channel titled, and timestamped; ZIP paths are stable Unicode; encoding yields between stems and controls recover after failure. | `tests/jianpu-html.test.js`, `tests/jianpu.test.js`, `tests/chords.test.js`, `tests/zip.test.js` | One browser download smoke and human glyph readability. |
| LANG-001 | Start clean, then with stored and blocked storage; load a song and establish routing, loop, status, separation, notes, and tempo UI. | Switch English/Traditional Chinese during playback. | Stored choice wins; first visit is not persisted; blocked storage cannot stop boot; all visible copy rerenders while stable IDs, routing, transport, canvases, and audio remain unchanged. | `tests/i18n.test.js`, `tests/player.test.js` | Audibly confirm no gap during a trusted playback run. |
| BOOT-001 | Use the production entry, then a test copy missing an optional element; inject an uncaught error and inspect a production build. | Boot, interact after the missing element, throw, build, and verify all referenced assets plus displayed SHA. | Unrelated controls survive missing optional DOM/storage/analytics; hidden controls are computed invisible; crashes show force-reload guidance; built assets are hashed and present; SHA identifies the intended build. | `tests/player.test.js`, `tests/i18n.test.js` | Local build-preview and deployed no-store SHA/asset smoke. |
| ANALYTICS-001 | Attach a recording sink before interactions and use a distinctive filename. | Load, play twice, seek/toggle repeatedly, switch language, run fake separation, and emulate handheld refresh polling. | Fixed event names contain no user content; play and handheld-blocked emit once; counters use power-of-two buckets; queued events preserve order; missing/throwing analytics never affects the player; localhost sends nothing externally. | `tests/analytics.test.js`, `tests/player.test.js` | Deployed event-console sanity check without user content. |

## Production deployment smoke

### Demo listing smoke

Both pages share the brand/player link, demo link, GitHub link, language controls,
and header styling. The active page is marked with `aria-current="page"`. Only the
player header contains the Load control. Switching language must preserve that file
input and loaded player state; header navigation stays within the current deployed base.

Run `npm run build` and serve `dist/`. Follow the player header's Demos / 匯出簡譜範例 link
in both languages. On `/demos/`, check the build SHA, then follow
the sample notation link, and exercise its capo selector. Repeat with `dist/` mounted
under a nested PR-like path: the demo and player-back links must stay under that path.
Add a temporary HTML file (including spaces/Unicode in its filename), rebuild, and
confirm it appears and opens. Remove it and rebuild: it must disappear from both the
list and `dist/demos/`. Non-HTML files must not appear in the list.
Switch the list between English and Traditional Chinese; verify the heading, description,
count, back link, empty state, tab title, and pressed language button. Reload and navigate
between player and list: the explicit language choice must persist. With storage blocked,
both languages must still work. Check both pages at desktop and narrow mobile widths for
horizontal overflow.

### Player smoke

Use a fresh/no-store fetch and record the tested URL, browser, device, and displayed SHA.

1. Confirm every hashed script/style/Worker/AudioWorklet reference loads from the deployed base path.
2. Load `examples/nov_you.zip` through the one file input; verify real-song lanes, playback,
   routing, notes Worker, notation export, and expected musical regression observations.
3. Generate a short WAV and run one cached-model separation; confirm backend, progress, six
   lanes, playback reset, and save. Download the model only when that expensive uncached
   boundary is explicitly requested.
4. Compare the displayed build SHA with the intended commit.

## Manual, physical, visual, and auditory release checks

Record these as manual evidence only when actually performed:

- trusted AudioContext unlock and background-tab end/loop behavior;
- physical handheld separation gating and memory safety;
- subjective pitch preservation, native/stretched loop seam, and note-tone alignment;
- real-song note/chord/tempo musical accuracy;
- final lane affordance, canvas colors, notation glyphs, and responsive layout.

Do not report these as automated passes. The historical per-row wording and old IDs remain
permanently available in `docs/test-coverage.md` and version history.
