// Isolated build/discovery and static root/nested-base smoke; never publishes fixtures.
// Run from repo root: node docs/react-baseline/build-smoke.mjs [output-directory]
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, symlink, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, dirname, extname } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const root = process.cwd();
const out = resolve(process.argv[2] || '/tmp/sans-bass-react-baseline');
await mkdir(out, { recursive: true });
const temp = await mkdtemp(resolve(tmpdir(), 'sans-bass-build-baseline-'));
const report = { collectedUTC: new Date().toISOString(), checks: [], startup: [], errors: [] };
let browser, server;
try {
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split('\n');
  for (const file of files.filter((f) => /\.(js|html|css|svg|png)$/.test(f)
    && !f.startsWith('docs/') && !f.startsWith('rips/') && !f.startsWith('stems/'))) {
    await mkdir(dirname(resolve(temp, file)), { recursive: true });
    await copyFile(resolve(root, file), resolve(temp, file));
  }
  for (const file of ['package.json', 'package-lock.json']) await copyFile(resolve(root, file), resolve(temp, file));
  await symlink(resolve(root, 'node_modules'), resolve(temp, 'node_modules'));
  const build = () => execFileSync('npm', ['run', 'build'], { cwd: temp,
    env: { ...process.env, GIT_DIR: resolve(root, '.git') }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const demo = 'phase 0 測試 & space.html';
  await writeFile(resolve(temp, 'public/demos', demo), '<!doctype html><title>Discovery fixture</title><p>Temporary fixture</p>');
  await writeFile(resolve(temp, 'public/demos/ignore.txt'), 'Not a demo');
  build();
  const generated = await readFile(resolve(temp, 'demos/index.html'), 'utf8');
  assert.ok(generated.includes(encodeURIComponent(demo).replaceAll('&', '&amp;')));
  assert.ok(!generated.includes('ignore.txt'));
  assert.equal(await readFile(resolve(temp, 'dist/demos', demo), 'utf8'), '<!doctype html><title>Discovery fixture</title><p>Temporary fixture</p>');
  report.checks.push('Isolated actual generator/build includes encoded Unicode/space HTML filename, excludes non-HTML list entry, copies export unchanged');
  await rm(resolve(temp, 'public/demos', demo));
  await rm(resolve(temp, 'public/demos/ignore.txt'));
  report.buildLog = build();
  assert.ok(!(await readFile(resolve(temp, 'demos/index.html'), 'utf8')).includes('phase 0'));
  await assert.rejects(stat(resolve(temp, 'dist/demos', demo)), { code: 'ENOENT' });
  report.checks.push('Removing fixture and rebuilding removes list entry and stale dist export');
  const dist = resolve(temp, 'dist');
  server = createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname.startsWith('/pr-baseline/')) pathname = pathname.slice('/pr-baseline'.length);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = resolve(dist, '.' + pathname);
      if (!file.startsWith(dist + '/')) { res.writeHead(403); res.end(); return; }
      const bytes = await readFile(file);
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[extname(file)] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(8780, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:8780';
  browser = await chromium.launch({ headless: true });
  report.browser = browser.version();
  report.origin = origin;
  for (const base of ['/', '/pr-baseline/']) {
    for (const locale of ['en', 'zh-TW']) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
      await ctx.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await ctx.newPage();
      page.on('pageerror', (e) => report.errors.push(e.message));
      page.on('response', (r) => { if (r.status() >= 400) report.errors.push(`${r.status()} ${r.url()}`); });
      await page.goto(origin + base);
      await page.waitForFunction(() => !!window.sansBass);
      assert.equal(await page.locator('#build-sha').textContent(), '9636b06');
      await page.locator(`[data-lang="${locale}"]`).click();
      await page.locator('.demos-link').click();
      await page.waitForSelector('#site-header[data-ready="true"]');
      await page.waitForLoadState('load');
      assert.equal(new URL(page.url()).pathname, base + 'demos/');
      assert.equal(await page.locator('html').getAttribute('lang'), locale);
      assert.equal(await page.locator('#build-sha').textContent(), '9636b06');
      const expectedTitle = locale === 'en' ? 'Demos — sans_bass' : '匯出簡譜範例 — sans_bass';
      assert.equal(await page.title(), expectedTitle);
      assert.ok((await page.locator('#demo-count').textContent()).includes('1'));
      const exported = page.locator('.demo-content li a').first();
      await exported.click();
      await page.locator('#capo').selectOption('3');
      assert.equal(await page.locator('#capo').inputValue(), '3');
      await page.goBack();
      await page.locator('.brand').click();
      await page.waitForFunction(() => !!window.sansBass);
      assert.equal(new URL(page.url()).pathname, base);
      report.checks.push(`${base} ${locale}: SHA, locale/title/count, demo export/capo and player-back navigation`);
      // Exercise the explicit bundled AudioWorklet module (no node-processing claim).
      const modules = await page.evaluate(async (base) => {
        const ctx = new AudioContext({ sampleRate: 44100 });
        try {
          await ctx.audioWorklet.addModule(base + 'assets/stretch-processor.js');
          return { sampleRate: ctx.sampleRate, workletLoaded: true };
        } finally { await ctx.close(); }
      }, base);
      report.checks.push({ base, locale, modules });
      await ctx.close();
    }
  }
  for (let i = 0; i < 5; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
    await ctx.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await ctx.newPage();
    await page.goto(origin + '/');
    await page.waitForFunction(() => !!window.sansBass);
    report.startup.push(await page.evaluate(() => ({ readyMs: performance.now(),
      domContentLoadedMs: performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd,
      jsTransferBytes: performance.getEntriesByType('resource').filter((r) => new URL(r.name).pathname.endsWith('.js')).reduce((n, r) => n + r.transferSize, 0) })));
    await ctx.close();
  }
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = error.stack;
  throw error;
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
  await writeFile(resolve(out, 'build-report.json'), JSON.stringify(report, null, 2));
  console.log(`Build evidence written to ${out}`);
}
