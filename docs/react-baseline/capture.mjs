// Phase-0 repeatable local browser evidence. Start npm run dev at 127.0.0.1:8777 first.
// Run: node docs/react-baseline/capture.mjs [output-directory]
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const output = resolve(process.argv[2] || '/tmp/sans-bass-react-baseline');
await mkdir(output, { recursive: true });
const origin = 'http://127.0.0.1:8777';
const browser = await chromium.launch({ headless: true });
const report = { collectedUTC: new Date().toISOString(), browser: browser.version(), origin,
  conditions: { deviceScaleFactor: 1, locale: 'en-US', headless: true,
    externalNetwork: 'blocked', cache: 'fresh browser context per startup sample; Vite server warm',
    fixture: { stems: { vocals: 440, bass: 110, drums: { kind: 'click', bpm: 120, phase: 0 } },
      seconds: 10, folder: 'Phase 0 synthetic' } },
  screens: [], startup: [], errors: [], checks: [] };
async function context(viewport = { width: 1440, height: 900 }, blocked = false) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-US' });
  await ctx.route('**/*', (route) => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
  if (blocked) await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.errors.push(e.message));
  return { ctx, page };
}
async function boot(page, path = '/') {
  await page.goto(origin + path);
  await page.waitForSelector('#site-header[data-ready="true"]');
  if (path === '/') await page.waitForFunction(() => !!window.sansBass);
  assert.equal(await page.locator('#build-sha').textContent(), '9636b06');
}
async function load(page) {
  return page.evaluate(async (fixture) => {
    const { stemsZip } = await import('/tests/helpers/audio-fixtures.js');
    const blob = stemsZip(fixture.stems, { seconds: fixture.seconds, folder: fixture.folder });
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'phase-0.zip', { type: 'application/zip' }));
    const input = document.getElementById('file-input');
    const start = performance.now();
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Load timeout')); }, 10000);
      const observer = new MutationObserver(() => {
        if (document.getElementById('title').textContent === fixture.folder
            && document.querySelectorAll('.lane-name .txt').length >= 3) {
          clearTimeout(timeout); observer.disconnect(); requestAnimationFrame(() => resolve());
        }
      });
      observer.observe(document.getElementById('lanes'), { childList: true, subtree: true });
    });
    return performance.now() - start;
  }, report.conditions.fixture);
}
async function screen(page, name) {
  await page.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); await new Promise(requestAnimationFrame); });
  const dimensions = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth, height: document.documentElement.scrollHeight }));
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  report.screens.push({ name, ...dimensions });
}
try {
  // Warm source transforms once; measured samples still have fresh browser contexts.
  { const { ctx, page } = await context(); await boot(page); await load(page); await ctx.close(); }
  for (let i = 0; i < 5; i++) {
    const { ctx, page } = await context();
    await boot(page);
    const startup = await page.evaluate(() => ({ readyMs: performance.now(),
      domContentLoadedMs: performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd }));
    startup.loadToFrameMs = await load(page);
    report.startup.push(startup);
    await ctx.close();
  }
  for (const [layout, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, narrow: { width: 390, height: 844 } })) {
    for (const locale of ['en', 'zh-TW']) {
      const { ctx, page } = await context(viewport);
      await boot(page);
      await page.locator(`[data-lang="${locale}"]`).click();
      await screen(page, `${layout}-${locale}-empty`);
      await load(page);
      await screen(page, `${layout}-${locale}-loaded`);
      await page.locator('#mode').selectOption('bass');
      assert.equal(await page.locator('#mode').inputValue(), 'bass');
      await screen(page, `${layout}-${locale}-routing`);
      await page.keyboard.press('a');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('b');
      await page.locator('#loop-badge').waitFor({ state: 'visible' });
      await screen(page, `${layout}-${locale}-loop`);
      // Use real local notes Workers over deterministic synthetic audio, no model download.
      await page.locator('#notes-go-all').click();
      await page.locator('#notes-vocals').waitFor({ state: 'visible', timeout: 20000 });
      await page.locator('#notes-bass').waitFor({ state: 'visible', timeout: 20000 });
      const edit = page.locator('#notes-edit');
      await edit.check();
      await screen(page, `${layout}-${locale}-editor`);
      await page.locator('#file-input').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') });
      await page.waitForFunction(() => document.getElementById('status').classList.contains('err'));
      await screen(page, `${layout}-${locale}-error`);
      await page.locator('.demos-link').click();
      await page.waitForSelector('#site-header[data-ready="true"]');
      await page.waitForLoadState('load');
      assert.equal(await page.locator('html').getAttribute('lang'), locale);
      assert.equal(await page.locator('input[type=file]').count(), 0);
      await screen(page, `${layout}-${locale}-demos`);
      report.checks.push(`${layout}/${locale}: stored locale persisted into demos; load/routing/loop/real notes Worker/editor/error visible`);
      await ctx.close();
    }
  }
  // Trustworthy input at the browser automation boundary; no human listening claim.
  const { ctx, page } = await context();
  await boot(page); await load(page);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.sansBass.transport().playing);
  report.playback = await page.evaluate(async () => {
    const stamps = [];
    await new Promise((resolve) => {
      const frame = (time) => { stamps.push(time); if (stamps.length < 121) requestAnimationFrame(frame); else resolve(); };
      requestAnimationFrame(frame);
    });
    return { transport: window.sansBass.transport(), displayedTime: document.getElementById('t-cur').textContent,
      frameIntervalsMs: stamps.slice(1).map((time, i) => time - stamps[i]) };
  });
  report.controlToFrameMs = await page.evaluate(async () => {
    const samples = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      document.querySelector('#lanes .lane-name').click();
      await new Promise(requestAnimationFrame);
      samples.push(performance.now() - start);
    }
    return samples;
  });
  await ctx.close();
  for (const path of ['/', '/demos/']) {
    const { ctx, page } = await context(undefined, true);
    await boot(page, path);
    for (const locale of ['zh-TW', 'en']) {
      await page.locator(`[data-lang="${locale}"]`).click();
      assert.equal(await page.locator('html').getAttribute('lang'), locale);
      assert.equal(await page.locator(`[data-lang="${locale}"]`).getAttribute('aria-pressed'), 'true');
    }
    report.checks.push(`${path}: blocked storage boots and switches both locales`);
    await ctx.close();
  }
} catch (error) {
  report.failure = error.stack;
  throw error;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(`Evidence written to ${output}`);
}
