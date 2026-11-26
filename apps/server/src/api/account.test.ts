import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';

import { withUser } from '@server/db/database';
import { cleanStoredFile } from '@server/tasks/file-cleanup';
import { APP_URL, createTestServer } from '@server/testing';

const test = createTestServer();

const origin = { origin: APP_URL, 'content-type': 'application/json' };
const post = (path: string, cookie: string, body: unknown) =>
  test.app.request(`/api${path}`, {
    method: 'POST',
    headers: { ...origin, cookie },
    body: JSON.stringify(body),
  });

async function person() {
  const email = `${randomUUID()}@example.com`;
  const cookie = await test.signIn(email);
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  return { email, cookie, id: session.user.id, sessionId: session.session.id };
}

async function privateProject(cookie: string) {
  const created = await post('/projects', cookie, { name: 'Private account project' });
  expect(created.status).toBe(201);
  const project = (await created.json()) as { id: string };
  const form = new FormData();
  form.set('file', new File(['Account notes'], 'account-notes.txt'));
  const uploaded = await test.app.request(`/api/projects/${project.id}/files`, {
    method: 'POST',
    headers: { origin: APP_URL, cookie },
    body: form,
  });
  expect(uploaded.status).toBe(201);
  const file = await test.db.admin
    .selectFrom('files')
    .select(['id', 'storage_key'])
    .where('project_id', '=', project.id)
    .executeTakeFirstOrThrow();
  return { ...project, fileId: file.id, key: file.storage_key };
}

/** A stale session requests a new, email-bound proof before the built-in deletion callback. */
async function deletionLink(account: Awaited<ReturnType<typeof person>>) {
  await test.db.adminPool.query(
    "update sessions set created_at = now() - interval '10 minutes' where id = $1",
    [account.sessionId],
  );
  const requested = await post('/auth/delete-user', account.cookie, { callbackURL: '/login' });
  expect(requested.status).toBe(200);
  const link = test.outbox
    ?.list()
    .find((mail) => mail.to === account.email)
    ?.text.match(/https?:\/\/\S+/)?.[0];
  if (!link) throw new Error('No account deletion proof was delivered');
  return link;
}

