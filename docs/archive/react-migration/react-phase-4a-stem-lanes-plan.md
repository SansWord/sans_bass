# React migration Phase 4a — standard stem lane components plan

Status: planned from `7c968adad1e087346a677777bc718c0af05aa820` on 2026-09-07. Previous
accepted implementation rollback anchor: Phase 3e at
`41ff22cdfad6221164ea7105273b24d338251c95`; its documentation anchor merged through
[PR #78](https://github.com/SansWord/sans_bass/pull/78).

## Audit — current ownership

| Region / behavior | Owner today | Notes |
|---|---|---|
| Standard lane DOM (name/dot/txt/kbd, canvas, volume slider) | `app.js`'s `buildUI()` builds one `.lane` per track (mix/stems/unknown) with `innerHTML = ''` + `appendChild`, storing `t.canvas`, `t.nameEl`, `t.laneEl` on the track object. | Rebuilt from scratch on every song load; not currently rebuildable without recreating canvases. |
| Lane label/translation | `laneLabel(t)` at load time; `retranslate()` rewrites `t.nameEl`'s `.txt`/`title` on language change. | Recognized stems translate via `stem.<id>`; unknown lanes keep the filename-derived `t.label`, which must never be translated. |
| Lane mute toggle | A plain (non-focusable, no `role`/`tabindex`) `<div class="lane-name">` click calls `toggleTrack(t)`, which resolves `laneKey(t, index)` and dispatches `route(routingState, {type:'toggle', key})`, then `applyGains()` and `playerApplication.publish()`. | No keyboard access to lane mute today; the shared document keyboard owner covers 1–6/0 separately. |
| Lane mute *presentation* | `applyGains()` computes `on = !t.muted` (with the mix/stems mutual-exclusion override) and writes `t.laneEl.classList.toggle('muted', !on)` directly. | This is a DOM write into the region Phase 4a must hand to React. |
| Per-lane volume | A `<input type=range>` built in `buildUI()`; its `input` listener sets `t.volume` directly and calls `applyGains()`. No facade command exists. | |
| Waveform canvas | `t.canvas`, created in `buildUI()`, painted by `renderWave()`/`paint()`/`paintLaneGrid()`, which key off `canvas.__layers` and `tracks.some(t => t.canvas === canvas)`. | Drawing algorithms and peak generation are already DOM-independent of the canvas's owner. |
| Lane canvas seek | `attachSeek(canvas, { tempoLane })` wires pointerdown/move/up directly on the canvas to `playerApplication.commands.seek/previewSeek`, mirroring the already-React-owned primary seek canvas's own local pointer handling. | Out of scope: transport/seek ownership already lives at the application boundary; only the *host node* moves in Phase 4a, not this listener. |
| Drums-lane tempo hint | `buildUI()` appends a `.tempo-range-hint` child (caption + Clear button) only for the `drums` lane, wired to module-level `tempoRange`/`sansbass:temporange`. | Notes/tempo feature; explicitly deferred to Phase 6 (`Notes-specific renderer ownership remains explicit and deferred to Phase 6`). Must keep working, unmoved, while its host lane's *other* children move to React. |
| Notes ribbon lanes (vocals/bass) | `buildUI()` inserts one `.lane.ribbon` immediately after its anchor stem's lane via `el.lanes.insertBefore(lane, track.laneEl.nextSibling)`. | Deferred to Phase 6. Depends today on a live reference to the standard lane's DOM node, captured at construction time in the same synchronous pass. |
| Overview + zoomed pane | `buildUI()` inserts both at the very front of `#lanes` via `el.lanes.insertBefore(zLane, anchorTrack.laneEl)` / `insertBefore(oLane, zLane)` — i.e. always at the top, independent of standard-lane order. | Overview is Phase 4b's target; the zoomed pane (notes/chords/edit toolbar) stays Phase 6. |
| Resize | One throttled `window.resize` listener calls `renderAll()`, which re-measures every `t.canvas.clientWidth` and re-renders. | Unaffected by DOM ownership as long as `t.canvas` stays populated. |
| Snapshot | `applicationSnapshot()` already publishes `song.tracks[]` with `{ id, stem, name, label }` (added in Phase 3e for the mode dropdown). | Needs `muted` (effective, post mix-exclusion) and `volume` added. |

## The lane-interleaving problem and its resolution

Ribbon lanes are inserted as direct siblings of specific standard lanes inside the *same*
`#lanes` parent, using a live DOM reference captured when that standard lane was built. If
React becomes the exclusive renderer of standard lanes into `#lanes` (via a portal), legacy
code inserting foreign sibling nodes into that same portal target is exactly the "two owners
of one DOM region" hazard `react-migration.md` prohibits, and risks React's reconciler
computing the wrong sibling to move/replace on the next re-render (locale change, song
replacement).

Resolution: give React and `app.js` **separate** parent elements for their respective lane
children (`#standard-lanes-root` for React's portal, `#note-lanes-root` for `app.js`'s ribbon/
zoom/overview elements), both children of the existing `#lanes` flex column with
`display: contents` so neither wrapper itself becomes a flex item — their *children* become
direct flex participants of `#lanes`. Visual order is then recovered with plain `order` CSS,
computed independently on each side from the identical, already-shared track order (no DOM
querying, no cross-owner node references):

- React sets `order: <2 * trackIndex>` on each standard lane.
- `app.js` sets `order: <2 * trackIndex + 1>` on a stem's ribbon lane (`trackIndex` found the
  same way `laneKey`/`anchorTrack` already resolve it), and a fixed very-negative `order` on
  the overview/zoomed-pane lanes to keep them pinned above everything, matching today.

