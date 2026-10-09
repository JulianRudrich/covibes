import type { GitRepository, ProjectSummary } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { createGitlabClient } from '@server/integrations/gitlab/client';
import { createGitConnections } from '@server/integrations/gitlab/connections';
import { openToken } from '@server/integrations/gitlab/crypto';
import { createGitlabStandIn } from '@server/integrations/gitlab/dev/stand-in';
import { DEV_GITLAB_CLIENT, type GitlabSetup } from '@server/integrations/gitlab/setup';
import { APP_URL, createTestServer } from '@server/testing';

// The store of GitLab accounts and of the repositories of projects (specs 28a and 29a) against a
// stand-in of its own, with a clock the test moves: sealing, renewing, ending.
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

const REPOSITORY: GitRepository = {
  id: 101,
  path: 'beispiel-verein/vereins-app',
  name: 'Vereins-App',
  url: 'http://gitlab.test/beispiel-verein/vereins-app',
  defaultBranch: 'main',
};

function setUp() {
  const clock = { now: Date.parse('2026-10-09T10:00:00Z') };
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

  /** The tokens of a consent, as a person brings them back from GitLab. */
  async function consent() {
    const page = await fetcher(client.authorizeUrl(SETUP.source, 'state'));
    const allow = /class="allow" href="([^"]+)"/.exec(await page.text())?.[1] ?? '';
    const code = new URL(allow.replaceAll('&amp;', '&')).searchParams.get('code') ?? '';
    const tokens = await client.exchangeCode(SETUP.source, code);
    return { tokens, account: await client.account(SETUP.source.baseUrl, tokens.accessToken) };
  }

  /** A person with a project of their own; `withAccount` connects their GitLab account. */
  async function person(withAccount = true) {
    const cookie = await test.signIn();
    const created = await test.app.request('/api/projects', {
      method: 'POST',
      headers: { cookie, origin: APP_URL, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Vereins-App' }),
    });
    const projectId = ((await created.json()) as ProjectSummary).id;
    const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
    const userId = session?.user.id ?? '';
    const granted = withAccount ? await consent() : undefined;
    if (granted) await connections.connectAccount(userId, granted.account, granted.tokens);
    calls.length = 0;
    return { userId, projectId, tokens: granted?.tokens };
  }

  const stored = (userId: string) =>
    test.db.admin
      .selectFrom('git_accounts')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirst();

  const connection = (projectId: string) =>
    test.db.admin
      .selectFrom('git_connections')
      .selectAll()
      .where('project_id', '=', projectId)
      .executeTakeFirst();

  return { clock, standIn, calls, state, client, connections, consent, person, stored, connection };
}

describe('the account of a person', () => {
  it('is stored with its tokens sealed', async () => {
    const { connections, person, stored } = setUp();

    const { userId, tokens } = await person();

    const row = await stored(userId);
    expect(row).toMatchObject({
      base_url: 'http://gitlab.test',
      account_id: '1',
      account_username: 'olga.beispiel',
      account_name: 'Olga Beispiel',
      scope: 'api',
    });
    expect(row?.access_token).toMatch(/^v1\./);
    expect(row?.access_token).not.toContain(tokens?.accessToken ?? 'none');
    expect(row?.refresh_token).not.toContain(tokens?.refreshToken ?? 'none');
    expect(openToken(SETUP.tokenKey, row?.access_token ?? '')).toBe(tokens?.accessToken);
    expect(row?.expires_at?.toISOString()).toBe('2026-10-09T12:00:00.000Z');
    // What the app shows of it holds no token.
    expect(await connections.account(userId)).toEqual({
      baseUrl: 'http://gitlab.test',
      username: 'olga.beispiel',
      name: 'Olga Beispiel',
    });
  });

  it('is unknown for someone who never connected', async () => {
    const { connections, person } = setUp();
    const { userId } = await person(false);

    expect(await connections.account(userId)).toBeUndefined();
    expect(await connections.accessOf(userId)).toBeUndefined();
    expect(await connections.disconnectAccount(userId)).toBe(false);
  });

  it('keeps the projects it serves when the same account is connected again', async () => {
    const { connections, consent, person, connection, stored } = setUp();
    const { userId, projectId } = await person();
    await connections.setRepository(projectId, userId, REPOSITORY);
    const before = await stored(userId);

    const again = await consent();
    await connections.connectAccount(userId, { ...again.account, name: 'Olga B.' }, again.tokens);

    expect((await stored(userId))?.access_token).not.toBe(before?.access_token);
    // The connection stays and shows the account's new name.
    expect(await connection(projectId)).toMatchObject({
      repository_id: '101',
      account_name: 'Olga B.',
    });
  });

  it('drops the repositories it picked when another account takes its place', async () => {
    const { connections, consent, person, connection } = setUp();
    const { userId, projectId } = await person();
    await connections.setRepository(projectId, userId, REPOSITORY);

    const other = await consent();
    await connections.connectAccount(
      userId,
      { id: 99, username: 'olga.privat', name: 'Olga' },
      other.tokens,
    );

    // The other account may not reach that repository: it is picked anew.
    expect(await connection(projectId)).toBeUndefined();
    expect((await connections.account(userId))?.username).toBe('olga.privat');
  });
});

