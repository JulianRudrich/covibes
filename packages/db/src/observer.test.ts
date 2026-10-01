import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Raised hands, offers and the observer's schedule (spec 15).
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '91111111-1111-4111-8111-111111111111';
const EDITOR = '92222222-2222-4222-8222-222222222222';
const VIEWER = '93333333-3333-4333-8333-333333333333';
const STRANGER = '94444444-4444-4444-8444-444444444444';
const PROJECT = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const QUIET = '9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const rejected = { code: '42501' };

/** An open raised hand, created like the worker does. */
async function raiseHand(agentKey = 'security', { replace = true } = {}): Promise<string> {
  // Only one hand per agent is open; earlier tests roll their decisions back.
  if (replace) {
    await admin.query(
      `update hand_raises set status = 'dismissed', decided_at = now()
       where project_id = $1 and agent_key = $2 and status = 'open'`,
      [PROJECT, agentKey],
    );
  }
  const { rows } = await admin.query<{ id: string }>(
    `insert into hand_raises (project_id, agent_key, reason)
     values ($1, $2, 'Welche Daten gehen an externe KI-Anbieter?') returning id`,
    [PROJECT, agentKey],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('No raised hand');
  return id;
}

/** An open offer with its moderator message, created like the worker does. */
async function offer(): Promise<{ id: string; messageId: string }> {
  // Only one offer is open per project.
  await admin.query(
    `update offers set status = 'declined', decided_at = now()
     where project_id = $1 and status = 'open'`,
    [PROJECT],
  );
  const message = await admin.query<{ id: string }>(
    `insert into messages (project_id, author_kind, author_agent_key, content)
     values ($1, 'agent', 'moderator', 'Ihr seid euch einig. Soll ich es festhalten?') returning id`,
    [PROJECT],
  );
  const messageId = message.rows[0]?.id ?? '';
  const { rows } = await admin.query<{ id: string }>(
    `insert into offers (project_id, message_id, kind, action, task)
     values ($1, $2, 'consensus', 'Ja, festhalten', 'Die Einigung zusammenfassen') returning id`,
    [PROJECT, messageId],
  );
  return { id: rows[0]?.id ?? '', messageId };
}

async function jobsForRun(runId: string) {
  const { rows } = await admin.query<{ task: string; queue: string | null }>(
    `select tasks.identifier as task, queues.queue_name as queue
     from graphile_worker._private_jobs as jobs
     join graphile_worker._private_tasks as tasks on tasks.id = jobs.task_id
     left join graphile_worker._private_job_queues as queues on queues.id = jobs.job_queue_id
     where jobs.payload->>'runId' = $1`,
    [runId],
  );
  return rows;
}

async function observerJobs(project: string) {
  const { rows } = await admin.query<{ task: string; queue: string | null; seconds: number }>(
    `select tasks.identifier as task, queues.queue_name as queue,
       round(extract(epoch from jobs.run_at - now()))::int as seconds
     from graphile_worker._private_jobs as jobs
     join graphile_worker._private_tasks as tasks on tasks.id = jobs.task_id
     left join graphile_worker._private_job_queues as queues on queues.id = jobs.job_queue_id
     where jobs.key = $1`,
    [`observer:${project}`],
  );
  return rows;
}

const postMessage = (project: string, content: string) =>
  admin.query(
    `insert into messages (project_id, author_kind, author_user_id, content)
     values ($1, 'human', $2, $3)`,
    [project, OWNER, content],
  );

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'observer-owner@example.com', true),
      ($2, 'Eddie Editor', 'observer-editor@example.com', true),
      ($3, 'Vera Viewer', 'observer-viewer@example.com', true),
      ($4, 'Sam Stranger', 'observer-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
  await admin.query(
    `insert into projects (id, name, owner_id, settings) values
      ($1, 'Beobachter', $3, '{}'), ($2, 'Ruhig', $3, '{"observer": false}')`,
    [PROJECT, QUIET, OWNER],
  );
  await admin.query(
    `insert into project_members (project_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'editor'), ($1, $4, 'viewer'), ($5, $2, 'owner')`,
    [PROJECT, OWNER, EDITOR, VIEWER, QUIET],
  );
  await admin.query(
    `insert into project_agents (project_id, agent_key) values ($1, 'security'), ($1, 'critic')`,
    [PROJECT],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('raised hands', () => {
  it('are read by members only and never written by clients', async () => {
    const id = await raiseHand('critic');
    for (const member of [OWNER, EDITOR, VIEWER]) {
      await asUser(app, member, async (client) => {
        const { rows } = await client.query('select id from hand_raises where id = $1', [id]);
        expect(rows).toHaveLength(1);
      });
    }
    await asUser(app, STRANGER, async (client) => {
      const { rows } = await client.query('select id from hand_raises where id = $1', [id]);
      expect(rows).toEqual([]);
    });
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(`update hand_raises set status = 'dismissed' where id = $1`, [id]),
      ),
    ).rejects.toMatchObject(rejected);
    await admin.query('delete from hand_raises where id = $1', [id]);
  });

  it('let owners and editors listen, which queues the agent once', async () => {
    const id = await raiseHand();
    await asUser(app, EDITOR, async (client) => {
      const { rows } = await client.query<{ run: string }>(
        'select public.listen_to_hand($1) as run',
        [id],
      );
      const runId = rows[0]?.run ?? '';
      const run = await client.query(
        'select agent_key, status, kind, hand_raise_id from ai_runs where id = $1',
        [runId],
      );
      expect(run.rows).toEqual([
        { agent_key: 'security', status: 'queued', kind: 'reply', hand_raise_id: id },
      ]);
      const hand = await client.query(
        'select status, decided_by, run_id from hand_raises where id = $1',
        [id],
      );
      expect(hand.rows).toEqual([{ status: 'heard', decided_by: EDITOR, run_id: runId }]);
    });
  });

  it('queue the agent run with its job', async () => {
    const id = await raiseHand();
    // Committed on behalf of the owner, so the job can be looked up afterwards.
    const client = await app.connect();
    const runId = await (async () => {
      try {
        await client.query('begin');
        await client.query(`select set_config('app.user_id', $1, true)`, [OWNER]);
        const { rows } = await client.query<{ run: string }>(
          'select public.listen_to_hand($1) as run',
          [id],
        );
        await client.query('commit');
        return rows[0]?.run ?? '';
      } finally {
        client.release();
      }
    })();
    expect(await jobsForRun(runId)).toEqual([
      { task: 'agent_turn', queue: `agent:${PROJECT}:security` },
    ]);
  });

  it('are decided once, and not by viewers or strangers', async () => {
    const id = await raiseHand();
    await expect(
      asUser(app, VIEWER, (client) => client.query('select public.listen_to_hand($1)', [id])),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, STRANGER, (client) => client.query('select public.dismiss_hand($1)', [id])),
    ).rejects.toMatchObject({ code: 'P0002' });
    await expect(
      asUser(app, OWNER, (client) =>
        client.query('select public.listen_to_hand($1)', ['9ccccccc-cccc-4ccc-8ccc-cccccccccccc']),
      ),
    ).rejects.toMatchObject({ code: 'P0002' });

    await asUser(app, OWNER, async (client) => {
      await client.query('select public.dismiss_hand($1)', [id]);
      const hand = await client.query('select status, decided_by from hand_raises where id = $1', [
        id,
      ]);
      expect(hand.rows).toEqual([{ status: 'dismissed', decided_by: OWNER }]);
      await expect(client.query('select public.listen_to_hand($1)', [id])).rejects.toMatchObject({
        code: '55000',
      });
    });
    await admin.query(
      `update hand_raises set status = 'dismissed', decided_at = now() where id = $1`,
      [id],
    );
  });

  it('are one per agent, and leave with their agent', async () => {
    await admin.query(
      `update hand_raises set status = 'dismissed', decided_at = now() where project_id = $1 and status = 'open'`,
      [PROJECT],
    );
    await raiseHand('critic');
    await expect(raiseHand('critic', { replace: false })).rejects.toMatchObject({
      code: '23505',
    });

    await admin.query(`delete from project_agents where project_id = $1 and agent_key = 'critic'`, [
      PROJECT,
    ]);
    const { rows } = await admin.query(
      `select status from hand_raises where project_id = $1 and agent_key = 'critic'`,
      [PROJECT],
    );
    expect(rows).toEqual([{ status: 'dismissed' }]);
    await admin.query(`insert into project_agents (project_id, agent_key) values ($1, 'critic')`, [
      PROJECT,
    ]);
  });
});

