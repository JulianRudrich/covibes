import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Debates (spec 18).
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = 'd1111111-1111-4111-8111-111111111111';
const EDITOR = 'd2222222-2222-4222-8222-222222222222';
const VIEWER = 'd3333333-3333-4333-8333-333333333333';
const STRANGER = 'd4444444-4444-4444-8444-444444444444';
const PROJECT = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type Run = { id: string; agent_key: string; debate_round: number | null; status: string };

/** A debate as the worker opens it: tied to the moderator's answer, which is still being written. */
async function openDebate(
  options: { participants?: string[]; rounds?: number } = {},
): Promise<{ id: string; messageId: string; opening: string }> {
  const message = await admin.query<{ id: string }>(
    `insert into messages (project_id, author_kind, author_agent_key, content, status)
     values ($1, 'agent', 'moderator', '', 'streaming') returning id`,
    [PROJECT],
  );
  const messageId = message.rows[0]?.id ?? '';
  const run = await admin.query<{ id: string }>(
    `insert into ai_runs (project_id, agent_key, reply_message_id, status)
     values ($1, 'moderator', $2, 'running') returning id`,
    [PROJECT, messageId],
  );
  const opening = run.rows[0]?.id ?? '';
  const debate = await admin.query<{ id: string }>(
    `insert into debates (project_id, message_id, topic, question, participants, rounds)
     values ($1, $2, 'Architektur', 'Monolith oder getrennte Dienste?', $3, $4) returning id`,
    [PROJECT, messageId, options.participants ?? ['backend', 'critic'], options.rounds ?? 2],
  );
  const id = debate.rows[0]?.id ?? '';
  await admin.query('update ai_runs set debate_id = $2 where id = $1', [opening, id]);
  return { id, messageId, opening };
}

/** What the worker does when a run ends. */
async function finish(runId: string, status: 'done' | 'error' = 'done') {
  await admin.query('update ai_runs set status = $2, finished_at = now() where id = $1', [
    runId,
    status,
  ]);
}

/** The runs of a debate that the chain queued, oldest first. */
async function queued(debateId: string): Promise<Run[]> {
  const { rows } = await admin.query<Run>(
    `select id, agent_key, debate_round, status from ai_runs
     where debate_id = $1 and status = 'queued' order by created_at, id`,
    [debateId],
  );
  return rows;
}

async function debate(id: string) {
  const { rows } = await admin.query<{
    status: string;
    turns: number;
    finished: boolean;
    stopped_by: string | null;
  }>(
    `select status, turns, finished_at is not null as finished, stopped_by
     from debates where id = $1`,
    [id],
  );
  return rows[0];
}