This removes every remaining need for `track.laneEl` as a cross-owner positioning handle.

## Bounded outcome (Phase 4a)

`components/PlayerShell.jsx` gains a `StemLanes` component that renders one `<Lane>` per
`song.tracks[]` entry (mix, recognized stems, and unknown lanes — every track, in existing
order) as a portal into a new `#standard-lanes-root` inside `#lanes`. Each `<Lane>` owns:

- the translated/unknown label, dot color, and `kbd` hint (1–9,0 for the first ten tracks,
  matching current `(i+1)%10` labelling exactly);
- a real `<button type="button" class="lane-name">` (upgraded from today's non-focusable
  `<div>`) so lane mute is keyboard-operable, blurring after activation like every other
  React control in this shell;
- the `.muted` class, read directly from the snapshot's per-track `muted` field — no more
  direct `classList` write from `app.js`;
- the per-lane volume `<input type=range>`, calling a new `setTrackVolume(trackId, value)`
  command;
- a stable `<canvas class="wave">` host, attached via a new `attachLaneCanvas(trackId, canvas)`
  facade method (the same explicit attach/detach shape as `attachPrimarySeekCanvas`) so
  `app.js` keeps sole authority over peak generation and painting.

`lib/player-application.js` adds exactly two commands (`setTrackVolume`, `toggleTrack` — the
existing `toggleTrack(t)` internal function gets an id-keyed wrapper since React addresses
lanes by stable id, never by object reference or DOM node) and one attach method
(`attachLaneCanvas`). `applicationSnapshot()`'s `song.tracks[]` items gain `muted` (the same
effective boolean `applyGains()` already computes, factored into a shared helper so there is
exactly one computation) and `volume`.

`app.js` retains: decoded tracks, `routingState` and all transitions, gain smoothing and the
mix/stems exclusion rule, peak generation, waveform painting, canvas resize, lane-canvas seek
(`attachSeek`), the drums tempo hint, ribbon/zoom/overview construction (Phase 6/4b), and the
document keyboard owner (0, 1–6 keep working unchanged, dispatching through the same internal
`toggleTrack`/`toggleAllTracks` functions the new commands also call). `retranslate()` drops
its now-dead standard-lane block (`t.nameEl`/`laneLabel` rewrite) — React re-renders lane text
from `useLocale()` the same way `ModeRoutingControls` already does.

## Preservation rules

