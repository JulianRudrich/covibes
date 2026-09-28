import { describe, expect, it } from 'vitest';

import { safeRedirectPath } from './redirect-path';

describe('safeRedirectPath', () => {
  it.each(['/', '/p/0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de', '/p/x?tab=plan#decisions'])(
    'keeps the in-app path %s',
    (path) => {
      expect(safeRedirectPath(path)).toBe(path);
    },
  );

  it.each([
    'https://evil.example/',
    '//evil.example/login',
    '/\\evil.example',
    'javascript:alert(1)',
    'p/relative',
    '/p/\u0000x',
    '',
    42,
    undefined,
  ])('rejects %s', (value) => {
    expect(safeRedirectPath(value)).toBeUndefined();
  });
});
