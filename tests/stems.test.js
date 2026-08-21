import { test, assert, assertEq } from './assert.js';
const { detectStem, assignStems, hasMixPlusStems } = window.SansStems;

const names = (items) => items.map((i) => i.stem);

test('stems: demucs filenames map to lanes', () => {
  assertEq(detectStem('vocals.m4a'), 'vocals', 'vocals');
  assertEq(detectStem('guitar.m4a'), 'guitar', 'guitar');
  assertEq(detectStem('bass.m4a'), 'bass', 'bass');
  assertEq(detectStem('drums.m4a'), 'drums', 'drums');
  assertEq(detectStem('piano.m4a'), 'piano', 'piano');
  assertEq(detectStem('other.m4a'), 'other', 'other');
});

test('stems: the mix pattern stays deliberately narrow', () => {
  // A broad pattern once matched "track_A.m4a" and silently muted every other file.
  assertEq(detectStem('full mix.wav'), 'mix', 'explicit full mix');
  assertEq(detectStem('track_A.m4a'), null, 'generic track name is not the mix');
  assertEq(detectStem('1 基隆路.flac'), null, 'a song title is not the mix');
});

test('stems: a lone file becomes the full mix', () => {
  const out = assignStems([{ name: '1 基隆路.flac' }]);
  assertEq(out[0].stem, 'mix', 'single file is the mix');
});

test('stems: six demucs files produce six distinct lanes', () => {
  const out = assignStems(
    ['vocals.m4a', 'guitar.m4a', 'bass.m4a', 'drums.m4a', 'piano.m4a', 'other.m4a']
      .map((name) => ({ name }))
  );
  assertEq(new Set(names(out)).size, 6, 'six distinct stems');
  assert(!names(out).includes(null), 'all recognised');
});

test('stems: duplicate stem names do not collide', () => {
  const out = assignStems([{ name: 'vocals.m4a' }, { name: 'vocals-2.m4a' }]);
  assertEq(out[0].stem, 'vocals', 'first claims the slot');
  assertEq(out[1].stem, null, 'second falls back to a generic lane');
});

test('stems: an explicit stem overrides filename detection', () => {
  const out = assignStems([{ name: '1 基隆路.flac', stem: 'mix' }, { name: 'x.wav', stem: 'guitar' }]);
  assertEq(out[0].stem, 'mix', 'explicit mix honoured');
  assertEq(out[1].stem, 'guitar', 'explicit guitar honoured');
});

test('stems: THE DOUBLED-AUDIO TRAP — a mix alongside stems must be tagged', () => {
  // With 7 tracks the lone-file rule does not fire, and a real song filename matches none
  // of the mix patterns. Without an explicit stem the original becomes a generic extra
  // lane, hasMixPlusStems() is false, and it plays on top of the six stems at double
  // volume. (In-browser separation sidesteps this by dropping the original entirely; a
  // folder loaded from disk that really does hold both still depends on this.)
  const stems = ['vocals', 'guitar', 'bass', 'drums', 'piano', 'other'];

  const wrong = assignStems([
    { name: '1 基隆路.flac' },
    ...stems.map((s) => ({ name: `${s}.wav`, stem: s })),
  ]);
  assert(wrong[0].stem !== 'mix', 'without an explicit stem the original is NOT the mix');
  assertEq(hasMixPlusStems(wrong), false, 'so the player would layer it on top');

  const right = assignStems([
    { name: '1 基隆路.flac', stem: 'mix' },
    ...stems.map((s) => ({ name: `${s}.wav`, stem: s })),
  ]);
  assertEq(right[0].stem, 'mix', 'explicit tag fixes it');
  assertEq(hasMixPlusStems(right), true, 'mix now suppressed while soloing');
});

test('stems: unrecognised names still get a lane', () => {
  const out = assignStems([{ name: 'weird thing.wav' }, { name: 'another.wav' }]);
  assertEq(out[0].stem, null, 'no stem identity');
  assertEq(out[0].label, 'weird thing', 'labelled from the filename');
  assert(out[0].color && out[1].color && out[0].color !== out[1].color, 'distinct colours');
});
