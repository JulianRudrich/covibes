import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@server': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // API tests run against a real PostgreSQL, one per test run (see src/test-global-setup.ts).
    globalSetup: ['./src/test-global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
