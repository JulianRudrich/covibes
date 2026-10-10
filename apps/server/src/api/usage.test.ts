import { randomUUID } from 'node:crypto';

import type { ProjectSummary, UsageState } from '@covibes/shared';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { usageRoutes } from '@server/api/usage';
import { APP_URL, createTestServer } from '@server/testing';
import { usagePeriods } from '@server/usage/limits';

// What members learn of the limits of the AI (spec 31a): whether one is reached and until when,
// and no number.
const test = createTestServer();

const LIMITS = { projectMonthUsd: 100, userDayUsd: 15 };
const NOW = new Date();
const limited = new Hono().route(
  '/api/projects/:projectId/usage',
  usageRoutes(test.db.app, test.auth, LIMITS, () => NOW),
);

const FREE: UsageState = {
  project: { reached: false, resetsAt: null },
  user: { reached: false, resetsAt: null },
};

function request(path: string, cookie: string | null, app: { request: Hono['request'] } = limited) {
  const headers = new Headers({ origin: APP_URL });
  if (cookie) headers.set('cookie', cookie);
  return app.request(path, { headers });
}

async function userIdOf(cookie: string) {
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  return session.user.id;
}

async function createProject() {
  const owner = await test.signIn();
  const created = await test.app.request('/api/projects', {
    method: 'POST',
    headers: { cookie: owner, origin: APP_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Vereins-App' }),
  });
  const projectId = ((await created.json()) as ProjectSummary).id;
  return { owner, projectId, state: `/api/projects/${projectId}/usage/state` };
}

async function member(projectId: string, role: 'editor' | 'viewer') {
  const cookie = await test.signIn();
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, await userIdOf(cookie), role],
  );
  return cookie;
}

/** A run of the project that cost something, for a person or for nobody. */
async function spend(projectId: string, userId: string | null, cost: number) {
  await test.db.adminPool.query(
    `insert into ai_runs (project_id, agent_key, kind, status, user_id, model, cost_usd)
     values ($1, 'moderator', 'reply', 'done', $2, 'claude-opus-5-5', $3)`,
    [projectId, userId, cost],
  );
}

async function stateOf(path: string, cookie: string) {
  const response = await request(path, cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as UsageState;
}

describe('GET /api/projects/:projectId/usage/state', () => {
  it('says that nothing is reached in a project that used little', async () => {
    const project = await createProject();
    await spend(project.projectId, await userIdOf(project.owner), 1.5);

    expect(await stateOf(project.state, project.owner)).toEqual(FREE);
  });

  it('says to every member that the project’s month is used up, and until when', async () => {
    const project = await createProject();
    const viewer = await member(project.projectId, 'viewer');
    // The runs of a project add up, whoever caused them.
    await spend(project.projectId, null, 60);
    await spend(project.projectId, null, 40);

    const state = await stateOf(project.state, viewer);

    expect(state).toEqual({
      project: { reached: true, resetsAt: usagePeriods(NOW).monthEnds.toISOString() },
      user: { reached: false, resetsAt: null },
    });
    expect(await stateOf(project.state, project.owner)).toEqual(state);
  });

  it('says to a person that their own day is used up, and to nobody else', async () => {
    const project = await createProject();
    const elsewhere = await createProject();
    const editor = await member(project.projectId, 'editor');
    const editorId = await userIdOf(editor);
    await test.db.adminPool.query(
      'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
      [elsewhere.projectId, editorId, 'editor'],
    );
    // The day of a person counts across their projects.
    await spend(project.projectId, editorId, 7);
    await spend(elsewhere.projectId, editorId, 8);

    expect(await stateOf(project.state, editor)).toEqual({
      project: { reached: false, resetsAt: null },
      user: { reached: true, resetsAt: usagePeriods(NOW).dayEnds.toISOString() },
    });
    expect(await stateOf(project.state, project.owner)).toEqual(FREE);
  });

  it('tells no number, to nobody', async () => {
    const project = await createProject();
    await spend(project.projectId, await userIdOf(project.owner), 12.34);

    const answer = await (await request(project.state, project.owner)).text();

    expect(answer).not.toMatch(/12\.34|100|15[^:]/);
    expect(Object.keys(JSON.parse(answer) as object).sort()).toEqual(['project', 'user']);
  });

  it('is there for members only', async () => {
    const project = await createProject();
    const stranger = await test.signIn();

    expect((await request(project.state, null)).status).toBe(401);
    expect((await request(project.state, stranger)).status).toBe(404);
    expect((await request(`/api/projects/${randomUUID()}/usage/state`, project.owner)).status).toBe(
      404,
    );
    expect((await request('/api/projects/nope/usage/state', project.owner)).status).toBe(404);
  });

  it('is served by the app with the limits of its environment', async () => {
    const project = await createProject();

    const response = await request(project.state, project.owner, test.app);

    expect(response.status).toBe(200);
    expect((await response.json()) as UsageState).toEqual(FREE);
  });
});
