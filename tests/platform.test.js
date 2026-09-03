import { test, assertEq } from './assert.js';
import * as SansPlatform from '../lib/platform.js';

const P = SansPlatform;

/* isHandheld is pure and takes the window to read, so nothing about the real browser needs
 * stubbing — the same trick that makes SansI18n.detectLocale(langs) testable. */
function fakeWin({ coarse = false, touchPoints = 0, noMatchMedia = false, noNavigator = false } = {}) {
  const w = {};
  if (!noMatchMedia) w.matchMedia = (q) => ({ matches: q === '(pointer: coarse)' && coarse });
  if (!noNavigator) w.navigator = { maxTouchPoints: touchPoints };
  return w;
}

test('platform: a coarse pointer AND multi-touch is a handheld', () => {
  assertEq(P.isHandheld(fakeWin({ coarse: true, touchPoints: 5 })), true);
});

test('platform: a fine pointer is not a handheld even with touch', () => {
  // A touchscreen laptop: touch present, but the primary pointer is a trackpad.
  assertEq(P.isHandheld(fakeWin({ coarse: false, touchPoints: 5 })), false);
});

test('platform: a coarse pointer without multi-touch is not a handheld', () => {
  // A TV or a kiosk remote.
  assertEq(P.isHandheld(fakeWin({ coarse: true, touchPoints: 0 })), false);
});

test('platform: no matchMedia is not a handheld', () => {
  assertEq(P.isHandheld(fakeWin({ coarse: true, touchPoints: 5, noMatchMedia: true })), false);
});

test('platform: no navigator is not a handheld', () => {
  assertEq(P.isHandheld(fakeWin({ coarse: true, touchPoints: 5, noNavigator: true })), false);
});
