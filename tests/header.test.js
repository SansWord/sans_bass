import { afterEach, expect, it, vi } from 'vitest';
import { initHeader } from '../lib/header.js';
import { setLocale } from '../lib/i18n.js';

// The legacy header has no disposer. Track its subscriptions so each fixture owns
// and removes its listeners without implying production remount cleanup exists.
let subscriptions = [];
const listen = window.addEventListener.bind(window);
afterEach(() => {
  for (const args of subscriptions) window.removeEventListener(...args);
  subscriptions = [];
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function mount(page, pathname) {
  window.history.replaceState(null, '', pathname);
  document.body.innerHTML = `<header id="site-header">${page === 'player'
    ? '<label class="loadzone"><input id="file-input" type="file"></label>' : ''}</header>`;
  vi.spyOn(window, 'addEventListener').mockImplementation((...args) => {
    subscriptions.push(args);
    listen(...args);
  });
  setLocale('en', { persist: false });
}

it('preserves the player file input and its listener through initialization and language changes', () => {
  mount('player', '/sans_bass/pr-42/');
  const input = document.getElementById('file-input');
  const change = vi.fn();
  input.addEventListener('change', change);
  initHeader();
  initHeader();
  for (const locale of ['zh-TW', 'en']) {
    document.querySelector(`[data-lang="${locale}"]`).click();
    expect(document.querySelectorAll('#file-input')).toHaveLength(1);
    expect(document.getElementById('file-input')).toBe(input);
    expect(document.querySelector(`[data-lang="${locale}"]`).getAttribute('aria-pressed')).toBe('true');
  }
  input.dispatchEvent(new Event('change'));
  expect(change).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.brand').getAttribute('aria-current')).toBe('page');
  expect(new URL(document.querySelector('.demos-link').href).pathname).toBe('/sans_bass/pr-42/demos/');
});

it('keeps demo navigation inside the deployed base and has no music loading control', () => {
  mount('demos', '/sans_bass/pr-42/demos/');
  initHeader({ page: 'demos' });
  expect(new URL(document.querySelector('.brand').href).pathname).toBe('/sans_bass/pr-42/');
  expect(document.querySelector('.demos-link').getAttribute('aria-current')).toBe('page');
  expect(document.querySelector('input[type="file"]')).toBeNull();
  document.querySelector('[data-lang="zh-TW"]').click();
  expect(document.querySelector('.demos-link').textContent).toBe('匯出簡譜範例');
});
