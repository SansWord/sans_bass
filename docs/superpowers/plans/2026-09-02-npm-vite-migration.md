# npm + Vite migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-vendored `soundtouchjs` copy and the manual `?v=` cache-busting
convention with a real npm + Vite pipeline, wired into both CI deploy workflows, with no
change to app behavior.

**Architecture:** Vite builds four HTML entry points (`index.html`,
`tests/test.html`, `tests/parity.html`, `tests/notes.html`) into `dist/`, content-hashing
every relative asset reference it touches. `app.js` and the classic-script `lib/*.js` files
stay window-global scripts — Vite copies and hashes them as assets, it does not need them to
be ES modules to do that. `soundtouchjs` becomes a normal npm dependency. Three worker/module
instantiations move to Vite's `new URL(..., import.meta.url)` pattern so the worker/worklet
files themselves get bundled and hashed too. CI gains `npm ci && npm run build` before the
existing `rsync`, which now syncs `dist/` instead of the raw repo.

**Tech Stack:** Vite 8 (`^8.2.2`), `soundtouchjs@^0.3.0`, Node 22 in CI (Vite 8 requires
`^20.19.0 || >=22.12.0`).

**Spec:** [`docs/superpowers/specs/2026-09-02-npm-vite-migration-design.md`](../specs/2026-09-02-npm-vite-migration-design.md)

## Global Constraints

- No UI framework (React/Vue/etc). Vanilla JS stays the default for code written in this
  repo. npm is now allowed for real dependencies and the Vite dev dependency only.
- No ES module conversion of `app.js` or the classic-script `lib/*.js` files
  (`stems.js`, `i18n.js`, `platform.js`, `unzip.js`, `ribbon.js`, `jianpu.js`,
  `transport-math.js`, `analytics.js`). They keep `window.SansX`-style globals.
- ONNX Runtime and the separation model stay runtime-fetched (jsDelivr CDN, Hugging Face) —
  not bundled, not touched by this plan.
- GoatCounter's external `<script>` tag is untouched.
- No TypeScript.
- `rips/` and `stems/` are never referenced by the build and must never be committed or
  published — unaffected by this plan, but keep it in mind when touching CI rsync commands.
- Every doc change in this plan uses exact wording given in each task — don't paraphrase,
  copy verbatim, since these are the load-bearing project docs (`CLAUDE.md`, `README.md`,
  `docs/deployment.md`, `docs/behaviour.md`, `docs/roadmap.md`).

---

### Task 1: npm project bootstrap

**Files:**
- Create: `package.json`
- Create (generated): `package-lock.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: an installed `node_modules/` with `vite` (devDependency) and `soundtouchjs`
  (dependency) available to every later task. `npm run dev` and `npm run build` scripts exist
  from this task on, though `npm run dev` / `npm run build` won't produce a *working* app
  until Task 4 (no `vite.config.js` yet) — that's expected, this task only bootstraps npm.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "sans_bass",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview --port 8777"
  },
  "dependencies": {
    "soundtouchjs": "^0.3.0"
  },
  "devDependencies": {
    "vite": "^8.2.2"
  }
}
```

- [ ] **Step 2: Install**

Run: `npm install`

Expected: exits 0, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 3: Add `node_modules/` to `.gitignore`**

In `.gitignore`, after the `.superpowers/` block, add:

```
# npm
node_modules/
```

- [ ] **Step 4: Verify the install**

Run: `ls node_modules/.bin/vite && node -e "require('node_modules/soundtouchjs/package.json')" 2>/dev/null || node -e "import('soundtouchjs/package.json', {assert:{type:'json'}})" 2>&1 | head -1`

Simpler and sufficient: `test -d node_modules/vite && test -d node_modules/soundtouchjs && echo OK`

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: bootstrap npm with vite and soundtouchjs"
```

---

### Task 2: Replace vendored SoundTouch with the npm package

**Files:**
- Delete: `lib/vendor/soundtouch-core.js`
- Delete: `lib/vendor/LICENSE-soundtouchjs`
- Delete (now-empty dir): `lib/vendor/`
- Modify: `lib/stretch-processor.js:1-6`
- Modify: `tests/soundtouch.test.js:1-2`

**Interfaces:**
- Consumes: `soundtouchjs` package installed in Task 1, exporting `SoundTouch` and
  `SimpleFilter` (confirmed against the installed `soundtouchjs@0.3.0` tarball — its
  `dist/soundtouch.js` ends with
  `export { AbstractFifoSamplePipe, PitchShifter, RateTransposer, SimpleFilter, SoundTouch, Stretch, WebAudioBufferSource, getWebAudioNode };`
  — a drop-in match for the two names both files already import).
- Produces: no change to any function signature or behavior — `lib/stretch-processor.js`'s
  `StretchProcessor` class and `tests/soundtouch.test.js`'s assertions are unaffected in
  substance, only their import source changes.

- [ ] **Step 1: Update the import in `lib/stretch-processor.js`**

Change (lines 1-6):

```js
/* AudioWorkletProcessor wrapping the vendored SoundTouch DSP core (lib/vendor/
 * soundtouch-core.js) — this project's own replacement for that library's
 * ScriptProcessorNode wrapper, which is not vendored. One instance per stem; app.js
 * creates one per track when the active rate is not 100%. See the design spec's
 * "Architecture" and "Loop wrap inside the worklet" sections. */
