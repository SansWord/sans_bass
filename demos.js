import { init, getLocale, setLocale, t } from './lib/i18n.js';

function refresh() {
  document.title = t('demos.title');
  const count = document.getElementById('demo-count');
  count.textContent = t('demos.count', { count: count.dataset.count });
  document.querySelectorAll('[data-lang]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.lang === getLocale()));
  });
}

init();
document.querySelectorAll('[data-lang]').forEach((button) => {
  button.addEventListener('click', () => setLocale(button.dataset.lang));
});
window.addEventListener('sansbass:langchange', refresh);
refresh();
