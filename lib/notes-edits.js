/**
 * The note-edits JSON format — building an export payload and parsing an import file back
 * into a plan of what to apply. Pure and DOM-free: the caller (notes.js) owns actually
 * mutating channel state, dispatching a download, or reading a File.
 *
 * Stems are keyed under `stems: { <stemId>: {...} }`, with `tempo`/`tempoRange` hoisted to
 * the top level since they are one shared object (derived from drums), not per-stem data.
 * Adding a future note-capable stem (guitar, drums, piano, other) is just another key in
 * `stems` — no format bump needed.
 */

/* Bumped 2 -> 3 when a stem entry's `edits` array switched from bare edit-event arrays to
 * `{edits, label?, timeLabel?}` wrapper objects, so a batch's row label (e.g. "Snap to grid")
 * survives export/import instead of falling back to the generic per-edit-type label on
 * reimport. No back-compat with v2 files, same policy as the v1 -> v2 break above: planImport()
 * just rejects one as an unrecognized file. */
export const NOTES_EDITS_VERSION = 3;

/** @param {{song?: string, tempo: object, tempoRange: object|null, stems: object}} args */
export function buildEditsPayload({ song, tempo, tempoRange, stems }) {
  return {
    version: NOTES_EDITS_VERSION,
    ...(song ? { song } : {}),
    tempo,
    tempoRange: tempoRange ?? null,
    stems,
  };
}

/**
 * Normalizes an imported edits file into a flat plan: which loaded stems to apply and with
 * what, which stems in the file have no matching loaded channel, and the shared
 * song/tempo/tempoRange to apply once. `loadedStems` is the list of stem ids this song
 * actually has channels for (e.g. ['vocals', 'bass']).
 *
 * @returns {{ok: true, song, hasTempo, tempo, hasTempoRange, tempoRange, apply, skipped}
 *          | {ok: false, reason: 'invalid'}}
 */
export function planImport(data, loadedStems) {
  if (!data || typeof data !== 'object') return { ok: false, reason: 'invalid' };
  if (data.version !== NOTES_EDITS_VERSION) return { ok: false, reason: 'invalid' };
  if (!data.stems || typeof data.stems !== 'object' || Array.isArray(data.stems)) {
    return { ok: false, reason: 'invalid' };
  }

  const apply = [];
  const skipped = [];
  for (const [stemId, entry] of Object.entries(data.stems)) {
    if (loadedStems.includes(stemId)) apply.push({ stem: stemId, entry });
    else skipped.push(stemId);
  }
  return {
    ok: true,
    song: data.song,
    hasTempo: data.tempo !== undefined,
    tempo: data.tempo,
    hasTempoRange: data.tempoRange !== undefined,
    tempoRange: data.tempoRange,
    apply,
    skipped,
  };
}
