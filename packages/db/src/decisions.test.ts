import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Criteria, decisions and the decision log (spec 16a).
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = 'a1111111-1111-4111-8111-111111111111';
const EDITOR = 'a2222222-2222-4222-8222-222222222222';
const VIEWER = 'a3333333-3333-4333-8333-333333333333';
const STRANGER = 'a4444444-4444-4444-8444-444444444444';
const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const rejected = { code: '42501' };

type LogRow = {
  kind: string;
  topic: string | null;
  value: string | null;
  details: Record<string, unknown>;
  actor_user: string | null;
  actor_agent: string | null;
};

/** The log entries of a transaction or of the whole project, oldest first. */
async function logOf(client: pg.PoolClient | pg.Pool, kindPrefix = ''): Promise<LogRow[]> {
  const { rows } = await client.query<LogRow>(
    `select kind, topic, value, details, actor_user, actor_agent from decision_log
     where project_id = $1 and kind like $2 order by created_at, id`,
    [PROJECT, `${kindPrefix}%`],
  );
  return rows;
}

const decide = (client: pg.PoolClient, topic: string, value: string) =>
  client.query<{ id: string }>(
    `select public.record_decision($1, $2, $3, 'Passt zu den Kriterien', $4::jsonb, 'moderator') as id`,
    [PROJECT, topic, value, JSON.stringify([{ name: 'tldraw', note: 'Lizenz' }])],
  );

/** A decided topic, recorded like the worker does on an instruction of the owner. */
async function decided(topic: string, value = 'React Flow'): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `select private.decide($1, $2, $3, '', '[]'::jsonb, 'moderator', $4) as id`,
    [PROJECT, topic, value, OWNER],
  );
  return rows[0]?.id ?? '';
}

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'decide-owner@example.com', true),
      ($2, 'Eddie Editor', 'decide-editor@example.com', true),
      ($3, 'Vera Viewer', 'decide-viewer@example.com', true),
      ($4, 'Sam Stranger', 'decide-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Entscheiden', $2)`, [
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

describe('criteria', () => {
  it('are added, changed and removed by editors, and every change is logged', async () => {
    await asUser(app, EDITOR, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into criteria (project_id, text, created_by) values ($1, 'EU-Hosting', $2)
         returning id`,
        [PROJECT, EDITOR],
      );
      const id = rows[0]?.id;
      await client.query(`update criteria set text = 'Hosting in der EU' where id = $1`, [id]);
      await client.query(`delete from criteria where id = $1`, [id]);

      expect(await logOf(client, 'criterion')).toEqual([
        {
          kind: 'criterion_added',
          topic: null,
          value: 'EU-Hosting',
          details: {},
          actor_user: EDITOR,
          actor_agent: null,
        },
        {
          kind: 'criterion_changed',
          topic: null,
          value: 'Hosting in der EU',
          details: { previous: 'EU-Hosting' },
          actor_user: EDITOR,
          actor_agent: null,
        },
        {
          kind: 'criterion_removed',
          topic: null,
          value: 'Hosting in der EU',
          details: {},
          actor_user: EDITOR,
          actor_agent: null,
        },
      ]);
    });
  });

  it('are read by members only and not written by viewers or in another name', async () => {
    const { rows } = await admin.query<{ id: string }>(
      `insert into criteria (project_id, text, created_by_agent)
       values ($1, 'Team: 3 Devs', 'moderator') returning id`,
      [PROJECT],
    );
    const id = rows[0]?.id;
    for (const member of [OWNER, EDITOR, VIEWER]) {
      await asUser(app, member, async (client) => {
        const found = await client.query('select 1 from criteria where id = $1', [id]);
        expect(found.rowCount).toBe(1);
      });
    }
    await asUser(app, STRANGER, async (client) => {
      const found = await client.query('select 1 from criteria where id = $1', [id]);
      expect(found.rowCount).toBe(0);
    });

    await expect(
      asUser(app, VIEWER, (client) =>
        client.query(`insert into criteria (project_id, text, created_by) values ($1, 'X', $2)`, [
          PROJECT,
          VIEWER,
        ]),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, EDITOR, (client) =>
        client.query(`insert into criteria (project_id, text, created_by) values ($1, 'X', $2)`, [
          PROJECT,
          OWNER,
        ]),
      ),
    ).rejects.toMatchObject(rejected);
    await asUser(app, VIEWER, async (client) => {
      const removed = await client.query('delete from criteria where id = $1', [id]);
      expect(removed.rowCount).toBe(0);
    });
  });

  it('log the agent when the worker writes for it', async () => {
    const client = await admin.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.agent_key', 'moderator', true)`);
      const { rows } = await client.query<{ id: string }>(
        `insert into criteria (project_id, text, created_by_agent)
         values ($1, 'Budget: klein', 'moderator') returning id`,
        [PROJECT],
      );
      await client.query('delete from criteria where id = $1', [rows[0]?.id]);
      const log = await logOf(client, 'criterion');
      expect(log.slice(-2)).toMatchObject([
        { kind: 'criterion_added', value: 'Budget: klein', actor_agent: 'moderator' },
        { kind: 'criterion_removed', value: 'Budget: klein', actor_agent: 'moderator' },
      ]);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('are short and trimmed', async () => {
    for (const text of ['', '  vorn', 'x'.repeat(81)]) {
      await expect(
        admin.query(`insert into criteria (project_id, text) values ($1, $2)`, [PROJECT, text]),
      ).rejects.toMatchObject({ code: '23514' });
    }
  });
});

