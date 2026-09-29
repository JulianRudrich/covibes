import pg from 'pg';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Stored Y.Docs (spec 05): only the server's admin role may touch them.
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });
const USER = '11111111-1111-4111-8111-111111111111';

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('yjs_documents', () => {
  it('can be written and read by the admin role', async () => {
    await admin.query(
      `insert into yjs_documents (name, state) values ('board:test', '\\x0102')
       on conflict (name) do update set state = excluded.state`,
    );
    const { rows } = await admin.query<{ state: Buffer }>(
      "select state from yjs_documents where name = 'board:test'",
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
});
