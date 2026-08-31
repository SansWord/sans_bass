# Roadmap

Work that is wanted but not built. An index, not a spec: each item says what it is, where the
detail lives, and what has to be settled before it can be designed. Nothing here is a
commitment to an order.

Built work is recorded in [`devlog.md`](devlog.md), and what the player currently *does* is
in [`behaviour.md`](behaviour.md).

## Note editing — layer 4

Six actions, listed with their consequences in
[`transcription.md` → Layer 4 → The actions to support](transcription.md#the-actions-to-support):
高/低 8 度, 刪除, 分割, 新增, 平移, and range-select-and-delete.

**Open question before design:** 平移 is ambiguous — a nudge in time, in pitch, or both. A
pitch move and a time move want different anchors, so this decides the override format.

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