describe('access as a person', () => {
  it('gives the token as long as it holds, without asking GitLab', async () => {
    const { clock, calls, connections, person } = setUp();
    const { userId, tokens } = await person();

    clock.now += 2 * HOUR - 61_000;
    const access = await connections.accessOf(userId);

    expect(access).toEqual({ baseUrl: 'http://gitlab.test', token: tokens?.accessToken });
    expect(calls).toEqual([]);
  });

  it('renews a token that is about to end, and stores the new ones', async () => {
    const { clock, calls, client, connections, person, stored } = setUp();
    const { userId, tokens } = await person();
    const before = await stored(userId);

    clock.now += 2 * HOUR - 30_000;
    const access = await connections.accessOf(userId);

    expect(calls).toEqual(['POST /oauth/token']);
    expect(access?.token).not.toBe(tokens?.accessToken);
    // The new token works, and the stored ones are the new ones.
    expect((await client.account('http://gitlab.test', access?.token ?? '')).username).toBe(
      'olga.beispiel',
    );
    const after = await stored(userId);
    expect(openToken(SETUP.tokenKey, after?.access_token ?? '')).toBe(access?.token);
    expect(after?.refresh_token).not.toBe(before?.refresh_token);
    expect(after?.expires_at?.getTime()).toBe(clock.now + 2 * HOUR);
  });

  it('renews once when two calls need the token at the same time', async () => {
    const { clock, calls, connections, person } = setUp();
    const { userId } = await person();
    clock.now += 3 * HOUR;

    const [first, second] = await Promise.all([
      connections.accessOf(userId),
      connections.accessOf(userId),
    ]);

    expect(calls).toEqual(['POST /oauth/token']);
    expect(first?.token).toBeTruthy();
    expect(second?.token).toBe(first?.token);
  });

  it('ends an account GitLab no longer accepts, and the projects it served', async () => {
    const { clock, standIn, connections, person, connection, stored } = setUp();
    const { userId, projectId } = await person();
    await connections.setRepository(projectId, userId, REPOSITORY);
    // The person revoked the application in GitLab.
    standIn.forgetTokens();
    clock.now += 3 * HOUR;

    expect(await connections.access(projectId)).toBeUndefined();

    expect(await stored(userId)).toBeUndefined();
    expect(await connection(projectId)).toBeUndefined();
  });

  it('keeps the account while GitLab is away', async () => {
    const { clock, state, connections, person, stored } = setUp();
    const { userId } = await person();
    clock.now += 3 * HOUR;
    state.away = true;

    await expect(connections.accessOf(userId)).rejects.toMatchObject({ status: 0 });
    expect(await stored(userId)).toBeDefined();

    // Back again, the next call renews.
    state.away = false;
    expect((await connections.accessOf(userId))?.token).toBeTruthy();
  });
});

describe('the repository of a project', () => {
  it('is picked by an owner with an account, and read with that access', async () => {
    const { connections, person, connection } = setUp();
    const { userId, projectId, tokens } = await person();

    expect(await connections.access(projectId)).toBeUndefined();
    const done = await connections.setRepository(projectId, userId, REPOSITORY);

    expect(done).toBe(true);
    expect(await connection(projectId)).toMatchObject({
      base_url: 'http://gitlab.test',
      connected_by: userId,
      account_username: 'olga.beispiel',
      account_name: 'Olga Beispiel',
      repository_id: '101',
      repository_path: 'beispiel-verein/vereins-app',
      repository_name: 'Vereins-App',
      repository_url: 'http://gitlab.test/beispiel-verein/vereins-app',
      repository_default_branch: 'main',
    });
    expect(await connections.access(projectId)).toEqual({
      baseUrl: 'http://gitlab.test',
      token: tokens?.accessToken,
    });
  });

  it('is not stored for someone without an account', async () => {
    const { connections, person, connection } = setUp();
    const { userId, projectId } = await person(false);

    expect(await connections.setRepository(projectId, userId, REPOSITORY)).toBe(false);
    expect(await connection(projectId)).toBeUndefined();
  });

  it('is replaced by a new pick, also of another owner', async () => {
    const { connections, person, connection } = setUp();
    const first = await person();
    const second = await person();
    await test.db.admin
      .insertInto('project_members')
      .values({ project_id: first.projectId, user_id: second.userId, role: 'owner' })
      .execute();
    await connections.setRepository(first.projectId, first.userId, REPOSITORY);

    await connections.setRepository(first.projectId, second.userId, {
      ...REPOSITORY,
      id: 103,
      path: 'olga.beispiel/notizen',
      name: 'Notizen',
      defaultBranch: null,
    });

    expect(await connection(first.projectId)).toMatchObject({
      connected_by: second.userId,
      repository_id: '103',
      repository_default_branch: null,
    });
  });

  it('is removed from the project without touching the account', async () => {
    const { calls, connections, person, connection, stored } = setUp();
    const { userId, projectId } = await person();
    await connections.setRepository(projectId, userId, REPOSITORY);

    expect(await connections.disconnect(projectId)).toBe(true);

    expect(await connection(projectId)).toBeUndefined();
    expect(await stored(userId)).toBeDefined();
    // GitLab is not told anything: the token is still the person's.
    expect(calls).toEqual([]);
    expect(await connections.disconnect(projectId)).toBe(false);
  });
});

describe('disconnecting an account', () => {
  it('tells GitLab that the token is no longer used, and disconnects the projects it served', async () => {
    const { standIn, calls, connections, person, connection, stored } = setUp();
    const { userId, projectId } = await person();
    await connections.setRepository(projectId, userId, REPOSITORY);
    expect(standIn.accessTokenCount).toBe(1);

    expect(await connections.disconnectAccount(userId)).toBe(true);

    expect(calls).toEqual(['POST /oauth/revoke']);
    expect(standIn.accessTokenCount).toBe(0);
    expect(await stored(userId)).toBeUndefined();
    expect(await connection(projectId)).toBeUndefined();
  });

  it('removes the account also while GitLab is away', async () => {
    const { state, connections, person, stored } = setUp();
    const { userId } = await person();
    state.away = true;

    expect(await connections.disconnectAccount(userId)).toBe(true);
    expect(await stored(userId)).toBeUndefined();
  });
});
