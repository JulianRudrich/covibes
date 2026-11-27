import { generateKeyPairSync, verify } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  createGithubClient,
  githubAppJwt,
  githubFilePath,
  githubPath,
  githubRepositoryPath,
  MAX_GITHUB_RESPONSE_BYTES,
  type GithubSetup,
} from '@server/integrations/github/client';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const now = Date.parse('2026-11-18T10:00:00Z');
const setup: GithubSetup = {
  appId: '123',
  clientId: 'Iv1.example',
  clientSecret: 'test-client-secret',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  slug: 'covibes-test',
  webhookSecret: 'test-webhook-secret-with-at-least-32-characters',
  tokenKey: 'test-token-key-with-at-least-32-characters',
  redirectUri: 'https://covibes.example/api/github/callback',
};

describe('GitHub App identity and target boundaries', () => {
  it('signs an RS256 App JWT with a bounded lifetime and clock skew', () => {
    const jwt = githubAppJwt(setup, now);
    const [header = '', payload = '', signature = ''] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({
      iss: setup.clientId,
      iat: now / 1000 - 60,
      exp: now / 1000 + 540,
    });
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    expect(() =>
      githubAppJwt(
        { ...setup, privateKey: ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
        now,
      ),
    ).toThrow('RSA key');
  });

  it('rejects external URLs, traversal, malformed escapes and unsafe file paths before fetching', () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createGithubClient(fetcher);
    for (const path of [
      'https://evil.example/x',
      '//evil.example/x',
      '/repos/a/../b',
      '/repos/a/%2e%2e/b',
      '/repos/a/%5cb',
      '/repos/%broken',
    ]) {
      expect(() => client.api('GET', path, 'never-send-this')).toThrow();
    }
    for (const path of ['../private', '/absolute', 'a//b', 'a\\b', 'a/./b', 'a\u0000b'])
      expect(() => githubFilePath(path)).toThrow();
    for (const repo of ['a/b/c', 'a/..', 'https://github.com/a/b', 'a@evil/b'])
      expect(() => githubRepositoryPath(repo)).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(githubPath('/repos/owner/repo/contents/file?ref=a%2Fb')).toBe(
      'https://api.github.com/repos/owner/repo/contents/file?ref=a%2Fb',
    );
    expect(githubFilePath('docs/hello world.md')).toBe('docs/hello%20world.md');
  });

  it('requests a token scoped to one immutable repository and required permissions', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        token: 'ephemeral-installation-token',
        expires_at: '2026-11-18T11:00:00Z',
        permissions: { contents: 'write', issues: 'write', pull_requests: 'write' },
      }),
    );
    const client = createGithubClient(fetcher, () => now);
    expect(await client.installationToken(setup, 45, 987)).toBe('ephemeral-installation-token');
    const call = fetcher.mock.calls[0];
    expect(call?.[0]).toBe('https://api.github.com/app/installations/45/access_tokens');
    expect(JSON.parse(typeof call?.[1]?.body === 'string' ? call[1].body : '')).toEqual({
      repository_ids: [987],
      permissions: { contents: 'write', issues: 'write', pull_requests: 'write', metadata: 'read' },
    });
    expect(call?.[1]?.redirect).toBe('error');
    expect(new Headers(call?.[1]?.headers).get('authorization')).toMatch(/^Bearer ey/);
    fetcher.mockResolvedValue(
      Response.json({
        token: 'underprivileged',
        expires_at: '2026-11-18T11:00:00Z',
        permissions: { contents: 'read', issues: 'write', pull_requests: 'write' },
      }),
    );
    await expect(client.installationToken(setup, 45, 987)).rejects.toMatchObject({ status: 502 });
  });
});

describe('GitHub transport failures', () => {
  it('keeps upstream response bodies and tokens out of errors', async () => {
    const client = createGithubClient(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('private repository contents and secret', { status: 403 })),
    );
    await expect(client.api('GET', '/user', 'secret')).rejects.toMatchObject({
      status: 403,
      message: 'GitHub could not complete the request',
    });
    const redirect = createGithubClient(
      vi.fn<typeof fetch>().mockRejectedValue(new Error('redirect to https://evil.example/secret')),
    );
    await expect(redirect.api('GET', '/user', 'secret')).rejects.toMatchObject({
      status: 0,
      message: 'GitHub is not reachable',
    });
  });

  it('bounds declared and streamed JSON even without a content length', async () => {
    const declared = createGithubClient(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('{}', {
          headers: { 'content-length': String(MAX_GITHUB_RESPONSE_BYTES + 1) },
        }),
      ),
    );
    await expect(declared.api('GET', '/user', 'token')).rejects.toMatchObject({ status: 502 });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_GITHUB_RESPONSE_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const streamed = createGithubClient(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
    );
    await expect(streamed.api('GET', '/user', 'token')).rejects.toMatchObject({ status: 502 });
    const malformed = createGithubClient(
      vi.fn<typeof fetch>().mockResolvedValue(new Response('not json')),
    );
    await expect(malformed.api('GET', '/user', 'token')).rejects.toMatchObject({ status: 502 });
  });
});
