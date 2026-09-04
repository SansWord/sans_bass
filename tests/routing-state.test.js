import { describe, expect, it } from 'vitest';
import { allToggleLabel, initialRouting, route } from '../lib/routing-state.js';

const stems = () => initialRouting(['vocals', 'guitar', 'bass']);
const mixed = () => initialRouting(['mix', 'vocals', 'bass'], { hasMixPlusStems: true });

describe('routing state', () => {
  it('toggles only the requested lane and enters custom mode', () => {
    expect(route(stems(), { type: 'toggle', key: 'bass' })).toMatchObject({
      mode: 'custom', muted: { vocals: false, guitar: false, bass: true },
    });
  });

  it.each(['vocals', 'guitar', 'bass'])('solos %s from the play dropdown', (key) => {
    const next = route(stems(), { type: 'mode', mode: key });
    expect(next.mode).toBe(key);
    expect(next.muted).toEqual({
      vocals: key !== 'vocals', guitar: key !== 'guitar', bass: key !== 'bass',
    });
  });

  it('treats every ordinary lane on as Full mix', () => {
    const next = route(route(stems(), { type: 'toggle', key: 'bass' }), { type: 'all' });
    expect(next).toMatchObject({ mode: 'mix', muted: { vocals: false, guitar: false, bass: false } });
  });

  it('keeps an explicit mix mutually exclusive with its stems', () => {
    expect(mixed()).toMatchObject({
      mode: 'mix', muted: { mix: false, vocals: true, bass: true },
    });
    expect(route(mixed(), { type: 'toggle', key: 'mix' })).toMatchObject({
      mode: 'custom', muted: { mix: true, vocals: false, bass: false },
    });
  });

  it('mutes all on the first all-toggle and returns to all-on without saving silence', () => {
    const off = route(stems(), { type: 'all' });
    expect(off).toMatchObject({
      mode: 'custom', muted: { vocals: true, guitar: true, bass: true }, snapshot: null,
    });
    const on = route(off, { type: 'all' });
    expect(on).toMatchObject({
      mode: 'mix', muted: { vocals: false, guitar: false, bass: false }, snapshot: null,
    });
  });

  it('snapshots the current partial mix and restores it exactly', () => {
    const partial = route(stems(), { type: 'toggle', key: 'guitar' });
    const on = route(partial, { type: 'all' });
    expect(on.snapshot).toEqual({ vocals: false, guitar: true, bass: false });
    expect(route(on, { type: 'all' })).toMatchObject({ muted: partial.muted, snapshot: null });
  });

  it('labels partial, restorable, and fresh all-on states', () => {
    const partial = route(stems(), { type: 'toggle', key: 'guitar' });
    const restorable = route(partial, { type: 'all' });
    expect(allToggleLabel(partial)).toBe('unmuteAll');
    expect(allToggleLabel(restorable)).toBe('restorePrevious');
    expect(allToggleLabel(stems())).toBe('muteAll');
  });

  it('unmutes stems while suppressing an explicit mix', () => {
    const partial = route(mixed(), { type: 'toggle', key: 'bass' });
    expect(route(partial, { type: 'all' })).toMatchObject({
      mode: 'custom', muted: { mix: true, vocals: false, bass: false },
    });
  });

  it('resets mode, mutes, and stale snapshots on song load', () => {
    const dirty = route(route(stems(), { type: 'toggle', key: 'bass' }), { type: 'all' });
    expect(route(dirty, { type: 'reset', keys: ['piano'] })).toEqual(initialRouting(['piano']));
  });
});
