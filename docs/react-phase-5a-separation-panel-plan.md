# React migration Phase 5a — separation panel controls plan

Status: planned from `28b026a...` (documentation-anchor merge for Phase 4b, PR #82) on
2026-09-07. Previous accepted implementation rollback anchor: Phase 4b at
`d961db76a8404a2aef1f544dfe9f9746a397aa74`, documented through
[PR #81](https://github.com/SansWord/sans_bass/pull/81) and anchored through
[PR #82](https://github.com/SansWord/sans_bass/pull/82).

Detection controls (`notes.js`) are explicitly out of scope — `docs/react-migration.md`'s
Phase 5 increment boundary calls out the separation panel and detection controls as separate
PR-sized slices, and this plan covers separation only.

## Audit — current ownership

| Region / behavior | Owner today | Notes |
|---|---|---|
| Panel DOM (`#sep`, handheld explanation, go/status row, progress bar, save/cancel row) | `separate.js` writes every field of a module-level `el = { panel, go, save, cancel, status, bar, fill, handheld }` map, populated once from `document.getElementById(...)` at module init. | The whole `<section id="sep">` subtree in `index.html` is a single DOM region with one legacy owner; no other module touches it. |
| Panel/control visibility and disabled state | `renderControls(singleTrack)` calls the already-pure, already-tested `separationView({ state, singleTrack, handheld })` from `lib/separation-state.js` and writes the five booleans onto `el.*.hidden`/`el.*.disabled`. | `separationView()` needs no changes — Phase 4a/4b established the pattern of reusing an existing pure derivation unchanged; only its DOM-writing caller moves. |
| Progress bar | `setProgress(frac)` toggles `el.bar.hidden` and writes `el.fill.style.width` from a `0..1` fraction or `null`. | Purely derived from the last `progress`/`download` Worker message; no new state needed beyond storing the fraction. |
| Status line | `status(key, params)` stores `lastStatus = {key, params}` and translates it immediately via `SansI18n.t()`, writing `el.status.textContent`. A `sansbass:langchange` listener (`retranslateStatus`) re-translates the stored key/params so a language switch mid-run doesn't freeze the line. | Storing raw `{key, params}` and translating at **render** time (like `Status` in `PlayerShell.jsx` already does with `snapshot.status`) makes the explicit `langchange` listener unnecessary — React's own `useLocale()` re-render already covers it, the same ownership-transfer side effect Phase 4b got for the Overview label. One param occasionally carries a translated-string **thunk** (`w.onerror`'s `{ msg: err.message \|\| (() => tr('sep.oom')) }`), so whatever resolves params for rendering must call function-valued params at render time, not at publish time — resolving eagerly would reproduce the same stuck-string bug this phase is fixing for the plain-string case. |
| Handheld explanation | `HANDHELD = SansPlatform.isHandheld()` read once at module init; `el.handheld.hidden = false` set once, also at module init, only when `HANDHELD` is true — never toggled again. | A static fact for the page's lifetime, exactly like `PlayerShell.jsx`'s own already-existing `const HANDHELD = isHandheld();` used for the drop-zone explanation. No new command or snapshot field: the React panel can read the same fact from its own store snapshot. |
| Start / cancel / save actions | Three `el.*.addEventListener('click', ...)` handlers: `go` builds the Worker, posts the `separate` message, and gates a `confirm()` dialog for long tracks; `cancel` posts `{type:'cancel'}`; `save` encodes stems to WAV/ZIP and triggers a download. | Becomes an exported `commands: { start, cancel, save }` object — the click handlers move to component `onClick`s, which is exactly what Phase 3's `PlaybackButton`/`MasterVolume`/etc. already do for `application.commands.*`. `confirm()` stays synchronous inside `start()`, called from a real click, preserving trusted-gesture semantics the same way `PlaybackButton` already relies on for `togglePlayback()`. |
| Song-token invalidation / reset | `refresh(snapshot)`, subscribed to `playerApplication.subscribe`, resets the Worker/phase whenever loading starts or the current song token changes (a new song arrived while separation was pending). | Unaffected — stays inside `separate.js`, still driven by `playerApplication.subscribe`/`isCurrentSongToken`. Only its final step (`renderControls`) changes from a DOM write to a snapshot publish. |
| Single-track / stems-loaded distinction | `window.sansBass.isSingleTrack()` (a temporary bridge method on `app.js`'s `window.sansBass`, already used by `separate.js` today). | Out of scope to replace: it is the same already-accepted temporary bridge `separate.js` already depends on for `currentMix()`/`isSingleTrack()`; Phase 5a does not need it removed to give React ownership of *presentation*. It is **not** derivable from `playerApplication`'s own snapshot without duplicating logic (`song.tracks.length === 1` would be an equivalent read of already-public snapshot data, but changing the read site to a different already-temporary bridge is not required for this slice's outcome and would be incidental scope). |
| Six-lane replacement / stems save | `playerApplication.commands.replaceSong` (Phase 2), `lib/wav.js`'s `encodeWav`, `lib/zip.js`'s `buildZip`. | Unchanged; not presentation. |
| Worker message protocol, model/session, segment planning | `separate.worker.js`, `lib/overlap.js`. | Unchanged; explicitly out of scope per `react-migration.md`. |

## Decision: extend `separate.js`'s own export surface, not `lib/player-application.js`

The task's open question was whether this phase needs new facade commands/snapshot fields on
`lib/player-application.js`, or whether `separate.js` can stay a peer service invoked directly
by a React panel, the way `notes.js` is invoked from legacy DOM today.

Separation phase/progress/status is not player/song/transport state — it is `separate.js`'s
own feature state, exactly as isolated today as `notes.js`'s detection state. Nothing in the
migrated presentation needs a *new* fact from `playerApplication` that isn't already reachable
through the existing temporary `window.sansBass` bridge `separate.js` already uses. No new
`lib/player-application.js` commands or `applicationSnapshot()` fields are added.

Instead, `separate.js` gains a small subscribe/snapshot/commands surface of its own — the same
shape `lib/player-application.js` already established (`subscribe`, `getSnapshot`, `commands`),
scoped to separation only:

```js
export const separation = {
  subscribe(listener) { ... },   // returns an unsubscribe function
  getSnapshot() { ... },         // returns the last published immutable view
  commands: { start, cancel, save },
};
```

This mirrors how `playerApplication` is consumed by `PlayerShell.jsx`, but is a second,
independent store — matching the architecture rule that each application state value has one
authoritative owner, and separation state's owner remains `separate.js`. `separate.js` stays
loaded as its own `<script type="module" src="separate.js">` entry in `index.html` (unchanged);
`components/SeparationPanel.jsx` additionally imports its exports directly, the same pattern
already established for `app.js` and every `lib/*.js` file being both a script-tag entry and an
import target (see `CLAUDE.md`'s ESM-modules rule and the v1.21.0/v1.21.1 devlog entries) —
verified not to double-evaluate by the local build smoke in this plan's last step.

The published snapshot shape:

```js
{
  panel, go, cancel, save, goDisabled, saveDisabled,   // separationView()'s existing booleans
  handheld,                                            // static per-page-load fact
  progress,                                            // 0..1 fraction, or null (bar hidden)
  status,                                              // { key, params } or null, untranslated
}
```

`lib/separation-state.js` gains one more small pure export, `resolveStatusParams(params)` —
the existing `resolve()` helper lifted out of `separate.js` unchanged (resolves function-valued
params by calling them, passes everything else through) — so the React panel can call it at
render time without duplicating the thunk-resolution rule, and so it is unit-tested alongside
`separationView()` rather than only exercised indirectly.

## Bounded outcome (Phase 5a)

A new `components/SeparationPanel.jsx` owns the entire `#sep` subtree: the handheld
explanation, the Go button and status line, the progress bar, and the Save/Cancel row. It
subscribes to `separate.js`'s new `separation` store with `useSyncExternalStore` (the same
hook every other React-owned control already uses for `playerApplication`) and to
`useLocale()` for retranslation. It renders using the **same element ids** the legacy markup
used (`sep-go`, `sep-status`, `sep-bar`, `sep-fill`, `sep-save`, `sep-cancel`, `sep-handheld`)
and the same classes (`sep`, `sep-row`, `sep-bar`), so `styles.css` (class-selector only, no
id selectors) and the existing Chromium assertions in `tests/player.test.js` that reference
these ids keep working unmodified as regression proof.

`index.html` replaces the entire `<section id="sep" class="sep" hidden>...</section>` block
with `<div id="separation-ui-root" class="react-portal-host"></div>`, matching the existing
`*-ui-root` portal-host convention. `components/PlayerShell.jsx` adds `separation` to its
`hosts` map and portals `<SeparationPanel />` into it, always mounted (not conditionally
gated by `snapshot.song`) — exactly like the legacy code, panel visibility is already fully
data-driven by `separationView()`'s own `panel` boolean (`singleTrack || state === 'success'`),
so no wrapping condition is needed in `PlayerShell`.

`separate.js` keeps: `HANDHELD` detection, the Worker lifecycle (`getWorker`, `onmessage`/
`onerror` handling), analytics tracking, the `confirm()` long-track guard, WAV/ZIP encoding
for save, and the `playerApplication.subscribe(refresh)`/`registerCleanup` wiring for
song-token invalidation. It loses: the `el` DOM-element map, every direct DOM write
(`renderControls`, `setProgress`, `status`'s `textContent` write), and the `sansbass:langchange`
listener (superseded by React's own locale-driven re-render, matching Phase 4b's Overview-label
fix).

## Preservation rules

| Concern | Required behavior |
|---|---|
| Panel visibility | Shown exactly when `singleTrack \|\| phase === 'success'`, identical to `separationView()`'s existing `panel` boolean — unchanged input, only the DOM write moves. |
| Handheld explanation | Visible only when the device is classified handheld at page load, matching today's one-time `el.handheld.hidden = false`; controls stay disabled/hidden per `separationView({handheld: true})`. |
| Progress bar | Hidden exactly when the last known fraction is `null`; width tracks `Math.round(frac * 100)}%` identically. |
| Status text | Same translated string content as today at every point in the state machine (loadingModel, downloading, gpu/cpu, progress, workerFailed/oom, cancelled/cancelling, failed, encoding, saved, saveFailed) — plus the fix that a language switch mid-run now always re-translates correctly (today's explicit listener already covers the plain-string cases; this phase's render-time resolution additionally keeps the `workerFailed`/oom thunk case correct, which was already handled by the existing listener re-invoking the thunk, so this is parity, not a new fix). |
| Go / Cancel / Save behavior | Identical click semantics: `confirm()` gate for >8 minute tracks, Worker creation/posting, cancel posts `{type:'cancel'}`, save encodes/downloads a ZIP and disables itself mid-encode. |
| Six-lane replacement | Unchanged: `playerApplication.commands.replaceSong` still fires from the Worker's `result` message exactly as today, still after `runToken` is cleared so the result is treated as complete before song identity advances. |
| Stale results | A Worker whose song token no longer matches, or a new `load` in progress, still resets `worker`/`phase`/`lastStems` exactly as today; the panel reflects the reset via the same `refresh()` → publish path. |
| Locale | The status line, "Separate into 6 stems"/"Save stems"/"Cancel" labels, and the handheld explanation all retranslate correctly on a language switch, sourced from `t()` at render time like every other React-owned control. |
| Remount | Shell unmount/remount does not restart the Worker, lose `lastStems`, or duplicate the `playerApplication` subscription — `separate.js`'s own subscription lifecycle is independent of `PlayerShell.jsx`'s mount state, matching every other React-owned control's separation from application lifetime. |
| No double Worker/module evaluation | `separate.js` remains a single module instance whether reached via its `<script type="module">` tag or via `SeparationPanel.jsx`'s import — verified by the local build smoke (one `getWorker()` call site, one Worker instance per separation run, no duplicate `[separate]` console logs). |

## Failing-first and implementation increments

1. Add a focused Node test for `resolveStatusParams` in `tests/separation-state.test.js`
   (passes through plain values, calls function-valued params, leaves `null`/`undefined`
   untouched) — pure, alongside the existing `separationView` cases.
2. Extend the focused production-entry Chromium suite (`tests/player.test.js`) with cases run
   against the **current legacy owner** first, to record expected failures, then made to pass
   by the implementation below:
   - a fake-Worker run whose language is switched mid-`sep.progress` status correctly
     retranslates the status line (proving render-time resolution, not the old listener);
   - the handheld explanation and disabled controls render correctly when `isHandheld()` is
     stubbed true, using a synthetic single-track load;
   - cancel and worker-failure (`onerror`) paths show the correct status/controls and recover
     to a usable idle state on the next `sep-go` click;
   - a second song loading while separation is pending resets the panel to idle without a
     stale progress bar or status line (already covered implicitly by the existing "ignores
     stale notes and separation Worker results" test — extend its assertions to also check
     panel/status DOM rather than only the six-lane/dispose behavior it already checks).
   - The two pre-existing separation cases (`drives separation running and success controls
     through a deterministic fake Worker`, and the stale-results case) must keep passing
     unmodified against the new ids/markup — they are the main regression proof for this
     slice, matching Phase 4a/4b's practice of extending rather than replacing existing
     assertions.
3. Add `resolveStatusParams` to `lib/separation-state.js`.
4. Refactor `separate.js`: remove the `el` map and every direct DOM write; add the module-
   scoped `progress`/`lastStatus` state, the `publish(singleTrack?)` function that recomputes
   the full snapshot via `separationView()` and notifies subscribers, and export the
   `separation` object (`subscribe`, `getSnapshot`, `commands: { start, cancel, save }`).
   Delete the `sansbass:langchange` listener and its cleanup line.
5. Add `components/SeparationPanel.jsx`.
6. Update `index.html` (replace `#sep`'s markup with `#separation-ui-root`) and
   `components/PlayerShell.jsx` (add the `separation` host, portal `<SeparationPanel />`).
7. Run focused tests, then `npm test`, `npm run build`, `git diff --check`, and an exact-source
   local production smoke at root and a nested route (a generated stems ZIP for the
   loaded-song precondition, a faked Worker for the separation flow itself, since the real
   model is never downloaded in routine verification) before opening the PR.

## Out of scope

Notes/detection controls (`notes.js`), the zoomed pane, tempo/chord controls, and the
`window.sansBass` bridge's `currentMix`/`isSingleTrack`/`stemBuffer` members stay untouched and
deferred — the first three to Phase 6 per `react-migration.md`'s own increment boundary, the
bridge because narrowing it further is not needed to give React ownership of separation
*presentation*. Real-Worker/model smoke and physical-handheld evidence remain separate,
deployment-and-release-level checks per `docs/testing.md` and `docs/behaviour.md`, not routine
test dependencies for this slice.
