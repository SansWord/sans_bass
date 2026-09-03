/* Stem identity: which lane does a given file belong to? */

const STEMS = {
  vocals: { label: 'Vocals',    color: '#ff2e63', order: 0 },
  guitar: { label: 'Guitar',    color: '#ffb703', order: 1 },
  bass:   { label: 'Bass',      color: '#3ddc97', order: 2 },
  drums:  { label: 'Drums',     color: '#4cc9f0', order: 3 },
  piano:  { label: 'Piano',     color: '#b388ff', order: 4 },
  other:  { label: 'Other',     color: '#8d99ae', order: 5 },
  mix:    { label: 'Full mix',  color: '#e9e9ef', order: 6 },
};

const EXTRA_COLORS = ['#f77f00', '#00b4d8', '#c77dff', '#90be6d', '#f9c74f'];
const AUDIO_RE = /\.(wav|wave|flac|m4a|mp4|aac|mp3|opus|ogg|oga|aif|aiff|caf|webm)$/i;

/** Guess which instrument a file holds from its name. */
function detectStem(filename) {
  const n = filename.toLowerCase().replace(AUDIO_RE, '');
  if (/no[-_ ]?vocals?|instrumental|karaoke|backing/.test(n)) return 'other';
  if (/vocal|vox|voice|sing|lead[-_ ]?v/.test(n)) return 'vocals';
  if (/guitar|gtr|gitaa?r|rhythm|riff/.test(n)) return 'guitar';
  if (/\bbass\b|bassline|bs\b/.test(n)) return 'bass';
  if (/drum|percussion|kick|snare|beat/.test(n)) return 'drums';
  if (/piano|keys|keyboard|synth|organ/.test(n)) return 'piano';
  if (/other|residual|accomp/.test(n)) return 'other';
  // Deliberately narrow: a generic word like "track" must not claim the mix slot,
  // because the mix slot suppresses every other track when it is filled.
  if (/\bmix\b|\bfull\b|\bmaster\b|\boriginal\b/.test(n)) return 'mix';
  return null;
}

/**
 * Resolve lane identity for a set of items.
 * @param {{name: string, stem?: string}[]} items — `stem` wins over filename detection
 * @returns {{name, stem, label, color, order}[]}
 */
function assignStems(items) {
  const used = new Set();
  const out = items.map((item, i) => {
    let stem = item.stem ?? detectStem(item.name);
    if (stem && used.has(stem)) stem = null;      // no duplicate stem slots
    if (stem) used.add(stem);
    const meta = stem ? STEMS[stem] : null;
    return {
      ...item,
      stem,
      label: meta ? meta.label : item.name.replace(AUDIO_RE, ''),
      color: meta ? meta.color : EXTRA_COLORS[i % EXTRA_COLORS.length],
      order: meta ? meta.order : 10 + i,
    };
  });

  // A single unlabelled file is simply the whole song.
  if (out.length === 1 && !items[0].stem) {
    out[0].stem = 'mix';
    out[0].label = STEMS.mix.label;
    out[0].color = STEMS.mix.color;
    out[0].order = STEMS.mix.order;
  }
  return out;
}

/**
 * True when a full-mix track sits alongside real stems. The player uses this to play the
 * mix file for "Full mix" and switch to the stems when soloing — without it, the mix would
 * be summed on top of the stems it was separated from.
 */
function hasMixPlusStems(assigned) {
  return assigned.some((t) => t.stem !== 'mix') && assigned.some((t) => t.stem === 'mix');
}

export { STEMS, EXTRA_COLORS, AUDIO_RE, detectStem, assignStems, hasMixPlusStems };

window.SansStems = { STEMS, EXTRA_COLORS, AUDIO_RE, detectStem, assignStems, hasMixPlusStems };
