import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DemoHeader } from '../components/DemoHeader.jsx';
import { setLocale } from '../lib/i18n.js';
import { mountDemoPage } from '../demos.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
afterEach(async () => {
  if (root) await act(() => root.unmount());
  root = null;
  vi.restoreAllMocks();
  Object.defineProperty(window, 'localStorage', storageDescriptor);
  document.body.replaceChildren();
});

async function renderHeader(pathname = '/sans_bass/pr-42/demos/') {
  window.history.replaceState(null, '', pathname);
  const header = document.createElement('header');
  header.className = 'bar';
  header.id = 'site-header';
  document.body.append(header);
  root = createRoot(header);
  await act(() => root.render(<StrictMode><DemoHeader /></StrictMode>));
  return header;
}

it('keeps demo navigation inside the deployed base and switches both languages', async () => {
  setLocale('en', { persist: false });
  const header = await renderHeader();
  expect(new URL(header.querySelector('.brand').href).pathname).toBe('/sans_bass/pr-42/');
  expect(new URL(header.querySelector('.demos-link').href).pathname).toBe('/sans_bass/pr-42/demos/');
  expect(header.querySelector('.demos-link').getAttribute('aria-current')).toBe('page');
  expect(header.querySelector('input[type="file"]')).toBeNull();

  await act(() => header.querySelector('[data-lang="zh-TW"]').click());
  expect(header.querySelector('.demos-link').textContent).toBe('匯出簡譜範例');
  expect(header.querySelector('[data-lang="zh-TW"]').getAttribute('aria-pressed')).toBe('true');
  await act(() => header.querySelector('[data-lang="en"]').click());
  expect(header.querySelector('.demos-link').textContent).toBe('Demos');
});

it('cleans every page subscription on development-style unmount and remount', async () => {
  setLocale('en', { persist: false });
  const active = new Set();
  const add = window.addEventListener.bind(window);
  const remove = window.removeEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    if (type === 'sansbass:langchange') active.add(listener);
    add(type, listener, options);
  });
  vi.spyOn(window, 'removeEventListener').mockImplementation((type, listener, options) => {
    if (type === 'sansbass:langchange') active.delete(listener);
    remove(type, listener, options);
  });

  const first = document.createElement('header');
  document.body.append(first);
  let dispose;
  await act(() => { dispose = mountDemoPage(first); });
  expect(active.size).toBe(2);
  await act(() => dispose());
  expect(active.size).toBe(0);

  const second = document.createElement('header');
  document.body.append(second);
  await act(() => { dispose = mountDemoPage(second); });
  expect(active.size).toBe(2);
  await act(() => dispose());
  expect(active.size).toBe(0);
});

it('boots the demo page from the saved locale', async () => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: () => 'zh-TW',
    setItem: vi.fn(),
  } });
  const header = document.createElement('header');
  const count = document.createElement('p');
  count.id = 'demo-count';
  count.dataset.count = '1';
  document.body.append(header, count);
  let dispose;
  await act(() => { dispose = mountDemoPage(header); });
  expect(document.documentElement.lang).toBe('zh-TW');
  expect(header.querySelector('.demos-link').textContent).toBe('匯出簡譜範例');
  expect(count.textContent).toBe('範例數量：1');
  await act(() => dispose());
});

it('still changes locale when storage writes are blocked', async () => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
  } });
  setLocale('en', { persist: false });
  const header = await renderHeader();
  await act(() => header.querySelector('[data-lang="zh-TW"]').click());
  expect(document.documentElement.lang).toBe('zh-TW');
  expect(header.querySelector('.demos-link').textContent).toBe('匯出簡譜範例');
});
