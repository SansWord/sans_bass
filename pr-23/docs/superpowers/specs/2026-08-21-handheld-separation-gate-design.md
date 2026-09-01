# Hide separation on handhelds — design (2026-08-21)

Target version: **v1.8.0**.

## The problem

On an iPhone, tapping **分離成 6 軌** kills the Safari tab. The page reloads with no
explanation and the user loses their loaded song.

The crash was traced with a dedicated spike (`spike/ios-webgpu.html`, PR #10, results in
`spike/RESULTS.md`). Summary of what was measured on iPhone18,2 / Safari 26.6:

| ORT runtime | Provider | Session created + idle | First `session.run()` |
|---|---|---|---|
| asyncify (webgpu bundle) | webgpu | survives | **crash** |
| asyncify (webgpu bundle) | wasm | survives | **crash** |
| plain (wasm bundle) | wasm | survives | **crash** |

Ruled out by measurement, not argument:

- **the accumulators** — the crashing probe allocates none (`accumulate:false`);
- **the 285 MB model and the memory floor** — a live session idles happily;
- **iOS's WebGPU backend** — the WASM path dies too;
- **asyncify instrumentation** — the plain 13.5 MB binary dies too;
- **raw memory capacity** — the same device committed **1920 MiB** of WASM heap.

What remains is the working set of one `session.run()` on a fixed `[1, 2, 343980]` input.
`N_SAMPLES` is baked into the ONNX graph, so nothing in this repo can change it.

**Therefore: separation is a desktop feature.** This design stops the crash and tells the
user what to do instead. It does not attempt to make separation work on a phone.

## Scope

In scope: hiding the separation controls on handhelds, replacing them with one honest
sentence, correcting the drop-zone copy that currently promises in-browser separation, and
counting how often this happens.

Out of scope: any change to separation itself, to the worker, to `lib/overlap.js`, or to
playback. Zip playback already works well on a phone and is untouched.

## The gate

Capability-shaped, not vendor-shaped. We have crash evidence for iPhone only, but Android
phones are untested and very likely fail the same way — the constraint is a phone-class
memory and compute budget, not Apple.

New classic script `lib/platform.js`:

```js
function isHandheld(win) {
  const w = win || global;
  const coarse = !!(w.matchMedia && w.matchMedia('(pointer: coarse)').matches);
  const touch  = !!(w.navigator && w.navigator.maxTouchPoints > 1);
  return coarse && touch;
}
```

Pure and parameterised, the way `detectLocale(langs)` already is, so it unit-tests against
a fake window with no navigator stubbing. Exposed as `window.SansPlatform.isHandheld`.

Classic rather than ESM for the same reason `lib/stems.js` is: `app.js` (classic) and
`separate.js` (module) both need it, and the ESM migration is a separate change.

**Both conditions are required.** A coarse pointer alone matches a TV or a touch-enabled
laptop in tablet mode; `maxTouchPoints > 1` alone matches a touchscreen desktop. Together
they mean a phone or tablet. This deliberately also catches iPadOS, which reports itself as
a Mac and would slip past any `iPhone|iPad` UA test.

No override. A documented way to crash your own tab is not worth the retest convenience;
when a future iOS is worth retesting, the spike page in PR #10 is the right tool.

## Copy

Two new keys, both locales. Neither mentions iOS, matching the capability-shaped gate.

| Key | zh-TW | en |
|---|---|---|
| `sep.handheld` | 分離功能需要電腦。在電腦上分離後，把 .zip 載入這裡即可。 | Separating stems needs a computer. Separate there, then load the .zip here. |
| `drop.explainHandheld` | `<strong>音訊檔</strong>：會以單一軌道播放。<br/><strong>分軌.zip</strong>：音軌已分離的 zip 檔。分離功能需要電腦。` | `<strong>One audio file</strong> — a whole song — plays as a single track. <strong>A .zip</strong> of stems already separated loads them as one lane each. Separating stems needs a computer.` |

`drop.explainHandheld` is `data-i18n-html` like the key it replaces, and like it carries
only our own dictionary markup — never user data.

## How the copy swap works

`SansI18n.apply()` reads the key **from the element's attribute** on every run. So swapping
the attribute once at boot makes both the first render and every later language switch pick
up the handheld variant for free:

```js
if (SansPlatform.isHandheld()) {
  document.getElementById('drop-explain')
    .setAttribute('data-i18n-html', 'drop.explainHandheld');
}
```

