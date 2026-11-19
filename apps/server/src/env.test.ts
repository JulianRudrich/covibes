import { EnvValidationError } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { loadServerEnv } from '@server/env';

const required = {
  DATABASE_URL: 'postgresql://covibes_app:app@127.0.0.1:54320/covibes',
  DATABASE_ADMIN_URL: 'postgresql://covibes_admin:admin@127.0.0.1:54320/covibes',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
};

const production = { ...required, NODE_ENV: 'production', FILES_DIR: '/data/files' };
const smtp = {
  SMTP_URL: 'smtps://user:secret@mail.example.com:465',
  MAIL_FROM: 'Covibes <a@b.de>',
};

describe('loadServerEnv', () => {
  it('uses defaults for everything but the database and the auth secret', () => {
    expect(loadServerEnv(required)).toEqual({
      ...required,
      NODE_ENV: 'development',
      PORT: 3001,
      HOST: '127.0.0.1',
      APP_URL: 'http://localhost:5173',
      TRUSTED_PROXIES: [],
      BETA_ALLOWED_EMAILS: [],
      COLLAB_PATH: '/api/collab',
      // The limits of the AI (spec 31a), in USD.
      AI_LIMIT_PROJECT_MONTH_USD: 100,
      AI_LIMIT_USER_DAY_USD: 15,
    });
  });

  it('requires the database addresses and the auth secret', () => {
    expect(() => loadServerEnv({})).toThrow(EnvValidationError);
    expect(() => loadServerEnv({})).toThrow(/DATABASE_URL/);
    expect(() => loadServerEnv({ ...required, BETTER_AUTH_SECRET: 'short' })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it('allows listening on all interfaces when HOST is set', () => {
    expect(loadServerEnv({ ...required, HOST: '0.0.0.0' }).HOST).toBe('0.0.0.0');
  });

  it('rejects an invalid port with a clear message', () => {
    expect(() => loadServerEnv({ ...required, PORT: 'not-a-port' })).toThrow(/PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadServerEnv({ ...required, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('needs both GitLab values or neither', () => {
    expect(() => loadServerEnv({ ...required, GITLAB_CLIENT_ID: 'id' })).toThrow(
      /GITLAB_CLIENT_SECRET/,
    );
    const env = loadServerEnv({ ...required, GITLAB_CLIENT_ID: 'id', GITLAB_CLIENT_SECRET: 's' });
    expect(env.GITLAB_CLIENT_ID).toBe('id');
  });

  it.each(['GITHUB', 'GOOGLE'] as const)('needs both %s values or neither', (provider) => {
    expect(() => loadServerEnv({ ...required, [`${provider}_CLIENT_ID`]: 'id' })).toThrow(
      new RegExp(`${provider}_CLIENT_SECRET`),
    );
    expect(() => loadServerEnv({ ...required, [`${provider}_CLIENT_SECRET`]: 's' })).toThrow(
      new RegExp(`${provider}_CLIENT_ID`),
    );
    expect(
      loadServerEnv({
        ...production,
        [`${provider}_CLIENT_ID`]: 'id',
        [`${provider}_CLIENT_SECRET`]: 's',
      }).NODE_ENV,
    ).toBe('production');
  });

  it('normalizes exact beta addresses and rejects wildcard admission', () => {
    expect(
      loadServerEnv({
        ...required,
        BETA_ALLOWED_EMAILS: ' Person@Example.com, other@example.com, ',
      }).BETA_ALLOWED_EMAILS,
    ).toEqual(['person@example.com', 'other@example.com']);
    expect(() => loadServerEnv({ ...required, BETA_ALLOWED_EMAILS: '*@example.com' })).toThrow(
      /BETA_ALLOWED_EMAILS/,
    );
  });

  it('needs a sender for SMTP, and only accepts SMTP addresses', () => {
    expect(() => loadServerEnv({ ...required, SMTP_URL: smtp.SMTP_URL })).toThrow(/MAIL_FROM/);
    expect(loadServerEnv({ ...required, MAIL_FROM: smtp.MAIL_FROM }).SMTP_URL).toBeUndefined();
    expect(() =>
      loadServerEnv({ ...required, ...smtp, SMTP_URL: 'https://mail.example.com' }),
    ).toThrow(/SMTP_URL/);
    expect(loadServerEnv({ ...required, ...smtp }).SMTP_URL).toBe(smtp.SMTP_URL);
  });

  it('refuses production without a way to sign in', () => {
    expect(() => loadServerEnv(production)).toThrow(/way to sign in/);
    expect(loadServerEnv({ ...production, ...smtp }).NODE_ENV).toBe('production');
    expect(
      loadServerEnv({ ...production, GITLAB_CLIENT_ID: 'id', GITLAB_CLIENT_SECRET: 's' }).NODE_ENV,
    ).toBe('production');
  });

  it('needs the folder for uploaded files in production only (spec 20a)', () => {
    expect(loadServerEnv(required).FILES_DIR).toBeUndefined();
    expect(() => loadServerEnv({ ...production, ...smtp, FILES_DIR: undefined })).toThrow(
      /FILES_DIR/,
    );
    expect(loadServerEnv({ ...production, ...smtp }).FILES_DIR).toBe('/data/files');
  });

  it('reads trusted proxies as a list', () => {
    expect(
      loadServerEnv({ ...required, TRUSTED_PROXIES: ' 172.18.0.1 , 10.0.0.0/24,' }).TRUSTED_PROXIES,
    ).toEqual(['172.18.0.1', '10.0.0.0/24']);
  });
});
