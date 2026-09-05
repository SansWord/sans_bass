import { apply, getLocale, setLocale } from './i18n.js';

const iconUrl = new URL('../icons/icon.svg', import.meta.url).href;

// Keep ordinary DOM nodes so the shared dictionary and player file-input wiring can
// reach them. The player-owned load control is moved once, never recreated.
export function initHeader({ page = 'player' } = {}) {
  const header = document.getElementById('site-header');
  if (!header || header.dataset.ready) return;
  const playerHref = page === 'demos' ? '../' : './';
  const demosHref = page === 'demos' ? './' : './demos/';
  const loadzone = header.querySelector('.loadzone');
  header.innerHTML = `  <a class="brand" href="${playerHref}" data-i18n-attr="aria-label:nav.player">
    <img class="brand-mark" src="${iconUrl}" alt="" width="26" height="26">
    <span class="brand-name">sans<span>_</span>bass</span>
  </a>
  <div class="bar-right">
    <a class="demos-link" href="${demosHref}" data-i18n="nav.demos">Demos</a>
    <a class="repo-link" href="https://github.com/SansWord/sans_bass"
       target="_blank" rel="noopener"
       data-i18n-attr="title:repo.tip,aria-label:repo.tip" aria-label="View the source on GitHub">
      <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
      </svg>
    </a>
    <div class="lang-toggle" id="lang-toggle" role="group" data-i18n-attr="aria-label:lang.aria">
      <button type="button" data-lang="zh-TW">中文</button>
      <button type="button" data-lang="en">EN</button>
    </div>
  </div>`;
  if (loadzone) header.querySelector('.bar-right').append(loadzone);
  header.querySelector(page === 'demos' ? '.demos-link' : '.brand').setAttribute('aria-current', 'page');
  const toggle = header.querySelector('#lang-toggle');
  const refresh = () => {
    apply(header);
    toggle.querySelectorAll('[data-lang]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.lang === getLocale()));
    });
  };
  toggle.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-lang]');
    if (button) setLocale(button.dataset.lang);
  });
  window.addEventListener('sansbass:langchange', refresh);
  header.dataset.ready = 'true';
  refresh();
}
