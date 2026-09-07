# React migration Phase 3e — mode and routing controls plan

Status: implementation committed at
`385e8ab38e982988a4c19d14e5a5428d7c52200c`; review and deployment acceptance pending.
Planned from `82b6ac3f5897e34204c3549dd7506b863f7dbe61` on 2026-09-06. Previous
accepted implementation rollback anchor: Phase 3d at
`4b14667a935f1faef4af1f8ba8df8acb37d6ab5f`; its separate documentation anchor
merged through [PR #76](https://github.com/SansWord/sans_bass/pull/76).

## Delta ownership audit

| Region / behavior | Owner at plan source | Phase 3e boundary |
|---|---|---|
| Top-level Play mode selector | `index.html` authors the label/select; `app.js` builds translated options, writes selection, listens for changes, and reads the select back in `applyGains()`. | React authors translated markup/options, accessibility, focus restoration, and the direct change listener. Stable option values and authoritative selection come from the application snapshot. `app.js` no longer reads React DOM to decide gain. |
| Top-level all-toggle | `index.html` authors the button; `app.js` writes its three-state translated label and owns the direct listener. | React renders the authoritative next-action label and owns the click listener/focus restoration. `app.js` retains the routing transition and analytics. |
| Routing and audio | `routingState` and track mute values live in `app.js`; `lib/routing-state.js` owns pure transitions; `applyGains()` owns smoothing, lane classes, and mix/stem exclusion. | Retain all algorithms and audio authority. Publish only the mode and stable all-toggle label suffix, plus the existing song-track projection needed to derive options. |
| Other routing entry points | The shared document owner handles 0 and 1–6; legacy lane-name clicks call the same internal transitions. | Retain both entry points and publish their results so React stays synchronized. No lane DOM migrates. |
| Accepted Phase 3a–3d controls | React owns header/loading, playback/speed, seek/time, master volume, and A/B presentation. | Retain and cover with lightweight volume/loop regression. |
| Lanes, overview/zoom, separation, detection, notes, Workers, AudioWorklets, drawing, and DSP | Legacy/application modules. | Retain for Phase 4 and later. |

## Bounded outcome

Give React sole ownership of the top-level Play label/select and all-toggle button inside the
existing `PlayerShell`. Extend `playerApplication` only with `setMode(mode)` and
`toggleAllTracks()`. Publish the smallest authoritative routing projection:
`{ mode, allToggleLabel }`; add the source display label to each existing song-track item so
React can translate known stems and preserve filename-derived unknown-lane labels without
using presentation text as an identity.

Do not move `routingState` or duplicate it in React. Do not migrate lane-name toggles,
per-lane volume, overview/zoom DOM, audio gain algorithms, analytics, keyboard ownership,
separation, detection, notes, Workers, AudioWorklets, or DSP.

## Preservation rules

| Concern | Required behavior |
|---|---|
| Stable identity and translation | Option values remain `mix`, stable lane keys, and `custom`; visible labels rerender for locale changes. Recognized stems use dictionary labels while unknown lanes retain their filename-derived source labels. |
| Ordinary stems | `mix` means every stem on. Each lane option solos exactly that lane. `custom` reflects lane/all-toggle changes without inventing a second state owner. |
| Full mix plus stems | The explicit mix and its stems remain mutually exclusive in actual gain ramps for every selector, lane, 0-key, and all-toggle path. Gain authority comes from `routingState.mode`, never a DOM value or CSS class. |
| All-toggle | Preserve partial → all-on with snapshot, all-on snapshot → restore previous, fresh all-on → all-off, and all-off → all-on. The React label exposes the next action and is never the state key. |
| Keyboard and focus | The shared document listener retains 0 and 1–6. Focused select/button events remain excluded from document shortcuts; both React controls blur after activation so shortcuts resume without duplicate dispatch. |
| Locale and lifecycle | Locale changes, shell unmount/remount, and song replacement preserve authoritative state where promised, reset routing for the replacement song, and never duplicate listeners, gain transitions, or analytics. |

## Failing-first and implementation increments

1. Add facade and production-entry browser assertions for command delegation/validation,
   one React owner, stable translated options including unknown lanes, every selector mode,
   ordinary and full-mix gain authority, all-toggle states, lane/0/1–6 synchronization,
   focus exclusion/restoration, locale, remount, replacement, and listener/analytics
   uniqueness. Add a lightweight accepted volume/A–B regression. Run the focused tests
   against the legacy owner and retain the expected failures.
2. Add only the two facade commands and routing projection. Make every routing mutation
   publish through the existing application boundary.
3. Add one mode/routing portal to `PlayerShell`; React derives presentation from stable
   snapshot data and the current locale.
4. Replace the two parser-authored controls with one portal host. Remove only their legacy
   option construction, presentation writes, eager captures, and direct listeners. Change
   mix/stem suppression to consult `routingState.mode`.
5. Run focused Node/Chromium tests, the complete automated suite, production build, diff
   check, and exact-source local root/nested smoke before review.

## Acceptance and omissions

Preview verification starts only after required checks pass and the page displays the exact
synthetic merge SHA. It covers root and nested routes, saved locale, ordinary generated
stems, generated full-mix-plus-stems, unknown lanes, the committed real-song fixture,
genuine 0/1–6 and playback keys, selector/button focus, one React owner, actual gain/source
behavior, accepted Phase 3a–3d controls, desktop/simulated-narrow layout, and a clean
first-party console. Production receives the narrower exact-SHA canary after merge.

Physical-handheld, subjective auditory, background-tab, and real-model checks remain
omissions unless genuinely exercised. Phase 3 can be called complete only after Phase 3e is
accepted in production, its separate rollback-anchor documentation PR merges, and no planned
header/loading/transport/top-level control remains legacy-owned.
