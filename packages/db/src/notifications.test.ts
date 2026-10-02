import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Mentions of people, notifications and what waits for someone (spec 22a).
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '0d111111-1111-4111-8111-111111111111';
const EDITOR = '0d222222-2222-4222-8222-222222222222';
const VIEWER = '0d333333-3333-4333-8333-333333333333';
const STRANGER = '0d444444-4444-4444-8444-444444444444';

const rejected = { code: '42501' };

/** Runs `fn` as `userId` and commits, for steps whose triggers later steps read. */
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

async function newProject(name = 'Benachrichtigungen', settings = '{}') {
  const id = randomUUID();
  await admin.query(`insert into projects (id, name, owner_id, settings) values ($1, $2, $3, $4)`, [
    id,
    name,
    OWNER,
    settings,
  ]);
  await admin.query(
    `insert into project_members (project_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'editor'), ($1, $4, 'viewer')`,
    [id, OWNER, EDITOR, VIEWER],
  );
  const board = await admin.query<{ id: string }>(
    `insert into boards (project_id, title, kind) values ($1, 'Haupt-Canvas', 'main') returning id`,
    [id],
  );
  return { projectId: id, boardId: board.rows[0]?.id ?? '' };
}

type Notification = {
  user_id: string;
  kind: string;
  project_name: string;
  actor_id: string | null;
  actor_name: string;
  excerpt: string;
  role: string | null;
};

/** The notifications of a project in the order they were written; with `kind`, only those. */
async function notificationsOf(projectId: string, kind?: string) {
  const { rows } = await admin.query<Notification>(
    `select user_id, kind, project_name, actor_id, actor_name, excerpt, role
     from notifications where project_id = $1 order by created_at, user_id`,
    [projectId],
  );
  return kind === undefined ? rows : rows.filter((entry) => entry.kind === kind);
}

const say = (userId: string, projectId: string, content: string, mentioned: string[]) =>
  commitAs(userId, (client) =>
    client.query(
      `insert into messages (project_id, author_kind, author_user_id, content, mentioned_users)
       values ($1, 'human', $2, $3, $4)`,
      [projectId, userId, content, mentioned],
    ),
  );

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'notify-owner@example.com', true),
      ($2, 'Eddie Editor', 'notify-editor@example.com', true),
      ($3, 'Vera Viewer', 'notify-viewer@example.com', true),
      ($4, 'Sam Stranger', 'notify-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('a mention', () => {
  it('notifies the mentioned members with who wrote what where', async () => {
    const { projectId } = await newProject('Vereins-App');

    await say(EDITOR, projectId, '@Olga-Owner  und\n@Vera-Viewer, schaut mal bitte.', [
      OWNER,
      VIEWER,
    ]);

    expect(await notificationsOf(projectId, 'mention')).toEqual(
      [OWNER, VIEWER].map((userId) => ({
        user_id: userId,
        kind: 'mention',
        project_name: 'Vereins-App',
        actor_id: EDITOR,
        actor_name: 'Eddie Editor',
        // One line, as the list shows it.
        excerpt: '@Olga-Owner und @Vera-Viewer, schaut mal bitte.',
        role: null,
      })),
    );
  });

  it('never notifies the author, people outside the project, or for an agent', async () => {
    const { projectId } = await newProject();

    await say(EDITOR, projectId, 'Ich und @Sam-Stranger', [EDITOR, STRANGER]);
    await admin.query(
      `insert into messages (project_id, author_kind, author_agent_key, content, mentioned_users)
       values ($1, 'agent', 'moderator', 'Olga, was meinst du?', $2)`,
      [projectId, [OWNER]],
    );
    await say(EDITOR, projectId, 'x'.repeat(500), [OWNER]);

    const notifications = await notificationsOf(projectId, 'mention');
    expect(notifications.map((entry) => entry.user_id)).toEqual([OWNER]);
    expect(notifications[0]?.excerpt).toHaveLength(200);
  });

  it('names at most twenty people per message', async () => {
    const { projectId } = await newProject();
    const many = Array.from({ length: 21 }, () => randomUUID());

    await expect(say(EDITOR, projectId, 'Alle!', many)).rejects.toMatchObject({ code: '23514' });
  });
});

