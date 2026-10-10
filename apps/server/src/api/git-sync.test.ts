import { randomUUID } from 'node:crypto';

import {
  ensureTaskIds,
  planNodesFromMarkdown,
  writePlanSection,
  type ApiErrorBody,
  type CreatedShareLink,
  type GitConnectStart,
  type GitIssuePlan,
  type GitRequestCreated,
  type GitState,
  type GitSyncRequested,
  type GitWebhook,
  type ProjectSummary,
  type Roadmap,
  type RoadmapPlace,
  type SharedBoard,
} from '@covibes/shared';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { GIT_WEBHOOK_PATH, gitWebhook } from '@server/api/git-sync';
import { createGitlabClient, GitlabError } from '@server/integrations/gitlab/client';
import { createGitConnections } from '@server/integrations/gitlab/connections';
import { sealToken } from '@server/integrations/gitlab/crypto';
import { gitlabSetup } from '@server/integrations/gitlab/setup';
import { gitlabWriter } from '@server/integrations/gitlab/writer';
import { createRateLimiter } from '@server/rate-limit';
import { runGitRequest } from '@server/tasks/git-request';
import { runGitSync } from '@server/tasks/git-sync';
import { APP_URL, createTestServer } from '@server/testing';

// The status of tasks from the repository (spec 30a): issues are created in the stand-in, closed
// there, and read again by the worker's job, which is run by hand.
const test = createTestServer();

function request(path: string, cookie: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  headers.set('origin', APP_URL);
  return test.app.request(path, { ...init, headers });
}

const post = (path: string, cookie: string | null, body?: unknown) =>
  request(path, cookie, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function errorCode(response: Response) {
  return ((await response.json()) as ApiErrorBody).error.code;
}

async function userIdOf(cookie: string) {
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  return session.user.id;
}

const MILESTONES = [
  '### Meilenstein 1: Grundgerüst (2 Wochen)',
  '- Projekt aufsetzen\n- Login per Link',
  '### Meilenstein 2: Mitglieder',
  '- Mitgliederliste',
].join('\n\n');

async function member(projectId: string, role: 'owner' | 'editor' | 'viewer') {
  const cookie = await test.signIn();
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, await userIdOf(cookie), role],
  );
  return cookie;
}

/** A project with a plan, whose owner has an account and picked a repository. */
async function createProject({ repositoryId = 101 }: { repositoryId?: number | null } = {}) {
  const owner = await test.signIn();
  const created = await post('/api/projects', owner, { name: 'Vereins-App' });
  const projectId = ((await created.json()) as ProjectSummary).id;
  await test.collab.changePlan(projectId, (doc) => {
    writePlanSection(doc, 'milestones', planNodesFromMarkdown(MILESTONES), 'de');
    ensureTaskIds(doc);
  });
  const git = `/api/projects/${projectId}/git`;
  const started = await post('/api/git/account/connect', owner, { origin: 'account' });
  const { url } = (await started.json()) as GitConnectStart;
  const allow = /class="allow" href="([^"]+)"/.exec(await (await test.app.request(url)).text());
  expect((await request((allow?.[1] ?? '').replaceAll('&amp;', '&'), owner)).status).toBe(302);
  if (repositoryId !== null) await pick(git, owner, repositoryId);
  return { owner, projectId, git };
}

async function pick(git: string, cookie: string, repositoryId: number) {
  const picked = await request(`${git}/repository`, cookie, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repositoryId }),
  });
  expect(picked.status).toBe(204);
}

function gitlab() {
  const setup = gitlabSetup(test.env);
  if (!setup) throw new Error('The test server has no GitLab');
  const client = createGitlabClient((input, init) =>
    Promise.resolve(test.app.request(input instanceof Request ? input.url : String(input), init)),
  );
  return { client, connections: createGitConnections({ admin: test.db.admin, client, setup }) };
}

/** Creates the issues of all tasks of the plan: the request, and the worker's job by hand. */
async function createIssues(project: { owner: string; git: string }) {
  const plan = (await (
    await request(`${project.git}/issues`, project.owner)
  ).json()) as GitIssuePlan;
  const taskIds = plan.milestones.flatMap((milestone) => milestone.tasks.map((task) => task.id));
  const asked = await post(`${project.git}/issues`, project.owner, { taskIds });
  expect(asked.status).toBe(201);
  const { requestId } = (await asked.json()) as GitRequestCreated;
  const approved = await post(`${project.git}/requests/approve`, project.owner, {
    requestIds: [requestId],
  });
  expect(approved.status).toBe(200);
  const { client, connections } = gitlab();
  const outcome = await runGitRequest(
    {
      admin: test.db.admin,
      accessOf: connections.accessOf,
      writers: (target, token) => gitlabWriter(client, target, token),
    },
    { requestId },
  );
  expect(outcome).toBe('done');
}

