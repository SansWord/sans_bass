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
      },
    },
  },
});