describe('notifications', () => {
  it('are read and marked as read by their owner only', async () => {
    const { projectId } = await newProject();
    await say(EDITOR, projectId, '@Olga-Owner', [OWNER]);
    const own = (userId: string) =>
      asUser(app, userId, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          'select id from notifications where project_id = $1',
          [projectId],
        );
        return rows;
      });

    const [notification] = await own(OWNER);
    expect(notification).toBeDefined();
    for (const other of [EDITOR, VIEWER, STRANGER]) {
      expect(await own(other)).toEqual([]);
      const marked = await asUser(app, other, (client) =>
        client.query('update notifications set read_at = now() where id = $1', [notification?.id]),
      );
      expect(marked.rowCount).toBe(0);
    }
    const marked = await asUser(app, OWNER, (client) =>
      client.query('update notifications set read_at = now() where id = $1', [notification?.id]),
    );
    expect(marked.rowCount).toBe(1);

    // Nobody writes or removes a notification, or changes what it says.
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(
          `insert into notifications (user_id, kind, project_id, project_name)
           values ($1, 'mention', $2, 'x')`,
          [OWNER, projectId],
        ),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(`update notifications set excerpt = 'x' where id = $1`, [notification?.id]),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, OWNER, (client) =>
        client.query('delete from notifications where id = $1', [notification?.id]),
      ),
    ).rejects.toMatchObject(rejected);
  });
});

describe('changes of the members', () => {
  it('tell the owners who joined, but not about the first member', async () => {
    const { projectId } = await newProject('Team');
    // Creating the project with its members told nobody about the owner.
    expect((await notificationsOf(projectId)).filter((entry) => entry.user_id !== OWNER)).toEqual(
      [],
    );
    const joined = (await notificationsOf(projectId)).filter((entry) => entry.kind === 'joined');
    expect(joined.map((entry) => [entry.user_id, entry.actor_name, entry.role])).toEqual([
      [OWNER, 'Eddie Editor', 'editor'],
      [OWNER, 'Vera Viewer', 'viewer'],
    ]);
  });

  it('tell a member that someone else changed their role or removed them', async () => {
    const { projectId } = await newProject('Rollen');
    await admin.query('delete from notifications where project_id = $1', [projectId]);

    await commitAs(OWNER, (client) =>
      client.query(
        `update project_members set role = 'viewer' where project_id = $1 and user_id = $2`,
        [projectId, EDITOR],
      ),
    );
    // Granting the Git right is no change of the role.
    await commitAs(OWNER, (client) =>
      client.query(
        `update project_members set role = 'editor', can_approve_git = true
         where project_id = $1 and user_id = $2`,
        [projectId, EDITOR],
      ),
    );
    await commitAs(OWNER, (client) =>
      client.query(
        `update project_members set can_approve_git = false where project_id = $1 and user_id = $2`,
        [projectId, EDITOR],
      ),
    );
    await commitAs(OWNER, (client) =>
      client.query('delete from project_members where project_id = $1 and user_id = $2', [
        projectId,
        EDITOR,
      ]),
    );

    const base = { user_id: EDITOR, project_name: 'Rollen', actor_id: OWNER, excerpt: '' };
    expect(await notificationsOf(projectId)).toEqual([
      { ...base, kind: 'role_changed', actor_name: 'Olga Owner', role: 'viewer' },
      { ...base, kind: 'role_changed', actor_name: 'Olga Owner', role: 'editor' },
      { ...base, kind: 'removed', actor_name: 'Olga Owner', role: null },
    ]);
    // The removed person still reads what happened, with the names as they were.
    const forEditor = await asUser(app, EDITOR, (client) =>
      client.query<{ kind: string; project_name: string }>(
        `select kind, project_name from notifications where project_id = $1 and kind = 'removed'`,
        [projectId],
      ),
    );
    expect(forEditor.rows).toEqual([{ kind: 'removed', project_name: 'Rollen' }]);
  });

  it('tell nothing to someone who leaves or steps down on their own', async () => {
    const { projectId } = await newProject();
    await admin.query('delete from notifications where project_id = $1', [projectId]);

    await commitAs(VIEWER, (client) =>
      client.query('delete from project_members where project_id = $1 and user_id = $2', [
        projectId,
        VIEWER,
      ]),
    );

    expect(await notificationsOf(projectId)).toEqual([]);
  });

  it('go with a deleted project and a deleted account without an error', async () => {
    const { projectId } = await newProject();
    const leaving = randomUUID();
    await admin.query(
      `insert into users (id, name, email, email_verified) values ($1, 'Geht', $2, true)`,
      [leaving, `${leaving}@example.com`],
    );
    await admin.query(
      `insert into project_members (project_id, user_id, role) values ($1, $2, 'editor')`,
      [projectId, leaving],
    );

    await admin.query('delete from users where id = $1', [leaving]);
    await admin.query('delete from projects where id = $1', [projectId]);

    expect(await notificationsOf(projectId)).toEqual([]);
  });
});

