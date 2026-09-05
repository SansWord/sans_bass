# Testing strategy

Read this before adding or moving tests. It defines which layer owns each kind of evidence
so routine development stays fast and deterministic without weakening browser, deployment,
or listening coverage.

The durable product promises are in [`product-contract.md`](product-contract.md). Executable
smoke and acceptance scenarios are in [`behaviour.md`](behaviour.md). The automated suite
does not replace those documents: it supplies repeatable evidence for as many of their
assertions as possible.

## The layers

### 1. Node Vitest — pure logic by default

Use the Node project when the subject can be expressed as values in and values out without a
DOM, browser layout, Web Audio object, Worker, network request, or real file picker.

This is the preferred layer because it is the fastest and least flaky. Appropriate subjects
include:

- DSP and musical transforms;
- ZIP/WAV bytes and serialization;
- stem classification and ordering;
- transport, loop, routing, and editor state transitions;
- formatting and generated HTML strings;
- import/export payload planning;
- time rounding, geometry math, and canvas-independent drawing plans.

Place these tests in `tests/<module>.test.js`, export the smallest production function needed,
and register the file in `NODE_TESTS` in `vitest.config.js`.

Do not choose a browser merely because the function is eventually called by the UI. If the
contract is deterministic state or data, isolate it and test it here. Do not expose a
`window.SansX` bridge for tests; use ESM exports.

### 2. jsdom Vitest — DOM semantics without a browser

Use the jsdom project when importing or exercising the subject genuinely requires
`document`, events, or `localStorage`, but does not depend on layout, computed rendering,
canvas pixels, Web Audio, a real Worker, trusted input, or browser scheduling.

Appropriate subjects include:

- applying translations to markup;
- safe handling of unavailable storage;
- analytics queue/event wiring;
- status and attribute updates whose result is ordinary DOM state.

Register these tests in `JSDOM_TESTS` in `vitest.config.js`.

jsdom is not evidence for dimensions, CSS visibility, canvas rendering, audio, file chooser
behavior, or background throttling. If an assertion uses `getBoundingClientRect()`,
`getComputedStyle()`, pixel sampling, `AudioContext`, or Worker semantics, use Chromium.

### 3. Headless-Chromium Vitest — browser integration

Use the browser project for behavior that needs a real browser engine but does not require a
specific deployed origin, human hearing, or physical device.

Appropriate subjects include:

- real `AudioContext`/`OfflineAudioContext` behavior;
- real module Worker loading and message boundaries;
- computed styles and responsive layout;
- canvas drawing and pixel sampling;
- keyboard, pointer, drag/drop, focus, and file-input event wiring;
- player-level integration through the actual entry page;
- instrumentation of GainNode ramps and BufferSource start/stop calls;
- fake-Worker success/cancel/error UI flows when the UI protocol—not the model—is under test;
- generated downloads and their contents.

Register these tests in `BROWSER_TESTS` in `vitest.config.js`. Prefer generated in-memory
fixtures from `tests/helpers/` and production encoders over committed binary files.

Headless Chromium may fake an expensive Worker only when the test names the boundary it is
checking. Keep at least one separate smoke test for the real Worker module. Never claim a
fake-Worker result proves the real model or deployed module loads.

### 4. Local integration smoke — built application

Use `npm run build` plus a local HTTP preview when the question is whether Vite assembled the
application correctly. This layer owns checks such as:

- generated entry pages reference existing hashed assets;
- Worker and AudioWorklet URLs survive bundling;
- the built application starts without console errors;
- a short representative workflow works against the built output.

This layer is useful before a PR but cannot prove GitHub Pages is serving the intended build.

### 5. Deployed verification — real delivery boundaries

Use a live browser against the deployed URL, with depth selected from the changed boundary:

- **PR preview, every PR:** verify the expected SHA, page boot, and the affected behavior on
  the real Pages origin. Exercise Worker, AudioWorklet, cache, cross-origin, or nested-base
  behavior when the change can affect it.
- **Production canary, every merge:** verify `deploy-main.yml` concluded successfully, the
  root page shows the merged SHA, the page boots without asset or console errors, and one
  affected route or control works when relevant.
- **Full deployed smoke:** repeat the detailed player/demo workflow on both preview and root
  for deployment workflow, Vite/base-path, entry-page, Worker/AudioWorklet, cache, or static
  asset changes, and for explicit release acceptance.

A cached real-model run belongs to separation changes and release acceptance. An uncached
model download is explicitly requested because it is large and depends on external services.
Use `examples/nov_you.zip` for musical/audio/notes/export regression or a release, rather than
as a routine fixture for unrelated UI or documentation changes.

