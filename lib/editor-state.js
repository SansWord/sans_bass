export function selectNote(state, note) {
  return { ...state, note, range: null };
}

export function selectRange(state, range) {
  return { ...state, note: null, range };
}

export function wholeSong(state, duration) {
  return selectRange(state, { from: 0, to: duration });
}

export function commandState({ note, range, gridOn }) {
  return {
    note: !!note,
    noteSnap: !!note && !!gridOn,
    rangeDelete: !!range,
    rangeSnap: !!range && !!gridOn,
  };
}

export function addBatch(groups, edits, { id, label, timeLabel } = {}) {
  return [...groups, { id, edits: [...edits], label, timeLabel }];
}

export function undoBatch(groups) {
  return groups.slice(0, -1);
}
