import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Agent runs, their jobs and the related rights (spec 07).
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '71111111-1111-4111-8111-111111111111';
const STRANGER = '72222222-2222-4222-8222-222222222222';
const PROJECT = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const rejected = { code: '42501' };

/** Inserts a human message like the API does and returns its id. */
async function postMessage(content: string, mentions: string[]) {
  const { rows } = await admin.query<{ id: string }>(
    `insert into messages (project_id, author_kind, author_user_id, content, mentions)
     values ($1, 'human', $2, $3, $4) returning id`,
    [PROJECT, OWNER, content, mentions],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('no message');
  return id;
}

async function runsFor(messageId: string) {
  const { rows } = await admin.query<{ id: string; agent_key: string; status: string }>(
    'select id, agent_key, status from ai_runs where trigger_message_id = $1',
    [messageId],
  );
  return rows;
}

async function jobsFor(runId: string) {
  const { rows } = await admin.query<{
    task_identifier: string;
    queue_name: string | null;
    max_attempts: number;
  }>(
    // The public view hides the payload; the test reads the queue's own tables.
    `select tasks.identifier as task_identifier, queues.queue_name, jobs.max_attempts
     from graphile_worker._private_jobs as jobs
     join graphile_worker._private_tasks as tasks on tasks.id = jobs.task_id
     left join graphile_worker._private_job_queues as queues on queues.id = jobs.job_queue_id
     where jobs.payload->>'runId' = $1`,
    [runId],
  );
  return rows;
}

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'runs-owner@example.com', true),
      ($2, 'Sam Stranger', 'runs-stranger@example.com', true)`,
    [OWNER, STRANGER],
  );
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Runs', $2)`, [
    PROJECT,
    OWNER,
  ]);
  await admin.query(
    `insert into project_members (project_id, user_id, role) values ($1, $2, 'owner')`,
    [PROJECT, OWNER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('mentions create runs and jobs', () => {
  it('a mention of the moderator queues a run and a job in the agent queue', async () => {
    const messageId = await postMessage('@Moderator, draw a block', ['moderator']);

    const [run, ...others] = await runsFor(messageId);
    expect(others).toEqual([]);
    expect(run).toMatchObject({ agent_key: 'moderator', status: 'queued' });
    expect(await jobsFor(run?.id ?? '')).toEqual([
      { task_identifier: 'agent_turn', queue_name: `agent:${PROJECT}:moderator`, max_attempts: 3 },
    ]);
  });

  it('only agents of the team answer (spec 14)', async () => {
    const before = await postMessage('@Critic, thoughts?', ['critic']);
    expect(await runsFor(before)).toEqual([]);

    await admin.query(`insert into project_agents (project_id, agent_key) values ($1, 'critic')`, [
      PROJECT,
    ]);
    const after = await postMessage('@Critic and @Moderator, thoughts?', ['critic', 'moderator']);
    const runs = await runsFor(after);
    expect(runs.map((run) => run.agent_key).sort()).toEqual(['critic', 'moderator']);
    const critic = runs.find((run) => run.agent_key === 'critic');
    expect(await jobsFor(critic?.id ?? '')).toEqual([
      { task_identifier: 'agent_turn', queue_name: `agent:${PROJECT}:critic`, max_attempts: 3 },
    ]);
  });

  it('messages without mentions and agent messages create nothing', async () => {
    const plain = await postMessage('Just talking', []);
    expect(await runsFor(plain)).toEqual([]);

    const { rows } = await admin.query<{ id: string }>(
      `insert into messages (project_id, author_kind, author_agent_key, content, mentions)
       values ($1, 'agent', 'moderator', 'Asking @moderator myself', '{moderator}') returning id`,
      [PROJECT],
    );
    expect(await runsFor(rows[0]?.id ?? '')).toEqual([]);
  });

  it('tells the server about the new run right away', async () => {
    const listener = await admin.connect();
    try {
      await listener.query('listen covibes_live');
      // Other test files write to the same database at the same time; only this project counts.
      const notified = new Promise<unknown>((resolve) => {
        listener.on('notification', (message: pg.Notification) => {
          const payload: unknown = JSON.parse(message.payload ?? 'null');
          if ((payload as { projectId?: unknown } | null)?.projectId === PROJECT) resolve(payload);
        });
      });
      const messageId = await postMessage('@moderator hello', ['moderator']);
      const [run] = await runsFor(messageId);
      expect(await notified).toEqual({ kind: 'run', projectId: PROJECT, runId: run?.id });
    } finally {
      await listener.query('unlisten covibes_live');
      listener.release();
    }
  });
});

describe('rights', () => {
  it('members read the runs of their project, strangers do not', async () => {
    await postMessage('@moderator once more', ['moderator']);
    await asUser(app, OWNER, async (client) => {
      const { rowCount } = await client.query('select 1 from ai_runs where project_id = $1', [
        PROJECT,
      ]);
      expect(rowCount).toBeGreaterThan(0);
    });
    await asUser(app, STRANGER, async (client) => {
      const { rowCount } = await client.query('select 1 from ai_runs where project_id = $1', [
        PROJECT,
      ]);
      expect(rowCount).toBe(0);
    });
  });

  it('clients can neither write runs nor touch the job queue', async () => {
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(`insert into ai_runs (project_id, agent_key) values ($1, 'moderator')`, [
          PROJECT,
        ]),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, OWNER, (client) => client.query("update ai_runs set status = 'done'")),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, OWNER, (client) => client.query('select * from graphile_worker.jobs')),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, OWNER, (client) =>
        client.query("select graphile_worker.add_job('agent_turn', '{}'::json)"),
      ),
    ).rejects.toMatchObject(rejected);
  });

  it('only a streaming message may be empty', async () => {
    await admin.query(
      `insert into messages (project_id, author_kind, author_agent_key, content, status)
       values ($1, 'agent', 'moderator', '', 'streaming')`,
      [PROJECT],
    );
    await expect(
      admin.query(
        `insert into messages (project_id, author_kind, author_agent_key, content, status)
         values ($1, 'agent', 'moderator', '', 'complete')`,
        [PROJECT],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
