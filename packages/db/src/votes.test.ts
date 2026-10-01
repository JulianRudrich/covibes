import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Comparisons, votes and decision processes (spec 16b).
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = 'b1111111-1111-4111-8111-111111111111';
const EDITOR = 'b2222222-2222-4222-8222-222222222222';
const VIEWER = 'b3333333-3333-4333-8333-333333333333';
const STRANGER = 'b4444444-4444-4444-8444-444444444444';
const PROJECT = 'baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const rejected = { code: '42501' };
let topics = 0;

async function moderatorMessage(): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into messages (project_id, author_kind, author_agent_key, content)
     values ($1, 'agent', 'moderator', 'Bitte stimmt ab.') returning id`,
    [PROJECT],
  );
  return rows[0]?.id ?? '';
}

/** An open vote on a fresh topic, created like the worker does. */
async function startVote(options = ['React Flow', 'tldraw']) {
  topics += 1;
  const topic = `Thema ${String(topics)}`;
  const { rows } = await admin.query<{ id: string }>(
    `insert into votes (project_id, message_id, topic, options)
     values ($1, $2, $3, $4::jsonb) returning id`,
    [PROJECT, await moderatorMessage(), topic, JSON.stringify(options)],
  );
  return { id: rows[0]?.id ?? '', topic };
}

/** Casts a vote for good, as the API does in its own transaction. */
async function cast(voteId: string, user: string, option: number) {
  const client = await app.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('app.user_id', $1, true)`, [user]);
    await client.query('select public.cast_vote($1, $2)', [voteId, option]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function voteOf(id: string) {
  const { rows } = await admin.query<{
    status: string;
    winner: string | null;
    tally: unknown;
    closed_by: string | null;
  }>('select status, winner, tally, closed_by from votes where id = $1', [id]);
  return rows[0];
}

async function decisionOf(topic: string) {
  const { rows } = await admin.query<{
    status: string;
    value: string | null;
    alternatives: unknown;
    decided_by: string | null;
    vote_id: string | null;
    comparison_id: string | null;
  }>(
    `select status, value, alternatives, decided_by, vote_id, comparison_id from decisions
     where project_id = $1 and topic = $2`,
    [PROJECT, topic],
  );
  return rows[0];
}

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'vote-owner@example.com', true),
      ($2, 'Eddie Editor', 'vote-editor@example.com', true),
      ($3, 'Vera Viewer', 'vote-viewer@example.com', true),
      ($4, 'Sam Stranger', 'vote-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Abstimmen', $2)`, [
    PROJECT,
    OWNER,
  ]);
  await admin.query(
    `insert into project_members (project_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'editor'), ($1, $4, 'viewer')`,
    [PROJECT, OWNER, EDITOR, VIEWER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('votes', () => {
  it('end once every owner and editor has voted, and record the winner', async () => {
    const { id, topic } = await startVote(['React Flow', 'tldraw', 'Eigenbau']);

    await cast(id, EDITOR, 1);
    expect(await voteOf(id)).toMatchObject({ status: 'open', winner: null });
    // A vote can be changed while the vote is open.
    await cast(id, EDITOR, 0);
    await cast(id, OWNER, 0);

    expect(await voteOf(id)).toEqual({
      status: 'closed',
      winner: 'React Flow',
      tally: [
        { name: 'React Flow', votes: 2 },
        { name: 'tldraw', votes: 0 },
        { name: 'Eigenbau', votes: 0 },
      ],
      closed_by: null,
    });
    expect(await decisionOf(topic)).toEqual({
      status: 'decided',
      value: 'React Flow',
      alternatives: [
        { name: 'tldraw', note: '' },
        { name: 'Eigenbau', note: '' },
      ],
      decided_by: null,
      vote_id: id,
      comparison_id: null,
    });
    const log = await admin.query<{ details: unknown; actor_agent: string | null }>(
      `select details, actor_agent from decision_log
       where project_id = $1 and kind = 'decided' and topic = $2`,
      [PROJECT, topic],
    );
    expect(log.rows).toMatchObject([
      {
        actor_agent: 'moderator',
        details: {
          votes: [
            { name: 'React Flow', votes: 2 },
            { name: 'tldraw', votes: 0 },
            { name: 'Eigenbau', votes: 0 },
          ],
        },
      },
    ]);
  });

  it('end without a decision on a tie', async () => {
    const { id, topic } = await startVote();
    await cast(id, OWNER, 0);
    await cast(id, EDITOR, 1);

    expect(await voteOf(id)).toMatchObject({ status: 'closed', winner: null });
    expect(await decisionOf(topic)).toBeUndefined();
    await expect(cast(id, OWNER, 1)).rejects.toMatchObject({ code: '55000' });
  });

  it('are ended early by owners only', async () => {
    const { id, topic } = await startVote();
    await cast(id, EDITOR, 1);

    await expect(
      asUser(app, EDITOR, (client) => client.query('select public.close_vote($1)', [id])),
    ).rejects.toMatchObject(rejected);
    await asUser(app, OWNER, async (client) => {
      await client.query('select public.close_vote($1)', [id]);
      const vote = await client.query('select status, winner, closed_by from votes where id = $1', [
        id,
      ]);
      expect(vote.rows).toEqual([{ status: 'closed', winner: 'tldraw', closed_by: OWNER }]);
      const decision = await client.query(
        'select value, vote_id from decisions where project_id = $1 and topic = $2',
        [PROJECT, topic],
      );
      expect(decision.rows).toEqual([{ value: 'tldraw', vote_id: id }]);
      await client.query('savepoint closed');
      await expect(client.query('select public.close_vote($1)', [id])).rejects.toMatchObject({
        code: '55000',
      });
      await client.query('rollback to savepoint closed');
    });
  });

  it('record nothing when nobody voted', async () => {
    const { id, topic } = await startVote();
    await asUser(app, OWNER, async (client) => {
      await client.query('select public.close_vote($1)', [id]);
      const vote = await client.query('select status, winner from votes where id = $1', [id]);
      expect(vote.rows).toEqual([{ status: 'closed', winner: null }]);
      const decision = await client.query(
        'select 1 from decisions where project_id = $1 and topic = $2',
        [PROJECT, topic],
      );
      expect(decision.rowCount).toBe(0);
    });
  });

  it('take votes from owners and editors only, for options that exist', async () => {
    const { id } = await startVote();
    await expect(cast(id, VIEWER, 0)).rejects.toMatchObject(rejected);
    await expect(cast(id, STRANGER, 0)).rejects.toMatchObject({ code: 'P0002' });
    await expect(cast(id, EDITOR, 2)).rejects.toMatchObject({ code: '22023' });
    await expect(cast(id, EDITOR, -1)).rejects.toMatchObject({ code: '22023' });
    await expect(
      asUser(app, EDITOR, (client) =>
        client.query(`insert into vote_ballots (vote_id, user_id, option) values ($1, $2, 0)`, [
          id,
          EDITOR,
        ]),
      ),
    ).rejects.toMatchObject(rejected);
  });

  it('show the ballots to members only', async () => {
    const { id } = await startVote();
    await cast(id, EDITOR, 1);
    await asUser(app, VIEWER, async (client) => {
      const { rows } = await client.query(
        'select user_id, option from vote_ballots where vote_id = $1',
        [id],
      );
      expect(rows).toEqual([{ user_id: EDITOR, option: 1 }]);
    });
    await asUser(app, STRANGER, async (client) => {
      const ballots = await client.query('select 1 from vote_ballots where vote_id = $1', [id]);
      expect(ballots.rowCount).toBe(0);
      const votes = await client.query('select 1 from votes where id = $1', [id]);
      expect(votes.rowCount).toBe(0);
    });
  });

  it('keep their result when the topic was decided another way meanwhile', async () => {
    const { id, topic } = await startVote();
    await admin.query(
      `select private.decide($1, $2, 'Eigenbau', '', '[]'::jsonb, 'moderator', $3)`,
      [PROJECT, topic, OWNER],
    );
    await cast(id, OWNER, 0);
    await cast(id, EDITOR, 0);

    expect(await voteOf(id)).toMatchObject({ status: 'closed', winner: 'React Flow' });
    expect(await decisionOf(topic)).toMatchObject({ value: 'Eigenbau', vote_id: null });
  });

  it('are open once per topic', async () => {
    const { topic } = await startVote();
    await expect(
      admin.query(
        `insert into votes (project_id, message_id, topic, options)
         values ($1, $2, $3, '["A", "B"]'::jsonb)`,
        [PROJECT, await moderatorMessage(), topic.toUpperCase()],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('comparisons', () => {
  it('go along with the decision on their topic, and are read by members only', async () => {
    const { rows } = await admin.query<{ id: string }>(
      `insert into comparisons (project_id, message_id, topic, data)
       values ($1, $2, 'Canvas', '{"options": ["React Flow", "tldraw"]}'::jsonb) returning id`,
      [PROJECT, await moderatorMessage()],
    );
    const comparisonId = rows[0]?.id ?? '';
    await admin.query(
      `select private.decide($1, 'canvas', 'React Flow', '', '[]'::jsonb, 'moderator', $2)`,
      [PROJECT, OWNER],
    );

    expect(await decisionOf('canvas')).toMatchObject({ comparison_id: comparisonId });
    const log = await admin.query<{ details: Record<string, unknown> }>(
      `select details from decision_log
       where project_id = $1 and kind = 'decided' and topic = 'canvas'`,
      [PROJECT],
    );
    expect(log.rows[0]?.details).toMatchObject({ comparisonId });

    await asUser(app, VIEWER, async (client) => {
      const found = await client.query('select 1 from comparisons where id = $1', [comparisonId]);
      expect(found.rowCount).toBe(1);
    });
    await asUser(app, STRANGER, async (client) => {
      const found = await client.query('select 1 from comparisons where id = $1', [comparisonId]);
      expect(found.rowCount).toBe(0);
    });
  });
});

describe('the owner decides', () => {
  it('lets only owners confirm a decision in that process', async () => {
    await admin.query(
      `update projects set settings = '{"decisionProcess": "owner"}' where id = $1`,
      [PROJECT],
    );
    try {
      const confirm = (client: pg.PoolClient) =>
        client.query(
          `select public.record_decision($1, 'Backend', 'Hono', '', '[]'::jsonb, 'moderator')`,
          [PROJECT],
        );
      await expect(asUser(app, EDITOR, confirm)).rejects.toMatchObject(rejected);
      await asUser(app, OWNER, async (client) => {
        await confirm(client);
        const decision = await client.query(
          `select value, decided_by from decisions where project_id = $1 and topic = 'Backend'`,
          [PROJECT],
        );
        expect(decision.rows).toEqual([{ value: 'Hono', decided_by: OWNER }]);
      });
    } finally {
      await admin.query(`update projects set settings = '{}' where id = $1`, [PROJECT]);
    }
  });

  it('allows the proposal reason for decisions that wait for the owner', async () => {
    await admin.query(
      `insert into proposals (project_id, kind, agent_key, reason, operations)
       values ($1, 'decision', 'moderator', 'owner_decides', '[]'::jsonb)`,
      [PROJECT],
    );
  });
});
