# npm + Vite migration — design

**Status:** approved, not yet implemented.

## Goal

Stop vendoring third-party JS by hand (`lib/vendor/soundtouch-core.js`, copied in during the
[playback-speed design](2026-09-02-playback-speed-design.md)) and instead pull dependencies
from npm, with a real build step producing the site that gets deployed — for both the `main`
deploy and every PR preview. This supersedes the "vendored/static file only, no npm, no
bundler" constraint that design accepted at the time.

## Constraint change

CLAUDE.md's hard constraint **"No build step, no dependencies, no framework... nothing
installed"** is explicitly relaxed by the user as part of this design. The new constraint:
npm-managed dependencies and a Vite build step are the pipeline; the project still takes on
**no UI framework** (React/Vue/etc.) and no dependency beyond what's actually needed — vanilla
JS stays the default for code we write ourselves. The `file://`-dropped-in-v1.5.0 history and
"served over HTTP only" constraint are unrelated and still stand.

## Non-goals (explicitly out of scope for this pass)

- **No ES module conversion.** `app.js` and the classic-script `lib/*.js` files
  (`stems.js`, `i18n.js`, `platform.js`, `unzip.js`, `ribbon.js`, `jianpu.js`,
  `transport-math.js`, `analytics.js`) keep the window-global pattern (`window.SansStems`,
  etc.) exactly as today. Vite bundles/hashes them as plain scripts; it does not need them to
  be modules to do that. Converting them to `import`/`export` is a real, separate piece of
  work (it touches every test page's loading too) and is deliberately deferred to a future
  session so this migration can be verified in isolation.
- **ONNX Runtime and the separation model stay runtime-fetched, not bundled.**
  `separate.worker.js` already loads `onnxruntime-web` from a jsDelivr CDN URL via a dynamic
  `import()` at runtime, and the 285 MB model via `fetch` from Hugging Face at runtime.
  Neither is vendored today, so neither is in scope — bundling a WASM/WebGPU runtime this
  large is its own project, not a byproduct of removing one 21 KB vendored file.
- **GoatCounter's external `<script>` tag is untouched** — it's already loaded from
  `https://gc.zgo.at/count.js`-equivalent, not vendored.
- **No TypeScript.** Not requested; would add a second, unrelated migration.

## What changes

### 1. Dependencies

- New `package.json`. Runtime dependency: `soundtouchjs@0.3.0` (the real npm package
  `lib/vendor/soundtouch-core.js` was hand-copied from — confirmed via its own vendoring
  note). Dev dependency: `vite`.
- `package-lock.json` is committed. `node_modules/` is added to `.gitignore`.
- `lib/vendor/soundtouch-core.js`, `lib/vendor/LICENSE-soundtouchjs`, and the `lib/vendor/`
  directory are deleted. `lib/stretch-processor.js` imports the DSP classes it needs
  (`SoundTouch`, `SimpleFilter`, or whichever named exports `soundtouchjs` provides) from the
  package instead of a relative vendor path.

### 2. Build tool: Vite, multi-page

`vite.config.js` declares a multi-page build (`build.rollupOptions.input`) with four entry
HTML files: `index.html`, `tests/test.html`, `tests/parity.html`, `tests/notes.html`. All four
are built the same way, output to `dist/`, mirroring today's directory layout (so
`dist/tests/test.html` etc.). Dev server default port is set to `8777` in config to match
existing muscle memory and docs.

Vite processes every relative `<script src>`, `<link href>`, and `<img src>` in an entry HTML
file — module or not — fingerprinting it into the hashed build output and rewriting the
reference. This is why the classic scripts don't need to become ES modules to benefit from
the build: Vite treats them as assets to copy+hash, not as a module graph to crawl (they have
no `import`/`export` statements to crawl anyway).

### 3. Cache-busting: hashes replace manual `?v=`

Today every asset URL manually carries `?v=1.19.0`, in 28 places that must all match by hand
(`tests/versions.test.js` enforces this — see the CLAUDE.md gotcha). This is exactly the
fragility a build step exists to remove.

- All `?v=X.Y.Z` query strings are deleted from `index.html`, the test pages, and worker
  internal imports (e.g. `import { ... } from './lib/overlap.js?v=1.19.0'` →
  `from './lib/overlap.js'`).
- The three worker instantiations move to Vite's documented worker-detection pattern so the
  worker files themselves get bundled and hashed instead of served as static passthrough
  files:
  - `separate.js`: `new Worker('separate.worker.js?v=1.19.0', {type:'module'})` →
    `new Worker(new URL('./separate.worker.js', import.meta.url), {type: 'module'})`
  - `notes.js` (both call sites): same pattern for `notes.worker.js`.
- The AudioWorklet load moves the same way: `app.js`'s
  `audio.audioWorklet.addModule('lib/stretch-processor.js?v=1.19.0')` →
  `addModule(new URL('./lib/stretch-processor.js', import.meta.url))`.
