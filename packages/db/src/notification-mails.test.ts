import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Notifications by email (spec 22b): the switch, the noted visits, the scheduled job and what
// waits for a person.
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '0e111111-1111-4111-8111-111111111111';
const EDITOR = '0e222222-2222-4222-8222-222222222222';
const VIEWER = '0e333333-3333-4333-8333-333333333333';
const STRANGER = '0e444444-4444-4444-8444-444444444444';

const rejected = { code: '42501' };

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

async function newProject(name = 'Mails', settings = '{}') {
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

/** The job keys of the people of this file; other test files share the database. */
const KEYS = [OWNER, EDITOR, VIEWER, STRANGER].map((userId) => `notification_mail:${userId}`);

/** The waiting mail jobs, by the person they are for. */
async function mailJobs() {
  const { rows } = await admin.query<{ key: string; delay: number; attempts: number }>(
    `select jobs.key, extract(epoch from jobs.run_at - now())::int as delay, jobs.max_attempts as attempts
     from graphile_worker._private_jobs as jobs
     where jobs.key = any ($1)`,
    [KEYS],
  );
  return new Map(rows.map((row) => [row.key.replace('notification_mail:', ''), row]));
}

async function clearJobs() {
  await admin.query('delete from graphile_worker._private_jobs where key = any ($1)', [KEYS]);
}

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'mail-owner@example.com', true),
      ($2, 'Eddie Editor', 'mail-editor@example.com', true),
      ($3, 'Vera Viewer', 'mail-viewer@example.com', true),
      ($4, 'Sam Stranger', 'mail-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('the switch for mails', () => {
  it('is on until the person turns it off, and only theirs', async () => {
    const read = (userId: string) =>
      asUser(app, userId, async (client) => {
        const { rows } = await client.query<{ user_id: string; email: boolean }>(
          'select user_id, email from notification_settings',
        );
        return rows;
      });
    expect(await read(OWNER)).toEqual([]);

    await commitAs(OWNER, (client) =>
      client.query(
        `insert into notification_settings (user_id, email) values ($1, false)
         on conflict (user_id) do update set email = false`,
        [OWNER],
      ),
    );
    expect(await read(OWNER)).toEqual([{ user_id: OWNER, email: false }]);
    expect(await read(EDITOR)).toEqual([]);

    // Nobody sets someone else's switch, and when the last mail went out is the worker's to know.
    await expect(
      asUser(app, EDITOR, (client) =>
        client.query(`insert into notification_settings (user_id, email) values ($1, false)`, [
          STRANGER,
        ]),
      ),
    ).rejects.toMatchObject(rejected);
    const foreign = await asUser(app, EDITOR, (client) =>
      client.query(`update notification_settings set email = true where user_id = $1`, [OWNER]),
    );
    expect(foreign.rowCount).toBe(0);
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(`update notification_settings set last_mail_at = null where user_id = $1`, [
          OWNER,
        ]),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, OWNER, (client) =>
        client.query('select last_mail_at from notification_settings'),
      ),
    ).rejects.toMatchObject(rejected);
  });
});

describe('having a project open', () => {
  it('is noted for members, without telling anyone', async () => {
    const { projectId } = await newProject();
    const seen = async (userId: string) =>
      (
        await admin.query<{ last_seen_at: Date | null }>(
          'select last_seen_at from member_activity where project_id = $1 and user_id = $2',
          [projectId, userId],
        )
      ).rows[0]?.last_seen_at;
    expect(await seen(EDITOR)).toBeUndefined();

    await commitAs(EDITOR, (client) =>
      client.query('select public.touch_project_seen($1)', [projectId]),
    );
    const first = await seen(EDITOR);
    expect(first).toBeInstanceOf(Date);
    await commitAs(EDITOR, (client) =>
      client.query('select public.touch_project_seen($1)', [projectId]),
    );
    expect((await seen(EDITOR))?.getTime()).toBeGreaterThanOrEqual(first?.getTime() ?? 0);
    expect(await seen(OWNER)).toBeUndefined();

    // Someone outside the project leaves no trace, and nobody reads the notes directly.
    await commitAs(STRANGER, (client) =>
      client.query('select public.touch_project_seen($1)', [projectId]),
    );
    expect(await seen(STRANGER)).toBeUndefined();
    await expect(
      asUser(app, EDITOR, (client) => client.query('select * from member_activity')),
    ).rejects.toMatchObject(rejected);

    // The note goes with the membership.
    await admin.query('delete from project_members where project_id = $1 and user_id = $2', [
      projectId,
      EDITOR,
    ]);
    expect(await seen(EDITOR)).toBeUndefined();
  });
});

