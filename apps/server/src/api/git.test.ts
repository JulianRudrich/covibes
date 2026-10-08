import { randomUUID } from 'node:crypto';

import type {
  ApiErrorBody,
  GitConnectStart,
  GitRepository,
  GitState,
  ProjectSummary,
} from '@covibes/shared';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { gitCallback, gitRoutes } from '@server/api/git';
import { signState, STATE_LIFETIME_MS } from '@server/integrations/gitlab/crypto';
import { APP_URL, createTestServer } from '@server/testing';

// Connecting GitLab (spec 28a), through the whole OAuth flow against the stand-in of the server.
const test = createTestServer();
const TOKEN_KEY = test.env.TOKEN_KEY ?? '';

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

/** Starts the flow and opens GitLab's consent page; the two links of that page. */
async function consent(git: string, cookie: string) {
  const started = await request(`${git}/connect`, cookie, { method: 'POST' });
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

/** The whole way: consent, back to the server, the connection stored. */
async function connect(git: string, cookie: string) {
  const { allow } = await consent(git, cookie);
  const back = await request(allow, cookie);
  expect(back.status).toBe(302);
  return back.headers.get('location');
}

const tokensOf = (projectId: string) =>
  test.db.admin
    .selectFrom('oauth_tokens')
    .selectAll()
    .where('project_id', '=', projectId)
    .executeTakeFirst();

describe('GET /api/projects/:projectId/git', () => {
  it('says that nothing is connected, and who could connect', async () => {
    const project = await createProject();
    const viewer = await member(project.projectId, 'viewer');

    expect(await stateOf(project.git, project.owner)).toEqual({
      available: true,
      canManage: true,
      connection: null,
    });
    expect(await stateOf(project.git, viewer)).toEqual({
      available: true,
      canManage: false,
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

describe('connecting through OAuth', () => {
  it('sends the owner to the consent page and stores the connection on the way back', async () => {
    const project = await createProject();
    const { url, allow } = await consent(project.git, project.owner);

    expect(url.pathname).toBe('/api/dev/gitlab/oauth/authorize');
    expect(url.searchParams.get('scope')).toBe('api');
    expect(url.searchParams.get('redirect_uri')).toBe(`${APP_URL}/api/git/callback`);
    expect(new URL(allow).pathname).toBe('/api/git/callback');

    const back = await request(allow, project.owner);

    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe(`${APP_URL}/p/${project.projectId}?git=connected`);
    const state = await stateOf(project.git, project.owner);
    expect(state.connection).toMatchObject({
      baseUrl: `${APP_URL}/api/dev/gitlab`,
      account: { username: 'olga.beispiel', name: 'Olga Beispiel' },
      connectedBy: { userId: await userIdOf(project.owner), name: 'Olga' },
      repository: null,
    });
    // The tokens are stored sealed, and no answer holds one.
    const tokens = await tokensOf(project.projectId);
    expect(tokens?.access_token).toMatch(/^v1\./);
    expect(tokens?.refresh_token).toMatch(/^v1\./);
    expect(tokens?.scope).toBe('api');
    expect(JSON.stringify(state)).not.toMatch(/token/i);
  });

  it('stores nothing when the person denies the access', async () => {
    const project = await createProject();
    const { deny } = await consent(project.git, project.owner);

    const back = await request(deny, project.owner);

    expect(back.headers.get('location')).toBe(`${APP_URL}/p/${project.projectId}?git=denied`);
    expect((await stateOf(project.git, project.owner)).connection).toBeNull();
  });

  it('takes a code only once', async () => {
    const project = await createProject();
    const { allow } = await consent(project.git, project.owner);
    await request(allow, project.owner);
    const first = await tokensOf(project.projectId);

    const again = await request(allow, project.owner);

    expect(again.headers.get('location')).toBe(`${APP_URL}/p/${project.projectId}?git=failed`);
    // The connection of the first way back stays as it is.
    expect(await tokensOf(project.projectId)).toEqual(first);
  });

  it('refuses a state that is forged, expired or made for someone else', async () => {
    const project = await createProject();
    const otherOwner = await member(project.projectId, 'owner');
    const { allow } = await consent(project.git, project.owner);
    const code = new URL(allow).searchParams.get('code') ?? '';
    const ownerId = await userIdOf(project.owner);
    const callback = (state: string) =>
      `/api/git/callback?${new URLSearchParams({ code, state }).toString()}`;
    const expired = signState(
      TOKEN_KEY,
      { projectId: project.projectId, userId: ownerId },
      Date.now() - STATE_LIFETIME_MS - 1,
    );
    const otherKey = signState('another-key-with-at-least-32-characters', {
      projectId: project.projectId,
      userId: ownerId,
    });

    const attempts = [
      // Someone else comes back with the owner's link.
      await request(allow, otherOwner),
      // Nobody is signed in.
      await request(allow, null),
      await request(callback(expired), project.owner),
      await request(callback(otherKey), project.owner),
      await request(callback('made.up'), project.owner),
      await request(`/api/git/callback?code=${code}`, project.owner),
    ];

    // There is no project to go back to: the start page, and nothing is stored.
    expect(attempts.map((response) => [response.status, response.headers.get('location')])).toEqual(
      attempts.map(() => [302, `${APP_URL}/`]),
    );
    expect((await stateOf(project.git, project.owner)).connection).toBeNull();
  });

  it('refuses the way back of someone who is no owner any more', async () => {
    const project = await createProject();
    const second = await member(project.projectId, 'owner');
    const { allow } = await consent(project.git, second);
    await test.db.adminPool.query(
      `update project_members set role = 'editor' where project_id = $1 and user_id = $2`,
      [project.projectId, await userIdOf(second)],
    );

    const back = await request(allow, second);

    expect(back.headers.get('location')).toBe(`${APP_URL}/`);
    expect((await stateOf(project.git, project.owner)).connection).toBeNull();
  });

  it('is started by owners only', async () => {
    const project = await createProject();
    const editor = await member(project.projectId, 'editor');
    const stranger = await test.signIn();
    const start = (cookie: string | null) =>
      request(`${project.git}/connect`, cookie, { method: 'POST' });

    const asEditor = await start(editor);

    expect(asEditor.status).toBe(403);
    expect(await errorCode(asEditor)).toBe('forbidden');
    expect((await start(stranger)).status).toBe(404);
    expect((await start(null)).status).toBe(401);
  });
});

describe('the repository', () => {
  it('is picked by an owner from the repositories of the account, with a search', async () => {
    const project = await createProject();
    await connect(project.git, project.owner);

    const all = (await (
      await request(`${project.git}/repositories`, project.owner)
    ).json()) as GitRepository[];
    const found = (await (
      await request(`${project.git}/repositories?search=notiz`, project.owner)
    ).json()) as GitRepository[];
    const picked = await request(
      `${project.git}/repository`,
      project.owner,
      json('PUT', { repositoryId: 101 }),
    );

    expect(all.map((repository) => repository.path)).toEqual([
      'beispiel-verein/vereins-app',
      'beispiel-verein/website',
      'olga.beispiel/notizen',
    ]);
    expect(found.map((repository) => repository.id)).toEqual([103]);
    expect(picked.status).toBe(204);
    // Every member sees which repository it is and who connected it.
    const viewer = await member(project.projectId, 'viewer');
    expect((await stateOf(project.git, viewer)).connection).toMatchObject({
      connectedBy: { name: 'Olga' },
      repository: {
        id: 101,
        path: 'beispiel-verein/vereins-app',
        name: 'Vereins-App',
        url: `${APP_URL}/api/dev/gitlab/beispiel-verein/vereins-app`,
        defaultBranch: 'main',
      },
    });
  });

  it('must be one the account can reach', async () => {
    const project = await createProject();
    await connect(project.git, project.owner);
    const pick = (body: unknown) =>
      request(`${project.git}/repository`, project.owner, json('PUT', body));

    expect((await pick({ repositoryId: 999 })).status).toBe(400);
    expect((await pick({ repositoryId: 'x' })).status).toBe(400);
    expect((await pick({ repositoryId: 101, more: true })).status).toBe(400);
    expect((await pick({})).status).toBe(400);
    expect((await stateOf(project.git, project.owner)).connection?.repository).toBeNull();
  });

  it('is not listed or picked by editors, viewers and strangers, or without a connection', async () => {
    const project = await createProject();
    const editor = await member(project.projectId, 'editor');
    const stranger = await test.signIn();
    const pick = (cookie: string | null) =>
      request(`${project.git}/repository`, cookie, json('PUT', { repositoryId: 101 }));

    // Nothing is connected yet.
    expect((await request(`${project.git}/repositories`, project.owner)).status).toBe(404);
    expect((await pick(project.owner)).status).toBe(404);

    await connect(project.git, project.owner);
    expect((await request(`${project.git}/repositories`, editor)).status).toBe(403);
    expect((await pick(editor)).status).toBe(403);
    expect((await request(`${project.git}/repositories`, stranger)).status).toBe(404);
    expect((await pick(stranger)).status).toBe(404);
    expect((await pick(null)).status).toBe(401);
    expect(
      (await request(`${project.git}/repositories?search=${'x'.repeat(101)}`, project.owner))
        .status,
    ).toBe(400);
  });
});

describe('ending a connection', () => {
  it('removes connection and tokens when an owner disconnects', async () => {
    const project = await createProject();
    const second = await member(project.projectId, 'owner');
    const editor = await member(project.projectId, 'editor');
    await connect(project.git, project.owner);

    expect((await request(project.git, editor, { method: 'DELETE' })).status).toBe(403);
    expect((await request(project.git, null, { method: 'DELETE' })).status).toBe(401);
    expect((await stateOf(project.git, project.owner)).connection).not.toBeNull();

    // Any owner ends it, not only the one who connected.
    const ended = await request(project.git, second, { method: 'DELETE' });
    const again = await request(project.git, second, { method: 'DELETE' });

    expect([ended.status, again.status]).toEqual([204, 204]);
    expect((await stateOf(project.git, project.owner)).connection).toBeNull();
    expect(await tokensOf(project.projectId)).toBeUndefined();
  });

  it('ends by itself when the owner who connected leaves the project', async () => {
    const project = await createProject();
    const second = await member(project.projectId, 'owner');
    await connect(project.git, second);
    expect((await stateOf(project.git, project.owner)).connection).not.toBeNull();

    const left = await request(
      `/api/projects/${project.projectId}/members/${await userIdOf(second)}`,
      second,
      { method: 'DELETE' },
    );

    expect(left.status).toBe(204);
    expect((await stateOf(project.git, project.owner)).connection).toBeNull();
    expect(await tokensOf(project.projectId)).toBeUndefined();
  });

  it('lets another owner connect in the place of the first', async () => {
    const project = await createProject();
    const second = await member(project.projectId, 'owner');
    await connect(project.git, project.owner);
    await request(`${project.git}/repository`, project.owner, json('PUT', { repositoryId: 102 }));

    expect(await connect(project.git, second)).toBe(
      `${APP_URL}/p/${project.projectId}?git=connected`,
    );

    const { connection } = await stateOf(project.git, project.owner);
    expect(connection?.connectedBy.userId).toBe(await userIdOf(second));
    // The repository is picked anew with the new access.
    expect(connection?.repository).toBeNull();
  });
});

describe('a server that is not set up for GitLab', () => {
  const bare = new Hono()
    .route('/api/projects/:projectId/git', gitRoutes(test.db.app, test.auth, undefined))
    .route('/api/git/callback', gitCallback(test.db.app, test.auth, APP_URL, undefined));
  const ask = (path: string, cookie: string, init: RequestInit = {}) =>
    bare.request(path, { ...init, headers: { cookie, origin: APP_URL } });

  it('says so, and connects nothing', async () => {
    const project = await createProject();

    expect(await (await ask(project.git, project.owner)).json()).toEqual({
      available: false,
      canManage: true,
      connection: null,
    });
    expect((await ask(`${project.git}/connect`, project.owner, { method: 'POST' })).status).toBe(
      404,
    );
    expect((await ask(`${project.git}/repositories`, project.owner)).status).toBe(404);
    const back = await ask(`/api/git/callback?code=x&state=${randomUUID()}`, project.owner);
    expect(back.headers.get('location')).toBe(`${APP_URL}/`);
  });
});

describe('the stand-in for GitLab', () => {
  it('answers only where the server serves it, and never to a browser form from elsewhere', async () => {
    const page = await test.app.request(
      `/api/dev/gitlab/oauth/authorize?client_id=someone-else&redirect_uri=https://evil.example&response_type=code`,
    );
    const api = await test.app.request('/api/dev/gitlab/api/v4/user');

    expect(page.status).toBe(400);
    expect(api.status).toBe(401);
  });
});
