import { defineConfig } from 'vite';

export default defineConfig({
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
