import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DemoHeader } from './components/DemoHeader.jsx';
import { init, t } from './lib/i18n.js';

function refreshLegacyContent() {
  document.title = t('demos.title');
  const count = document.getElementById('demo-count');
  if (count) count.textContent = t('demos.count', { count: count.dataset.count });
}

// A mount owns its root and every subscription it creates. Returning one disposer gives
// tests and Vite development remounts the same cleanup path used by future components.
export function mountDemoPage(header = document.getElementById('site-header')) {
  if (!header) return () => {};
  init();
  const root = createRoot(header);
  root.render(<StrictMode><DemoHeader /></StrictMode>);
  window.addEventListener('sansbass:langchange', refreshLegacyContent);
  refreshLegacyContent();
  return () => {
    window.removeEventListener('sansbass:langchange', refreshLegacyContent);
    root.unmount();
  };
}

const dispose = mountDemoPage();
if (import.meta.hot) import.meta.hot.dispose(dispose);
