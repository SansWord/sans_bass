import { test, assertEq, assertClose } from './assert.js';
const M = window.SansTransportMath;

test('transport-math: clampRatePercent snaps to the nearest step and clamps to range', () => {
  assertEq(M.clampRatePercent(100), 100);
  assertEq(M.clampRatePercent(103), 105, 'snaps to the nearest 5');
  assertEq(M.clampRatePercent(102), 100, 'snaps down when closer to the lower step');
  assertEq(M.clampRatePercent(200), 150, 'clamped to the max');
  assertEq(M.clampRatePercent(0), 50, 'clamped to the min');
});

test('transport-math: nudgeRatePercent moves by exactly one step and stays in range', () => {
  assertEq(M.nudgeRatePercent(100, 5), 105);
  assertEq(M.nudgeRatePercent(100, -5), 95);
  assertEq(M.nudgeRatePercent(150, 5), 150, 'does not overshoot the max');
  assertEq(M.nudgeRatePercent(50, -5), 50, 'does not undershoot the min');
});

test('transport-math: currentTimeAtRate at 100% matches the un-rate-scaled formula', () => {
  const t = M.currentTimeAtRate({ offset: 10, elapsed: 2, ratePercent: 100, loopA: null, loopB: null, duration: 300 });
  assertClose(t, 12, 1e-9);
});

test('transport-math: currentTimeAtRate at 50% advances the song at half speed', () => {
  const t = M.currentTimeAtRate({ offset: 10, elapsed: 2, ratePercent: 50, loopA: null, loopB: null, duration: 300 });
  assertClose(t, 11, 1e-9, '2s of real time at half speed is 1s of song time');
});

test('transport-math: currentTimeAtRate at 150% advances the song at 1.5x', () => {
  const t = M.currentTimeAtRate({ offset: 0, elapsed: 2, ratePercent: 150, loopA: null, loopB: null, duration: 300 });
  assertClose(t, 3, 1e-9);
});

test('transport-math: currentTimeAtRate is capped at duration when not looping', () => {
  const t = M.currentTimeAtRate({ offset: 295, elapsed: 10, ratePercent: 100, loopA: null, loopB: null, duration: 300 });
  assertEq(t, 300);
});

test('transport-math: currentTimeAtRate wraps inside the loop at a scaled pace', () => {
  // loop [10,12): offset 11, 3s real elapsed at 50% = 1.5s song time -> 12.5, wraps to 10.5.
  const t = M.currentTimeAtRate({ offset: 11, elapsed: 3, ratePercent: 50, loopA: 10, loopB: 12, duration: 300 });
  assertClose(t, 10.5, 1e-9);
});
