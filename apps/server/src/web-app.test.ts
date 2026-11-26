import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PublicConfig } from '@covibes/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { authOptions } from '@server/auth/auth';
import { createTestServer } from '@server/testing';

// Production with GitLab OAuth, no mail transport and the built web app on disk.
const webDir = mkdtempSync(join(tmpdir(), 'covibes-web-'));
mkdirSync(join(webDir, 'assets'));
writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Covibes</title>');
writeFileSync(join(webDir, 'assets', 'index-abc123.js'), 'console.log(1);');
writeFileSync(join(webDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
afterAll(() => {
  rmSync(webDir, { recursive: true, force: true });
});

const { app, env } = createTestServer({
  NODE_ENV: 'production',
  APP_URL: 'https://covibes.example.org',
  GITLAB_CLIENT_ID: 'id',
  GITLAB_CLIENT_SECRET: 'secret',
  WEB_DIST_DIR: webDir,
  FILES_DIR: join(webDir, 'files'),
});

describe('web app in production', () => {
  it('serves the app for the start page and every page of the app', async () => {
    for (const path of ['/', '/login', '/p/0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de']) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('<title>Covibes</title>');
      expect(response.headers.get('cache-control')).toBe('no-cache');
    }
  });

  it('serves files as they are, hashed assets with a long cache', async () => {
    const asset = await app.request('/assets/index-abc123.js');
    expect(await asset.text()).toBe('console.log(1);');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await app.request('/favicon.svg')).headers.get('content-type')).toContain('svg');
  });

  it('keeps unknown API routes as JSON errors', async () => {
    const response = await app.request('/api/nothing-here');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
  });

  it('does not serve files outside the web app', async () => {
    const response = await app.request('/assets/../../package.json');
    expect(await response.text()).not.toContain('"name"');
  });
});

describe('security in production', () => {
  it('sets the security headers on pages and API responses', async () => {
    for (const path of ['/', '/api/config']) {
      const headers = (await app.request(path)).headers;
      const csp = headers.get('content-security-policy') ?? '';
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain('wss://covibes.example.org');
      expect(headers.get('strict-transport-security')).toContain('max-age=31536000');
      expect(headers.get('x-content-type-options')).toBe('nosniff');
      expect(headers.get('x-frame-options')).toBe('DENY');
      expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    }
  });

  it('uses secure cookies', () => {
    const options = authOptions({ env, adminPool: undefined as never, mailer: undefined });
    expect(options.advanced.useSecureCookies).toBe(true);
  });

  it('offers only the configured ways to sign in', async () => {
    const config = (await (await app.request('/api/config')).json()) as PublicConfig;
    expect(config).toEqual({
      gitlabLogin: true,
      emailLogin: false,
      devMailbox: false,
      socialLogins: ['gitlab'],
      emailCodeLogin: false,
      passkeyLogin: true,
      closedBeta: true,
    });
    const magicLink = await app.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: env.APP_URL },
      body: JSON.stringify({ email: 'olga@example.com' }),
    });
    expect(magicLink.status).toBe(404);
  });
});
