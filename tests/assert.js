// Thin adapter over Vitest's own `test`, so every *.test.js file keeps importing
// `test`/`assert`/`assertEq`/`assertClose` from here unchanged. A thrown Error already
// fails a Vitest test the same way it failed the old browser runAll() loop, so these
// stay plain functions rather than switching every call site to expect().
export { test } from 'vitest';

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
