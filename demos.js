import { initHeader } from './lib/header.js';
import { init, t } from './lib/i18n.js';

function refresh() {
  document.title = t('demos.title');
  const count = document.getElementById('demo-count');
  count.textContent = t('demos.count', { count: count.dataset.count });
}

init();
initHeader({ page: 'demos' });
window.addEventListener('sansbass:langchange', refresh);
refresh();
