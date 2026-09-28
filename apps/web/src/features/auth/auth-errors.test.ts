import { describe, expect, it } from 'vitest';

import { authErrorKey, redirectErrorKey } from './auth-errors';

describe('authErrorKey', () => {
  it('maps the status of the login client', () => {
    expect(authErrorKey({ status: 429 })).toBe('auth.errors.rateLimit');
    expect(authErrorKey({ status: 400 })).toBe('auth.errors.invalidEmail');
    expect(authErrorKey({ status: 500 })).toBe('auth.errors.generic');
    expect(authErrorKey(new Error('offline'))).toBe('auth.errors.generic');
  });
});

describe('redirectErrorKey', () => {
  it('explains expired or used links and falls back otherwise', () => {
    expect(redirectErrorKey('INVALID_TOKEN')).toBe('auth.errors.invalidLink');
    expect(redirectErrorKey('something_else')).toBe('auth.errors.generic');
  });
});
