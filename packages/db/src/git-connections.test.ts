import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// GitLab accounts of people and the repository of a project (specs 28a and 29a): who reads the
// connection, who never reads the tokens, and when a connection ends by itself.
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '2f111111-1111-4111-8111-111111111111';
const SECOND_OWNER = '2f222222-2222-4222-8222-222222222222';
const VIEWER = '2f333333-3333-4333-8333-333333333333';
const STRANGER = '2f444444-4444-4444-8444-444444444444';

async function newProject() {
  const id = randomUUID();
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Vereins-App', $2)`, [
    id,
    OWNER,
  ]);
  await admin.query(
    `insert into project_members (project_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'owner'), ($1, $4, 'viewer')`,
    [id, OWNER, SECOND_OWNER, VIEWER],
  );
  return id;
}

/** What the server stores once a person came back from GitLab. */
async function account(userId: string) {
  await admin.query(
    `insert into git_accounts
       (user_id, base_url, account_id, account_username, account_name,
        access_token, refresh_token, expires_at, scope)
     values ($1, 'https://gitlab.example.com', 7, 'olga', 'Olga Owner',
             'v1.sealed-access', 'v1.sealed-refresh', now() + interval '2 hours', 'api')
     on conflict (user_id) do nothing`,
    [userId],
  );
}

/** What the server stores once an owner with an account picked the project's repository. */
async function connect(projectId: string, userId = OWNER) {
  await account(userId);
  await admin.query(
    `insert into git_connections
       (project_id, base_url, connected_by, account_id, account_username, account_name)
     values ($1, 'https://gitlab.example.com', $2, 7, 'olga', 'Olga Owner')`,
    [projectId, userId],
  );
}

async function connected(projectId: string) {
  const { rows } = await admin.query<{ connected_by: string }>(
    'select connected_by from git_connections where project_id = $1',
    [projectId],
  );
  return rows.map((row) => row.connected_by);
}

