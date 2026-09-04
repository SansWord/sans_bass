import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

// Automated tiers, split by the lowest environment that can directly prove the contract.
// See docs/testing.md for the full decision tree, fixture rules, and the separate local-build,
// deployed-smoke, and manual/physical/auditory layers that do not belong in this config.
//
// - NODE: pure functions. Plain Node is the fastest thing that can run them.
// - JSDOM: needs document/events/localStorage, but not layout, computed rendering, canvas,
//   Web Audio, a real Worker, trusted input, or browser scheduling.
// - BROWSER: uses real AudioContext/OfflineAudioContext, or a real module Worker (neither
//   Node nor jsdom implements Web Audio or the browser Worker constructor, and faking either
//   would defeat the point of these tests — verify audio/worker behaviour by observing it,
//   not parameters, see CLAUDE.md). Runs in headless Chromium via Playwright so `npm test`
//   still needs no manual browser interaction.
const NODE_TESTS = [
  'soundtouch', 'transport-math', 'overlap', 'tempo', 'pitch', 'ribbon', 'zip', 'unzip', 'stems',
  'jianpu', 'platform', 'notes-edits', 'time', 'chroma', 'chords',
].map((name) => `tests/${name}.test.js`);

const JSDOM_TESTS = ['analytics', 'i18n'].map((name) => `tests/${name}.test.js`);

const BROWSER_TESTS = ['wav', 'sonify', 'notes'].map((name) => `tests/${name}.test.js`);

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: NODE_TESTS,
        },
      },
      {
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: JSDOM_TESTS,
        },
      },
      {
        test: {
          name: 'browser',
          include: BROWSER_TESTS,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