import { SoundTouch, SimpleFilter } from './vendor/soundtouch-core.js?v=1.19.0';
```

To:

```js
/* AudioWorkletProcessor wrapping the SoundTouch DSP core (npm: soundtouchjs) — this
 * project's own replacement for that library's ScriptProcessorNode wrapper, which
 * soundtouchjs doesn't export standalone. One instance per stem; app.js creates one per
 * track when the active rate is not 100%. See the design spec's "Architecture" and
 * "Loop wrap inside the worklet" sections. */
import { SoundTouch, SimpleFilter } from 'soundtouchjs';
```

- [ ] **Step 2: Update the import in `tests/soundtouch.test.js`**

Change:

```js
import { SoundTouch, SimpleFilter } from '../lib/vendor/soundtouch-core.js';
```

To:

```js
import { SoundTouch, SimpleFilter } from 'soundtouchjs';
```

- [ ] **Step 3: Delete the vendor directory**

```bash
rm -rf lib/vendor
```

- [ ] **Step 4: Verify no reference to the vendored path remains**

Run: `grep -rn "lib/vendor\|soundtouch-core" --include="*.js" --include="*.html" . | grep -v node_modules`

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add -A lib/stretch-processor.js tests/soundtouch.test.js lib/vendor
git commit -m "chore: replace vendored SoundTouch DSP core with the soundtouchjs npm package"
```

---

### Task 3: Remove manual `?v=` cache-busting and switch to Vite's worker/worklet URL pattern

**Files:**
- Modify: `app.js:188`
- Modify: `separate.js:4-5,73`
- Modify: `separate.worker.js:12`
- Modify: `notes.js:20-21,182,452`
- Modify: `notes.worker.js:15-16`
- Modify: `index.html` (every `?v=1.19.0` occurrence, plus the two comments explaining the
  now-removed convention)

**Interfaces:**
- Produces: every relative worker/worklet load goes through
  `new URL('./relative/path.js', import.meta.url)` — the pattern Vite's build step
  fingerprints and rewrites. Later tasks (4, 8) depend on every occurrence being converted;
  a leftover `?v=` or a plain string passed to `new Worker(...)`/`addModule(...)` will not be
  seen by Vite's static analysis and will 404 in the built output.

- [ ] **Step 1: Convert the AudioWorklet load in `app.js`**

Change (line 188):

```js
    workletReady = audio.audioWorklet.addModule('lib/stretch-processor.js?v=1.19.0');
```

To:

```js
    workletReady = audio.audioWorklet.addModule(new URL('./lib/stretch-processor.js', import.meta.url));
```

- [ ] **Step 2: Convert the worker instantiation in `separate.js`**

Change (line 73):

```js
  worker = new Worker('separate.worker.js?v=1.19.0', { type: 'module' });
```

To:

```js
  worker = new Worker(new URL('./separate.worker.js', import.meta.url), { type: 'module' });
```

- [ ] **Step 3: Convert both worker instantiations in `notes.js`**

Change (line 182):

```js
  const w = new Worker('./notes.worker.js?v=1.19.0', { type: 'module' });
```

To:

```js
  const w = new Worker(new URL('./notes.worker.js', import.meta.url), { type: 'module' });
```

Change (line 452):

```js
    worker = new Worker('./notes.worker.js?v=1.19.0', { type: 'module' });
```

To:

```js
    worker = new Worker(new URL('./notes.worker.js', import.meta.url), { type: 'module' });
```

- [ ] **Step 4: Strip the remaining `?v=1.19.0` query strings**

These are plain literal cache-busters on `import` specifiers and HTML asset attributes — no
structural change, just deletion of the query string.

Run:

```bash
sed -i '' 's/?v=1\.19\.0//g' index.html app.js separate.js separate.worker.js notes.js notes.worker.js
```

(On Linux, drop the empty `''` after `-i`.)

- [ ] **Step 5: Remove the now-obsolete versioning comment block in `index.html`**

Delete this comment (currently just above the `lib/stems.js` script tag):

```html
<!-- ?v= is a cache buster, and it is load-bearing. GitHub Pages serves every file with
     max-age=600 and no way to change that, so after a deploy a returning visitor can hold a
     stale app.js against a fresh index.html for ten minutes. That combination is not a
     degraded page, it is a dead one: app.js throws on the first element index.html no longer
     has and every listener below it — drag & drop included — never registers.
     Bump the version in ALL of these on release: index.html (15), separate.js (3),
     separate.worker.js (1), notes.js (4), notes.worker.js (2) — 25 in all.
     tests/versions.test.js fails if they drift apart. -->
```

Leave the `<script src="lib/stems.js">` line (now unversioned) directly where the comment
was.

- [ ] **Step 6: Simplify the GoatCounter comment in `index.html`**

Change:

```html
<!-- Anonymous, cookieless usage counts. External, so no ?v= -- and https:// rather than
     the protocol-relative //gc.zgo.at from GoatCounter's docs, because versions.test.js
     only skips external URLs that start with "http". -->
```

To:

