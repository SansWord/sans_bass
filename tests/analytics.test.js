import { test, assert, assertEq } from './assert.js';
import * as SansAnalytics from '../lib/analytics.js';

const A = () => SansAnalytics;

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

test('analytics: bump fires the base event on the first occurrence', () => {
  const seen = collect();
  A().bump('seek');
  assertEq(seen.join(','), 'seek');
});

test('analytics: bump fires a bucket at each power of two', () => {
  const seen = collect();
  for (let i = 0; i < 8; i++) A().bump('seek');
  assertEq(seen.join(','), 'seek,seek-2,seek-4,seek-8');
});

test('analytics: bump is silent on counts that are not powers of two', () => {
  const seen = collect();
  for (let i = 0; i < 7; i++) A().bump('seek');   // counts 1..7
  assertEq(seen.join(','), 'seek,seek-2,seek-4');
});

test('analytics: bump counts each name independently', () => {
  const seen = collect();
  A().bump('seek');
  A().bump('toggle');
  A().bump('seek');
  assertEq(seen.join(','), 'seek,toggle,seek-2');
});

test('analytics: bump stops at the 4096 cap', () => {
  const seen = collect();
  for (let i = 0; i < 8192; i++) A().bump('seek');
  assertEq(seen[seen.length - 1], 'seek-4096', 'the last bucket is 4096');
  assertEq(seen.length, 13, 'base plus twelve buckets: 2,4,...,4096');
});

test('analytics: reset clears bump counters', () => {
  collect();
  for (let i = 0; i < 4; i++) A().bump('seek');
  const again = collect();
  A().bump('seek');
  assertEq(again.join(','), 'seek', 'the counter restarted, so the base fires again');
});

test('analytics: watch() installs the GoatCounter sink and drains the queue', async () => {
  A().reset();
  A().track('queued-before-load');

  const got = [];
  window.goatcounter = { count: (vars) => got.push(vars) };
  A().watch();
  await new Promise((r) => setTimeout(r, 500));
  delete window.goatcounter;

  assertEq(got.length, 1, 'the queued event reached GoatCounter');
  assertEq(got[0].path, 'queued-before-load');
  assertEq(got[0].event, true, 'must be sent as an event, not a pageview');
});