describe('offers', () => {
  it('are accepted by owners and editors, which queues the moderator with the offer', async () => {
    const { id } = await offer();
    await asUser(app, EDITOR, async (client) => {
      const { rows } = await client.query<{ run: string }>(
        'select public.decide_offer($1, true) as run',
        [id],
      );
      const runId = rows[0]?.run ?? '';
      const run = await client.query('select agent_key, offer_id from ai_runs where id = $1', [
        runId,
      ]);
      expect(run.rows).toEqual([{ agent_key: 'moderator', offer_id: id }]);
      const decided = await client.query(
        'select status, decided_by, run_id from offers where id = $1',
        [id],
      );
      expect(decided.rows).toEqual([{ status: 'accepted', decided_by: EDITOR, run_id: runId }]);
    });
  });

  it('can be declined without a run, once, and not by viewers', async () => {
    const { id } = await offer();
    await expect(
      asUser(app, VIEWER, (client) => client.query('select public.decide_offer($1, false)', [id])),
    ).rejects.toMatchObject(rejected);
    await asUser(app, OWNER, async (client) => {
      const { rows } = await client.query<{ run: string | null }>(
        'select public.decide_offer($1, false) as run',
        [id],
      );
      expect(rows).toEqual([{ run: null }]);
      await expect(
        client.query('select public.decide_offer($1, true)', [id]),
      ).rejects.toMatchObject({ code: '55000' });
    });
  });

  it('are one open per project and read by members only', async () => {
    const { messageId } = await offer();
    await expect(
      admin.query(
        `insert into offers (project_id, message_id, kind, action, task)
         values ($1, $2, 'stuck', 'Ja', 'Etwas')`,
        [PROJECT, messageId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await asUser(app, STRANGER, async (client) => {
      const { rows } = await client.query('select id from offers where project_id = $1', [PROJECT]);
      expect(rows).toEqual([]);
    });
  });
});

describe('the observer', () => {
  it('is scheduled after a pause: every human message replaces the waiting job', async () => {
    await postMessage(PROJECT, 'Wir nehmen React Flow.');
    await postMessage(PROJECT, 'Einverstanden.');
    const jobs = await observerJobs(PROJECT);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ task: 'observe', queue: `observer:${PROJECT}` });
    expect(jobs[0]?.seconds).toBeGreaterThanOrEqual(13);
    expect(jobs[0]?.seconds).toBeLessThanOrEqual(15);
  });

  it('is not scheduled by agent messages or when the owner switched it off', async () => {
    await postMessage(QUIET, 'Hallo?');
    expect(await observerJobs(QUIET)).toEqual([]);

    await admin.query(`delete from graphile_worker._private_jobs where key = $1`, [
      `observer:${PROJECT}`,
    ]);
    await admin.query(
      `insert into messages (project_id, author_kind, author_agent_key, content)
       values ($1, 'agent', 'moderator', 'Gern.')`,
      [PROJECT],
    );
    expect(await observerJobs(PROJECT)).toEqual([]);
  });
});