```html
<!-- Anonymous, cookieless usage counts. External, so Vite leaves the URL alone — and
     https:// rather than the protocol-relative //gc.zgo.at from GoatCounter's docs, to
     keep it an unambiguous absolute URL. -->
```

- [ ] **Step 7: Verify no `?v=` or bare-string worker/worklet load remains**

Run:

```bash
grep -rn '?v=' index.html app.js separate.js separate.worker.js notes.js notes.worker.js lib/stretch-processor.js
grep -n "addModule('lib\|new Worker('" app.js separate.js notes.js
```

Expected: both commands print nothing.

- [ ] **Step 8: Commit**

```bash
git add index.html app.js separate.js separate.worker.js notes.js notes.worker.js
git commit -m "chore: remove manual ?v= cache-busting, switch workers/worklet to Vite URL pattern"
```

---

### Task 4: Add the Vite config and retire `scripts/serve.sh`

**Files:**
- Create: `vite.config.js`
- Delete: `scripts/serve.sh`

**Interfaces:**
- Consumes: the four entry HTML files at their existing paths (`index.html`,
  `tests/test.html`, `tests/parity.html`, `tests/notes.html`), and every relative asset
  reference fixed up in Tasks 2-3.
- Produces: `npm run dev` serves the app at `http://localhost:8777`; `npm run build` writes
  `dist/index.html`, `dist/tests/test.html`, `dist/tests/parity.html`,
  `dist/tests/notes.html`, plus every hashed JS/CSS/icon asset they reference.

- [ ] **Step 1: Write `vite.config.js`**

```js
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 8777,
  },
  build: {
    rollupOptions: {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        test: new URL('./tests/test.html', import.meta.url).pathname,
        parity: new URL('./tests/parity.html', import.meta.url).pathname,
        notes: new URL('./tests/notes.html', import.meta.url).pathname,
      },
    },
  },
});
```

- [ ] **Step 2: Delete `scripts/serve.sh`**

```bash
rm scripts/serve.sh
```

- [ ] **Step 3: Run the build and inspect the output**

Run: `npm run build`

Expected: exits 0. If it fails, the most likely cause per the spec's risk list is a script
tag Vite didn't rewrite (a leftover bare string in a `new Worker(...)` call, or a typo in
Task 3) — check the error against the file/line it names.

- [ ] **Step 4: Verify the output shape**

Run:

```bash
test -f dist/index.html && \
test -f dist/tests/test.html && \
test -f dist/tests/parity.html && \
test -f dist/tests/notes.html && \
echo OK
```

Expected: `OK`

- [ ] **Step 5: Verify hashed assets exist and no `?v=` leaked into the build**

Run:

```bash
ls dist/assets | grep -E '\.js$' | head -5
grep -c '?v=' dist/index.html
```

Expected: `ls` prints several hashed `.js` filenames (e.g. `app-XXXXXXXX.js`); `grep -c`
prints `0`.

- [ ] **Step 6: Start the dev server and confirm it responds**

Run (in the background, then curl it, then kill it):

```bash
npm run dev & DEV_PID=$!
sleep 2
curl -sf http://localhost:8777/ > /dev/null && echo "dev server OK"
kill $DEV_PID
```

Expected: `dev server OK`. (Full interactive smoke-testing of the running app happens in
Task 8 — this step only confirms the server itself comes up on the right port.)

- [ ] **Step 7: Commit**

```bash
git add vite.config.js
git rm scripts/serve.sh
git commit -m "feat: add vite.config.js for a multi-page build, retire scripts/serve.sh"
```

---

### Task 5: Delete `tests/versions.test.js`

**Files:**
- Delete: `tests/versions.test.js`
- Modify: `tests/test.html:37`

**Interfaces:**
- Produces: `tests/test.html`'s test suite no longer imports or runs the versions check —
  Vite's content hashing (Task 4) is a build-time guarantee, not a runtime invariant, so
  there is nothing left for a replacement test to assert.

- [ ] **Step 1: Delete the test file**

```bash
rm tests/versions.test.js
```

- [ ] **Step 2: Remove its import from `tests/test.html`**

Change:

```html
    await import('./stems.test.js');
    await import('./unzip.test.js');
    await import('./versions.test.js');
    await import('./i18n.test.js');
```

To:

```html
    await import('./stems.test.js');
    await import('./unzip.test.js');
    await import('./i18n.test.js');
```

- [ ] **Step 3: Verify no other file references it**

Run: `grep -rln "versions.test.js" --include="*.js" --include="*.html" . | grep -v node_modules`

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add -A tests/versions.test.js tests/test.html
git commit -m "chore: delete tests/versions.test.js — superseded by Vite content hashing"
```

---

### Task 6: Wire the build into CI

**Files:**
- Modify: `.github/workflows/deploy-main.yml`
- Modify: `.github/workflows/pr-preview.yml`

**Interfaces:**
- Produces: both workflows run `npm ci && npm run build` in the checked-out PR/main code
  (`src/`) before rsyncing, and rsync `src/dist/` instead of `src/` into the `gh-pages`
  checkout. `pr-preview-cleanup.yml` is untouched (no build involved — it only deletes a
  directory).

- [ ] **Step 1: Add the build steps to `deploy-main.yml`**

Insert immediately after the two `actions/checkout@v4` steps (before "Sync main to the site
root, keeping PR previews"):

```yaml
      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: src/package-lock.json

      - name: Install dependencies
        working-directory: src
        run: npm ci

      - name: Build
        working-directory: src
        run: npm run build
