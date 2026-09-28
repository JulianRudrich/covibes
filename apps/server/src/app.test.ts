import type { DevMail, PublicConfig } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { createTestServer } from '@server/testing';

const test = createTestServer();
const development = createTestServer({ NODE_ENV: 'development' });

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
  });
});

describe('unknown API routes', () => {
  it('answer with the error format', async () => {
    const response = await test.app.request('/api/nothing-here');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
  });
});
