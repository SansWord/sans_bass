import { test, assert, assertEq } from './assert.js';
const I18N = window.SansI18n;

test('i18n: t() looks up the active locale', () => {
  I18N.setLocale('en', { persist: false });
  assertEq(I18N.t('stem.bass'), 'Bass', 'english');
  I18N.setLocale('zh-TW', { persist: false });
  assertEq(I18N.t('stem.bass'), '貝斯', 'chinese');
  I18N.setLocale('en', { persist: false });
});

test('i18n: an unknown key renders as itself, not as "undefined"', () => {
  I18N.setLocale('en', { persist: false });
  assertEq(I18N.t('no.such.key'), 'no.such.key', 'key passthrough');
  assertEq(I18N.has('no.such.key'), false, 'has() reports it missing');
  assertEq(I18N.has('stem.bass'), true, 'has() finds a real key');
});

test('i18n: {placeholders} are interpolated, unknown ones left alone', () => {
  I18N.setLocale('en', { persist: false });
  assertEq(I18N.t('mode.only', { name: 'Bass' }), 'Bass only', 'substituted');
  assertEq(I18N.t('mode.only', {}), '{name} only', 'missing param left visible');
});

test('i18n: detectLocale maps system languages to a locale', () => {
  const cases = [
    [['zh-TW'], 'zh-TW'],
    [['zh-Hant-TW'], 'zh-TW'],
    [['zh-Hant'], 'zh-TW'],
    [['zh-HK'], 'zh-TW'],
    [['zh-MO'], 'zh-TW'],
    [['zh'], 'zh-TW'],
    [['en-US'], 'en'],
    [['en-US', 'zh-TW'], 'zh-TW'],   // any Traditional tag in the list wins
    [['zh-CN'], 'en'],               // Simplified: Taiwan terminology does not serve it
    [['zh-Hans-CN'], 'en'],
    [['zh-SG'], 'en'],
    [['ja'], 'en'],
    [[], 'zh-TW'],                   // nothing to go on: the stated default
  ];
  for (const [langs, expected] of cases) {
    assertEq(I18N.detectLocale(langs), expected, `detectLocale(${JSON.stringify(langs)})`);
  }
});

test('i18n: detectLocale is pure — it never reads storage', () => {
  // Storage is consulted by storedLocale(), not detectLocale(). Keeping them separate is
  // what lets the table above be tested without stubbing localStorage or navigator.
  assertEq(I18N.detectLocale(['en-US']), 'en', 'a stored choice must not leak in here');
});

test('i18n: setLocale rejects an unknown locale rather than blanking the UI', () => {
  I18N.setLocale('klingon', { persist: false });
  assertEq(I18N.getLocale(), 'zh-TW', 'falls back to the default locale');
  I18N.setLocale('en', { persist: false });
});
