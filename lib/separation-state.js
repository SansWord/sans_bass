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
