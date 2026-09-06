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
  'coverage-map', 'audio-fixtures', 'routing-state', 'loop-state', 'detection-state',
  'separation-state',
  'editor-state',
  'jianpu-html',
  'player-application',
].map((name) => `tests/${name}.test.js`);

const JSDOM_TESTS = [
  'tests/analytics.test.js',
  'tests/i18n.test.js',
  'tests/demo-header.test.jsx',
];

const BROWSER_TESTS = ['wav', 'sonify', 'notes', 'player'].map((name) => `tests/${name}.test.js`);

export default defineConfig({
  define: {
    __COMMIT_SHA__: JSON.stringify('test'),
  },
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
          environmentOptions: { jsdom: { url: 'http://localhost/' } },
          include: JSDOM_TESTS,
        },
      },
      {
        optimizeDeps: {
          // The production player imports React inside the browser page that hosts Vitest.
          // Pre-bundle one copy before the first iframe to keep one hook dispatcher.
          include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
        },
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