describe('the mail job', () => {
  it('is scheduled ten minutes ahead for a mention, a changed role and a removal', async () => {
    const { projectId } = await newProject();
    await clearJobs();

    await admin.query(
      `insert into messages (project_id, author_kind, author_user_id, content, mentioned_users)
       values ($1, 'human', $2, '@Eddie-Editor', $3)`,
      [projectId, OWNER, [EDITOR]],
    );
    let jobs = await mailJobs();
    expect([...jobs.keys()]).toEqual([EDITOR]);
    expect(jobs.get(EDITOR)?.delay).toBeGreaterThan(590);
    expect(jobs.get(EDITOR)?.delay).toBeLessThanOrEqual(600);
    expect(jobs.get(EDITOR)?.attempts).toBe(3);

    // A second event joins the job that waits; its time stays.
    await admin.query(
      `update graphile_worker._private_jobs set run_at = now() + interval '1 minute' where key = any ($1)`,
      [KEYS],
    );
    await commitAs(OWNER, (client) =>
      client.query(
        `update project_members set role = 'viewer' where project_id = $1 and user_id = $2`,
        [projectId, EDITOR],
      ),
    );
    jobs = await mailJobs();
    expect([...jobs.keys()]).toEqual([EDITOR]);
    expect(jobs.get(EDITOR)?.delay).toBeLessThanOrEqual(60);

    await clearJobs();
    await commitAs(OWNER, (client) =>
      client.query('delete from project_members where project_id = $1 and user_id = $2', [
        projectId,
        VIEWER,
      ]),
    );
    expect([...(await mailJobs()).keys()]).toEqual([VIEWER]);
  });

  it('is not scheduled for someone who joined', async () => {
    await clearJobs();
    await newProject();

    // The owner was told in the app that two people joined; no mail follows.
    expect([...(await mailJobs()).keys()]).toEqual([]);
  });

  it('is scheduled for owners and editors when something starts to wait', async () => {
    const { projectId, boardId } = await newProject();
    const message = await admin.query<{ id: string }>(
      `insert into messages (project_id, author_kind, author_agent_key, content)
       values ($1, 'agent', 'moderator', 'Abstimmung') returning id`,
      [projectId],
    );
    const events = [
      () =>
        admin.query(
          `insert into proposals (project_id, board_id, agent_key, kind, reason, operations)
           values ($1, $2, 'critic', 'canvas', 'initiative', '[]')`,
          [projectId, boardId],
        ),
      () =>
        admin.query(
          `insert into hand_raises (project_id, agent_key, reason) values ($1, 'critic', 'Einwand')`,
          [projectId],
        ),
      () =>
        admin.query(
          `insert into votes (project_id, message_id, topic, options)
           values ($1, $2, 'Hosting', '["A", "B"]')`,
          [projectId, message.rows[0]?.id],
        ),
    ];

    for (const happen of events) {
      await clearJobs();
      await happen();
      expect([...(await mailJobs()).keys()].sort()).toEqual([OWNER, EDITOR].sort());
    }
  });
});

describe('what waits for a person, as the worker sees it', () => {
  const waiting = async (userId: string) => {
    const { rows } = await admin.query<{
      project_name: string;
      waiting: number;
      newest: Date;
      last_seen_at: Date | null;
      waiting_mailed_at: Date | null;
    }>('select * from public.waiting_for_user($1)', [userId]);
    return rows;
  };

  it('lists the projects with their count, the newest item and the last visit', async () => {
    const name = `Wartet ${randomUUID()}`;
    const { projectId, boardId } = await newProject(name, '{"decisionProcess": "owner"}');
    await newProject(`Ruhig ${randomUUID()}`);
    await admin.query(
      `insert into proposals (project_id, board_id, agent_key, kind, reason, operations, created_at) values
        ($1, $2, 'critic', 'canvas', 'initiative', '[]', now() - interval '2 hours'),
        ($1, null, 'moderator', 'decision', 'initiative', '[]', now() - interval '1 hour')`,
      [projectId, boardId],
    );
    await commitAs(EDITOR, (client) =>
      client.query('select public.touch_project_seen($1)', [projectId]),
    );
    const here = async (userId: string) =>
      (await waiting(userId)).filter((row) => row.project_name === name);

    const [forOwner] = await here(OWNER);
    expect(forOwner).toMatchObject({ waiting: 2, last_seen_at: null, waiting_mailed_at: null });
    expect(Date.now() - (forOwner?.newest.getTime() ?? 0)).toBeGreaterThan(59 * 60_000);
    // While only the owner decides, the decision does not wait for the editor.
    const [forEditor] = await here(EDITOR);
    expect(forEditor).toMatchObject({ waiting: 1 });
    expect(forEditor?.last_seen_at).toBeInstanceOf(Date);
    // Nothing waits for someone who only reads, or who is not in the project.
    expect(await here(VIEWER)).toEqual([]);
    expect(await waiting(STRANGER)).toEqual([]);
  });

  it('is not for the app role to ask', async () => {
    await expect(
      asUser(app, OWNER, (client) =>
        client.query('select * from public.waiting_for_user($1)', [EDITOR]),
      ),
    ).rejects.toMatchObject(rejected);
  });
});
