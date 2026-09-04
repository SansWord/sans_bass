import { describe, expect, it } from 'vitest';
import { addBatch, commandState, selectNote, selectRange, undoBatch, wholeSong } from '../lib/editor-state.js';

describe('editor state', () => {
  it('makes note and range selection mutually exclusive', () => {
    expect(selectNote({ note: null, range: { from: 1, to: 2 } }, { at: 1.5, midi: 60 }))
      .toEqual({ note: { at: 1.5, midi: 60 }, range: null });
    expect(selectRange({ note: { at: 1.5, midi: 60 }, range: null }, { from: 2, to: 4 }))
      .toEqual({ note: null, range: { from: 2, to: 4 } });
  });

  it('selects the whole song as a range', () => {
    expect(wholeSong({ note: { at: 1, midi: 60 }, range: null }, 12))
      .toEqual({ note: null, range: { from: 0, to: 12 } });
  });

  it('derives note and range command enablement', () => {
    expect(commandState({ note: {}, range: null, gridOn: true })).toEqual({
      note: true, noteSnap: true, rangeDelete: false, rangeSnap: false,
    });
    expect(commandState({ note: null, range: {}, gridOn: false })).toEqual({
      note: false, noteSnap: false, rangeDelete: true, rangeSnap: false,
    });
  });

  it('stores a multi-edit operation as one ordered batch and undoes newest first', () => {
    const first = addBatch([], [{ type: 'delete', at: 1 }], { id: 1 });
    const second = addBatch(first, [{ type: 'delete', at: 2 }, { type: 'delete', at: 3 }], { id: 2, label: 'range' });
    expect(second).toHaveLength(2);
    expect(second[1]).toMatchObject({ id: 2, label: 'range', edits: [{ at: 2 }, { at: 3 }] });
    expect(undoBatch(second)).toEqual(first);
  });
});