This runs in `app.js`, a classic script at the end of `<body>`, which executes during parse
— before `DOMContentLoaded`, and therefore before `apply()` walks the document.

Two alternatives were considered and rejected:

- **Branch inside `t()`.** One key would mean two different strings, and the
  same-keys-in-both-locales assumption in `tests/i18n.test.js` gets muddy.
- **Don't load `separate.js` at all on handhelds.** This re-introduces exactly the
  conditional script injection that v1.5.0 deleted along with `file://` support, and it
  does nothing for the drop-zone copy.

## Markup

`index.html`:

- add `<script src="lib/platform.js?v=1.8.0"></script>` with the other `lib/` scripts at the
  end of `<body>`, **before `app.js`** — `app.js` calls `isHandheld()` during parse, so
  `SansPlatform` must already exist. Order within the `lib/` block is otherwise free;
- add `id="drop-explain"` to the existing `drop.explain` paragraph;
- add one line inside `#sep`:

```html
<p id="sep-handheld" class="dim" hidden data-i18n="sep.handheld">Separating stems needs a
  computer. Separate there, then load the .zip here.</p>
```

The literal English in the markup is the no-JS fallback and must match `DICT.en` exactly,
as every other string in this file does.

## Panel behaviour

`separate.js` reads the gate once at module init — `const HANDHELD =
window.SansPlatform.isHandheld();` — hides the four controls when it is true, then
early-returns in `refresh()`:

```js
function refresh() {
  if (HANDHELD) {
    el.panel.hidden = !window.sansBass?.isSingleTrack?.();
    return;                     // controls already hidden; nothing below can run
  }
  …existing…
}
```

The panel therefore appears exactly when it does today — on a single unseparated song — but
contains only the sentence. `#sep-go` is visible by default in the markup, so it must be
hidden explicitly at init; `#sep-save`, `#sep-cancel` and `#sep-bar` already start hidden.

This depends on the global `[hidden] { display: none !important; }` in `styles.css`. Verify
with `getComputedStyle(el).display`, never `el.hidden` — a class that sets `display` beats
the `hidden` attribute, and that has bitten this project before.

## Analytics

One event, `separate-handheld-blocked`, fired with **`once()`** — not `track()`.

`refresh()` runs on a 400 ms `setInterval`, so `track()` would fire continuously for the
whole session. `once()` is precisely the "did this visitor ever reach X" verb.

The name is a compile-time constant carrying no user content, satisfying the rule that no
event may ever carry a filename or song title.

## Version

This changes shipped behaviour: **v1.8.0**. Every `?v=` moves together — `index.html` goes
from 7 versioned URLs to 8 with `lib/platform.js`, plus `separate.js` (3) and
`separate.worker.js` (1). `tests/versions.test.js` fails if they drift.

## Tests

New `tests/platform.test.js`, four cases against a fake window:

| `matchMedia('(pointer: coarse)')` | `maxTouchPoints` | expected |
|---|---|---|
| matches | 5 | `true` |
| does not match | 5 | `false` |
| matches | 0 | `false` |
| `matchMedia` absent | 5 | `false` |

`lib/platform.js` must be added to `tests/test.html`.

`tests/i18n.test.js` already fails when a key exists in one locale only, so the two new
strings are covered without new assertions there.

## docs/behaviour.md

Amend **S1**, which currently says the panel appears only for a single unseparated track —
still true, but the panel's *contents* now depend on the device.

Add:

| # | Behaviour | How to observe |
|---|---|---|
| S14 | On a handheld, a loaded single song shows `#sep` containing only the explanation. **Separate**, **Save**, **Cancel** and the progress bar all have computed `display: none`. | `getComputedStyle` on all four, not `.hidden`. |
| S15 | On a handheld the drop zone makes no in-browser-separation promise. | `#drop-explain` renders `drop.explainHandheld`. |
| S16 | Both handheld strings follow the language toggle like every other string. | Switch locale with a song loaded; both re-render. |

Handhelds cannot be reached from browser automation, so these are verified by calling
`isHandheld(fakeWindow)` directly plus one manual pass on the phone against the PR preview
— the same fault-injection approach the project already uses for `file://`.

## Risks

- **A touchscreen laptop is gated out.** `pointer: coarse` requires the *primary* pointer
  to be coarse, which a laptop with a trackpad reports as `fine`, so this is unlikely. The
  cost if it happens is a lost feature, not a crash — the right way round.
- **A future phone could cope.** Accepted. Retest with the spike page, then relax the gate.
