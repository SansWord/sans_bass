import { test, assert, assertEq } from './assert.js';

const A = () => window.SansAnalytics;

/** Fresh state plus a recording sink. Returns the array the sink writes into. */
function collect() {
  A().reset();
  const seen = [];
  A().setSink((name) => seen.push(name));
  return seen;
}

test('analytics: track fires on every call', () => {
  const seen = collect();
  A().track('song-load');
  A().track('song-load');
  assertEq(seen.join(','), 'song-load,song-load');
});

test('analytics: once fires only the first time', () => {
  const seen = collect();
  A().once('play');
  A().once('play');
  A().once('play');
  assertEq(seen.join(','), 'play');
});

test('analytics: once tracks each name separately', () => {
  const seen = collect();
  A().once('play');
  A().once('lang-en');
  A().once('play');
  assertEq(seen.join(','), 'play,lang-en');
});

test('analytics: events fired before a sink exists are queued and drained in order', () => {
  A().reset();                       // reset clears the sink too
  A().track('early-one');
  A().track('early-two');
  const seen = [];
  A().setSink((name) => seen.push(name));
  assertEq(seen.join(','), 'early-one,early-two');
});

test('analytics: the queue is capped so a blocked transport cannot grow it without bound', () => {
  A().reset();
  for (let i = 0; i < 100; i++) A().track(`e${i}`);
  const seen = [];
  A().setSink((name) => seen.push(name));
  assertEq(seen.length, 50, 'queue should cap at 50');
  assertEq(seen[0], 'e0', 'the oldest events are the ones kept');
});

test('analytics: a throwing sink never propagates to the caller', () => {
  A().reset();
  A().setSink(() => { throw new Error('blocked by an extension'); });
  A().track('song-load');
  A().once('play');
  assert(true, 'no exception escaped');
});

test('analytics: reset clears fired names', () => {
  collect();
  A().once('play');
  const again = collect();
  A().once('play');
  assertEq(again.join(','), 'play');
});
