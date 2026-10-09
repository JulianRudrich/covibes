import { randomUUID } from 'node:crypto';

import type {
  ApiErrorBody,
  GitAccountState,
  GitConnectInput,
  GitConnectStart,
  GitRepository,
  GitState,
  ProjectSummary,
} from '@covibes/shared';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { gitAccountRoutes, gitCallback, gitRoutes } from '@server/api/git';
import { signState, STATE_LIFETIME_MS } from '@server/integrations/gitlab/crypto';
import { APP_URL, createTestServer } from '@server/testing';

// GitLab accounts of people and the repository of a project (specs 28a and 29a), through the
// whole OAuth flow against the stand-in of the server.
const test = createTestServer();
const TOKEN_KEY = test.env.TOKEN_KEY ?? '';
const ACCOUNT = '/api/git/account';

function request(path: string, cookie: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  headers.set('origin', APP_URL);
  return test.app.request(path, { ...init, headers });
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

async function errorCode(response: Response) {
  return ((await response.json()) as ApiErrorBody).error.code;
}

async function userIdOf(cookie: string) {
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  return session.user.id;
}

async function createProject() {
  const owner = await test.signIn();
  const created = await request('/api/projects', owner, json('POST', { name: 'Vereins-App' }));
  const projectId = ((await created.json()) as ProjectSummary).id;
  await test.db.adminPool.query('update users set name = $1 where id = $2', [
    'Olga',
    await userIdOf(owner),
  ]);
  return { owner, projectId, git: `/api/projects/${projectId}/git` };
}

async function member(projectId: string, role: 'owner' | 'editor' | 'viewer') {
  const cookie = await test.signIn();
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, await userIdOf(cookie), role],
  );
  return cookie;
}

async function stateOf(path: string, cookie: string) {
  const response = await request(path, cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as GitState;
}

async function accountOf(cookie: string) {
  const response = await request(ACCOUNT, cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as GitAccountState;
}

/** Starts the flow and opens GitLab's consent page; the two links of that page. */
async function consent(cookie: string, input: GitConnectInput = { origin: 'account' }) {
  const started = await request(`${ACCOUNT}/connect`, cookie, json('POST', input));
  expect(started.status).toBe(200);
  const { url } = (await started.json()) as GitConnectStart;
  const page = await test.app.request(url);
  expect(page.status).toBe(200);
  const html = await page.text();
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) =>
    (match[1] ?? '').replaceAll('&amp;', '&'),
  );
  return { url: new URL(url), allow: links[0] ?? '', deny: links[1] ?? '' };
}

/** The whole way: consent, back to the server, the account stored. Where the browser lands. */
async function connect(cookie: string, input?: GitConnectInput) {
  const { allow } = await consent(cookie, input);
  const back = await request(allow, cookie);
  expect(back.status).toBe(302);
  return back.headers.get('location');
}

const pick = (git: string, cookie: string | null, body: unknown = { repositoryId: 101 }) =>
  request(`${git}/repository`, cookie, json('PUT', body));

const storedAccount = (userId: string) =>
  test.db.admin
    .selectFrom('git_accounts')
    .selectAll()
    .where('user_id', '=', userId)
    .executeTakeFirst();

