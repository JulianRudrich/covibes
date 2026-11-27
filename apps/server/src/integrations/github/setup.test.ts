import { describe, expect, it } from 'vitest';

import { loadServerEnv } from '@server/env';
import { githubSetup } from '@server/integrations/github/setup';
import { loadWorkerEnv } from '@server/worker-env';

const values = {
  GITHUB_APP_ID: '123',
  GITHUB_APP_CLIENT_ID: 'Iv1.fixture',
  GITHUB_APP_CLIENT_SECRET: 'fixture-secret',
  GITHUB_APP_PRIVATE_KEY: 'operator-rsa-pem',
  GITHUB_APP_SLUG: 'covibes-fixture',
  GITHUB_APP_WEBHOOK_SECRET: 'fixture-secret-with-at-least-32-characters',
  TOKEN_KEY: 'fixture-token-key-at-least-32-characters',
};

describe('operator-owned GitHub App configuration', () => {
  it('is absent by default and requires all integration settings on both processes', () => {
    const server = {
      DATABASE_URL: 'postgres://localhost/app',
      DATABASE_ADMIN_URL: 'postgres://localhost/admin',
      BETTER_AUTH_SECRET: 'fixture-auth-secret-with-at-least-32-characters',
    };
    const worker = {
      DATABASE_ADMIN_URL: server.DATABASE_ADMIN_URL,
      INTERNAL_TOKEN: 'fixture-internal-at-least-32-characters',
    };
    expect(githubSetup(loadServerEnv(server))).toBeUndefined();
    for (const name of Object.keys(values)) {
      const incomplete = { ...values, [name]: '' };
      expect(() => loadServerEnv({ ...server, ...incomplete })).toThrow('GITHUB_APP');
      expect(() => loadWorkerEnv({ ...worker, ...incomplete })).toThrow('GITHUB_APP');
    }
    expect(githubSetup(loadServerEnv({ ...server, ...values }))).toMatchObject({
      appId: '123',
      redirectUri: 'http://localhost:5173/api/github/callback',
    });
    expect(githubSetup(loadWorkerEnv({ ...worker, ...values }))).toMatchObject({ appId: '123' });
  });
});
