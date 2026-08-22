import { test, assert, assertEq } from './assert.js';

/* Every local asset URL carries a ?v= cache buster, because GitHub Pages pins everything to
 * max-age=600 and a stale app.js against a fresh index.html is a dead page, not a degraded
 * one. The version is hand-written in three files, which means it can drift — and the drift
 * is invisible until a deploy silently serves a mismatched pair. This test is the guard.
 *
 * It reads the shipped files over HTTP rather than a constant, so it checks what the browser
 * actually gets. Needs ./scripts/serve.sh, like the rest of tests/. */

const FILES = ['../index.html', '../separate.js', '../separate.worker.js'];

// Only local assets are versioned; a jsDelivr or Hugging Face URL carries its own version.
const LOCAL_VERSIONED = /(?:src|href|from|Worker\()\s*=?\s*['"]([^'":]+?\.(?:js|css))(\?v=([^'"]*))?['"]/g;

async function fetchAll() {
  const out = {};
  for (const f of FILES) {
    const r = await fetch(f, { cache: 'no-store' });
    assert(r.ok, `could not read ${f} (${r.status}) — is serve.sh running?`);
    out[f] = await r.text();
  }
  return out;
}

test('versions: every local asset URL carries a ?v=', async () => {
  const sources = await fetchAll();
  const missing = [];
  for (const [file, text] of Object.entries(sources)) {
    for (const m of text.matchAll(LOCAL_VERSIONED)) {
      const [, url, query] = m;
      if (url.startsWith('http')) continue;
      if (!query) missing.push(`${file}: ${url}`);
    }
  }
  assertEq(missing.length, 0, `unversioned local assets: ${missing.join(', ')}`);
});

test('versions: all three files agree on one version', async () => {
  const sources = await fetchAll();
  const found = new Map();
  for (const [file, text] of Object.entries(sources)) {
    for (const m of text.matchAll(LOCAL_VERSIONED)) {
      if (m[3]) found.set(`${file} → ${m[1]}`, m[3]);
    }
  }
  const versions = [...new Set(found.values())];
  assert(versions.length > 0, 'no ?v= found at all — the regex or the markup changed');
  assertEq(versions.length, 1,
    `versions have drifted: ${[...found].map(([k, v]) => `${k}=${v}`).join(', ')}`);
});
