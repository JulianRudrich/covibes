import { EnvValidationError } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { loadServerEnv } from '@server/env';

describe('loadServerEnv', () => {
  it('uses defaults when nothing is set', () => {
    expect(loadServerEnv({})).toEqual({ NODE_ENV: 'development', PORT: 3001, HOST: '127.0.0.1' });
  });

  it('allows listening on all interfaces when HOST is set', () => {
    expect(loadServerEnv({ HOST: '0.0.0.0' }).HOST).toBe('0.0.0.0');
  });

  it('rejects an invalid port with a clear message', () => {
    expect(() => loadServerEnv({ PORT: 'not-a-port' })).toThrow(EnvValidationError);
    expect(() => loadServerEnv({ PORT: 'not-a-port' })).toThrow(/PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadServerEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