describe('personal account data (spec 42)', () => {
  it('requires a session and exports only the requesting person without credentials', async () => {
    expect((await test.app.request('/api/account/export')).status).toBe(401);
    const ownerEmail = `${randomUUID()}@example.com`;
    const cookie = await test.signIn(ownerEmail);
    const other = await test.signIn();
    const create = await test.app.request('/api/projects', {
      method: 'POST',
      headers: { cookie, origin: APP_URL, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Private project' }),
    });
    expect(create.status).toBe(201);
    const exported = await test.app.request('/api/account/export', { headers: { cookie } });
    expect(exported.headers.get('cache-control')).toBe('no-store');
    expect(exported.headers.get('content-disposition')).toContain('attachment');
    const data = (await exported.json()) as {
      profile: { id: string; email: string };
      memberships: unknown[];
    };
    expect(data.profile.email).toBe(ownerEmail);
    expect(data.memberships).toHaveLength(1);
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain('session_token');
    expect(serialized).not.toContain('access_token');
    expect(serialized).not.toContain('backup_codes');
    expect(serialized).not.toContain('storage_key');
    const otherSession = await test.auth.api.getSession({
      headers: new Headers({ cookie: other }),
    });
    expect(serialized).not.toContain(otherSession?.user.id);
  });

  it('does not allow the application role to read authentication secrets or beta invitations', async () => {
    const cookie = await test.signIn();
    const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
    if (!session) throw new Error('No session');
    for (const table of ['account_two_factors', 'account_passkeys', 'beta_invitations']) {
      await expect(
        withUser(test.db.app, session.user.id, (trx) =>
          sql`select * from ${sql.table(table)}`.execute(trx),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('validates profile names and revokes another session without accepting another user’s token', async () => {
    const email = `${randomUUID()}@example.com`;
    const cookie = await test.signIn(email);
    const second = await test.signIn(email);
    const stranger = await test.signIn();
    const headers = { cookie, origin: APP_URL, 'content-type': 'application/json' };
    const update = (name: string) =>
      test.app.request('/api/auth/update-user', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name }),
      });
    expect((await update('   ')).status).toBe(400);
    expect((await update('x'.repeat(81))).status).toBe(400);
    expect((await update('  A person  ')).status).toBe(200);
    const session = await test.auth.api.getSession({ headers: new Headers({ cookie: second }) });
    if (!session) throw new Error('No other session');
    const denied = await test.app.request('/api/auth/revoke-session', {
      method: 'POST',
      headers: { ...headers, cookie: stranger },
      body: JSON.stringify({ token: session.session.token }),
    });
    // The library deliberately returns success for unknown/foreign tokens, without revealing
    // their existence. The meaningful permission assertion is that the foreign session survives.
    expect(denied.status).toBe(200);
    expect(
      await test.auth.api.getSession({ headers: new Headers({ cookie: second }) }),
    ).toMatchObject({ user: { email } });
    const revoked = await test.app.request('/api/auth/revoke-session', {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: session.session.token }),
    });
    expect(revoked.status).toBe(200);
    expect(
      await (
        await test.app.request('/api/auth/get-session', { headers: { cookie: second } })
      ).json(),
    ).toBeNull();
  });
});

describe('confirmed account deletion with workspace lifecycle', () => {
  it('deletes private projects only after renewed proof and durably queues their stored files', async () => {
    const owner = await person();
    const project = await privateProject(owner.cookie);
    const board = await test.db.admin
      .selectFrom('boards')
      .select('id')
      .where('project_id', '=', project.id)
      .executeTakeFirstOrThrow();
    const names = [`board:${board.id}`, `plan:${project.id}`];
    for (const name of names)
      await test.db.adminPool.query('insert into yjs_documents(name,state) values($1,$2)', [
        name,
        Buffer.from([0, 0]),
      ]);

    const link = await deletionLink(owner);
    expect(
      await test.db.admin
        .selectFrom('projects')
        .select('id')
        .where('id', '=', project.id)
        .execute(),
    ).toHaveLength(1);
    expect(await test.files.get(project.key)).toBeDefined();
    const deleted = await test.app.request(link, { headers: { cookie: owner.cookie } });
    expect(deleted.status).toBe(302);
    expect(
      await test.auth.api.getSession({ headers: new Headers({ cookie: owner.cookie }) }),
    ).toBeNull();
    for (const table of ['users', 'projects', 'files'] as const) {
      const id = table === 'users' ? owner.id : table === 'files' ? project.fileId : project.id;
      expect(
        await test.db.admin.selectFrom(table).select('id').where('id', '=', id).execute(),
      ).toEqual([]);
    }
    expect(
      (await test.db.adminPool.query('select name from yjs_documents where name=any($1)', [names]))
        .rows,
    ).toEqual([]);
    expect(
      await test.db.admin
        .selectFrom('file_cleanup')
        .select('storage_key')
        .where('storage_key', '=', project.key)
        .execute(),
    ).toEqual([{ storage_key: project.key }]);
    expect(
      (
        await test.db.adminPool.query('select key from graphile_worker.jobs where key=$1', [
          `file_cleanup:${project.key}`,
        ])
      ).rows,
    ).toEqual([{ key: `file_cleanup:${project.key}` }]);
    expect(await test.files.get(project.key)).toBeDefined();
    expect(await cleanStoredFile(test.db.admin, test.files, project.key)).toBe('deleted');
    expect(await test.files.get(project.key)).toBeUndefined();
    expect(await cleanStoredFile(test.db.admin, test.files, project.key)).toBe('nothing');
    expect((await test.app.request(link, { headers: { cookie: owner.cookie } })).status).not.toBe(
      302,
    );
  });

  it.each(['project', 'workspace'] as const)(
    'preserves the account, private files and shared data when sole %s ownership blocks confirmation',
    async (kind) => {
      const owner = await person();
      const colleague = await person();
      const privateData = await privateProject(owner.cookie);
      let sharedId: string;
      if (kind === 'project') {
        const shared = await post('/projects', owner.cookie, { name: 'Shared account project' });
        expect(shared.status).toBe(201);
        sharedId = ((await shared.json()) as { id: string }).id;
        await test.db.adminPool.query(
          "insert into project_members(project_id,user_id,role) values($1,$2,'editor')",
          [sharedId, colleague.id],
        );
      } else {
        const shared = await post('/workspaces', owner.cookie, { name: 'Shared account team' });
        expect(shared.status).toBe(201);
        sharedId = ((await shared.json()) as { id: string }).id;
        const invited = await post(`/workspaces/${sharedId}/invitations`, owner.cookie, {
          email: colleague.email,
        });
        expect(invited.status).toBe(201);
        const { token } = (await invited.json()) as { token: string };
        expect(
          (await post(`/workspaces/invitations/${token}/accept`, colleague.cookie, {})).status,
        ).toBe(200);
      }

      const link = await deletionLink(owner);
      const blocked = await test.app.request(link, { headers: { cookie: owner.cookie } });
      expect(blocked.status).toBe(409);
      expect(await blocked.json()).toMatchObject({ code: 'LAST_OWNER' });
      expect(
        await test.auth.api.getSession({ headers: new Headers({ cookie: owner.cookie }) }),
      ).toMatchObject({ user: { id: owner.id } });
      expect(
        await test.db.admin
          .selectFrom('projects')
          .select('id')
          .where('id', '=', privateData.id)
          .execute(),
      ).toHaveLength(1);
      expect(
        await test.db.admin
          .selectFrom('files')
          .select('id')
          .where('id', '=', privateData.fileId)
          .execute(),
      ).toHaveLength(1);
      expect(
        await test.db.admin
          .selectFrom('file_cleanup')
          .select('storage_key')
          .where('storage_key', '=', privateData.key)
          .execute(),
      ).toEqual([]);
      expect(await test.files.get(privateData.key)).toBeDefined();
      const accessPath =
        kind === 'project' ? `/api/projects/${sharedId}` : `/api/workspaces/${sharedId}/members`;
      expect(
        (await test.app.request(accessPath, { headers: { cookie: colleague.cookie } })).status,
      ).toBe(200);
    },
  );
});
