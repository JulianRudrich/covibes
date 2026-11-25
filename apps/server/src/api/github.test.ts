import { createHmac, generateKeyPairSync, randomUUID } from 'node:crypto';

import {
  ensureTaskIds,
  planNodesFromMarkdown,
  writePlanSection,
  type GitIssuePlan,
  type GitRequestCreated,
  type ProjectSummary,
} from '@covibes/shared';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import {
  githubAccountRoutes,
  githubProjectRoutes,
  githubWebhook,
  validGithubSignature,
} from '@server/api/github';
import { createGithubClient, type GithubSetup } from '@server/integrations/github/client';
import { gitRoutes } from '@server/api/git';
import { createGithubConnections } from '@server/integrations/github/connections';
import { openToken, signState } from '@server/integrations/gitlab/crypto';
import { createRepositoryServices } from '@server/integrations/repository-operations';
import { runGitRequest } from '@server/tasks/git-request';
import { runGitSync } from '@server/tasks/git-sync';
import { APP_URL, createTestServer } from '@server/testing';

const test = createTestServer();
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const setup: GithubSetup = {
  appId: '123',
  clientId: 'Iv1.test',
  clientSecret: 'fixture-client-secret',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  slug: 'covibes-test',
  tokenKey: test.env.TOKEN_KEY ?? '',
  webhookSecret: 'fixture-webhook-secret-at-least-32-characters',
  redirectUri: `${APP_URL}/api/github/callback`,
};
const repository = {
  id: 987,
  name: 'project',
  full_name: 'owner/project',
  html_url: 'https://github.com/owner/project',
  default_branch: 'main',
  permissions: { push: true },
};
const installation = {
  id: 45,
  app_id: 123,
  suspended_at: null,
  account: { login: 'owner' },
  permissions: { contents: 'write', issues: 'write', pull_requests: 'write' },
};
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

