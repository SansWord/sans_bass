# Usage analytics — design

**Date:** 2026-08-21
**Target version:** v1.7.0
**Status:** approved, ready for planning
**Endpoint:** `https://sansword.goatcounter.com/count`

## Goal

Learn whether anyone uses this site and which parts of it they reach, without cookies, without
a consent banner, and without any risk to the player itself.

Today the site ships with no instrumentation at all. GitHub Pages provides none — the repo's
Insights → Traffic tab counts views of the repository page on github.com, not of the deployed
site — so the current answer to "does anyone use this?" is genuinely unknown.

## Why GoatCounter

Evaluated against Google Analytics and Cloudflare Web Analytics.

- **Cloudflare Web Analytics is out on capability.** Its FAQ says custom events are
  unsupported: *"Not yet, but we may add support for this in the future."* Pageviews alone
  cannot answer the question that matters here, which is whether people get past the drop zone
  and actually run a separation.
- **Google Analytics is out on cost-of-ownership.** GA4 "stores a client ID in a first-party
  cookie named `_ga`", which means a consent banner in the EU/UK — a disproportionate UX tax on
  a practice tool. It is also the single most-blocked script on the web, and this audience
  (musicians who found a dependency-free tool on GitHub Pages) skews heavily toward blockers,
  so the undercount would be both large and biased.
- **GoatCounter** does cookieless custom events, is open source with a self-hosting escape
  hatch, and its pricing page states it is *"currently offered for free for reasonable public
  usage"* with personal sites explicitly fine.

All three undercount because of ad blockers. No number from any of them is a headcount; treat
every figure as a trend line.

## Constraint change

`CLAUDE.md` currently lists **"No uploads, no analytics, no audio egress ever"** as a hard
constraint. The "no analytics" clause is dropped by this design. The line becomes:

> **Nothing leaves the machine.** No audio egress ever. One cookieless, anonymous usage beacon
> (GoatCounter) reports event names only — never audio, never filenames, never song titles.

The audio guarantee is unchanged and non-negotiable. **No event payload may ever contain a
filename, a song title, or anything derived from user content.** Every event name in this
design is a compile-time constant or a stem id from a fixed set of seven.

### User-facing copy is deliberately unchanged

`drop.privacy` keeps its current wording in both locales:

- en: "Everything is decoded locally in your browser. Nothing is uploaded."
- zh-TW: 「所有解碼都在你的瀏覽器本機完成，不會上傳任何東西。」

The owner's decision, with the rationale that this string sits in the drop zone and describes
the *audio file* the user is about to drop, which is never uploaded. Recorded here because it
was a considered call rather than an oversight.

Noted for the record and not adopted: "Nothing is uploaded" is unqualified, and after this
change event names are uploaded. The minimal edit that would keep the sentence literally true
without turning it into a disclosure is scoping the second clause to the audio — "Your audio is
never uploaded" / 「不會上傳你的音檔」. Available if the owner changes their mind; no code
depends on which wording is chosen.

`README.md:6` needs no change — "your audio never leaves your machine" is already scoped to
audio and stays true.

## Event catalogue

GoatCounter has no custom dimensions. The `path` field doubles as the event name and cannot
begin with `/`, so everything to be distinguished is encoded in the name itself.

### Lifecycle events — fire on every occurrence

These are genuinely one-per-song, so there is nothing to deduplicate.

| Event | Fires when | Site |
|---|---|---|
| `song-load` | an audio file decodes into lanes | `loadFiles` success, `app.js:115` |
| `zip-load` | a zip of stems finishes loading | `loadZip` success, `app.js:166` |
| `load-error` | non-audio file, or a decode failure | the `say(…, true)` paths |
| `folder-drop` | a folder was dropped and the "zip it" message shown | drop handler |
| `separate-start` | the Separate button starts a run | `separate.js` `go` handler |
| `separate-done` | stems land | `result` branch |
| `separate-fail` | the run errors, or the worker dies | `error` branch and `w.onerror` |
| `separate-cancel` | the user cancels mid-run | `cancelled` message |
| `model-download` | the model came over the network | worker `ready`, `cached:false` |
| `model-cached` | the model came from Cache Storage | worker `ready`, `cached:true` |
| `separate-backend-webgpu` | WebGPU execution provider won | worker `ready`, `backend` |
| `separate-backend-wasm` | fell back to CPU | worker `ready`, `backend` |
| `stems-save` | the Save zip completes | `save` handler success |

