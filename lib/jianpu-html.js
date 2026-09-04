/* Self-contained numbered-notation HTML rendering and export naming helpers. */
export const STEM_WORD = { vocals: 'Vocals', bass: 'Bass' };

/** The current local time as `YYYY_MM_DD_HH_MM`, for stamping an export filename so a
 *  repeated export of the same song/stem doesn't silently overwrite the last download. */
export function exportTimestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}_${p(d.getMonth() + 1)}_${p(d.getDate())}_${p(d.getHours())}_${p(d.getMinutes())}`;
}

export function jianpuExportFilename(song, stem, timestamp = exportTimestamp()) {
  return `sans_bass_${song || 'song'}_${stem}_notes_${timestamp}.html`;
}

/** Escapes text dropped into the self-contained 簡譜 export — a song/mix name can carry
 *  arbitrary characters (it comes from a ripped filename), and that export is an HTML
 *  document rather than markdown now, so it needs the same care as any other HTML output. */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** `count` small filled circles, standard 簡譜 octave dots — stacked above the digit for
 *  notes above the reference octave, below it for notes below. */
function octaveDots(count) {
  return '<span class="oct-dot"></span>'.repeat(count);
}

/** One rhythm-marked 簡譜 note fragment (see lib/jianpu.js's layoutBars) as inline HTML: the
 *  digit with 0/1/2 underlines via CSS classes, standard 簡譜 octave dots stacked above/below
 *  it from `frag.octave`, a dot for a half-beat rhythm extension, one `.dash` span per
 *  sustained extra beat, and a tie glyph when this fragment is the first half of a note
 *  split across a barline. The `.oct-up`/`.oct-down` spans are always present (even empty)
 *  so every note reserves the same vertical space and digits stay aligned along a bar. */
function fragmentHtml(frag) {
  const octUp = `<span class="oct-up">${frag.octave > 0 ? octaveDots(frag.octave) : ''}</span>`;
  const octDown = `<span class="oct-down">${frag.octave < 0 ? octaveDots(-frag.octave) : ''}</span>`;
  const digit = `<span class="digit ul${frag.underline}">${escapeHtml(frag.token)}</span>`;
  const note = `<span class="note">${octUp}${digit}${octDown}</span>`;
  const dot = frag.dot ? '<span class="dot">.</span>' : '';
  const dashes = '<span class="dash">-</span>'.repeat(frag.dashes);
  const tie = frag.tie ? '<span class="tie">⌣</span>' : '';
  return `<span class="frag">${note}${dot}${dashes}${tie}</span>`;
}

/** One bar's chord row: the first half's label at the top-left, the second half's label
 *  (only when present — lib/chords.js's detectChords() already nulls it out when it's
 *  silent or matches the first half) centered above the bar. `pair` is one entry from
 *  detectChords()'s return array, `{ first, second }`. Always renders the (possibly empty)
 *  `.chords` wrapper — see jianpuHtml below for when this is called at all — so every bar
 *  in an export that HAS chord data reserves the same vertical space, matching the
 *  `.oct-up`/`.oct-down` convention fragmentHtml already uses for octave dots. */
function chordsHtml(pair) {
  const first = pair && pair.first ? `<span class="chord-first">${escapeHtml(pair.first)}</span>` : '';
  const second = pair && pair.second ? `<span class="chord-second">${escapeHtml(pair.second)}</span>` : '';
  return `<span class="chords">${first}${second}</span>`;
}

/** A self-contained HTML page for a 簡譜 export: `bars` (from lib/jianpu.js's layoutBars)
 *  wrapped into lines of `barsPerLine`, each bar a bordered cell of rhythm-marked fragments,
 *  under a tempo/time-signature line (`♩ = <bpm>  <beatsPerBar>/4` — every bar in this app's
 *  grid is `beatsPerBar` quarter-note beats, so the note value is always fixed at 4, same
 *  assumption noteRhythm's GRID_UNITS_PER_BEAT already makes). No external assets — every
 *  rule needed to read it lives in the inlined <style>.
 *
 *  `chords` (optional, same length as `bars`) is lib/chords.js's detectChords() output,
 *  computed from whichever guitar/piano/bass stems are loaded, regardless of the channel
 *  being exported. When omitted entirely (none of those stems is loaded), no `.chords`
 *  element is rendered and `.bar` keeps its previous visual height/appearance. */
export function jianpuHtml({ title, bars, barsPerLine, bpm, beatsPerBar, chords }) {
  const lines = [];
  for (let i = 0; i < bars.length; i += barsPerLine) {
    const cells = bars.slice(i, i + barsPerLine)
      .map((frags, j) => {
        const chordRow = chords ? chordsHtml(chords[i + j]) : '';
        return `<span class="bar">${chordRow}<span class="frags">${frags.map(fragmentHtml).join('')}</span></span>`;
      })
      .join('');
    lines.push(`<div class="line">${cells}</div>`);
  }
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
       background: #faf9f6; color: #1a1a1a; padding: 32px; line-height: 2.2; }
h1 { font-size: 18px; margin: 0 0 4px; font-weight: 600; }
.tempo { font-size: 14px; color: #555; margin: 0 0 20px; }
/* Every bar keeps its own right border and the line itself carries a left border, so each
   line reads as a self-contained "| bar | bar | bar |" — the wrap between one line's last
   bar and the next line's first is never mistaken for the absence of a barline. A full
   blank line's worth of margin separates one system from the next. */
.line { display: flex; border-left: 2px solid #333; }
.line:not(:last-child) { margin-bottom: 40px; }
/* .bar is a two-row flex column: an optional .chords row (only present when this export
   carries chord data at all) above .frags, which now does the flex-row layout .bar itself
   used to do directly — moving it here rather than duplicating it keeps a chord-less export
   visually identical to before this feature (no .chords element, .frags alone lays out
   exactly like .bar did). */
.bar { display: flex; flex-direction: column; flex: 1 1 0; min-width: 0;
       border-right: 2px solid #333; padding: 4px 16px; }
.chords { position: relative; height: 15px; margin-bottom: 2px; }
.chord-first { position: absolute; left: 0; top: 0; font-size: 13px; font-weight: 700; }
.chord-second { position: absolute; left: 50%; top: 0; transform: translateX(-50%);
                font-size: 13px; font-weight: 700; }
.frags { display: flex; align-items: center; justify-content: flex-start;
         flex-wrap: wrap; gap: 12px; min-height: 1.6em; flex: 1 1 auto; }
.frag { position: relative; display: inline-flex; align-items: center; }
/* .note stacks standard 簡譜 octave dots above/below the digit. .oct-up/.oct-down keep a
   fixed minimum height (empty or not) so every digit in a bar sits on the same baseline
   regardless of how many dots its neighbours carry. */
.note { display: inline-grid; grid-template-rows: auto auto auto; justify-items: center; row-gap: 2px; }
.oct-up, .oct-down { display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 5px; }
.oct-dot { width: 4px; height: 4px; border-radius: 50%; background: #1a1a1a; }
.digit { position: relative; display: inline-block; font-size: 20px; font-weight: 600;
         line-height: 1; padding-bottom: 5px; }
.digit.ul1::after, .digit.ul2::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 1.5px; background: #1a1a1a; }
.digit.ul2::before {
  content: ""; position: absolute; left: 0; right: 0; bottom: -4px; height: 1.5px; background: #1a1a1a; }
.dot { font-weight: 900; margin-left: 1px; align-self: flex-end; }
.dash { margin-left: 3px; font-weight: 700; }
.tie { margin-left: 2px; color: #888; font-size: 14px; }
</style></head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="tempo">♩ = ${bpm.toFixed(1)} &nbsp;&nbsp; ${beatsPerBar}/4</p>
${lines.join('\n')}
</body></html>
`;
}
