/**
 * The note-edits JSON format — building an export payload and parsing an import file back
 * into a plan of what to apply. Pure and DOM-free: the caller (notes.js) owns actually
 * mutating channel state, dispatching a download, or reading a File.
 *
 * v2 keys stems under `stems: { <stemId>: {...} }`, with `tempo`/`tempoRange` hoisted to the
 * top level since they are one shared object (derived from drums), not per-stem data. Adding
 * a future note-capable stem (guitar, drums, piano, other) is just another key in `stems` —
 * no format bump needed. v1 files (one stem's edits at the top level, from before the shared
 * Export/Import buttons replaced one pair per stem) stay importable, routed by `data.stem`.
 */

export const NOTES_EDITS_VERSION = 2;

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

function planV2(data, loadedStems) {
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

/* A shared button has no implicit target panel to fall back on the way a per-stem button
 * did, so — unlike the old per-panel import, which let a stem-less file through with just a
 * warning — a v1 file that can't be routed to exactly one loaded stem is rejected outright. */
function planV1(data, loadedStems) {
  if (data.stem === undefined || !loadedStems.includes(data.stem)) {
    return { ok: false, reason: 'unroutable', stem: data.stem };
  }
  const { version, stem, song, tempo, tempoRange, edits, ...entry } = data;
  return {
    ok: true,
    song,
    hasTempo: tempo !== undefined,
    tempo,
    hasTempoRange: tempoRange !== undefined,
    tempoRange,
    apply: [{ stem, entry: { ...entry, edits } }],
    skipped: [],
  };
}

/**
 * Normalizes an imported edits file (v1 or v2) into a flat plan: which loaded stems to apply
 * and with what, which stems in the file have no matching loaded channel, and the shared
 * song/tempo/tempoRange to apply once. `loadedStems` is the list of stem ids this song
 * actually has channels for (e.g. ['vocals', 'bass']).
 *
 * @returns {{ok: true, song, hasTempo, tempo, hasTempoRange, tempoRange, apply, skipped}
 *          | {ok: false, reason: 'invalid' | 'unroutable', stem?: string}}
 */
export function planImport(data, loadedStems) {
  if (!data || typeof data !== 'object') return { ok: false, reason: 'invalid' };

  if (data.version === 2 && data.stems && typeof data.stems === 'object' && !Array.isArray(data.stems)) {
    return planV2(data, loadedStems);
  }
  if (data.version === 1 && Array.isArray(data.edits)) {
    return planV1(data, loadedStems);
  }
  return { ok: false, reason: 'invalid' };
}
