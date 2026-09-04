# Behaviour coverage and automated test strategy

**Status:** proposed 2026-09-03
**Scope:** test architecture, reusable synthetic fixtures, extraction of deterministic UI
state, browser integration coverage, and consolidation of `docs/behaviour.md`. This work must
not intentionally change player behaviour.

## Motivation

`docs/behaviour.md` is the project's executable smoke/acceptance memory, but it now contains
255 rows and is serving three different purposes:

1. user-visible acceptance criteria;
2. detailed algorithm invariants already covered by unit tests; and
3. historical/manual recipes for reproducing old regressions.

The result is expensive and ambiguous release testing. A single production fixture cannot
exercise the matrix, while many rows that look manual are already covered more precisely by
Vitest. The document also reuses identifiers (`S*`, `N*`, and `T*` across sections), and
`E42` names two different editing behaviours. Some observation recipes still refer to
retired `window.SansX`/`window.sansBass` bridges.

The goal is not to delete knowledge or stop using `docs/behaviour.md` as the source for
harness-driven smoke testing. It is to give each fact one authoritative home, create a
separate durable product contract, and make the normal regression gate `npm test`, reserving
live Chrome for behaviour that truly depends on deployment, a real user gesture, a real
model, a physical device, or human hearing.

## Goals

1. Every current behaviour row is mapped before any consolidation to one or more of:
   - Node Vitest;
   - jsdom Vitest;
   - headless-Chromium Vitest;
   - production smoke test;
   - manual/physical/auditory acceptance;
   - historical evidence only.
2. Put deterministic algorithms and state transitions under `npm test`.
3. Add a reusable synthetic audio/ZIP fixture builder shared by browser tests.
4. State durable user-facing promises without test mechanics in `docs/product-contract.md`.
5. Add player-level browser integration tests that load the real entry page and exercise
   observable DOM behaviour without depending on the Codex/Claude browser extensions.
6. Keep `docs/behaviour.md` as the executable smoke-test reference, organized into scenarios
   that a human or browser harness can follow directly.
7. Keep a small production smoke test for real deployed assets, Workers, AudioWorklet,
   cached/uncached model behaviour, and the real-song fixture.
8. Remove duplication from `docs/behaviour.md` while preserving explicit setup, action, and
   observable-result instructions and coverage links.
9. Give every retained scenario a globally unique, stable identifier.

## Non-goals

- No player feature or visual redesign.
- No replacement of Vitest or Playwright.
- No new UI framework.
- No attempt to make subjective audio quality a unit-test assertion unless an objective
  signal measurement represents the actual contract.
- No removal of a behaviour until equivalent automated or retained manual coverage is
  demonstrated in the coverage map.
- No mandatory download of the 285 MB separator model during ordinary `npm test`.

## Test pyramid

### Tier 1: Node — pure data and state

Keep signal processing and serialization in the current Node project. Extract small pure
state modules from `app.js`, `notes.js`, and `separate.js` only when a behaviour is currently
testable solely through private mutable state.

Candidate modules:

- `lib/routing-state.js`: lane toggle, mode selection, mute-all snapshot and restoration,
  and mix/stem exclusivity.
- `lib/loop-state.js`: point ordering, minimum loop length, clearing on song load, and the
  per-source loop plan for stems of unequal duration.
- `lib/player-state.js`: speed reset and the decision to rebuild the graph when crossing the
  native/stretched boundary.
- `lib/detection-state.js`: loaded/pending/running/complete notes-channel state and derived
  panel/button visibility.
- `lib/editor-state.js`: selected note versus selected range, enabled commands, batched
  edit construction, and song-load reset.
- `lib/separation-state.js`: idle/running/success/cancel/error control state.
- `lib/jianpu-html.js`: the existing self-contained list renderer currently private to
  `notes.js`.

Extraction is permitted only as a behaviour-preserving move: first pin current behaviour,
then replace the old inline logic with the tested function.

### Tier 2: jsdom — document wiring without media

Use jsdom for dictionary application, local-storage failure handling, analytics event wiring,
status rendering, and DOM state that does not require layout, canvas, Worker, or Web Audio.

### Tier 3: headless Chromium — real player integration

Add a browser-project suite that opens the actual application entry page under Vite. It must
exercise real event wiring and computed styles with generated fixtures. Appropriate cases
include:

- the single shared file input and repeat selection;
- stored/deflated/flat/folder/sidecar/partial-failure ZIPs;
- drag/drop rejection and overlay event accounting;
- lane ordering, hit targets, computed hidden state, and responsive hints;
- routing controls and keyboard focus;
- notes/tempo panel state machines with a fake deterministic notes Worker where the Worker
  protocol, not pitch accuracy, is under test;
- separation success/cancel/error UI with a fake Worker where the protocol is under test;
- note editing controls, pointer gestures, fields, range selection, snapping, and undo;
- export filenames and generated JSON/HTML contents;
- language rerendering without replacing playback canvases;
- startup fault injection and analytics integration.

