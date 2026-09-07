/**
 * Resolve a status-line params object for rendering. A param may be a plain value or a
 * thunk (`() => translatedString`) when the translated text itself depends on the *current*
 * locale rather than the locale active when the status was published — resolving thunks at
 * render time (not publish time) is what lets a language switch mid-run retranslate
 * correctly instead of freezing on whatever locale was active when the thunk was created.
 */
export function resolveStatusParams(params) {
  if (!params) return params;
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = typeof value === 'function' ? value() : value;
  }
  return out;
}

export function separationView({ state, singleTrack, handheld = false }) {
  const panel = singleTrack || state === 'success';
  if (handheld) {
    return { panel, go: false, cancel: false, save: false, goDisabled: true, saveDisabled: true };
  }
  const running = state === 'running';
  const success = state === 'success';
  return {
    panel,
    go: panel && !success,
    cancel: running,
    save: success,
    goDisabled: running,
    saveDisabled: running,
  };
}
