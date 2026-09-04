const cloneMuted = (muted) => ({ ...muted });

function stemKeys(state) {
  return state.hasMixPlusStems ? state.keys.filter((key) => key !== 'mix') : state.keys;
}

function normalize(state) {
  const next = { ...state, muted: cloneMuted(state.muted) };
  if (!next.hasMixPlusStems) return next;
  if (next.mode === 'mix') {
    for (const key of next.keys) next.muted[key] = key !== 'mix';
  } else {
    next.muted.mix = true;
  }
  return next;
}

export function initialRouting(keys, { hasMixPlusStems = false } = {}) {
  return normalize({
    keys: [...keys],
    hasMixPlusStems,
    mode: 'mix',
    muted: Object.fromEntries(keys.map((key) => [key, false])),
    snapshot: null,
  });
}

export function allToggleLabel(state) {
  const keys = stemKeys(state);
  const allOn = keys.length > 0 && keys.every((key) => !state.muted[key]);
  if (!allOn) return 'unmuteAll';
  return state.snapshot ? 'restorePrevious' : 'muteAll';
}

export function route(state, action) {
  if (action.type === 'reset') {
    return initialRouting(action.keys, { hasMixPlusStems: !!action.hasMixPlusStems });
  }

  const next = { ...state, muted: cloneMuted(state.muted), snapshot: state.snapshot && { ...state.snapshot } };
  const stems = stemKeys(next);

  if (action.type === 'mode') {
    next.mode = action.mode;
    if (action.mode === 'mix') {
      for (const key of next.keys) next.muted[key] = next.hasMixPlusStems ? key !== 'mix' : false;
    } else if (action.mode !== 'custom') {
      for (const key of next.keys) next.muted[key] = key !== action.mode;
    }
    return normalize(next);
  }

  if (action.type === 'toggle') {
    if (next.hasMixPlusStems && action.key === 'mix') {
      if (next.mode === 'mix') {
        next.mode = 'custom';
        for (const key of stems) next.muted[key] = false;
      } else {
        next.mode = 'mix';
      }
    } else {
      next.muted[action.key] = !next.muted[action.key];
      next.mode = 'custom';
    }
    return normalize(next);
  }

  if (action.type === 'all') {
    const allOn = stems.length > 0 && stems.every((key) => !next.muted[key]);
    const allOff = stems.length > 0 && stems.every((key) => next.muted[key]);
    if (allOn) {
      if (next.snapshot) {
        for (const key of stems) next.muted[key] = next.snapshot[key];
        next.snapshot = null;
      } else {
        for (const key of stems) next.muted[key] = true;
      }
      next.mode = 'custom';
    } else {
      next.snapshot = allOff ? null : Object.fromEntries(stems.map((key) => [key, next.muted[key]]));
      for (const key of stems) next.muted[key] = false;
      next.mode = next.hasMixPlusStems ? 'custom' : 'mix';
    }
    return normalize(next);
  }

  return normalize(next);
}