describe('the own GitLab account', () => {
  it('is connected through the consent page, and then names the account', async () => {
    const person = await test.signIn();
    expect(await accountOf(person)).toEqual({ available: true, account: null });
    const { url, allow } = await consent(person);

    expect(url.pathname).toBe('/api/dev/gitlab/oauth/authorize');
    expect(url.searchParams.get('scope')).toBe('api');
    expect(url.searchParams.get('redirect_uri')).toBe(`${APP_URL}/api/git/callback`);

    const back = await request(allow, person);

    // The flow came from the account dialog on the start page, and leads back to it.
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe(`${APP_URL}/?gitAccount=connected`);
    const state = await accountOf(person);
    expect(state.account).toEqual({
      baseUrl: `${APP_URL}/api/dev/gitlab`,
      username: 'olga.beispiel',
      name: 'Olga Beispiel',
    });
    // The tokens are stored sealed, and no answer holds one.
    const stored = await storedAccount(await userIdOf(person));
    expect(stored?.access_token).toMatch(/^v1\./);
    expect(stored?.refresh_token).toMatch(/^v1\./);
    expect(JSON.stringify(state)).not.toMatch(/token/i);
  });

  it('leads back to the project and the dialog the flow was started from', async () => {
    const project = await createProject();

    expect(
      await connect(project.owner, { origin: 'repository', projectId: project.projectId }),
    ).toBe(`${APP_URL}/p/${project.projectId}?git=connected`);
    expect(await connect(project.owner, { origin: 'account', projectId: project.projectId })).toBe(
      `${APP_URL}/p/${project.projectId}?gitAccount=connected`,
    );
    // Outside of a project there is only the account dialog.
    expect(await connect(project.owner, { origin: 'repository' })).toBe(
      `${APP_URL}/?gitAccount=connected`,
    );
  });

  it('stores nothing when the person denies the access, and takes a code only once', async () => {
    const person = await test.signIn();
    const denied = await consent(person);
    const granted = await consent(person);

    const refused = await request(denied.deny, person);
    expect(refused.headers.get('location')).toBe(`${APP_URL}/?gitAccount=denied`);
    expect((await accountOf(person)).account).toBeNull();

    await request(granted.allow, person);
    const first = await storedAccount(await userIdOf(person));
    const again = await request(granted.allow, person);

    expect(again.headers.get('location')).toBe(`${APP_URL}/?gitAccount=failed`);
    // The account of the first way back stays as it is.
    expect(await storedAccount(await userIdOf(person))).toEqual(first);
  });

  it('refuses a state that is forged, expired or made for someone else', async () => {
    const person = await test.signIn();
    const other = await test.signIn();
    const { allow } = await consent(person);
    const code = new URL(allow).searchParams.get('code') ?? '';
    const flow = { userId: await userIdOf(person), projectId: null, origin: 'account' as const };
    const callback = (state: string) =>
      `/api/git/callback?${new URLSearchParams({ code, state }).toString()}`;
    const expired = signState(TOKEN_KEY, flow, Date.now() - STATE_LIFETIME_MS - 1);
    const otherKey = signState('another-key-with-at-least-32-characters', flow);

    const attempts = [
      // Someone else comes back with the person's link.
      await request(allow, other),
      // Nobody is signed in.
      await request(allow, null),
      await request(callback(expired), person),
      await request(callback(otherKey), person),
      await request(callback('made.up'), person),
      await request(`/api/git/callback?code=${code}`, person),
    ];

    // There is nothing to go back to: the start page, and nothing is stored.
    expect(attempts.map((response) => [response.status, response.headers.get('location')])).toEqual(
      attempts.map(() => [302, `${APP_URL}/`]),
    );
    expect((await accountOf(person)).account).toBeNull();
    expect((await accountOf(other)).account).toBeNull();
  });

  it('needs to know where the flow starts, and a session', async () => {
    const person = await test.signIn();
    const start = (cookie: string | null, body: unknown) =>
      request(`${ACCOUNT}/connect`, cookie, json('POST', body));

    expect((await start(person, {})).status).toBe(400);
    expect((await start(person, { origin: 'elsewhere' })).status).toBe(400);
    expect((await start(person, { origin: 'account', projectId: 'nope' })).status).toBe(400);
    expect((await start(null, { origin: 'account' })).status).toBe(401);
    expect((await request(ACCOUNT, null)).status).toBe(401);
    expect((await request(ACCOUNT, null, { method: 'DELETE' })).status).toBe(401);
  });

  it('is disconnected by the person, and the projects it served with it', async () => {
    const project = await createProject();
    await connect(project.owner);
    await pick(project.git, project.owner);
    expect((await stateOf(project.git, project.owner)).connection).not.toBeNull();

    const ended = await request(ACCOUNT, project.owner, { method: 'DELETE' });
    const again = await request(ACCOUNT, project.owner, { method: 'DELETE' });

    expect([ended.status, again.status]).toEqual([204, 204]);
    expect((await accountOf(project.owner)).account).toBeNull();
    expect(await storedAccount(await userIdOf(project.owner))).toBeUndefined();
    expect((await stateOf(project.git, project.owner)).connection).toBeNull();
  });
});

