import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Usage and limits (spec 31a): the usage follows the runs, a run belongs to who caused it, and
// members read the totals that count toward the limits.
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '3e111111-1111-4111-8111-111111111111';
const EDITOR = '3e222222-2222-4222-8222-222222222222';
const STRANGER = '3e333333-3333-4333-8333-333333333333';

/** Runs `fn` as a user and keeps what it changed. */
async function commitAs<T>(userId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/** A project with an owner and an editor. */
async function newProject() {
  const id = randomUUID();
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Vereins-App', $2)`, [
    id,
    OWNER,
  ]);
  await admin.query(
    `insert into project_members (project_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'editor')`,
    [id, OWNER, EDITOR],
  );
  return id;
}

type RunFields = {
  userId?: string | null;
  agent?: string;
  kind?: string;
  status?: string;
  model?: string | null;
  input?: number;
  output?: number;
  cost?: number;
};

/** The worker stores a run, finished or not. */
async function insertRun(projectId: string, fields: RunFields = {}) {
  const { rows } = await admin.query<{ id: string }>(
    `insert into ai_runs
       (project_id, agent_key, kind, status, user_id, model, input_tokens, output_tokens, cost_usd)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [
      projectId,
      fields.agent ?? 'moderator',
      fields.kind ?? 'reply',
      fields.status ?? 'queued',
      fields.userId ?? null,
      fields.model ?? null,
      fields.input ?? 0,
      fields.output ?? 0,
      fields.cost ?? 0,
    ],
  );
  return rows[0]?.id ?? '';
}

/** The worker writes what a run cost so far, and how it stands. */
const meter = (runId: string, fields: Required<Pick<RunFields, 'status' | 'cost'>> & RunFields) =>
  admin.query(
    `update ai_runs
     set status = $2, cost_usd = $3, input_tokens = $4, output_tokens = $5,
         model = coalesce($6, model)
     where id = $1`,
    [
      runId,
      fields.status,
      fields.cost,
      fields.input ?? 0,
      fields.output ?? 0,
      fields.model ?? null,
    ],
  );

async function usageOf(projectId: string) {
  const { rows } = await admin.query<{
    day: string;
    user_id: string | null;
    agent_key: string;
    kind: string;
    model: string;
    runs: number;
    input_tokens: string;
    output_tokens: string;
    cost_usd: string;
  }>(
    `select day::text, user_id, agent_key, kind, model, runs, input_tokens, output_tokens, cost_usd
     from usage where project_id = $1 order by agent_key, kind, model, user_id nulls first`,
    [projectId],
  );
  return rows;
}

/** What counts toward the limits, as a member reads it. */
const totalsOf = (userId: string, projectId: string) =>
  asUser(app, userId, async (client) => {
    const { rows } = await client.query<{ project_month: string; user_day: string }>(
      'select project_month, user_day from public.usage_totals($1)',
      [projectId],
    );
    return { projectMonth: Number(rows[0]?.project_month), userDay: Number(rows[0]?.user_day) };
  });

const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'usage-owner@example.com', true),
      ($2, 'Eddie Editor', 'usage-editor@example.com', true),
      ($3, 'Sam Stranger', 'usage-stranger@example.com', true)`,
    [OWNER, EDITOR, STRANGER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('the usage of a project', () => {
  it('follows a run: its tokens and costs, by day, person, agent, kind and model', async () => {
    const projectId = await newProject();
    const runId = await insertRun(projectId, { userId: EDITOR });
    // A run that waits has cost nothing yet.
    expect(await usageOf(projectId)).toEqual([]);

    await meter(runId, {
      status: 'done',
      cost: 0.42,
      input: 3000,
      output: 400,
      model: 'claude-opus-5-5',
    });

    expect(await usageOf(projectId)).toEqual([
      {
        day: today(),
        user_id: EDITOR,
        agent_key: 'moderator',
        kind: 'reply',
        model: 'claude-opus-5-5',
        runs: 1,
        input_tokens: '3000',
        output_tokens: '400',
        cost_usd: '0.420000',
      },
    ]);
  });

  it('adds runs of the same kind up, and keeps other agents, kinds and people apart', async () => {
    const projectId = await newProject();
    const done = { status: 'done', model: 'claude-opus-5-5' } as const;
    await meter(await insertRun(projectId, { userId: EDITOR }), { ...done, cost: 0.1, input: 10 });
    await meter(await insertRun(projectId, { userId: EDITOR }), { ...done, cost: 0.2, input: 20 });
    await meter(await insertRun(projectId, { userId: OWNER }), { ...done, cost: 0.4 });
    await meter(await insertRun(projectId, { userId: EDITOR, agent: 'backend' }), {
      ...done,
      cost: 0.8,
    });
    await meter(await insertRun(projectId, { userId: EDITOR, kind: 'plan' }), {
      ...done,
      cost: 1.6,
    });

    expect(
      (await usageOf(projectId)).map((row) => [
        row.agent_key,
        row.kind,
        row.user_id,
        row.runs,
        Number(row.cost_usd),
      ]),
    ).toEqual([
      ['backend', 'reply', EDITOR, 1, 0.8],
      ['moderator', 'plan', EDITOR, 1, 1.6],
      ['moderator', 'reply', OWNER, 1, 0.4],
      ['moderator', 'reply', EDITOR, 2, 0.3],
    ]);
  });

  it('counts a run that is stored finished, like the observer’s, for nobody', async () => {
    const projectId = await newProject();

    await insertRun(projectId, {
      kind: 'observe',
      status: 'done',
      model: 'claude-sonnet-5-5',
      cost: 0.01,
      input: 500,
      output: 20,
    });

    expect(await usageOf(projectId)).toMatchObject([
      { user_id: null, kind: 'observe', runs: 1, input_tokens: '500', cost_usd: '0.010000' },
    ]);
  });

  it('counts nothing twice: only what a run grows by, and a run once it ended', async () => {
    const projectId = await newProject();
    const runId = await insertRun(projectId, { userId: EDITOR, model: 'claude-opus-5-5' });

    // The costs are written while it runs, again when it ends, and once more unchanged.
    await meter(runId, { status: 'running', cost: 0.1, input: 100 });
    await meter(runId, { status: 'done', cost: 0.25, input: 250, output: 40 });
    await meter(runId, { status: 'done', cost: 0.25, input: 250, output: 40 });

    expect(await usageOf(projectId)).toMatchObject([
      { runs: 1, input_tokens: '250', output_tokens: '40', cost_usd: '0.250000' },
    ]);

    // A try that is written again with less takes nothing back: what was spent stays spent.
    await meter(runId, { status: 'running', cost: 0, input: 0 });
    await meter(runId, { status: 'done', cost: 0.05, input: 50 });
    expect(await usageOf(projectId)).toMatchObject([
      { runs: 2, input_tokens: '300', output_tokens: '40', cost_usd: '0.300000' },
    ]);
  });

  it('keeps its usage when the project or a person is deleted', async () => {
    const projectId = await newProject();
    const leaving = randomUUID();
    await admin.query(
      `insert into users (id, name, email, email_verified) values ($1, 'Lea', $2, true)`,
      [leaving, `usage-${leaving}@example.com`],
    );
    const done = { status: 'done', model: 'claude-opus-5-5' } as const;
    await meter(await insertRun(projectId, { userId: leaving }), { ...done, cost: 1 });
    await meter(await insertRun(projectId, { userId: EDITOR }), { ...done, cost: 2 });
    // Something ran by itself too, under the same agent and model.
    await meter(await insertRun(projectId), { ...done, cost: 4 });

    await admin.query('delete from users where id = $1', [leaving]);

    // What the person used is nobody's now; the project's total is what it was.
    expect(
      (await usageOf(projectId)).map((row) => [row.user_id, row.runs, Number(row.cost_usd)]),
    ).toEqual([
      [null, 2, 5],
      [EDITOR, 1, 2],
    ]);

    await admin.query('delete from projects where id = $1', [projectId]);
    // The runs are gone with the project; the usage still counts for its people.
    expect(await usageOf(projectId)).toHaveLength(2);
    const other = await newProject();
    expect((await totalsOf(EDITOR, other)).userDay).toBeGreaterThanOrEqual(2);
  });
});

describe('who a run is for', () => {
  it('is the author of the message that mentions an agent', async () => {
    const projectId = await newProject();

    const messageId = await commitAs(EDITOR, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into messages (project_id, author_kind, author_user_id, content, mentions)
         values ($1, 'human', $2, '@Moderator Was fehlt noch?', '{moderator}') returning id`,
        [projectId, EDITOR],
      );
      return rows[0]?.id ?? '';
    });

    const { rows } = await admin.query<{ user_id: string | null }>(
      'select user_id from ai_runs where trigger_message_id = $1',
      [messageId],
    );
    expect(rows).toEqual([{ user_id: EDITOR }]);
  });

  it('is the person an agent works for when the agent causes the run', async () => {
    const projectId = await newProject();
    // The moderator answers the editor, and its answer is the occasion of another run.
    const first = await insertRun(projectId, { userId: EDITOR });
    const reply = await admin.query<{ id: string }>(
      `insert into messages (project_id, author_kind, author_agent_key, content)
       values ($1, 'agent', 'moderator', 'Ich frage das Backend.') returning id`,
      [projectId],
    );
    const replyId = reply.rows[0]?.id ?? '';
    await admin.query('update ai_runs set reply_message_id = $2 where id = $1', [first, replyId]);

    const next = await admin.query<{ user_id: string | null }>(
      `insert into ai_runs (project_id, agent_key, trigger_message_id)
       values ($1, 'backend', $2) returning user_id`,
      [projectId, replyId],
    );

    expect(next.rows[0]?.user_id).toBe(EDITOR);
  });

  it('is nobody for what runs by itself, and whoever the worker names', async () => {
    const projectId = await newProject();

    const own = await insertRun(projectId, { kind: 'observe' });
    const named = await insertRun(projectId, { kind: 'summary', userId: OWNER });

    const { rows } = await admin.query<{ id: string; user_id: string | null }>(
      'select id, user_id from ai_runs where id = any($1::uuid[])',
      [[own, named]],
    );
    expect(Object.fromEntries(rows.map((row) => [row.id, row.user_id]))).toEqual({
      [own]: null,
      [named]: OWNER,
    });
  });
});

describe('usage_totals', () => {
  it('gives the project’s month and the person’s day across projects', async () => {
    const first = await newProject();
    const second = await newProject();
    const done = { status: 'done', model: 'claude-opus-5-5' } as const;
    const before = await totalsOf(EDITOR, first);
    await meter(await insertRun(first, { userId: EDITOR }), { ...done, cost: 1.5 });
    await meter(await insertRun(first, { userId: OWNER }), { ...done, cost: 2 });
    await meter(await insertRun(first), { ...done, cost: 0.25 });
    await meter(await insertRun(second, { userId: EDITOR }), { ...done, cost: 4 });

    const totals = await totalsOf(EDITOR, first);

    // The project: everything in it, whoever caused it. The person: their own, everywhere.
    expect(totals.projectMonth).toBeCloseTo(3.75, 6);
    expect(totals.userDay - before.userDay).toBeCloseTo(5.5, 6);
    expect((await totalsOf(EDITOR, second)).projectMonth).toBeCloseTo(4, 6);
  });

  it('counts the days of this month for the project, and only today for the person', async () => {
    const projectId = await newProject();
    const person = randomUUID();
    await admin.query(
      `insert into users (id, name, email, email_verified) values ($1, 'Pia', $2, true)`,
      [person, `usage-${person}@example.com`],
    );
    await admin.query(
      `insert into project_members (project_id, user_id, role) values ($1, $2, 'viewer')`,
      [projectId, person],
    );
    const row = (day: string, agent: string, cost: number) =>
      admin.query(
        `insert into usage (day, project_id, user_id, agent_key, kind, model, runs, cost_usd)
         values (${day}, $1, $2, $3, 'reply', 'm', 1, $4)`,
        [projectId, person, agent, cost],
      );
    const utcToday = `(now() at time zone 'utc')::date`;
    const monthStart = `date_trunc('month', now() at time zone 'utc')::date`;
    await row(utcToday, 'moderator', 1);
    await row(monthStart, 'backend', 2);
    // The last day of the month before, and a day long ago.
    await row(`${monthStart} - 1`, 'moderator', 16);
    await row(`${monthStart} - 40`, 'moderator', 64);

    const totals = await totalsOf(person, projectId);

    expect(totals.projectMonth).toBe(3);
    // On the first day of a month, the month's first day is today.
    expect(totals.userDay).toBe(new Date().getUTCDate() === 1 ? 3 : 1);
  });

  it('is there for members only', async () => {
    const projectId = await newProject();

    await expect(totalsOf(STRANGER, projectId)).rejects.toMatchObject({ code: 'P0002' });
    await expect(totalsOf(OWNER, randomUUID())).rejects.toMatchObject({ code: 'P0002' });
  });
});

describe('the table itself', () => {
  it('is read by the project’s owners, and written by nobody but the database', async () => {
    const projectId = await newProject();
    await meter(await insertRun(projectId, { userId: EDITOR }), {
      status: 'done',
      cost: 1,
      model: 'claude-opus-5-5',
    });
    const read = (userId: string) =>
      asUser(app, userId, async (client) => {
        const { rowCount } = await client.query('select 1 from usage where project_id = $1', [
          projectId,
        ]);
        return rowCount;
      });

    expect(await read(OWNER)).toBe(1);
    // An editor does not read the numbers, not even their own.
    expect(await read(EDITOR)).toBe(0);
    expect(await read(STRANGER)).toBe(0);
    await expect(
      asUser(app, OWNER, (client) =>
        client.query('update usage set cost_usd = 0 where project_id = $1', [projectId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asUser(app, OWNER, (client) =>
        client.query('delete from usage where project_id = $1', [projectId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
