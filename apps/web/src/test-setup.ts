import '@testing-library/jest-dom/vitest';
import '@web/i18n';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

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
