import type { DevMail, PublicConfig } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { createTestServer } from '@server/testing';

const test = createTestServer();
const development = createTestServer({ NODE_ENV: 'development' });
const INTERNAL_TOKEN = 'internal-token-for-the-tests-0123456789';
const withWorker = createTestServer({ NODE_ENV: 'development', INTERNAL_TOKEN });
const MAIL = { to: 'alex@example.com', subject: 'Neues für dich', text: 'Hallo Alex' };

describe('GET /health', () => {
  it('reports the server as healthy', async () => {
    const response = await test.app.request('/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /api/config', () => {
  it('tells the web app that GitLab is not set up', async () => {
    const response = await test.app.request('/api/config');
    expect(await response.json()).toEqual<PublicConfig>({
      gitlabLogin: false,
      emailLogin: true,
      devMailbox: false,
      socialLogins: [],
      emailCodeLogin: true,
      passkeyLogin: true,
      closedBeta: false,
    });
  });

  it('reports GitLab once both values are set', async () => {
    const withGitlab = createTestServer({ GITLAB_CLIENT_ID: 'id', GITLAB_CLIENT_SECRET: 'secret' });
    const response = await withGitlab.app.request('/api/config');
    expect(((await response.json()) as PublicConfig).gitlabLogin).toBe(true);
  });
});

describe('development mailbox', () => {
  it('shows the login mail in development', async () => {
    await development.signIn('dev@example.com');
    const response = await development.app.request('/api/dev/mails');
    expect(response.status).toBe(200);
    const [mail] = (await response.json()) as DevMail[];
    expect(mail).toMatchObject({ to: 'dev@example.com', subject: 'Dein Login-Link für Covibes' });
    expect(mail?.text).toContain('/api/auth/magic-link/verify?token=');
  });

  it('does not exist outside development', async () => {
    const response = await test.app.request('/api/dev/mails');
    expect(response.status).toBe(404);
    const posted = await test.app.request('/api/dev/mails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': INTERNAL_TOKEN },
      body: JSON.stringify(MAIL),
    });
    expect(posted.status).toBe(404);
  });

  it('takes the mails of the worker, and of nobody else (spec 22b)', async () => {
    const post = (token: string | undefined, body: unknown = MAIL) =>
      withWorker.app.request('/api/dev/mails', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token === undefined ? {} : { 'x-internal-token': token }),
        },
        body: JSON.stringify(body),
      });

    expect((await post(undefined)).status).toBe(403);
    expect((await post('wrong-token-that-is-long-enough-0123456789')).status).toBe(403);
    expect((await post(INTERNAL_TOKEN, { to: 'x' })).status).toBe(400);
    expect((await post(INTERNAL_TOKEN)).status).toBe(204);

    const mails = (await (await withWorker.app.request('/api/dev/mails')).json()) as DevMail[];
    expect(mails).toMatchObject([MAIL]);
    // A server without the shared secret takes no mail from anyone.
    const open = await development.app.request('/api/dev/mails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': '' },
      body: JSON.stringify(MAIL),
    });
    expect(open.status).toBe(403);
  });
});

describe('unknown API routes', () => {
  it('answer with the error format', async () => {
    const response = await test.app.request('/api/nothing-here');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
  });
});
