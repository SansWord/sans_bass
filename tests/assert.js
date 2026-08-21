/* Minimal browser test runner. No dependencies — this project has no build step. */

const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

export function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEq'}: expected ${expected}, got ${actual}`);
  }
}

export function assertClose(actual, expected, tol, msg) {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(`${msg || 'assertClose'}: expected ${expected} +/- ${tol}, got ${actual}`);
  }
}

export async function runAll(outEl) {
  const results = [];
  for (const t of tests) {
    try {
      await t.fn();
      results.push({ name: t.name, ok: true });
    } catch (e) {
      results.push({ name: t.name, ok: false, error: e.message });
    }
  }
  const failed = results.filter((r) => !r.ok);
  outEl.textContent =
    results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '\n      ' + r.error}`).join('\n') +
    `\n\n${results.length - failed.length}/${results.length} passed`;
  window.__testResults = { total: results.length, failed: failed.length, results };
  console.log('[tests]', JSON.stringify(window.__testResults));
  return window.__testResults;
}
