import { setLocale, t } from '../lib/i18n.js';
import { useLocale } from './useLocale.js';

const iconUrl = new URL('../icons/icon.svg', import.meta.url).href;

/** Shared React rendering for the player and demo navigation/header contract. */
export function SiteHeaderContent({ page, locale, loadControl = null }) {
  const playerHref = page === 'demos' ? '../' : './';
  const demosHref = page === 'demos' ? './' : './demos/';
  const chooseLocale = (event, nextLocale) => {
    setLocale(nextLocale);
    // Header actions must hand focus back so the player's document shortcuts keep working.
    event.currentTarget.blur();
  };

  return <>
    <a className="brand" href={playerHref} aria-label={t('nav.player')}
      aria-current={page === 'player' ? 'page' : undefined}>
      <img className="brand-mark" src={iconUrl} alt="" width="26" height="26" />
      <span className="brand-name">sans<span>_</span>bass</span>
    </a>
    <div className="bar-right">
      <a className="demos-link" href={demosHref}
        aria-current={page === 'demos' ? 'page' : undefined}>{t('nav.demos')}</a>
      <a className="repo-link" href="https://github.com/SansWord/sans_bass"
        target="_blank" rel="noopener" title={t('repo.tip')} aria-label={t('repo.tip')}>
        <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
        </svg>
      </a>
      <div className="lang-toggle" id="lang-toggle" role="group" aria-label={t('lang.aria')}>
        <button type="button" data-lang="zh-TW" aria-pressed={locale === 'zh-TW'}
          onClick={(event) => chooseLocale(event, 'zh-TW')}>中文</button>
        <button type="button" data-lang="en" aria-pressed={locale === 'en'}
          onClick={(event) => chooseLocale(event, 'en')}>EN</button>
      </div>
      {loadControl}
    </div>
  </>;
}

export function SiteHeader({ page, loadControl = null }) {
  return <SiteHeaderContent page={page} locale={useLocale()} loadControl={loadControl} />;
}