```

- [ ] **Step 2: Point the `deploy-main.yml` rsync at `dist/`**

Change:

```yaml
          rsync -a -c --delete \
            --exclude '.git' \
            --exclude '.github' \
            --exclude 'rips' \
            --exclude 'stems' \
            --filter 'protect pr-*' --filter 'protect .nojekyll' \
            src/ site/
```

To:

```yaml
          rsync -a -c --delete \
            --exclude '.git' \
            --exclude '.github' \
            --exclude 'rips' \
            --exclude 'stems' \
            --filter 'protect pr-*' --filter 'protect .nojekyll' \
            src/dist/ site/
```

- [ ] **Step 3: Add the same build steps to `pr-preview.yml`**

Insert immediately after "Check out the gh-pages branch" and before "Copy the PR into
pr-\${{ github.event.number }}/":

```yaml
      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: src/package-lock.json

      - name: Install dependencies
        working-directory: src
        run: npm ci

      - name: Build
        working-directory: src
        run: npm run build
```

- [ ] **Step 4: Point the `pr-preview.yml` copy step at `dist/`**

Change:

```yaml
          rsync -a -c --delete \
            --exclude '.git' \
            --exclude '.github' \
            --exclude 'rips' \
            --exclude 'stems' \
            src/ "$DEST/"
```

To:

```yaml
          rsync -a -c --delete \
            --exclude '.git' \
            --exclude '.github' \
            --exclude 'rips' \
            --exclude 'stems' \
            src/dist/ "$DEST/"
```

- [ ] **Step 5: Validate the workflow YAML**

Run: `python3 -c "import yaml, sys; [yaml.safe_load(open(f)) for f in ['.github/workflows/deploy-main.yml', '.github/workflows/pr-preview.yml']]; print('OK')"`

(If PyYAML isn't installed, `pip install --user pyyaml` first, or substitute
`gh workflow view` / any local YAML linter available.)

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/deploy-main.yml .github/workflows/pr-preview.yml
git commit -m "ci: build with npm + vite before publishing to gh-pages"
```

---

### Task 7: Update documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/deployment.md`
- Modify: `docs/behaviour.md`
- Modify: `docs/roadmap.md`

**Interfaces:**
- Produces: no code change — every edit below is a doc-text replacement. `docs/devlog.md`
  is deliberately excluded here: its existing entries are a historical log and must not be
  rewritten to match the new reality; Task 8 adds a new entry describing this migration
  instead.

- [ ] **Step 1: Rewrite the "Hard constraints" bullet in `CLAUDE.md`**

Change:

```markdown
- **No build step, no dependencies, no framework.** Vanilla JS, no bundler, no npm, nothing
  installed. The player core is `index.html`, `styles.css`, `app.js` plus `lib/stems.js`
  and `lib/unzip.js`. The site is served over HTTP — GitHub Pages, or `./scripts/serve.sh`
  locally. `file://` support was dropped in v1.5.0; `lib/stems.js`, `lib/unzip.js` and
  `lib/i18n.js` are still classic scripts only because the ESM migration is a separate
  change.
```

To:

```markdown
- **npm + Vite build the site; no UI framework.** `npm run dev` for local dev, `npm run
  build` for `dist/`, both CI workflows build before publishing. The player core is
  `index.html`, `styles.css`, `app.js` plus `lib/stems.js` and `lib/unzip.js`. Vanilla JS
  stays the default for code this project writes — React/Vue/etc. are still out. `file://`
  support was dropped in v1.5.0; `lib/stems.js`, `lib/unzip.js` and `lib/i18n.js` are still
  classic scripts, not ES modules, because that migration is separate — Vite bundles/hashes
  a plain `<script src>` without needing it to be a module.
```

- [ ] **Step 2: Update the Repo layout block in `CLAUDE.md`**

Change:

```markdown
scripts/serve.sh                   http://localhost:8777 (required for separation)
```

To:

```markdown
package.json  vite.config.js       npm scripts (dev/build/preview), Vite multi-page config
dist/                               build output (git-ignored; CI builds it, never committed)
```

Immediately below the `scripts/serve.sh` line originally was `scripts/rip-cd.sh` — leave
that and everything below it as-is; only the `scripts/serve.sh` line itself is replaced.

- [ ] **Step 3: Rewrite the `?v=` gotcha in `CLAUDE.md`**

Change:

```markdown
- **Every local asset URL carries `?v=<version>` and they must all match.** GitHub Pages pins
  everything to `max-age=600` with no way to override it, so for ten minutes after a deploy a
  returning visitor can run a stale `app.js` against a fresh `index.html`. That is not a
  degraded page — the old script throws on an element the new markup dropped, and because
  `app.js` wires everything from one flat run of top-level statements, every listener *below*
  the throw silently never registers. Bump the version in `index.html` (16), `app.js` (1),
  `lib/stretch-processor.js` (1), `separate.js` (3), `separate.worker.js` (1), `notes.js` (4)
  and `notes.worker.js` (2) — 28 in all; `tests/versions.test.js` fails if they drift — and
  it covers `.png` and `.svg` as well as `.js`/`.css`, so the icons are included. Currently
  `v1.19.0`.