Collect the smallest evidence that proves the selected boundary: focused DOM assertions,
network/console error counts, the URL, and the displayed SHA. Full accessibility snapshots and
screenshots are useful for structural or visual review; avoid collecting them for a delivery
canary. Deployed evidence is separate from the offline `npm test` gate.

### 6. Manual, physical, and auditory acceptance

Keep a manual check only when automation would test a proxy rather than the actual promise:

- subjective pitch preservation or loop-seam quality;
- musical accuracy against a human reference;
- real handheld memory/platform behavior;
- trusted user-gesture or background-tab behavior that cannot be represented faithfully by
  the automated browser project;
- final visual judgment where pixel assertions would be brittle and incomplete.

Record the device/browser/build and what was actually heard or seen. Do not mark a manual row
passed because its underlying pure function has a unit test.

## Placement decision tree

For every new behavior, choose the lowest layer that can directly prove the contract:

1. Can it be expressed as deterministic input/output or a state transition? Use Node.
2. Does it require DOM/storage but not rendering or browser-only APIs? Use jsdom.
3. Does it require layout, canvas, Web Audio, Worker, file, keyboard, pointer, or integrated
   page wiring? Use headless Chromium.
4. Does it specifically concern Vite's built paths? Add a local build/preview smoke check.
5. Does it specifically concern GitHub Pages, the real model, caching, or deployed module
   loading? Add the affected preview check and decide whether the full two-origin smoke is
   required. Every merge still gets the compact production canary.
6. Is the promise irreducibly auditory, physical-device-specific, or subjective? Keep a
   manual acceptance case.

If two layers are needed, divide responsibility explicitly. Example: a Node test proves loop
point normalization, a browser test proves keyboard events reach it, and one deployed smoke
case proves the AudioWorklet asset loads. Do not repeat the entire scenario at every layer.

## New-feature checklist

Before implementation:

- Add or update the durable promise in `product-contract.md` if the product contract changes.
- Add or update the executable scenario in `behaviour.md`.
- Identify the owning automated layer using the decision tree above.
- State separately whether deployment or manual evidence is required.

During implementation:

- Write the lowest-layer failing test first.
- Extract deterministic logic rather than reaching private state through globals.
- Add one integration assertion for the seam between pure logic and the UI when that seam can
  regress independently.
- Generate synthetic audio/ZIP data using production `lib/wav.js` and `lib/zip.js` code.
- Keep real copyrighted/user audio out of tests and out of published artifacts.

Before handoff:

- Run the targeted test, then `npm test` and `npm run build`.
- Verify the PR preview at the affected boundary. After merge, run the production delivery
  canary. Run the full two-origin smoke only for the triggers in layer 5 or a release gate.
- Run only the remaining smoke/manual scenarios whose boundary changed.
- Update the coverage mapping when it exists.
- Report automated, deployed, and manual evidence separately; never collapse them into
  “all tests passed.”

## Fixture rules

- Prefer small deterministic arrays and generated files.
- Use the shared synthetic stems helper planned in the behaviour-test-strategy spec; until it
  exists, use the `buildStemsZip()`/`loadStemsZip()` recipe in `behaviour.md`.
- Use `examples/nov_you.zip` only for real-song musical and production regression, not as the
  sole fixture for the behavior matrix.
- Generate malformed ZIPs by explicit byte mutation in tests, following
  `tests/unzip.test.js`; do not maintain opaque corrupt binaries.
- Do not commit generated downloads, model files, `rips/`, or `stems/`.

## Test quality rules

- Assert observable output, not an implementation detail, unless the implementation detail
  is itself a load-bearing platform constraint documented in the product contract.
- A DOM property such as `hidden` is not visual evidence; use computed style in Chromium.
- A CSS/class assertion is not audio evidence; observe gain ramps or rendered audio.
- A loop badge is not proof that playback wrapped; sample the clock/audio across laps.
- A fake Worker is not proof that the real Worker module loads.
- A successful CI deployment job is not proof that the browser has the new cached page;
  compare the build SHA first.
- Give every test a name that states the behavioral consequence, not merely the function
  called.
- Avoid sleeps when an observable event/state can be awaited. Where browser throttling is
  part of the behavior, document the reason for the timing allowance.

## Current commands

```sh
npm test
npm run build
npm run dev
npm run preview
```

`npm test` currently runs the Node, jsdom, and headless-Chromium projects defined in
`vitest.config.js`. See the behaviour-test-strategy spec and plan for the staged expansion of
player-level integration coverage.
