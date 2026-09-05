# Roadmap

Work that is wanted but not built. An index, not a spec: each item says what it is, where the
detail lives, and what has to be settled before it can be designed. Nothing here is a
commitment to an order.

Built work is recorded in [`devlog.md`](devlog.md), and what the player currently *does* is
in [`behaviour.md`](behaviour.md).

## React component migration

**Planned.** [Phased migration roadmap](react-migration.md) covering baseline evidence,
an isolated React pilot, player boundaries, incremental UI conversion, and final acceptance.
Each phase may span multiple sessions and PRs and leaves the application deployable. Start
with phase 0; progress and remaining legacy ownership are tracked in that document.

## Note editing — layer 4

**Built — v1.16.0.** [Spec](superpowers/specs/2026-08-31-note-editing-design.md),
[plan](superpowers/plans/2026-08-31-note-editing.md).

The six actions listed in
[`transcription.md` → Layer 4 → The actions to support](transcription.md#the-actions-to-support)
(高/低 8 度, 刪除, 分割, 新增, 平移, range-select-and-delete) resolved to **six edit types**
in the spec — not a 1:1 mapping. 平移 split into two actions (pitch-nudge and time-adjust,
the latter also covering resize) because a pitch move and a time move want different anchors.
分割 turned out not to need its own type at all: a split is just a time-adjust (shrink) plus
an add (the new tail note), authored together as one edit-list entry.

## Self-cleaning orphaned edits

Wanted: automatically drop an edit-list entry once it's orphaned, instead of leaving it as
inert dead weight (flagged with ⚠, skipped at apply time, but still sitting in `editGroups`
and in any exported file) until the user manually clicks its ✕. Came up while designing the
Snap-to-grid feature (see note editing above) — a snap batch anchored to a note that a later
edit-deletion moves out from under it becomes exactly this kind of orphan.

**The risk that has to be settled first.** `reinterpret()` runs live, on every keystroke/drag
tick — dragging `minDurationMs`, toggling fold, changing the interpreter. An edit can
legitimately go in and out of orphan status as a parameter is scrubbed through a range, then
resolve again once it settles. Auto-deleting the moment an edit is *seen* orphaned would
permanently destroy a hand edit the user never meant to discard — the exact failure mode the
edit layer exists to prevent (it is "the one layer with no upstream to recover from," per
[the note-editing spec](superpowers/specs/2026-08-31-note-editing-design.md)). Worse, there is
no undo path for it: `Cmd/Ctrl+Z` only pops the most-recently-*added* group, so a removal
that cascades to orphan (and auto-delete) a second edit can't be recovered at all.

**Open question before design.** Whether to solve the actual complaint (clutter, not
correctness — orphaned entries are already harmless) with something lower-risk instead: an
explicit **"Remove orphaned"** button (reviewable, user-initiated, only shown when something
is currently orphaned) or an **export-time-only filter** (never touches live `editGroups`, so
nothing in the session is destroyed). Either gets most of the benefit without the
transient-deletion risk true auto-cleaning carries.

## Automatic octave folding

**Built — v1.13.0.** [Spec](superpowers/specs/2026-08-31-octave-fold-design.md),
[plan](superpowers/plans/2026-08-31-octave-fold.md).

**What remains.** The odd-harmonic (3rd/6th) errors are still uncorrected — an octave plus a
fifth is unreachable by any whole-octave shift, and correcting them would change pitch class
and so break the key-detection guarantee that makes folding safe. They are marked doubtful
instead. That is the natural next step and needs a different safety argument. Also: the
threshold bounds the *residual*, not the error, so when the neighbours themselves sit a fifth
from the truth a 6th-harmonic error lands on them with residual 0 and nothing catches it. A checkbox that folds
octave-outlier notes by whole octaves into the singer's range, instead of only clipping them
from the lane's scale the way **Fit the lane to the melody** does today.

Measured on `stems/ng_kipin.zip` (vocals, `minDurationMs: 100`): the vocal body sits about
MIDI 39–60 with outliers clustered at 68–79. A duration-weighted **median ± 3×MAD** band
(median D#3, C2–F#4) flags **23 of 184 notes — 16.6% of note time**. A plain 5th/95th
percentile band does *not* work: the outliers are numerous enough to inflate it to E2–D#5,
which then absorbs them. The signature case is F#5 appearing three times with neighbours in
F2–G2, wanting a **−3 octave** fold — so the shift is not always one octave and has to be
chosen per note against neighbour context.

**Settled in the spec:** the fold changes the note list, because the synth has to play the
corrected pitch. That is safe for the key estimate, since folding by whole octaves preserves
pitch class. Nothing is deleted — notes gain a `fix` provenance field and stay visible in the
lane, folded ones in blue and untrusted ones in gray, so the later editing phase can see what
the detector originally said.

Note that action 1 of note editing is the same operation by hand. The two should share one
representation rather than becoming two mechanisms that disagree.

## 簡譜 — notes as scale degrees

**Built in v1.14.0** — [spec](superpowers/specs/2026-08-31-jianpu-design.md),
[plan](superpowers/plans/2026-08-31-jianpu.md). See `lib/jianpu.js`.

A display mode showing each note as a scale degree instead of an absolute name, with the key
picked automatically and overridable: a `1=` selector, a major/minor selector that changes what
the degrees mean, and a ⇄ button swapping the current key for its relative. This was also the
first time `detectKey()` reached the player — it had been bench-page-only since v1.10.0.

**Still wanted.** Rhythm notation: 簡譜 proper carries beams and dashes for duration, which
needs beat tracking — see the note under note editing on why that is its own problem. Export
and printing, persistence of the chosen key across loads, and surfacing detection confidence
(`margin`) so a low-confidence guess reads as a guess.

## Migrate to npm + a build step

**Built in v1.20.0** — [spec](superpowers/specs/2026-09-02-npm-vite-migration-design.md),
[plan](superpowers/plans/2026-09-02-npm-vite-migration.md). See `vite.config.js`.

Dropped the "no build step, no npm" hard constraint in favour of npm + Vite: `soundtouchjs`
installs as a normal dependency instead of the vendored `lib/vendor/soundtouch-core.js`, and
`npm run build` produces `dist/`, which both CI workflows now publish instead of the raw
repo. `app.js` and the classic-script `lib/*.js` files did **not** need any source changes
— they're still `window.SansX`-assigning IIFEs, not a real module graph with
`import`/`export` — but they **did** need their `<script>` tags switched to
`type="module"`: Vite's HTML plugin only bundles and content-hashes a script tag carrying
that attribute, and leaves a plain classic `<script src>` completely untouched (not even
copied into `dist/`), which 404s in the built output. That was the plan's own top risk item,
and it materialized on the first real build.

**Still wanted:** the ONNX runtime and separation model stay CDN/runtime-fetched by design
(out of scope for this migration — see its spec's non-goals).

**Also built in v1.21.0** — [spec](superpowers/specs/2026-09-02-esm-modules-design.md),
[plan](superpowers/plans/2026-09-02-esm-modules.md): `app.js` and the `lib/*.js` files
converted to a real ES module graph (actual `import`/`export`), closing the item above.

## Paste a YouTube link, extract the audio for separation

Wanted: paste a URL, get the audio, separate it — without the manual download step.

**The constraint this runs into.** The player is a static site with no backend, and that is a
hard constraint (GitHub Pages, no COOP/COEP, `numThreads = 1`). A browser cannot fetch
YouTube audio directly: CORS blocks the request, and the stream URLs need extraction rather
than being fetchable by address. So an in-page "paste a link and it downloads" would require
a server to proxy and extract — which would end the static-hosting property, and would mean
user content passing through a machine that is not theirs.

**The shape that fits.** A local script beside the two that already exist —
`scripts/rip-cd.sh` and `scripts/prep-stems.sh` — wrapping `yt-dlp` to write into `rips/`,
after which the existing pipeline is unchanged. This keeps the fetch on the user's own
machine, which is also the only place it is their business. Evidently already the manual
workflow: the repo root holds `… [Nk1FoNw7G2g].m4a` and `.webm`, which is yt-dlp's default
output naming.

**Open questions before design:** whether the URL is pasted into the page at all (a page field
that shells out is not possible; a page field that *tells you the command to run* is), and
whether the script should run separation itself or stop at the audio file. Legality and terms
of service are the user's call for their own material, exactly as with ripping a CD they own.
