import { createHash, randomBytes, randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Invitations, members who leave, and what stays of them (spec 21a).
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '0b111111-1111-4111-8111-111111111111';
const EDITOR = '0b222222-2222-4222-8222-222222222222';
const VIEWER = '0b333333-3333-4333-8333-333333333333';
const GUEST = '0b444444-4444-4444-8444-444444444444';
const OTHER = '0b555555-5555-4555-8555-555555555555';
const PROJECT = '0bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const rejected = { code: '42501' };

const newToken = () => randomBytes(32).toString('base64url');
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

/** Runs `fn` as `userId` and commits, for steps that later ones build on. */
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

async function newProject(name = 'Einladungen') {
  const id = randomUUID();
  await admin.query(`insert into projects (id, name, owner_id) values ($1, $2, $3)`, [
    id,
    name,
    OWNER,
  ]);
  await admin.query(
    `insert into project_members (project_id, user_id, role) values ($1, $2, 'owner')`,
    [id, OWNER],
  );
  return id;
}

/** An invitation as the API stores it; returns its token. */
async function invite(
  projectId: string,
  values: { kind?: 'link' | 'email'; role?: 'editor' | 'viewer'; expired?: boolean } = {},
) {
  const token = newToken();
  const kind = values.kind ?? 'link';
  const { rows } = await admin.query<{ id: string }>(
    `insert into invitations (project_id, kind, role, email, token_hash, created_by, expires_at)
     values ($1, $2, $3, $4, $5, $6, now() + $7::interval) returning id`,
    [
      projectId,
      kind,
      values.role ?? 'editor',
      kind === 'email' ? 'gast@example.com' : null,
      hashOf(token),
      OWNER,
      values.expired ? '-1 minute' : '7 days',
    ],
  );
  return { token, id: rows[0]?.id ?? '' };
}

const preview = (userId: string, token: string) =>
  asUser(app, userId, async (client) => {
    const { rows } = await client.query('select * from public.invitation_preview($1)', [token]);
    return rows as Record<string, unknown>[];
  });

const accept = (userId: string, token: string) =>
  commitAs(userId, async (client) => {
    const { rows } = await client.query<{ project_id: string | null; status: string }>(
      'select * from public.accept_invitation($1)',
      [token],
    );
    return rows;
  });

const roleOf = async (projectId: string, userId: string) =>
  (
    await admin.query<{ role: string }>(
      'select role from project_members where project_id = $1 and user_id = $2',
      [projectId, userId],
    )
  ).rows[0]?.role;

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'invite-owner@example.com', true),
      ($2, 'Eddie Editor', 'invite-editor@example.com', true),
      ($3, 'Vera Viewer', 'invite-viewer@example.com', true),
      ($4, 'Gabi Gast', 'Invite-Guest@example.com', true),
      ($5, 'Otto Other', 'invite-other@example.com', true)`,
    [OWNER, EDITOR, VIEWER, GUEST, OTHER],
  );
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Team', $2)`, [
    PROJECT,
    OWNER,
  ]);
  await admin.query(
    `insert into project_members (project_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'editor'), ($1, $4, 'viewer')`,
    [PROJECT, OWNER, EDITOR, VIEWER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('invitations', () => {
  it('are created, read and revoked by owners only', async () => {
    const insert = (client: pg.PoolClient, userId: string) =>
      client.query<{ id: string }>(
        `insert into invitations (project_id, kind, role, token_hash, created_by)
         values ($1, 'link', 'viewer', $2, $3) returning id`,
        [PROJECT, hashOf(newToken()), userId],
      );
    const { id } = await invite(PROJECT);
    const visible = (userId: string) =>
      asUser(app, userId, async (client) => {
        const { rows } = await client.query('select id from invitations where id = $1', [id]);
        return rows.length;
      });

    await asUser(app, OWNER, async (client) => {
      expect((await insert(client, OWNER)).rows).toHaveLength(1);
    });
    expect(await visible(OWNER)).toBe(1);
    for (const userId of [EDITOR, VIEWER, OTHER]) {
      expect(await visible(userId)).toBe(0);
      await expect(asUser(app, userId, (client) => insert(client, userId))).rejects.toMatchObject(
        rejected,
      );
      const revoked = await asUser(app, userId, (client) =>
        client.query('update invitations set revoked_at = now() where id = $1', [id]),
      );
      expect(revoked.rowCount).toBe(0);
    }
    // Nobody invites in the name of someone else.
    await expect(asUser(app, OWNER, (client) => insert(client, EDITOR))).rejects.toMatchObject(
      rejected,
    );
    const revoked = await asUser(app, OWNER, (client) =>
      client.query('update invitations set revoked_at = now() where id = $1', [id]),
    );
    expect(revoked.rowCount).toBe(1);
  });

  it('keep their hash to themselves and cannot be changed otherwise', async () => {
    const { id } = await invite(PROJECT);

    await expect(
      asUser(app, OWNER, (client) =>
        client.query('select token_hash from invitations where id = $1', [id]),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(`update invitations set role = 'editor', uses = 0 where id = $1`, [id]),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, OWNER, (client) => client.query('delete from invitations where id = $1', [id])),
    ).rejects.toMatchObject(rejected);
  });

  it('make editors or viewers, with an address exactly when they go by mail', async () => {
    const insert = (kind: string, role: string, email: string | null) =>
      admin.query(
        `insert into invitations (project_id, kind, role, email, token_hash) values ($1, $2, $3, $4, $5)`,
        [PROJECT, kind, role, email, hashOf(newToken())],
      );

    await expect(insert('link', 'owner', null)).rejects.toMatchObject({ code: '23514' });
    await expect(insert('link', 'editor', 'a@example.com')).rejects.toMatchObject({
      code: '23514',
    });
    await expect(insert('email', 'editor', null)).rejects.toMatchObject({ code: '23514' });
    await expect(insert('email', 'editor', 'A@Example.com')).rejects.toMatchObject({
      code: '23514',
    });
    await expect(
      admin.query(
        `insert into invitations (project_id, kind, role, token_hash) values ($1, 'link', 'editor', 'klartext')`,
        [PROJECT],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('opening an invitation', () => {
  it('tells who invites to which project with which role', async () => {
    const { token } = await invite(PROJECT, { role: 'viewer' });

    expect(await preview(GUEST, token)).toEqual([
      {
        project_id: null,
        project_name: 'Team',
        role: 'viewer',
        invited_by: 'Olga Owner',
        status: 'open',
      },
    ]);
    // A member is told so, and where the project is.
    expect(await preview(EDITOR, token)).toMatchObject([{ project_id: PROJECT, status: 'member' }]);
  });

  it('tells nothing about a project once the invitation no longer works', async () => {
    const expired = await invite(PROJECT, { expired: true });
    const revoked = await invite(PROJECT);
    await admin.query('update invitations set revoked_at = now() where id = $1', [revoked.id]);
    const nothing = { project_id: null, project_name: null, role: null, invited_by: null };

    expect(await preview(GUEST, expired.token)).toEqual([{ ...nothing, status: 'expired' }]);
    expect(await preview(GUEST, revoked.token)).toEqual([{ ...nothing, status: 'revoked' }]);
    // A token nobody issued, and things that cannot be a token.
    expect(await preview(GUEST, newToken())).toEqual([]);
    expect(await preview(GUEST, '')).toEqual([]);
    expect(await preview(GUEST, `${'a'.repeat(42)}'`)).toEqual([]);
  });

  it('needs a signed-in person', async () => {
    const { token } = await invite(PROJECT);

    await expect(
      asUser(app, null, (client) =>
        client.query('select * from public.invitation_preview($1)', [token]),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, null, (client) =>
        client.query('select * from public.accept_invitation($1)', [token]),
      ),
    ).rejects.toMatchObject(rejected);
  });
});

describe('accepting an invitation', () => {
  it('joins with the role of a link, for everyone who has it, and counts the uses', async () => {
    const projectId = await newProject();
    const { token, id } = await invite(projectId, { role: 'viewer' });

    expect(await accept(GUEST, token)).toEqual([{ project_id: projectId, status: 'joined' }]);
    expect(await accept(OTHER, token)).toEqual([{ project_id: projectId, status: 'joined' }]);
    expect(await roleOf(projectId, GUEST)).toBe('viewer');
    expect(await roleOf(projectId, OTHER)).toBe('viewer');

    // Someone who is in the project already keeps their role, and no use is counted.
    const editors = await invite(projectId, { role: 'editor' });
    expect(await accept(GUEST, editors.token)).toEqual([
      { project_id: projectId, status: 'member' },
    ]);
    expect(await roleOf(projectId, GUEST)).toBe('viewer');
    const { rows } = await admin.query<{ id: string; uses: number }>(
      'select id, uses from invitations where project_id = $1 order by created_at',
      [projectId],
    );
    expect(rows).toEqual([
      { id, uses: 2 },
      { id: editors.id, uses: 0 },
    ]);
  });

  it('works once for an invitation by mail', async () => {
    const projectId = await newProject();
    const { token } = await invite(projectId, { kind: 'email' });

    expect(await accept(GUEST, token)).toEqual([{ project_id: projectId, status: 'joined' }]);
    expect(await accept(OTHER, token)).toEqual([{ project_id: null, status: 'used' }]);
    expect(await roleOf(projectId, OTHER)).toBeUndefined();
    expect(await preview(OTHER, token)).toMatchObject([{ project_name: null, status: 'used' }]);
  });

  it('adds nobody through an expired, revoked or unknown invitation', async () => {
    const projectId = await newProject();
    const expired = await invite(projectId, { expired: true });
    const revoked = await invite(projectId);
    await admin.query('update invitations set revoked_at = now() where id = $1', [revoked.id]);

    expect(await accept(GUEST, expired.token)).toEqual([{ project_id: null, status: 'expired' }]);
    expect(await accept(GUEST, revoked.token)).toEqual([{ project_id: null, status: 'revoked' }]);
    expect(await accept(GUEST, newToken())).toEqual([]);
    expect(await accept(GUEST, 'kein-token')).toEqual([]);
    expect(await roleOf(projectId, GUEST)).toBeUndefined();
  });

  it('stops at fifty members', async () => {
    const projectId = await newProject();
    await admin.query(
      `with people as (
         insert into users (id, name, email, email_verified)
         select gen_random_uuid(), 'Mitglied ' || n, 'full-' || n || '-' || $2 || '@example.com', true
         from generate_series(1, 49) n
         returning id
       )
       insert into project_members (project_id, user_id, role)
       select $1, id, 'viewer' from people`,
      [projectId, projectId],
    );
    const { token } = await invite(projectId);

    expect(await accept(GUEST, token)).toEqual([{ project_id: null, status: 'full' }]);
    expect(await roleOf(projectId, GUEST)).toBeUndefined();
  });
});

describe('members', () => {
  it('leave on their own, except the last owner', async () => {
    const projectId = await newProject();
    await admin.query(
      `insert into project_members (project_id, user_id, role) values ($1, $2, 'editor'), ($1, $3, 'viewer')`,
      [projectId, EDITOR, VIEWER],
    );
    const leave = (userId: string, who = userId) =>
      commitAs(userId, (client) =>
        client.query('delete from project_members where project_id = $1 and user_id = $2', [
          projectId,
          who,
        ]),
      );

    // Nobody removes someone else, except an owner.
    expect((await leave(EDITOR, VIEWER)).rowCount).toBe(0);
    expect((await leave(VIEWER)).rowCount).toBe(1);
    await expect(leave(OWNER)).rejects.toMatchObject({ code: 'P0001' });
    expect((await leave(OWNER, EDITOR)).rowCount).toBe(1);
  });

  it('pass the creator’s place on when the creator leaves or steps down', async () => {
    const projectId = await newProject();
    await admin.query(
      `insert into project_members (project_id, user_id, role, created_at) values
        ($1, $2, 'owner', now() + interval '1 second'),
        ($1, $3, 'owner', now() + interval '2 seconds')`,
      [projectId, OTHER, EDITOR],
    );
    const creator = async () =>
      (
        await admin.query<{ owner_id: string }>('select owner_id from projects where id = $1', [
          projectId,
        ])
      ).rows[0]?.owner_id;

    await commitAs(OWNER, (client) =>
      client.query(
        `update project_members set role = 'editor' where project_id = $1 and user_id = $2`,
        [projectId, OWNER],
      ),
    );
    // The longest-standing other owner.
    expect(await creator()).toBe(OTHER);

    await commitAs(OTHER, (client) =>
      client.query('delete from project_members where project_id = $1 and user_id = $2', [
        projectId,
        OTHER,
      ]),
    );
    expect(await creator()).toBe(EDITOR);
  });

  it('take their personal agents out of the team when they leave; shared agents stay', async () => {
    const projectId = await newProject();
    await admin.query(
      `insert into project_members (project_id, user_id, role) values ($1, $2, 'editor')`,
      [projectId, EDITOR],
    );
    const { rows } = await admin.query<{ id: string }>(
      `insert into custom_agents (owner_id, project_id, name, role) values
        ($1, null, 'Einladung Persönlich', 'Rolle'),
        ($1, $2, 'Einladung Geteilt', 'Rolle')
       returning id`,
      [EDITOR, projectId],
    );
    const [personal, shared] = rows.map((row) => row.id);
    await admin.query(
      `insert into project_agents (project_id, agent_key) values ($1, $2), ($1, $3)`,
      [projectId, personal, shared],
    );

    await commitAs(EDITOR, (client) =>
      client.query('delete from project_members where project_id = $1 and user_id = $2', [
        projectId,
        EDITOR,
      ]),
    );

    const team = await admin.query<{ agent_key: string }>(
      `select agent_key from project_agents where project_id = $1 and agent_key <> 'moderator'`,
      [projectId],
    );
    expect(team.rows.map((row) => row.agent_key)).toEqual([shared]);
  });

  it('who only read cannot approve Git actions', async () => {
    await expect(
      admin.query(
        `update project_members set can_approve_git = true where project_id = $1 and user_id = $2`,
        [PROJECT, VIEWER],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const granted = await asUser(app, OWNER, (client) =>
      client.query(
        `update project_members set can_approve_git = true where project_id = $1 and user_id = $2`,
        [PROJECT, EDITOR],
      ),
    );
    expect(granted.rowCount).toBe(1);
  });

  it('keep their name for the others after they left', async () => {
    const projectId = await newProject();
    // Two people no other test knows: one joins and leaves, one never joins.
    const [former, stranger] = [randomUUID(), randomUUID()];
    await admin.query(
      `insert into users (id, name, email, email_verified) values
        ($1, 'Frieda Früher', $3, true),
        ($2, 'Sam Stranger', $4, true)`,
      [former, stranger, `${former}@example.com`, `${stranger}@example.com`],
    );
    await admin.query(
      `insert into project_members (project_id, user_id, role) values ($1, $2, 'editor')`,
      [projectId, former],
    );
    const nameOfFormer = (userId: string) =>
      asUser(app, userId, async (client) => {
        const { rows } = await client.query<{ name: string }>(
          'select name from users where id = $1',
          [former],
        );
        return rows[0]?.name;
      });
    expect(await nameOfFormer(OWNER)).toBe('Frieda Früher');

    await admin.query('delete from project_members where project_id = $1 and user_id = $2', [
      projectId,
      former,
    ]);

    expect(await nameOfFormer(OWNER)).toBe('Frieda Früher');
    // The one who left no longer reads the people of the project, and strangers never did.
    const seesOwner = (userId: string) =>
      asUser(app, userId, async (client) => {
        const { rows } = await client.query('select name from users where id = $1', [OWNER]);
        return rows.length;
      });
    expect(await seesOwner(former)).toBe(0);
    expect(await seesOwner(stranger)).toBe(0);
    expect(await nameOfFormer(stranger)).toBeUndefined();
  });

  it('are told apart by address only for owners who invite', async () => {
    const has = (userId: string, email: string) =>
      asUser(app, userId, async (client) => {
        const { rows } = await client.query<{ known: boolean }>(
          'select public.project_has_member_email($1, $2) as known',
          [PROJECT, email],
        );
        return rows[0]?.known;
      });

    expect(await has(OWNER, ' INVITE-editor@example.com ')).toBe(true);
    expect(await has(OWNER, 'invite-other@example.com')).toBe(false);
    expect(await has(EDITOR, 'invite-editor@example.com')).toBe(false);
    expect(await has(OTHER, 'invite-editor@example.com')).toBe(false);
  });
});