- `tests/versions.test.js` is deleted — there is nothing left for it to check once every
  asset URL Vite touches is content-hashed by the build itself. Its CLAUDE.md gotcha entry is
  rewritten to explain the hash-based guarantee that replaces it.

### 4. Dev workflow

- `scripts/serve.sh` is replaced by `npm run dev` (`vite`, port 8777). This also retires the
  "must use `ThreadingHTTPServer`, not `python3 -m http.server`" gotcha — Vite's dev server
  is non-blocking by default and won't wedge on the 285 MB model fetch the way the Python
  single-threaded server did.
- `npm run build` runs `vite build`, output to `dist/`.
- `scripts/rip-cd.sh` and `scripts/prep-stems.sh` (the offline audio pipeline) are untouched.

### 5. CI / deploy

All three workflows in `.github/workflows/` (`deploy main`, `PR preview`, `PR cleanup`) that
currently `rsync` the raw repository into the `gh-pages` checkout are updated:

- `deploy main` and `PR preview` add `actions/setup-node`, `npm ci`, `npm run build` steps
  before the sync, and rsync `dist/` into `site/` (or `site/pr-<N>/`) instead of the repo
  root. The `--exclude rips --exclude stems` flags become unnecessary (neither is a build
  input) but are left in place as a defensive no-op — cheap insurance if that ever changes.
- `PR cleanup` is untouched — it only deletes a `gh-pages` subdirectory, no build involved.
- `.nojekyll` creation is untouched — still written directly into the `site/` checkout after
  sync.
- Concurrency groups, the rebase-and-retry push loop, and the PR-preview-comment step are all
  untouched — none of that logic depends on what's being synced.

### 6. Documentation

- CLAUDE.md: rewrite the "Hard constraints" bullet per the Constraint change section above.
  Rewrite the `?v=` gotcha and the `ThreadingHTTPServer` gotcha to describe the new
  hash-based / Vite-dev-server reality. Update the repo layout listing (`package.json`,
  `vite.config.js`, `dist/` as a build output, `lib/vendor/` removed). Update every
  `scripts/serve.sh` reference to `npm run dev`.
- `README.md` and `docs/deployment.md`: update setup/run instructions (`npm install`,
  `npm run dev`, `npm run build`) and describe the new CI build step.
- `docs/devlog.md`: new entry once implemented, versioned `v1.20.0` (a main release — app
  behavior/UX is unchanged, this is pipeline-only) with `[insight]`/`[gotcha]` tagged
  learnings from the migration itself.

## Testing

The browser-page test harness (`tests/test.html`, `tests/parity.html`, `tests/notes.html`,
read via `window.__testResults` / `window.__parity` / `window.__notes`) is unchanged in
substance — same assertions, same globals — only reachable via `npm run dev` instead of
`scripts/serve.sh`, and buildable via `npm run build` + serving `dist/` for a
production-parity check. `tests/versions.test.js` is deleted (see above); no replacement test
is needed since Vite's content hashing is a build-time guarantee, not a runtime invariant to
assert on.

**Manual verification** (single consolidated task, at the end of implementation): run
`npm run dev`, load the app, confirm loading a song/zip, playback, solo/mute, A-B loop, speed
control (exercises the migrated `soundtouchjs` dependency and the AudioWorklet URL change),
and separation (exercises the migrated worker URL change) all still work; then run
`npm run build`, serve `dist/` with a static server, and repeat the same smoke pass against
the built output to confirm the CI path will work; then run all three test pages under both
dev and built modes.

## Risks / things that could go wrong

- **Vite's asset URL rewriting for non-module scripts.** This is the load-bearing assumption
  of the whole "no ES module conversion needed" decision. If for any reason Vite doesn't
  rewrite a plain `<script src="lib/foo.js">` reference in one of the four entry HTML files,
  that script 404s in the built output. Caught immediately by the manual verification pass
  against `dist/`.
- **`soundtouchjs`'s published export shape** may not exactly match the classes
  `lib/stretch-processor.js` currently references from the vendored file 1:1 — the vendoring
  note says "DSP core only, dist/soundtouch.js classes," so this should be a drop-in, but the
  exact export names need checking against the installed package during implementation.
- **AudioWorklet + Vite worker bundling together.** `lib/stretch-processor.js` is loaded both
  as an AudioWorklet module (via `addModule`) and needs the `soundtouchjs` import to resolve
  inside that worklet global scope, which is a separate JS realm from the main thread /
  regular workers. Vite bundling the worklet module (via the `new URL(...)` pattern) needs to
  resolve `soundtouchjs` at build time and inline it — this is a standard bundler capability
  but is the piece most worth checking early during implementation, since an AudioWorklet
  failing to load reports as a confusing runtime error, not a build error.
