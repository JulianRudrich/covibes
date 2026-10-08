import { describe, expect, it, vi } from 'vitest';

import {
  createGitlabClient,
  GitlabError,
  type GitlabSource,
} from '@server/integrations/gitlab/client';
import { createGitlabStandIn, DEV_ACCOUNT } from '@server/integrations/gitlab/dev/stand-in';
import { DEV_GITLAB_CLIENT, gitlabSetup } from '@server/integrations/gitlab/setup';

// The client against the development stand-in, without a network: what it sends has the form
// GitLab expects, and what comes back is checked.
const SOURCE: GitlabSource = {
  baseUrl: 'http://localhost:5173/api/dev/gitlab',
  clientId: DEV_GITLAB_CLIENT.id,
  clientSecret: DEV_GITLAB_CLIENT.secret,
  redirectUri: 'http://localhost:5173/api/git/callback',
};

function setUp(now: () => number = Date.now) {
  const standIn = createGitlabStandIn(SOURCE, now);
  const calls: string[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
    return Promise.resolve(
      standIn.routes.request(url.replace(SOURCE.baseUrl, 'http://stand-in'), init),
    );
  };
  return { standIn, calls, client: createGitlabClient(fetcher, now), fetcher };
}

/** Walks the consent page like a person who allows the access; the code GitLab hands back. */
async function consent(client: ReturnType<typeof setUp>['client'], fetcher: typeof fetch) {
  const page = await fetcher(client.authorizeUrl(SOURCE, 'state-1'));
  const html = await page.text();
  const allow = /class="allow" href="([^"]+)"/.exec(html)?.[1]?.replaceAll('&amp;', '&') ?? '';
  return { html, back: new URL(allow) };
}

