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

/** A completed note channel supplies enough context to request chords, but every channel
 * already in flight must land first so the request does not omit late key/bass evidence. */
export function chordDetectionReady(channels) {
  return channels.some(({ state }) => state === 'complete')
    && channels.every(({ state }) => state !== 'running');
}