describe('what waits for someone in a project', () => {
  const waiting = (userId: string, projectId: string) =>
    asUser(app, userId, async (client) => {
      const { rows } = await client.query<{ count: number }>(
        'select public.project_waiting_count($1) as count',
        [projectId],
      );
      return rows[0]?.count;
    });

  async function fill(projectId: string, boardId: string) {
    await admin.query(
      `insert into proposals (project_id, board_id, agent_key, kind, reason, operations) values
        ($1, $2, 'critic', 'canvas', 'initiative', '[]'),
        ($1, null, 'moderator', 'decision', 'initiative', '[]')`,
      [projectId, boardId],
    );
    await admin.query(
      `insert into proposals (project_id, board_id, agent_key, kind, reason, operations, status, decided_at)
       values ($1, $2, 'critic', 'canvas', 'initiative', '[]', 'rejected', now())`,
      [projectId, boardId],
    );
    await admin.query(
      `insert into hand_raises (project_id, agent_key, reason) values ($1, 'critic', 'Einwand')`,
      [projectId],
    );
    const message = await admin.query<{ id: string }>(
      `insert into messages (project_id, author_kind, author_agent_key, content)
       values ($1, 'agent', 'moderator', 'Abstimmung') returning id`,
      [projectId],
    );
    const vote = await admin.query<{ id: string }>(
      `insert into votes (project_id, message_id, topic, options)
       values ($1, $2, 'Hosting', '["A", "B"]') returning id`,
      [projectId, message.rows[0]?.id],
    );
    return vote.rows[0]?.id ?? '';
  }

  it('counts open proposals, raised hands and votes without the own vote', async () => {
    const { projectId, boardId } = await newProject();
    const voteId = await fill(projectId, boardId);

    expect(await waiting(OWNER, projectId)).toBe(4);
    expect(await waiting(EDITOR, projectId)).toBe(4);
    // Nothing waits for someone who only reads, or who is not in the project.
    expect(await waiting(VIEWER, projectId)).toBe(0);
    expect(await waiting(STRANGER, projectId)).toBe(0);

    await admin.query(`insert into vote_ballots (vote_id, user_id, option) values ($1, $2, 0)`, [
      voteId,
      EDITOR,
    ]);
    expect(await waiting(EDITOR, projectId)).toBe(3);
    expect(await waiting(OWNER, projectId)).toBe(4);
  });

  it('leaves decisions to the owners while only they decide', async () => {
    const { projectId, boardId } = await newProject(
      'Owner entscheidet',
      '{"decisionProcess": "owner"}',
    );
    await fill(projectId, boardId);

    expect(await waiting(OWNER, projectId)).toBe(4);
    expect(await waiting(EDITOR, projectId)).toBe(3);
  });
});
