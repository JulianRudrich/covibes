import { randomUUID } from 'node:crypto';

import type { ProjectSummary, UsageOverview, UsageState } from '@covibes/shared';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { usageRoutes } from '@server/api/usage';
import { APP_URL, createTestServer } from '@server/testing';
import { usagePeriods } from '@server/usage/limits';

// What members learn of the limits of the AI (spec 31a): whether one is reached and until when,
// and no number. And what owners read of the usage (spec 31b): the numbers of a month.
const test = createTestServer({ AI_LIMIT_INSTANCE_MONTH_USD: '0' });

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
  return {
    owner,
    projectId,
    state: `/api/projects/${projectId}/usage/state`,
    overview: `/api/projects/${projectId}/usage`,
  };
}

/** Gives a person a name, as they would in their profile. */
async function named(cookie: string, name: string) {
  const id = await userIdOf(cookie);
  await test.db.adminPool.query('update users set name = $1 where id = $2', [name, id]);
  return id;
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
    expect((await response.json()) as UsageState).toEqual({
      ...FREE,
      instance: { reached: false, resetsAt: null },
    });
  });
});

/** A run that ended, of an agent, with its tokens and costs, for a person or for nobody. */
async function run(
  projectId: string,
  of: { agent: string; userId: string | null; cost: number; input?: number; output?: number },
) {
  await test.db.adminPool.query(
    `insert into ai_runs
       (project_id, agent_key, kind, status, user_id, model, cost_usd, input_tokens, output_tokens)
     values ($1, $2, 'reply', 'done', $3, 'claude-opus-5-5', $4, $5, $6)`,
    [projectId, of.agent, of.userId, of.cost, of.input ?? 0, of.output ?? 0],
  );
}

/** Usage of a day that is over, as the runs of that day left it. */
async function used(
  projectId: string,
  of: { day: string; agent: string; userId: string | null; cost: number; runs: number },
) {
  await test.db.adminPool.query(
    `insert into usage (day, project_id, user_id, agent_key, kind, model, runs, cost_usd)
     values ($1::date, $2, $3, $4, 'reply', 'claude-opus-5-5', $5, $6)`,
    [of.day, projectId, of.userId, of.agent, of.runs, of.cost],
  );
}

async function overviewOf(path: string, cookie: string) {
  const response = await request(path, cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as UsageOverview;
}

const TODAY = usagePeriods(NOW).day;
const MONTH = TODAY.slice(0, 7);
/** The month before the running one, and how many days it had. */
const BEFORE = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - 1, 1))
  .toISOString()
  .slice(0, 7);
const DAYS_BEFORE = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 0)).getUTCDate();

