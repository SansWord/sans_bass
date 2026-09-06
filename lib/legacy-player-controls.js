/** Mount the still-legacy loading/transport controls on the player application facade. */
export function mountLegacyPlayerControls(application, elements) {
  const removers = [];
  let mounted = true;

  const on = (node, type, listener) => {
    if (!node) return;
    node.addEventListener(type, listener);
    removers.push(() => node.removeEventListener(type, listener));
  };

  const ignoreReportedError = (result) => {
    if (result && typeof result.catch === 'function') result.catch(() => {});
  };

  on(elements.play, 'click', () => {
    ignoreReportedError(application.commands.togglePlayback());
  });
  on(elements.speed, 'input', () => {
    ignoreReportedError(application.commands.setPlaybackRate(Number(elements.speed.value) / 100));
  });
  on(elements.fileInput, 'change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) ignoreReportedError(application.commands.load(file));
  });

  const render = (snapshot) => {
    if (!mounted) return;
    const transport = snapshot.transport;
    elements.play?.classList.toggle('playing', !!transport.playing);
    if (elements.speed) elements.speed.value = String(Math.round(transport.playbackRate * 100));
    if (elements.speedValue) elements.speedValue.textContent = `${Math.round(transport.playbackRate * 100)}%`;
  };
  const unsubscribe = application.subscribe(render);
  render(application.getSnapshot());

  return function unmountLegacyPlayerControls() {
    if (!mounted) return;
    mounted = false;
    unsubscribe();
    while (removers.length) removers.pop()();
  };
}
