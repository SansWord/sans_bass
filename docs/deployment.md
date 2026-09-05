# Deployment

The site is static once built, so hosting it needs no backend. A Vite build step
(`npm run build`) runs in CI before every deploy — nothing unbuilt reaches `gh-pages`. It
lives at **<https://sansword.github.io/sans_bass/>**, served by GitHub Pages from the
`gh-pages` branch. Inference runs on the visitor's GPU; the server only ever hands out
files.

## The shape of it

```
main ────────push───────▶ Deploy main ──────┐
                                            ├──▶ gh-pages ──▶ Pages ──▶ the live site
PR #N ───────push───────▶ PR preview  ──────┤        │
     └──────closed──────▶ PR cleanup  ──────┘        │
                                                     ├── /              ← main
                                                     └── /pr-N/         ← PR N
```

One branch holds everything Pages serves. `main` owns the root; every open pull request
owns a `pr-<N>/` subdirectory. Three workflows in `.github/workflows/` do the writing, and
nothing on `gh-pages` should ever be edited by hand.

| Workflow | Trigger | Writes | Concurrency group |
|---|---|---|---|
| `deploy-main.yml` | push to `main`, or manual dispatch | `gh-pages` root | `gh-pages-main` |
| `pr-preview.yml` | PR opened / synchronized / reopened | `gh-pages:/pr-<N>/` | `gh-pages-pr-<N>` |
| `pr-preview-cleanup.yml` | PR closed | removes `/pr-<N>/` | `gh-pages-pr-<N>` |

`pr-preview.yml` also posts a single sticky comment on the PR with the preview links,
updating it in place rather than commenting on every push.

A fourth workflow, `test.yml`, runs `npm test` (Vitest) on every PR and on push to `main`.
It writes nothing to `gh-pages` — it only gates the PR — so it is not in the table above.
Some of the unit tests need real Web Audio (`AudioContext`/`OfflineAudioContext`) or a real
module `Worker`, neither of which Node or jsdom implements; `vitest.config.js` runs those
in headless Chromium via `@vitest/browser-playwright`, and `test.yml` installs the browser
binary (`npx playwright install --with-deps chromium`) before running the suite — so
`npm test` needs no manual browser interaction, locally or in CI.

## Verifying a change before it reaches production

Open a pull request. It gets its own live copy at `/pr-<N>/`, which is a real Pages
deployment on the real origin — the right place to check anything that behaves differently
under HTTPS from a public host than it does on `localhost`:

