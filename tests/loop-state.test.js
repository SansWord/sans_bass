import { describe, expect, it } from 'vitest';
import { clearLoop, loopPlan, setLoopPoint } from '../lib/loop-state.js';

describe('loop state', () => {
  it('orders A and B regardless of entry order', () => {
    expect(setLoopPoint({ a: null, b: 8 }, 'a', 12)).toEqual({ a: 8, b: 12, rejected: false });
  });

  it('rejects a second point less than 100ms away', () => {
    expect(setLoopPoint({ a: 4, b: null }, 'b', 4.099)).toEqual({ a: 4, b: null, rejected: true });
  });

  it('clears both points', () => {
    expect(clearLoop()).toEqual({ a: null, b: null, rejected: false });
  });

  it('loops only sources long enough to reach B', () => {
    expect(loopPlan([10, 4.5], { a: 2, b: 5 })).toEqual([
      { loop: true, loopStart: 2, loopEnd: 5 },
      { loop: false, loopStart: null, loopEnd: null },
    ]);
  });
});
