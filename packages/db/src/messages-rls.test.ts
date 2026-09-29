import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Row level security for chat messages (spec 06).
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '51111111-1111-4111-8111-111111111111';
const EDITOR = '52222222-2222-4222-8222-222222222222';
const VIEWER = '53333333-3333-4333-8333-333333333333';
const STRANGER = '54444444-4444-4444-8444-444444444444';
const PROJECT = '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const insertHuman = (client: pg.PoolClient, authorUserId: string, content = 'Hello') =>
  client.query(
    `insert into messages (project_id, author_kind, author_user_id, content)
     values ($1, 'human', $2, $3)`,
    [PROJECT, authorUserId, content],
  );

const rejected = { code: '42501' };

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'msg-owner@example.com', true),
      ($2, 'Eddie Editor', 'msg-editor@example.com', true),
      ($3, 'Vera Viewer', 'msg-viewer@example.com', true),
      ($4, 'Sam Stranger', 'msg-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Chat', $2)`, [
    PROJECT,
    OWNER,
  ]);
  await admin.query(
    `insert into project_members (project_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'editor'), ($1, $4, 'viewer')`,
    [PROJECT, OWNER, EDITOR, VIEWER],
  );
  await admin.query(
    `insert into messages (project_id, author_kind, author_user_id, content, mentions)
     values ($1, 'human', $2, '@Moderator, draw a block', '{moderator}')`,
    [PROJECT, OWNER],
  );
  // Agent messages are written by the server with the admin role (spec 07).
  await admin.query(
    `insert into messages (project_id, author_kind, author_agent_key, content)
     values ($1, 'agent', 'moderator', 'Done.')`,
    [PROJECT],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('reading', () => {
  it('members read all messages of the project, including agent messages', async () => {
    for (const member of [OWNER, EDITOR, VIEWER]) {
      await asUser(app, member, async (client) => {
        const { rows } = await client.query<{ author_kind: string }>(
          'select author_kind from messages where project_id = $1 order by created_at',
          [PROJECT],
        );
        expect(rows.map((row) => row.author_kind)).toEqual(['human', 'agent']);
      });
    }
  });

  it('a stranger cannot read', async () => {
    await asUser(app, STRANGER, async (client) => {
      const { rows } = await client.query('select * from messages where project_id = $1', [
        PROJECT,
      ]);
      expect(rows).toEqual([]);
    });
  });
});

describe('writing', () => {
  it('owner and editor write on their own behalf', async () => {
    for (const member of [OWNER, EDITOR]) {
      await asUser(app, member, async (client) => {
        expect((await insertHuman(client, member)).rowCount).toBe(1);
      });
    }
  });

  it('a viewer cannot write', async () => {
    await expect(
      asUser(app, VIEWER, (client) => insertHuman(client, VIEWER)),
    ).rejects.toMatchObject(rejected);
  });

  it('a stranger cannot write', async () => {
    await expect(
      asUser(app, STRANGER, (client) => insertHuman(client, STRANGER)),
    ).rejects.toMatchObject(rejected);
  });

  it('nobody can pose as another user', async () => {
    await expect(asUser(app, EDITOR, (client) => insertHuman(client, OWNER))).rejects.toMatchObject(
      rejected,
    );
  });

  it('nobody can pose as an agent', async () => {
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(
          `insert into messages (project_id, author_kind, author_agent_key, content)
           values ($1, 'agent', 'moderator', 'I am the moderator')`,
          [PROJECT],
        ),
      ),
    ).rejects.toMatchObject(rejected);
  });

  it.each([
    ['status', "'streaming'"],
    ['created_at', "now() - interval '1 day'"],
    ['updated_at', "now() - interval '1 day'"],
    ['block_refs', '\'[{"id": "x"}]\'::jsonb'],
    ['reply_to', 'gen_random_uuid()'],
    ['author_agent_key', "'moderator'"],
  ])('clients cannot set the server-owned column %s', async (column, value) => {
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(
          `insert into messages (project_id, author_kind, author_user_id, content, ${column})
           values ($1, 'human', $2, 'Hi', ${value})`,
          [PROJECT, OWNER],
        ),
      ),
    ).rejects.toMatchObject(rejected);
  });

  it('a reply points to a message of the same project', async () => {
    const other = await admin.query<{ id: string }>(
      `insert into projects (name, owner_id) values ('Other', $1) returning id`,
      [OWNER],
    );
    const foreign = await admin.query<{ id: string }>(
      `insert into messages (project_id, author_kind, author_user_id, content)
       values ($1, 'human', $2, 'Elsewhere') returning id`,
      [other.rows[0]?.id, OWNER],
    );
    await expect(
      admin.query(
        `insert into messages (project_id, author_kind, author_agent_key, content, reply_to)
         values ($1, 'agent', 'moderator', 'Reply', $2)`,
        [PROJECT, foreign.rows[0]?.id],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('messages can be neither changed nor deleted by clients', async () => {
    await expect(
      asUser(app, OWNER, (client) => client.query("update messages set content = 'changed'")),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, OWNER, (client) => client.query('delete from messages')),
    ).rejects.toMatchObject(rejected);
  });

  it('rejects empty and too long messages', async () => {
    await expect(
      asUser(app, OWNER, (client) => insertHuman(client, OWNER, '')),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      asUser(app, OWNER, (client) => insertHuman(client, OWNER, 'x'.repeat(8001))),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('a message has exactly one author matching its kind', async () => {
    await expect(
      admin.query(
        `insert into messages (id, project_id, author_kind, author_user_id, author_agent_key, content)
         values ($1, $2, 'human', $3, 'moderator', 'both')`,
        [randomUUID(), PROJECT, OWNER],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      admin.query(
        `insert into messages (project_id, author_kind, content) values ($1, 'agent', 'nobody')`,
        [PROJECT],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
