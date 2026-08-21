# Load a zip of stems — design

**Date:** 2026-08-20
**Target version:** v1.3.0
**Status:** approved, ready for planning
**Supersedes:** the `Load folder` button (the folder *drop* path is kept)

## Goal

Replace the **Load folder** button with **Load zip**, so a song's stems can be loaded from a
single `.zip` file. This closes the loop with in-browser separation: Save stems already writes
a zip (`lib/zip.js`), and today there is no way to load one back.

## Motivation

Three things push this way.

1. **Save stems has no matching load.** v1.2.0 added separation and a zip download. Getting
   those stems back into the player means unzipping to disk first, then Load folder.
2. **A zip is one file, so it survives `file://`.** Folder drag-and-drop is blocked when
   `index.html` is opened by double-clicking — the long-standing gotcha at `app.js:721`.
   A dropped `.zip` arrives in `dataTransfer.files` like any other file and works there.
   This change *removes* a `file://` limitation rather than adding one.
3. **A folder of stems is awkward to move between machines.** A zip is not.

## Decisions

| Question | Decision |
|---|---|
| Replace `Load folder`, or add a button? | **Replace.** Two buttons stay: `Load files`, `Load zip`. |
| Which zips must open? | **Store (method 0) and deflate (method 8).** |
| Does folder *drop* survive? | **Yes.** `walkEntry`/`fsCall` are kept; only the button and its `webkitdirectory` input go. |
| Extract eagerly or lazily? | **Eagerly.** See "Why eager". |

Deflate matters because the zips users make themselves — Finder "Compress", `zip -r`, 7-Zip —
are deflated. Store-only would work for this app's own zips and fail for every hand-made one.

## Requirements

- `Load zip` opens a zip and loads its audio entries as lanes, identically to Load folder.
- Dropping a `.zip` on the dropzone does the same, including on `file://`.
- Dropping a *folder* still works over `http://`, unchanged.
- Stem identity, lane order, colours, A-B repeat, waveforms: **all unchanged**. The zip path
  converges on the existing `loadFiles` and nothing downstream is aware a zip was involved.
- The song title is derived from the zip's internal folder name, matching folder loading.
- Every failure mode reports what actually went wrong. No silent no-ops.
- Works on `file://`. No build step, no dependency.

## Architecture

One new file, `lib/unzip.js`, plus small edits to `index.html` and `app.js`.

```
Load zip / drop .zip
        |
        v
  loadZip(file)  ---> SansUnzip.extract(blob) ---> [{name, webkitRelativePath, bytes}]
        |
        v
  loadFiles(entries)      <-- unchanged from here down
        |
   decodeAudioData -> buildTracks -> lanes
```

### `lib/unzip.js` is a classic script

An IIFE exposing `window.SansUnzip`, the same shape and for the same reason as `lib/stems.js`:
`app.js` is a classic script so `index.html` survives being double-clicked, and a classic
script cannot `import`. It therefore cannot share code with `lib/zip.js`, which is an ES
module used only by the separation path. **The writer and the reader stay separate on
purpose** — `lib/zip.js` writes, `lib/unzip.js` reads, and the tests are what keep them
agreeing.

Public surface, deliberately one function:

```js
window.SansUnzip.extract(blob) -> Promise<{name, webkitRelativePath, bytes}[]>
```

### Reading strategy: parse from the tail, slice per entry

A `File` from an `<input type="file">` is disk-backed. `blob.slice()` costs nothing and no
bytes are read until `.arrayBuffer()` is awaited on the slice. The reader exploits this:

1. **Locate the EOCD.** `blob.slice(-65557).arrayBuffer()`, scan backwards for signature
   `0x06054b50`. 65557 = 22-byte EOCD + the 65535-byte maximum comment.
2. **Read the central directory** as one slice, using its offset and size from the EOCD.
3. **Walk the CD entries** — name, method, compressed size, local-header offset. Nothing is
   read from the file data yet.
4. **Filter** (below). Non-audio entries are discarded here, before a single data byte is read.
5. **Per surviving entry**, read the local header at the recorded offset to find where its
   data starts, then `blob.slice(dataStart, dataStart + compressedSize).arrayBuffer()`.
6. **Method 0** — the slice is the data. **Method 8** — pipe it through
   `DecompressionStream('deflate-raw')`.

The alternative, `await zipFile.arrayBuffer()` and parse in memory, is rejected: it holds the
entire zip *alongside* the extracted entries. See "Memory".

### Two zip-format traps