| Concern | Required behavior |
|---|---|
| Order and identity | Visual order and `laneKey`-derived ids are unchanged; unknown lanes keep filename-derived labels untranslated. |
| Mute/gain authority | Gain ramps, the mix/stems mutual-exclusion rule, and analytics (`gcBump('toggle')`, `gcOnce('toggle-<stem>')`) stay exactly as computed today; React only reflects the result. |
| Per-lane volume | Stays independent of mute state; bounds/step (`0`–`1.5`, `0.01`) unchanged. |
| Keyboard | 0 and 1–6 keep working through the same shared document owner; the new lane-name button excludes itself from that owner the same way other focusable React controls already do, and blurs after activation. |
| Canvas identity/drawing | Canvas nodes stay stable across locale change and unrelated re-renders (attach only re-runs when the lane's id/application changes); painted pixels, peak scaling, and resize behavior are bit-for-bit unchanged. |
| Ribbon/overview/zoom | Keep rendering in their current visual position via the `order` scheme above; their content, gating, and behavior are untouched — this is not Phase 6 or 4b work. |
| Locale/remount/replacement | Language switch re-renders lane text without touching audio; shell unmount/remount does not duplicate listeners or restart audio; song replacement rebuilds lanes with fresh ids and resets mute/volume to defaults, matching current `buildTracks()` behavior. |

## Failing-first and implementation increments

1. Add facade-level Node tests for `setTrackVolume`/`toggleTrack` validation and the new
   snapshot fields; add production-entry Chromium assertions for one React lane owner,
   translated/unknown labels, keyboard-operable mute with focus restoration, per-lane volume
   independent of mute, canvas identity/paint across locale and remount, stable visual order
   including the drums tempo hint and a ribbon lane, resize, and 0/1–6 regression. Run against
   the current legacy owner and record the expected failures (missing commands/snapshot
   fields, no React lane owner, non-focusable lane-name).
2. Add `setTrackVolume`, `toggleTrack`, `attachLaneCanvas` to `lib/player-application.js` and
   extend `applicationSnapshot()`; factor the effective-mute computation out of `applyGains()`
   into a shared helper.
3. Add `#standard-lanes-root`/`#note-lanes-root` hosts (both `display: contents`) inside
   `#lanes` in `index.html`; add the `StemLanes`/`Lane` components to `PlayerShell.jsx`.
4. Point `app.js`'s ribbon/overview/zoom construction at the `order`-based positioning scheme
   instead of `track.laneEl`/`insertBefore`; remove the standard-lane DOM construction from
   `buildUI()`, the `applyGains()` lane classList write, and `retranslate()`'s standard-lane
   block. Delete `t.nameEl`/`t.laneEl` from the track shape (superseded by `attachLaneCanvas`
   and the snapshot's `muted` field).
5. Run focused tests, then `npm test`, `npm run build`, `git diff --check`, and an exact-source
   local production smoke at root and a nested route before opening the PR.

## Implementation addendum: the drums tempo hint

The audit above assumed the drums lane's `.tempo-range-hint` could move wholesale into
`#note-lanes-root` beside the ribbon/zoom/overview lanes. It cannot: the hint's CSS
(`grid-column: 1/-1`) is written to span *its own lane's* grid, i.e. it must stay a DOM child
of that one drums `<Lane>`, which is React-owned. Implemented instead as a third explicit
attach hook, `attachLaneExtra(trackId, node)`, mirroring `attachLaneCanvas`: `<Lane>` renders
an empty `.tempo-range-hint` host div only for the drums track and hands it to `app.js` via
`useLayoutEffect`; `app.js` populates it with the same caption/Clear-button content it used to
build inline in `buildUI()`. This keeps the "React owns the stable host, `app.js` owns its
content" split consistent with the canvas case, and needs no `order` value of its own since
it is a normal child of the drums lane rather than a lane-level sibling.

## Phase 4b (separate increment, not started by this plan)

Shared overview integration: move the Overview lane's label, volume-mirroring slider, and
canvas host to React inside the same `order`-based scheme, keeping `app.js` authoritative for
which stems it combines (`overviewStems()`), its peak combination, and its painting. The
zoomed pane, notes chips, tempo hint, and chord editor remain explicitly deferred to Phase 6
and are not touched by 4a or 4b.