function fixture() {
  const state = {
    push: true,
    installed: true,
    suspended: false,
    clock: Date.now(),
    refreshes: 0,
    tokenRequests: 0,
  };
  const calls: { path: string; body: unknown }[] = [];
  const issues: { number: number; title: string; body: string }[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body: unknown = init?.body
      ? (JSON.parse(typeof init.body === 'string' ? init.body : '') as unknown)
      : undefined;
    calls.push({ path: url.pathname, body });
    if (url.pathname === '/login/oauth/access_token') {
      state.refreshes += 1;
      return Promise.resolve(
        Response.json({
          access_token: `fixture-user-token-${String(state.refreshes)}`,
          refresh_token: `fixture-refresh-${String(state.refreshes)}`,
          expires_in: 3600,
          refresh_token_expires_in: 7200,
          token_type: 'bearer',
        }),
      );
    }
    if (url.pathname === '/user')
      return Promise.resolve(Response.json({ id: 77, login: 'owner', name: 'Owner' }));
    if (url.pathname === '/user/installations')
      return Promise.resolve(
        Response.json({
          total_count: state.installed ? 1 : 0,
          installations: state.installed
            ? [{ ...installation, suspended_at: state.suspended ? new Date().toISOString() : null }]
            : [],
        }),
      );
    if (url.pathname === '/user/installations/45/repositories')
      return Promise.resolve(
        Response.json({
          total_count: 1,
          repositories: [{ ...repository, permissions: { push: state.push } }],
        }),
      );
    if (url.pathname === '/app/installations/45')
      return Promise.resolve(
        Response.json({
          ...installation,
          suspended_at: state.suspended ? new Date().toISOString() : null,
        }),
      );
    if (url.pathname === '/app/installations/45/access_tokens') {
      state.tokenRequests += 1;
      return Promise.resolve(
        Response.json({
          token: 'fixture-installation-token',
          expires_at: new Date(state.clock + 3600_000).toISOString(),
          permissions: installation.permissions,
        }),
      );
    }
    if (url.pathname === '/repos/owner/project') return Promise.resolve(Response.json(repository));
    if (url.pathname === '/repos/owner/project/milestones')
      return Promise.resolve(
        Response.json(
          init?.method === 'POST'
            ? {
                number: 12,
                title: 'Milestone 1: Launch',
                html_url: `${repository.html_url}/milestone/12`,
              }
            : [],
        ),
      );
    if (url.pathname === '/repos/owner/project/issues') {
      if (init?.method !== 'POST')
        return Promise.resolve(
          Response.json(
            issues.map((issue) => ({
              ...issue,
              html_url: `${repository.html_url}/issues/${String(issue.number)}`,
            })),
          ),
        );
      const issue = { ...(body as { title: string; body: string }), number: issues.length + 1 };
      issues.push(issue);
      return Promise.resolve(
        Response.json({
          ...issue,
          html_url: `${repository.html_url}/issues/${String(issue.number)}`,
        }),
      );
    }
    if (/^\/repos\/owner\/project\/issues\/\d+$/.test(url.pathname)) {
      const number = Number(url.pathname.split('/').at(-1));
      const issue = issues.find((i) => i.number === number);
      if (issue)
        return Promise.resolve(
          Response.json({
            ...issue,
            state: 'closed',
            user: { login: 'builder' },
            updated_at: null,
            labels: [],
            assignees: [],
          }),
        );
    }
    if (url.pathname === '/repos/owner/project/pulls') return Promise.resolve(Response.json([]));
    return Promise.resolve(new Response(null, { status: 404 }));
  };
  const client = createGithubClient(fetcher, () => state.clock);
  const connections = createGithubConnections({
    admin: test.db.admin,
    client,
    setup,
    now: () => state.clock,
  });
  const deps = { setup, connections };
  const services = createRepositoryServices({
    admin: test.db.admin,
    env: {
      ...test.env,
      GITHUB_APP_ID: setup.appId,
      GITHUB_APP_CLIENT_ID: setup.clientId,
      GITHUB_APP_CLIENT_SECRET: setup.clientSecret,
      GITHUB_APP_PRIVATE_KEY: setup.privateKey,
      GITHUB_APP_SLUG: setup.slug,
      GITHUB_APP_WEBHOOK_SECRET: setup.webhookSecret,
    },
    githubFetch: fetcher,
  });
  if (!services) throw new Error('Fixture repository services missing');
  const app = new Hono()
    .route('/api/github', githubAccountRoutes(test.auth, APP_URL, deps))
    .route('/api/projects/:projectId/github', githubProjectRoutes(test.db.app, test.auth, deps))
    .route('/api/github/webhook', githubWebhook(test.db.admin, setup))
    .route(
      '/api/projects/:projectId/git',
      gitRoutes(test.db.app, test.auth, services, test.collab, {
        admin: test.db.admin,
        appUrl: APP_URL,
      }),
    );
  const ask = (path: string, cookie: string | null, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (cookie) headers.set('cookie', cookie);
    headers.set('origin', APP_URL);
    return app.request(path, { ...init, headers });
  };
  async function person() {
    const cookie = await test.signIn();
    const user = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
    if (!user) throw new Error('No session');
    return { cookie, userId: user.user.id };
  }
  async function connect(cookie: string) {
    const started = await ask(
      '/api/github/account/connect',
      cookie,
      json('POST', { origin: 'account' }),
    );
    expect(started.status).toBe(200);
    const value = (await started.json()) as { url: string };
    const state = new URL(value.url).searchParams.get('state') ?? '';
    const response = await ask(
      `/api/github/callback?${new URLSearchParams({ state, code: 'fixture-code' }).toString()}`,
      cookie,
    );
    expect(response.headers.get('location')).toBe(`${APP_URL}/?github=connected`);
    return state;
  }
  async function project() {
    const owner = await person();
    const created = await test.app.request('/api/projects', {
      ...json('POST', { name: 'GitHub project' }),
      headers: { cookie: owner.cookie, origin: APP_URL, 'content-type': 'application/json' },
    });
    const { id: projectId } = (await created.json()) as ProjectSummary;
    return { ...owner, projectId, path: `/api/projects/${projectId}/github` };
  }
  return {
    state,
    calls,
    issues,
    services,
    connections,
    ask,
    person,
    connect,
    project,
    fetcher,
    app,
  };
}