- **The local header's extra-field length may differ from the central directory's.** The data
  offset must be computed from the *local* header's own name and extra lengths, read at the
  offset the central directory records. Using the CD's extra length lands mid-file.
- **Sizes come from the central directory, never the local header.** When general-purpose flag
  bit 3 is set the local header's sizes are zero and the real values follow the data in a
  descriptor. The central directory always carries correct sizes, so reading only from there
  sidesteps data descriptors entirely.

### Filtering, before any data is read

In order:

1. Drop directory entries (name ends with `/`).
2. Drop `__MACOSX/…` and any basename starting with `._`. Finder-made zips carry an AppleDouble
   resource fork per file; without this, a six-stem zip yields twelve entries and the duplicate
   `._bass.wav` competes for the bass lane in `assignStems`.
3. Keep only names matching `window.SansStems.AUDIO_RE`.

Entry order is preserved as the central directory lists it; lane order is decided later by
`assignStems`, so this only affects the fallback colour index for unrecognised names.

### Return shape: duck-typed, not `File`

`extract` returns plain objects, and `loadZip` maps them to what `loadFiles` consumes:

```js
{ name: 'bass.wav', webkitRelativePath: 'Song Name/bass.wav', arrayBuffer: async () => bytes.buffer }
```

`loadFiles` touches only `.name` and `.arrayBuffer()` (`app.js:71`, `app.js:86`), and
`commonName` reads `f.webkitRelativePath || f.name` (`app.js:185`). A real `File` cannot carry
the path — `webkitRelativePath` is read-only and always `''` — so a `File` would lose the
folder name and a six-stem zip would title itself "6 tracks". The plain object restores parity
with folder loading at zero cost to `loadFiles`.

**`loadFiles`, `assignStems`, `buildTracks`, `computePeaks` and the transport are unchanged.**

### Why eager

`extract` reads every surviving entry before returning. Lazy thunks were considered and
rejected:

- **No memory gain.** `app.js:84` is `Promise.all(files.map(async …))`; all six async functions
  run to their first `await` immediately, so all six reads are in flight either way. There is
  no staggering to win.
- **`decodeAudioData` detaches its input** (`app.js:86`), so the eager buffers are freed as
  each decode starts. They are not pinned by the `files` reference that `commonName(files)`
  keeps alive at `app.js:105`.
- **Lazy would corrupt error reporting.** It moves the read inside the per-file `try` at
  `app.js:85-94`, whose catch reports "codec not supported". A `NotReadableError` from a zip
  that changed on disk would be reported as a codec problem. Eager keeps read errors in
  `loadZip` where they can be named accurately, and needs no change to `loadFiles`.
- **Eager tests better.** `extract(blob) -> [{name, bytes}]` round-trips against `buildZip`
  with byte equality. A thunk is awkward to assert on.

**Required consequence:** each entry's `bytes` must be a standalone, exact-size buffer, never a
`subarray` view into one shared allocation — `decodeAudioData` detaching one would otherwise
detach its neighbours. Per-entry `blob.slice()` already produces exactly this.

**Documented constraint:** the result is one-shot. Once `loadFiles` decodes an entry its buffer
is detached and cannot be re-read. Safe today — `arrayBuffer()` is called exactly once in the
whole app — but a trap for any future caller that tries to reuse an extract result.

## Memory

Measured against a real song, `stems/reborn/1 基隆路`: 200.4 s, six stems, 23 MB of `.m4a`.

The dominant cost is identical in every path and dwarfs everything else, because
`decodeAudioData` produces Float32 at the context's 44.1 kHz regardless of source format:

> 200.4 s × 44100 × 2 ch × 4 B = **70.7 MB per stem → ~424 MB for six**

| Path | Decoded | Source bytes in heap | Peak |
|---|---|---|---|
| Folder of `.m4a` (today) | 424 MB | ~23 MB | ~447 MB |
| Zip of `.m4a` | 424 MB | ~23 MB | ~447 MB |
| Zip of WAV (Save stems output) | 424 MB | ~212 MB | ~636 MB |
| Six loose WAVs, no zip (today) | 424 MB | ~212 MB | ~636 MB |
| *Rejected:* whole zip read into one ArrayBuffer | 424 MB | ~212 + ~212 MB | ~848 MB |

Two conclusions:

- **The zip container costs nothing.** Rows 3 and 4 are identical; the +190 MB is 16-bit PCM
  versus AAC (`lib/wav.js:32` writes 16-bit stereo → 200.4 s × 44100 × 4 B ≈ 35.4 MB per stem),
  and it is already payable today by dragging six WAVs in.