```

To:

```markdown
- **Cache-busting is now Vite's content hash, not a hand-written `?v=`.** GitHub Pages still
  pins everything to `max-age=600` with no way to override it, but every asset Vite's build
  touches — every entry HTML's `<script src>`/`<link href>`/`<img src>`, and every
  `new Worker(new URL(...))` / `addModule(new URL(...))` reference — gets a content hash
  baked into its filename, so a stale `app.js` against a fresh `index.html` is no longer
  reachable: the fresh `index.html` points at the fresh `app.js`'s hashed name, not the old
  one. There is no version to bump by hand, and no `tests/versions.test.js`-shaped test is
  needed — it was deleted along with the manual `?v=` convention it guarded.
```

- [ ] **Step 4: Delete the `serve.sh` no-store gotcha in `CLAUDE.md`**

Delete this bullet entirely (its subject, `scripts/serve.sh`, no longer exists):

```markdown
- **`serve.sh` sends `Cache-Control: no-store`** because Chrome otherwise serves a stale
  ES module after you edit it, and the test page silently checks the old code — which looks
  exactly like a correct fix failing.
```

- [ ] **Step 5: Delete the GoatCounter-https-vs-versions.test.js gotcha in `CLAUDE.md`**

Delete this bullet entirely (its enforcement mechanism, `tests/versions.test.js`, no longer
exists):

```markdown
- **GoatCounter's script tag must be `https://`, not protocol-relative.** Their docs give
  `//gc.zgo.at/count.js`. `tests/versions.test.js` exempts external URLs with
  `url.startsWith('http')`, so a protocol-relative URL is treated as a local asset missing
  its `?v=` and fails the suite.
```

- [ ] **Step 6: Update the `allow_local` gotcha in `CLAUDE.md`**

Change:

```markdown
- **`allow_local` is deliberately not set.** GoatCounter filters localhost and private-IP
  requests, so events fired from `scripts/serve.sh` silently vanish — which looks exactly
```

To:

```markdown
- **`allow_local` is deliberately not set.** GoatCounter filters localhost and private-IP
  requests, so events fired from `npm run dev` silently vanish — which looks exactly
```

- [ ] **Step 7: Update the "Tests are browser pages" bullet in `CLAUDE.md`**

Change:

```markdown
- **Tests are browser pages, not a runner.** `tests/test.html` for units (read
  `window.__testResults`), `tests/parity.html` for separation accuracy against the native
  stems in the repo (read `window.__parity`). Both need `./scripts/serve.sh`. There is no
  npm and none may be added. Everything the unit tests cannot reach — the whole UI — is
  specified in [`docs/behaviour.md`](docs/behaviour.md), harness included.
```

To:

```markdown
- **Tests are browser pages, not a runner.** `tests/test.html` for units (read
  `window.__testResults`), `tests/parity.html` for separation accuracy against the native
  stems in the repo (read `window.__parity`). Both need `npm run dev` (or `npm run build`
  plus `npm run preview`, for a production-parity check). Everything the unit tests cannot
  reach — the whole UI — is specified in [`docs/behaviour.md`](docs/behaviour.md), harness
  included.
```

- [ ] **Step 8: Update the intro paragraph in `README.md`**

Change:

```markdown
Everything runs in the browser. No build step and no upload — your audio never leaves your
machine. In-browser separation fetches a model *in*, but nothing about your audio ever goes
*out*. It is built for learning a part: solo one instrument, set an A–B loop around the
phrase you keep fluffing, and drill it.
```

To:

```markdown
Everything runs in the browser. No upload — your audio never leaves your machine.
In-browser separation fetches a model *in*, but nothing about your audio ever goes *out*.
It is built for learning a part: solo one instrument, set an A–B loop around the phrase you
keep fluffing, and drill it.
```

- [ ] **Step 9: Update the "Already have stems?" line in `README.md`**

Change:

```markdown
**Already have stems?** Zip the folder, start the server with `./scripts/serve.sh`, open
<http://localhost:8777>, click **Load song or zip**, pick the zip, and skip to [Controls](#controls).
```

To:

```markdown
**Already have stems?** Zip the folder, start the server with `npm run dev`, open
<http://localhost:8777>, click **Load song or zip**, pick the zip, and skip to [Controls](#controls).
```

- [ ] **Step 10: Update the two `./scripts/serve.sh` command blocks in `README.md`**

There are two identical-shaped code blocks:

```bash
./scripts/serve.sh          # http://localhost:8777
```

(one before "Open that URL, click **Load song or zip**..." in the in-browser separation
section) and:

```bash
./scripts/serve.sh          # then open http://localhost:8777
```

(in the "Step 4 — Play" section). Replace each with:

```bash
npm run dev                 # http://localhost:8777
```

and:

```bash
npm run dev                 # then open http://localhost:8777
```

respectively (keep each one's original trailing comment wording, just swap the command).

- [ ] **Step 11: Rewrite the "Hosting it" paragraph in `README.md`**

Change:

```markdown
The whole thing is static, so GitHub Pages serves it with no backend and no build step —
push the repo and enable Pages. Inference runs on the visitor's GPU.
```

To:

```markdown
GitHub Pages serves the built `dist/` output with no backend — CI runs `npm run build`
before every deploy, so nothing unbuilt reaches `gh-pages`. Inference runs on the visitor's
GPU.
```

- [ ] **Step 12: Rewrite the "Serving over http" section in `README.md`**

This section has its own `./scripts/serve.sh` command block, immediately followed by a
paragraph about `ThreadingHTTPServer`. Edit the two pieces separately.

First, the command block — change:

    ./scripts/serve.sh          # http://localhost:8777

(this is the third of the file's three identical-shaped `./scripts/serve.sh` blocks — the
one inside the `### Serving over http` heading, distinguishable from the other two already
handled in Step 10 by that surrounding heading) to:

    npm run dev                 # http://localhost:8777

