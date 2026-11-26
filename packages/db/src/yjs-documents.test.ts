import pg from 'pg';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Stored Y.Docs (spec 05): only the server's admin role may touch them.
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });
// An id of its own: the test files share one database and run side by side.
const USER = '0d000000-0000-4000-8000-000000000001';

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('yjs_documents', () => {
  it('can be written and read by the admin role', async () => {
    await admin.query(
      `insert into users (id, name, email, email_verified)
       values ($1, 'Document Owner', 'document-owner@example.com', true)
       on conflict (id) do nothing`,
      [USER],
    );
    const project = await admin.query<{ id: string }>(
      "insert into projects (name, owner_id) values ('Document project', $1) returning id",
      [USER],
    );
    const board = await admin.query<{ id: string }>(
      "insert into boards (project_id, title, kind) values ($1, 'Board', 'main') returning id",
      [project.rows[0]?.id],
    );
    const boardId = board.rows[0]?.id;
    if (!boardId) throw new Error('Board fixture was not created');
    const name = `board:${boardId}`;
    await admin.query(
      `insert into yjs_documents (name, state) values ($1, '\\x0102')
       on conflict (name) do update set state = excluded.state`,
      [name],
    );
    const { rows } = await admin.query<{ state: Buffer }>(
      'select state from yjs_documents where name = $1',
      [name],
    );
    expect([...(rows[0]?.state ?? [])]).toEqual([1, 2]);
  });

  it('is out of reach for the app role, even for signed-in users', async () => {
    for (const userId of [null, USER]) {
      await expect(
        asUser(app, userId, (client) => client.query('select * from yjs_documents')),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asUser(app, userId, (client) =>
          client.query("insert into yjs_documents (name, state) values ('board:x', '\\x00')"),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('loses the plan of a project that is deleted, and nothing else (spec 25a)', async () => {
    const stored = async () => {
      const { rows } = await admin.query<{ name: string }>(
        `select name from yjs_documents where name like 'plan:0d%' order by name`,
      );
      return rows.map((row) => row.name);
    };
    const GONE = '0d111111-1111-4111-8111-111111111111';
    const STAYS = '0d222222-2222-4222-8222-222222222222';
    await admin.query(
      `insert into users (id, name, email, email_verified)
       values ($1, 'Plan Owner', 'plan-owner@example.com', true)
       on conflict (id) do nothing`,
      [USER],
    );
    await admin.query(
      `insert into projects (id, name, owner_id) values ($1, 'Geht', $3), ($2, 'Bleibt', $3)`,
      [GONE, STAYS, USER],
    );
    await admin.query(
      `insert into yjs_documents (name, state) values ($1, '\\x01'), ($2, '\\x02')`,
      [`plan:${GONE}`, `plan:${STAYS}`],
    );

    await admin.query('delete from projects where id = $1', [GONE]);

    expect(await stored()).toEqual([`plan:${STAYS}`]);
  });
});
