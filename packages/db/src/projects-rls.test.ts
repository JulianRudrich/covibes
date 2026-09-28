import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Row level security for spec 04: users, projects, members and boards.
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';
const VIEWER = '33333333-3333-4333-8333-333333333333';
const EDITOR = '44444444-4444-4444-8444-444444444444';
let projectId = '';

/** Like asUser, but commits: for test data other tests build on. */
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

const count = async (client: pg.PoolClient, sql: string, params: unknown[] = []) =>
  Number(
    (await client.query<{ n: string }>(`select count(*) as n from (${sql}) t`, params)).rows[0]?.n,
  );

const changed = async (client: pg.PoolClient, sql: string, params: unknown[] = []) =>
  (await client.query(sql, params)).rowCount;

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'owner@example.com', true),
      ($2, 'Sam Stranger', 'stranger@example.com', true),
      ($3, 'Vera Viewer', 'viewer@example.com', true),
      ($4, 'Eddie Editor', 'editor@example.com', true)`,
    [OWNER, STRANGER, VIEWER, EDITOR],
  );
  projectId = await commitAs(OWNER, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "select id from public.create_project('Covibes V1')",
    );
    const id = rows[0]?.id ?? '';
    await client.query(
      `insert into project_members (project_id, user_id, role) values ($1, $2, 'viewer'), ($1, $3, 'editor')`,
      [id, VIEWER, EDITOR],
    );
    return id;
  });
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

// The roles themselves are tested in bootstrap.test.ts.
describe('app role', () => {
  it('without a user id the app role sees nothing', async () => {
    await asUser(app, null, async (client) => {
      expect(await count(client, 'select * from projects')).toBe(0);
      expect(await count(client, 'select id from users')).toBe(0);
    });
  });

  it('the app role cannot read login data', async () => {
    await expect(
      asUser(app, OWNER, (client) => client.query('select * from sessions')),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asUser(app, OWNER, (client) => client.query('select email from users')),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('create_project', () => {
  it('trims the name, makes the creator owner and creates exactly one main board', async () => {
    await asUser(app, OWNER, async (client) => {
      const { rows } = await client.query<{ id: string; name: string }>(
        "select id, name from public.create_project('  Neues Projekt  ')",
      );
      const created = rows[0];
      expect(created?.name).toBe('Neues Projekt');
      const role = await client.query<{ role: string }>(
        'select role from project_members where project_id = $1',
        [created?.id],
      );
      expect(role.rows).toEqual([{ role: 'owner' }]);
      expect(
        await count(client, "select * from boards where project_id = $1 and kind = 'main'", [
          created?.id,
        ]),
      ).toBe(1);
    });
  });

  it('rejects an empty name', async () => {
    await expect(
      asUser(app, OWNER, (client) => client.query("select public.create_project('   ')")),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('needs a user', async () => {
    await expect(
      asUser(app, null, (client) => client.query("select public.create_project('Anonym')")),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('stranger', () => {
  it('sees no project, members or boards and only their own user', async () => {
    await asUser(app, STRANGER, async (client) => {
      expect(await count(client, 'select * from projects')).toBe(0);
      expect(await count(client, 'select * from project_members')).toBe(0);
      expect(await count(client, 'select * from boards')).toBe(0);
      expect(await count(client, 'select id from users')).toBe(1);
    });
  });

  it('cannot join a project', async () => {
    await expect(
      asUser(app, STRANGER, (client) =>
        client.query(
          "insert into project_members (project_id, user_id, role) values ($1, $2, 'owner')",
          [projectId, STRANGER],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('viewer', () => {
  it('sees the project and the names of fellow members', async () => {
    await asUser(app, VIEWER, async (client) => {
      expect(await count(client, 'select * from projects')).toBe(1);
      expect(await count(client, 'select id from users')).toBe(3);
    });
  });

  it('cannot rename the project or make themselves owner', async () => {
    await asUser(app, VIEWER, async (client) => {
      expect(await changed(client, "update projects set name = 'Umbenannt'")).toBe(0);
      expect(
        await changed(client, "update project_members set role = 'owner' where user_id = $1", [
          VIEWER,
        ]),
      ).toBe(0);
    });
  });

  it('cannot add boards', async () => {
    await expect(
      asUser(app, VIEWER, (client) =>
        client.query("insert into boards (project_id, title, kind) values ($1, 'Ideen', 'extra')", [
          projectId,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('editor', () => {
  it('cannot change project settings or make themselves owner', async () => {
    await asUser(app, EDITOR, async (client) => {
      expect(await changed(client, `update projects set settings = '{"stance": "strict"}'`)).toBe(
        0,
      );
      expect(
        await changed(client, "update project_members set role = 'owner' where user_id = $1", [
          EDITOR,
        ]),
      ).toBe(0);
    });
  });

  it('can add extra boards but no second main board, and cannot delete the main board', async () => {
    await asUser(app, EDITOR, async (client) => {
      await client.query(
        "insert into boards (project_id, title, kind) values ($1, 'Ideen', 'extra')",
        [projectId],
      );
      expect(await changed(client, "delete from boards where kind = 'main'")).toBe(0);
    });
    await expect(
      asUser(app, EDITOR, (client) =>
        client.query(
          "insert into boards (project_id, title, kind) values ($1, 'Zweites', 'main')",
          [projectId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('cannot change other users', async () => {
    await expect(
      asUser(app, EDITOR, (client) =>
        client.query("update users set name = 'Anders' where id = $1", [OWNER]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('owner', () => {
  it('cannot change the owner column', async () => {
    await expect(
      asUser(app, OWNER, (client) =>
        client.query('update projects set owner_id = $1 where id = $2', [STRANGER, projectId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('cannot leave as the only owner', async () => {
    await expect(
      asUser(app, OWNER, (client) =>
        client.query('delete from project_members where user_id = $1 and project_id = $2', [
          OWNER,
          projectId,
        ]),
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
  });

  it('can delete the project, which removes members and boards', async () => {
    const doomed = await commitAs(OWNER, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "select id from public.create_project('To be deleted')",
      );
      return rows[0]?.id ?? '';
    });
    await commitAs(OWNER, (client) => client.query('delete from projects where id = $1', [doomed]));

    const remaining = await admin.query<{ members: string; boards: string }>(
      `select (select count(*) from project_members where project_id = $1) as members,
              (select count(*) from boards where project_id = $1) as boards`,
      [doomed],
    );
    expect(remaining.rows[0]).toEqual({ members: '0', boards: '0' });
  });
});