`play` fires **once per session** rather than per occurrence — it is the bounce gate ("did this
visitor ever start audio"), and per-press counting would tell us nothing extra.

Several of these go beyond the original request — `load-error`, `folder-drop`, `separate-fail`,
`separate-cancel`, the backend split and `stems-save`. Two justify themselves loudest:
`separate-fail`, because separation is a heavy feature that can quietly OOM on weak machines and
the gap between `separate-start` and `separate-done` is the only way to see it; and the backend
split, because if most users land on `wasm` then the README's "20–25 seconds per song" is wrong
for them and nothing else would reveal it.

### Interaction events — once per session, plus cumulative thresholds

| Base | Thresholds | Notes |
|---|---|---|
| `play` | — | first playback of a session; the bounce gate |
| `toggle` | `toggle-5`, `toggle-20` | any lane |
| `toggle-<stem>` | — | once per stem per session |
| `seek` | `seek-10`, `seek-50` | pointer scrub and arrow keys both |
| `loop` | `loop-3`, `loop-10` | an A or B point being set |
| `unmute-all` | — | the `0` key / all-toggle control, v1.6.0 |
| `lang-en`, `lang-zh-TW` | — | once per session, the active locale |

`<stem>` is one of `bass`, `drums`, `vocals`, `guitar`, `piano`, `other`, `mix`, taken from
`t.stem` and **never** from `laneLabel()`. Same rule as saved zips: stem ids never translate, so
`toggle-bass` reads identically in both locales. A lane with no recognised stem fires only the
generic `toggle`, never a name derived from its filename.

### Why cumulative thresholds rather than exclusive buckets

The requirement was per-session discovery plus intensity. The obvious implementation — count
occurrences, then fire one of `seek-light`/`seek-medium`/`seek-heavy` at session end — was
rejected.

GoatCounter documents no `sendBeacon` support and no pagehide handling, so a session-end flush
means hand-building the request. Every session whose flush is dropped (backgrounded tab, browser
kill, iOS) would then contribute **nothing at all**, not even the base `seek` event, and that
loss is silently biased toward mobile.

Instead each counter fires its base event on the 1st occurrence and one event per threshold at
the moment that threshold is crossed. Nothing is deferred, so nothing can be lost:

```
seek        38     sessions that seeked at all
seek-10     21     ... of which reached 10+
seek-50      5     ... of which reached 50+
```

Same distribution, read as a funnel instead of a histogram; light sessions are `38 − 21 = 17`.
The only thing given up is precise attribution of a session that ends between two thresholds,
which the exclusive version only gets right when its flush survives anyway.

Cut points: `toggle` 5/20, `seek` 10/50, `loop` 3/10.

## `lib/analytics.js`

A classic script exposing `window.SansAnalytics`, mirroring `lib/stems.js` so `tests/` can load
it. Classic rather than ESM for the same reason `lib/stems.js` is: the tests and `app.js` both
need it, and the ESM migration is a separate change.

```js
track(name)                  // unconditional
once(name)                   // first time this page session only
bump(name, [t1, t2])         // fires name at 1, name-t1 at t1, name-t2 at t2
setSink(fn)                  // tests and manual verification
reset()                      // tests
```

**"Session" means one page load.** GoatCounter has its own server-side session concept
(roughly 8h, IP + user-agent hash); ours is deliberately simpler. The consequence is that a
reload counts as a new session and can re-fire `once` events. This is an accepted inaccuracy,
stated rather than hidden.

Each threshold fires exactly once, at the moment the counter reaches the cut point, and never
again.

## Transport and the queue GoatCounter does not have

The snippet is the documented one, with the site code baked in:

```html
<script data-goatcounter="https://sansword.goatcounter.com/count"
        async src="//gc.zgo.at/count.js"></script>
```

External, so no `?v=` — the version-query convention applies to local assets only. The default
automatic pageview is kept (`no_onload` is not set).

GoatCounter's JS API docs state there is no queue for calls made before the async script loads,
and recommend polling until `window.goatcounter.count` exists. Events here can fire early — a
cached model resolves fast — so `lib/analytics.js` owns a small queue:

- Buffer event names until `window.goatcounter.count` exists, then drain in order.
- Poll on an interval, as GoatCounter's own docs recommend.
- **Give up after ~10 s and cap the buffer at 50 entries.** An ad blocker means `count` never
  appears; a forever-polling interval plus an unbounded array is a leak on a page that already
  holds six `AudioBuffer`s.

## Analytics must never be able to break the player

`CLAUDE.md` records that `app.js` wires every listener from one flat run of top-level
statements, so a single throw silently takes out every listener below it — the v1.4.0 drag-and-
drop failure. A vendor script is exactly that shape of hazard.

- Every send is wrapped in `try/catch`; a transport failure is swallowed.
- Call sites in `app.js` go through a local null-safe helper in the spirit of the existing
  `on()`, so a missing `window.SansAnalytics` (script blocked, 404 after a bad deploy) degrades
  to a no-op instead of taking out the keyboard handler or drag and drop.

## Worker change: cache-versus-network

`ensureSession` currently posts `{type:'ready', backend}`. Whether the model came from Cache
Storage is knowable only by string-matching the log line `'model loaded from cache'`, which is
not a contract.

`loadModelBytes` will report the cache hit explicitly and `ready` becomes
`{type:'ready', backend, cached}`. `separate.js` maps that to `model-cached` or
`model-download`, and `backend` to the two `separate-backend-*` events.

When a `modelBuffer` is supplied directly, `cached` is `undefined` and **neither** model event
fires. That path is dead today (the local-`.onnx` picker was removed in v1.3.0, see
`docs/behaviour.md` S13), but the message should not claim a cache state it does not know.

## Testing

`tests/analytics.test.js`, registered in `tests/test.html`, against an injected fake sink:

- `once` fires once and not again.
- `bump` fires the base event at 1, each threshold exactly at its cut point, and never refires.
- `bump` does not fire a threshold below its cut point.
- `track` fires on every call.
- The queue drains in order once a sink appears.
- `reset` clears both fired-names and counters.

The GoatCounter network call itself stays untested. Verify it by hand with
`SansAnalytics.setSink(console.log)` in devtools.

**`allow_local` is deliberately not shipped.** GoatCounter filters localhost and private-IP
requests by default, so events fired from `scripts/serve.sh` silently vanish — which looks
exactly like broken instrumentation and belongs in `docs/behaviour.md` as a trap. Enabling it
permanently would fold every dev reload into the real dashboard. The injectable sink gives the
same confidence without polluting the data; flip `allow_local` temporarily if the network leg
itself ever needs proving.

## Everything that moves in the same commit

- **Version bump to `v1.7.0`** across `index.html`, `separate.js` and `separate.worker.js`, plus
  the new `lib/analytics.js?v=1.7.0` tag. `tests/versions.test.js` asserts the count of tagged
  URLs and will need updating for the new script.
- **`CLAUDE.md`** — the constraint line, per "Constraint change" above.
- **`docs/behaviour.md`** — observable rows for the analytics behaviour, the fake-sink
  verification recipe, and the `allow_local` trap.
- **`docs/devlog.md`** — a `v1.7.0` entry at end of session, TL;DR table updated with an anchor.

No change to `drop.privacy`, `README.md:6`, or any i18n key. `tests/i18n.test.js` is unaffected.

## Out of scope

- No opt-out control and no `navigator.doNotTrack` check. Considered and declined: Safari
  removed the DNT API and most vendors ignore the header, so it costs a slice of data for a
  signal few send.
- No self-hosting of GoatCounter.
- No dashboards, alerting, or export.
- No tracking of song titles, filenames, durations, or file sizes — see the constraint above.