describe('GET /api/projects/:projectId/usage', () => {
  it('gives an owner the running month: the total, the limits and when it ends', async () => {
    const project = await createProject();
    const ownerId = await named(project.owner, 'Olga');
    await run(project.projectId, {
      agent: 'moderator',
      userId: ownerId,
      cost: 1.5,
      input: 1200,
      output: 300,
    });
    await run(project.projectId, {
      agent: 'backend',
      userId: ownerId,
      cost: 0.25,
      input: 800,
      output: 100,
    });

    const overview = await overviewOf(project.overview, project.owner);

    expect(overview).toMatchObject({
      month: MONTH,
      current: true,
      limits: LIMITS,
      endsAt: usagePeriods(NOW).monthEnds.toISOString(),
      total: { costUsd: 1.75, runs: 2, inputTokens: 2000, outputTokens: 400 },
    });
  });

  it('says which agents the costs come from, the largest first', async () => {
    const project = await createProject();
    const ownerId = await named(project.owner, 'Olga');
    await run(project.projectId, { agent: 'backend', userId: ownerId, cost: 0.1, input: 10 });
    await run(project.projectId, { agent: 'moderator', userId: ownerId, cost: 0.2, input: 20 });
    await run(project.projectId, { agent: 'moderator', userId: null, cost: 0.4, output: 5 });
    await run(project.projectId, { agent: 'security', userId: ownerId, cost: 0.3 });

    const { byAgent } = await overviewOf(project.overview, project.owner);

    expect(byAgent).toEqual([
      { agentKey: 'moderator', costUsd: 0.6, runs: 2, inputTokens: 20, outputTokens: 5 },
      { agentKey: 'security', costUsd: 0.3, runs: 1, inputTokens: 0, outputTokens: 0 },
      { agentKey: 'backend', costUsd: 0.1, runs: 1, inputTokens: 10, outputTokens: 0 },
    ]);
  });

  it('says who the costs are for: members by name, and what ran by itself', async () => {
    const project = await createProject();
    const ownerId = await named(project.owner, 'Olga');
    const editorId = await named(await member(project.projectId, 'editor'), 'Emil');
    await run(project.projectId, { agent: 'moderator', userId: ownerId, cost: 1 });
    await run(project.projectId, { agent: 'moderator', userId: editorId, cost: 2 });
    await run(project.projectId, { agent: 'backend', userId: editorId, cost: 0.5 });
    // The observer and an automatic review are nobody's runs.
    await run(project.projectId, { agent: 'moderator', userId: null, cost: 0.75 });

    const { bySource } = await overviewOf(project.overview, project.owner);

    expect(bySource).toEqual([
      {
        kind: 'member',
        userId: editorId,
        name: 'Emil',
        costUsd: 2.5,
        runs: 2,
        inputTokens: 0,
        outputTokens: 0,
      },
      {
        kind: 'member',
        userId: ownerId,
        name: 'Olga',
        costUsd: 1,
        runs: 1,
        inputTokens: 0,
        outputTokens: 0,
      },
      { kind: 'nobody', costUsd: 0.75, runs: 1, inputTokens: 0, outputTokens: 0 },
    ]);
  });

  it('lists everyone who left the project together, without a name', async () => {
    const project = await createProject();
    const emil = await named(await member(project.projectId, 'editor'), 'Emil');
    const vera = await named(await member(project.projectId, 'viewer'), 'Vera');
    await run(project.projectId, { agent: 'moderator', userId: emil, cost: 2 });
    await run(project.projectId, { agent: 'moderator', userId: vera, cost: 3 });
    await test.db.adminPool.query(
      'delete from project_members where project_id = $1 and user_id = any($2)',
      [project.projectId, [emil, vera]],
    );

    const answer = await (await request(project.overview, project.owner)).text();

    expect((JSON.parse(answer) as UsageOverview).bySource).toEqual([
      { kind: 'left', costUsd: 5, runs: 2, inputTokens: 0, outputTokens: 0 },
    ]);
    expect(answer).not.toMatch(/Emil|Vera/);
    expect(answer).not.toContain(emil);
    expect(answer).not.toContain(vera);
  });

  it('counts what was used in this project only', async () => {
    const project = await createProject();
    const elsewhere = await createProject();
    const ownerId = await userIdOf(project.owner);
    await test.db.adminPool.query(
      'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
      [elsewhere.projectId, ownerId, 'editor'],
    );
    await run(project.projectId, { agent: 'moderator', userId: ownerId, cost: 1 });
    // The same person in another project: it counts toward their day, but it is not shown here.
    await run(elsewhere.projectId, { agent: 'moderator', userId: ownerId, cost: 8 });

    const overview = await overviewOf(project.overview, project.owner);

    expect(overview.total.costUsd).toBe(1);
    expect(overview.bySource.map((source) => source.costUsd)).toEqual([1]);
    expect(overview.byAgent.map((agent) => agent.costUsd)).toEqual([1]);
  });

  it('lists every day of the running month up to today, also the days without usage', async () => {
    const project = await createProject();
    await run(project.projectId, { agent: 'moderator', userId: null, cost: 0.5 });
    await run(project.projectId, { agent: 'backend', userId: null, cost: 0.25 });

    const { byDay } = await overviewOf(project.overview, project.owner);

    expect(byDay.map((entry) => entry.day)).toEqual(
      Array.from(
        { length: NOW.getUTCDate() },
        (_, index) => `${MONTH}-${String(index + 1).padStart(2, '0')}`,
      ),
    );
    expect(byDay.at(-1)).toEqual({ day: TODAY, costUsd: 0.75, runs: 2 });
    expect(byDay.slice(0, -1).every((entry) => entry.costUsd === 0 && entry.runs === 0)).toBe(true);
  });

  it('shows the month before as a whole, and nothing of the running one in it', async () => {
    const project = await createProject();
    const ownerId = await named(project.owner, 'Olga');
    await used(project.projectId, {
      day: `${BEFORE}-01`,
      agent: 'moderator',
      userId: ownerId,
      cost: 4,
      runs: 3,
    });
    await used(project.projectId, {
      day: `${BEFORE}-${String(DAYS_BEFORE)}`,
      agent: 'backend',
      userId: null,
      cost: 1.5,
      runs: 1,
    });
    await run(project.projectId, { agent: 'moderator', userId: ownerId, cost: 9 });

    const overview = await overviewOf(`${project.overview}?month=${BEFORE}`, project.owner);

    expect(overview).toMatchObject({
      month: BEFORE,
      current: false,
      endsAt: new Date(`${MONTH}-01T00:00:00.000Z`).toISOString(),
      total: { costUsd: 5.5, runs: 4 },
    });
    expect(overview.byDay).toHaveLength(DAYS_BEFORE);
    expect(overview.byDay[0]).toEqual({ day: `${BEFORE}-01`, costUsd: 4, runs: 3 });
    expect(overview.byDay.at(-1)).toEqual({
      day: `${BEFORE}-${String(DAYS_BEFORE)}`,
      costUsd: 1.5,
      runs: 1,
    });
    // The running month knows nothing of the one before either.
    expect((await overviewOf(project.overview, project.owner)).total.costUsd).toBe(9);
  });

  it('adds up small amounts without the rounding of fractions', async () => {
    const project = await createProject();
    await run(project.projectId, { agent: 'moderator', userId: null, cost: 0.1 });
    await run(project.projectId, { agent: 'moderator', userId: null, cost: 0.2 });
    await run(project.projectId, { agent: 'backend', userId: null, cost: 0.000001 });

    const overview = await overviewOf(project.overview, project.owner);

    expect(overview.total.costUsd).toBe(0.300001);
    expect(overview.byAgent[0]?.costUsd).toBe(0.3);
  });

  it('is an empty month in a project that used nothing', async () => {
    const project = await createProject();

    const overview = await overviewOf(project.overview, project.owner);

    expect(overview.total).toEqual({ costUsd: 0, runs: 0, inputTokens: 0, outputTokens: 0 });
    expect(overview.byAgent).toEqual([]);
    expect(overview.bySource).toEqual([]);
    expect(overview.byDay).toHaveLength(NOW.getUTCDate());
  });

  it('is there for owners only', async () => {
    const project = await createProject();
    const editor = await member(project.projectId, 'editor');
    const viewer = await member(project.projectId, 'viewer');
    const stranger = await test.signIn();
    await run(project.projectId, { agent: 'moderator', userId: null, cost: 12.34 });

    expect((await request(project.overview, null)).status).toBe(401);
    for (const cookie of [editor, viewer]) {
      const response = await request(project.overview, cookie);
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain('12.34');
    }
    expect((await request(project.overview, stranger)).status).toBe(404);
    expect((await request(`/api/projects/${randomUUID()}/usage`, project.owner)).status).toBe(404);
    expect((await request('/api/projects/nope/usage', project.owner)).status).toBe(404);
  });

  it('takes a month that has begun, and nothing else', async () => {
    const project = await createProject();
    const next = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + 1, 1))
      .toISOString()
      .slice(0, 7);

    for (const month of [next, '2026-13', '2026-1', 'oktober', '']) {
      const response = await request(`${project.overview}?month=${month}`, project.owner);
      expect(response.status, month).toBe(400);
    }
    expect((await request(`${project.overview}?month=${MONTH}`, project.owner)).status).toBe(200);
  });

  it('is served by the app with the limits of its environment', async () => {
    const project = await createProject();

    const response = await request(project.overview, project.owner, test.app);

    expect(response.status).toBe(200);
    expect(((await response.json()) as UsageOverview).limits).toEqual({
      projectMonthUsd: test.env.AI_LIMIT_PROJECT_MONTH_USD,
      userDayUsd: test.env.AI_LIMIT_USER_DAY_USD,
    });
  });
});