- **The tail-parse is what earns the saving**, not eager-versus-lazy. It is load-bearing, not a
  micro-optimisation: the rejected row is close enough to Chrome's per-tab heap ceiling to fail
  on a longer song.

Reducing the WAV overhead means changing the *writer* to encode `.m4a`. Out of scope here.

## UI changes

`index.html` — the second button:

```html
<label class="btn ghost">
  Load zip
  <input type="file" id="zip-input" accept=".zip,application/zip" hidden>
</label>
```

The `webkitdirectory` input is removed. Copy changes:

- Dropzone (`index.html:28`): "Drop a song folder or a `.zip` here, or use **Load zip**".
- The `file://` hint (`app.js:762-765`) must stop naming a button that no longer exists:
  "Opened from disk — dragging a folder will not work here. Zip the folder and drop that
  instead." Same correction to the folder-drop error at `app.js:721`.

Leaving either string pointing at "Load folder" is the specific regression to watch for.

## Wiring

- `app.js:663` becomes `el.zipInput.addEventListener('change', e => loadZip(e.target.files[0]))`.
- `loadZip(file)` reports `Reading zip…`, awaits `extract`, maps to the `arrayBuffer()` shape,
  and hands off to `loadFiles`.
- The drop handler gains one branch **ahead of** the folder walk: if `dt.files` holds exactly
  one `.zip`, route to `loadZip`. This branch is what makes zip-drop work on `file://`.

## Error handling

Every case names the real cause. Reported from `loadZip`, not from the decode catch.

| Case | Detection | Message |
|---|---|---|
| Not a zip | No EOCD signature in the tail | "That file is not a zip." |
| Zip64 | `0xffffffff` size/offset or `0xffff` entry count | "This zip uses Zip64, which is not supported. Re-zip it, or use Load files." |
| Encrypted | GP flag bit 0 set | "That zip is encrypted." |
| Unknown method | Not 0 or 8 | "Unsupported compression in *name*. Re-zip with Finder or `zip`." |
| Deflate, no support | `DecompressionStream('deflate-raw')` unavailable | "This browser cannot read compressed zips. Re-zip with `zip -0`, or use Load files." |
| No audio inside | Filter yields nothing | "No audio files in that zip. Supported: wav, flac, m4a, mp3, opus, aiff." |
| Read fails mid-extract | `blob.slice().arrayBuffer()` throws | "Could not read *name* from the zip — the file may have changed on disk." |

Feature-detection detail: a store-only zip must still load in a browser without
`deflate-raw`, so the check happens per entry, not up front.

## Testing

`tests/unzip.test.js`, added to the module list at `tests/test.html:17-20`, with
`lib/unzip.js` loaded as a classic script alongside `lib/stems.js` at `tests/test.html:14`.

- **Round trip.** `buildZip` (from `lib/zip.js`) → `extract` → assert names, count, order and
  byte-for-byte equality. This is the test that keeps the writer and the reader agreeing.
- **Deflate.** Build a fixture compressed with `CompressionStream('deflate-raw')`; assert the
  bytes come back identical to the store version.
- **`__MACOSX`.** A fixture containing `__MACOSX/._bass.wav` and `Song/bass.wav` yields one entry.
- **Directory entries** and non-audio names are dropped.
- **Path preservation.** `webkitRelativePath` survives, so `commonName` yields the folder name.
- **Non-zip blob** produces a clean rejection, not a hang.
- **Zip64 sentinels** produce the Zip64 error rather than a misparse.

`docs/behaviour.md` is part of the same commit: the Load-folder observable is replaced with the
Load-zip one, plus zip-drop on `file://` and folder-drop over `http://`.

## Out of scope

- Zip64 (>4 GB or >65535 entries). A stems zip is ~212 MB with six entries.
- Encrypted and multi-part/spanned zips.
- Writing `.m4a` from Save stems.
- Nested zips, and zips holding more than one song. A multi-song zip loads every audio file it
  finds as lanes — the same thing Load folder does today with a multi-song folder.

## Constraints preserved

- **No build step, no dependency.** `lib/unzip.js` is a classic script; `DecompressionStream` is
  a platform API.
- **`file://` still works.** Nothing new is an ES module, and zip-drop works where folder-drop
  could not.
- **Nothing leaves the machine.** Reading a local zip adds no network call of any kind.
- **Audio timing untouched.** The change ends at `loadFiles`; the transport, the single-`t0`
  scheduling and the rAF-draws-only rule are not involved.