describe('GET /api/projects/:projectId/git', () => {
  it('says that nothing is connected, who could pick, and whether the person has an account', async () => {
    const project = await createProject();
    const viewer = await member(project.projectId, 'viewer');
    await connect(project.owner);

    expect(await stateOf(project.git, project.owner)).toEqual({
      available: true,
      canManage: true,
      account: {
        baseUrl: `${APP_URL}/api/dev/gitlab`,
        username: 'olga.beispiel',
        name: 'Olga Beispiel',
      },
      connection: null,
    });
    expect(await stateOf(project.git, viewer)).toEqual({
      available: true,
      canManage: false,
      account: null,
      connection: null,
    });
  });

  it('is there for members only', async () => {
    const project = await createProject();
    const stranger = await test.signIn();

    expect((await request(project.git, null)).status).toBe(401);
    expect((await request(project.git, stranger)).status).toBe(404);
    expect((await request('/api/projects/nope/git', project.owner)).status).toBe(404);
  });
});

describe('the repository of a project', () => {
  it('is picked by an owner from the repositories of their own account, with a search', async () => {
    const project = await createProject();
    await connect(project.owner);

    const all = (await (
      await request(`${project.git}/repositories`, project.owner)
    ).json()) as GitRepository[];
    const found = (await (
      await request(`${project.git}/repositories?search=notiz`, project.owner)
    ).json()) as GitRepository[];
    const picked = await pick(project.git, project.owner);

    expect(all.map((repository) => repository.path)).toEqual([
      'beispiel-verein/vereins-app',
      'beispiel-verein/website',
      'olga.beispiel/notizen',
    ]);
    expect(found.map((repository) => repository.id)).toEqual([103]);
    expect(picked.status).toBe(204);
    // Every member sees which repository it is and whose access reaches it.
    const viewer = await member(project.projectId, 'viewer');
    expect((await stateOf(project.git, viewer)).connection).toMatchObject({
      baseUrl: `${APP_URL}/api/dev/gitlab`,
      account: { username: 'olga.beispiel', name: 'Olga Beispiel' },
      connectedBy: { userId: await userIdOf(project.owner), name: 'Olga' },
      repository: {
        id: 101,
        path: 'beispiel-verein/vereins-app',
        name: 'Vereins-App',
        url: `${APP_URL}/api/dev/gitlab/beispiel-verein/vereins-app`,
        defaultBranch: 'main',
      },
    });
  });

  it('needs an account of the owner who picks', async () => {
    const project = await createProject();

    expect((await request(`${project.git}/repositories`, project.owner)).status).toBe(404);
    expect((await pick(project.git, project.owner)).status).toBe(404);
    expect((await stateOf(project.git, project.owner)).connection).toBeNull();
  });

  it('must be one the account can reach', async () => {
    const project = await createProject();
    await connect(project.owner);

    expect((await pick(project.git, project.owner, { repositoryId: 999 })).status).toBe(400);
    expect((await pick(project.git, project.owner, { repositoryId: 'x' })).status).toBe(400);
    expect((await pick(project.git, project.owner, { repositoryId: 101, more: 1 })).status).toBe(
      400,
    );
    expect((await pick(project.git, project.owner, {})).status).toBe(400);
    expect((await stateOf(project.git, project.owner)).connection).toBeNull();
  });

  it('is not listed or picked by editors, viewers and strangers, also with an account', async () => {
    const project = await createProject();
    const editor = await member(project.projectId, 'editor');
    const stranger = await test.signIn();
    await connect(editor);
    await connect(stranger);

    const asEditor = await pick(project.git, editor);

    expect(asEditor.status).toBe(403);
    expect(await errorCode(asEditor)).toBe('forbidden');
    expect((await request(`${project.git}/repositories`, editor)).status).toBe(403);
    expect((await request(`${project.git}/repositories`, stranger)).status).toBe(404);
    expect((await pick(project.git, stranger)).status).toBe(404);
    expect((await pick(project.git, null)).status).toBe(401);
    await connect(project.owner);
    expect(
      (await request(`${project.git}/repositories?search=${'x'.repeat(101)}`, project.owner))
        .status,
    ).toBe(400);
  });

  it('is picked anew by another owner with that owner’s account', async () => {
    const project = await createProject();
    const second = await member(project.projectId, 'owner');
    await connect(project.owner);
    await connect(second);
    await pick(project.git, project.owner, { repositoryId: 102 });

    expect((await pick(project.git, second, { repositoryId: 103 })).status).toBe(204);

    const { connection } = await stateOf(project.git, project.owner);
    expect(connection?.connectedBy.userId).toBe(await userIdOf(second));
    expect(connection?.repository.path).toBe('olga.beispiel/notizen');
  });
});