- the ONNX runtime loading from jsDelivr and the ~285 MB model from Hugging Face (both
  cross-origin, both dependent on those hosts' CORS headers)
- WebGPU initialising and reporting `webgpu` rather than falling back to `wasm`
- Cache Storage keeping the model, so a second visit starts in well under a second

The unit suite itself (`npm test`) is not part of the preview — it's a separate CI gate
(`test.yml`) that runs against the PR's code directly, independent of any deploy.

Use the tiered procedure in [`behaviour.md`](behaviour.md#deployment-verification) instead of
replaying every interactive check after both deployments:

1. On every PR preview, confirm the preview workflow conclusion and displayed SHA, then test
   the behavior and public-host boundary affected by the change.
2. After every merge, use a compact production delivery canary: confirm `deploy-main.yml`
   succeeded, the root page displays the merged SHA, the page boots without load/console
   errors, and one affected route or control works when relevant.
3. Run the full detailed smoke on both URLs when the PR changes the deployment workflows,
   Vite/base paths, entry HTML, Worker/AudioWorklet loading, caching, or static asset routing,
   and for explicit release acceptance.

Real-song and cached-model runs are required when musical/audio/separation behavior changes or
at a release gate. The uncached 285 MB model path remains opt-in. Use focused browser
assertions and compact summaries for routine verification; reserve screenshots and full page
structure captures for visual or structural changes. This keeps the browser evidence tied to
the risk and avoids spending review time and agent context on duplicate evidence.

`tests/parity.html` will **not** work on a preview. It compares separation output against
the native stems in `rips/` and `stems/`, which are deliberately never published. Run it
locally against `npm run dev`.

Merging the PR deletes its preview directory and publishes `main` to the root. The production
canary is still required because it proves that the intended commit reached the root URL.

## Rules that keep this safe

- **Never commit audio.** `rips/` and `stems/` are the owner's own recordings — hundreds of
  megabytes of commercial music. `.gitignore` excludes them on every branch, *including
  `gh-pages`*, and both deploy workflows exclude them from `rsync` as a second line of
  defence. Publishing this repo must never publish the recordings.
- **Never commit the model.** It is 285 MB, over GitHub's 100 MB file limit, and is fetched
  from Hugging Face at runtime and cached in the browser instead.
- **Never set `ort.env.wasm.numThreads` above 1.** Threads require SharedArrayBuffer, which
  requires the COOP and COEP response headers, which GitHub Pages cannot set. Single-threaded
  is what makes static hosting possible at all — see [`CLAUDE.md`](../CLAUDE.md).

## Gotchas this setup already hit

- **`rsync -a` alone publishes stale content.** Its default check is size plus mtime, so a
  file that changed but kept its byte count is skipped silently. Both deploy workflows use
  `-c` to compare checksums. This was caught by fault injection, not in production: a test
  sync left `index.html` at the old version while every other assertion passed.
- **Two workflows must not share a concurrency group.** Merging a pull request fires
  `deploy-main` (push to `main`) and `pr-preview-cleanup` (PR closed) in the same instant.
  When they shared one group, one ran and the other went pending — and GitHub cancels a
  pending run as soon as another joins the group. On the v1.2.0 merge that was `deploy-main`,
  so production never deployed and the root kept serving a placeholder. Each workflow now has
  its own group. Concurrent writes are safe regardless, because every push retries with
  `git pull --rebase` and the workflows touch disjoint paths.
- **`.nojekyll` is required and must be recreated every run.** Without it Pages runs the site
  through Jekyll, which reprocesses files that need no processing. Because the root sync uses
  `--delete`, the file is both protected by a filter and re-created after every sync, so it
  cannot be lost.
- **An orphan branch does not inherit `.gitignore`.** When `gh-pages` was first created,
  `rips/` and `stems/` showed as untracked there, so a stray `git add -A` while checked out
  on that branch would have staged ~860 MB of audio. `.gitignore` is now committed on
  `gh-pages` too.
- **Previews do not work for pull requests from forks.** The `pull_request` event gives a
  fork's workflow a read-only token, so it cannot push to `gh-pages`. This is deliberate: the
  alternative, `pull_request_target`, runs trusted workflow code against untrusted PR content.
  Branch pull requests in this repo are unaffected.

## Operating it

### Publishing HTML demos

Add self-contained HTML files directly to `public/demos/` and merge into `main`.
`npm run build` first runs `scripts/build-demos.js`, which scans `.html`/`.htm` files,
sorts their filenames, and regenerates the ignored `demos/index.html`.
Vite bundles the generated list as an HTML entry, including hashed shared-header/i18n
assets, and copies the source demo exports unchanged to `dist/demos/`. Both existing
deploy workflows publish the output automatically. Removing or renaming a file updates
the next build's list.

The production list is <https://sansword.github.io/sans_bass/demos/>; a PR's list is
`https://sansword.github.io/sans_bass/pr-<N>/demos/`. All links are relative.
`npm run dev` also generates the list; restart it after changing the directory's entries.
Only files explicitly placed in `public/demos/` are demo publications; `examples/`
remains ignored. `index.html` is reserved for the generated list.

This follows `aitian`'s build-time content discovery pattern, emitting a static HTML
index rather than its JSON index and client-side rendering.

```bash
# Watch what CI is doing
gh run list --limit 5

# Publish main by hand (the workflow also accepts a manual dispatch)
gh workflow run deploy-main.yml --ref main

# Ask Pages what it last built
gh api repos/SansWord/sans_bass/pages/builds/latest --jq '{status, error}'

# Prove no audio is published, from the authoritative source
git ls-tree -r --name-only origin/gh-pages | grep -iE '\.(flac|m4a|wav|onnx)$' || echo clean
```

If the root ever serves the wrong thing, check `deploy-main` actually **succeeded** rather
than assuming it ran — a cancelled run reports no failure anywhere on the site.