describe('the OAuth flow', () => {
  it('sends the person to the consent page with client, scope, state and the way back', () => {
    const url = new URL(setUp().client.authorizeUrl(SOURCE, 'state-1'));

    expect(`${url.origin}${url.pathname}`).toBe(`${SOURCE.baseUrl}/oauth/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'covibes-dev',
      redirect_uri: SOURCE.redirectUri,
      response_type: 'code',
      scope: 'api',
      state: 'state-1',
    });
  });

  it('trades the code for tokens, once', async () => {
    const now = Date.parse('2026-10-04T10:00:00Z');
    const { client, fetcher } = setUp(() => now);
    const { back } = await consent(client, fetcher);
    expect(`${back.origin}${back.pathname}`).toBe(SOURCE.redirectUri);
    expect(back.searchParams.get('state')).toBe('state-1');
    const code = back.searchParams.get('code') ?? '';

    const tokens = await client.exchangeCode(SOURCE, code);

    expect(tokens.accessToken).toMatch(/^access\.[\w.-]{20,}$/);
    expect(tokens.refreshToken).toMatch(/^refresh\.[\w.-]{20,}$/);
    expect(tokens.expiresAt?.toISOString()).toBe('2026-10-04T12:00:00.000Z');
    expect(tokens.scope).toBe('api');
    await expect(client.exchangeCode(SOURCE, code)).rejects.toMatchObject({
      name: 'GitlabError',
      status: 400,
    });
  });

  it('renews with a refresh token, which GitLab retires with its use', async () => {
    const { client, fetcher } = setUp();
    const { back } = await consent(client, fetcher);
    const first = await client.exchangeCode(SOURCE, back.searchParams.get('code') ?? '');

    const second = await client.refresh(SOURCE, first.refreshToken ?? '');

    expect(second.accessToken).not.toBe(first.accessToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(client.refresh(SOURCE, first.refreshToken ?? '')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('is refused for an application GitLab does not know', async () => {
    const { client, fetcher } = setUp();
    const { back } = await consent(client, fetcher);

    await expect(
      client.exchangeCode(
        { ...SOURCE, clientSecret: 'wrong' },
        back.searchParams.get('code') ?? '',
      ),
    ).rejects.toMatchObject({ status: 401 });
    // The consent page goes back only to the address the application registered.
    const elsewhere = await fetcher(
      client.authorizeUrl({ ...SOURCE, redirectUri: 'https://evil.example/cb' }, 's'),
    );
    expect(elsewhere.status).toBe(400);
  });

  it('tells GitLab that a token is no longer used', async () => {
    const { client, fetcher, standIn } = setUp();
    const { back } = await consent(client, fetcher);
    const tokens = await client.exchangeCode(SOURCE, back.searchParams.get('code') ?? '');
    expect(standIn.accessTokenCount).toBe(1);

    await client.revoke(SOURCE, tokens.accessToken);

    expect(standIn.accessTokenCount).toBe(0);
    await expect(client.account(SOURCE.baseUrl, tokens.accessToken)).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('the API', () => {
  async function signedIn() {
    const setup = setUp();
    const { back } = await consent(setup.client, setup.fetcher);
    const tokens = await setup.client.exchangeCode(SOURCE, back.searchParams.get('code') ?? '');
    return { ...setup, token: tokens.accessToken };
  }

  it('says whose account a token belongs to', async () => {
    const { client, token } = await signedIn();

    expect(await client.account(SOURCE.baseUrl, token)).toEqual(DEV_ACCOUNT);
  });

  it('lists the repositories of the account, narrowed by a search', async () => {
    const { client, token } = await signedIn();

    const all = await client.repositories(SOURCE.baseUrl, token, '');
    const found = await client.repositories(SOURCE.baseUrl, token, 'verein');

    expect(all.map((repository) => repository.path)).toEqual([
      'beispiel-verein/vereins-app',
      'beispiel-verein/website',
      'olga.beispiel/notizen',
    ]);
    expect(all[0]).toEqual({
      id: 101,
      path: 'beispiel-verein/vereins-app',
      name: 'Vereins-App',
      url: `${SOURCE.baseUrl}/beispiel-verein/vereins-app`,
      defaultBranch: 'main',
    });
    expect(found.map((repository) => repository.id)).toEqual([101, 102]);
  });

  it('gives one repository by its id, and none the account cannot reach', async () => {
    const { client, token } = await signedIn();

    expect((await client.repository(SOURCE.baseUrl, token, 103))?.path).toBe(
      'olga.beispiel/notizen',
    );
    expect(await client.repository(SOURCE.baseUrl, token, 999)).toBeUndefined();
  });

  it('refuses a token that ended', async () => {
    const { client, token, standIn } = await signedIn();
    standIn.expireAccessTokens();

    await expect(client.repositories(SOURCE.baseUrl, token, '')).rejects.toBeInstanceOf(
      GitlabError,
    );
    await expect(client.repository(SOURCE.baseUrl, token, 101)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('leaves out an entry it cannot read, and reports a GitLab that is away', async () => {
    const answer = [
      { id: 5, name: 'Gut', path_with_namespace: 'a/gut', web_url: 'https://gitlab.com/a/gut' },
      { id: 'x', name: 'Kaputt' },
    ];
    const odd = createGitlabClient(() => Promise.resolve(Response.json(answer)));
    const away = createGitlabClient(vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));
    const html = createGitlabClient(() => Promise.resolve(new Response('<html>')));

    expect(await odd.repositories('https://gitlab.com', 'token', '')).toEqual([
      { id: 5, path: 'a/gut', name: 'Gut', url: 'https://gitlab.com/a/gut', defaultBranch: null },
    ]);
    await expect(away.account('https://gitlab.com', 'token')).rejects.toMatchObject({ status: 0 });
    await expect(html.account('https://gitlab.com', 'token')).rejects.toMatchObject({
      status: 502,
    });
  });
});

describe('gitlabSetup', () => {
  const base = { APP_URL: 'http://localhost:5173/', TOKEN_KEY: 'k'.repeat(32) };

  it('is the stand-in of this server in development and tests without an application', () => {
    expect(gitlabSetup({ ...base, NODE_ENV: 'development' })).toEqual({
      tokenKey: base.TOKEN_KEY,
      standIn: true,
      source: {
        baseUrl: 'http://localhost:5173/api/dev/gitlab',
        clientId: 'covibes-dev',
        clientSecret: 'covibes-dev-secret',
        redirectUri: 'http://localhost:5173/api/git/callback',
      },
    });
    expect(gitlabSetup({ ...base, NODE_ENV: 'test' })?.standIn).toBe(true);
  });

  it('is the GitLab an application is configured for, gitlab.com unless told otherwise', () => {
    const application = { GITLAB_CLIENT_ID: 'id', GITLAB_CLIENT_SECRET: 'secret' };

    expect(gitlabSetup({ ...base, ...application, NODE_ENV: 'production' })).toEqual({
      tokenKey: base.TOKEN_KEY,
      standIn: false,
      source: {
        baseUrl: 'https://gitlab.com',
        clientId: 'id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost:5173/api/git/callback',
      },
    });
    expect(
      gitlabSetup({
        ...base,
        ...application,
        NODE_ENV: 'development',
        GITLAB_ISSUER: 'https://git.example.org/',
      })?.source.baseUrl,
    ).toBe('https://git.example.org');
  });

  it('is nothing without a key for the tokens, or in production without an application', () => {
    expect(gitlabSetup({ APP_URL: base.APP_URL, NODE_ENV: 'development' })).toBeUndefined();
    expect(gitlabSetup({ ...base, NODE_ENV: 'production' })).toBeUndefined();
  });
});

describe('the stand-in', () => {
  it('keeps its tokens over a restart of the server', async () => {
    const before = setUp();
    const { back } = await consent(before.client, before.fetcher);
    const tokens = await before.client.exchangeCode(SOURCE, back.searchParams.get('code') ?? '');

    // A new process: nothing of the first one is in memory.
    const after = setUp();

    expect((await after.client.account(SOURCE.baseUrl, tokens.accessToken)).username).toBe(
      'olga.beispiel',
    );
    const renewed = await after.client.refresh(SOURCE, tokens.refreshToken ?? '');
    expect(renewed.accessToken).not.toBe(tokens.accessToken);
  });

  it('takes no token it did not sign, and none of another kind', async () => {
    const { client, fetcher } = setUp();
    const { back } = await consent(client, fetcher);
    const code = back.searchParams.get('code') ?? '';
    const tokens = await client.exchangeCode(SOURCE, code);
    const forged = tokens.accessToken.replace(/\.[^.]+$/, '.forged');

    await expect(client.account(SOURCE.baseUrl, forged)).rejects.toMatchObject({ status: 401 });
    // A refresh token is no access token, and an access token renews nothing.
    await expect(client.account(SOURCE.baseUrl, tokens.refreshToken ?? '')).rejects.toMatchObject({
      status: 401,
    });
    await expect(client.refresh(SOURCE, tokens.accessToken)).rejects.toMatchObject({ status: 400 });
  });

  it('lets an access token run out after two hours and a code after ten minutes', async () => {
    const clock = { now: Date.parse('2026-10-04T10:00:00Z') };
    const { client, fetcher } = setUp(() => clock.now);
    const first = await consent(client, fetcher);
    const tokens = await client.exchangeCode(SOURCE, first.back.searchParams.get('code') ?? '');
    const second = await consent(client, fetcher);

    clock.now += 10 * 60_000;
    await expect(
      client.exchangeCode(SOURCE, second.back.searchParams.get('code') ?? ''),
    ).rejects.toMatchObject({ status: 400 });
    clock.now += 2 * 60 * 60_000;
    await expect(client.account(SOURCE.baseUrl, tokens.accessToken)).rejects.toMatchObject({
      status: 401,
    });
    // The refresh token still renews.
    expect((await client.refresh(SOURCE, tokens.refreshToken ?? '')).accessToken).toBeTruthy();
  });

  it('shows a page for the link of an example repository', async () => {
    const { fetcher } = setUp();

    const found = await fetcher(`${SOURCE.baseUrl}/beispiel-verein/vereins-app`);
    const missing = await fetcher(`${SOURCE.baseUrl}/niemand/nichts`);

    expect(found.status).toBe(200);
    expect(await found.text()).toContain(
      'Das Beispiel-Repository <strong>beispiel-verein/vereins-app',
    );
    expect(missing.status).toBe(404);
  });
});
