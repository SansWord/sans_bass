import { describe, expect, it } from 'vitest';
import { resolveStatusParams, separationView } from '../lib/separation-state.js';

describe('separation controls', () => {
  it.each([
    ['idle', { panel: true, go: true, cancel: false, save: false, goDisabled: false, saveDisabled: false }],
    ['running', { panel: true, go: true, cancel: true, save: false, goDisabled: true, saveDisabled: true }],
    ['success', { panel: true, go: false, cancel: false, save: true, goDisabled: false, saveDisabled: false }],
    ['cancel', { panel: true, go: true, cancel: false, save: false, goDisabled: false, saveDisabled: false }],
    ['error', { panel: true, go: true, cancel: false, save: false, goDisabled: false, saveDisabled: false }],
  ])('derives %s controls', (state, expected) => {
    expect(separationView({ state, singleTrack: true })).toEqual(expected);
  });

  it('hides inference controls and leaves only the explanation on handhelds', () => {
    expect(separationView({ state: 'idle', singleTrack: true, handheld: true })).toEqual({
      panel: true, go: false, cancel: false, save: false, goDisabled: true, saveDisabled: true,
    });
  });
});

describe('resolveStatusParams', () => {
  it('passes plain values through unchanged', () => {
    expect(resolveStatusParams({ segment: 2, total: 5 })).toEqual({ segment: 2, total: 5 });
  });

  it('calls function-valued params at resolve time', () => {
    let calls = 0;
    const params = { msg: () => { calls += 1; return `translated-${calls}`; } };
    expect(resolveStatusParams(params)).toEqual({ msg: 'translated-1' });
    expect(resolveStatusParams(params)).toEqual({ msg: 'translated-2' });
  });

  it('leaves null/undefined untouched', () => {
    expect(resolveStatusParams(null)).toBeNull();
    expect(resolveStatusParams(undefined)).toBeUndefined();
  });
});
