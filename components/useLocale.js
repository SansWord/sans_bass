import { useSyncExternalStore } from 'react';
import { getLocale } from '../lib/i18n.js';

// Locale remains authoritative in lib/i18n.js. React only subscribes to its public event,
// and useSyncExternalStore guarantees that a remount releases the old page listener.
function subscribeLocale(onStoreChange) {
  window.addEventListener('sansbass:langchange', onStoreChange);
  return () => window.removeEventListener('sansbass:langchange', onStoreChange);
}

export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}