Then, the paragraph directly below it — change:

> Use `ThreadingHTTPServer` (as `serve.sh` does) rather than a plain `python3 -m http.server`.
> The default server is single-threaded, and with files this size the browser can wedge it —
> `fetch` then hangs forever while `curl` on the same URL returns instantly.

to:

> Vite's dev server is non-blocking, so it doesn't wedge on the ~285 MB model fetch the way
> a naive single-threaded static server would.

- [ ] **Step 13: Update the repo layout list in `README.md`**

Change:

```markdown
scripts/serve.sh          serve over http://localhost:8777
```

To:

```markdown
package.json              npm scripts: dev, build, preview
vite.config.js             Vite multi-page build config
```

- [ ] **Step 14: Update the "Constraints that are not features" list in `docs/behaviour.md`**

Change:

```markdown
- The site is served over HTTP. `file://` support was dropped in v1.5.0 — local use goes
  through `./scripts/serve.sh`, which separation already required.
- No build step, no dependencies, no npm, no framework.
```

To:

```markdown
- The site is served over HTTP. `file://` support was dropped in v1.5.0 — local use goes
  through `npm run dev`, which separation already required.
- npm-managed dependencies and a Vite build step; still no UI framework.
```

- [ ] **Step 15: Update the test-harness intro in `docs/behaviour.md`**

Change:

```markdown
There is no runner. `tests/test.html` covers the pure functions; everything below is
observed in a real browser. `./scripts/serve.sh` first — separation and ES modules need
HTTP.
```

To:

```markdown
There is no runner. `tests/test.html` covers the pure functions; everything below is
observed in a real browser. `npm run dev` first — separation and ES modules need HTTP.
```

- [ ] **Step 16: Update the cached-stylesheet gotcha in `docs/behaviour.md`**

Change:

```markdown
- **A same-URL navigation can reuse the cached stylesheet**, even though `serve.sh` sends
  `no-store` and `curl` shows the new bytes. Force it:
  `link.href = 'styles.css?v=' + Date.now()`.
```

To:

```markdown
- **A same-URL navigation can reuse the cached stylesheet.** This is a browser navigation
  cache quirk, independent of which dev server serves the page. Force it:
  `link.href = 'styles.css?v=' + Date.now()` (a one-off diagnostic override — unrelated to
  the retired production `?v=` convention).
```

- [ ] **Step 17: Update G3 and G4 in `docs/behaviour.md`**

Change:

```markdown
| G3 | Every local asset URL carries `?v=<version>`, and all of them agree. | `tests/versions.test.js`. GitHub Pages pins everything to `max-age=600` with no way to change it, so without this a returning visitor can hold a stale `app.js` against a fresh `index.html` for ten minutes. |
| G4 | The page is served over HTTP — GitHub Pages, or `./scripts/serve.sh` locally. `file://` is no longer supported (dropped in v1.5.0); opening `index.html` from disk is not expected to work. | `separate.js` now loads as a plain `<script type="module">` with no protocol guard. |
```

To:

```markdown
| G3 | Every asset Vite's build touches is content-hashed, and a fresh `index.html` never references a stale hashed file. | Run `npm run build`, inspect `dist/index.html` — every `<script src>`/`<link href>` points at a `-<hash>.js`/`.css` filename that matches a file actually present in `dist/assets/`. |
| G4 | The page is served over HTTP — GitHub Pages, or `npm run dev` locally. `file://` is no longer supported (dropped in v1.5.0); opening `index.html` from disk is not expected to work. | `separate.js` now loads as a plain `<script type="module">` with no protocol guard. |
```

- [ ] **Step 18: Rewrite the "Migrate to npm + a build step" roadmap entry in `docs/roadmap.md`**

Change:

```markdown
## Migrate to npm + a build step

Wanted: drop the "no build step, no npm" hard constraint (see `CLAUDE.md`) in favour of a real
package manager and bundler (Vite or esbuild), so third-party code (SoundTouchJS in
[`lib/vendor/soundtouch-core.js`](../lib/vendor/soundtouch-core.js), the ONNX runtime currently
pulled from jsDelivr in `separate.js`) can be installed as a normal dependency instead of
vendored or CDN-loaded.

