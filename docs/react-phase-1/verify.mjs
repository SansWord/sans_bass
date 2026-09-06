// Phase-1 demo pilot evidence. It builds an isolated copy, mutates only that copy for
// discovery checks, then exercises normal and nested static mounts in Chromium.
// Run from the repository root: node docs/react-phase-1/verify.mjs [output-directory]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const output = resolve(process.argv[2] || 'docs/react-phase-1/artifacts');
const temp = await mkdtemp(resolve(tmpdir(), 'sans-bass-react-phase-1-'));
const sourceSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const report = { collectedUTC: new Date().toISOString(), sourceSha, checks: [], screens: [],
  demoStartup: [], playerStartup: [], errors: [] };
let browser;
let server;

const build = () => execFileSync('npm', ['run', 'build'], {
  cwd: temp,
  env: { ...process.env, GIT_DIR: resolve(root, '.git') },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function newContext({ viewport = { width: 1440, height: 900 }, locale, blocked = false } = {}) {
  const context = await browser.newContext({ viewport, locale: 'en-US' });
  await context.route('**/*', (route) => new URL(route.request().url()).origin === report.origin
    ? route.continue() : route.abort());
  if (locale) await context.addInitScript((saved) => {
    if (localStorage.getItem('sans_bass.lang') === null) localStorage.setItem('sans_bass.lang', saved);
  }, locale);
  if (blocked) await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Blocked', 'SecurityError'); },
    });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`);
  });
  return { context, page };
}

async function openDemos(page, base) {
  await page.goto(report.origin + base + 'demos/');
  await page.waitForSelector('#site-header .demos-link');
  assert.equal(await page.locator('#build-sha').textContent(), sourceSha);
}

try {
  await mkdir(output, { recursive: true });
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  }).trim().split('\n');
  for (const file of files.filter((name) => /\.(?:js|jsx|html|css|svg|png)$/.test(name)
    && !name.startsWith('docs/react-baseline/artifacts/')
    && !name.startsWith('docs/react-phase-1/artifacts/')
    && !name.startsWith('rips/') && !name.startsWith('stems/'))) {
    await mkdir(dirname(resolve(temp, file)), { recursive: true });
    try {
      await copyFile(resolve(root, file), resolve(temp, file));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error; // staged deletion in the working tree
    }
  }
  for (const file of ['package.json', 'package-lock.json']) await copyFile(resolve(root, file), resolve(temp, file));
  await symlink(resolve(root, 'node_modules'), resolve(temp, 'node_modules'));

  const fixture = 'phase 1 測試 & space.html';
  const fixtureBody = '<!doctype html><title>Discovery fixture</title><p>Temporary fixture</p>';
  await writeFile(resolve(temp, 'public/demos', fixture), fixtureBody);
  await writeFile(resolve(temp, 'public/demos/ignore.txt'), 'Not a demo');
  build();
  const firstGenerated = await readFile(resolve(temp, 'demos/index.html'), 'utf8');
  assert.ok(firstGenerated.includes(encodeURIComponent(fixture).replaceAll('&', '&amp;')));
  assert.ok(!firstGenerated.includes('ignore.txt'));
  assert.equal(await readFile(resolve(temp, 'dist/demos', fixture), 'utf8'), fixtureBody);

  const dist = resolve(temp, 'dist');
  server = createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname.startsWith('/pr-phase-1/')) pathname = pathname.slice('/pr-phase-1'.length);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = resolve(dist, `.${pathname}`);
      if (!file.startsWith(`${dist}/`)) { response.writeHead(403); response.end(); return; }
      const bytes = await readFile(file);
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript',
        '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[extname(file)] || 'application/octet-stream');
      response.setHeader('Cache-Control', 'no-store');
      response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolveListen) => server.listen(8781, '127.0.0.1', resolveListen));
  report.origin = 'http://127.0.0.1:8781';
  browser = await chromium.launch({ headless: true });
  report.browser = browser.version();

  {
    const { context, page } = await newContext();
    await openDemos(page, '/pr-phase-1/');
    await page.getByRole('link', { name: fixture }).click();
    assert.equal(await page.title(), 'Discovery fixture');
    report.checks.push('Temporary Unicode/space HTML demo is encoded, listed, copied unchanged, and opens; non-HTML is excluded');
    await context.close();
  }

  await rm(resolve(temp, 'public/demos', fixture));
  await rm(resolve(temp, 'public/demos/ignore.txt'));
  report.buildLog = build();
  assert.ok(!(await readFile(resolve(temp, 'demos/index.html'), 'utf8')).includes('phase 1'));
  await assert.rejects(stat(resolve(temp, 'dist/demos', fixture)), { code: 'ENOENT' });
  report.checks.push('Removing the fixture and rebuilding removes its list item and stale dist export');

  const assets = await readdir(resolve(temp, 'dist/assets'));
  const js = await Promise.all(assets.filter((name) => name.endsWith('.js')).sort().map(async (name) => ({
    name,
    bytes: (await stat(resolve(temp, 'dist/assets', name))).size,
  })));
  report.emittedJs = { files: js, totalBytes: js.reduce((sum, file) => sum + file.bytes, 0) };

  for (const base of ['/', '/pr-phase-1/']) {
    for (const [layout, viewport] of Object.entries({
      desktop: { width: 1440, height: 900 },
      narrow: { width: 390, height: 844 },
    })) {
      for (const locale of ['en', 'zh-TW']) {
        const { context, page } = await newContext({ viewport, locale });
        await openDemos(page, base);
        assert.equal(await page.locator('html').getAttribute('lang'), locale);
        assert.equal(await page.locator(`[data-lang="${locale}"]`).getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('.demos-link').getAttribute('aria-current'), 'page');
        assert.equal(await page.locator('input[type=file]').count(), 0);
        assert.equal(new URL(await page.locator('.brand').getAttribute('href'), page.url()).pathname, base);
        assert.equal(new URL(await page.locator('.demos-link').getAttribute('href'), page.url()).pathname, `${base}demos/`);
        const width = await page.evaluate(() => ({ inner: innerWidth, scroll: document.documentElement.scrollWidth }));
        assert.ok(width.scroll <= width.inner, `${base} ${layout} ${locale} overflow: ${JSON.stringify(width)}`);
        if (base === '/') {
          await page.screenshot({ path: resolve(output, `${layout}-${locale}-demos.png`), fullPage: true });
          report.screens.push({ layout, locale, ...width });
        }
        const other = locale === 'en' ? 'zh-TW' : 'en';
        await page.locator(`[data-lang="${other}"]`).click();
        await page.reload();
        await page.waitForSelector('#site-header .demos-link');
        assert.equal(await page.locator('html').getAttribute('lang'), other);
        const demo = page.locator('.demo-content li a').first();
        await demo.click();
        await page.locator('#capo').selectOption('3');
        assert.equal(await page.locator('#capo').inputValue(), '3');
        await page.goBack();
        await page.waitForSelector('#site-header .brand');
        await page.locator('.brand').click();
        await page.waitForFunction(() => !!window.sansBass);
        assert.equal(new URL(page.url()).pathname, base);
        assert.equal(await page.locator('#file-input').count(), 1);
        report.checks.push(`${base} ${layout} ${locale}: saved boot/switch/reload, responsive header, demo/capo, and player-back path`);
        await context.close();
      }
    }

    const { context, page } = await newContext({ blocked: true });
    await openDemos(page, base);
    for (const locale of ['zh-TW', 'en']) {
      await page.locator(`[data-lang="${locale}"]`).click();
      assert.equal(await page.locator('html').getAttribute('lang'), locale);
      assert.equal(await page.locator(`[data-lang="${locale}"]`).getAttribute('aria-pressed'), 'true');
    }
    report.checks.push(`${base}: blocked storage boots and switches both locales`);
    await context.close();
  }

  for (let sample = 0; sample < 5; sample++) {
    const demoRun = await newContext();
    await openDemos(demoRun.page, '/');
    report.demoStartup.push(await demoRun.page.evaluate(() => ({
      readyMs: performance.now(),
      domContentLoadedMs: performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd,
      jsTransferBytes: performance.getEntriesByType('resource')
        .filter((entry) => new URL(entry.name).pathname.endsWith('.js'))
        .reduce((sum, entry) => sum + entry.transferSize, 0),
    })));
    await demoRun.context.close();

    const playerRun = await newContext();
    await playerRun.page.goto(report.origin + '/');
    await playerRun.page.waitForFunction(() => !!window.sansBass);
    report.playerStartup.push(await playerRun.page.evaluate(() => ({
      readyMs: performance.now(),
      domContentLoadedMs: performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd,
      jsTransferBytes: performance.getEntriesByType('resource')
        .filter((entry) => new URL(entry.name).pathname.endsWith('.js'))
        .reduce((sum, entry) => sum + entry.transferSize, 0),
    })));
    await playerRun.context.close();
  }

  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = error.stack;
  throw error;
} finally {
  await browser?.close();
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  await rm(temp, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Phase-1 evidence written to ${output}`);
}