describe('removing the repository from a project', () => {
  it('is for owners, and leaves the account of who picked it', async () => {
    const project = await createProject();
    const second = await member(project.projectId, 'owner');
    const editor = await member(project.projectId, 'editor');
    await connect(project.owner);
    await pick(project.git, project.owner);

    expect((await request(project.git, editor, { method: 'DELETE' })).status).toBe(403);
    expect((await request(project.git, null, { method: 'DELETE' })).status).toBe(401);
    expect((await stateOf(project.git, project.owner)).connection).not.toBeNull();

    // Any owner removes it, not only the one who picked.
    const ended = await request(project.git, second, { method: 'DELETE' });
    const again = await request(project.git, second, { method: 'DELETE' });

    expect([ended.status, again.status]).toEqual([204, 204]);
    const state = await stateOf(project.git, project.owner);
    expect(state.connection).toBeNull();
    expect(state.account?.username).toBe('olga.beispiel');
  });

  it('happens by itself when the owner who picked it leaves the project', async () => {
    const project = await createProject();
    const second = await member(project.projectId, 'owner');
    await connect(second);
    await pick(project.git, second);
    expect((await stateOf(project.git, project.owner)).connection).not.toBeNull();

    const left = await request(
      `/api/projects/${project.projectId}/members/${await userIdOf(second)}`,
      second,
      { method: 'DELETE' },
    );

    expect(left.status).toBe(204);
    expect((await stateOf(project.git, project.owner)).connection).toBeNull();
    // The account is the person's and stays.
    expect((await accountOf(second)).account).not.toBeNull();
  });
});

describe('a server that is not set up for GitLab', () => {
  const bare = new Hono()
    .route('/api/git/account', gitAccountRoutes(test.auth, undefined))
    .route('/api/projects/:projectId/git', gitRoutes(test.db.app, test.auth, undefined))
    .route('/api/git/callback', gitCallback(test.auth, APP_URL, undefined));
  const ask = (path: string, cookie: string, init: RequestInit = {}) =>
    bare.request(path, {
      ...init,
      headers: { cookie, origin: APP_URL, 'content-type': 'application/json' },
    });

  it('says so, and connects nothing', async () => {
    const project = await createProject();

    expect(await (await ask(ACCOUNT, project.owner)).json()).toEqual({
      available: false,
      account: null,
    });
    expect(await (await ask(project.git, project.owner)).json()).toEqual({
      available: false,
      canManage: true,
      account: null,
      connection: null,
    });
    const start = await ask(`${ACCOUNT}/connect`, project.owner, {
      method: 'POST',
      body: JSON.stringify({ origin: 'account' }),
    });
    expect(start.status).toBe(404);
    expect((await ask(`${project.git}/repositories`, project.owner)).status).toBe(404);
    const back = await ask(`/api/git/callback?code=x&state=${randomUUID()}`, project.owner);
    expect(back.headers.get('location')).toBe(`${APP_URL}/`);
  });
});

describe('the stand-in for GitLab', () => {
  it('sends people back only to this server, and answers its API only with a token', async () => {
    const page = await test.app.request(
      `/api/dev/gitlab/oauth/authorize?client_id=someone-else&redirect_uri=https://evil.example&response_type=code`,
    );
    const api = await test.app.request('/api/dev/gitlab/api/v4/user');

    expect(page.status).toBe(400);
    expect(api.status).toBe(401);
  });
});
