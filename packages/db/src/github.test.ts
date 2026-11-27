import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });
afterAll(async () => {
  await admin.end();
  await app.end();
});

async function person() {
  const id = randomUUID();
  await admin.query(
    'insert into users(id, email, name, email_verified) values ($1, $2, $3, true)',
    [id, `github-${id}@example.com`, 'App owner'],
  );
  return id;
}
async function githubAccount(userId: string) {
  await admin.query(
    "insert into github_accounts(user_id, account_id, login, access_token) values ($1, 77, 'owner', 'v1.encrypted-fixture')",
    [userId],
  );
}
async function gitlabAccount(userId: string) {
  await admin.query(
    "insert into git_accounts(user_id, base_url, account_id, account_username, access_token) values ($1, 'https://gitlab.com', 88, 'owner', 'v1.encrypted-fixture')",
    [userId],
  );
}
async function connect(userId: string, provider: 'github' | 'gitlab') {
  const projectId = randomUUID();
  await admin.query(
    "insert into projects(id, name, owner_id) values ($1, 'Provider project', $2)",
    [projectId, userId],
  );
  await admin.query(
    "insert into project_members(project_id, user_id, role) values ($1, $2, 'owner')",
    [projectId, userId],
  );
  await admin.query(
    `insert into git_connections(project_id, provider, base_url, connected_by, account_id, account_username, repository_id, repository_path, repository_name, repository_url)
    values ($1, $2, $3, $4, 77, 'owner', 987, 'owner/project', 'project', $5)`,
    [
      projectId,
      provider,
      `https://${provider}.com`,
      userId,
      `https://${provider}.com/owner/project`,
    ],
  );
  if (provider === 'github')
    await admin.query(
      'insert into github_installations(project_id, user_id, installation_id, repository_id) values ($1, $2, 45, 987)',
      [projectId, userId],
    );
  return projectId;
}

describe('private GitHub integration storage', () => {
  it.each([
    'github_accounts',
    'github_installations',
    'github_oauth_states',
    'github_webhook_deliveries',
  ] as const)('%s has RLS and no application-role read or write access', async (table) => {
    const userId = await person();
    const flags = await admin.query<{ relrowsecurity: boolean }>(
      'select relrowsecurity from pg_class where oid = $1::regclass',
      [`public.${table}`],
    );
    expect(flags.rows[0]?.relrowsecurity).toBe(true);
    for (const query of [
      `select * from ${table}`,
      `delete from ${table} where false`,
      `insert into ${table} default values`,
    ]) {
      await expect(asUser(app, userId, (client) => client.query(query))).rejects.toMatchObject({
        code: '42501',
      });
    }
  });

  it('preserves the own-account invariant for both providers and cascades each account independently', async () => {
    const userId = await person();
    await expect(connect(userId, 'github')).rejects.toMatchObject({ code: '23503' });
    await expect(connect(userId, 'gitlab')).rejects.toMatchObject({ code: '23503' });
    await githubAccount(userId);
    await gitlabAccount(userId);
    const hub = await connect(userId, 'github');
    const lab = await connect(userId, 'gitlab');
    await admin.query('delete from git_accounts where user_id = $1', [userId]);
    const first = await admin.query<{ project_id: string }>(
      'select project_id from git_connections where project_id = any($1::uuid[])',
      [[hub, lab]],
    );
    expect(first.rows).toEqual([{ project_id: hub }]);
    expect(
      (await admin.query('select 1 from github_installations where project_id = $1', [hub]))
        .rowCount,
    ).toBe(1);
    await admin.query('delete from github_accounts where user_id = $1', [userId]);
    expect(
      (await admin.query('select 1 from git_connections where project_id = $1', [hub])).rowCount,
    ).toBe(0);
    expect(
      (await admin.query('select 1 from github_installations where project_id = $1', [hub]))
        .rowCount,
    ).toBe(0);
  });

  it('snapshots the provider and requires that provider account for an approval', async () => {
    const owner = await person();
    const approver = await person();
    await githubAccount(owner);
    await gitlabAccount(approver);
    const projectId = await connect(owner, 'github');
    await admin.query(
      "insert into project_members(project_id, user_id, role, can_approve_git) values ($1, $2, 'editor', true)",
      [projectId, approver],
    );
    const requestId = randomUUID();
    await admin.query(
      `insert into git_requests(id, project_id, kind, base_url, repository_id, repository_path, repository_url, requested_by)
      values ($1, $2, 'issues', 'https://github.com', 987, 'owner/project', 'https://github.com/owner/project', $3)`,
      [requestId, projectId, owner],
    );
    expect(
      (
        await admin.query<{ provider: string }>('select provider from git_requests where id = $1', [
          requestId,
        ])
      ).rows[0]?.provider,
    ).toBe('github');
    const approve = () =>
      asUser(app, approver, (client) =>
        client.query<{ count: number }>(
          'select public.approve_git_requests($1, $2::uuid[]) as count',
          [projectId, [requestId]],
        ),
      );
    await expect(approve()).rejects.toMatchObject({ code: '28000' });
    await githubAccount(approver);
    expect((await approve()).rows[0]?.count).toBe(1);
    await admin.query('delete from git_connections where project_id = $1', [projectId]);
    // Removing the connection does not let the now-unbound request be approved through another host.
    expect((await approve()).rows[0]?.count).toBe(0);
  });
});