The suite should use browser-project primitives, not browser-extension automation. Tests
that need Web Audio may use real `OfflineAudioContext` or instrument browser prototypes;
tests should assert output/observable calls rather than private variables.

### Tier 4: deployment and manual acceptance

Retain live checks only for boundaries not represented faithfully by the earlier tiers:

- build SHA and deployed hashed assets;
- the real notes Worker and real separator Worker module boundaries;
- one cached and, when deliberately requested, one uncached model download;
- AudioContext unlocking from a trusted user gesture;
- background-tab throttling behaviour;
- physical handheld memory/platform behaviour;
- subjective pitch preservation, loop seam quality, and musical chord accuracy;
- the real-song regression fixture `examples/nov_you.zip`.

The ordinary test gate must never download the separator model. A separately named smoke
command or documented production procedure owns that cost.

## Reusable fixtures

Create `tests/helpers/audio-fixtures.js` from the documented `buildStemsZip()` recipe. It
must call the real `encodeWav()` and `buildZip()` implementations and provide:

- `sine()`, `clickTrack()`, and silence/sample helpers;
- `wavFile()` and `stemsZip()`;
- folder and flat ZIP layouts;
- optional mix, unknown filenames, Finder sidecars, and invalid audio entries;
- deterministic durations and sample rate (44100 Hz).

Malformed ZIP structure belongs in `tests/helpers/zip-fixtures.js`, using the existing byte
mutation patterns from `tests/unzip.test.js`. Fixtures should be generated in memory; do not
commit binary archives.

## Coverage migration

Before editing the behaviour matrix, add `docs/test-coverage.md` with one row per existing
behaviour ID plus its section (section is required because current IDs collide). Each row
records:

- canonical replacement ID;
- short contract;
- automated test file and test name, if any;
- retained live/manual scenario, if any;
- disposition: `retain`, `merge`, `automate`, `historical`, or `remove-after-proof`.

Known groups that should become scenarios rather than many near-duplicate rows:

- routing: M1-M6, U1-U8, P1-P5;
- notes detection state: Notes N1-N4 and N22/N22a/N22b;
- song-load reset: Notes N12, Editing E1/E18, speed reset, loop reset, and tempo reset;
- note pointer selection: E2/E7/E19/E22/E24/E25;
- range selection: E12/E21/E39-E43;
- edit import/export: E17/E35/E36;
- sonification at entry/loop boundaries: R8-R13;
- interpretation/folding mechanics already specified in `docs/transcription.md`;
- chord algorithm details already specified in `docs/chord-detection.md`.

Use globally unique prefixes: `LOAD`, `MIX`, `TRN`, `LOOP`, `SPD`, `SEP`, `NOTE`, `TEMPO`,
`EDIT`, `EXPORT`, `LANG`, `BOOT`, and `ANALYTICS`. Old IDs remain in the coverage map so
history and devlog references do not become undecipherable.

## Product contract versus smoke scenarios

`docs/product-contract.md` is the user-facing contract: durable promises, no selectors or
test procedure. `docs/behaviour.md` remains the executable acceptance/smoke reference: each
scenario has fixtures/preconditions, actions, and observable results suitable for a human or
browser harness. `docs/test-coverage.md` connects both to automated and live evidence.

## Target shape of `docs/behaviour.md`

The final document should contain executable scenario-level checks, not a fixed numeric
target. A scenario may verify several related outcomes in one setup, but must remain usable
as a smoke-test prompt. Each scenario includes:

```text
ID | fixture/precondition | action | observable result | automated coverage | live coverage
```

Algorithm explanation and measured music-domain evidence move to the existing specialist
documents. Durable product promises live in `docs/product-contract.md`. Historical
browser-debugging lessons remain in a concise harness/gotchas section or `docs/devlog.md`;
they should not masquerade as tests that must be repeated every release.

## Documentation corrections

As part of the migration:

- replace observation recipes that require retired `window.SansX` or `window.sansBass`
  globals;
- update the stale global-bridge explanation in `vitest.config.js`;
- distinguish Playback speed IDs from Separation IDs, Notes IDs from Language IDs, and
  Transport IDs from Tempo IDs;
- resolve the duplicate Editing `E42` entries;
- preserve the current `Last exercised end-to-end` history in the coverage map or devlog
  before shortening the front matter.

## Acceptance criteria

1. `npm test` and `npm run build` pass.
2. Every one of the original 255 rows appears in the migration map exactly once, identified
   by both old section and old ID.
3. Every removed/merged row points to an automated test or retained scenario proving the
   same contract.
4. No globally duplicated IDs remain in the final behaviour matrix.
5. Generated fixture helpers contain no committed audio binaries and use production
   WAV/ZIP code.
6. Ordinary `npm test` performs no network fetch and downloads no separator model.
7. The production smoke checklist still exercises the real Workers and deployed assets.
8. A final real-song Chrome run and the relevant synthetic integration tests show no
   behavioural regression.
9. `docs/product-contract.md` remains free of implementation selectors and test procedures,
   while every retained `docs/behaviour.md` scenario remains directly executable.
