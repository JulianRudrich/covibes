import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// The connection of a project to GitLab (spec 28a): who reads it, who never reads the tokens, and
// when it ends by itself.
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

/** What the server stores once an owner came back from GitLab. */
async function connect(projectId: string, userId = OWNER) {
  await admin.query(
    `insert into git_connections
       (project_id, base_url, connected_by, account_id, account_username, account_name)
     values ($1, 'https://gitlab.example.com', $2, 7, 'olga', 'Olga Owner')`,
    [projectId, userId],
  );
  await admin.query(
    `insert into oauth_tokens (project_id, access_token, refresh_token, expires_at, scope)
     values ($1, 'v1.sealed-access', 'v1.sealed-refresh', now() + interval '2 hours', 'api')`,
    [projectId],
  );
}

async function counts(projectId: string) {
  const { rows } = await admin.query<{ connections: number; tokens: number }>(
    `select (select count(*)::int from git_connections where project_id = $1) as connections,
            (select count(*)::int from oauth_tokens where project_id = $1) as tokens`,
    [projectId],
  );
  return rows[0];
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

  it('exists once per project', async () => {
    const projectId = await newProject();
    await connect(projectId);

    await expect(connect(projectId, SECOND_OWNER)).rejects.toMatchObject({ code: '23505' });
  });
});

describe('oauth_tokens', () => {
  it('cannot be read or written by any user, not even the owner who connected', async () => {
    const projectId = await newProject();
    await connect(projectId);
    const attempt = (sql: string) => asUser(app, OWNER, (client) => client.query(sql, [projectId]));

    await expect(
      attempt('select access_token from oauth_tokens where project_id = $1'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      attempt(`update oauth_tokens set access_token = 'mine' where project_id = $1`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(attempt('delete from oauth_tokens where project_id = $1')).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('go with their connection', async () => {
    const projectId = await newProject();
    await connect(projectId);

    await admin.query('delete from git_connections where project_id = $1', [projectId]);

    expect(await counts(projectId)).toEqual({ connections: 0, tokens: 0 });
  });
});

describe('a connection ends by itself', () => {
  it('when the owner who connected leaves the project or is removed', async () => {
    const projectId = await newProject();
    await connect(projectId);

    // Someone else leaving changes nothing.
    await admin.query('delete from project_members where project_id = $1 and user_id = $2', [
      projectId,
      VIEWER,
    ]);
    expect(await counts(projectId)).toEqual({ connections: 1, tokens: 1 });

    await admin.query('delete from project_members where project_id = $1 and user_id = $2', [
      projectId,
      OWNER,
    ]);
    expect(await counts(projectId)).toEqual({ connections: 0, tokens: 0 });
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
    expect(await counts(projectId)).toEqual({ connections: 1, tokens: 1 });

    await setRole(SECOND_OWNER, 'editor');
    expect(await counts(projectId)).toEqual({ connections: 0, tokens: 0 });
  });

  it('when the account of the owner who connected is deleted, and with its project', async () => {
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

    expect(await counts(first)).toEqual({ connections: 0, tokens: 0 });
    expect(await counts(second)).toEqual({ connections: 0, tokens: 0 });
  });
});

describe('a change of the connection', () => {
  it('is announced on the live channel', async () => {
    const projectId = await newProject();
    const heard: string[] = [];
    const listener = await admin.connect();
    listener.on('notification', (message) => {
      const payload = JSON.parse(message.payload ?? '{}') as { kind?: string; projectId?: string };
      if (payload.projectId === projectId && payload.kind) heard.push(payload.kind);
    });
    await listener.query('listen covibes_live');
    try {
      await connect(projectId);
      await admin.query(`update git_connections set account_name = 'Olga' where project_id = $1`, [
        projectId,
      ]);
      await admin.query('delete from git_connections where project_id = $1', [projectId]);
      await expect.poll(() => heard).toEqual(['git', 'git', 'git']);
    } finally {
      await listener.query('unlisten covibes_live');
      listener.release();
    }
  });
});
