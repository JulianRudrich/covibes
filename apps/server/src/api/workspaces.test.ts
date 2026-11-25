import { randomUUID } from 'node:crypto';

import type {
  ProjectDetails,
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspaceSummary,
} from '@covibes/shared';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';

import { withUser } from '@server/db/database';
import { APP_URL, createTestServer } from '@server/testing';
import { prepareAccountDeletion } from '@server/workspaces/lifecycle';

const test = createTestServer();

function request(path: string, cookie: string, method = 'GET', body?: unknown) {
  return test.app.request(`/api${path}`, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function person() {
  const email = `${randomUUID()}@example.com`;
  const cookie = await test.signIn(email);
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('Missing session');
  return { cookie, id: session.user.id, email };
}
async function team(cookie: string) {
  const response = await request('/workspaces', cookie, 'POST', { name: 'Launch team' });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}
async function project(cookie: string, workspaceId?: string) {
  const response = await request(
    workspaceId ? `/workspaces/${workspaceId}/projects` : '/projects',
    cookie,
    'POST',
    { name: 'Shared architecture', language: 'en' },
  );
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const details = await request(`/projects/${id}`, cookie);
  expect(details.status).toBe(200);
  return (await details.json()) as ProjectDetails;
}
async function invite(cookie: string, workspaceId: string, role = 'editor', email?: string) {
  const response = await request(`/workspaces/${workspaceId}/invitations`, cookie, 'POST', {
    role,
    email,
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; token: string };
}
async function join(owner: string, workspaceId: string, member: string, role = 'editor') {
  const invitation = await invite(owner, workspaceId, role);
  expect(
    (await request(`/workspaces/invitations/${invitation.token}/accept`, member, 'POST')).status,
  ).toBe(200);
}
async function role(projectId: string, userId: string) {
  const row = await test.db.admin
    .selectFrom('project_members')
    .select('role')
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row?.role;
}

describe('workspace provider settings', () => {
  it('limits key management and provider spend to owners, keeping every secret private', async () => {
    const owner = await person();
    const editor = await person();
    const outsider = await person();
    const workspace = await team(owner.cookie);
    await join(owner.cookie, workspace.id, editor.cookie);
    const path = '/workspaces/' + workspace.id + '/ai';
    const key = 'fixture-provider-secret';
    for (const account of [editor, outsider]) {
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const response = await request(
          method === 'GET' ? path : path + '/openai',
          account.cookie,
          method,
          method === 'PUT' ? { key } : undefined,
        );
        expect([403, 404]).toContain(response.status);
      }
    }
    expect((await request(path + '/unknown', owner.cookie, 'PUT', { key })).status).toBe(400);
    expect((await request(path + '/openai', owner.cookie, 'PUT', { key })).status).toBe(204);
    const status = await (await request(path, owner.cookie)).json();
    expect(status).toMatchObject({
      configured: ['openai'],
      spending: { instanceUsd: 0, workspaceUsd: 0 },
    });
    const stored = await test.db.admin
      .selectFrom('workspace_provider_keys')
      .select('ciphertext')
      .where('workspace_id', '=', workspace.id)
      .executeTakeFirstOrThrow();
    expect(stored.ciphertext).not.toContain(key);
    expect(JSON.stringify(status)).not.toContain(stored.ciphertext);
    expect(JSON.stringify(status)).not.toContain(key);
    await expect(
      withUser(test.db.app, owner.id, (trx) =>
        sql`select * from workspace_provider_keys`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
    expect(
      (await request(path + '/openai', owner.cookie, 'PUT', { key: key + '-replacement' })).status,
    ).toBe(204);
    expect((await request(path + '/openai', owner.cookie, 'DELETE')).status).toBe(204);
    expect(await (await request(path, owner.cookie)).json()).toMatchObject({ configured: [] });
  });
});

describe('workspace boundaries', () => {
  it('creates one personal workspace and keeps legacy project creation compatible', async () => {
    const owner = await person();
    const legacy = await project(owner.cookie);
    const list = (await (await request('/workspaces', owner.cookie)).json()) as WorkspaceSummary[];
    expect(list).toEqual([
      expect.objectContaining({ kind: 'personal', role: 'owner', projectCount: 1, memberCount: 1 }),
    ]);
    const stored = await test.db.admin
      .selectFrom('projects')
      .select('workspace_id')
      .where('id', '=', legacy.id)
      .executeTakeFirstOrThrow();
    expect(stored.workspace_id).toBe(list[0]?.id);
    const workspaceId = list[0]?.id;
    if (!workspaceId) throw new Error('Missing personal workspace');
    expect((await request(`/workspaces/${workspaceId}`, owner.cookie, 'DELETE')).status).toBe(409);
    expect(
      (
        await request(`/workspaces/${workspaceId}/invitations`, owner.cookie, 'POST', {
          role: 'editor',
        })
      ).status,
    ).toBe(403);
  });

  it('isolates workspaces, validates inputs, and keeps token hashes private to the database', async () => {
    const owner = await person();
    const outsider = await person();
    const workspace = await team(owner.cookie);
    await project(owner.cookie, workspace.id);
    const lists = (await (
      await request('/workspaces', outsider.cookie)
    ).json()) as WorkspaceSummary[];
    expect(lists.some((row) => row.id === workspace.id)).toBe(false);
    expect((await request(`/workspaces/${workspace.id}/projects`, outsider.cookie)).status).toBe(
      404,
    );
    expect(
      (await request(`/workspaces/${workspace.id}`, outsider.cookie, 'PATCH', { name: 'Stolen' }))
        .status,
    ).toBe(403);
    expect((await request('/workspaces', owner.cookie, 'POST', { name: ' ' })).status).toBe(400);
    const invitation = await invite(owner.cookie, workspace.id);
    const stored = await test.db.admin
      .selectFrom('workspace_invitations')
      .select('token_hash')
      .where('id', '=', invitation.id)
      .executeTakeFirstOrThrow();
    expect(stored.token_hash).not.toBe(invitation.token);
    await expect(
      withUser(test.db.app, owner.id, (trx) =>
        sql`select token_hash from workspace_invitations`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
    const publicInvites = (await (
      await request(`/workspaces/${workspace.id}/invitations`, owner.cookie)
    ).json()) as WorkspaceInvitation[];
    expect(publicInvites).toHaveLength(1);
    expect(publicInvites[0]).not.toHaveProperty('token_hash');
    expect(
      (
        await request(`/workspaces/${workspace.id}/invitations`, owner.cookie, 'POST', {
          role: 'owner',
        })
      ).status,
    ).toBe(400);
  });

  it('requires the verified invited identity, rejects replay, and supports revocation', async () => {
    const owner = await person();
    const target = await person();
    const outsider = await person();
    const workspace = await team(owner.cookie);
    const invitation = await invite(owner.cookie, workspace.id, 'viewer', target.email);
    const accept = (cookie: string) =>
      request(`/workspaces/invitations/${invitation.token}/accept`, cookie, 'POST');
    expect((await accept(outsider.cookie)).status).toBe(403);
    await test.db.adminPool.query('update users set email_verified=false where id=$1', [target.id]);
    expect((await accept(target.cookie)).status).toBe(403);
    await test.db.adminPool.query('update users set email_verified=true where id=$1', [target.id]);
    expect((await accept(target.cookie)).status).toBe(200);
    expect((await accept(target.cookie)).status).toBe(409);
    const revoked = await invite(owner.cookie, workspace.id);
    expect(
      (
        await request(
          `/workspaces/${workspace.id}/invitations/${revoked.id}`,
          owner.cookie,
          'DELETE',
        )
      ).status,
    ).toBe(204);
    expect(
      (await request(`/workspaces/invitations/${revoked.token}/accept`, outsider.cookie, 'POST'))
        .status,
    ).toBe(409);
  });

  it('updates managed project access while preserving explicit roles', async () => {
    const owner = await person();
    const member = await person();
    const explicit = await person();
    const workspace = await team(owner.cookie);
    const first = await project(owner.cookie, workspace.id);
    await test.db.adminPool.query(
      "insert into project_members(project_id,user_id,role) values($1,$2,'viewer')",
      [first.id, explicit.id],
    );
    await join(owner.cookie, workspace.id, member.cookie);
    await join(owner.cookie, workspace.id, explicit.cookie);
    expect(await role(first.id, member.id)).toBe('editor');
    expect(await role(first.id, explicit.id)).toBe('viewer');
    const second = await project(owner.cookie, workspace.id);
    expect(await role(second.id, member.id)).toBe('editor');
    expect(
      (
        await request(`/workspaces/${workspace.id}/members/${member.id}`, owner.cookie, 'PATCH', {
          role: 'viewer',
        })
      ).status,
    ).toBe(204);
    expect(await role(first.id, member.id)).toBe('viewer');
    expect(
      (await request(`/workspaces/${workspace.id}/members/${member.id}`, owner.cookie, 'DELETE'))
        .status,
    ).toBe(204);
    expect(await role(first.id, member.id)).toBeUndefined();
    expect((await request(`/projects/${second.id}`, member.cookie)).status).toBe(404);
    expect(
      (await request(`/workspaces/${workspace.id}/members/${explicit.id}`, owner.cookie, 'DELETE'))
        .status,
    ).toBe(204);
    expect(await role(first.id, explicit.id)).toBe('viewer');
    expect(await role(second.id, explicit.id)).toBeUndefined();
  });

  it('preserves an explicitly changed project role after leaving the workspace', async () => {
    const owner = await person();
    const member = await person();
    const workspace = await team(owner.cookie);
    await join(owner.cookie, workspace.id, member.cookie);
    const created = await project(owner.cookie, workspace.id);
    await test.db.adminPool.query(
      "update project_members set role='viewer' where project_id=$1 and user_id=$2",
      [created.id, member.id],
    );
    expect(
      (await request(`/workspaces/${workspace.id}/members/${member.id}`, owner.cookie, 'DELETE'))
        .status,
    ).toBe(204);
    expect(await role(created.id, member.id)).toBe('viewer');
  });

  it('serializes concurrent owner removals and enforces personal and viewer restrictions', async () => {
    const owner = await person();
    const second = await person();
    const viewer = await person();
    const workspace = await team(owner.cookie);
    await join(owner.cookie, workspace.id, second.cookie);
    await join(owner.cookie, workspace.id, viewer.cookie, 'viewer');
    expect(
      (
        await request(`/workspaces/${workspace.id}/projects`, viewer.cookie, 'POST', {
          name: 'Denied',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(`/workspaces/${workspace.id}/members/${second.id}`, owner.cookie, 'PATCH', {
          role: 'owner',
        })
      ).status,
    ).toBe(204);
    const attempts = await Promise.all([
      request(`/workspaces/${workspace.id}/members/${owner.id}`, owner.cookie, 'DELETE'),
      request(`/workspaces/${workspace.id}/members/${second.id}`, second.cookie, 'DELETE'),
    ]);
    expect(attempts.map((response) => response.status).sort()).toEqual([204, 409]);
    const survivors = await test.db.admin
      .selectFrom('workspace_members')
      .select('user_id')
      .where('workspace_id', '=', workspace.id)
      .where('role', '=', 'owner')
      .execute();
    expect(survivors).toHaveLength(1);
    const members = (await (
      await request(`/workspaces/${workspace.id}/members`, viewer.cookie)
    ).json()) as WorkspaceMember[];
    expect(members.every((row) => !('email' in row))).toBe(true);
  });

  it('moves a project with explicit ownership and replaces only workspace grants', async () => {
    const owner = await person();
    const oldMember = await person();
    const newMember = await person();
    const oldTeam = await team(owner.cookie);
    const nextTeam = await team(owner.cookie);
    await join(owner.cookie, oldTeam.id, oldMember.cookie);
    await join(owner.cookie, nextTeam.id, newMember.cookie, 'viewer');
    const created = await project(owner.cookie, oldTeam.id);
    expect((await request(`/workspaces/${oldTeam.id}`, owner.cookie, 'DELETE')).status).toBe(409);
    expect(
      (
        await request(`/projects/${created.id}/workspace`, oldMember.cookie, 'POST', {
          workspaceId: nextTeam.id,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(`/projects/${created.id}/workspace`, owner.cookie, 'POST', {
          workspaceId: nextTeam.id,
        })
      ).status,
    ).toBe(204);
    expect(await role(created.id, owner.id)).toBe('owner');
    expect(await role(created.id, oldMember.id)).toBeUndefined();
    expect(await role(created.id, newMember.id)).toBe('viewer');
    expect((await request(`/workspaces/${oldTeam.id}`, owner.cookie, 'DELETE')).status).toBe(204);
  });
});

describe('project and account deletion', () => {
  it('requires owner confirmation and deletes files and document rows without resurrection', async () => {
    const owner = await person();
    const created = await project(owner.cookie);
    const form = new FormData();
    form.set('file', new File(['Architecture notes'], 'notes.txt'));
    expect(
      (
        await test.app.request(`/api/projects/${created.id}/files`, {
          method: 'POST',
          headers: { cookie: owner.cookie, origin: APP_URL },
          body: form,
        })
      ).status,
    ).toBe(201);
    const key = test.files.keys()[0];
    expect(key).toBeDefined();
    const boardId = created.boards[0]?.id;
    if (!boardId) throw new Error('Missing main board');
    const names = [`board:${boardId}`, `plan:${created.id}`];
    for (const name of names)
      await test.db.adminPool.query('insert into yjs_documents(name,state) values($1,$2)', [
        name,
        Buffer.from([0, 0]),
      ]);
    expect(
      (await request(`/projects/${created.id}`, owner.cookie, 'DELETE', { confirmName: 'wrong' }))
        .status,
    ).toBe(409);
    expect(test.files.keys()).toContain(key);
    expect(
      (
        await request(`/projects/${created.id}`, owner.cookie, 'DELETE', {
          confirmName: created.name,
        })
      ).status,
    ).toBe(204);
    expect(test.files.keys()).not.toContain(key);
    expect((await request(`/projects/${created.id}`, owner.cookie)).status).toBe(404);
    for (const name of names)
      await test.db.adminPool.query(
        'insert into yjs_documents(name,state) values($1,$2) on conflict(name) do update set state=excluded.state',
        [name, Buffer.from([0, 0])],
      );
    expect(
      (await test.db.adminPool.query('select name from yjs_documents where name=any($1)', [names]))
        .rows,
    ).toEqual([]);
  });

  it('blocks sole ownership of shared data atomically but preserves it after transfer', async () => {
    const owner = await person();
    const colleague = await person();
    const privateProject = await project(owner.cookie);
    const sharedProject = await project(owner.cookie);
    await test.db.adminPool.query(
      "insert into project_members(project_id,user_id,role) values($1,$2,'editor')",
      [sharedProject.id, colleague.id],
    );
    await expect(prepareAccountDeletion(test.db.adminPool, owner.id)).rejects.toMatchObject({
      status: 'CONFLICT',
    });
    await expect(
      test.db.adminPool.query('delete from users where id=$1', [owner.id]),
    ).rejects.toThrow(/Transfer shared project ownership/);
    expect(
      await test.db.admin
        .selectFrom('projects')
        .select('id')
        .where('id', '=', privateProject.id)
        .execute(),
    ).toHaveLength(1);
    await test.db.adminPool.query(
      "update project_members set role='owner' where project_id=$1 and user_id=$2",
      [sharedProject.id, colleague.id],
    );
    await prepareAccountDeletion(test.db.adminPool, owner.id);
    await test.db.adminPool.query('delete from users where id=$1', [owner.id]);
    expect(
      await test.db.admin
        .selectFrom('projects')
        .select('id')
        .where('id', '=', privateProject.id)
        .executeTakeFirst(),
    ).toBeUndefined();
    const preserved = await test.db.admin
      .selectFrom('projects as p')
      .innerJoin('workspaces as w', 'w.id', 'p.workspace_id')
      .select(['p.owner_id', 'w.personal_owner_id'])
      .where('p.id', '=', sharedProject.id)
      .executeTakeFirstOrThrow();
    expect(preserved).toEqual({ owner_id: colleague.id, personal_owner_id: colleague.id });
    expect((await request(`/projects/${sharedProject.id}`, colleague.cookie)).status).toBe(200);
  });

  it('preflights sole shared team ownership and permits deleting an empty private team', async () => {
    const owner = await person();
    const colleague = await person();
    const shared = await team(owner.cookie);
    const empty = await team(owner.cookie);
    await join(owner.cookie, shared.id, colleague.cookie);
    await expect(prepareAccountDeletion(test.db.adminPool, owner.id)).rejects.toMatchObject({
      status: 'CONFLICT',
    });
    await expect(
      test.db.adminPool.query('delete from users where id=$1', [owner.id]),
    ).rejects.toThrow(/Transfer shared workspace ownership/);
    expect(
      (
        await request(`/workspaces/${shared.id}/members/${colleague.id}`, owner.cookie, 'PATCH', {
          role: 'owner',
        })
      ).status,
    ).toBe(204);
    await prepareAccountDeletion(test.db.adminPool, owner.id);
    await test.db.adminPool.query('delete from users where id=$1', [owner.id]);
    expect(
      await test.db.admin
        .selectFrom('workspaces')
        .select('id')
        .where('id', '=', empty.id)
        .executeTakeFirst(),
    ).toBeUndefined();
    expect(
      await test.db.admin
        .selectFrom('workspace_members')
        .select('role')
        .where('workspace_id', '=', shared.id)
        .where('user_id', '=', colleague.id)
        .executeTakeFirst(),
    ).toEqual({ role: 'owner' });
  });
});