**What this touches, once picked up.** This is a project-wide change, not a one-file swap:
`app.js` and every `lib/*.js` classic script would become bundled modules; `tests/test.html`'s
plain `<script>` tags would need to load through the same bundle (or the test harness would
need its own build step); the CI workflows in `.github/workflows/` would gain a build stage
before publishing to `gh-pages`, for both the `main` release and every per-PR `/pr-<N>/`
preview (see [`deployment.md`](deployment.md)); and `CLAUDE.md`, `README.md`, and
`deployment.md` would all need their "no build step" language rewritten.

**Open questions before design:** Vite vs. esbuild vs. something else; whether the whole app
bundles as one entry point or stays split (player / separation / notes) the way it is today;
whether `tests/test.html` keeps working unbundled during the transition or migrates in the
same pass. Raised while executing the v1.19.0 playback-speed plan — SoundTouchJS ended up
vendored under LGPL-2.1 rather than installed, precisely because this migration hadn't
happened yet.
```

To:

```markdown
## Migrate to npm + a build step

**Built in v1.20.0** — [spec](superpowers/specs/2026-09-02-npm-vite-migration-design.md),
[plan](superpowers/plans/2026-09-02-npm-vite-migration.md). See `vite.config.js`.

Dropped the "no build step, no npm" hard constraint in favour of npm + Vite: `soundtouchjs`
installs as a normal dependency instead of the vendored `lib/vendor/soundtouch-core.js`, and
`npm run build` produces `dist/`, which both CI workflows now publish instead of the raw
repo. `app.js` and the classic-script `lib/*.js` files did **not** need to become ES
modules — Vite fingerprints and rewrites a plain `<script src>` reference without requiring
a module graph, which is what kept this migration a clean, isolated pass.

**Still wanted:** the ONNX runtime and separation model stay CDN/runtime-fetched by design
(out of scope for this migration — see its spec's non-goals); converting `app.js` and the
classic-script `lib/*.js` files to real ES modules is still separate, deferred work.
```

- [ ] **Step 19: Verify no stray references remain**

Run:

```bash
grep -rn "scripts/serve.sh\|ThreadingHTTPServer" CLAUDE.md README.md docs/deployment.md docs/behaviour.md docs/roadmap.md
```

Expected: no output (the only remaining `scripts/serve.sh`/`ThreadingHTTPServer` mentions in
the repo should be historical, inside `docs/devlog.md`, which this task does not touch).

- [ ] **Step 20: Commit**

```bash
git add CLAUDE.md README.md docs/deployment.md docs/behaviour.md docs/roadmap.md
git commit -m "docs: describe the npm + Vite pipeline, retire the ?v= and serve.sh docs"
```

---

### Task 8: Manual verification, `docs/deployment.md` build-step note, and devlog entry

**Files:**
- Modify: `docs/deployment.md` (one paragraph)
- Modify: `docs/devlog.md`

**Interfaces:**
- Consumes: everything from Tasks 1-7 — this is the single consolidated manual/browser pass
  the project's convention calls for, run once at the end instead of per-task.

- [ ] **Step 1: Rewrite the `docs/deployment.md` intro paragraph**

Change:

```markdown
The site is static, so hosting it needs no backend and no build step. It lives at
**<https://sansword.github.io/sans_bass/>**, served by GitHub Pages from the `gh-pages`
branch. Inference runs on the visitor's GPU; the server only ever hands out files.
```

To:

```markdown
The site is static once built, so hosting it needs no backend. A Vite build step
(`npm run build`) runs in CI before every deploy — nothing unbuilt reaches `gh-pages`. It
lives at **<https://sansword.github.io/sans_bass/>**, served by GitHub Pages from the
`gh-pages` branch. Inference runs on the visitor's GPU; the server only ever hands out
files.
```

- [ ] **Step 2: Also update the parity-test note in `docs/deployment.md`**

Change:

```markdown
`tests/parity.html` will **not** work on a preview. It compares separation output against
the native stems in `rips/` and `stems/`, which are deliberately never published. Run it
locally against `./scripts/serve.sh`.
```

To:

```markdown
`tests/parity.html` will **not** work on a preview. It compares separation output against
the native stems in `rips/` and `stems/`, which are deliberately never published. Run it
locally against `npm run dev`.
```

- [ ] **Step 3: Manual verification — dev mode**

Run: `npm run dev`

Open `http://localhost:8777` in a browser and confirm, in order:

1. The page loads with no console errors.
2. Load a song (a single audio file) via **Load song or zip**. Confirm playback starts,
   waveforms render.
3. Solo/mute at least two stems; confirm audio and waveform highlighting both respond.
4. Set an A–B loop and confirm it loops audibly at the boundary.
5. Move the speed slider off 100% and confirm pitch-preserved playback still works — this
   exercises the migrated `soundtouchjs` import and the `addModule(new URL(...))` change
   from Task 3.
6. Click **Separate into 6 stems** on a freshly loaded song and confirm it completes — this
   exercises the migrated `new Worker(new URL(...))` change in `separate.js`.

Then open each test page and confirm all tests pass:

- `http://localhost:8777/tests/test.html` — read `window.__testResults`, confirm no
  failures (in particular `soundtouch.test.js`, now importing from the npm package).
- `http://localhost:8777/tests/parity.html` — read `window.__parity`.
- `http://localhost:8777/tests/notes.html` — read `window.__notes`.

- [ ] **Step 4: Manual verification — built mode**

Run:

```bash
npm run build
npm run preview
```

Repeat the exact same checks as Step 3 (playback, solo/mute, A-B loop, speed control,
separation, and all three test pages) against `http://localhost:8777` — this time serving
the actual `dist/` output, confirming the CI path will work in production.

- [ ] **Step 5: Record what actually happened**

If anything in Steps 3-4 surfaced a real surprise not already covered by this plan's risk
list (Vite not rewriting some asset reference, the AudioWorklet failing to resolve
`soundtouchjs` inside the worklet global scope, etc.), fix it now, re-run the affected
verification step, and note the actual root cause for the devlog entry in Step 6. If nothing
surprising came up, the devlog entry below is written as-is.

- [ ] **Step 6: Add the devlog entry**

Per this project's convention, add a `docs/devlog.md` entry for `v1.20.0` (newest-first,
directly above the existing `## v1.19.0` entry) and a matching row in the TL;DR table
(directly below the header/separator rows, above the `v1.19.0` row). Get the date/time for
the heading from `git log` on the commit that lands this task, per `CLAUDE.md`'s devlog
heading convention.

