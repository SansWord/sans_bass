# React migration Phase 4b — shared overview integration plan

Status: planned from `5f6bf62a9d33301ba6b630ae44238fd765eb91a9` on 2026-09-07. Previous accepted
implementation rollback anchor: Phase 4a at `fcf27706c77267e269203b62fd40eae86be03380`; its
documentation anchor merged through
[PR #80](https://github.com/SansWord/sans_bass/pull/80).

## Audit — current ownership

| Region / behavior | Owner today | Notes |
|---|---|---|
| Overview lane DOM (name/time-code, canvas, range-hint, volume slider) | `app.js`'s `buildUI()`, inside `if (anchorTrack)` (only when a `vocals`/`bass` stem exists), builds one `.lane.overview` and appends it to `el.noteLanesRoot` with `order: '-2'`. | Rebuilt from scratch only when `anchorTrack` toggles into existence for a given `buildUI()` call; `el.noteLanesRoot.innerHTML = ''` at the top of every `buildUI()` call destroys and rebuilds it on **every** song load, including replacements that keep a vocals/bass stem. |
| Label | `oTxt.textContent = tr('notes.overview')` built once at construction time. | **Pre-existing bug, confirmed in the Phase 4a evidence log:** `retranslate()` never touches `oTxt` (or `oCanvas.title`/`oSlider.title`), so the Overview lane's label and tooltips stay stuck in whatever language was active when the current song loaded. Moving the label to React fixes this as a side effect of ownership transfer, matching how every other React-owned label already re-renders through `useLocale()`. |
| Time-code readout | `oTime.textContent` is written every `draw()` call (rAF-driven) with the same `timeCode` string also used by the zoomed pane (`` `${fmtCs(t)}/${fmt(duration)} · ${speedTag}` `` plus optional BPM). | Fully derivable from the already-published transport snapshot (`position`, `duration`, `playbackRate`, `tempoBpm`) — `PrimarySeekControls` already computes an equivalent string this way. No attach hook is needed; this becomes ordinary reactive React text, self-subscribed to `application.subscribeTransport`. |
| Master-volume-mirroring slider | A plain `<input type=range>` whose `input` listener calls `commands.setMasterVolume` directly; `setMasterVolume()` in `app.js` writes `overviewVolEl.value` by hand so the two sliders (primary + overview) stay in sync in both directions. | `snapshot.masterVolume` and `commands.setMasterVolume` already exist (Phase 3d) and already drive the React-owned primary `MasterVolume` control. The overview slider needs no new command or snapshot field — it becomes a second React consumer of the same state, exactly like the primary control. `overviewVolEl` and its manual DOM write are deleted entirely, not replaced. |
| Waveform canvas | `oCanvas`, created in `buildUI()`, painted by `renderOverview()`/`paint()`/`paintRangeBand()`, which key off the module-level `overviewEl.canvas`. `overviewStems()` decides which stems' peaks it combines, driven by the zoomed pane's lane-chip selection (`zoomLaneSel`/`zoomNotesStem`) — state that can change without any song reload. | Painting stays fully imperative and app.js-triggered (existing calls to `renderOverview()` after `zoomLaneSel`/`zoomNotesStem` change are untouched). **No new snapshot field is needed for `overviewStems()`**: React never re-renders based on which stems are combined, only the DOM host's mount/unmount state (whether `anchorTrack` exists) matters to React, and that is already derivable from `song.tracks[]`. |
| Canvas seek/scrub | `attachSeek(oCanvas, { rangeBand: true, overview: true })`, wired once at construction. | Self-contained; reads module-level state (`duration`, `tracks`, `editMode`, `zoomNotesStem`) at call time, not anything closed over from `buildUI()`. Safe to call from a standalone attach function. |
| Range-hint caption | `oRangeHint` — a `.note-range-hint` div, `grid-column: 1 / -1` inside the lane's own grid (so it cannot live as a sibling in `#note-lanes-root`), text set once (`tr('notes.rangeTip')`, never retranslated — an existing, separate gap that stays deferred), visibility toggled by `syncRangeHints()` based on `editMode`/`zoomNotesStem` (Phase 6 state, not published). | Exactly the same shape as Phase 4a's drums tempo-hint: Phase-6 content nested inside a lane whose *other* children are moving to React. Needs the same explicit-host pattern (`attachLaneExtra`), scoped to the overview instead of a track id. |
| Render/seek condition | Overview lane (and the zoomed pane) is only built `if (anchorTrack)` — i.e. only once the song has a `vocals` or `bass` stem (matches `NOTE_STEMS`). | `Lane` already hardcodes a stem-name check for its own presentational purposes (`isDrums = track.stem === 'drums'`). The Overview host's render gate becomes an equivalent hardcoded check in React (`tracks.some(t => t.stem === 'vocals' \|\| t.stem === 'bass')`), consistent with that existing precedent — no new snapshot field. |
| Resize | The existing throttled `window.resize` → `renderAll()` → `renderOverview()` path. | Unaffected by DOM ownership as long as `overviewEl.canvas` stays populated (see the lifecycle finding below). |

## The persistence-across-song-load problem and its resolution

This is the audit finding the task specifically asked to confirm or refute.

Standard lanes (Phase 4a) reset their canvas reference implicitly: `buildTracks()` allocates a
**fresh track object** with `canvas: null` for every song load, and relies on React calling
`attachLaneCanvas` again to repopulate it. That repopulation only actually happens when React
mounts a *new* `<Lane>` instance — which, for a track whose `laneKey` (its React `key`) is
unchanged across the reload (the common case: the same recognized stem name), it will not.
Standard lanes get away with this today because nothing in the current suite exercises
same-key-across-replacement; it is a latent question for Phase 4a's own scope, not this one, and
is not touched here.

The Overview lane cannot rely on the same accident. It is a **single, unkeyed** component, not
one list item among many — whenever a reloaded song still has a `vocals`/`bass` stem (the
common case), React has no reason to unmount and remount it at all, so its `canvas` DOM node
persists across the reload by construction. If `app.js` kept unconditionally resetting a
module-level `overviewEl = null` on every `buildUI()` call (mirroring the old code, where the
reset was safe because the *entire* DOM subtree was about to be torn down and rebuilt
synchronously in the same call), the canvas reference would go stale after the **first** song
load and never come back — `renderOverview()`/`draw()`'s `if (!overviewEl) return` guard would
silently stop painting the Overview lane on every subsequent song, without React ever knowing
anything is wrong, since it never re-runs `attachOverviewCanvas`.

Resolution: `overviewEl`'s lifecycle moves from "reset at the top of every `buildUI()` call" to
"owned entirely by the attach/detach hooks, tied to the React host's actual mount/unmount".
`overviewEl` becomes a small persistent object (`{ canvas: null, rangeHint: null }`) that
`attachOverviewCanvas`/`attachOverviewExtra` populate on attach and clear (their own field only)
on detach; `buildUI()` no longer touches it at all. Because `tracks` (and therefore
`overviewStems()`) is already reassigned synchronously before `renderAll()`/`renderOverview()`
run inside the same song-load call, the persisted canvas reference repaints correctly with the
new song's peaks without needing any React round-trip — exactly the steady-state behavior
`renderOverview()` already relies on for chip-selection-driven repaints today. When the anchor
stem genuinely disappears (or the app disposes), React unmounts the host, the attach hooks'
cleanups fire, and `overviewEl`'s fields clear — matching the old "no anchor → no overview"
state exactly.

## Bounded outcome (Phase 4b)

`components/PlayerShell.jsx` gains an `OverviewLane` component, rendered (via `createPortal`
into the existing `#standard-lanes-root`, alongside `StemLanes`) only when
`snapshot.song.tracks` contains a `vocals` or `bass` stem, with a fixed `style={{ order: -2 }}`
matching today's pinned position above the zoomed pane. It owns:

- the translated label (`t('notes.overview')`) and tooltip texts (`t('notes.overviewTip')` on
  the canvas, `t('ctl.volume')` on the slider) — all newly reactive to locale changes, fixing
  the pre-existing stuck-language defect noted above;
- a live time-code readout, self-subscribed to `application.subscribeTransport` the same way
  `PrimarySeekControls` already is, computing the identical string `app.js`'s `draw()` used to
  write by hand;
- the master-volume-mirroring slider, reading `snapshot.masterVolume` and calling the existing
  `commands.setMasterVolume` — no new command;
- a stable `<canvas class="wave">` host, attached via a new `attachOverviewCanvas(canvas)`
  facade method (mirrors `attachLaneCanvas`'s shape, without a track id since the overview is
  not one track);
- an empty `.note-range-hint` host, attached via a new `attachOverviewExtra(node)` facade method
  (mirrors `attachLaneExtra`), so `app.js` keeps sole authority over its Phase-6 content and
  visibility.

`lib/player-application.js` adds exactly two attach methods (`attachOverviewCanvas`,
`attachOverviewExtra`), each a thin delegation to the owner exactly like the existing four.
No new commands and no new `applicationSnapshot()`/transport fields are needed — see the audit
above for why.

`app.js` retains: `overviewStems()`, peak combination, painting (`renderOverview()`, `paint()`,
`paintRangeBand()`), canvas seek/scrub (`attachSeek`), and the range-hint's Phase-6 content and
visibility (`syncRangeHints()`, unchanged). It loses the Overview lane's DOM construction block,
`overviewVolEl` and its manual mirroring write, and the `overviewEl = null` reset in `buildUI()`
(superseded by the attach/detach lifecycle above). `retranslate()` already does not touch the
Overview lane (per the pre-existing gap noted above), so it needs no change.

## Preservation rules

| Concern | Required behavior |
|---|---|
| Render gate | The Overview lane (and its host structure) appears only when a `vocals`/`bass` stem exists, exactly matching today's `anchorTrack` gate. |
| Order/position | Pinned above the zoomed pane via `order: -2`, computed the same way as before, now set directly by React instead of read from a legacy element. |
| Volume | Both sliders stay on one smoothed gain value in both directions; bounds/step (`0`–`1.5`, `0.01`) unchanged; independent of every routing/lane-mute value, matching today. |
| Canvas identity/painting | The canvas node stays stable across locale change, unrelated re-renders, and — the new guarantee this phase adds — song replacement that keeps a vocals/bass stem; painted pixels, peak scaling, and resize behavior stay bit-for-bit unchanged. Seek/scrub (`attachSeek`) keeps working identically, including its overview-specific range-drag gating. |
| Range hint | Content, translation-refresh behavior (unchanged, still not retranslated — explicitly deferred, not fixed by this phase), and visibility gating by `editMode`/`zoomNotesStem` stay exactly as `app.js` computes them today; only its DOM host moves. |
| Locale | The label and both tooltips now retranslate correctly (a fix, not a regression) since they are React-rendered like every other React-owned control. |
| Remount/replacement | Shell unmount/remount does not duplicate listeners or restart audio, matching every other React-owned control. Song replacement that keeps a vocals/bass stem repaints the same canvas node with the new song's peaks (see the lifecycle finding above); a replacement that removes the last vocals/bass stem unmounts the host and clears `overviewEl` cleanly; a replacement that (re)introduces one mounts fresh. |
| Zoomed pane | Untouched — stays entirely `app.js`-owned, still docked via its own `order: -1`, still deferred to Phase 6. |

## Failing-first and implementation increments

1. Add a focused Node facade test for `attachOverviewCanvas`/`attachOverviewExtra` (attach
   returns a cleanup, detach clears state, disposed/uninitialized application no-ops — same
   shape as the existing `attachLaneCanvas`/`attachLaneExtra` cases). Add focused
   production-entry Chromium assertions: one React-owned Overview lane with a translated label
   that actually retranslates on language switch, a volume slider that mirrors the primary
   control in both directions, canvas identity stable across locale change *and* across a song
   replacement that keeps a vocals/bass stem (the new case this phase must prove — verify via
   `canvas.__layers` identity changing while the canvas node itself does not), the range-hint
   host present at the correct grid position, and the existing lane-order assertion extended if
   needed. Run against the current legacy owner and record the expected failures.
2. Add `attachOverviewCanvas`, `attachOverviewExtra` to `lib/player-application.js` (thin
   delegation, matching the existing four attach/command delegators).
3. Add `attachOverviewCanvas`/`attachOverviewExtra` to `app.js`; change `overviewEl` from a
   nullable `{ lane, canvas, time, rangeHint }` set once in `buildUI()` to a persistent
   `{ canvas, rangeHint }` object owned by the two new functions; delete `overviewVolEl` and its
   read/write sites; delete the `overviewEl = null` / `overviewVolEl = null` resets in
   `buildUI()`; delete the Overview lane's DOM-construction block from `buildUI()`; update the
   `renderOverview()`/`draw()`/`paintRangeBand()`/`syncRangeHints()` guards from `if
   (overviewEl)` to `if (overviewEl.canvas)` / `if (overviewEl.rangeHint)` as appropriate.
4. Add the `OverviewLane` component to `PlayerShell.jsx`, portalled into `#standard-lanes-root`
   alongside `StemLanes`, gated on a vocals/bass stem being present in `snapshot.song.tracks`.
5. Run focused tests, then `npm test`, `npm run build`, `git diff --check`, and an exact-source
   local production smoke at root and a nested route before opening the PR.

## Out of scope

The zoomed pane (notes chips, tempo hint, chord editor, edit toolbar) and the range hint's
translation-refresh gap stay untouched and deferred to Phase 6, per `react-migration.md`'s
Phase 4 increment boundary. Ribbon lanes and their own per-stem range hints are unaffected.
