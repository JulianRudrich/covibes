import { createPrivateKey, sign } from 'node:crypto';
import type { ReadableStreamDefaultReader } from 'node:stream/web';

import { z } from 'zod';

import { RepositoryError } from '@server/integrations/git-host';

export const GITHUB_API = 'https://api.github.com';
export const GITHUB_WEB = 'https://github.com';
export const GITHUB_API_VERSION = '2026-03-10';
export const MAX_GITHUB_RESPONSE_BYTES = 8 * 1024 * 1024;

export class GithubError extends RepositoryError {
  constructor(status: number, message = 'GitHub could not complete the request') {
    super(status, message);
    this.name = 'GithubError';
  }
}

export type GithubSetup = {
  appId: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  slug: string;
  webhookSecret: string;
  tokenKey: string;
  redirectUri: string;
};

/** Fixed API origin: callers cannot turn repository content into a token-bearing URL. */
export function githubPath(path: string): string {
  if (!/^\/(?:[A-Za-z0-9_@~!$&'()*+,;=.%:-]+\/)*[A-Za-z0-9_@~!$&'()*+,;=.%:/?-]*$/.test(path)) {
    throw new GithubError(400, 'Invalid GitHub API path');
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(path.split('?')[0] ?? '');
  } catch {
    throw new GithubError(400, 'Invalid GitHub API path');
  }
  if (/(?:^|\/)\.{1,2}(?:\/|$)/.test(decoded) || decoded.includes('\\')) {
    throw new GithubError(400, 'Invalid GitHub API path');
  }
  const url = new URL(path, GITHUB_API);
  if (
    url.origin !== GITHUB_API ||
    /(?:^|\/)\.{1,2}(?:\/|$)/.test(decodeURIComponent(url.pathname))
  ) {
    throw new GithubError(400, 'Invalid GitHub API target');
  }
  return url.toString();
}

export function githubRepositoryPath(fullName: string): string {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(fullName)) {
    throw new GithubError(400, 'Invalid GitHub repository');
  }
  const [owner, repository] = fullName.split('/');
  if (repository === '.' || repository === '..') throw new GithubError(400);
  return `/repos/${owner ?? ''}/${repository ?? ''}`;
}

export function githubFilePath(path: string): string {
  if (
    path.length > 1000 ||
    path.includes('\\') ||
    path.startsWith('/') ||
    Array.from(path).some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new GithubError(400, 'Invalid repository file path');
  }
  const parts = path.split('/');
  if (parts.some((part) => part === '.' || part === '..' || part === '')) {
    throw new GithubError(400, 'Invalid repository file path');
  }
  return parts.map(encodeURIComponent).join('/');
}

/** Short-lived, RSA-signed App identity; no external signing dependency or stored JWT. */
export function githubAppJwt(
  setup: Pick<GithubSetup, 'clientId' | 'privateKey'>,
  now = Date.now(),
): string {
  const key = createPrivateKey(setup.privateKey.replace(/\\n/g, '\n'));
  if (key.asymmetricKeyType !== 'rsa') throw new GithubError(500, 'GitHub App requires an RSA key');
  const seconds = Math.floor(now / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: setup.clientId }),
  ).toString('base64url');
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url')}`;
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal('bearer').optional(),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().int().positive().optional(),
});

export type GithubUserTokens = {
  token: string;
  expiresAt: Date | null;
  refreshToken: string | null;
  refreshExpiresAt: Date | null;
};

export function createGithubClient(fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  async function request(url: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // Never include upstream URLs, tokens or arbitrary response text in a surfaced error.
      throw new GithubError(0, 'GitHub is not reachable');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new GithubError(response.status);
    }
    if (response.status === 204) return undefined;
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_GITHUB_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new GithubError(502, 'GitHub response exceeds the reading limit');
    }
    const reader = response.body?.getReader() as
      ReadableStreamDefaultReader<Uint8Array> | undefined;
    if (!reader) throw new GithubError(502, 'GitHub sent no response');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > MAX_GITHUB_RESPONSE_BYTES) {
          await reader.cancel();
          throw new GithubError(502, 'GitHub response exceeds the reading limit');
        }
        chunks.push(next.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch (error) {
      if (error instanceof GithubError) throw error;
      throw new GithubError(502, 'GitHub sent an invalid response');
    } finally {
      reader.releaseLock();
    }
  }

  function api(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    path: string,
    token: string,
    body?: unknown,
  ) {
    return request(githubPath(path), {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': GITHUB_API_VERSION,
        'user-agent': 'Covibes',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function oauth(
    setup: GithubSetup,
    grant: Record<string, string>,
  ): Promise<GithubUserTokens> {
    const answer = tokenSchema.safeParse(
      await request(`${GITHUB_WEB}/login/oauth/access_token`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: setup.clientId,
          client_secret: setup.clientSecret,
          ...grant,
        }),
      }),
    );
    if (!answer.success) throw new GithubError(401, 'GitHub did not authorize this integration');
    const value = answer.data;
    return {
      token: value.access_token,
      expiresAt: value.expires_in ? new Date(now() + value.expires_in * 1000) : null,
      refreshToken: value.refresh_token ?? null,
      refreshExpiresAt: value.refresh_token_expires_in
        ? new Date(now() + value.refresh_token_expires_in * 1000)
        : null,
    };
  }

  return {
    api,
    oauth,
    async find(path: string, token: string): Promise<unknown> {
      try {
        return await api('GET', path, token);
      } catch (error) {
        if (error instanceof GithubError && error.status === 404) return undefined;
        throw error;
      }
    },
    async installationToken(
      setup: GithubSetup,
      installationId: number,
      repositoryId: number,
    ): Promise<string> {
      if (![installationId, repositoryId].every((id) => Number.isSafeInteger(id) && id > 0))
        throw new GithubError(400);
      const answer = z
        .object({
          token: z.string().min(1),
          expires_at: z.iso.datetime(),
          permissions: z.object({
            contents: z.literal('write'),
            issues: z.literal('write'),
            pull_requests: z.literal('write'),
          }),
        })
        .safeParse(
          await api(
            'POST',
            `/app/installations/${String(installationId)}/access_tokens`,
            githubAppJwt(setup, now()),
            {
              repository_ids: [repositoryId],
              permissions: {
                contents: 'write',
                issues: 'write',
                pull_requests: 'write',
                metadata: 'read',
              },
            },
          ),
        );
      if (!answer.success || new Date(answer.data.expires_at).getTime() <= now() + 60_000)
        throw new GithubError(502, 'GitHub sent no usable installation access');
      return answer.data.token;
    },
  };
}

export type GithubClient = ReturnType<typeof createGithubClient>;
