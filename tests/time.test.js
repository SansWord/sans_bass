import { test, assertEq } from './assert.js';
import { roundSeconds } from '../lib/time.js';

test('time: roundSeconds cleans up floating-point noise from note-editing arithmetic', () => {
  assertEq(roundSeconds(207.45864999999998), 207.459, 'a real dStart/dEnd-derived `at` value');
  assertEq(roundSeconds(0.1658000000000186), 0.166, 'a real dStart value');
  assertEq(roundSeconds(-0.1856999999999971), -0.186, 'a real dEnd value (negative)');
});

test('time: roundSeconds rounds to the nearest millisecond', () => {
  assertEq(roundSeconds(1.2344), 1.234);
  assertEq(roundSeconds(1.2346), 1.235);
});

test('time: roundSeconds leaves an already-clean value unchanged', () => {
  assertEq(roundSeconds(4.5), 4.5);
  assertEq(roundSeconds(0), 0);
});
