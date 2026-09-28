import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // One fresh PostgreSQL per test run, shared by all test files (see src/test-global-setup.ts).
    globalSetup: ['./src/test-global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
