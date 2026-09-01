# Devlog

Running log of what was built and what was learned building it.

### Learning tags

| Tag | Meaning |
|-----|---------|
| `[note]` | Useful context, well-documented — good to have written down but you'd find it in the docs |
| `[insight]` | Non-obvious; meaningfully changes how you design or debug something |
| `[gotcha]` | A specific trap that bit you; high risk of biting you again — bookmark this |

## TL;DR

| Version | Summary |
|---------|---------|
| [v1.16.5](#v1165--簡譜-note-list-markdown-export-2026-09-01-1258) | A second, human-readable export from the Notes panel: **Export list** downloads the current 簡譜 reading as a Markdown file, chunked into fixed-length timecoded blocks by note start time — separate from the JSON edits round-trip. |
| [v1.16.4](#v1164--inline-field-labels-and-flat-pitch-entry-2026-09-01-1209) | Visible labels above the Start/End/Pitch fields, and Pitch becomes three dropdowns (letter/accidental/octave) so a flat spelling can be entered directly. `parseNoteName()` moves from a sharps-only lookup to a semitone formula that resolves flats correctly, including the two letters (`Cb`, `Fb`) whose flat crosses an octave boundary. Picking a pitch dropdown auto-commits, splitting Pitch away from Start/End's Enter/Apply-staged path. |
| [v1.16.3](#v1163--inline-note-detail-fields-2026-09-01-0956) | Three inline fields — Start, End, Pitch — beside the note editor's toolbar, directly editable and committing via Enter or Apply through the existing `timeAdjust`/`pitchNudge` edit types. Invalid input reverts silently without blocking a valid sibling edit, Escape reverts everything uncommitted, and typing is never clobbered by a redraw. `lib/pitch.js` gains `parseNoteName()`, the inverse of `noteName()`, bridged to `app.js` via a new `window.SansPitch`. |
| [v1.16.2](#v1162--note-selection-identity-2026-09-01-0209) | Overlapping notes are disambiguated by pitch, not just time: `selectedNote` now carries `midi`, `noteAt` and `applyEdits` both accept an optional pitch qualifier, and the selection outline and every toolbar/keyboard edit resolve to the exact note under the pointer instead of an arbitrary same-time match. Old exported edit-history files (no `midi` field) still apply exactly as before. |
| [v1.16.1](#v1161--note-editing-ergonomics-batch-1-2026-08-31-2322) | Four ergonomics fixes to v1.16.0's note editor: overlapping notes resolve clicks to whichever is drawn on top, the zoomed pane's scroll wheel seeks by default (Shift zooms) and arrows always seek (Shift for a fine step), range-select-and-delete now works in the full-song notes lane too, and clicking or tapping a note parks the playhead exactly there. |
| [v1.16.0](#v1160--note-editing-layer-4-2026-08-31-2201) | Hand-correct the detected note list from the zoomed pane — octave/semitone nudge, drag-move/resize, split, add, delete, range-delete — anchored to a time point so corrections survive every later re-interpretation (a slider drag, the HMM toggle, octave folding). Orphaned edits surface a warning instead of vanishing. The whole editing session exports/imports as one JSON file. |
| [v1.15.0](#v1150--resuming-the-note-at-a-2026-08-31-1549) | A note still sounding when playback enters — at loop point A, on every lap, or at a seek target — now plays its remainder instead of being skipped, entering the envelope at the amplitude it had already reached rather than re-attacking. It is cut at B rather than ringing across the restart. One symptom, three separate causes. |
| [v1.14.0](#v1140--簡譜-notes-as-scale-degrees-2026-08-31-1421) | 簡譜: a display mode drawing each note as a scale degree instead of an absolute name, in a key detected automatically and overridable by three controls. Off by default; the note data is untouched. The octave moves off the blocks and onto the pitch axis as dots. First time `detectKey()` reaches the player. Also flips `hmm-v1` on by default and drops its "experimental" label. |
| [v1.13.0](#v1130--octave-folding-2026-08-31-1214) | Octave-outlier notes are folded back into the singer's range using their neighbours, and the ones that cannot be justified are marked rather than guessed. Off by default. Nothing is deleted: every note keeps a `fix` record, folded ones draw blue, untrusted ones gray and silent. |
| [v1.12.0](#v1120--hmm-note-decoding-switchable-2026-08-30-2241) | A second note interpreter, `hmm-v1`: `yinFrame` keeps every CMND local minimum as a weighted candidate, and two Viterbi passes decode a pitch path and segment it into notes. Off by default — it cuts octave-down errors by a third to a half, but trades some of that for octave-up errors on two of three tracks. Confirmed better by ear at a 100 ms shortest-note setting. |
| [v1.11.0](#v1110--notes-ribbon-in-the-player-2026-08-30-2059) | A notes lane under the vocals stem: detected notes drawn over the pitch contour they came from, on the shared time grid, seekable. Analysis once in a worker; interpretation re-derived live at ~12 ms. |
| [v1.10.0](#v1100--notes-and-key-from-a-vocal-stem-2026-08-30-1417) | Notes and key detection from a stem: decimated YIN, segmentation, Krumhansl-Schmuckler key with a confidence margin. Bench page only, no UI. |
| [v1.9.0](#v190--favicon-and-home-screen-icon-2026-08-26-1429) | Favicon and iPhone home-screen icon: six stem bars with the bass lane flattened, so the mark is the song *sans bass*. |
| [v1.8.0](#v180--separation-is-a-desktop-feature-2026-08-21-2225) | Separation hidden on phones and tablets, with an honest message; the crash is unfixable from this repo. |
| [v1.7.0](#v170--usage-analytics-2026-08-21-1736) | Cookieless GoatCounter events: loads, separations, and interaction intensity in power-of-two buckets. |
| [v1.6.0](#v160--beta-test-refinements-2026-08-21-1600) | Seven things beta testers tripped over: the two Load buttons become one, `0` becomes a real mute/unmute-all toggle instead of a disabled no-op, the mode dropdown stops eating every hotkey, the keyboard hint gets legible, and the lane's click target finally looks like one. |
| [v1.5.0](#v150--interface-i18n-2026-08-21-1109) | The whole interface speaks zh-TW by default and English when the system language is not Traditional Chinese, with a remembered toggle in the header. Switching re-renders in place — no reload, no re-decode, playback never stops. |
| [v1.4.0](#v140--the-drop-that-navigated-away-2026-08-21) | Drag & drop on the live site was dead: a stale cached `app.js` threw on an element the new `index.html` no longer had, and every listener below it — drag & drop included — never registered. Versioned asset URLs, null-safe wiring, a loud error path, and an explicit full-window drop overlay. |
| [v1.3.0](#v130--one-song-or-one-zip-of-stems-2026-08-21-0104) | Loading rework: **Load song** takes one audio file, **Load zip** takes one `.zip` of stems, and drop accepts the same two. Folder drop, multi-file loading and the directory walk are gone; a classic-script zip reader never holds the whole file. |
| [v1.2.2](#v122--separation-panel-and-lane-toggle-refinements-2026-08-20-2310) | UI refinements: lane clicks toggle instead of solo, separation drops the original track and stops playback, an Unmute all / Restore previous control, and a repaired `[hidden]` rule that had been showing buttons meant to be hidden |
| [v1.2.1](#v121--github-pages-deployment-with-pr-previews-2026-08-20-2105) | Published to GitHub Pages with per-PR preview deployments; every pull request gets a live URL at `/pr-N/` before it reaches production |
| [v1.2.0](#v120--in-browser-stem-separation-2026-08-20-2043) | Six-stem separation running entirely in the browser via onnxruntime-web + htdemucs_6s, at ~8x realtime on WebGPU, with stems saveable as one ZIP of WAVs |
| [v1.1.0](#v110--a-b-repeat-loop-2026-08-13) | A-B repeat: `a`/`b` set loop points, looping runs on the audio thread so all six stems stay sample-locked |
| [v1.0.1](#v101--drag-and-drop-repair-2026-08-13) | Fixed folder drag-and-drop dying silently; a callback-pair API wrapped without its error path hung the handler forever |
| [v1.0.0](#v100--cd-to-browser-stem-player-2026-08-13) | CD → FLAC → Demucs stems → browser multitrack player with per-instrument waveforms and solo |

---

## v1.16.5 — 簡譜 note-list markdown export (2026-09-01 12:58)

**Review:** not yet

**Design docs:**
- 簡譜 note-list export: [Spec](superpowers/specs/2026-09-01-notes-jianpu-export-design.md) [Plan](superpowers/plans/2026-09-01-notes-jianpu-export.md)

**What was built:**

- `degreeToken()` in `lib/jianpu.js`, next to `degreeOf`/`referenceOctave`: a MIDI note as a
  printable 簡譜 token — accidental plus digit, wrapped with an apostrophe per octave above the
  reference octave or a comma per octave below.
- A new `#notes-list-io` row in the Notes panel: a "seconds per line" number input (default 10)
  and an **Export list** button, gated together with the key selectors — disabled unless 簡譜 is
  on AND at least one note exists.
- The export click handler in `notes.js`: buckets the in-memory `notes` array into fixed-width
  windows by start time, then writes a Markdown file — one `== MM:SS - MM:SS` block per window,
  a line of space-separated 簡譜 tokens, a header naming the song (when known) and the detected
  key. No worker, no re-analysis, no new script tag — reuses the same `notes`/`jianpu` state the
  ribbon already draws from.
- `notes.listSecs` / `notes.exportList` i18n strings in both locales.

**Key technical learnings:**

- `[insight]` **Bucketing by note START time, not by overlap with a window, makes "a note
  crossing a boundary" a non-problem instead of a special case.** A note is placed in exactly
  the window its `start` falls into (`Math.floor(n.start / secs)`), full stop — there is no
  clipping, no splitting, and no "which window does the tail belong to" decision to get wrong.
  Verified this structurally while testing: halving the window width from 10s to 5s split one
  10s block's 17 tokens into two 5s blocks with 11 and 6 tokens — 11+6, none lost or duplicated
  — which is exactly what falls out for free from bucketing on a single timestamp instead of a
  time range.
- `[note]` **ASCII 簡譜 octave marks (trailing `'`, leading `,`) were chosen over Unicode
  combining dots on purpose**, even though the on-screen ribbon already draws octaves as dots
  (`drawOctaveDots` in `app.js`). A downloaded `.md` file is read in arbitrary text editors and
  markdown viewers, where a combining-dot glyph over a digit is exactly the kind of thing that
  renders inconsistently or not at all depending on font support; apostrophe/comma is the
  traditional plain-text 簡譜 convention for the same reason and needs no font support at all.
- `[note]` **`currentMix()` returning `null` is the normal case for in-browser-separated
  output**, not an edge case to special-guard against — `loadSeparated` never keeps the original
  file. The export header's song-name segment (`"${mix.name} — "`) and its em dash are simply
  omitted together when there's no mix, verified against a zip of six stems with no mix file
  (`# 1=<letter> <major|minor>`, no leading name, no stray dash) alongside a zip that does carry
  one.

## v1.16.4 — Inline field labels and flat-pitch entry (2026-09-01 12:09)

**Review:** not yet

**Design docs:**
- Inline field labels and flat-pitch entry: [Spec](superpowers/specs/2026-09-01-note-inline-fields-followups-design.md) [Plan](superpowers/plans/2026-09-01-note-inline-fields-followups.md)

**What was built:**

- Visible labels above Start, End, and Pitch — reusing the existing translated tooltip
  strings, no new i18n keys.
- Pitch's single text field replaced with three dropdowns (letter, accidental, octave), so a
  flat spelling (`Db`, `Eb`, ...) is an explicit, unambiguous choice instead of something a
  free-text parser would have to guess at.
- `parseNoteName()` moved from a sharps-only lookup table to a semitone-offset formula, so it
  now resolves flats to the correct MIDI number — including `Cb` (the same pitch as the B
  *below* it) and `Fb` (the same pitch as E in the same octave), the two letters whose flat
  crosses an octave boundary and where a naive "flat = sharp minus one, same octave" approach
  gets the wrong answer. The formula also resolves non-table sharps like `B#`/`E#`, previously
  rejected the same as flats were — a real, permanent behavior widening beyond just flats.
- Picking any pitch dropdown value auto-commits a `pitchNudge` immediately, the same way the
  toolbar's existing ♯/♭/↑8ve/↓8ve buttons already do — splitting Pitch away from Start/End's
  Enter/Apply-staged commit path entirely. `commitFields()` is now Start/End only.

**Key technical learnings:**

- `[insight]` **Accepting a second, unambiguous spelling isn't the same risk as accepting an
  ambiguous guess.** v1.16.3's `parseNoteName()` rejected flats specifically to avoid silently
  *reinterpreting* an ambiguous-looking free-text entry. That risk doesn't exist once flat
  becomes an explicit dropdown choice — `Db4` and `C#4` are, by definition, the identical
  physical pitch, not two different guesses about what the user meant. Recognizing that the
  original safety property was about ambiguity, not about flats specifically, is what made
  extending the function safe rather than a regression of the original design intent.
- `[gotcha]` **A flat's semitone offset can't be computed as a lookup-plus-wrap without getting
  two letters wrong.** Naively mapping a flat letter to "one semitone below its sharp-table
  index, wrapped within the same octave number" gets `Cb`/`Fb` wrong, because `Cb4` is not
  `B4` — it's `B3`, one octave down. The fix is a single continuous formula
  (`NATURAL_SEMITONE[letter] + offset + (octave+1)*12`) computed before any wrapping, so the
  octave boundary falls out of ordinary arithmetic instead of needing a special case. Verified
  live in the running app (not just the unit test): setting a note's Pitch to C/♭ actually
  landed it on the B one octave down, not the same octave.
- `[gotcha]` **A formula change's blast radius can be wider than the one case you set out to
  fix.** The semitone-formula rewrite was scoped as "make flats work," but it also silently
  started resolving non-table sharps (`B#`, `E#`) that the old lookup-table implementation
  rejected — a correct, even desirable, side effect (the eventual dropdown UI can produce
  exactly these combinations), but one that a code reviewer caught, not the original design or
  the first pass of tests. Worth explicitly enumerating "what else changes" whenever a lookup
  table gets replaced with a formula, not just checking the motivating case.
- `[note]` A `<select>` doesn't carry the same "mid-keystroke, clobber-able" risk a text input
  does — its value only changes through an explicit, already-committing choice — so the Pitch
  dropdowns' sync function needed none of Start/End's `fieldsShownFor`/focus-guard machinery,
  even though it's solving a superficially similar "keep the field in step with the note"
  problem right next to it.

**Process learnings:**

- `[insight]` **Subagent review caught what self-review wouldn't have.** This session's first
  half (Tasks 1's review) ran through the full spec-compliance + code-quality subagent review
  cycle and caught a stale `docs/behaviour.md` claim and a missing-test-coverage gap that the
  implementer's own self-review missed. The second half (Tasks 2-9) switched to inline
  execution for speed on the remaining mechanical DOM/CSS/docs work, with one consolidated
  manual-verification pass instead of a review cycle per task — a reasonable trade for
  well-specified, lower-risk changes, but worth remembering that the fresh-eyes review is what
  catches the subtle stuff, not raw effort spent looking at your own work again.

---

## v1.16.3 — Inline note-detail fields (2026-09-01 09:56)

**Review:** not yet

**Design docs:**
- Inline note-detail fields: [Spec](superpowers/specs/2026-09-01-note-inline-fields-design.md) [Plan](superpowers/plans/2026-09-01-note-inline-fields.md)

**What was built:**

- Three inline fields — Start, End, Pitch — beside the note editor's toolbar, populated from
  the selected note and directly editable; Enter (in any field) or a shared Apply button
  commits.
- `parseNoteName()` in `lib/pitch.js`, the exact inverse of `noteName()` — sharps only,
  rejects flats and garbage — round-trips every value `noteName()` can produce.
- A combined Start+End change commits as one `timeAdjust`, matching a two-edge drag; a Pitch
  change commits as one `pitchNudge`; both can land from a single Apply/Enter as two edits in
  one `dispatchEdit` call, the same pattern `editSplit()` already used.
- Invalid input in either the time pair or the pitch field reverts silently (no edit
  dispatched for that field) without blocking a valid edit sitting right next to it; Escape
  reverts all three without committing.
- A `fieldsShownFor` identity guard stops the per-frame `draw()` → `syncEditToolbar()` tick
  from overwriting an in-progress keystroke, while still refreshing immediately on a
  genuinely new selection or a forced post-commit refresh — and a `document.activeElement`
  check was added as local defense-in-depth alongside the identity guard, so a future
  hotkey or drag-handle change elsewhere in the file can't silently reintroduce clobbering.

**Key technical learnings:**

- `[gotcha]` **A classic script can't `import` an ES module, and a design spec's pseudocode
  can assume it can anyway.** `app.js` is intentionally a classic script (`CLAUDE.md`'s hard
  constraints), but `lib/pitch.js` is ESM-only, imported until now only by
  `notes.js`/`notes.worker.js`/`sonify.js`. `commitFields()`'s call to `parseNoteName()`
  needed a bridge — `window.SansPitch`, set by `lib/pitch.js` itself at module load — the
  same shape as the existing `window.sansBass` bridge, just running app.js → notes.js's
  direction in reverse. Caught by tracing the DOM/module boundary before writing any code,
  since there's no test that would have caught it after the fact.
- `[gotcha]` **A field that round-trips through a rounded display format is not the same
  float it started as, and an exact-equality "did this change?" check will notice.**
  `fmtPrecise()` displays time to the millisecond; reparsing that string via
  `parseTimeMmSs()` for a field the user never touched can differ from the note's actual
  value by up to ~0.5ms of rounding noise. `commitFields()`'s original zero-delta check
  (`dStart !== 0 || dEnd !== 0`) treated that noise as a real edit, silently bundling a
  junk near-zero `timeAdjust` alongside an intended `pitchNudge` on every pitch-only commit
  — invisible in the UI (the field still displayed the same rounded text) but polluting the
  edit-history list and export. Caught only by real end-to-end browser testing with an
  actual note (Task 9), not by code review or the unit suite, since nothing exercised the
  round-trip with real floats until then. Fixed by comparing `dStart`/`dEnd` at the same
  millisecond granularity the field itself displays, rather than at exact float precision —
  the dispatched edit still carries full-precision deltas when a real change is detected.
- `[gotcha]` **A design assumption never checked against the behaviour doc's own existing
  rows shipped as a documented "spec" for something that doesn't exist.** The original E27
  behaviour-doc row claimed "clicking empty space deselects" a note — but two pre-existing
  rows in the same file (E2, E3, both predating this feature) already establish that a blank
  click has only ever seeked the playhead, never deselected anything; the toolbar buttons
  stay enabled indefinitely once a note is selected, exactly like the new fields correctly
  (if inadvertently) mirror. The plan's Task 8 wrote a doc row describing behaviour that had
  never existed for the feature it was modeled on, and it went unnoticed through a spec
  review, a code-quality review, AND an initial doc-quality review — only real interactive
  testing surfaced it. Fixed by correcting the row's claim rather than the code, since the
  code correctly matches (by accident of following the toolbar's existing pattern) the
  project's real, established selection semantics.
- `[insight]` **"Only rewrite when different" already implies the focus guard a design can
  describe as a separate check — but only if you trace every path that could break the
  invariant it depends on.** The design spec describes two conditions for the fields'
  refresh guard — rewrite only on a different note, and never while a field has focus — as if
  both need testing in code. Code review confirmed the identity check alone was sufficient
  under every CURRENT call path (nothing changes `selectedNote` while a field holds focus,
  because of an unrelated `keydown` handler's input-tag exclusion), but flagged that this
  safety was an undocumented, cross-cutting invariant rather than a local guarantee — a
  future hotkey or drag-handle added elsewhere could silently break it with no signal
  anything had. Resolved by adding the `document.activeElement` check back as cheap,
  local, defense-in-depth (nested so it doesn't regress the deliberate forced-refresh-after-
  commit snap-back), plus a cross-reference comment at the invariant's actual location.
- `[note]` The Pitch field reads `sel.name` — already computed by `segmentNotes`/`applyEdits`
  and stored on every note object — rather than calling `noteName()` from `app.js`. That
  meant `app.js` never needed to reach `noteName()` at all, only its inverse; only
  `parseNoteName` needed the `window.SansPitch` bridge.

**Process learnings:**

- `[gotcha]` **Two subagents fixing different bugs in the same git worktree concurrently can
  corrupt each other's commits.** Both fixes used `git commit --amend --no-edit` against
  "the commit I'm fixing" — but in a shared working directory, `HEAD` can move out from under
  a subagent between when it stages its change and when it commits, so an amend silently
  amends whatever the CURRENT tip is, not the commit the subagent thinks it's targeting. One
  fix's `app.js` change ended up folded into the other's `docs/behaviour.md` commit, with
  the amending agent's original commit message winning via `--no-edit`. Recovered by
  reconstructing the commit history from diffs (verified the final tree was byte-identical
  to the tangled state before rebuilding, so nothing was lost) rather than by trusting either
  agent's commit boundary claims. Two independent fixes in the same worktree should be
  serialized, not parallelized, whenever both intend to amend an existing commit.

---

## v1.16.2 — Note selection identity (2026-09-01 02:09)

**Review:** not yet

**Design docs:**
- Note selection identity: [Spec](superpowers/specs/2026-09-01-note-selection-identity-design.md) [Plan](superpowers/plans/2026-09-01-note-selection-identity.md)

**What was built:**

- `selectedNote` now carries `{ at, midi }` instead of just `{ at }` — every assignment site
  (click-select, drag commit, add-note commit, octave/semitone/time nudge, split) keeps it
  current, including two functions (`editOctave`, `editPitchNudge`) that previously left it
  stale after a pitch-changing edit.
- `noteAt(list, at, midi)` gained an optional third parameter: with it, only a note at that
  exact pitch counts, which is what actually disambiguates two notes overlapping in time —
  time alone never could, no matter which tie-break rule wound up on top of it. Every call
  site that already has a `selectedNote` passes its `midi` through; the one fresh-click call
  site reuses `addMidiAt` (the same Y→pitch rounding `+ Add note` placement already uses) to
  get a pitch value from the click itself. The drag-detection branch in `attachZoom`'s
  `pointerdown` handler — deciding whether a click grabs the already-selected note to
  move/resize it — is now gated on the click's pitch matching the selection too, not just
  its time; without that it kept hijacking clicks meant for a different, time-overlapping
  note underneath.
- The selection outline (`renderZoom`) and `lib/pitch.js`'s `applyEdits` anchor lookup both
  gained the same pitch check, so the toolbar/keyboard can no longer visibly select one note
  while silently acting on a different, time-overlapping one underneath it.
- `applyEdits`'s `midi` qualifier is optional and additive: an edit object with no `midi`
  (every edit in a file exported before this change) resolves exactly as it always did —
  first match, no pitch filtering — so old exported edit-history JSON keeps applying
  unmodified.

**Key technical learnings:**

- `[insight]` **Tie-breaking and disambiguation are different problems that look like the
  same one.** v1.16.1 fixed *which* overlapping note a click resolves to when multiple
  candidates are already known (array-order tie-break: last/topmost wins). It could not fix
  the deeper issue, because tie-breaking only matters once you already know your candidate
  set — and time alone was never enough to build that set correctly when two notes overlap
  in time but sit at different pitches. Pitch is what narrows "notes containing this time
  point" down to "the one thing actually under the pointer."
- `[gotcha]` **Reassigning shared state after a synchronous event dispatch can read it back
  null.** `editOctave`/`editPitchNudge` used to call `dispatchEdit` (a synchronous
  `window.dispatchEvent`) and only afterward set `selectedNote` to the new pitch.
  `dispatchEdit`'s event round-trips through `notes.js` and back into `syncEditToolbar`
  *before that line runs* — and `syncEditToolbar` re-resolves the selection using whatever
  `selectedNote` holds at that exact moment. Since the note had already moved to its new
  pitch in `ribbon.notes`, looking it up by the stale old `midi` failed, `syncEditToolbar`
  nulled `selectedNote` as its own self-healing behavior, and the post-dispatch line crashed
  reading `.at` off `null` — 100% reproducible on every octave/semitone edit. Caught only by
  manually exercising the pitch-aware outline in a real browser; the unit suite has no
  coverage of `app.js` at all. Fixed by updating `selectedNote` *before* dispatching
  (matching `editSplit`'s existing order), which also has the side benefit of keeping the
  outline correctly tracking the note through the pitch change instead of losing selection.
- `[gotcha]` **A selection anchor's shape has to track every field an edit can change, not
  just the ones the original design happened to touch.** `selectedNote.at` already survived
  every edit type by design (v1.16.0); adding `midi` surfaced two functions
  (`editOctave`, `editPitchNudge`) that changed a note's pitch without updating the
  selection's own record of it — harmless while `selectedNote` was time-only, but silently
  wrong (a stale-pitch outline vanishing right after the very edit that just ran, before the
  crash above was even fixed) the moment pitch became part of the identity.
- `[note]` Reusing `addMidiAt` for click-to-select's pitch value, rather than writing a
  second Y→pitch rounding function, keeps "what pitch is under this pointer" answered one
  way everywhere it's asked — the same reasoning that keeps `noteAt`'s half-open interval
  shared between `app.js` and `lib/pitch.js`.

---

## v1.16.1 — Note editing ergonomics (batch 1) (2026-08-31 23:22)

**Review:** not yet

**Design docs:**
- Note editing ergonomics (batch 1): [Spec](superpowers/specs/2026-08-31-note-editing-ergonomics-design.md) [Plan](superpowers/plans/2026-08-31-note-editing-ergonomics.md)

**What was built:**

- `noteAt` now searches the note list from the end rather than the start, so a click on two
  overlapping notes resolves to whichever is drawn on top (the later array entry) instead of
  always the first-detected one. `add` already pushes new notes to the end, so a manually
  placed note dropped onto an existing one is both drawn on top and the one a click selects,
  with no special-casing.
- The zoomed pane's scroll wheel now seeks the playhead by default, proportional to the
  current zoom span; Shift+wheel keeps the old zoom behavior. Arrow Left/Right always seek —
  also proportional to the zoom span (`zoomSeconds × 0.15`: 0.3s at a 2s zoom, 9s at a 60s
  zoom) — regardless of whether a note is selected; Shift is a fixed 1ms step for placing a cut
  inside a word, which is about absolute precision rather than view navigation, so it does not
  scale with zoom. Nudging a selected note's time from the keyboard is gone for now (the
  toolbar's ◀t/▶t buttons and dragging still work), a deliberate interim trade-off until inline
  value fields (a later batch) give it a new home.
- Range-select-and-delete (v1.16.0) now works in the full-song notes lane, not just the zoomed
  pane: the same bottom-band drag gesture, the same resting-state strip and caption, and the
  same shared **Delete range** button, since both panes feed one `rangeSelection`.
- Clicking a note now seeks the playhead to the exact clicked point (not the note's midpoint,
  which stays the selection anchor for a separate reason). Tapping — pressing and releasing an
  already-selected note without a real drag — now seeks too, instead of silently doing nothing;
  an actual drag still moves/resizes exactly as before.

**Key technical learnings:**

- `[insight]` **A cached-layer canvas needs its transient UI drawn OUTSIDE the cache.**
  `renderRibbon` pre-renders idle/active layers specifically so a frame is a cheap blit —
  drawing the range-select band inside that cache would mean rebuilding both layers, plus the
  full grid/notes/labels pass, on every pointermove of a drag. `paintLoopRegion` had already
  solved this exact problem for the A-B loop shading; the new `paintRangeBand` reuses the same
  live-canvas-after-blit pattern rather than inventing a new one.
- `[gotcha]` **A shared helper needs an opt-in flag, not a global behavior change.**
  `attachSeek` is wired to every track lane, the main waveform, and the notes ribbon lane alike
  — adding the range-band check unconditionally would have turned on range-select dragging
  everywhere. The `{ rangeBand: true }` option keeps the other two dozen call sites untouched,
  and adding a `pointercancel` handler while there (there wasn't one before) closes a real gap:
  without it, a cancelled gesture on the ribbon lane would leave `rangeDrag` stuck.
- `[note]` Range-select's `rangeDrag`/`rangeSelection` state is genuinely canvas-agnostic — it
  was already shared across the zoomed pane and (as of this batch) the notes lane with zero
  changes to the state shape itself, only to which canvases feed it.
- `[gotcha]` **"Which note is selected" and "where is the playhead" are different anchors that
  happen to share a gesture.** `selectedNote.at` has to stay the note's midpoint to survive
  future edits reliably; the seek target is wherever the user actually clicked. Conflating them
  — seeking to the midpoint instead of the click — would have been a smaller diff but a worse
  feature, since it defeats the actual point (parking the playhead exactly where you meant to
  cut).

---

## v1.16.0 — Note editing (Layer 4) (2026-08-31 22:01)

**Review:** not yet

**Design docs:**
- Note editing (Layer 4): [Spec](superpowers/specs/2026-08-31-note-editing-design.md) [Plan](superpowers/plans/2026-08-31-note-editing.md)

**What was built:**

- `applyEdits(notes, edits)` in `lib/pitch.js`: a pure post-pass run after `interpret()`/
  `foldOctaves()`, applying six primitive edit types (`octave`, `pitchNudge`, `timeAdjust`,
  `delete`, `add`, `rangeDelete`) in sequence against the list as already modified by earlier
  edits in the same call. Edits are anchored to a time point, never a note index, so they
  survive `notes` being re-derived on every parameter tweak. A target that can't be found is
  returned in `orphaned` rather than thrown or silently dropped.
- Edit mode: an **Edit notes** toggle turns on click-to-select in the zoomed pane (a white
  outline, half-open hit-testing) and a ten-button toolbar — octave up/down, semitone up/down,
  time-nudge back/forward, split (composes a shrink plus a new tail note, or just a shrink
  within 5ms of an edge), delete, **+ Add note** (arm, then drag to place), and **Delete
  range** (drag the pane's bottom ~16px band to select a time range, independent of note
  selection).
- Drag-to-move/resize the selected note: body-drag moves both edges together, edge-drag
  resizes just that side, both floored at 20ms so a note can't invert or vanish.
- An edit-list panel: one row per user action (a split is one row, not two), each independently
  removable; a warning glyph when an edit's target has since disappeared; undo via a ↺ button
  or Cmd/Ctrl+Z, popping the most recent entry.
- Keyboard shortcuts for the selected note (↑/↓ pitch, Shift+↑/↓ octave, ←/→ time,
  Delete/Backspace) that take priority over the transport's own arrow-key-seeks-5-seconds
  while a note is selected.
- Export/Import: the whole editing session — detection params, the fold/HMM/pitch-clip
  toggles, the 簡譜 key settings, and the edit list itself — serializes to one JSON file and
  restores exactly, mirroring the app's existing manual stems-zip save/load pattern. Importing
  into a different song warns (filename mismatch) but still applies.

**Key technical learnings:**

- `[insight]` **Split isn't a data-model primitive.** Cutting a note at a point turned out to
  be exactly a `timeAdjust` (shrink the original) plus an `add` (the new tail note) — never
  its own edit type. That also absorbed two edge cases for free: cutting within 5ms of either
  boundary just becomes a shrink, no `add` needed, with no special-casing required to see it.
- `[insight]` **Anchoring edits to a time point, not a note index, is what makes the layer
  survive re-interpretation at all.** `notes` is rebuilt from `frames` on every parameter
  tweak, so an index is meaningless the instant it's re-derived; `applyEdits` re-locates every
  edit's target fresh, every call, against whichever note currently spans that time — which is
  also what makes `rangeDelete` naturally re-evaluate against new notes rather than a stale
  snapshot, with no extra code.
- `[note]` A classic script and an ES module still cannot share scope, so the same
  `window.sansBass` + `CustomEvent` seam `separate.js` and the transport already used carried
  three more events (`sansbass:noteedit`, `sansbass:editundo`, `sansbass:editmode`) without
  needing a new pattern.
- `[gotcha]` A split (or any drag) produces one undo/list-display **group** covering one or
  two primitive edits — `lib/pitch.js`'s `applyEdits` only ever sees the flattened primitives.
  Popping or removing a group's second half alone would leave the first half's change standing
  with nothing in the list to explain it; grouping at the `notes.js` layer, above `applyEdits`,
  is what keeps undo matching what the user thinks they just did.
- `[gotcha]` **`add` appending to the end of the list broke an assumption `lib/sonify.js`
  never had to state out loud.** `interpret()`'s output was always chronologically ordered, so
  `scheduleNotes`'s playback loop could safely stop the moment it saw a note past its
  scheduling horizon, trusting everything after was later still. A split-off or hand-added
  note sitting at the very end of the array but early in the song broke that silently — it
  showed correctly in the lane (purple, right where it should be) but never made a sound,
  because the loop gave up on a much-later note first and never reached it. Fixed by sorting
  a copy of the list once inside `scheduleNotes` itself, rather than asking every note-list
  producer to maintain an order only that one function actually depended on.

**Process learnings:**

- `[insight]` Two-stage subagent review (spec compliance, then code quality) caught two real
  ordering bugs baked into the plan's own literal code before either shipped, not just
  implementation slips. `notes.js`'s `reset()` unchecked the **Edit notes** checkbox directly,
  but a programmatic `.checked = false` never fires `change` — the one channel `app.js` had
  for learning the toggle changed — so its mirrored `editMode`/`selectedNote` state silently
  went stale on every song reset until a fix dispatched `sansbass:editmode` explicitly.
  Separately, `editRangeDelete()`'s dispatch-then-clear order left the amber range highlight
  and its delete button visibly stuck, because `dispatchEdit` synchronously round-trips
  through `reinterpret() → draw() → syncEditToolbar()` before returning — clearing
  `rangeSelection` first was the fix. Both were caught by an independent reviewer re-deriving
  behaviour from the running app rather than trusting the implementer's report, which is the
  entire point of not letting self-review be the only gate.

---

## v1.15.0 — Resuming the note at A (2026-08-31 15:49)

**Review:** not yet

**Design docs:**
- Resuming the note at A: [Spec](superpowers/specs/2026-08-31-loop-note-resume-design.md) [Plan](superpowers/plans/2026-08-31-loop-note-resume.md)

**What was built:**

- `envelopeAmplitude(tau, envLen, peak)` in `lib/sonify.js`: the percussive envelope written
  once as a closed-form function instead of only as a pair of scheduled ramps, so the curve
  can be entered partway. At `tau = 0` it returns the floor, so `skip = 0` reproduces the
  original envelope exactly and no ordinary note changes.
- Every scheduled event gained two numbers: `skip`, the seconds of the note already elapsed
  at the entry point, and `until`, the lap's B in audio-clock time. Both collection loops
  changed from *"starts after the entry point"* to *"is still sounding at the entry point"*.
- `spawn()` solves the envelope for the amplitude at `skip` and clamps the end to `until`.
  Ordinary notes get `skip = 0` and an `until` they never reach, so they take the identical
  path with no branch.
- `MIN_AUDIBLE = 0.01`: a remainder under 10 ms is a transient rather than a pitch, and it
  would cost an oscillator on every lap.
- Fourteen new tests; the suite went 185 → 199. No call-site change was needed in `notes.js`
  — `resync()` already passes `when`/`offset`/`loopA`/`loopB`, and both new numbers are
  derived from those four inside `scheduleNotes`.

**Key technical learnings:**

- `[insight]` The envelope **outlasts the note** for short notes: `envLen = dur * decay +
  release`, so with the piano spec a 50 ms note rings 82 ms. Any "clamp the note's end"
  change therefore has to clamp to the loop boundary, never to `note.end`, or it reshapes
  every note in the song while looking like a bug fix. Note the sign flips at
  `dur = 0.267 s` — past that, `decay = 0.85 < 1` makes the envelope *shorter* than the note.
- `[insight]` One symptom, three causes. The looping filter dropped the note, `loopBase`
  dropped it again on later laps, and without a loop it survived collection only to be
  dropped by `pump()` for being in the past. Fixing any one of them alone would have left
  the bug looking half-fixed — which is why the plan drove them as three separate tasks with
  a test each rather than as one change.
- `[gotcha]` `at` for a resumed note is pinned to the entry point with `Math.max(0, …)`
  specifically so `pump()`'s past-drop still works. Scheduling it at the note's true start
  would re-open the defect that once fired every elapsed note on one sample at 7× full scale.
- `[gotcha]` `until` has to be shifted per lap alongside `at`. Computing it once cuts every
  lap at lap 1's B — silence after the first pass, which reads as the loop breaking rather
  than as a truncation bug.
- `[note]` `MIN_AUDIBLE` is safe only because `interpret()` enforces `minDurationMs >= 20`.
  The two numbers are coupled and a test now says so.

**Process learnings:**

- `[gotcha]` **An RMS threshold placed in an exponential decay is a coin-flip, and it fails
  in the direction that looks like success.** Three of the plan's tests were mis-calibrated
  the same way, and all three were caught only by measuring the rendered samples instead of
  trusting the predicted pass/fail. The cut-at-B driver used a 50 ms note whose overhang past
  B was 32 ms of a curve already at 5.8e-5 — it passed against code that never truncated at
  all. Its sibling guard asserted `RMS > 0.001` across the last 10 ms of a fall to 1e-4
  (measured 7.6e-5) and so failed against *unmodified* code. The `MIN_AUDIBLE` driver
  entered a 0.2 s note 5 ms before its end, where the envelope is already at 1.9e-4, and
  passed with no floor in the code. The fix in each case was to move the measurement to where
  the envelope is still loud: a long note straddling B (RMS 0.031), and a *short* note for
  the 5 ms remainder (peak 6.0e-3).
- `[insight]` When a test must assert "this tail is unchanged", **compare two renders rather
  than pick a threshold**. The rewritten guard renders the note looped and unlooped and
  asserts the tails are equal to 1e-9 — that is the actual claim, it is exact, and it does
  not depend on guessing where in the decay the window lands.
- `[note]` The plan's own instruction — "trust what you measure and report a discrepancy
  rather than adjusting a test to match" — is what caught all three. Worth keeping in future
  plans: it licenses strengthening a test that is too weak to drive its own change.
- `[gotcha]` The by-ear step could not be done under automation. The live `AudioContext`
  stays `suspended`, `resume()` is refused, and the clock reads 0 — a synthetic click will
  not unlock it, only a real keypress. Everything here is verified offline against rendered
  samples; the live-graph confirmation is still outstanding.

## v1.14.0 — 簡譜, notes as scale degrees (2026-08-31 14:21)

**Review:** not yet

**Design docs:**
- 簡譜: [Spec](superpowers/specs/2026-08-31-jianpu-design.md) [Plan](superpowers/plans/2026-08-31-jianpu.md)

**What was built:**
- `lib/jianpu.js` — a pure classic script. `degreeOf(midi, tonicPc, mode)` returns
  `{digit, accidental, octaveIndex}`; `referenceOctave(notes, tonicPc)` picks the octave
  drawn bare, from the duration-weighted median.
- `notes.js` runs the already-built `detectKey(notesToChroma(notes))` after each
  interpretation and carries the 簡譜 selection in the `setNotes` payload beside `clip` —
  a display choice that never reaches `interpret()`.
- Three controls in the main notes row: a **簡譜** checkbox, a **1 =** tonic selector, a
  **major/minor** selector, and a **⇄** relative-key switch. The selectors are inert while
  the box is unticked.
- `app.js` draws degrees at both note-block sites and turns the lane's pitch axis into
  digits with 簡譜 octave dots — a dot above per octave up, below per octave down, none in
  the reference octave.
- `tests/jianpu.test.js`, 8 tests. Suite 177 → 185.
- **After review:** a new song hands the key back to automatic detection; the zoom pane's
  axis carries degrees and dots too; the bright gridline follows the tonic; a disabled ⇄
  dims. Behaviour rows N52–N55.
- **Whole-phrase detection (`hmm-v1`) is on by default**, and no longer labelled
  experimental in either locale. The checkbox stays, so `threshold-v1` is one untick away.
  Behaviour row N30 reversed.

**Key technical learnings:**
- `[insight]` A default that was right can be made wrong by a *later* feature, and nothing
  re-examines it. `hmm-v1` shipped off in v1.12.0 for one honest reason: its gain in
  octave-**down** errors was partly traded for octave-**up** errors. v1.13.0 then built
  octave folding, which corrects precisely that class and cannot change pitch class — so the
  argument for the default had quietly expired one release before anyone looked at it. The
  measurement in `docs/transcription.md` did not change; what changed is what sits
  downstream of it.
- `[insight]` The mode selector changes what the numbers **mean**, not which note is 1. In
  minor, ♭3/♭6/♭7 are degrees 3/6/7 — they are in the scale — so the chromatic notes are the
  raised ones. E♭ is `♭3` in `1=C major` and plain `3` in `1=C minor`. The two tables are not
  transpositions of one another, and writing one and transposing it for minor is the
  mistake this feature invites.
- `[insight]` A key and its relative share all seven pitch classes and differ only in which
  degrees carry weight, so `detectKey` cannot reliably separate them — which is exactly why
  it returns `relative`. The ⇄ button turns that irreducible ambiguity into a one-click
  choice rather than pretending the guess is authoritative.
- `[note]` 簡譜 octaves are counted from the **tonic**, not from C: a run 1–7 begins again at
  the next 1. Counting from C would put the boundary in the middle of the scale in every key
  but C.
- `[gotcha]` The axis labels only the home note when the lane is too tight for every
  semitone. That test was `pc === 0`, which is C — correct for note names, meaningless in
  簡譜, where the home note is the tonic.
- `[gotcha]` A new classic script has **two** registration sites, and missing either fails
  silently in a different way. `lib/jianpu.js` was added to `tests/test.html` but not to
  `index.html`, so `window.SansJianpu` was undefined in the player and `noteLabel()`'s
  `!window.SansJianpu` guard fell straight back to note names. The feature rendered
  *identically* to before — no throw, no console error, the unit suite fully green.

- `[gotcha]` A display mode needs a **reset story**, and `reset()` is where it belongs.
  `jianpu.auto` was set false on override and never set true again, so a key chosen for one
  song silently labelled the next one. Every note was wrong and nothing on screen said so —
  the selectors just sat there reading a value nothing had chosen for that song. Module state
  that survives a song change is the default, not the exception: `reset()` already existed
  precisely because `frames` had the same problem.
- `[insight]` Converting "the axis" is not one site. The lane and the zoom pane each have
  their own axis, and the first pass changed only the lane — leaving the pane you actually
  read pitches off showing degree blocks against a note-name axis. A spec table that says
  "pitch axis" in the singular will hide a second one; count the draw sites in the code, not
  the rows in the table.
- `[gotcha]` Changing which row is *labelled* without changing which row is *highlighted*
  half-undoes the change. The axis label moved from C to the tonic but the bright gridline
  did not, so in 1=G the bright rule and the bright label sat on different rows.
- `[note]` `.btn[disabled]` does not match `.mini`. The two `<select>`s beside ⇄ dim from
  Chrome's UA stylesheet, which made the button the only control in the group that looked
  live while disabled — easy to miss precisely because its neighbours behaved.

**Process learnings:**
- `[gotcha]` The lane is ~766 px for a whole song, so a note is a couple of pixels wide and
  **no note-block label is ever drawn there**. A verification that toggles 簡譜 and compares
  `toDataURL().length` on the lane therefore reports "unchanged" whether the code works or
  not — it was measuring a site with nothing to measure. The zoom pane, where a note is tens
  of pixels wide, is the only place block labels are observable. Instrumenting
  `fillText` to capture the actual strings found the truth in one call where four pixel
  comparisons had said nothing; the repo's standing rule — observe the outcome, not the
  parameters — extends to checking that the outcome you sampled *exists*.
- `[insight]` The fresh-context review earned its keep on the one thing the building session
  structurally could not see: the **second song**. Every verification run during
  implementation loaded one zip, so the whole class of "state that should reset" was outside
  the test. A reviewer starting cold asked "what happens on the next load?" as an ordinary
  question. Worth writing into the next plan's verification section explicitly — load a
  second song and re-check — rather than relying on a reviewer to think of it.

## v1.13.0 — octave folding (2026-08-31 12:14)

**Review:** not yet

**Design docs:**
- Octave folding: [Spec](superpowers/specs/2026-08-31-octave-fold-design.md) [Plan](superpowers/plans/2026-08-31-octave-fold.md)

**What was built:**
- `pitchBand()` — the singer's plausible range, duration-weighted median ± max(12, 3×MAD).
- `foldOctaves()` — shifts an out-of-band note by whole octaves toward its nearest **in-band**
  neighbours. Never adds or removes a note. A corrected one carries
  `fix: {from, state:'folded', shift}`; one it declines carries `fix: {from, state:'doubt'}`.
- `interpret()` applies it as a post-pass when `params.fold` is set, for both interpreters.
- `lib/sonify.js` skips doubtful notes in **both** collection loops.
- `app.js` gains a `NOTE_FILL` table: folded blue, doubtful gray, in both draw sites.
- A **Fix octave outliers** checkbox, off by default. The old **Clip octave outliers** was
  renamed **Fit the lane to the melody**.
- The bench page reports folded/doubtful counts and sweeps `confidentWithin`.

**Measured** (four tracks, `minDurationMs: 100`, `threshold-v1`):

| track | notes | folded | doubtful |
|---|---|---|---|
| ng_kipin | 187 | 9 | 14 |
| 6 南國的風 | 313 | 7 | 17 |
| 12 早安台灣 | 270 | 13 | 6 |
| 9 繼續向前行 | 342 | 22 | 37 |

Note counts identical with and without folding on all eight track × interpreter combinations.

**Key technical learnings:**

- `[insight]` **The two octave errors are opposites and only one is fixable at the frame
  layer.** `d(τ)` dips at every integer multiple of the true period — reads an octave low,
  次諧波, what `hmm-v1` fixed — and at `T/2`, `T/4`, `T/8` when the fundamental is weak, which
  reads octaves *high*: 泛音. Measured, the fundamental's dip is genuinely absent from the
  frame: it surfaces only at `candidateThreshold` 1.2 / `maxCandidates` 20, ranked fifteenth
  at p = 0.04, while the frame still prefers the wrong answer 2.5 to 1. The neighbouring
  notes resolve it and they exist only at the note layer.
- `[gotcha]` **A threshold can sit exactly on the failure mode it is meant to exclude.** A
  power-of-two harmonic error leaves a residual of 0 after the right octave shift; a 3rd or
  6th harmonic leaves **4.98** semitones. `confidentWithin: 5` therefore folded them and
  tagged them confident — 7 wrong folds per song on `threshold-v1`, 24 on `hmm-v1`. Changing
  `>` to `>=` would not have helped either, since 4.98 < 5 both ways.
- `[gotcha]` **Classifying by the thing you are testing proves nothing.** The spec claimed the
  confidence test separated foldable from unfoldable harmonics "exactly". It was circular:
  notes were classified power-of-two *because* they folded within the threshold. Classified
  independently the populations overlap, and no threshold separates them cleanly.
- `[insight]` **A percentile band cannot exclude a population that large.** At 16.6%
  contamination the 5th/95th percentile stretched to E2–D#5 and absorbed the very outliers it
  was meant to flag. Median and MAD are robust to a contaminated tail; percentiles at those
  fractions are not.
- `[gotcha]` **A test can pass for the wrong reason and hide the branch that matters.** Every
  positive fold fixture had residual 0 and the negative guard had residual 5, so the whole
  suite was green for *any* threshold in [0, 5) — including the 3 that reintroduces the bug.
  Same shape as `pitchBand`'s MAD branch, which no test exercised while the floor won every
  time. Both needed a fixture landing *between* the two behaviours.
- `[gotcha]` **A throw in the ribbon draw loop does not fail loudly.** `tick()` re-arms the rAF
  chain only after `draw()` returns, so one malformed note freezes the playhead for the rest
  of playback while the audio keeps going. `noteFillKey` degrades rather than indexing a
  colour table with an unknown state.
- `[gotcha]` **Contrast has to clear the floor in the *dim* variant, not just the active one.**
  `paint()` blits the idle layer across the whole lane and clips active only over the played
  portion, so dim is what a note looks like for most of a listen — and the note name is drawn
  on top of the fill. The first gray measured 1.6:1 dim, with the name at 1.5:1.
- `[note]` The worker builds its frames message from an explicit field list, so a new array on
  the track has to be named there too — the lesson from v1.12.0, which held again here.

**Process learnings:**

- `[insight]` **Two review gates catch different things, and the second one earned its keep.**
  Spec review passed Task 2 correctly — the implementation was byte-for-byte faithful to the
  plan. The defect was *in the plan*, reproduced faithfully. Only a reviewer asked whether the
  code serves its purpose, rather than whether it matches instructions, could have found it.
  Five defects this phase traced to the plan rather than to an implementer.
- `[gotcha]` **A measured figure quoted in a design doc goes stale when a parameter moves.**
  The spec said doubtful notes cost ~1.6% of note time. That was measured at
  `confidentWithin: 5`; at the shipped 1.5 it is 7.5–8.1%, and the decision to keep 1.5 had
  been taken against the wrong number. Re-measure every quoted figure after a tuning change.
- `[note]` An ESM named import of a missing export fails the **whole module** at link time, so
  the red step for a not-yet-written function is an empty `window.__testResults` plus one
  console `SyntaxError` — not a test failure. Worth telling anyone executing a TDD plan here.

## v1.12.0 — HMM note decoding, switchable (2026-08-30 22:41)

**Review:** not yet

**Design docs:**
- HMM note decoder: [Spec](superpowers/specs/2026-08-30-hmm-decoder-design.md) [Plan](superpowers/plans/2026-08-30-hmm-decoder.md)

**What was built:**
- `yinFrame` returns `candidates` — every local minimum of the CMND curve below a generous
  0.6 threshold, parabolically refined and weighted by depth, normalised and ordered. The
  single `tau` it already returned is untouched.
- `f0Track` carries a per-frame `candidates` array, populated **above** the confidence gate
  so a frame rejected as unvoiced still offers its candidates to the decoder.
- `viterbiPitch()` — Viterbi over those candidates, pricing movement per semitone and
  voicing transitions. This is the octave fix.
- `segmentNotesHmm()` — Viterbi over note states, one per semitone plus silence, pricing
  onsets instead of flooring duration. O(states) per frame via one precomputed minimum.
- `interpret()` — dispatches on the interpreter name, degrading to `threshold-v1` for an
  unknown name or a track with no candidates.
- A **Whole-phrase detection** checkbox under Advanced, off by default, both locales.
- An `== INTERPRETERS ==` comparison table in `tests/notes.html`, both interpreters over
  identical frames.

**Measured** (vocals, `minDurationMs: 80`; percentages are the share of note time more than
8 semitones from the duration-weighted median pitch):

| track | notes | an octave low | an octave high |
|---|---|---|---|
| 6 南國的風 | 437 → 357 | 20.2% → **8.5%** | 1.6% → 1.1% |
| 12 早安台灣 | 368 → 311 | 15.3% → **10.3%** | 1.4% → 3.2% |
| 9 繼續向前行 | 496 → 486 | 19.6% → **12.5%** | 1.8% → 4.8% |

The verdict is the plan's **mixed** outcome: a real, consistent gain on the error the phase
existed to fix, partly traded for a new one. It stays opt-in.

**By ear** (the check the numbers cannot make): confirmed better, and most clearly so at a
**100 ms** shortest-note setting, where it recovers more correct notes than `threshold-v1`.
The failure mode to fear — the melody flattening into a drone because `pitchStepCost` is too
high — was not heard, so the cost defaults stand as shipped.

**Key technical learnings:**

- `[insight]` A local rule cannot see a 16-frame excursion. The 5-frame median filter was
  never going to reach sustained octave errors, and widening it blurs real melody instead —
  the fix had to be a whole-sequence optimum, not a bigger window. A 13-frame median is
  still an octave low mid-dip; there is a test that asserts exactly that, so the thing being
  solved stays visible.
- `[insight]` The information needed was already in the CMND curve and was being thrown
  away. `yinFrame` returned the first dip below threshold; the true period's dip was still
  there, just above it. No new signal processing was required — only not discarding.
- `[insight]` Fixing octave-*down* errors introduced octave-*up* ones. The candidate list
  keeps the dip at half the true period as well as the one at twice it, and the
  whole-sequence optimum sometimes latches onto the harmonic. Net off-melody time still
  improves on all three tracks, but assuming "fewer low outliers" means "better" would have
  missed this — measure both tails.
- `[gotcha]` The bench page's `pitch range` metric **widens** under `hmm-v1` on tracks where
  it got better. It is reading the octave-up tail, not a wider melody. The plan named it one
  of "the two that decide this phase"; on its own it points the wrong way.
- `[gotcha]` `touching same-pitch` is always 0 for `hmm-v1` **by construction** — runs of one
  note state are maximal, so two adjacent notes can never share a pitch. Reading 8 → 0 as
  reduced fragmentation would be reading an artifact of the metric's definition.
- `[gotcha]` **The worker builds its frames message from an explicit field list.** Adding
  `candidates` to `f0Track` was not enough: `notes.worker.js` names each array it posts, so
  the new one silently never crossed the boundary. Every unit test stayed green — the pure
  functions never cross `postMessage` — while `hmm-v1` threw on `undefined.length` in the
  app and the note count just never updated. A green suite plus a stale number is the
  signature. There is now a test at that boundary.
- `[note]` Making the analysis change purely additive is what made the comparison
  trustworthy — both interpreters run on byte-identical frames, so any difference is
  attributable to the interpreter alone. Verified on real audio, not just synthetically:
  running `detectNotes` through the pre-change module and the current one over all 20,086
  frames of `6 南國的風` gave 0 differing cents, 0 differing confidences, and byte-identical
  437-note lists.

**Process learnings:**

- `[gotcha]` The plan's recorded baseline ("229 notes, 4.8% an octave low, 8 touching") mixed
  two different `minDurationMs` settings — 229 notes is the bench default of 120, while the
  4.8%/8-touching figures came from the spec's 437-note run at 80. Three of the four numbers
  matched exactly once measured at the same setting, and the fourth turned out to be a
  metric-definition difference. Before treating a baseline mismatch as a broken invariant,
  check that both numbers were taken under the same conditions.
- `[note]` An ESM named import of a missing export fails the **whole module** at link time,
  so the red step for a not-yet-written function is an empty `window.__testResults` and one
  console `SyntaxError` — not the "is not a function" the plan predicted. Read the console,
  not the results object, when the suite reports nothing at all.

## v1.11.0 — notes ribbon in the player (2026-08-30 20:59)

**Review:** not yet

**Design docs:**
- Notes ribbon: [Spec](superpowers/specs/2026-08-30-notes-ribbon-design.md) [Plan](superpowers/plans/2026-08-30-notes-ribbon.md)

**What was built:**
- `lib/ribbon.js` — classic script, `window.SansRibbon`: duration-weighted vertical range
  with octave clipping, and contour polylines that break at unvoiced frames.
- `notes.worker.js` — ESM, runs `decimate` + `f0Track` off the main thread.
- `notes.js` — ESM, mirrors `separate.js`: owns the worker, and re-derives notes on the
  main thread whenever a parameter moves.
- `app.js` — a ribbon lane built inside `buildUI()`, `renderRibbon`, and new
  `window.sansBass` members (`stemBuffer`, `setNotes`, `notesAudio`, `transport`).
- The lane **plays**: a `GainNode` into `master`, muted by default, toggled from its own
  name, with a volume slider. It stays out of `tracks`, so mute-all and solo ignore it.
  `lib/sonify.js` gained lap generation so the synth follows A–B repeat.
- The lane is **resizable** (drag its bottom grip, persisted in `localStorage`) and drawn
  as a piano roll: a band per semitone, black keys shaded, C brighter, names at the left.
- A **zoomed pane** above the lane shows a window of the song — 10 s by default, 2–60 s by
  wheel — following the playhead while playing and panning by drag when stopped.
- Asset version v1.9.0 → **v1.11.0**. v1.10.0 never appears in a `?v=` because that
  release changed no file `index.html` loads.

**Measured, on `6 南國的風`:**

| `minDurationMs` | notes | re-derive |
|---|---|---|
| 80 | 437 | 13.2 ms |
| 120 (default) | 228 | — |
| 150 | 171 | 11.1 ms |
| 200 | 99 | 15.1 ms |

Analysis for the same track is ~2.0 s warm and ~7 s cold. The whole architecture is that
ratio.

**Key technical learnings:**
- `[gotcha]` `el.lanes.innerHTML = ''` destroys anything parked inside `#lanes`, so the
  ribbon lane is built in `buildUI()` rather than declared in `index.html`. A static
  element would have worked for exactly one song.
- `[gotcha]` Canvas width must come from `canvas.clientWidth`, not
  `canvas.parentElement.clientWidth`. The parent is the `.lane` grid, 224 px wider than
  the canvas — the ribbon drew on a different time scale than the waveforms above it, and
  the symptom was a lane that looked plausible and was silently misaligned.
- `[gotcha]` `.notes { display: flex }` is exactly the trap the `[hidden]` rule exists for.
  Verified with `getComputedStyle().display`, never `.hidden`.
- `[insight]` Reusing `paint()` cost nothing but keeping the `{ idle, active, h, w }` layer
  shape, and bought the playhead, A–B shading and clip behaviour for free. Matching an
  existing contract beat writing a second draw path.
- `[insight]` Splitting analysis from interpretation in `lib/pitch.js` during the PoC — a
  boundary drawn for testability, not for this — is the only reason a live slider is
  possible. Re-deriving measured 92× cheaper than re-analysing.
- `[gotcha]` **A screenshot found what every assertion missed.** The contour drawn as a
  polyline at whole-song width joins pitches ~26 frames apart, filling the lane with
  near-vertical strokes and burying the notes. Widths matched, layers existed, pixels were
  non-zero — every property check passed against a view that was unreadable. Per-pixel
  min/max bands fixed it, the same way waveform lanes have always solved it.
- `[gotcha]` **`const` in the temporal dead zone killed the entire app.** `let ribbonHeight
  = readRibbonHeight()` sat above the `const RIBBON_H_DEFAULT` it depends on. Function
  declarations hoist; `const` does not. Because `app.js` is one flat run of top-level
  statements, the throw at line 21 meant every listener below it never registered — the
  page loaded and did nothing at all. Exactly the failure mode the `?v=` cache-buster
  exists to prevent, arriving by a different route.
- `[insight]` A zoomed pane costs nothing that zooming the lane would have cost. The
  full-width lanes keep one shared `frac = t/duration` mapping — which seeking, the
  playhead and A–B repeat all read from — and the pane gets its own. Zooming the lane
  itself would have broken that for every lane at once.
- `[gotcha]` The zoomed view needs its own peak resolution. Lane peaks are 1400 buckets
  across the *whole song*; slice 10 s out of a 233 s track and you get 60 buckets, blockier
  than the thing the zoom exists to make readable.
- `[gotcha]` **Clamping a past event to "now" turns a mute into a detonation.** The synth
  scheduler did `Math.max(e.at, ctx.currentTime)`, which reads as defensive and is not:
  press play with the notes lane muted, unmute a minute later, and `resync()` re-schedules
  against the original `t0`, mapping every elapsed note to a time before now. All of them
  fired on the same sample — measured at **7.3x full scale**. A past event must be
  *dropped*; the lap-0 filter already said so and this one line disagreed.
- `[gotcha]` **A running median over an unbounded window is O(n² log n).** `segmentNotes`
  re-mapped and re-sorted the whole open note every frame. Real vocal stems hid it by
  breaking into short notes; a sustained 120 s tone took **5.9 s** — on the main thread,
  during the slider drag the whole layer split exists to keep fast. Bounded to a trailing
  32 frames: **21 ms**, linear, and real-track note counts moved by one note in 437.
- `[insight]` A code review with fresh context found both of those, plus a `seek()` that
  had quietly come to depend on `lib/ribbon.js` — an optional visualisation library
  becoming load-bearing for core transport. Ten browser sessions of my own testing had not
  surfaced any of them, because I only ever exercised the paths I had just written.
- `[gotcha]` `aheadSeconds: Infinity` plus a loop region is an infinite generator: the
  horizon is never reached, so laps are produced for ever. It froze the test page. Bounded
  by the context's own render length, which an `OfflineAudioContext` knows and a live one
  does not.
- `[gotcha]` **Octave errors on this material are not rare blips.** 4.8% of note time sits
  in MIDI 36–47, an octave below the melody, in notes with a *median duration of 186 ms*.
  A 3rd-percentile clip cannot exclude them, so the lane spans 27 semitones and the melody
  is squashed. Threshold tuning cannot fix a sustained error; this is direct evidence for
  the Viterbi note decoder described in `docs/transcription.md`.

**Process learnings:**
- `[gotcha]` A page loaded before an edit keeps the old `app.js` in memory. `renderRibbon
  is not defined` came from testing against a stale page, not from a hoisting problem —
  the same class of confusion the `?v=` cache-buster exists to prevent in production.
- `[note]` A stems zip can be built in the browser with `lib/zip.js` and fed through
  `#file-input` via `DataTransfer`, which exercises the real load path — `ensureAudio()`
  included — instead of reaching past it into the seam.

## v1.10.0 — notes and key from a vocal stem (2026-08-30 14:17)

**Review:** not yet

**Design docs:**
- Notes and key detection: [Spec](superpowers/specs/2026-08-30-pitch-detection-design.md) [Plan](superpowers/plans/2026-08-30-pitch-detection.md)

**What was built:**
- `lib/pitch.js` — pure ESM, 433 lines: 4:1 anti-aliased decimation, YIN, voicing gate and
  median smoothing, note segmentation, duration-weighted chroma, Krumhansl-Schmuckler key.
  No DOM, no `AudioContext`, no Worker — it takes `Float32Array`s and returns data, so the
  app can wrap it in a Worker later without the module changing.
- `tests/pitch.test.js` and `tests/sonify.test.js` — 36 tests over synthesised input.
  No audio files, no network.
- `lib/sonify.js` — pure ESM: plays the detected notes back as tones (piano or guitar
  timbre) so a transcription can be judged by ear against the stem it came from.
- `tests/notes.html` — bench page: key block, phrase view, note table, `window.__notes`,
  and a transport that plays the synthesised transcription **against** the stem on one
  shared `t0`, with independent synth and stem gain. Every threshold is overridable from
  the query string; phrase lines carry their start second for seeking.
- No UI, no app wiring. Separation is unchanged, and the `?v=` asset version stays at
  v1.9.0 because nothing `index.html` loads was touched.

**Measured on three tracks** (233 s, 209 s, 244 s vocal stems):

| track | notes | key | margin | runner-up | mean dev |
|---|---|---|---|---|---|
| 6 南國的風 | 437 | D# major | 0.244 | C minor | +2.2¢ |
| 12 早安台灣 | 368 | G# major | 0.037 | D# major | −1.1¢ |
| 9 繼續向前行 | 496 | B major | 0.039 | F# major | −1.9¢ |

Roughly 7 s per 4-minute track, about 33x realtime, single-threaded on the main thread.

**Key technical learnings:**
- `[insight]` Decimating to 11025 Hz before YIN is what makes pure-DSP pitch tracking
  viable here. The lag search is 16x cheaper, taking a 4-minute track from ~2.1e10
  operations to ~1.3e9. Measured 7.0 s for 233 s of audio — no model download needed, and
  unlike separation there is no reason to gate this to desktop.
- `[gotcha]` Decimating without an anti-alias lowpass folds everything above 5512 Hz into
  the f0 search range, where it is indistinguishable from a real fundamental. The 63-tap
  windowed sinc is load-bearing, not polish.
- `[gotcha]` YIN's cumulative mean must be accumulated from tau = 1 even when the search
  starts at tauMin. Starting the running mean at tauMin changes the normalisation and moves
  the threshold comparison.
- `[insight]` **The predicted key confusion was the wrong one.** The design expected
  tonic-vs-relative errors (A minor read as C major), because a key and its relative share
  all seven pitch classes. What actually showed up on two of three tracks was
  **tonic vs dominant** — Ab 0.718 against Eb 0.680, B 0.853 against F# 0.813. A sung
  melody leans hard on degrees 1 and 5, and the dominant key's profile weights those two
  the same way. The bass stem fixes this at least as well as it fixes the relative case,
  since bass notes land on roots.
- `[insight]` Reporting the margin to the runner-up is what made the above visible at all.
  Track 1 at 0.244 and tracks 2-3 at ~0.038 are qualitatively different answers, and
  without the margin all three would have read as equally confident.
- `[note]` Mean deviation from equal temperament came out within ±2.2 cents on all three
  tracks, so these records sit on A440 and a wrong note cannot be blamed on tuning.
- `[note]` Duration-weighted chroma, rather than note counts, is what lets a held tonic
  outrank a flurry of passing notes.

**Process learnings:**
- `[gotcha]` A synthesised two-note test needs its silent gap sized against the *analysis
  window*, not the gap threshold. Only `gap - window` worth of frames fall entirely inside
  the silence, so an 80 ms gap with a 46 ms window yields ~2 fully-silent frames — exactly
  `gapFrames`, leaving the test balanced on its threshold. Caught in plan review, before
  it could flake.
- `[gotcha]` A 32-bit LCG written `seed * 1103515245` exceeds 2^53 and loses precision as a
  double before `&` coerces it. `Math.imul` is the 32-bit multiply.
- `[insight]` The rAF lesson demonstrated itself, in the good way. Driving the bench page's
  transport from an automated (hidden) tab, the playhead advanced 2.00 s over 2 s of wall
  clock and every note landed correctly — while `requestAnimationFrame` fired **zero**
  frames in 1.2 seconds, so the on-screen readout never moved. Transport on the audio
  graph, drawing on rAF: the split is what let one half keep working while the other was
  suspended entirely. The corollary is that a hidden tab cannot verify anything drawn.
- `[gotcha]` Sonify the **quantised** MIDI pitch, not the measured cents. Replaying the
  measured pitch reproduces the performance and therefore always sounds "right"; playing
  what the transcription claims is what makes a wrong note audible against the singer.
- `[note]` `exponentialRampToValueAtTime` cannot reach or leave zero, so a note envelope
  needs a small floor (1e-4) at both ends rather than a clean 0.
- `[note]` An `OfflineAudioContext` never advances `currentTime` on its own, so a
  lookahead scheduler queues nothing there. `lib/sonify.js` takes `aheadSeconds`, and the
  tests pass `Infinity` to schedule everything up front — which is what makes the note
  scheduler testable by rendering and inspecting actual samples.

## v1.9.0 — favicon and home-screen icon (2026-08-26 14:29)

**Review:** not yet

**Design docs:**
- Favicon: [Spec](superpowers/specs/2026-08-26-favicon-design.md) [Plan](superpowers/plans/2026-08-26-favicon.md)

**What was built:**
- `icons/icon.svg` — six bars in the stem colours, in lane order, with the bass lane
  flattened to a grey stub. The gap is the point: the app exists so you can play that part
  yourself, so the mark is the song *sans bass*.
- `scripts/make-icons.sh` rasterises it to a committed 32 px favicon and a 180×180
  apple-touch-icon. Regeneration only — nothing runs it at serve or deploy time, so the
  no-build-step constraint is untouched.
- Three `<link>`s and a `<meta name="theme-color">` in `<head>`, all relative paths so the
  per-PR preview at `/pr-<N>/` resolves them.
- The same mark in the header, left of the wordmark, as an `<img>` pointing at
  `icons/icon.svg` — reused, not inlined a second time.
- `tests/versions.test.js` widened from `.js|.css` to `.js|.css|png|svg`.

**Key technical learnings:**
- `[gotcha]` iOS ignores an SVG `apple-touch-icon`. The home-screen tile has to be a PNG,
  which is the entire reason a rasterising script exists in a project that has no build step.
- `[gotcha]` `rsvg-convert` leaves the canvas transparent wherever the SVG does not paint,
  and iOS composites a transparent tile onto black. `--background-color` is what guarantees
  an opaque icon — the background `<rect>` inside the artwork is not, because a later margin
  or viewBox change would silently reintroduce transparency.
- `[insight]` The cache-buster guard only protects the file types its regex lists. It had
  been `.js|.css` since v1.4.0, so adding image assets without widening it would have created
  exactly the silent staleness the test exists to prevent — and the suite would have stayed
  green while doing it. Verified by adding the three `<link>`s unversioned first and watching
  the widened test name all three.
- `[note]` Chrome fetches the favicon outside the page's network panel, so
  `read_network_requests` shows nothing. The `serve.sh` access log is the observation that
  works: a 200 for `icons/icon.svg?v=1.9.0`, and no `/favicon.ico` probe.
- `[note]` iOS applies its own corner mask to a home-screen icon, so the artwork ships full
  bleed. Pre-rounded corners render as a visible double radius.
- `[gotcha]` The header mark costs 36 px, which is enough to push the bar into horizontal
  overflow below ~348 px — the five items had been fitting with almost nothing to spare.
  Chrome will not resize a window narrower than about 500 px, so the honest way to measure
  this is an `<iframe>` at the target width: it gets its own viewport and evaluates `@media`
  for real, where a cloned element in the main document does not. Hence
  `@media (max-width: 359px) { .brand-mark { display: none } }`.

## v1.8.0 — separation is a desktop feature (2026-08-21 22:25)

**Review:** not yet

**Design docs:**
- Handheld separation gate: [Spec](superpowers/specs/2026-08-21-handheld-separation-gate-design.md) [Plan](superpowers/plans/2026-08-21-handheld-separation-gate.md)

**What was built:**
- `lib/platform.js` — a pure `isHandheld(win)` predicate, coarse pointer AND multi-touch.
- The separation panel now holds one sentence instead of four controls on a phone or tablet.
- The drop zone stops promising in-browser separation there.
- `separate-handheld-blocked`, fired with `once()`.
- README gains a desktop-only caveat as the first bullet under Step 3b; `CLAUDE.md` gains
  the gate as a gotcha, so the next session does not try to make separation run on a phone.
- Verified on a real iPhone against the `pr-11` preview, which is the only way S14–S16 can
  be checked end to end — a handheld is not reachable from browser automation.

**Key technical learnings:**
- `[gotcha]` **Forcing `executionProviders: ['wasm']` does not change the ORT runtime binary.** `ort.webgpu.bundle.min.mjs` loads the asyncify-instrumented `ort-wasm-simd-threaded.asyncify.wasm` (24.3 MB) whatever provider you name; the plain 13.5 MB binary only ships with `ort.wasm.bundle.min.mjs`. Three rounds of "we tested WASM" were never true.
- `[insight]` **iOS separation dies at the first `session.run()`, and it is not memory capacity.** A live session idles happily, and the same device committed 1920 MiB of WASM heap. The accumulators, the model, the memory floor, WebGPU and asyncify were each ruled out by measurement. `N_SAMPLES = 343980` is baked into the ONNX graph, so nothing in this repo can shrink the working set.
- `[insight]` **Swapping an i18n *key* on the element beats branching inside `t()`.** `SansI18n.apply()` re-reads `data-i18n-html` on every run, so the language toggle keeps working for free and no key ever means two strings.
- `[gotcha]` **`track()` inside `refresh()` would fire all session** — that function runs on a 400 ms interval. `once()` is the verb for "did this visitor ever reach X".
- `[note]` Safari's Web Inspector memory graph does not show the WebKit GPU process at all, which is why the first crash looked like a WebContent problem for three rounds.
- `[insight]` **A handheld can be faked convincingly enough to test the real parse-time path.** DevTools emulation is not reachable from browser automation, but an `srcdoc` iframe inherits the parent's origin: prepend `<base href="/">` and one inline script that overrides `matchMedia` and `maxTouchPoints`, and the page's own `app.js` and `separate.js` then parse against a coarse-pointer window. That caught the whole gate — key swap, four hidden controls, single analytics fire, language toggle — without a device.
- `[gotcha]` **`#lang-toggle` is a container, not a button.** The handler delegates via `e.target.closest('button[data-lang]')`, so a synthetic click on the `<div>` silently does nothing and reads exactly like a broken language switch. Click `button[data-lang="en"]`.

**Process learnings:**
- `[insight]` **The user's own observation broke the investigation open.** "It crashes even on a 30-second clip" falsified a memory-scaling theory that two rounds of arithmetic had made look solid. Cheap evidence from the person holding the device beat confident reasoning.
- `[gotcha]` **Running the destructive probe first poisoned the next measurement.** A 1.9 GiB allocation ladder immediately before an inference probe left the phone under memory pressure; the result had to be thrown away and re-run after a force-quit.
- `[note]` Deliberately deleting the new `en` key for one reload proved the same-keys-in-both-locales guard actually covers it. A guard you have never seen fail is a guard you are trusting on faith.

## v1.7.0 — Usage analytics (2026-08-21 17:36)

**Review:** not yet

**Design docs:**
- Usage analytics: [Spec](superpowers/specs/2026-08-21-analytics-design.md) [Plan](superpowers/plans/2026-08-21-analytics.md)

**What was built:**
- `lib/analytics.js` — `track` / `once` / `bump`, its own queue, and the GoatCounter transport.
- Events across the whole surface: loads, load errors, folder drops, the separation
  lifecycle, model cache-vs-download, the WebGPU-vs-wasm split, and interaction intensity.
- `separate.worker.js` now reports `cached` on its `ready` message.
- `tests/analytics.test.js` — 14 unit tests against an injected sink.

**Key technical learnings:**
- `[insight]` Power-of-two buckets fired as they are crossed beat both the alternatives.
  Exclusive buckets need a session-end flush, and GoatCounter documents no `sendBeacon`
  support — so a dropped flush loses the whole session, biased toward mobile. Firing every
  occurrence and taking a mean is the statistic one power user distorts most. Buckets need
  no flush and no assumption about what the dashboard displays.
- `[gotcha]` GoatCounter's documented `//gc.zgo.at/count.js` fails `tests/versions.test.js`.
  That test exempts external URLs with `url.startsWith('http')`, and a protocol-relative URL
  fails it — so the tag is read as a local asset missing its `?v=`. Use `https://`.
- `[gotcha]` `play()` is re-entered by `seek()` and `refreshLoop()`. Instrumenting it counts
  every scrub during playback as a play. `toggle()` is the real gesture boundary. Verified
  the only way that means anything: scrub while playing and confirm `seek`/`seek-2` appear
  and a second `play` does not.
- `[gotcha]` GoatCounter filters localhost by default, so every event fired from
  `serve.sh` silently vanishes. Indistinguishable from broken instrumentation. The fix is
  not `allow_local` — that pollutes the real dashboard with dev reloads — but the injectable
  sink, which was already there for the tests.
- `[note]` GoatCounter has no queue for calls made before its async script loads; its docs
  recommend polling. `lib/analytics.js` owns a capped queue and a bounded poller instead.
- `[insight]` Pin an empty `title` on every GoatCounter call. It fills that field from the
  document title when omitted, which is safe here only because `document.title` is the
  static `app.title` string. The song name lives in `el.title`, not the document title —
  but "`<song> — sans_bass`" is an obvious future change, and it would quietly start
  shipping song names. The defence costs one property and removes a whole class of
  future leak.

**Process learnings:**
- `[insight]` A `once()` event that has already fired is still observable after the fact:
  call it again with a recording sink and watch it be suppressed, against a control name
  that is not. That is how the load-time `lang-zh-TW` event was verified even though it had
  already drained into GoatCounter before any test sink could be installed.
- `[gotcha]` The `model-cached` branch is the one you get for free and the one that proves
  nothing. Both worker branches only got covered by deleting the Cache Storage entry and
  letting the 285 MB model re-download — which re-caches itself, so the profile ends up
  where it started.

---

## v1.6.0 — Beta-test refinements (2026-08-21 16:00)

**Review:** not yet

**What was built:**

- **One load button.** `Load song` and `Load zip` become a single **Load song or zip** and a
  single `#file-input`; `loadAny()` dispatches on the extension, and `accept` lists both
  sets so the file dialog still greys out everything unloadable. The drop handler shares the
  same `isZip` and the same `loadAny`. The input clears its own `value` on `change`, so
  picking the same file twice in a row loads it twice.
- **`0` is a real toggle.** With every lane on and no snapshot saved, it now mutes
  everything; press again and they all come back. The button is never disabled, and its
  label carries the third state: **Unmute all** / **Restore previous** / **Mute all**.
  All-lanes-off deliberately takes no snapshot.
- **The mode dropdown blurs on `change`.** It had been keeping focus and silently disabling
  every keyboard shortcut.
- **The keyboard hint is legible.** 11px → 12.5px, `--dim` → `#a3a3b2` (~4.7:1 → ~7.8:1 on
  the background), and moved onto its own full-width row via `flex: 1 0 100%` inside the
  wrapping `.controls`. `c` now says what it clears — the A–B loop, not a bare "clear" — and
  the badge's Clear button gained a matching `title`.
- **A written instruction that the lane's name block toggles the track**, as its own span so
  it survives at ≤640px where the key list is hidden.
- **`.lane-name` looks clickable without being hovered:** its own panel tint, a divider
  against the waveform, and rounded left corners hugging the lane.
- Everything bumped to `?v=1.6.0` (10 URLs across three files).
- `docs/behaviour.md`: U5 rewritten, and U5a / L18 / L19 / M2a / M2b / P5 / N8a added.

**Key technical learnings:**

- `[insight]` **A disabled control is not a neutral answer to "nothing to do here".** `0`
  and the all-toggle were deliberately dead when every lane was already on with no snapshot
  saved — defensible in the abstract, and U5 in `docs/behaviour.md` specified it that way on
  purpose. But that is precisely the state a freshly separated song *starts* in, so the very
  first press a new user ever makes was always the dead one, and it read as a broken key
  rather than as a considered no-op. The fix was not better feedback for the no-op; it was
  noticing the state had a useful action available (mute everything, then build the mix back
  up one lane at a time) and that "nothing to do" had been a failure of imagination.
- `[insight]` **A picker that asks the user to classify the input before opening is asking a
  question the code can answer.** Two buttons meant getting it wrong was possible — pick the
  zip under **Load song** and you got "not an audio file" for a file the app can read
  perfectly well. The extension already carries the answer. Same two inputs, same two code
  paths, one fewer decision.
- `[gotcha]` **A `<file>` input does not fire `change` when you pick the same file twice.**
  With two inputs this was rare enough to never surface. With one it is the obvious retry
  after a decode error, and a silent no-op there looks exactly like a dead button. Clearing
  `value` after reading `files[0]` is the whole fix — and it has to happen *before* the
  async load, not after, or an error path can skip it.
- `[gotcha]` **A focused `<select>` swallows every global hotkey, and nothing about that is
  visible.** `app.js` ignores keydown aimed at `input|select|textarea` — it has to, or
  `←`/`→` would seek instead of moving the selection. But a `<select>` keeps focus after a
  choice, so from the user's side the shortcuts simply stopped working, with no state on
  screen to explain it and no error anywhere. `el.mode.blur()` on `change` is the fix. Any
  future control that takes focus needs the same thought.
- `[insight]` **Hover-only affordance is invisible on touch, and nearly invisible on
  desktop.** `.lane-name` had been the full-height click target since v1.2.2 and had a
  `title` and a `:hover` background, and testers still did not find it. A target has to look
  like a target when the pointer is somewhere else entirely — a persistent tint and a
  divider, not a hover state. Saying it in words on screen was the other half; the tooltip
  was never going to do that job.
- `[gotcha]` **A gap is not a separator when both halves share a colour and a face.** The
  click hint and the key list laid out as flex row items 18px apart read as one run-on
  monospace sentence. Stacking them — `flex-direction: column` — was the whole fix, and it
  only showed up in a screenshot; the computed styles were all exactly as intended.
- `[note]` The markup changed shape (`#song-input` is gone), so this needed the `?v=` bump
  in its own right rather than riding on the next release — a stale `app.js` against this
  `index.html` is the v1.4.0 failure mode exactly.

**Process learnings:**

- `[insight]` **"Here is what went wrong" is not the same as "here is what should happen."**
  Item 10 of the report — *the behavior press 0 when all tracks are unmuted for the first
  time* — named a state and a key and stopped. Three different fixes were consistent with
  it (mute all, explain the no-op, leave it alone), each a different product decision.
  Asking cost one round trip; guessing would have cost a rebuild. The other six items were
  unambiguous and were simply done.
- `[note]` The `0`-key change was verified by patching `AudioParam.setTargetAtTime` and
  reading the ramp values across the whole seven-press cycle, per the standing rule in
  `docs/behaviour.md` — observe audio, not parameters. The label transitions came along in
  the same table, which is what made the missing snapshot rule obvious.

---

## v1.5.0 — Interface i18n (2026-08-21 11:09)

**Review:** not yet

**Design docs:**
- Interface i18n: [Spec](superpowers/specs/2026-08-21-i18n-design.md) [Plan](superpowers/plans/2026-08-21-i18n.md)

**What was built:**

- `lib/i18n.js` — a classic script owning one dictionary for both locales (68 keys each) plus
  the runtime: `t` / `has` / `apply` / `detectLocale` / `storedLocale` / `setLocale` /
  `getLocale` / `init`. `separate.js` is an ES module and cannot share scope with `app.js`,
  so both reach the single dictionary through `window.SansI18n`.
- Static copy in `index.html` annotated with three attribute forms: `data-i18n` →
  `textContent`, `data-i18n-html` → `innerHTML` (our own dictionary values only),
  `data-i18n-attr="title:key,aria-label:key"` → `setAttribute`.
- A segmented 中文 / EN toggle in the header. An explicit choice persists; the first visit
  deliberately does not.
- `retranslate()` re-renders the five stateful strings **in place** — mode dropdown
  (selection preserved), lane names, loop badge, all-toggle label, status line — plus the
  separation panel via its own `langchange` listener. No reload, no re-decode, no waveform
  re-render.
- Zip errors translated by the stable `code` `lib/unzip.js` already throws, leaving that
  file untouched.
- `tests/i18n.test.js`: 13 tests covering key parity, placeholder parity, the detection
  table, markup-key coverage, and the stem-filename invariant.
- `file://` support dropped: `separate.js` now loads as a plain `<script type="module">`
  with no protocol guard. `CLAUDE.md` and `docs/behaviour.md` updated to match.
- A zip's own filename now titles the player when the zip is flat (stems at the root, no
  enclosing folder), where it previously fell through to an untranslated `6 tracks`. The
  folder inside the zip still wins when there is one; the count survives only as a last
  resort, and stays English on purpose — reaching it means the loader found neither.
- Everything bumped to `?v=1.5.0` (10 URLs across three files).

**Known issues (open):**

- `zipError.not-zip` conflates three different failures, and one of them is a
  misdiagnosis. `lib/unzip.js:119` throws `not-zip` for a *missing entry* —
  ``Could not find ${basename(w.path)} inside the zip.`` — which now renders as "that file
  is not a valid zip, or its directory is damaged". Wrong cause, and the filename the
  English message carried is gone. The other three `not-zip` sites (`:68`, `:82`, `:94`) are
  genuinely malformed archives and translate correctly. Fixing it means adding a
  `missing-entry` code to `lib/unzip.js`, which is the one file this change deliberately
  did not touch — hence deferred, not decided.

**Key technical learnings:**

- `[gotcha]` **A test that supplies the value it is about to assert on cannot fail.** The
  stem-filename test — the one pinning this project's hardest i18n rule, that stem ids and
  filenames never localize — called
  ``assignStems(ids.map(s => ({ name: `${s}.wav`, stem: s })))``. But `lib/stems.js` is
  `item.stem ?? detectStem(item.name)`, so passing `stem` short-circuits the very function
  under test, and the assertion echoed its own input back. It sat green for the whole
  build. Dropping the `stem:` hint makes `detectStem` do the work; the check that actually
  bites is the inverse — `detectStem('貝斯.wav')` must be `null`. When a test guards an
  invariant, feed it only what a user would produce, and confirm it goes red when you break
  the invariant on purpose.

- `[gotcha]` The mode dropdown keyed its options on the **label** (`opts.push([t.label, …])`)
  and `setMode` compared `t.label !== mode`. Translating labels would have broken soloing
  outright the moment the language changed. Any user-visible string doing double duty as an
  identifier is a latent i18n bug — the fix was a `laneKey()` returning the stem id.
- `[insight]` Keeping `detectLocale()` **pure** — taking the language list as an argument,
  with storage read separately by `storedLocale()` — is what made the whole detection table
  a plain unit test with no stubbing of `navigator` or `localStorage`. Splitting the two
  cost nothing and bought the entire test.
- `[insight]` Store `{key, params}`, never rendered text. That one decision is what lets a
  visible status message, a loop badge and a mid-download progress line all survive a
  language switch. Anything that renders once and is read later needs to keep its *inputs*,
  not its output.
- `[gotcha]` …but a param that is **itself** translated must be stored as a thunk, not a
  string. `status('sep.workerFailed', { msg: err.message || tr('sep.oom') })` evaluates
  `tr()` at call time, so re-rendering produced a half-translated line: `worker failed:
  記憶體不足？ — try a shorter track`. `separate.js` now resolves function-valued params at
  render time. Storing inputs only helps if the inputs are themselves locale-independent.
- `[gotcha]` `#all-toggle` carries `data-i18n="btn.unmuteAll"`, so `setLocale`'s `apply()`
  resets its text on every switch — clobbering "Restore previous". `retranslate()` has to
  run *after* `apply()`, which is why `setLocale` applies the markup first and dispatches
  `sansbass:langchange` second. That ordering is load-bearing.
- `[gotcha]` An automation tab is `visibilityState: 'hidden'`, which pauses
  `requestAnimationFrame` — so `#t-cur` reads a frozen `0:00` while audio is genuinely
  playing, and Chrome records no paint timing at all. Verifying "the switch didn't disturb
  playback" against the clock **text** would have produced a false failure. The honest
  probe is the audio graph itself: sample `AudioContext.currentTime`, and count
  `createBufferSource` calls across the switch — it must be zero, or playback restarted.
- `[insight]` A first visit must not persist the auto-detected locale. Writing it would
  freeze the user's very first page load into storage, so changing the system language
  later would silently never take effect again.
- `[note]` The lane name was built with `innerHTML` interpolating `t.label` — a filename.
  Rebuilding it from nodes was needed for `retranslate()` to mutate the text in place, and
  closed a markup-injection path on the way.
- `[note]` Chinese has no plural agreement, so `status.decodingOne` and `status.decodingMany`
  carry identical zh-TW text. Two keys is cheaper than a plural framework for the one
  English string that needs it.

**Process learnings:**

- `[gotcha]` The plan's own audit grep for stray two-argument `say()` calls,
  `say\([^)]*, *true\)`, matches the *correct* three-argument form too — `[^)]*` happily
  swallows `'status.crash', null`. `say\([^,)]*, *true\)` is the one that finds only the
  real thing, and it found exactly the single call the plan had deferred to a later task.
  A verification command that cannot fail is worse than no command.

## v1.4.0 — The drop that navigated away (2026-08-21)

**Review:** not yet

**What was built:**
- Diagnosed the reported bug: on the live Pages site, dragging a song or zip made Chrome
  navigate to the file instead of loading it. The drag & drop code was correct and had been
  correct all along.
- Root cause: the browser was running a *cached* `app.js` from v1.2.2 against the freshly
  deployed v1.3.0 `index.html`. The old script's `el.fileInput.addEventListener` hit a `null`
  — `#file-input` was removed in v1.3.0 — and threw at the top level, so every listener
  registered *below* that line never ran. Drag & drop lives below that line.
- `?v=1.4.0` on every local asset URL: five in `index.html`, three in `separate.js`, one in
  `separate.worker.js`. Verified that a query string does not break `file://`.
- `tests/versions.test.js` — reads the three shipped files over HTTP and fails if any local
  asset is unversioned or if the versions drift apart. Fault-injected to confirm it fails.
- `on(node, ev, fn)` in `app.js`: all top-level wiring is null-safe, so one missing element
  warns instead of taking the rest of the app with it.
- A `window.onerror` handler that puts "force-reload the page" on screen, because the failure
  mode this whole entry is about looks exactly like a page that works and does nothing.
- `#drag-overlay`: a full-window drop target, shown on `dragenter`, that answers the actual
  request. The old highlight was on `#dropzone`, which is hidden the moment a song loads —
  so dropping a second song, the common case, had no visible target at all.

**Key technical learnings:**
- `[gotcha]` **GitHub Pages serves everything with `max-age=600` and gives you no way to
  change it.** After a deploy, a returning visitor can hold a stale subresource against a
  fresh `index.html` for ten minutes. With no build step there is no content hashing to save
  you, so the version query string has to be written by hand — hence the test that guards it.
- `[insight]` **A top-level `TypeError` in a classic script is a silent guillotine.** Everything
  above the throw is wired, everything below is not. The page renders perfectly, half the app
  is inert, and nothing on screen says so. Registration order became a load-bearing property
  of the file by accident. `on()` removes that coupling; the `onerror` notice removes the silence.
- `[insight]` **"Add a drop zone" was the wrong fix for the right complaint.** There already
  was one, clearly labelled, occupying most of the page. The user inferred its absence from
  its behaviour. Reproducing before building meant the console answered in one read what a UI
  rewrite would not have fixed at all.
- `[gotcha]` **`transferSize === 0` in a `PerformanceResourceTiming` entry means the browser
  never went to the network** — not a 304, which still transfers headers. Comparing
  `decodedBodySize` against the deployed `ETag` length (`"…-6f6e"` is hex bytes) proved the
  running script was 171 bytes shorter than the one on the server. That is what turned "drag
  and drop is broken" into "you are running last week's file".
- `[note]` **Chrome resolves a query string away on `file://` subresources**, for both
  `<script src>` and `<link href>`. Verified before committing to versioned URLs, since
  double-clickable `index.html` is a hard constraint. A probe page that writes its result into
  `document.title` is readable from `osascript` without any JS-from-Apple-Events permission —
  useful, because browser automation cannot reach `file://` at all.
- `[gotcha]` **`dragenter`/`dragleave` fire per element crossed, not per window.** Hiding the
  overlay on any `dragleave` flickers it off at every lane boundary. Count enters and trust
  zero — and give the overlay `pointer-events: none`, or it becomes the drop target under the
  cursor and fires its own pair, so the count never settles.

**Process learnings:**
- `[insight]` **The bug report named a symptom on a deployed site; the fix was three layers
  down.** Diffing local against deployed said "identical", which was true and useless — the
  server was fine, the client was stale. Checking the *console of the failing page* was the
  step that mattered, and it took one call.

---

## v1.3.0 — One song, or one zip of stems (2026-08-21 01:04)

**Review:** complete

**Design docs:**
- Load a zip of stems: [Spec](superpowers/specs/2026-08-20-load-zip-design.md) [Plan](superpowers/plans/2026-08-20-load-zip.md)
  — the spec carries a revision note: it planned to keep folder *drop*, which was dropped during implementation.

**What was built:**
- `lib/unzip.js` — a classic-script zip reader, `window.SansUnzip.extract`. Finds the EOCD by
  scanning backwards from the tail and reads each entry with its own `blob.slice()`, so the
  whole zip is never resident. Deflate via `DecompressionStream`, no library.
- The input surface is now **exactly two things**: **Load song** takes one audio file (and is
  the separation entry point), **Load zip** takes one `.zip` of stems. Drop accepts the same
  two and nothing else.
- **Load folder** and **Load files** are both gone, along with folder drop and multi-file
  loading. The recursive `walkEntry`/`fsCall` directory walk (~40 lines) is deleted.
- Dropping a `.zip` works on `file://`, which folder loading never could.

**Key technical learnings:**

*On the design — why the surface shrank:*
- `[insight]` A zip removes a `file://` limitation instead of adding one. A folder needs the
  directory entries API, which Chrome blocks from disk; a `.zip` is a plain file and arrives
  in `dataTransfer.files` anywhere.
- `[insight]` Adding the zip path made the folder path indefensible. Folder drop worked over
  http and failed silently everywhere else, and the ~40 lines of `walkEntry`/`fsCall` existed
  only to serve that one protocol. Once a zip did the same job everywhere, the right move was
  to delete the walk, not keep two paths. Removing it also retired `onFileUrl` and the whole
  `file://` startup hint: with folder drop gone there is no protocol-dependent loading
  behaviour left to warn about.
- `[insight]` Two buttons that each did a vague thing became two that each do one thing.
  "Load files" was a shrug — it took one song *or* a pile of stems, and its name said which
  neither time. Splitting the meaning out ("Load song" = the separation entry point, "Load
  zip" = stems) made the drop contract fall out for free: whatever the buttons accept, drop
  accepts. A vague name was hiding a vague contract.
- `[insight]` Deleting a feature is not the same as deleting its *detection*. A dropped
  folder is still recognised — one `webkitGetAsEntry()?.isDirectory` check, no walk — purely
  so the app can say "zip it first". Letting it fall through to a generic "nothing usable"
  would have been fewer lines and a worse answer.
- `[gotcha]` Narrowing an input means the *rejection* messages carry the design. Refusing six
  dropped stem files is only defensible if the message says to zip them; otherwise it reads
  as a regression. Three distinct refusals earn their place — folder, too many files, and
  neither-song-nor-zip — where one generic message would not.

*On reading zips by hand:*
- `[insight]` The tail-parse is load-bearing, not a micro-optimisation. Reading the whole zip
  into one ArrayBuffer costs ~848 MB peak for a 200-second six-stem WAV zip against ~636 MB
  for per-entry slices — close enough to Chrome's per-tab ceiling to fail on a longer song.
  A `File` from an `<input>` is disk-backed, so `blob.slice()` is free until awaited.
- `[insight]` `decodeAudioData` **detaches** its input, which is why eager extraction costs no
  more memory than lazy — and why every entry needs its own exact-size buffer. Two entries
  sharing one allocation would mean decoding the first detaches the second.
- `[gotcha]` The local header's extra-field length may differ from the central directory's.
  Compute the data offset from the *local* header or you land mid-file. Sizes, conversely,
  must come from the central directory — with general purpose bit 3 set the local sizes are
  zero and the real ones trail the data. Real `zip -r` output carries a local `UT`/`ux` field,
  so this fires in practice; `lib/zip.js` writes 0 in both, so only a hand-built fixture
  catches a regression.
- `[gotcha]` Finder's "Compress" writes an AppleDouble `__MACOSX/._name` per file. Unfiltered,
  a six-stem zip yields twelve entries and `._bass.wav` competes for the bass lane.
- `[gotcha]` `zip -r` does **not** set general purpose bit 11, so Python's `zipfile` renders a
  Chinese song title as CP437 mojibake while the player shows it correctly. Decoding names as
  UTF-8 unconditionally is what makes `1 基隆路` survive; a spec-faithful CP437 fallback would
  have broken the real archive the feature was built for.
- `[note]` `DecompressionStream('deflate-raw')` handles method 8 with no library. Store-only
  zips must still load where it is unavailable, so feature-detect per entry, not up front.

*On the two defects a code review found — both of which returned rather than threw:*
- `[insight]` The bug a hand-rolled parser hides is the one where it *succeeds*. Every guard
  that threw was correct first time; both real defects returned — wrong bytes, and a blank
  status bar. Fuzzing malformed archives found them; the happy-path tests never could.
- `[gotcha]` `blob.slice(start, end)` **clamps** an out-of-range `end` instead of throwing.
  A truncated archive therefore resolved with the central directory glued onto the payload
  and no error at all — surfacing downstream as "codec not supported", the wrong diagnosis.
  Comparing `raw.byteLength` against the central directory's size is what catches it; the
  `try/catch` around `.arrayBuffer()` never fires for this case.
- `[gotcha]` `say('')` **hides** the status bar (`el.status.hidden = !msg`). So an error that
  escapes with an empty `message` — which is what a broken `DecompressionStream` can reject
  with — renders as a drop that visibly does nothing. Every throw crossing into `loadZip`
  needs a non-empty, user-ready message; that is the whole point of `zipError`.

*On changing UI out from under the docs:*
- `[gotcha]` Renaming or deleting a button means auditing every string that names it, and it
  bit twice here — "Load folder" survived in two `file://` messages, a code comment and five
  README lines; "Load files" then survived in three more. The one that would have cost most
  was a stale `#file-input` in `docs/behaviour.md`'s **test harness** section: a future
  session following those instructions gets a null and no clue why.
- `[gotcha]` The play button's state lives in a `.playing` class on the *button*; the inner
  `<span>` keeps `class="ico-play"` and CSS swaps the glyph. Probing the span to ask "is it
  playing?" reads as paused forever — check `#play.classList.contains('playing')`.

**Process learnings:**
- `[insight]` `file://` is unreachable from browser automation, so the one capability this
  feature exists for could not be machine-verified. Static proof (no `import`/`export`, no
  `fetch`, plain `<script src>` ahead of the conditional module injection) narrowed it, but
  the last step was a human double-clicking `index.html`. Worth planning for: the headline
  behaviour was the least testable one.

---

## v1.2.2 — Separation panel and lane toggle refinements (2026-08-20 23:10)

**Review:** not yet

**Behaviour spec:** [`docs/behaviour.md`](behaviour.md) — written this session; it is the
reference for every item below and is expected to be updated alongside future behaviour changes.

**What was built:**

- **Save stems is disabled while a run is in flight.** The stems it would have written are
  the *previous* track's, and encoding them competes with the worker for memory.
- **The Separate button disappears once a song is separated** and returns when a fresh
  single track is loaded.
- **Clicking a lane name toggles that lane** instead of soloing it. Soloing moved entirely
  to the Play dropdown; `soloTrack` is gone.
- **Removed the "Use a local .onnx" picker.** `separate.worker.js` still accepts a
  `modelBuffer`, so the capability survives if the UI is ever wanted back.
- **Separation output drops the original track.** The six stems already sum to it, so
  keeping it meant either doubled audio or permanent suppression.
- **Separation stops playback and rewinds.** The mix can still be playing when the stems
  land; its BufferSources are not in `tracks` and would keep sounding over the new lanes.
- **Fixed a CSS bug that had been suppressing every `hidden` toggle in the app**, including
  the two above (see the learnings).
- **The lane click target now fills the left column**, from the lane's left edge to the
  number badge, at full lane height. The waveform column still seeks.
- **An Unmute all button** next to the Play dropdown, doing what `0` does so the behaviour
  is not hotkey-only. Pressing it again returns to the lanes that were on before, and it
  relabels itself — **Unmute all** / **Restore previous** — from the live mute state.
- **The "done" status text is gone.** Six lanes where there was one is the confirmation.
- **The unmute-all button matches Save stems** (`btn ghost`). Its disabled style was scoped
  to `.sep .btn[disabled]` and so had never applied outside the separation panel; the rule
  moved up to `.btn[disabled]`.
- **[`docs/behaviour.md`](behaviour.md)**, a spec of every expected behaviour as an
  observable outcome plus the way to observe it, and the browser-test harness that goes with
  it. `CLAUDE.md` now requires it to be updated in the same commit as a behaviour change.

**Key technical learnings:**

- `[insight]` **Deleting the mix track was the fix for three problems at once.** "All lanes
  on by default" needed no new code: with no `mix` track, `hasMixPlusStems()` is false, so
  the existing `setMode('mix')` already leaves every stem unmuted. It also removed the
  doubled-audio trap from the separation path entirely, and removed the awkward case where
  a lane is visible but permanently forced silent by `applyGains`. The feature request was
  phrased as three UI tweaks; one deletion answered all of them.
- `[insight]` **A per-lane toggle cannot be uniform when one lane is mutually exclusive with
  the rest.** A full-mix file must never sound over its own stems, so the mix lane keeps
  mode-switching semantics inside `toggleTrack` while every other lane toggles its own gain.
  Only reachable now via a folder loaded from disk that genuinely holds both — but that is
  exactly the case nobody will be testing when they next touch this.
- `[gotcha]` **A class that sets `display` silently defeats the `hidden` attribute.**
  `[hidden] { display: none }` lives in the UA stylesheet, so *any* author rule outranks it —
  `.btn { display: inline-block }` and `.loop-badge { display: inline-flex }` meant Save,
  Cancel and the loop badge rendered while their `.hidden` property read `true`. This
  predates this session: the loop badge has shown a stray Clear button since v1.1.0. It also
  quietly voided the new "hide Separate once done" behaviour. The trap for verification is
  that `el.hidden` is the *state*, not the *appearance* — asserting on the property passes
  while the user still sees the button. A screenshot caught what four property assertions
  had missed. `styles.css` now has a global `[hidden] { display: none !important; }`.
- `[insight]` **A grid item with `align-items: center` is only as tall as its content.**
  `.lane-name` was a full-width 128px column but a ~14px strip inside a ~56px lane, so the
  toggle only really worked on the text. `align-self: stretch` plus negative margins that
  swallow the lane's own padding make the whole left block clickable.
- `[insight]` **The undo snapshot is taken when everything is turned on, not when a lane is
  muted.** That one choice is what makes the sequence behave: mute a lane while all-on, press
  `0`, press `0` again, and you land back on *that* lane state rather than on whatever was
  saved two presses earlier. Storing it at mute time instead would strand the older state.
- `[note]` The unmute-all button relabels itself inside `applyGains` rather than at each
  call site. Every mute path already routes through there, so the label cannot drift out of
  sync with the lanes — including mutes triggered by the dropdown or the number keys.
- `[gotcha]` **A scoped disabled style is invisible until something moves.**
  `.sep .btn[disabled]` had always been written that way, so it worked for Save stems and
  silently did nothing for any other button. Worth checking the scope of any state style
  before reusing the class it hangs off.
- `[note]` The `1`–`6` keys have always called `toggleTrack`, so lane clicks and the number
  keys finally agree. The README had described `2` as "mute everything but the guitar",
  which was never what the key did.

**Process learnings:**

- `[gotcha]` **Chrome throttles `setInterval` to ~1 Hz in a backgrounded tab, and the
  automation tab is always backgrounded.** `separate.js` polls `refresh()` every 400 ms;
  under automation it runs about once a second. A verification step waited 1.2 s for the
  Separate button to reappear, saw it still hidden, and looked exactly like a broken fix.
  Measured it directly — `document.visibilityState` is `hidden`, and a fresh 400 ms interval
  ticked twice in two seconds — then waited longer and the behaviour was correct all along.
  Same family as the rAF-throttling rule this project already knows; it applies to the test
  harness as much as to the player.
- `[insight]` **Stub `window.Worker`, not the model.** Replacing the constructor just before
  clicking Separate exercises every line of `separate.js`'s real message handling —
  `busy()`, the `result` branch, `loadSeparated` — with no 285 MB download and no minutes of
  inference. `getWorker()` constructs lazily at click time, which is what makes the seam
  reachable from the page.
- `[gotcha]` **A same-URL navigation can reuse the stylesheet from memory cache**, even
  though `serve.sh` sends `no-store` and `curl` shows the new bytes. The served file had the
  fix and the loaded `document.styleSheets` did not. Re-pointing the `<link>` at
  `styles.css?v=<now>` forces it. Same shape as the stale-ES-module trap already documented,
  but the existing `no-store` header does not cover it.
- `[insight]` **Verify muting on the gain values, not the CSS class.** Patching
  `AudioParam.prototype.setTargetAtTime` to record every ramp showed what actually reached
  the audio graph: clicking Vocals sent it to 1 while Drums stayed at 0. `tracks` is a
  classic-script local and unreachable from the console, so this is also the only way in.
- `[insight]` **The harness knowledge was worth more than the fixes.** Five sessions of UI
  work produced maybe eighty lines of behaviour change and a page of hard-won technique:
  stub the Worker constructor, read gain ramps, assert on computed `display`, force the
  stylesheet with a cache-buster, allow for throttled timers, send a real `space`. None of
  it is discoverable from the code. That is why it lives in
  [`docs/behaviour.md`](behaviour.md) rather than only here.

---

## v1.2.1 — GitHub Pages deployment with PR previews (2026-08-20 21:05)

**Review:** not yet

**What was built:**

- The project is public at <https://sansword.github.io/sans_bass/>, served by GitHub Pages
  from a `gh-pages` branch with no backend and no build step.
- Three workflows: `deploy-main.yml` publishes `main` to the site root, `pr-preview.yml`
  publishes every pull request to `/pr-<N>/` and posts a sticky comment with the links, and
  `pr-preview-cleanup.yml` removes the directory when the PR closes.
- [`docs/deployment.md`](deployment.md) documents the whole arrangement.
- Verified on the real deployment, not just locally: 27/27 unit tests at the deployed URL,
  the ONNX runtime loading from jsDelivr, all 285 MB of the model fetched from Hugging Face,
  `ready: webgpu`, and a second load served from Cache Storage in 0.5 s.

**Key technical learnings:**

- `[gotcha]` **Two workflows sharing a concurrency group can silently cancel a deploy.**
  Merging a pull request fires `deploy-main` (push to `main`) and `pr-preview-cleanup`
  (PR closed) simultaneously. With both in one group, one ran and the other went pending —
  and GitHub cancels a pending run the moment another joins the group. On the v1.2.0 merge
  the casualty was `deploy-main`: production never deployed, the root served a placeholder,
  and nothing anywhere reported a failure. Each workflow now owns its group. The real
  protection against concurrent writes was never the shared lock — it is the
  `git pull --rebase` retry loop plus the fact that the workflows touch disjoint paths.
- `[gotcha]` **`rsync -a` decides by size and mtime, so it skips a changed file of identical
  size.** A production sync would have published stale content. Found by fault-injecting the
  sync against a fixture rather than by watching the site: every other assertion in that test
  passed while `index.html` quietly stayed at the old version. Both workflows now use `-c`.
- `[gotcha]` **An orphan branch does not inherit `.gitignore`.** Fresh `gh-pages` did not
  ignore `rips/` or `stems/`, so a stray `git add -A` while checked out there would have
  staged ~860 MB of commercial recordings. `.gitignore` is committed on that branch now.
- `[note]` `.nojekyll` has to be recreated after every sync, because the root sync uses
  `--delete`. Protecting it with an rsync filter *and* touching it each run makes it
  impossible to lose.
- `[note]` GitHub Pages has no native per-branch preview URL — one repository gets one site
  from one source. Per-PR previews are just subdirectories of the one published branch, with
  production carefully protected from deleting them (`--filter 'protect pr-*'`).
- `[insight]` **A hosted preview tests something localhost cannot.** The one thing that
  genuinely changes between `./scripts/serve.sh` and a public HTTPS origin is cross-origin
  fetching — jsDelivr for the runtime, Hugging Face for a 285 MB model, both dependent on
  those hosts' CORS headers. That is the reason a preview deployment earns its complexity
  here; for a site with no third-party fetches it would not.

**Process learnings:**

- `[insight]` **"The workflow ran" is not "the workflow succeeded."** The deploy was reported
  as cancelled in a run list that otherwise looked healthy, and the site simply kept serving
  its previous content. Checking the *conclusion* rather than the existence of a run is the
  same discipline this project already applies to audio: observe the outcome, not the
  parameters.
- `[insight]` The fix for a CI bug is best verified by the event that exposed it. Fixing the
  concurrency collision on a branch meant the pull request re-tested previews, and merging it
  re-tested the exact scenario that had failed — `Deploy main [push] completed/success`.

---

## v1.2.0 — In-browser stem separation (2026-08-20 20:43)

**Review:** not yet

**Design docs:**
- In-browser separation: [Spec](superpowers/specs/2026-08-20-in-browser-separation-design.md) [Plan](superpowers/plans/2026-08-20-in-browser-separation.md)

**What was built:**

- Six-stem separation running entirely in the browser via `onnxruntime-web` and
  `kramp/htdemucs-6s-webgpu-onnx`, at parity with the native pipeline on speed and close
  to it on output.
- `separate.worker.js` (inference), `separate.js` (panel), `lib/overlap.js`, `lib/wav.js`,
  `lib/zip.js`, and `lib/stems.js` extracted from `app.js`.
- Save stems as one ZIP of WAVs, laid out so unzipping gives a folder **Load folder** accepts.
- First dependency-free test harness for the project: `tests/test.html` (27 unit tests) and
  `tests/parity.html`.

**Measured results** (Apple Silicon, WebGPU, `htdemucs_6s`, trapezoid window):

| Track | Time | vocals | bass | guitar | drums |
|-------|------|--------|------|--------|-------|
| `1 基隆路` (200.4 s) | 23.9 s (8.4x) | 0.996 / 0 dB | 0.997 / 0 dB | 0.993 / +1.4 dB | 0.984 / +2.9 dB |
| `2 最後兩禮拜` (205.8 s) | 26.7 s (7.7x) | 0.997 / 0 dB | 0.997 / 0 dB | 0.992 / +1.6 dB | 0.985 / +0.6 dB |

Correlation / level delta against the native stems in `stems/reborn/`, at **zero sample lag
on every stem**. Note the ground truth is 160 kbps AAC: round-tripping our own WAV output
through the same encode caps correlation at 0.995 (drums), 0.996 (guitar), 0.999 (vocals),
1.000 (bass), so most of the drums and guitar gap is the measurement, not the separation.

**Key technical learnings:**

- `[insight]` **Picking the right model mattered more than the integration.** The obvious
  starting point (`timcsy/demucs-web`) strips STFT out of the ONNX graph and reimplements it
  in JS, which locks you to a 4-stem model with no guitar and to a WASM path running at
  0.1–0.3x realtime. A model with STFT baked in as Conv1d — contract `mix [1,2,343980]` →
  `stems [1,6,2,343980]` — deleted the entire spectrogram layer from our code and ran 30x
  faster. Check what the model's I/O contract lets you *delete* before adopting a library.
- `[insight]` `numThreads = 1` is an architectural decision, not a tuning knob. It avoids
  SharedArrayBuffer, which avoids COOP/COEP, which is the only reason this can be hosted on
  GitHub Pages — a host that cannot set response headers.
- `[insight]` **The overlap window question was a red herring, and measuring it said so.**
  The spec flagged native Demucs' raised-cosine cross-fade as the likely cause of guitar
  running hot. Both windows measured *identical to three decimal places* on every stem.
  Fault injection proved the parameter was really wired — exactly 25% of samples differed,
  precisely the overlap fraction — but by at most 0.0017. Overlap-add normalises by the sum
  of weights, so the output is a weighted average of near-identical predictions and the
  window shape barely survives it. Guitar is still ~+1.5 dB; the cause lies elsewhere.
- `[gotcha]` `decodeAudioData` resamples to the AudioContext's rate. A default 48 kHz context
  on macOS silently feeds the model stretched audio: no error, just subtly wrong stems.
- `[gotcha]` After separation there are seven tracks, so the lone-file "this is the mix" rule
  never fires and a real song title matches none of the mix filename patterns. The original
  would have been summed on top of its own stems at double volume. Caught by spec review
  before any code existed, and now pinned by a test.
- `[gotcha]` **A ZIP with UTF-8 filenames must set general purpose bit 11.** We wrote UTF-8
  bytes and left the flag clear, so per spec the names are CP437 and every Chinese song title
  extracted as mojibake — `unzip` then failed outright with "Illegal byte sequence". Worse,
  macOS's bundled Info-ZIP `unzip` ignores the bit even when set, so it *still* prints
  garbage and looks unfixed. Verify with `ditto -xk`, `bsdtar`, or Python's `zipfile`.
- `[gotcha]` **A dev server with no cache headers will lie to you.** After fixing the ZIP flag,
  the test kept failing while the file on disk and the server response were both correct —
  Chrome was serving a cached ES module to the test page. `serve.sh` now sends
  `Cache-Control: no-store`. A "correct fix that still fails" is a caching question first.
- `[insight]` Ground truth we already had made verification trivial. `stems/reborn/` is native
  `htdemucs_6s` output, so correctness became a correlation measurement rather than a
  listening opinion — and quantifying the AAC ceiling separated real error from measurement
  error.
- `[note]` The plan's parity gate (all stems ≥ 0.99) does **not** pass: drums lands at
  0.984–0.985 on both tracks. Against a 0.995 AAC ceiling the real shortfall is ~0.01. Left
  as measured rather than moving the threshold to make it green.
- `[note]` WebGPU only works here because the model was constant-folded to remove a
  `ConstantOfShape` op that ORT's WebGPU backend cannot run. The same weights unfolded fall
  back to WASM and are ~30x slower.

**Process learnings:**

- `[insight]` The spike was worth more than the estimate it replaced. Published figures said
  10–30 minutes per song; measurement said 24 seconds. Both were "true" — of different
  models on different backends. One afternoon of measurement changed the feature from
  not-worth-building to at-parity-with-native.
- `[gotcha]` Computing a segment count with a formula separate from the loop that consumes it
  produced `segment 35/34` in the spike. `segmentStarts()` is now the single source of truth
  and a test asserts the two agree.
- `[gotcha]` A unit test can probe the one input where two different things agree. The
  "these two windows differ" test sampled `i = OVERLAP/2` — exactly where the trapezoid and
  the raised cosine both equal 0.5 by construction — and failed against correct code. Scan a
  range, don't probe a point.

---

## v1.1.0 — A-B repeat loop (2026-08-13)

**Review:** not yet

**What was built:**

- `a` / `b` set the loop start and end at the playhead; `c` or `Esc` clears. Points can be
  set in either order and either can be moved mid-playback.
- Looping implemented with the Web Audio node's own `loop` / `loopStart` / `loopEnd`.
- Loop region shaded on every lane, with amber A/B markers and labels on the overview, plus
  a badge showing the bounds and span and a Clear button.
- Guard rails: seeking is clamped inside an armed loop, reversed points swap themselves,
  sub-0.1s loops are rejected with an explanation, and loading a new song clears the points.

**Key technical learnings:**

- `[insight]` Reach for the platform's own loop primitive. `loop`/`loopStart`/`loopEnd` on
  `AudioBufferSourceNode` runs on the audio thread, so it is sample-accurate, gapless at the
  wrap, and identical across all six stems. The obvious alternative — watch the playhead in
  JS and seek back to A — would re-seek six sources every lap, and scheduling jitter would
  smear them apart audibly on the drum track.
- `[insight]` Third time this project has learned the same lesson: **anything transport-related
  belongs on the audio graph, not in `requestAnimationFrame`.** rAF is throttled in background
  tabs, so a JS-driven loop would silently stop wrapping — exactly how end-of-song detection
  broke in v1.0.0. rAF is for drawing, and only drawing.
- `[gotcha]` A looping source never fires `onended`. The end-of-song handler therefore has to
  be attached conditionally (`if (!src.loop)`), or you either lose end detection or wire up a
  callback that can never fire.
- `[insight]` Snapping the playhead into `[A, B)` when playback starts keeps the position math
  to one line: `A + ((offset - A + elapsed) % span)`. Without the snap you have to model the
  pre-loop segment separately, because a source starting before `loopEnd` plays forward to
  `loopEnd` and only then jumps to `loopStart`.
- `[gotcha]` A stem shorter than `loopEnd` wraps at *its own* buffer end per spec, silently
  desyncing it from the others. Such sources are left unlooped so they simply fall silent
  instead. Never arises with Demucs output (identical lengths) but would with hand-assembled
  files.
- `[note]` The snap rule also buys the ergonomics for free: because pressing `b` leaves the
  playhead exactly at B, the loop jumps straight back to A with no extra keystroke. Press `a`
  at the start of a phrase, keep listening, press `b` when it ends.

**Process learnings:**

- `[gotcha]` `AudioContext` user activation is unreliable under browser automation. Synthetic
  clicks on the play button repeatedly failed to unlock audio (context stayed `suspended`,
  no exception, no clue), while a real `space` keypress unlocked it immediately. Worth
  reaching for a keypress first when testing audio in an automated browser.
- `[insight]` Verified the loop by sampling the playhead across multiple laps, not by checking
  that the loop parameters were set. The parameters being correct is not evidence the audio
  wraps — only `45.53 → 40.03 → … → 45.54 → 40.03` is.

---

## v1.0.1 — Drag-and-drop repair (2026-08-13)

**Review:** not yet

**What was built:**

- Fixed folder drag-and-drop failing with no feedback whatsoever.
- Promisified the FileSystem entry calls properly, with error callbacks wired up and a 5s
  timeout as a backstop.
- Every drop outcome now reports itself: blocked folder on `file://`, folder with no audio,
  unsupported files, or a successful load via the plain-file fallback.
- A hint that appears only on `file://` pointing at the Load folder button, and a README
  section covering the three ways to load.

**Key technical learnings:**

- `[gotcha]` **Wrapping a callback-pair API in a promise without its error path converts a
  handled failure into an invisible one.** `new Promise(res => reader.readEntries(res))` omits
  the error callback, so when Chrome refused the directory read the promise never settled, the
  `await` blocked forever, and the drop handler died mid-execution — no message, no console
  error, nothing. Applies to any `(successCb, errorCb)` API, which is most of the older DOM
  surface.
- `[insight]` A fallback placed after a potentially-hanging `await` is not a fallback. The code
  to fall back to `dataTransfer.files` was already written and correct — it was simply
  unreachable, because execution never returned from the hung await above it. Worth asking of
  any fallback: can control actually *reach* you?
- `[gotcha]` Chrome will not let a `file://` page read a dropped **folder**; plain file drops
  are fine. So folder drag-and-drop is the one loading path that cannot work from a
  double-clicked page, which is precisely the path the UI advertised first.
- `[insight]` Add a defensive timeout to any host-provided async callback API. Some builds
  neither call back nor throw, and a silently hung UI is a far worse failure than an error
  message.
- `[note]` Native file pickers (`<input webkitdirectory>`) work everywhere, `file://` included,
  because selecting a file is an explicit user grant rather than an origin-scoped read. The
  plain button is the reliable path; the fancy drop is the fragile one.

**Process learnings:**

- `[insight]` "It doesn't work" with *zero* output is itself diagnostic: silence points at a
  hang or a swallowed error, not at wrong logic. Wrong logic produces wrong behaviour, not no
  behaviour. Re-reading the async code for unsettled promises found it faster than reproducing
  it would have.
- `[note]` Browser automation refuses `file://` URLs, so the fix was verified by fault injection
  instead — fake entry objects whose `readEntries` calls the error callback, and another that
  never calls back at all. Confirmed reject in 0 ms and timeout at 5 s. Injecting the fault beat
  trying to recreate the environment that caused it.

---

## v1.0.0 — CD to browser stem player (2026-08-13)

**Review:** not yet

**What was built:**

- `index.html` / `styles.css` / `app.js` — a dependency-free, build-step-free local player.
  Decodes stems with Web Audio, draws a per-lane waveform, and plays the full mix or any
  single instrument.
- `scripts/rip-cd.sh` — rips a mounted audio CD to lossless FLAC via ffmpeg.
- `scripts/prep-stems.sh` — one song → 6 separated stems → web-ready `.m4a`, with GPU
  auto-detection and CPU fallback.
- `README.md` — the whole CD → stems → player pipeline, including the Mac-specific setup
  traps below.
- Verified end-to-end on a real CD rip: 12 tracks ripped, one track fully separated and
  played back in-browser with all six stems in sync.

**Key technical learnings:**

- `[insight]` Scheduling every stem from one `AudioContext` clock — all `BufferSource`s
  started at the same `currentTime + lookahead` — gives sample-accurate sync for free.
  Six `<audio>` elements would drift apart audibly over a 3-minute song. Muting is done
  with gain nodes so tracks stay locked to the timeline whether or not you can hear them.
- `[gotcha]` `requestAnimationFrame` is paused in background tabs, so it cannot be trusted
  for anything transport-related. End-of-song detection lived in the rAF loop and a song
  finishing off-screen never reset. Moved onto the audio graph via `onended` on the
  longest source; rAF now only draws. Detach `onended` before your own `stop()` or it
  re-enters.
- `[gotcha]` An `AudioContext` stays `suspended` until a genuine user gesture. A scripted
  `play()` silently no-ops: `playing` flips to `true`, sources get scheduled, and the
  clock stays frozen at 0 because `audio.currentTime` doesn't advance. Cost a good while
  of debugging a "broken clock" that was just autoplay policy.
- `[note]` `decodeAudioData` runs off the main thread, so decoding stems in parallel with
  `Promise.all` instead of sequentially cut load time 13.8s → 6.2s for six 3-minute stems.
- `[insight]` Waveform lanes need per-lane normalisation to their own peak. A bass stem at
  its natural level (−15 dB) draws as an unreadable flat line next to drums. The overview
  waveform keeps true dynamics; only the lanes are normalised, capped at 8× so a silent
  stem isn't amplified into visual noise.
- `[gotcha]` Filename-matching rules that *suppress* other content must be narrow. A
  `/track|song|full|mix/` pattern meant to spot a full-mix file matched `track_A.m4a`,
  which then silently muted every other loaded file. Any heuristic whose false positive
  hides data deserves word boundaries and a deliberately small vocabulary.
- `[insight]` `htdemucs_6s` is the only Demucs model that separates **guitar** into its own
  stem. The widely-cited `htdemucs` gives 4 stems with all guitars buried inside "other" —
  useless for a guitar band. Worth checking the model's stem list against what you
  actually want before committing to a run.
- `[insight]` Near-silent stems are a *correct* result, not a failure. For a band with no
  keyboards, `piano` and `other` came out at −42/−45 dB mean against −15 to −17 dB for the
  real instruments. `ffmpeg -af volumedetect` over each stem is a fast, objective sanity
  check that separation actually worked.
- `[note]` macOS mounts an audio CD as a folder of `.aiff` files, so ripping needs no
  special tooling — it's a lossless transcode. XLD is only worth installing for scratched
  discs, where AccurateRip and sector re-reads matter.
- `[note]` Memory cost is real: stems are held decoded as 32-bit float, so six stems of a
  3-minute song is ~380 MB of RAM. Fine for one song at a time.
- `[note]` AAC `.m4a` at 160 kbps is the right delivery format — universally decodable
  including Safari, and encoder delay is identical across stems so relative sync survives.

**Toolchain learnings (macOS + Demucs, 2026-08):**

- `[gotcha]` PyTorch has no Python 3.14 wheels. Homebrew's `python@3.14` was the only
  Python installed, so `pip install demucs` could never have worked. Needs `python@3.12`,
  and Homebrew does *not* put a bare `python3.12` on `PATH` — call
  `/opt/homebrew/bin/python3.12` explicitly.
- `[gotcha]` demucs 4.1.0 imports numpy but doesn't declare it as a dependency. A plain
  `pip install demucs` reports success and leaves you with a `demucs` command that crashes
  on import. Install `numpy` explicitly.
- `[note]` demucs 4.1.0 dropped torchaudio in favour of `sphn`. Asking for `torchaudio`
  anyway drags in an old pinned torch and can wedge the resolver — the opposite of helpful.
- `[gotcha]` Probing capabilities from a shell script with a bare `python3` silently uses
  the *system* interpreter, not the venv one. `prep-stems.sh` asked system Python 3.9
  whether MPS was available, got `ModuleNotFoundError: torch`, and quietly fell back to CPU
  on every run — a 5×+ slowdown that never announces itself. Probe with the interpreter
  sitting next to the binary you're about to run.
- `[note]` Separation is much faster than the folklore suggests: ~22 seconds for a
  3-minute song on Apple Silicon MPS, against the "1–3 minutes" figure written from memory.

**Process learnings:**

- `[insight]` Synthetic test fixtures nearly produced a false bug report. ffmpeg-generated
  sine tones came out at 0.09 peak amplitude, so the lanes rendered as near-flat lines and
  it looked like a rendering bug. Reading the actual peak values out of the page first
  showed the renderer was correct and the *fixture* was quiet. Measure before fixing — but
  note the false alarm still pointed at a genuine UX problem (quiet stems are unreadable),
  which became the normalisation feature.
- `[gotcha]` `python3 -m http.server` is single-threaded. Abandoned requests wedge it, and
  the symptom is baffling: browser `fetch` hangs indefinitely while `curl` to the same URL
  returns in 5 ms. Use `ThreadingHTTPServer` when serving media for browser testing.
- `[gotcha]` A JS eval dispatched immediately after `location.reload()` loses its execution
  context and reports as a renderer timeout. Let the page settle before evaluating.
- `[insight]` Testing the real artifact beat testing the fixture. Everything looked fine on
  4 synthetic tones; loading 6 real 3-minute stems is what exposed the slow sequential
  decode, the missing progress feedback, and the true memory cost.
