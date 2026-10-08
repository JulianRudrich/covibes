import type { ProjectSummary } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { createGitlabClient } from '@server/integrations/gitlab/client';
import { createGitConnections } from '@server/integrations/gitlab/connections';
import { openToken } from '@server/integrations/gitlab/crypto';
import { createGitlabStandIn } from '@server/integrations/gitlab/dev/stand-in';
import { DEV_GITLAB_CLIENT, type GitlabSetup } from '@server/integrations/gitlab/setup';
import { APP_URL, createTestServer } from '@server/testing';

// The store of GitLab connections (spec 28a) against a stand-in of its own, with a clock the
// test moves: sealing, renewing, ending.
const test = createTestServer();

const SETUP: GitlabSetup = {
  tokenKey: 'a-token-key-with-at-least-32-characters',
  standIn: true,
  source: {
    baseUrl: 'http://gitlab.test',
    clientId: DEV_GITLAB_CLIENT.id,
    clientSecret: DEV_GITLAB_CLIENT.secret,
    redirectUri: 'http://localhost:5173/api/git/callback',
  },
};
const HOUR = 60 * 60_000;

function setUp() {
  const clock = { now: Date.parse('2026-10-04T10:00:00Z') };
  const now = () => clock.now;
  const standIn = createGitlabStandIn(SETUP.source, now);
  const calls: string[] = [];
  /** GitLab is away: every call fails like a refused connection. */
  const state = { away: false };
  const fetcher: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
    if (state.away) throw new Error('ECONNREFUSED');
    // A real call takes a moment; two renewals at once would both be on their way.
    await new Promise((resolve) => setTimeout(resolve, 20));
    return standIn.routes.request(url, init);
  };
  const client = createGitlabClient(fetcher, now);
  const connections = createGitConnections({ admin: test.db.admin, client, setup: SETUP, now });

  /** An owner comes back from GitLab: the tokens of a consent, stored for a new project. */
  async function connected() {
    const cookie = await test.signIn();
    const created = await test.app.request('/api/projects', {
      method: 'POST',
      headers: { cookie, origin: APP_URL, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Vereins-App' }),
    });
    const projectId = ((await created.json()) as ProjectSummary).id;
    const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
    const userId = session?.user.id ?? '';

    const page = await fetcher(client.authorizeUrl(SETUP.source, 'state'));
    const allow = /class="allow" href="([^"]+)"/.exec(await page.text())?.[1] ?? '';
    const code = new URL(allow.replaceAll('&amp;', '&')).searchParams.get('code') ?? '';
    const tokens = await client.exchangeCode(SETUP.source, code);
    await connections.connect(
      projectId,
      userId,
      await client.account(SETUP.source.baseUrl, tokens.accessToken),
      tokens,
    );
    calls.length = 0;
    return { projectId, userId, tokens };
  }

  const stored = (projectId: string) =>
    test.db.admin
      .selectFrom('oauth_tokens')
      .selectAll()
      .where('project_id', '=', projectId)
      .executeTakeFirst();

  const connection = (projectId: string) =>
    test.db.admin
      .selectFrom('git_connections')
      .selectAll()
      .where('project_id', '=', projectId)
      .executeTakeFirst();

  return { clock, standIn, calls, state, client, connections, connected, stored, connection };
}

describe('connecting', () => {
  it('stores the account and the tokens, sealed', async () => {
    const { connected, stored, connection } = setUp();

    const { projectId, userId, tokens } = await connected();

    expect(await connection(projectId)).toMatchObject({
      base_url: 'http://gitlab.test',
      connected_by: userId,
      account_id: '1',
      account_username: 'olga.beispiel',
      account_name: 'Olga Beispiel',
      repository_id: null,
    });
    const row = await stored(projectId);
    expect(row?.access_token).toMatch(/^v1\./);
    expect(row?.access_token).not.toContain(tokens.accessToken);
    expect(row?.refresh_token).not.toContain(tokens.refreshToken ?? 'none');
    expect(openToken(SETUP.tokenKey, row?.access_token ?? '')).toBe(tokens.accessToken);
    expect(row?.expires_at?.toISOString()).toBe('2026-10-04T12:00:00.000Z');
    expect(row?.scope).toBe('api');
  });

  it('takes the place of an earlier connection of the project', async () => {
    const { connections, connected, connection, client } = setUp();
    const { projectId, userId, tokens } = await connected();
    await connections.setRepository(projectId, {
      id: 101,
      path: 'beispiel-verein/vereins-app',
      name: 'Vereins-App',
      url: 'http://gitlab.test/beispiel-verein/vereins-app',
      defaultBranch: 'main',
    });

    await connections.connect(
      projectId,
      userId,
      await client.account(SETUP.source.baseUrl, tokens.accessToken),
      tokens,
    );

    // The repository is picked anew with the new access.
    expect(await connection(projectId)).toMatchObject({ repository_id: null });
  });
});

