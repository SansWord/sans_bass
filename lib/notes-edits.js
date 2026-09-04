/**
 * The note-edits JSON format — building an export payload and parsing an import file back
 * into a plan of what to apply. Pure and DOM-free: the caller (notes.js) owns actually
 * mutating channel state, dispatching a download, or reading a File.
 *
 * Stems are keyed under `stems: { <stemId>: {...} }`, with `tempo`/`tempoRange` hoisted to
 * the top level since they are shared objects, not per-stem data. `chordEdits` contains only
 * manual corrections; detected chords remain re-derivable from the audio and tempo grid.
 * Adding a future note-capable stem (guitar, drums, piano, other) is just another key in
 * `stems` — no format bump needed.
 */

/* v5 adds the song-level capo setting. v3/v4 remain readable because missing newer fields
 * have unambiguous meanings. Older structural formats remain rejected. */
export const NOTES_EDITS_VERSION = 5;
const READABLE_VERSIONS = new Set([3, 4, 5]);

/** @param {{song?: string, tempo: object, tempoRange: object|null, stems: object,
 * chordEdits?: Array<{start:number,label:string}>}} args */
export function buildEditsPayload({ song, tempo, tempoRange, stems, chordEdits = [], capo = 0 }) {
  return {
    version: NOTES_EDITS_VERSION,
    ...(song ? { song } : {}),
    tempo,
    tempoRange: tempoRange ?? null,
    chordEdits,
    capo,
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
  if (!READABLE_VERSIONS.has(data.version)) {
    return { ok: false, reason: 'invalid' };
  }
  if (!data.stems || typeof data.stems !== 'object' || Array.isArray(data.stems)) {
    return { ok: false, reason: 'invalid' };
  }
  if (data.chordEdits !== undefined && (!Array.isArray(data.chordEdits) ||
      data.chordEdits.some((edit) => !edit || !Number.isFinite(edit.start) ||
        typeof edit.label !== 'string' || !edit.label.trim()))) {
    return { ok: false, reason: 'invalid' };
  }
  if (data.capo !== undefined && (!Number.isInteger(data.capo) || data.capo < 0 || data.capo > 11)) {
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
    hasChordEdits: data.chordEdits !== undefined,
    chordEdits: (data.chordEdits || []).map((edit) => ({ start: edit.start, label: edit.label.trim() })),
    hasCapo: data.capo !== undefined,
    capo: data.capo || 0,
    apply,
    skipped,
  };
}
