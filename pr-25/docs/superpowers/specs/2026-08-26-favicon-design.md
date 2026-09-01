# Favicon and iOS home-screen icon — design (2026-08-26)

Target version: **v1.9.0**.

## The problem

`index.html` has no `<link rel="icon">` and the repo has no icon assets at all. In a browser
tab the site shows the generic page glyph; bookmarked to an iPhone home screen, iOS
screenshots the page and uses that, which at 60×60 is an unreadable grey smear. There is
also no `theme-color`, so Safari's toolbar paints its default light chrome above a page whose
background is `#0d0d10`.

## The mark

The chosen direction is a **centred, mirrored waveform column with the bass bar flattened** —
the app's six lanes reduced to six bars, in lane order, in the app's own stem colours, with
the one the user is supposed to be playing knocked out. The name, drawn.

Three other directions were mocked and rejected: a six-lane horizontal bar stack (reads as
the app, but as a generic "audio app" rather than as this one), a soloed-bass stack (five
grey smudges and one green one at 16px), and an `s_b` wordmark (cleanest tiny, says nothing
about audio).

### Geometry

Canvas is **180×180**, background flat `#0d0d10` (the app's `--bg`), **full bleed** — no
rounded corners in the artwork, because iOS applies its own mask and pre-rounded corners
would show as a double radius.

Six bars, each **16 wide** with **8px gaps** (6×16 + 5×8 = 136, leaving a 22px margin either
side), `rx="8"` for full round caps, centred on the horizontal midline `y = 90` so
`y = 90 − h/2`:

| # | lane | fill | h | x | y |
|---|---|---|---|---|---|
| 1 | vocals | `#ff2e63` | 40 | 22 | 70 |
| 2 | guitar | `#ffb703` | 96 | 46 | 42 |
| 3 | **bass** | `#3a3a44` | **16** | 70 | 82 |
| 4 | drums | `#4cc9f0` | 104 | 94 | 38 |
| 5 | piano | `#b388ff` | 68 | 118 | 56 |
| 6 | other | `#8d99ae` | 34 | 142 | 73 |

The five lit colours are copied from `STEMS` in `lib/stems.js` and must stay in sync with it.

The bass stub is **`#3a3a44`**, not a dimmer grey and not a dimmed green. Dimmer reads as a
rendering glitch at 16px rather than as a deliberately flattened lane; a dimmed green keeps
the lane identifiably *bass* but softens "sans" into "quiet", which is the wrong joke.

Heights are decorative — they are an envelope, not data. Only the flattened third bar carries
meaning.

## Files

```
icons/icon.svg              source of truth, and the favicon for browsers that take SVG
icons/favicon-32.png        32×32 fallback for browsers that do not
icons/apple-touch-icon.png  180×180, iOS home screen — PNG is mandatory, iOS rejects SVG
scripts/make-icons.sh       rsvg-convert icons/icon.svg → the two PNGs
```

The PNGs are **generated once and committed**. `make-icons.sh` exists for regeneration only;
it never runs at serve time or deploy time, so the no-build-step constraint holds. Its one
prerequisite is `brew install librsvg`, stated in the script's own header. It passes
`--background-color=#0d0d10` so the PNGs are unconditionally opaque, whatever the SVG does —
iOS composites a transparent home-screen icon onto black and the result is not the design.

`icon.svg` is hand-written and readable — six `<rect>` elements and a background — so a
colour change does not require re-deriving the geometry.

## Markup

Added to `<head>` in `index.html`. Paths are **relative**, so they resolve under the per-PR
preview prefix `/pr-<N>/` as well as at the site root:

```html
<link rel="icon" href="icons/icon.svg?v=1.9.0" type="image/svg+xml">
<link rel="icon" href="icons/favicon-32.png?v=1.9.0" sizes="32x32">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png?v=1.9.0">
<meta name="theme-color" content="#0d0d10">
```

`theme-color` tints Safari's toolbar to the app background instead of leaving default light
chrome above a near-black page.

## Scope

In scope: the four `<head>` lines above, the four new files, the version bump, and the two
documentation/test edits below.

Out of scope, decided deliberately:

- **No `site.webmanifest`, no 192/512 icons.** The request was an iPhone home-screen icon.
  Android/desktop install buys little here — the separation panel is desktop-only and the
  player works fine in a normal tab.
- **No `apple-mobile-web-app-capable`.** Standalone launch would give the six lanes more
  vertical room, but it removes the address bar and the reload button. Against this project's
  documented `max-age=600` staleness trap, a visitor stranded on a stale cached `app.js`
  would have no obvious way out. Keeping Safari's chrome is the cheaper insurance.
- **No `favicon.ico`.** Browsers only auto-probe `/favicon.ico` when no icon link is present,
  and there will be two.

## Knock-on edits

1. **Version bump to `v1.9.0`** in `index.html`, `separate.js` and `separate.worker.js`, per
   the existing cache-busting rule. `tests/versions.test.js` fails on drift.

2. **`CLAUDE.md`'s `?v=` gotcha states the per-file URL counts** — "index.html (8),
   `separate.js` (3) and `separate.worker.js` (1)". Three new versioned URLs makes it 11.
   Update the count and the stated current version.

3. **`tests/versions.test.js` matches only `.js|.css`.** As written it would not guard the new
   assets at all: an icon could drift to `?v=1.8.0` and the suite would stay green. Widen
   `LOCAL_VERSIONED` to `(?:js|css|png|svg)` so the icons are covered. This is the one edit
   with any chance of breaking the suite — run it before and after the change. The existing
   `url.startsWith('http')` guard already exempts the jsDelivr and Hugging Face URLs.

**`docs/behaviour.md` is deliberately not touched.** It specifies what the *player* does as
observable outcomes; a tab icon is not player behaviour and an entry there would dilute it.

## Verification

Rendering an SVG is not evidence the browser picked it up, and file existence is not evidence
it is legible. Each claim needs its own observation:

| Claim | How it is observed |
|---|---|
| The PNGs are the right size | `sips -g pixelWidth -g pixelHeight` on both files: 32×32 and 180×180 |
| The PNGs render as the intended artwork | Open both, confirm six bars with the third flattened, on solid `#0d0d10` |
| The tab icon is legible at 16px | Load `scripts/serve.sh` in Chrome, screenshot the tab strip, confirm five distinct colours and a visible gap |
| The browser actually fetched an icon | DevTools network panel shows a 200 for `icons/icon.svg`, not a 404 for `/favicon.ico` |
| The home-screen icon is the artwork, not a page screenshot | Add to Home Screen on the iPhone against the deployed PR preview |
| Nothing regressed | `tests/test.html` → `window.__testResults` all green, both before and after the regex widening |

The iPhone check needs the PR preview URL, so it happens after the PR opens — the local
`serve.sh` host is not reachable from the phone.
