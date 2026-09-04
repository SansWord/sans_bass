import { describe, expect, it, vi } from 'vitest';
import { exportTimestamp, jianpuExportFilename, jianpuHtml } from '../lib/jianpu-html.js';

const frag = (token, extra = {}) => ({ token, octave: 0, underline: 0, dot: false, dashes: 0, tie: false, ...extra });

describe('numbered-notation HTML export', () => {
  it('renders escaped title, heading, tempo, meter, and inline-only styling', () => {
    const html = jianpuHtml({ title: '<Song> — Bass', bars: [[frag('1')]], barsPerLine: 4, bpm: 96, beatsPerBar: 3 });
    expect(html).toContain('<title>&lt;Song&gt; — Bass</title>');
    expect(html).toContain('<h1>&lt;Song&gt; — Bass</h1>');
    expect(html).toContain('♩ = 96.0 &nbsp;&nbsp; 3/4');
    expect(html).toContain('<style>');
    expect(html).not.toMatch(/<(?:link|script)\b/i);
  });

  it('wraps bars into bordered lines without losing barlines', () => {
    const html = jianpuHtml({ title: 'Song', bars: [[frag('1')], [frag('2')], [frag('3')]], barsPerLine: 2, bpm: 120, beatsPerBar: 4 });
    expect(html.match(/class="line"/g)).toHaveLength(2);
    expect(html.match(/class="bar"/g)).toHaveLength(3);
    expect(html).toContain('border-left: 2px solid');
    expect(html).toContain('border-right: 2px solid');
  });

  it('renders octave dots, rhythm marks, ties, and chord rows in bar order', () => {
    const html = jianpuHtml({
      title: 'Song', bars: [[frag('1', { octave: 1, underline: 2, dot: true, dashes: 2, tie: true })], [frag('2', { octave: -1 })]],
      barsPerLine: 4, bpm: 120, beatsPerBar: 4,
      chords: [{ first: 'C', second: 'G/B' }, { first: 'Am', second: null }],
    });
    expect(html).toContain('class="digit ul2"');
    expect(html.match(/class="oct-dot"/g)).toHaveLength(2);
    expect(html.match(/class="dash"/g)).toHaveLength(2);
    expect(html).toContain('<span class="tie">⌣</span>');
    expect(html.indexOf('chord-first">C')).toBeLessThan(html.indexOf('chord-first">Am'));
    expect(html).toContain('chord-second">G/B');
  });

  it('omits chord markup entirely when no harmonic source exists', () => {
    expect(jianpuHtml({ title: 'Song', bars: [[frag('1')]], barsPerLine: 4, bpm: 120, beatsPerBar: 4 }))
      .not.toContain('class="chords"');
  });

  it('exports the selected capo with precomputed play keys and slash chords', () => {
    const html = jianpuHtml({ title: 'Song', bars: [[frag('1')]], barsPerLine: 4,
      bpm: 120, beatsPerBar: 4, tonic: 10, capo: 3,
      chords: [{ first: 'A#/D', second: null }] });
    expect(html).toContain('<option value="3" selected>3</option>');
    expect(html).toContain('>演奏調 G</span>');
    expect(html).toContain('>G/B</span>');
    expect(html).not.toMatch(/<(?:script|link)[^>]+(?:src|href)=/i);
  });

  it('formats channel-specific timestamped filenames separately from rendering', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 14, 5));
    expect(exportTimestamp()).toBe('2026_09_03_14_05');
    expect(jianpuExportFilename('My Song', 'bass')).toBe('sans_bass_My Song_bass_notes_2026_09_03_14_05.html');
    vi.useRealTimers();
  });
});