describe('decisions', () => {
  it('are confirmed by owners and editors, with reasoning and alternatives in the log', async () => {
    await asUser(app, EDITOR, async (client) => {
      const { rows } = await decide(client, '  Canvas ', 'React Flow');
      const decision = await client.query(
        `select topic, status, value, reasoning, alternatives, decided_by, recorded_by_agent
         from decisions where id = $1`,
        [rows[0]?.id],
      );
      expect(decision.rows).toEqual([
        {
          topic: 'Canvas',
          status: 'decided',
          value: 'React Flow',
          reasoning: 'Passt zu den Kriterien',
          alternatives: [{ name: 'tldraw', note: 'Lizenz' }],
          decided_by: EDITOR,
          recorded_by_agent: 'moderator',
        },
      ]);
      expect((await logOf(client, 'decided')).at(-1)).toEqual({
        kind: 'decided',
        topic: 'Canvas',
        value: 'React Flow',
        details: {
          reasoning: 'Passt zu den Kriterien',
          alternatives: [{ name: 'tldraw', note: 'Lizenz' }],
        },
        actor_user: EDITOR,
        actor_agent: 'moderator',
      });
      // The topic is decided now, whatever its case.
      await expect(decide(client, 'canvas', 'tldraw')).rejects.toMatchObject({ code: '55000' });
    });
  });

  it('are neither confirmed by viewers and strangers nor written directly', async () => {
    await expect(
      asUser(app, VIEWER, (client) => decide(client, 'Backend', 'PostgreSQL')),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, STRANGER, (client) => decide(client, 'Backend', 'PostgreSQL')),
    ).rejects.toMatchObject({ code: 'P0002' });
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(`insert into decisions (project_id, topic) values ($1, 'Backend')`, [PROJECT]),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(`insert into decision_log (project_id, kind) values ($1, 'decided')`, [
          PROJECT,
        ]),
      ),
    ).rejects.toMatchObject(rejected);
  });

  it('decide an open topic that the moderator noted before', async () => {
    await admin.query(
      `insert into decisions (project_id, topic, recorded_by_agent)
       values ($1, 'Hosting', 'moderator')`,
      [PROJECT],
    );
    expect((await logOf(admin, 'opened')).at(-1)).toMatchObject({
      kind: 'opened',
      topic: 'Hosting',
      actor_agent: 'moderator',
    });

    await asUser(app, OWNER, async (client) => {
      await decide(client, 'hosting', 'Frankfurt');
      const { rows } = await client.query(
        `select topic, status, value from decisions
         where project_id = $1 and lower(topic) = 'hosting'`,
        [PROJECT],
      );
      expect(rows).toEqual([{ topic: 'Hosting', status: 'decided', value: 'Frankfurt' }]);
    });
  });

  it('can be reopened with a reason, which keeps the old one and starts a new round', async () => {
    const id = await decided('Datenbank', 'PostgreSQL');

    await expect(
      asUser(app, VIEWER, (client) =>
        client.query(`select public.reopen_decision($1, 'Zu teuer')`, [id]),
      ),
    ).rejects.toMatchObject(rejected);

    await asUser(app, EDITOR, async (client) => {
      const { rows } = await client.query<{ run: string }>(
        `select public.reopen_decision($1, '  Zu teuer im Betrieb ') as run`,
        [id],
      );
      const decision = await client.query(
        `select status, value, decided_by, reopen_reason, reopened_by from decisions where id = $1`,
        [id],
      );
      expect(decision.rows).toEqual([
        {
          status: 'open',
          value: null,
          decided_by: null,
          reopen_reason: 'Zu teuer im Betrieb',
          reopened_by: EDITOR,
        },
      ]);
      expect((await logOf(client, 'reopened')).at(-1)).toMatchObject({
        kind: 'reopened',
        topic: 'Datenbank',
        value: 'PostgreSQL',
        details: { reason: 'Zu teuer im Betrieb' },
        actor_user: EDITOR,
      });
      const run = await client.query(
        'select agent_key, status, decision_id from ai_runs where id = $1',
        [rows[0]?.run],
      );
      expect(run.rows).toEqual([{ agent_key: 'moderator', status: 'queued', decision_id: id }]);

      // An open decision cannot be reopened, but decided again.
      await client.query('savepoint before_second_reopen');
      await expect(
        client.query(`select public.reopen_decision($1, 'Noch einmal')`, [id]),
      ).rejects.toMatchObject({ code: '55000' });
      await client.query('rollback to savepoint before_second_reopen');
      await decide(client, 'Datenbank', 'SQLite');
      const again = await client.query(
        'select status, value, reopen_reason from decisions where id = $1',
        [id],
      );
      expect(again.rows).toEqual([{ status: 'decided', value: 'SQLite', reopen_reason: null }]);
    });
  });

  it('announce every change to the project', async () => {
    const listener = await admin.connect();
    try {
      await listener.query('listen covibes_live');
      const notified = new Promise<unknown>((resolve) => {
        listener.on('notification', (message: pg.Notification) => {
          // Other test files write to the same database at the same time; only this project counts.
          const payload = JSON.parse(message.payload ?? 'null') as {
            kind?: string;
            projectId?: string;
          } | null;
          if (payload?.kind === 'decisions' && payload.projectId === PROJECT) resolve(payload);
        });
      });
      await decided('Sprache', 'TypeScript');
      expect(await notified).toEqual({ kind: 'decisions', projectId: PROJECT });
    } finally {
      await listener.query('unlisten covibes_live');
      listener.release();
    }
  });
});

describe('projects', () => {
  it('can be deleted with their criteria, decisions and log', async () => {
    const project = 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Weg', $2)`, [
      project,
      OWNER,
    ]);
    await admin.query(`insert into criteria (project_id, text) values ($1, 'Kurz')`, [project]);
    await admin.query(
      `select private.decide($1, 'Thema', 'Wert', '', '[]'::jsonb, 'moderator', $2)`,
      [project, OWNER],
    );
    await admin.query('delete from projects where id = $1', [project]);
    const { rowCount } = await admin.query('select 1 from decision_log where project_id = $1', [
      project,
    ]);
    expect(rowCount).toBe(0);
  });
});

describe('decision proposals', () => {
  it('have no board', async () => {
    await admin.query(
      `insert into proposals (project_id, kind, agent_key, reason, operations)
       values ($1, 'decision', 'moderator', 'question', '[]'::jsonb)`,
      [PROJECT],
    );
  });
});