TL;DR row:

```markdown
| [v1.20.0](#v1200--npm--vite-migration-YYYY-MM-DD-HHMM) | Dropped the vendored SoundTouch DSP core and the hand-written `?v=` cache-busting convention for a real npm + Vite pipeline: `soundtouchjs` installs as a normal dependency, `npm run build` produces the `dist/` both CI workflows now publish, and every asset Vite touches gets a content hash instead of a manually-bumped version string. No UI framework added; `app.js` and the classic-script `lib/*.js` files stay window-global scripts. |
```

(Replace the `YYYY-MM-DD-HHMM` anchor fragment with the actual date/time, GitHub-anchor-cased
to match the heading below.)

Entry body — write the heading, **Review**, **Design docs**, and **What was built** exactly
as follows (these are already fully known from Tasks 1-7), then write **Key technical
learnings** and, if applicable, **Process learnings** yourself, tagging each bullet `[note]`
/ `[insight]` / `[gotcha]` — in particular anything Step 5 above surfaced that this plan
could not have known in advance (how Vite's asset rewriting or worker/worklet bundling
actually behaved on the first real build and dev run, not just the plan's prediction of it):

```markdown
## v1.20.0 — npm + Vite migration (YYYY-MM-DD HH:MM)

**Review:** not yet

**Design docs:**
- npm + Vite migration: [Spec](superpowers/specs/2026-09-02-npm-vite-migration-design.md) [Plan](superpowers/plans/2026-09-02-npm-vite-migration.md)

**What was built:**

- Replaced `lib/vendor/soundtouch-core.js` (hand-copied during the v1.19.0 playback-speed
  work) with `soundtouchjs@^0.3.0` as a normal npm dependency — a verified drop-in, same
  `SoundTouch`/`SimpleFilter` exports both `lib/stretch-processor.js` and
  `tests/soundtouch.test.js` already used.
- Added `package.json`, `package-lock.json`, and `vite.config.js` (multi-page build across
  `index.html`, `tests/test.html`, `tests/parity.html`, `tests/notes.html`). `npm run dev`
  replaces `scripts/serve.sh`; `npm run build` writes `dist/`, mirroring the source layout.
- Removed every hand-written `?v=1.19.0` cache-buster and `tests/versions.test.js`, the test
  that guarded them — Vite's content hashing makes a stale-asset-against-fresh-markup
  mismatch structurally impossible instead of manually guarded.
- Converted the three worker instantiations (`separate.js`, `notes.js` ×2) and the one
  AudioWorklet load (`app.js`) from string paths (some carrying `?v=`) to
  `new URL('./relative.js', import.meta.url)`, Vite's documented pattern for bundling and
  hashing worker/worklet files instead of serving them as static passthrough.
- Both `deploy-main.yml` and `pr-preview.yml` gained `actions/setup-node` + `npm ci` +
  `npm run build` steps, and their `rsync` source moved from the raw checkout to `dist/`.
  `pr-preview-cleanup.yml` is unaffected (no build involved).
- `app.js` and the classic-script `lib/*.js` files (`stems.js`, `i18n.js`, `platform.js`,
  `unzip.js`, `ribbon.js`, `jianpu.js`, `transport-math.js`, `analytics.js`) are unchanged in
  substance — still `window.SansX`-style globals, not ES modules.

**Key technical learnings:**

- `[note]` `soundtouchjs@0.3.0`'s published `dist/soundtouch.js` exports exactly
  `{ AbstractFifoSamplePipe, PitchShifter, RateTransposer, SimpleFilter, SoundTouch,
  Stretch, WebAudioBufferSource, getWebAudioNode }` — confirmed against the actual npm
  tarball before writing this plan, not assumed from the vendoring comment.
```

- [ ] **Step 7: Commit**

```bash
git add docs/deployment.md docs/devlog.md
git commit -m "docs: add v1.20.0 devlog entry for the npm + Vite migration"
```