/** The worker's job that reads the repository's state, with the stand-in inside the app. */
function sync(projectId: string, client = gitlab().client) {
  return runGitSync(
    { admin: test.db.admin, client, connections: gitlab().connections },
    { projectId },
  );
}

async function roadmapOf(project: { owner: string; projectId: string }, cookie = project.owner) {
  const response = await request(`/api/projects/${project.projectId}/roadmap`, cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as Roadmap;
}

const tasksOf = (roadmap: Roadmap) => roadmap.milestones.flatMap((milestone) => milestone.tasks);

async function stateOf(project: { owner: string; git: string }) {
  const response = await request(project.git, project.owner);
  expect(response.status).toBe(200);
  return (await response.json()) as GitState;
}

/** Someone closes the issue in GitLab, or opens it again: the button of the stand-in's page. */
async function toggle(issueUrl: string) {
  const changed = await test.app.request(`${new URL(issueUrl).pathname}/state`, {
    method: 'POST',
  });
  expect(changed.status).toBe(303);
}

async function jobsOf(projectId: string) {
  const { rows } = await test.db.adminPool.query<{ key: string }>(
    `select j.key from graphile_worker._private_jobs j
     join graphile_worker._private_tasks t on t.id = j.task_id
     where t.identifier = 'git_sync' and j.key = $1`,
    [`git_sync:${projectId}`],
  );
  return rows.length;
}

describe('the status of tasks from the repository', () => {
  it('names the issue of a task on the roadmap, open at first', async () => {
    const project = await createProject();
    expect(tasksOf(await roadmapOf(project)).every((task) => !task.issue)).toBe(true);

    await createIssues(project);

    const tasks = tasksOf(await roadmapOf(project));
    expect(tasks.map((task) => task.text)).toEqual([
      'Projekt aufsetzen',
      'Login per Link',
      'Mitgliederliste',
    ]);
    for (const task of tasks) {
      expect(task.issue).toMatchObject({ closed: false });
      expect(task.issue?.url).toContain(`/-/issues/${String(task.issue?.number)}`);
    }
    // A new issue is open; its state is known before anything was read.
    expect((await stateOf(project)).sync).toBeNull();
    const states = await test.db.admin
      .selectFrom('git_issue_states')
      .select(['number', 'state'])
      .where('project_id', '=', project.projectId)
      .execute();
    expect(states.map((entry) => entry.state)).toEqual(['opened', 'opened', 'opened']);
    expect(states.map((entry) => Number(entry.number)).sort()).toEqual(
      tasks.map((task) => task.issue?.number).sort(),
    );
  });

  it('follows an issue that was closed in GitLab, and one that was opened again', async () => {
    const project = await createProject();
    const viewer = await member(project.projectId, 'viewer');
    await createIssues(project);
    const [first, second] = tasksOf(await roadmapOf(project));
    await toggle(first?.issue?.url ?? '');

    expect(await sync(project.projectId)).toBe('done');

    // Viewers see the status too.
    const tasks = tasksOf(await roadmapOf(project, viewer));
    expect(tasks.map((task) => task.issue?.closed)).toEqual([true, false, false]);
    const state = await stateOf(project);
    expect(state.sync?.failed).toBe(false);
    expect(Date.parse(state.sync?.syncedAt ?? '')).toBeGreaterThan(Date.now() - 60_000);
    // The dialog for issues says it as well.
    const plan = (await (
      await request(`${project.git}/issues`, project.owner)
    ).json()) as GitIssuePlan;
    expect(plan.milestones[0]?.tasks.map((task) => task.issue?.closed)).toEqual([true, false]);

    await toggle(first?.issue?.url ?? '');
    await toggle(second?.issue?.url ?? '');
    await sync(project.projectId);

    expect(tasksOf(await roadmapOf(project)).map((task) => task.issue?.closed)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('keeps what it knew when GitLab does not answer, and says that reading failed', async () => {
    const project = await createProject();
    await createIssues(project);
    const [first] = tasksOf(await roadmapOf(project));
    await toggle(first?.issue?.url ?? '');
    await sync(project.projectId);
    const before = (await stateOf(project)).sync;

    const outcome = await sync(project.projectId, {
      ...gitlab().client,
      get: () => Promise.reject(new GitlabError(503, 'GitLab is away')),
    });

    expect(outcome).toBe('failed');
    expect((await stateOf(project)).sync).toEqual({ syncedAt: before?.syncedAt, failed: true });
    expect(tasksOf(await roadmapOf(project)).map((task) => task.issue?.closed)).toEqual([
      true,
      false,
      false,
    ]);

    // The next reading that works clears the failure.
    expect(await sync(project.projectId)).toBe('done');
    expect((await stateOf(project)).sync?.failed).toBe(false);
  });

  it('reads nothing for a project without issues of its own, and counts as read', async () => {
    const project = await createProject();
    let calls = 0;

    const outcome = await sync(project.projectId, {
      ...gitlab().client,
      get: () => {
        calls += 1;
        return Promise.resolve([]);
      },
    });

    expect(outcome).toBe('done');
    expect(calls).toBe(0);
    expect((await stateOf(project)).sync?.failed).toBe(false);
  });

  it('does not count the issues of a repository the project had before', async () => {
    const project = await createProject();
    await createIssues(project);
    await sync(project.projectId);
    expect((await stateOf(project)).sync).not.toBeNull();

    await pick(project.git, project.owner, 103);

    expect(tasksOf(await roadmapOf(project)).every((task) => !task.issue)).toBe(true);
    // Nothing was read for the new repository yet.
    expect((await stateOf(project)).sync).toBeNull();
  });

  it('shows none of it through the read-only link', async () => {
    const project = await createProject();
    await createIssues(project);
    const [first] = tasksOf(await roadmapOf(project));
    await toggle(first?.issue?.url ?? '');
    await sync(project.projectId);
    const opened = await post(`/api/projects/${project.projectId}/roadmap/open`, project.owner);
    const { boardId } = (await opened.json()) as RoadmapPlace;
    const link = await post(`/api/projects/${project.projectId}/share-link`, project.owner);
    const token = ((await link.json()) as CreatedShareLink).url.split('/share/')[1] ?? '';

    const shared = await post('/api/share/board', null, { token, boardId });

    expect(shared.status).toBe(200);
    const board = (await shared.json()) as SharedBoard;
    expect(board.roadmap?.milestones.flatMap((milestone) => milestone.tasks)).toHaveLength(3);
    for (const task of board.roadmap?.milestones.flatMap((milestone) => milestone.tasks) ?? []) {
      expect(task).not.toHaveProperty('issue');
    }
    expect(JSON.stringify(board)).not.toContain('/-/issues/');
  });

  it('has nothing to do for a project without a repository', async () => {
    const project = await createProject({ repositoryId: null });

    expect(await sync(project.projectId)).toBe('gone');
    expect(await sync(randomUUID())).toBe('gone');
    expect((await stateOf(project)).sync).toBeNull();
  });
});

describe('POST /api/projects/:projectId/git/sync', () => {
  it('queues a reading for members, and not again a moment later', async () => {
    const project = await createProject();
    const viewer = await member(project.projectId, 'viewer');

    const first = await post(`${project.git}/sync`, viewer, {});
    const second = await post(`${project.git}/sync`, project.owner);

    expect(first.status).toBe(200);
    expect((await first.json()) as GitSyncRequested).toEqual({ queued: true });
    expect((await second.json()) as GitSyncRequested).toEqual({ queued: false });
    expect(await jobsOf(project.projectId)).toBe(1);
  });

  it('queues nothing without a repository', async () => {
    const project = await createProject({ repositoryId: null });

    const asked = await post(`${project.git}/sync`, project.owner, { force: true });

    expect((await asked.json()) as GitSyncRequested).toEqual({ queued: false });
    expect(await jobsOf(project.projectId)).toBe(0);
  });

  it('refuses strangers, visitors and anything but its own fields', async () => {
    const project = await createProject();
    const stranger = await test.signIn();

    expect((await post(`${project.git}/sync`, null, {})).status).toBe(401);
    const unknown = await post(`${project.git}/sync`, stranger, {});
    expect(unknown.status).toBe(404);
    expect(await errorCode(unknown)).toBe('not_found');
    const invalid = await post(`${project.git}/sync`, project.owner, { force: 'yes' });
    expect(invalid.status).toBe(400);
    expect(await jobsOf(project.projectId)).toBe(0);
  });
});

describe('the webhook of a project', () => {
  const call = (projectId: string, secret?: string) =>
    test.app.request(`${GIT_WEBHOOK_PATH}/${projectId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret === undefined ? {} : { 'x-gitlab-token': secret }),
      },
      body: JSON.stringify({ object_kind: 'issue' }),
    });

  async function webhookOf(project: { owner: string; git: string }) {
    const response = await request(`${project.git}/webhook`, project.owner);
    expect(response.status).toBe(200);
    return (await response.json()) as GitWebhook;
  }

  it('gives owners an address and a secret that stays, sealed in the database', async () => {
    const project = await createProject();
    const editor = await member(project.projectId, 'editor');
    const stranger = await test.signIn();

    const webhook = await webhookOf(project);

    expect(webhook.url).toBe(`${APP_URL}${GIT_WEBHOOK_PATH}/${project.projectId}`);
    expect(webhook.secret.length).toBeGreaterThanOrEqual(32);
    expect(await webhookOf(project)).toEqual(webhook);
    const stored = await test.db.admin
      .selectFrom('git_webhooks')
      .select('secret')
      .where('project_id', '=', project.projectId)
      .executeTakeFirstOrThrow();
    expect(stored.secret).toMatch(/^v1\./);
    expect(stored.secret).not.toContain(webhook.secret);

    expect((await request(`${project.git}/webhook`, editor)).status).toBe(403);
    expect((await post(`${project.git}/webhook/renew`, editor)).status).toBe(403);
    expect((await request(`${project.git}/webhook`, stranger)).status).toBe(404);
    expect((await request(`${project.git}/webhook`, null)).status).toBe(401);
  });

  it('queues a reading for a call with the secret, whatever the call says', async () => {
    const project = await createProject();
    const { secret } = await webhookOf(project);

    const called = await call(project.projectId, secret);

    expect(called.status).toBe(204);
    expect(await jobsOf(project.projectId)).toBe(1);
    // GitLab sends a burst of events; they become one reading.
    expect((await call(project.projectId, secret)).status).toBe(204);
    expect(await jobsOf(project.projectId)).toBe(1);
  });

  it('tells nothing to a call without the secret', async () => {
    const project = await createProject();
    const other = await createProject();
    const { secret } = await webhookOf(project);
    const { secret: foreign } = await webhookOf(other);

    const answers = await Promise.all([
      call(project.projectId),
      call(project.projectId, 'wrong'),
      call(project.projectId, foreign),
      call(randomUUID(), secret),
      call('no-project', secret),
    ]);

    for (const answer of answers) {
      expect(answer.status).toBe(404);
      expect(await errorCode(answer)).toBe('not_found');
    }
    expect(await jobsOf(project.projectId)).toBe(0);
  });

  it('stops taking the old secret once an owner renewed it', async () => {
    const project = await createProject();
    const { secret } = await webhookOf(project);

    const renewed = await post(`${project.git}/webhook/renew`, project.owner);

    expect(renewed.status).toBe(200);
    const webhook = (await renewed.json()) as GitWebhook;
    expect(webhook.secret).not.toBe(secret);
    expect(await webhookOf(project)).toEqual(webhook);
    expect((await call(project.projectId, secret)).status).toBe(404);
    expect((await call(project.projectId, webhook.secret)).status).toBe(204);
  });

  it('replaces a secret that the server can no longer open', async () => {
    const project = await createProject();
    const { secret } = await webhookOf(project);
    // Sealed with a key the server does not have any more.
    await test.db.admin
      .updateTable('git_webhooks')
      .set({ secret: sealToken('another-key-than-the-one-of-the-server', secret) })
      .where('project_id', '=', project.projectId)
      .execute();

    // Such a secret matches no call, and the answer tells nothing.
    const called = await call(project.projectId, secret);
    expect(called.status).toBe(404);

    const renewed = await webhookOf(project);
    expect(renewed.secret).not.toBe(secret);
    expect((await call(project.projectId, renewed.secret)).status).toBe(204);
  });

  it('takes only so many calls per project and minute', async () => {
    const project = await createProject();
    const { secret } = await webhookOf(project);
    const routes = new Hono().route(
      GIT_WEBHOOK_PATH,
      gitWebhook(
        test.db.admin,
        test.env.TOKEN_KEY,
        createRateLimiter({ limit: 2, windowMs: 60_000 }),
      ),
    );
    const ask = () =>
      routes.request(`${GIT_WEBHOOK_PATH}/${project.projectId}`, {
        method: 'POST',
        headers: { 'x-gitlab-token': secret },
      });

    expect((await ask()).status).toBe(204);
    expect((await ask()).status).toBe(204);
    const third = await ask();
    expect(third.status).toBe(429);
  });

  it('does not exist on a server that is not set up for GitLab', async () => {
    const project = await createProject();
    const { secret } = await webhookOf(project);
    const bare = new Hono().route(
      GIT_WEBHOOK_PATH,
      gitWebhook(test.db.admin, undefined, createRateLimiter({ limit: 5, windowMs: 60_000 })),
    );

    const called = await bare.request(`${GIT_WEBHOOK_PATH}/${project.projectId}`, {
      method: 'POST',
      headers: { 'x-gitlab-token': secret },
    });

    expect(called.status).toBe(404);
  });
});
