export function detectionView(channels) {
  const anyStem = channels.some(({ state }) => state !== 'absent');
  const pending = channels.filter(({ state }) => state === 'pending');
  const running = channels.filter(({ state }) => state === 'running');
  return {
    sectionVisible: !(anyStem && pending.length === 0 && running.length === 0),
    buttonDisabled: running.length > 0 || pending.length === 0,
    spinnerVisible: running.length > 0,
    busyStems: running.map(({ stem }) => stem),
  };
}
