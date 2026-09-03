import { defineConfig } from 'vite';

export default defineConfig({
  // Relative, not root-absolute: the built site is never served from a domain root — it's
  // https://sansword.github.io/sans_bass/ for main, and /sans_bass/pr-<N>/ for a preview.
  // Vite's default absolute '/assets/...' 404s under both.
  base: './',
  server: {
    port: 8777,
  },
  build: {
    rollupOptions: {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        test: new URL('./tests/test.html', import.meta.url).pathname,
        parity: new URL('./tests/parity.html', import.meta.url).pathname,
        notes: new URL('./tests/notes.html', import.meta.url).pathname,
        // AudioWorkletNode.addModule() has no Vite-native bundling support the way
        // new Worker(new URL(...)) does — a URL passed to addModule() gets Vite's generic
        // "copy as a raw, unprocessed static asset" treatment, so the file's own
        // `import ... from 'soundtouchjs'` is left as an unresolvable bare specifier and
        // 404s/throws in the browser. Adding it as its own rollup entry here makes Vite
        // bundle it as a real module instead (imports resolved); entryFileNames below then
        // pins its output to a fixed, unhashed name so app.js can reference it directly
        // without needing to know a content hash at author time.
        'stretch-processor': new URL('./lib/stretch-processor.js', import.meta.url).pathname,
      },
      output: {
        entryFileNames: (info) =>
          info.name === 'stretch-processor' ? 'assets/stretch-processor.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