async function hasAccount(userId: string) {
  const { rowCount } = await admin.query('select 1 from git_accounts where user_id = $1', [userId]);
  return rowCount === 1;
}

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'git-owner@example.com', true),
      ($2, 'Otto Owner', 'git-second@example.com', true),
      ($3, 'Vera Viewer', 'git-viewer@example.com', true),
      ($4, 'Sam Stranger', 'git-stranger@example.com', true)`,
    [OWNER, SECOND_OWNER, VIEWER, STRANGER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('git_connections', () => {
  it('is read by every member of the project, and by nobody else', async () => {
    const projectId = await newProject();
    await connect(projectId);
    const read = (userId: string) =>
      asUser(app, userId, async (client) => {
        const { rows } = await client.query<{ account_username: string }>(
          'select account_username from git_connections where project_id = $1',
          [projectId],
        );
        return rows;
      });

    expect(await read(VIEWER)).toEqual([{ account_username: 'olga' }]);
    expect(await read(SECOND_OWNER)).toEqual([{ account_username: 'olga' }]);
    expect(await read(STRANGER)).toEqual([]);
  });

  it('is written by the server only', async () => {
    const projectId = await newProject();
    await connect(projectId);
    const attempt = (sql: string) => asUser(app, OWNER, (client) => client.query(sql, [projectId]));

    await expect(
      attempt(`update git_connections set account_username = 'eve' where project_id = $1`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      attempt('delete from git_connections where project_id = $1'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      attempt(
        `insert into git_connections (project_id, base_url, connected_by, account_id, account_username)
         select gen_random_uuid(), 'https://gitlab.example.com', connected_by, 1, 'eve'
         from git_connections where project_id = $1`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('holds a repository as a whole or not at all', async () => {
    const projectId = await newProject();
    await connect(projectId);

    await expect(
      admin.query('update git_connections set repository_id = 42 where project_id = $1', [
        projectId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await admin.query(
      `update git_connections
       set repository_id = 42, repository_path = 'verein/app', repository_name = 'App',
           repository_url = 'https://gitlab.example.com/verein/app',
           repository_default_branch = 'main'
       where project_id = $1`,
      [projectId],
    );
    const { rows } = await admin.query<{ repository_path: string }>(
      'select repository_path from git_connections where project_id = $1',
      [projectId],
    );
    expect(rows).toEqual([{ repository_path: 'verein/app' }]);
  });

  it('exists once per project, and only for someone with an account', async () => {
    const projectId = await newProject();
    await connect(projectId);

    await expect(connect(projectId, SECOND_OWNER)).rejects.toMatchObject({ code: '23505' });
    // Without an account there are no tokens to read the repository with.
    await expect(
      admin.query(
        `insert into git_connections
           (project_id, base_url, connected_by, account_id, account_username)
         values ($1, 'https://gitlab.example.com', $2, 9, 'vera')`,
        [await newProject(), VIEWER],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

describe('git_accounts', () => {
  it('cannot be read or written by any user, not even by the person it belongs to', async () => {
    await account(OWNER);
    const attempt = (sql: string) => asUser(app, OWNER, (client) => client.query(sql, [OWNER]));

    await expect(
      attempt('select access_token from git_accounts where user_id = $1'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      attempt('select account_username from git_accounts where user_id = $1'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      attempt(`update git_accounts set access_token = 'mine' where user_id = $1`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(attempt('delete from git_accounts where user_id = $1')).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('exists once per person, for all of their projects', async () => {
    const first = await newProject();
    const second = await newProject();

    await connect(first);
    await connect(second);

    expect(await connected(first)).toEqual([OWNER]);
    expect(await connected(second)).toEqual([OWNER]);
    const { rows } = await admin.query('select 1 from git_accounts where user_id = $1', [OWNER]);
    expect(rows).toHaveLength(1);
  });
});

describe('a connection ends by itself', () => {
  it('when the person disconnects their account, in every project it served', async () => {
    const person = randomUUID();
    await admin.query(
      `insert into users (id, name, email, email_verified) values ($1, 'Pia Person', $2, true)`,
      [person, `git-${person}@example.com`],
    );
    const first = await newProject();
    const second = await newProject();
    const other = await newProject();
    for (const projectId of [first, second]) {
      await admin.query(
        `insert into project_members (project_id, user_id, role) values ($1, $2, 'owner')`,
        [projectId, person],
      );
      await connect(projectId, person);
    }
    await connect(other);

    await admin.query('delete from git_accounts where user_id = $1', [person]);

    expect(await connected(first)).toEqual([]);
    expect(await connected(second)).toEqual([]);
    // Someone else's connection is not touched.
    expect(await connected(other)).toEqual([OWNER]);
  });

  it('when the owner who connected leaves the project or is removed; the account stays', async () => {
    const projectId = await newProject();
    await connect(projectId);

    // Someone else leaving changes nothing.
    await admin.query('delete from project_members where project_id = $1 and user_id = $2', [
      projectId,
      VIEWER,
    ]);
    expect(await connected(projectId)).toEqual([OWNER]);

    await admin.query('delete from project_members where project_id = $1 and user_id = $2', [
      projectId,
      OWNER,
    ]);
    expect(await connected(projectId)).toEqual([]);
    expect(await hasAccount(OWNER)).toBe(true);
  });

  it('when the owner who connected is no owner any more', async () => {
    const projectId = await newProject();
    await connect(projectId, SECOND_OWNER);
    const setRole = (userId: string, role: string) =>
      admin.query('update project_members set role = $3 where project_id = $1 and user_id = $2', [
        projectId,
        userId,
        role,
      ]);

    // Another member's role, and a change that keeps the owner an owner, change nothing.
    await setRole(VIEWER, 'editor');
    await setRole(SECOND_OWNER, 'owner');
    expect(await connected(projectId)).toEqual([SECOND_OWNER]);

    await setRole(SECOND_OWNER, 'editor');
    expect(await connected(projectId)).toEqual([]);
    expect(await hasAccount(SECOND_OWNER)).toBe(true);
  });

  it('when the person or the project is deleted', async () => {
    const first = await newProject();
    const second = await newProject();
    const leaving = randomUUID();
    await admin.query(
      `insert into users (id, name, email, email_verified)
       values ($1, 'Lea Leaving', $2, true)`,
      [leaving, `git-${leaving}@example.com`],
    );
    await admin.query(
      `insert into project_members (project_id, user_id, role) values ($1, $2, 'owner')`,
      [first, leaving],
    );
    await connect(first, leaving);
    await connect(second);

    await admin.query('delete from users where id = $1', [leaving]);
    await admin.query('delete from projects where id = $1', [second]);

    expect(await connected(first)).toEqual([]);
    expect(await hasAccount(leaving)).toBe(false);
    expect(await connected(second)).toEqual([]);
    // The account of the owner of the deleted project is still theirs.
    expect(await hasAccount(OWNER)).toBe(true);
  });
});

describe('a change of the connection', () => {
  it('is announced on the live channel, also when it ends with an account', async () => {
    const person = randomUUID();
    await admin.query(
      `insert into users (id, name, email, email_verified) values ($1, 'Ada Account', $2, true)`,
      [person, `git-${person}@example.com`],
    );
    const projectId = await newProject();
    await admin.query(
      `insert into project_members (project_id, user_id, role) values ($1, $2, 'owner')`,
      [projectId, person],
    );
    const heard: string[] = [];
    const listener = await admin.connect();
    listener.on('notification', (message) => {
      // Other tests announce on the same channel.
      let payload: { kind?: string; projectId?: string };
      try {
        payload = JSON.parse(message.payload ?? '{}') as typeof payload;
      } catch {
        return;
      }
      if (payload.projectId === projectId && payload.kind) heard.push(payload.kind);
    });
    await listener.query('listen covibes_live');
    try {
      await connect(projectId, person);
      await admin.query(`update git_connections set account_name = 'Ada' where project_id = $1`, [
        projectId,
      ]);
      await admin.query('delete from git_accounts where user_id = $1', [person]);
      await expect.poll(() => heard).toEqual(['git', 'git', 'git']);
    } finally {
      await listener.query('unlisten covibes_live');
      listener.release();
    }
  });
});