describe('access', () => {
  it('gives the token as long as it holds, without asking GitLab', async () => {
    const { clock, calls, connections, connected } = setUp();
    const { projectId, tokens } = await connected();

    clock.now += 2 * HOUR - 61_000;
    const access = await connections.access(projectId);

    expect(access).toEqual({ baseUrl: 'http://gitlab.test', token: tokens.accessToken });
    expect(calls).toEqual([]);
  });

  it('renews a token that is about to end, and stores the new ones', async () => {
    const { clock, calls, client, connections, connected, stored } = setUp();
    const { projectId, tokens } = await connected();
    const before = await stored(projectId);

    clock.now += 2 * HOUR - 30_000;
    const access = await connections.access(projectId);

    expect(calls).toEqual(['POST /oauth/token']);
    expect(access?.token).not.toBe(tokens.accessToken);
    // The new token works, and the stored ones are the new ones.
    expect((await client.account('http://gitlab.test', access?.token ?? '')).username).toBe(
      'olga.beispiel',
    );
    const after = await stored(projectId);
    expect(openToken(SETUP.tokenKey, after?.access_token ?? '')).toBe(access?.token);
    expect(after?.refresh_token).not.toBe(before?.refresh_token);
    expect(after?.expires_at?.getTime()).toBe(clock.now + 2 * HOUR);
  });

  it('renews once when two calls need the token at the same time', async () => {
    const { clock, calls, connections, connected } = setUp();
    const { projectId } = await connected();
    clock.now += 3 * HOUR;

    const [first, second] = await Promise.all([
      connections.access(projectId),
      connections.access(projectId),
    ]);

    expect(calls).toEqual(['POST /oauth/token']);
    expect(first?.token).toBeTruthy();
    expect(second?.token).toBe(first?.token);
  });

  it('ends a connection GitLab no longer accepts', async () => {
    const { clock, standIn, connections, connected, connection, stored } = setUp();
    const { projectId } = await connected();
    // The person revoked the application in GitLab.
    standIn.forgetTokens();
    clock.now += 3 * HOUR;

    expect(await connections.access(projectId)).toBeUndefined();

    expect(await connection(projectId)).toBeUndefined();
    expect(await stored(projectId)).toBeUndefined();
  });

  it('keeps the connection while GitLab is away', async () => {
    const { clock, state, connections, connected, connection } = setUp();
    const { projectId } = await connected();
    clock.now += 3 * HOUR;
    state.away = true;

    await expect(connections.access(projectId)).rejects.toMatchObject({ status: 0 });
    expect(await connection(projectId)).toBeDefined();

    // Back again, the next call renews.
    state.away = false;
    expect((await connections.access(projectId))?.token).toBeTruthy();
  });

  it('is nothing for a project without a connection', async () => {
    const { connections } = setUp();

    expect(await connections.access('00000000-0000-4000-8000-000000000000')).toBeUndefined();
  });
});

describe('the repository', () => {
  it('is written into the connection', async () => {
    const { connections, connected, connection } = setUp();
    const { projectId } = await connected();

    const done = await connections.setRepository(projectId, {
      id: 103,
      path: 'olga.beispiel/notizen',
      name: 'Notizen',
      url: 'http://gitlab.test/olga.beispiel/notizen',
      defaultBranch: null,
    });

    expect(done).toBe(true);
    expect(await connection(projectId)).toMatchObject({
      repository_id: '103',
      repository_path: 'olga.beispiel/notizen',
      repository_name: 'Notizen',
      repository_url: 'http://gitlab.test/olga.beispiel/notizen',
      repository_default_branch: null,
    });
    expect(
      await connections.setRepository('00000000-0000-4000-8000-000000000000', {
        id: 1,
        path: 'a/b',
        name: 'B',
        url: 'http://gitlab.test/a/b',
        defaultBranch: 'main',
      }),
    ).toBe(false);
  });
});

describe('disconnecting', () => {
  it('tells GitLab that the token is no longer used, and removes connection and tokens', async () => {
    const { standIn, calls, connections, connected, connection, stored } = setUp();
    const { projectId } = await connected();
    expect(standIn.accessTokenCount).toBe(1);

    expect(await connections.disconnect(projectId)).toBe(true);

    expect(calls).toEqual(['POST /oauth/revoke']);
    expect(standIn.accessTokenCount).toBe(0);
    expect(await connection(projectId)).toBeUndefined();
    expect(await stored(projectId)).toBeUndefined();
    // A second time there is nothing to end.
    expect(await connections.disconnect(projectId)).toBe(false);
  });

  it('removes the connection also while GitLab is away', async () => {
    const { state, connections, connected, connection } = setUp();
    const { projectId } = await connected();
    state.away = true;

    expect(await connections.disconnect(projectId)).toBe(true);
    expect(await connection(projectId)).toBeUndefined();
  });
});
