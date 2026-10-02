import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@web': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // The server's APP_URL points here, so the web app must not move to another port.
    strictPort: true,
    // API, login and WebSockets share the web app's origin, so session cookies stay first-party.
    proxy: {
      // `xfwd` passes the caller's address on, so the login rate limit counts per client.
      '/api': { target: 'http://127.0.0.1:3001', ws: true, xfwd: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // `pnpm test` runs all packages at once, often next to `pnpm dev`; a test that renders a
    // dialog with many fields can then take longer than Vitest's five seconds.
    testTimeout: 15_000,
  },
});