/** Finishes the waiting run of the debate and returns who spoke in which round. */
async function takeTurn(debateId: string): Promise<[agent: string, round: number | null]> {
  const [run, ...more] = await queued(debateId);
  if (!run || more.length > 0) throw new Error('Exactly one run of the debate should wait');
  await finish(run.id);
  return [run.agent_key, run.debate_round];
}

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'debate-owner@example.com', true),
      ($2, 'Eddie Editor', 'debate-editor@example.com', true),
      ($3, 'Vera Viewer', 'debate-viewer@example.com', true),
      ($4, 'Sam Stranger', 'debate-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Debatten', $2)`, [
    PROJECT,
    OWNER,
  ]);
  await admin.query(
    `insert into project_members (project_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'editor'), ($1, $4, 'viewer')`,
    [PROJECT, OWNER, EDITOR, VIEWER],
  );
});

beforeEach(async () => {
  // One debate at a time per project; every test starts without one.
  await admin.query('delete from debates where project_id = $1', [PROJECT]);
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('the chain of a debate', () => {
  it('starts with the first participant once the opening answer is finished', async () => {
    const { id, opening } = await openDebate();
    expect(await queued(id)).toEqual([]);

    await finish(opening);

    expect(await queued(id)).toMatchObject([{ agent_key: 'backend', debate_round: 1 }]);
    expect(await debate(id)).toMatchObject({ status: 'running', turns: 0 });
    const jobs = await admin.query<{ queue_name: string; payload: { runId: string } }>(
      `select queues.queue_name, jobs.payload
       from graphile_worker._private_jobs as jobs
       join graphile_worker._private_job_queues as queues on queues.id = jobs.job_queue_id
       where queues.queue_name = $1`,
      [`agent:${PROJECT}:backend`],
    );
    const [run] = await queued(id);
    expect(jobs.rows.map((job) => job.payload.runId)).toContain(run?.id);
  });

  it('lets the participants take turns for the rounds, then the moderator sums up', async () => {
    const { id, opening } = await openDebate({ rounds: 2 });
    await finish(opening);

    const turns = [];
    for (let turn = 0; turn < 4; turn += 1) turns.push(await takeTurn(id));
    expect(turns).toEqual([
      ['backend', 1],
      ['critic', 1],
      ['backend', 2],
      ['critic', 2],
    ]);
    expect(await debate(id)).toMatchObject({ status: 'summarizing', turns: 4, finished: false });

    expect(await takeTurn(id)).toEqual(['moderator', null]);
    expect(await debate(id)).toMatchObject({ status: 'done', turns: 4, finished: true });
    expect(await queued(id)).toEqual([]);
  });

  it('handles three participants and a single round', async () => {
    const { id, opening } = await openDebate({
      participants: ['backend', 'critic', 'security'],
      rounds: 1,
    });
    await finish(opening);

    expect([await takeTurn(id), await takeTurn(id), await takeTurn(id)]).toEqual([
      ['backend', 1],
      ['critic', 1],
      ['security', 1],
    ]);
    expect(await takeTurn(id)).toEqual(['moderator', null]);
    expect(await debate(id)).toMatchObject({ status: 'done', turns: 3 });
  });

  it('waits while a failed run is retried and aborts when it failed for good', async () => {
    const { id, opening } = await openDebate();
    await finish(opening);
    const [run] = await queued(id);
    if (!run) throw new Error('The first turn is missing');

    // A retry: the run works, fails and waits again.
    await admin.query(`update ai_runs set status = 'running' where id = $1`, [run.id]);
    await admin.query(`update ai_runs set status = 'queued' where id = $1`, [run.id]);
    expect(await debate(id)).toMatchObject({ status: 'running', turns: 0 });

    await finish(run.id, 'error');
    expect(await debate(id)).toMatchObject({ status: 'failed', turns: 0, finished: true });
    expect(await queued(id)).toEqual([]);
  });

  it('aborts when the opening answer or the summary failed', async () => {
    const first = await openDebate();
    await finish(first.opening, 'error');
    expect(await debate(first.id)).toMatchObject({ status: 'failed' });
    expect(await queued(first.id)).toEqual([]);

    const second = await openDebate({ rounds: 1 });
    await finish(second.opening);
    await takeTurn(second.id);
    await takeTurn(second.id);
    const [summary] = await queued(second.id);
    if (!summary) throw new Error('The summary is missing');
    await finish(summary.id, 'error');
    expect(await debate(second.id)).toMatchObject({ status: 'failed', turns: 2 });
  });

  it('announces the opening message whenever the debate moves on', async () => {
    const { id, messageId, opening } = await openDebate();
    const listener = new pg.Client({ connectionString: adminUrl });
    await listener.connect();
    const announced: { kind: string; messageId?: string }[] = [];
    listener.on('notification', (notification) => {
      const event = JSON.parse(notification.payload ?? '{}') as {
        kind: string;
        projectId: string;
        messageId?: string;
      };
      // Other test files write to the same database.
      if (event.projectId === PROJECT) announced.push(event);
    });
    await listener.query('listen covibes_live');
    try {
      await finish(opening);
      await takeTurn(id);
      await listener.query('select 1');
      expect(announced.filter((event) => event.kind === 'message')).toEqual([
        expect.objectContaining({ messageId }),
        expect.objectContaining({ messageId }),
      ]);
      expect(announced.filter((event) => event.kind === 'run')).toHaveLength(2);
    } finally {
      await listener.end();
    }
  });

  it('allows one debate at a time per project', async () => {
    const first = await openDebate();
    await expect(openDebate()).rejects.toMatchObject({ code: '23505' });

    // Once it is over, the next one can start.
    await finish(first.opening, 'error');
    await expect(openDebate()).resolves.toBeDefined();
  });

  it('keeps its limits', async () => {
    await expect(openDebate({ participants: ['backend'] })).rejects.toMatchObject({
      code: '23514',
    });
    await expect(openDebate({ rounds: 4 })).rejects.toMatchObject({ code: '23514' });
  });
});

describe('ending a debate early', () => {
  /** `stop_debate` as a member; commits, since the chain continues afterwards. */
  async function stop(debateId: string, userId: string) {
    const client = await app.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.user_id', $1, true)", [userId]);
      await client.query('select public.stop_debate($1)', [debateId]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  it('lets the turn in progress finish, then the moderator sums up', async () => {
    const { id, opening } = await openDebate({ rounds: 3 });
    await finish(opening);
    await takeTurn(id);

    await stop(id, EDITOR);
    expect(await debate(id)).toMatchObject({ status: 'running', turns: 1, stopped_by: EDITOR });

    // The second turn was being written; after it the debate goes to the summary.
    expect(await takeTurn(id)).toEqual(['critic', 1]);
    expect(await debate(id)).toMatchObject({ status: 'summarizing', turns: 2 });
    expect(await takeTurn(id)).toEqual(['moderator', null]);
    expect(await debate(id)).toMatchObject({ status: 'done', stopped_by: EDITOR });
  });

  it('ends without a summary before the first turn', async () => {
    const { id, opening } = await openDebate();
    await stop(id, OWNER);
    await finish(opening);

    expect(await debate(id)).toMatchObject({ status: 'done', turns: 0, finished: true });
    expect(await queued(id)).toEqual([]);
  });

  it('is for owners and editors, once, while the debate runs', async () => {
    const { id, opening } = await openDebate({ rounds: 1 });
    await expect(stop(id, VIEWER)).rejects.toMatchObject({ code: '42501' });
    await expect(stop(id, STRANGER)).rejects.toMatchObject({ code: 'P0002' });
    await expect(stop('d9999999-9999-4999-8999-999999999999', OWNER)).rejects.toMatchObject({
      code: 'P0002',
    });

    await stop(id, OWNER);
    await expect(stop(id, EDITOR)).rejects.toMatchObject({ code: '55000' });

    // Not while the moderator sums up, and not once it is over.
    await admin.query('delete from debates where id = $1', [id]);
    const next = await openDebate({ rounds: 1 });
    await finish(next.opening);
    await takeTurn(next.id);
    await takeTurn(next.id);
    await expect(stop(next.id, OWNER)).rejects.toMatchObject({ code: '55000' });
    await takeTurn(next.id);
    await expect(stop(next.id, OWNER)).rejects.toMatchObject({ code: '55000' });
    expect(opening).not.toBe(next.opening);
  });
});

describe('access to debates', () => {
  it('lets members read them and nobody else', async () => {
    const { id } = await openDebate();
    for (const member of [OWNER, EDITOR, VIEWER]) {
      const { rows } = await asUser(app, member, (client) =>
        client.query('select id from debates where id = $1', [id]),
      );
      expect(rows).toHaveLength(1);
    }
    const { rows } = await asUser(app, STRANGER, (client) =>
      client.query('select id from debates where id = $1', [id]),
    );
    expect(rows).toEqual([]);
  });

  it('lets no client create or change them', async () => {
    const { id, messageId } = await openDebate();
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(
          `insert into debates (project_id, message_id, topic, question, participants, rounds)
           values ($1, $2, 'X', 'Y', '{backend,critic}', 1)`,
          [PROJECT, messageId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(`update debates set rounds = 3 where id = $1`, [id]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
