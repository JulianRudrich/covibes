import '@testing-library/jest-dom/vitest';
import { DEFAULT_LANGUAGE, i18n } from '@web/i18n';

import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// `pnpm test` runs all packages at once; rendering can take more than three seconds under load.
// Async helpers still return as soon as their condition is met, within the test's 15-second limit.
configure({ asyncUtilTimeout: 5_000 });

// Vitest runs without globals, so Testing Library cannot register its automatic cleanup.
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  // The tests read German texts; a test that switched the language (spec 32a) leaves no trace.
  window.localStorage.removeItem('covibes.language');
  window.localStorage.removeItem('covibes.language.chosen');
  document.documentElement.lang = DEFAULT_LANGUAGE;
  if (i18n.language !== DEFAULT_LANGUAGE) await i18n.changeLanguage(DEFAULT_LANGUAGE);
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
