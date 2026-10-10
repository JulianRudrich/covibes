import { EnvValidationError } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { loadWorkerEnv } from '@server/worker-env';

const required = {
  DATABASE_ADMIN_URL: 'postgresql://covibes_admin:admin@127.0.0.1:54320/covibes',
  INTERNAL_TOKEN: 'x'.repeat(32),
};

describe('loadWorkerEnv', () => {
  it('uses defaults for everything but the database and the internal token', () => {
    expect(loadWorkerEnv(required)).toEqual({
      ...required,
      NODE_ENV: 'development',
      APP_URL: 'http://localhost:5173',
      COLLAB_URL: 'ws://127.0.0.1:3001/api/collab',
      // The limits of the AI (spec 31a), the same as the server's.
      AI_LIMIT_PROJECT_MONTH_USD: 100,
      AI_LIMIT_USER_DAY_USD: 15,
    });
  });

  it('requires the database address and an internal token of 32 characters', () => {
    expect(() => loadWorkerEnv({})).toThrow(EnvValidationError);
    expect(() => loadWorkerEnv({})).toThrow(/DATABASE_ADMIN_URL/);
    expect(() => loadWorkerEnv({ ...required, INTERNAL_TOKEN: 'short' })).toThrow(/INTERNAL_TOKEN/);
  });

  it('only accepts a WebSocket address for the collaboration server', () => {
    expect(() => loadWorkerEnv({ ...required, COLLAB_URL: 'http://app:3000/api/collab' })).toThrow(
      /COLLAB_URL/,
    );
    expect(loadWorkerEnv({ ...required, COLLAB_URL: 'ws://app:3000/api/collab' }).COLLAB_URL).toBe(
      'ws://app:3000/api/collab',
    );
  });

  it('runs locally on the Claude login, but needs an API key in production', () => {
    expect(loadWorkerEnv(required).ANTHROPIC_API_KEY).toBeUndefined();
    const production = { ...required, NODE_ENV: 'production', FILES_DIR: '/data/files' };
    expect(() => loadWorkerEnv(production)).toThrow(/ANTHROPIC_API_KEY/);
    expect(
      loadWorkerEnv({ ...production, ANTHROPIC_API_KEY: 'sk-ant-test' }).ANTHROPIC_API_KEY,
    ).toBe('sk-ant-test');
  });

  it('needs the folder for uploaded files in production only (spec 20a)', () => {
    expect(loadWorkerEnv(required).FILES_DIR).toBeUndefined();
    expect(() =>
      loadWorkerEnv({ ...required, NODE_ENV: 'production', ANTHROPIC_API_KEY: 'sk-ant-test' }),
    ).toThrow(/FILES_DIR/);
  });

  it('takes the settings of GitLab connections, which it shares with the server', () => {
    const env = loadWorkerEnv({
      ...required,
      TOKEN_KEY: 'k'.repeat(32),
      GITLAB_CLIENT_ID: 'id',
      GITLAB_CLIENT_SECRET: 'secret',
      GITLAB_ISSUER: 'https://git.example.org',
    });

    expect(env).toMatchObject({
      TOKEN_KEY: 'k'.repeat(32),
      GITLAB_CLIENT_ID: 'id',
      GITLAB_ISSUER: 'https://git.example.org',
    });
    expect(loadWorkerEnv(required).TOKEN_KEY).toBeUndefined();
    expect(() => loadWorkerEnv({ ...required, TOKEN_KEY: 'short' })).toThrow(/TOKEN_KEY/);
    expect(() => loadWorkerEnv({ ...required, GITLAB_CLIENT_ID: 'id' })).toThrow(
      /GITLAB_CLIENT_SECRET/,
    );
  });
});
