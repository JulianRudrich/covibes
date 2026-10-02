import '@testing-library/jest-dom/vitest';
import '@web/i18n';

import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// `pnpm test` runs all packages at once; the first render of a file can then take longer than
// Testing Library's second, and a test that waits for it fails without anything being wrong.
configure({ asyncUtilTimeout: 3_000 });

// Vitest runs without globals, so Testing Library cannot register its automatic cleanup.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// jsdom has no ResizeObserver; Radix menus measure their trigger with it.
if (!('ResizeObserver' in globalThis)) {
  Object.assign(globalThis, {
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}
