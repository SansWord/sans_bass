import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

/** Every React portal host id an entry page must carry, in markup order. */
function hostIds(html) {
  return [...html.matchAll(/<div\s+id="([a-z0-9-]+(?:-ui-root|-lanes-root|-lane-root|-root))"/g)]
    .map((match) => match[1]);
}

describe('fixed-song page markup', () => {
  // mountPlayerShell resolves every host up front and refuses to mount at all if one is
  // missing — a page that drifts behind index.html does not degrade, it goes blank. This is
  // the cheapest place to notice, since the two files are edited months apart.
  it('carries exactly the portal hosts index.html carries', () => {
    expect(hostIds(read('puma_taipei_smooth.html'))).toEqual(hostIds(read('index.html')));
  });

  // In markup, never in a module: Vite merges a page's module scripts into one entry chunk
  // and static imports hoist, so a module that declares the song "before app.js" in dev runs
  // after it once built, and the built page paints a file input it must not have.
  it('declares the fixed song in markup, where no bundler can reorder it', () => {
    const html = read('puma_taipei_smooth.html');
    expect(html).toMatch(/<body[^>]*\sdata-fixed-song="[^"]+"/);
    expect(html).not.toMatch(/<script[^>]*src="[^"]*fixed-song/);
  });

  it('offers no file input of its own', () => {
    expect(read('puma_taipei_smooth.html')).not.toContain('file-input');
  });

  it('is built as its own Vite entry, or it ships as an unprocessed copy', () => {
    expect(read('vite.config.js')).toContain('puma_taipei_smooth.html');
  });

  // Hidden, never deleted: mountPlayerShell resolves every host up front, so removing the
  // markup would take the whole page down rather than just the controls.
  it('hides note detection, editing and the tempo controls, keeping their portal hosts', () => {
    const html = read('puma_taipei_smooth.html');
    for (const id of ['detection-ui-root', 'notes-vocals', 'notes-bass', 'chord-stems-ui-root',
      'tempo-ui-root']) {
      expect(html, id).toContain(`id="${id}"`);
      expect(html, id).toMatch(new RegExp(`#${id}\\b[^{]*\\{[^}]*display:\\s*none`, 's'));
    }
  });

  it('uses its own stylesheet so its look can diverge from the player', () => {
    const html = read('puma_taipei_smooth.html');
    expect(html).toContain('href="puma.css"');
    expect(html).not.toContain('href="styles.css"');
    // A copy, not a re-export: an @import of styles.css would defeat the point.
    expect(read('puma.css')).not.toMatch(/@import[^;]*styles\.css/);
  });

  it('hides the language toggle and the demos link', () => {
    const html = read('puma_taipei_smooth.html');
    expect(html).toMatch(/#lang-toggle\b[^{]*\{[^}]*display:\s*none/s);
    expect(html).toMatch(/\.demos-link\b[^{]*\{[^}]*display:\s*none/s);
  });

  // persist: false is the point. init() has already read whatever locale the visitor chose on
  // the main player, and persisting zh-TW here would change that player's language for them.
  it('locks the locale to zh-TW without writing it to storage', () => {
    const html = read('puma_taipei_smooth.html');
    expect(html).toMatch(/setLocale\(\s*'zh-TW'\s*,\s*\{\s*persist:\s*false\s*\}\s*\)/);
    expect(html).not.toMatch(/setLocale\(\s*'zh-CN'|zh-Hans/);
  });

  it('embeds the record through the no-cookie host and never autoplays', () => {
    const html = read('puma_taipei_smooth.html');
    expect(html).toContain('youtube-nocookie.com/embed/');
    expect(html).toContain('loading="lazy"');
    expect(html).not.toMatch(/autoplay=1|[?&]autoplay/);
    // The reserved 16:9 box is what stops the lazy frame shifting the page when it arrives.
    expect(read('puma.css')).toMatch(/\.yt-frame\b[^}]*aspect-ratio:\s*16\s*\/\s*9/s);
  });

  it('keeps the tempo grid by driving tempoGrid, not note detection', () => {
    const html = read('puma_taipei_smooth.html');
    expect(html).toContain('tempoGrid.commands.redetect()');
    expect(html).not.toMatch(/detection\.commands|notes-go-all/);
  });
});

describe('fixed song store', () => {
  const loads = [];
  let fetchMock;
  let configure;
  let fixedSong;
  let isFixedSong;

  // A fresh module graph per test, not a shared one reset between them: both the store's
  // configuration and the application singleton it hands songs to are module-level and
  // one-shot by design (configure() is a page's declaration; the application refuses a
  // second initialize and cannot be un-disposed). Re-importing is what a real page load
  // does anyway.
  beforeEach(async () => {
    vi.resetModules();
    loads.length = 0;
    const { playerApplication } = await import('../lib/player-application.js');
    playerApplication.initialize({
      getSnapshot: () => ({}),
      // Only `load` matters here; the transport/chord projections just have to exist,
      // because initialize() publishes all three before any command runs.
      getTransportSnapshot: () => ({ playing: false, position: 0, duration: 0 }),
      getChordSnapshot: () => ({
        visible: false, busy: false, busyPhase: null, capo: 0, playKeyLetter: null,
        inputVisible: false, inputValue: '', inputAmbiguous: false, inputEdited: false,
        candidatesVisible: false, candidates: [], redetectVisible: false,
      }),
      commands: { load: (file) => { loads.push(file); } },
    });
    ({ configure, fixedSong, isFixedSong } = await import('../lib/fixed-song.js'));
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const zipResponse = (bytes, { length = true } = {}) => ({
    ok: true,
    headers: { get: (name) => (name === 'content-length' && length ? String(bytes.length) : null) },
    body: {
      getReader: () => {
        let sent = false;
        return { read: async () => (sent ? { done: true } : (sent = true, { done: false, value: bytes })) };
      },
    },
  });

  it('is inactive until a page configures one', () => {
    expect(isFixedSong()).toBe(false);
    expect(fixedSong.getSnapshot().active).toBe(false);
  });

  it('hands the downloaded zip to the ordinary load command as a File', async () => {
    const bytes = new Uint8Array([80, 75, 3, 4, 0, 0]);
    fetchMock.mockResolvedValue(zipResponse(bytes));
    configure({ url: 'https://example.invalid/stems.zip', filename: 'puma_taipei_smooth_stems.zip' });

    expect(isFixedSong()).toBe(true);
    await fixedSong.commands.start();

    expect(loads).toHaveLength(1);
    expect(loads[0].name).toBe('puma_taipei_smooth_stems.zip');
    expect(await loads[0].arrayBuffer()).toEqual(bytes.buffer);
    expect(fixedSong.getSnapshot().phase).toBe('loaded');
  });

  it('reports total bytes when the host exposes Content-Length, and none when it does not', async () => {
    const bytes = new Uint8Array(64);
    fetchMock.mockResolvedValue(zipResponse(bytes, { length: false }));
    configure({ url: 'https://example.invalid/stems.zip' });
    await fixedSong.commands.start();
    expect(fixedSong.getSnapshot()).toMatchObject({ received: 64, total: 0 });
  });

  it('starts once however many times it is called, so StrictMode cannot double-download', async () => {
    fetchMock.mockResolvedValue(zipResponse(new Uint8Array(8)));
    configure({ url: 'https://example.invalid/stems.zip' });
    await Promise.all([fixedSong.commands.start(), fixedSong.commands.start()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(loads).toHaveLength(1);
  });

  it('fails retryably on a bad status, naming it', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });
    configure({ url: 'https://example.invalid/stems.zip' });
    await fixedSong.commands.start();

    expect(fixedSong.getSnapshot()).toMatchObject({ phase: 'failed', failure: 'HTTP 404 Not Found' });
    expect(loads).toHaveLength(0);

    fetchMock.mockResolvedValue(zipResponse(new Uint8Array(8)));
    await fixedSong.commands.retry();
    expect(loads).toHaveLength(1);
  });

  it('returns a stable snapshot between publications', () => {
    configure({ url: 'https://example.invalid/stems.zip' });
    expect(fixedSong.getSnapshot()).toBe(fixedSong.getSnapshot());
  });

  it('refuses a configuration with no url', () => {
    expect(() => configure({ url: '' })).toThrow(TypeError);
  });
});
