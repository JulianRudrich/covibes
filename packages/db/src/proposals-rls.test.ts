import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Row level security for proposals of agents (spec 13).
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '61111111-1111-4111-8111-111111111111';
const EDITOR = '62222222-2222-4222-8222-222222222222';
const VIEWER = '63333333-3333-4333-8333-333333333333';
const STRANGER = '64444444-4444-4444-8444-444444444444';
const PROJECT = '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOARD = '6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const rejected = { code: '42501' };

/** An open proposal of the backend agent, created like the worker does. */
async function proposal(): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into proposals (project_id, board_id, agent_key, reason, operations)
     values ($1, $2, 'backend', 'question', '[]'::jsonb) returning id`,
    [PROJECT, BOARD],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('No proposal');
  return id;
}

const decide = (client: pg.PoolClient, id: string, by: string, status = 'applied') =>
  client.query(
    `update proposals set status = $2, decided_at = now(), decided_by = $3 where id = $1`,
    [id, status, by],
  );

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'prop-owner@example.com', true),
      ($2, 'Eddie Editor', 'prop-editor@example.com', true),
      ($3, 'Vera Viewer', 'prop-viewer@example.com', true),
      ($4, 'Sam Stranger', 'prop-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Vorschläge', $2)`, [
    PROJECT,
    OWNER,
  ]);
  await admin.query(
    `insert into project_members (project_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'editor'), ($1, $4, 'viewer')`,
    [PROJECT, OWNER, EDITOR, VIEWER],
  );
  await admin.query(
    `insert into boards (id, project_id, title, kind) values ($1, $2, 'Haupt-Canvas', 'main')`,
    [BOARD, PROJECT],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('proposals', () => {
  it('are read by members only', async () => {
    const id = await proposal();
    for (const member of [OWNER, EDITOR, VIEWER]) {
      await asUser(app, member, async (client) => {
        const { rows } = await client.query('select id from proposals where id = $1', [id]);
        expect(rows).toHaveLength(1);
      });
    }
    await asUser(app, STRANGER, async (client) => {
      const { rows } = await client.query('select id from proposals where id = $1', [id]);
      expect(rows).toEqual([]);
    });
  });

  it('are decided by owners and editors in their own name, once', async () => {
    for (const [member, status] of [
      [OWNER, 'applied'],
      [EDITOR, 'rejected'],
    ] as const) {
      const id = await proposal();
      await asUser(app, member, async (client) => {
        expect((await decide(client, id, member, status)).rowCount).toBe(1);
        // Decided is decided: a second decision finds no open proposal.
        expect((await decide(client, id, member, 'rejected')).rowCount).toBe(0);
      });
    }
  });

  it('cannot be decided by viewers and strangers', async () => {
    const id = await proposal();
    for (const member of [VIEWER, STRANGER]) {
      await asUser(app, member, async (client) => {
        expect((await decide(client, id, member)).rowCount).toBe(0);
      });
    }
  });

  it('cannot be decided in the name of someone else or reopened', async () => {
    const id = await proposal();
    await expect(asUser(app, EDITOR, (client) => decide(client, id, OWNER))).rejects.toMatchObject(
      rejected,
    );
    await expect(
      asUser(app, EDITOR, (client) => decide(client, id, EDITOR, 'open')),
    ).rejects.toThrow();
  });

  it('are only created and changed by the worker', async () => {
    const id = await proposal();
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(
          `insert into proposals (project_id, board_id, agent_key, reason, operations)
           values ($1, $2, 'backend', 'question', '[]'::jsonb)`,
          [PROJECT, BOARD],
        ),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(`update proposals set operations = '[]'::jsonb where id = $1`, [id]),
      ),
    ).rejects.toMatchObject(rejected);
  });
});