describe('GitHub integration authorization', () => {
  it('reports the integration unavailable when the operator has registered no App', async () => {
    const cookie = await test.signIn();
    expect(
      await (await test.app.request('/api/github/account', { headers: { cookie } })).json(),
    ).toEqual({ available: false, account: null, installUrl: null });
    expect(
      (
        await test.app.request('/api/github/account/connect', {
          ...json('POST', { origin: 'account' }),
          headers: { cookie, origin: APP_URL, 'content-type': 'application/json' },
        })
      ).status,
    ).toBe(404);
  });
  it('stores sealed tokens, binds state to the signed-in user and integration purpose, and consumes it once', async () => {
    const f = fixture();
    const owner = await f.person();
    const stranger = await f.person();
    const started = await f.ask(
      '/api/github/account/connect',
      owner.cookie,
      json('POST', { origin: 'account' }),
    );
    const { url } = (await started.json()) as { url: string };
    const state = new URL(url).searchParams.get('state') ?? '';
    expect(new URL(url).origin).toBe('https://github.com');
    expect(await f.connections.finish(stranger.userId, state, 'code')).toBeUndefined();
    const legacy = signState(setup.tokenKey, {
      userId: owner.userId,
      origin: 'account',
      projectId: null,
    });
    expect(await f.connections.finish(owner.userId, legacy, 'code')).toBeUndefined();
    expect(f.state.refreshes).toBe(0);
    expect(await f.connections.finish(owner.userId, state, 'code')).toMatchObject({
      userId: owner.userId,
    });
    expect(await f.connections.finish(owner.userId, state, 'code')).toBeUndefined();
    expect(f.state.refreshes).toBe(1);
    const row = await test.db.admin
      .selectFrom('github_accounts')
      .selectAll()
      .where('user_id', '=', owner.userId)
      .executeTakeFirstOrThrow();
    expect(row.access_token).toMatch(/^v1\./);
    expect(row.access_token).not.toContain('fixture-user-token');
    expect(openToken(setup.tokenKey, row.access_token)).toBe('fixture-user-token-1');
    const shown = await (await f.ask('/api/github/account', owner.cookie)).json();
    expect(shown).toMatchObject({
      available: true,
      account: { username: 'owner', baseUrl: 'https://github.com' },
    });
    expect(JSON.stringify(shown)).not.toContain('token');
    await expect(
      test.db.app.selectFrom('github_accounts').selectAll().execute(),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('only lets owners select repositories, validates installation access and rechecks revoked write permission', async () => {
    const f = fixture();
    const owner = await f.project();
    const editor = await f.person();
    const outsider = await f.person();
    await test.db.admin
      .insertInto('project_members')
      .values({ project_id: owner.projectId, user_id: editor.userId, role: 'editor' })
      .execute();
    await f.connect(owner.cookie);
    const pick = (cookie: string | null, id = 987) =>
      f.ask(
        `${owner.path}/repository`,
        cookie,
        json('PUT', { installationId: 45, repositoryId: id }),
      );
    expect((await pick(null)).status).toBe(401);
    expect((await pick(editor.cookie)).status).toBe(403);
    expect((await pick(outsider.cookie)).status).toBe(404);
    expect((await pick(owner.cookie, 999)).status).toBe(403);
    expect((await pick(owner.cookie)).status).toBe(204);
    const target = {
      baseUrl: 'https://github.com',
      repositoryId: 987,
      repositoryPath: 'owner/project',
      projectId: owner.projectId,
    };
    expect(await f.connections.accessOf(owner.userId, target, owner.projectId)).toEqual({
      baseUrl: 'https://github.com',
      token: 'fixture-installation-token',
    });
    expect(f.calls.find((c) => c.path.endsWith('/access_tokens'))?.body).toMatchObject({
      repository_ids: [987],
    });
    const count = f.state.tokenRequests;
    f.state.push = false;
    expect(await f.connections.accessOf(owner.userId, target, owner.projectId)).toBeUndefined();
    expect(f.state.tokenRequests).toBe(count);
    expect((await pick(owner.cookie)).status).toBe(403);
    f.state.push = true;
    f.state.installed = false;
    await expect(
      f.connections.accessOf(owner.userId, target, owner.projectId),
    ).rejects.toMatchObject({ status: 403 });
    await f.ask('/api/github/account', owner.cookie, { method: 'DELETE' });
    expect(
      await test.db.admin
        .selectFrom('git_connections')
        .selectAll()
        .where('project_id', '=', owner.projectId)
        .executeTakeFirst(),
    ).toBeUndefined();
  });

  it('serializes refreshes and expires authorization states', async () => {
    const f = fixture();
    const owner = await f.person();
    const state = await f.connect(owner.cookie);
    f.state.clock += 3600_000;
    const [first, second] = await Promise.all([
      f.connections.userToken(owner.userId),
      f.connections.userToken(owner.userId),
    ]);
    expect(first).toBe(second);
    expect(f.state.refreshes).toBe(2);
    expect(await f.connections.finish(owner.userId, state, 'code')).toBeUndefined();
    const url = await f.connections.start(owner.userId, { origin: 'account', projectId: null });
    f.state.clock += 20 * 60_000;
    expect(
      await f.connections.finish(
        owner.userId,
        new URL(url).searchParams.get('state') ?? '',
        'code',
      ),
    ).toBeUndefined();
  });

  it('requires a current approver role and exact local target before obtaining an installation token', async () => {
    const f = fixture();
    const owner = await f.project();
    const editor = await f.person();
    await f.connect(owner.cookie);
    await f.connect(editor.cookie);
    await f.connections.connect(owner.projectId, owner.userId, 45, 987);
    await test.db.admin
      .insertInto('project_members')
      .values({
        project_id: owner.projectId,
        user_id: editor.userId,
        role: 'editor',
        can_approve_git: false,
      })
      .execute();
    const services = createRepositoryServices({
      admin: test.db.admin,
      env: {
        ...test.env,
        GITHUB_APP_ID: setup.appId,
        GITHUB_APP_CLIENT_ID: setup.clientId,
        GITHUB_APP_CLIENT_SECRET: setup.clientSecret,
        GITHUB_APP_PRIVATE_KEY: setup.privateKey,
        GITHUB_APP_SLUG: setup.slug,
        GITHUB_APP_WEBHOOK_SECRET: setup.webhookSecret,
      },
      githubFetch: f.fetcher,
    });
    const target = {
      projectId: owner.projectId,
      baseUrl: 'https://github.com',
      repositoryId: 987,
      repositoryPath: 'owner/project',
    };
    expect(await services?.connections.accessOf(editor.userId, target)).toBeUndefined();
    expect(
      await services?.connections.accessOf(owner.userId, { ...target, repositoryId: 999 }),
    ).toBeUndefined();
    expect(f.state.tokenRequests).toBe(0);
    await test.db.admin
      .updateTable('project_members')
      .set({ can_approve_git: true })
      .where('project_id', '=', owner.projectId)
      .where('user_id', '=', editor.userId)
      .execute();
    expect(await services?.connections.accessOf(editor.userId, target)).toMatchObject({
      token: 'fixture-installation-token',
    });
    await test.db.admin
      .updateTable('project_members')
      .set({ role: 'viewer', can_approve_git: false })
      .where('project_id', '=', owner.projectId)
      .where('user_id', '=', editor.userId)
      .execute();
    expect(await services?.connections.accessOf(editor.userId, target)).toBeUndefined();
    expect(() =>
      services?.writers({ ...target, baseUrl: 'https://evil.example' }, 'never-send'),
    ).toThrow('outside the configured provider');
  });
});

describe('GitHub through the shared approval and synchronization flows', () => {
  it('turns plan tasks into issues only after explicit approval, then reads their native task state', async () => {
    const f = fixture();
    const owner = await f.project();
    await f.connect(owner.cookie);
    await f.connections.connect(owner.projectId, owner.userId, 45, 987);
    await test.collab.changePlan(owner.projectId, (doc) => {
      writePlanSection(doc, 'scope', planNodesFromMarkdown('Ship the product.'), 'en');
      writePlanSection(
        doc,
        'milestones',
        planNodesFromMarkdown('### Milestone 1: Launch\n\nShip it.\n\n- Deploy the app'),
        'en',
      );
      ensureTaskIds(doc);
    });
    const path = `/api/projects/${owner.projectId}/git`;
    const planResponse = await f.ask(`${path}/issues`, owner.cookie);
    expect(planResponse.status).toBe(200);
    const plan = (await planResponse.json()) as GitIssuePlan;
    const taskIds = plan.milestones.flatMap((milestone) => milestone.tasks.map((task) => task.id));
    expect(taskIds).toHaveLength(1);
    const proposed = await f.ask(`${path}/issues`, owner.cookie, json('POST', { taskIds }));
    expect(proposed.status).toBe(201);
    const { requestId } = (await proposed.json()) as GitRequestCreated;
    const deps = {
      admin: test.db.admin,
      accessOf: f.services.connections.accessOf,
      writers: f.services.writers,
    };
    expect(await runGitRequest(deps, { requestId })).toBe('gone');
    expect(f.issues).toHaveLength(0);
    const row = await test.db.admin
      .selectFrom('git_requests')
      .select('provider')
      .where('id', '=', requestId)
      .executeTakeFirstOrThrow();
    expect(row.provider).toBe('github');
    const approved = await f.ask(
      `${path}/requests/approve`,
      owner.cookie,
      json('POST', { requestIds: [requestId] }),
    );
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual({ approved: 1 });
    expect(await runGitRequest(deps, { requestId })).toBe('done');
    expect(f.issues).toHaveLength(1);
    expect(f.issues[0]?.body).toContain('covibes-action:');
    expect(f.issues[0]?.body).toContain(
      'https://github.com/owner/project/blob/main/context/feature-specs/',
    );
    expect(await runGitRequest(deps, { requestId })).toBe('gone');
    expect(f.issues).toHaveLength(1);
    expect(
      await runGitSync(
        {
          admin: test.db.admin,
          client: f.services.client,
          operations: f.services.operations,
          connections: f.services.connections,
        },
        { projectId: owner.projectId },
      ),
    ).toBe('done');
    expect(
      await test.db.admin
        .selectFrom('git_issue_states')
        .select(['number', 'state'])
        .where('project_id', '=', owner.projectId)
        .execute(),
    ).toEqual([{ number: '1', state: 'closed' }]);
  });
});

describe('GitHub signed webhooks', () => {
  const signature = (body: string) =>
    `sha256=${createHmac('sha256', setup.webhookSecret).update(body).digest('hex')}`;
  it('verifies raw bytes, rejects missing or tampered signatures and ignores unsupported signed events', async () => {
    const f = fixture();
    const body = JSON.stringify({ installation: { id: 45 }, repository: { id: 987 } });
    const headers = {
      'x-github-delivery': randomUUID(),
      'x-github-event': 'issues',
      'content-type': 'application/json',
    };
    expect(validGithubSignature(setup.webhookSecret, Buffer.from(body), signature(body))).toBe(
      true,
    );
    expect(
      validGithubSignature(setup.webhookSecret, Buffer.from(`${body} `), signature(body)),
    ).toBe(false);
    expect(
      (await f.app.request('/api/github/webhook', { method: 'POST', headers, body })).status,
    ).toBe(404);
    expect(
      (
        await f.app.request('/api/github/webhook', {
          method: 'POST',
          headers: { ...headers, 'x-hub-signature-256': signature(`${body} `) },
          body,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await f.app.request('/api/github/webhook', {
          method: 'POST',
          headers: { ...headers, 'x-hub-signature-256': signature(body), 'x-github-event': 'ping' },
          body,
        })
      ).status,
    ).toBe(204);
    const oversized = 'x'.repeat(64 * 1024 + 1);
    expect(
      (
        await f.app.request('/api/github/webhook', {
          method: 'POST',
          headers: { ...headers, 'x-hub-signature-256': signature(oversized) },
          body: oversized,
        })
      ).status,
    ).toBe(413);
  });

  it('deduplicates deliveries transactionally and invalidates only matching installations and repositories', async () => {
    const f = fixture();
    const owner = await f.project();
    await f.connect(owner.cookie);
    await f.connections.connect(owner.projectId, owner.userId, 45, 987);
    const send = (event: string, value: unknown, delivery = randomUUID()) => {
      const body = JSON.stringify(value);
      return f.app.request('/api/github/webhook', {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'x-github-delivery': delivery,
          'x-github-event': event,
          'x-hub-signature-256': signature(body),
        },
      });
    };
    const delivery = randomUUID();
    const payload = { installation: { id: 45 }, repository: { id: 987 }, action: 'closed' };
    expect((await send('issues', payload, delivery)).status).toBe(204);
    expect((await send('issues', payload, delivery)).status).toBe(204);
    expect(
      await test.db.admin
        .selectFrom('github_webhook_deliveries')
        .selectAll()
        .where('delivery_id', '=', delivery)
        .execute(),
    ).toHaveLength(1);
    expect(
      (
        await send('installation_repositories', {
          installation: { id: 999 },
          action: 'removed',
          repositories_removed: [{ id: 987 }],
        })
      ).status,
    ).toBe(204);
    expect(
      await test.db.admin
        .selectFrom('git_connections')
        .select('project_id')
        .where('project_id', '=', owner.projectId)
        .executeTakeFirst(),
    ).toBeDefined();
    expect(
      (
        await send('installation_repositories', {
          installation: { id: 45 },
          action: 'removed',
          repositories_removed: [{ id: 987 }],
        })
      ).status,
    ).toBe(204);
    expect(
      await test.db.admin
        .selectFrom('git_connections')
        .selectAll()
        .where('project_id', '=', owner.projectId)
        .executeTakeFirst(),
    ).toBeUndefined();
  });
});
