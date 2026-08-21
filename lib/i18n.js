/* Interface i18n: one dictionary, two locales, no dependencies.
 *
 * A CLASSIC script, matching lib/stems.js and lib/unzip.js. It no longer *has* to be —
 * file:// support was dropped in v1.5.0 — but the ESM migration is a separate change
 * (see docs/superpowers/specs/2026-08-21-i18n-design.md, "Deferred").
 *
 * separate.js is an ES module and cannot share scope with app.js, so both read this
 * through window.SansI18n. That is the whole reason there is exactly one dictionary. */
(function (global) {
  const LOCALES = ['zh-TW', 'en'];
  const DEFAULT_LOCALE = 'zh-TW';      // the stated default when nothing else decides
  const STORAGE_KEY = 'sans_bass.lang';

  const DICT = {
    'zh-TW': {
      'stem.bass': '貝斯',
      'mode.only': '只聽{name}',
    },
    'en': {
      'stem.bass': 'Bass',
      'mode.only': '{name} only',
    },
  };

  let locale = DEFAULT_LOCALE;
  let booted = false;      // true once init() has claimed this document — see setLocale

  /** True when the active locale (or English) actually defines this key. */
  function has(key) {
    return DICT[locale][key] !== undefined || DICT.en[key] !== undefined;
  }

  /**
   * Look up `key`, interpolating `{name}` placeholders from `params`.
   * Falls back to English, then to the key itself — never to `undefined`, which would
   * put the string "undefined" on screen.
   */
  function t(key, params) {
    let s = DICT[locale][key];
    if (s === undefined) s = DICT.en[key];
    if (s === undefined) s = String(key);
    if (params) {
      s = s.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? params[name] : whole));
    }
    return s;
  }

  /* zh-TW covers Traditional Chinese; Simplified tags go to English, because the whole
   * point of the zh-TW copy is Taiwan terminology, which does not serve zh-CN readers. */
  function isTraditionalChinese(tag) {
    const s = String(tag).toLowerCase().replace(/_/g, '-');
    if (s === 'zh') return true;                  // bare zh: no region, take the default
    if (!s.startsWith('zh-')) return false;
    if (/\bhans\b/.test(s)) return false;         // zh-Hans, zh-Hans-CN
    if (/-(cn|sg)\b/.test(s)) return false;       // Simplified regions
    if (/\bhant\b/.test(s)) return true;          // zh-Hant, zh-Hant-TW
    return /-(tw|hk|mo)\b/.test(s);
  }

  /**
   * Which locale does this system want? PURE — it never touches storage, so the whole
   * mapping table can be unit-tested without stubbing navigator or localStorage.
   * @param {string[]} [langs] defaults to the browser's language list
   */
  function detectLocale(langs) {
    const list = langs ||
      (global.navigator && navigator.languages) ||
      (global.navigator && navigator.language ? [navigator.language] : []) ||
      [];
    if (!list.length) return DEFAULT_LOCALE;
    for (const tag of list) if (isTraditionalChinese(tag)) return 'zh-TW';
    return 'en';
  }

  /* Every storage access is guarded. Safari private mode and browsers with site data
   * blocked throw on read as well as write, and a throw here would land in app.js's flat
   * run of top-level statements and silently kill every listener below it — the v1.4.0
   * failure mode, and the worst kind of bug to debug from the user's side. */
  function storedLocale() {
    try {
      const v = global.localStorage.getItem(STORAGE_KEY);
      return LOCALES.includes(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  function getLocale() { return locale; }

  /**
   * Switch language. Does NOT reload — a reload would throw away decoded AudioBuffers and
   * stop playback mid-practice, which is the one thing this player exists to protect.
   * @param {string} loc
   * @param {{persist?: boolean}} [opts] persist defaults to true; boot passes false
   */
  function setLocale(loc, opts) {
    locale = LOCALES.includes(loc) ? loc : DEFAULT_LOCALE;
    const persist = !opts || opts.persist !== false;
    if (persist) {
      try { global.localStorage.setItem(STORAGE_KEY, locale); } catch (e) { /* see above */ }
    }
    if (global.document) {
      document.documentElement.lang = locale;
      // Only rewrite the tab title for a document i18n actually booted. tests/test.html
      // loads this file to poke at the dictionary and must keep its own title.
      if (booted) document.title = t('app.title');
      apply(document);
    }
    global.dispatchEvent(new CustomEvent('sansbass:langchange', { detail: { locale } }));
  }

  /**
   * Translate every annotated node under `root`.
   *
   *   data-i18n="key"                         → textContent (the safe default)
   *   data-i18n-html="key"                    → innerHTML, for the handful of strings that
   *                                             carry <strong>/<code>. ONLY EVER our own
   *                                             dictionary values — never user data.
   *   data-i18n-attr="title:key,aria-label:k" → setAttribute, comma-separated pairs
   */
  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((n) => {
      n.textContent = t(n.dataset.i18n);
    });
    scope.querySelectorAll('[data-i18n-html]').forEach((n) => {
      n.innerHTML = t(n.dataset.i18nHtml);
    });
    scope.querySelectorAll('[data-i18n-attr]').forEach((n) => {
      for (const pair of n.dataset.i18nAttr.split(',')) {
        const colon = pair.indexOf(':');
        if (colon < 0) continue;
        const attr = pair.slice(0, colon).trim();
        const key = pair.slice(colon + 1).trim();
        if (attr && key) n.setAttribute(attr, t(key));
      }
    });
  }

  /**
   * Boot. Called from a one-line script in index.html's <head>, so `lang` and the tab
   * title are right before anything paints; the DOM walk waits for the body to exist.
   *
   * Not run on import: tests/test.html loads this file to poke at the dictionary and must
   * not have its own <title> rewritten or its markup walked.
   */
  function init() {
    booted = true;
    locale = storedLocale() || detectLocale();
    document.documentElement.lang = locale;
    document.title = t('app.title');
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => apply(document), { once: true });
    } else {
      apply(document);
    }
  }

  global.SansI18n = {
    LOCALES, DICT, t, has, apply, init,
    detectLocale, storedLocale, getLocale, setLocale,
  };
})(window);
