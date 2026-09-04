# Repository guidance for coding agents

Read `CLAUDE.md` before making changes. It is the repository's primary orientation guide,
despite its historical tool-specific filename. Follow its architecture, constraints,
documentation map, and gotchas.

Before adding or moving tests, read `docs/testing.md`. It defines the authoritative test
layers, placement decision tree, fixture rules, and the distinction between automated,
deployment-smoke, and manual evidence.

Before changing or exhaustively testing observable UI behaviour, read
`docs/product-contract.md` for durable user promises and `docs/behaviour.md` for executable
smoke/acceptance scenarios. The latter's **Synthesising stems on the fly** section defines
the intended browser-test harness:

- `buildStemsZip(stems, seconds)` generates synthetic WAV stems and packages them with
  the application's real `lib/wav.js` and `lib/zip.js` implementations.
- `loadStemsZip(stems, seconds)` feeds that generated ZIP through the real `#file-input`.

Use these helpers to create the stem combinations required by the behaviour matrix rather
than assuming committed fixture ZIPs are needed. They require the Vite development server
(`npm run dev`) because they import `/lib/wav.js` and `/lib/zip.js` by source path. The
committed `examples/nov_you.zip` remains the real-song fixture for musical regression and
production smoke checks.

Do not describe a run against only `examples/nov_you.zip` as the full behaviour matrix.
The matrix also contains synthetic-fixture, malformed-input, handheld, worker, visual,
and auditory cases; report exactly which categories were exercised or skipped.
