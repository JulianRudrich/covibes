import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// "Since you were away" (spec 23): when a member counts as back, the noted absence, the scheduled
// summary and who reads it.
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '0f111111-1111-4111-8111-111111111111';
const EDITOR = '0f222222-2222-4222-8222-222222222222';
const STRANGER = '0f444444-4444-4444-8444-444444444444';

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

async function newProject() {
  const id = randomUUID();
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Weg', $2)`, [
    id,
    OWNER,
  ]);
  await admin.query(
    `insert into project_members (project_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'editor')`,
    [id, OWNER, EDITOR],
  );
  return id;
}

/** Opens the project as the user; true if they are back from an absence. */
async function open(projectId: string, userId: string): Promise<boolean> {
  return commitAs(userId, async (client) => {
    const { rows } = await client.query<{ back: boolean }>(
      'select public.touch_project_seen($1) as back',
      [projectId],
    );
    return rows[0]?.back ?? false;
  });
}

/** Moves the user's last visit into the past. */
async function lastSeen(projectId: string, userId: string, ago: string) {
  await admin.query(
    `update member_activity set last_seen_at = now() - $3::interval
     where project_id = $1 and user_id = $2`,
    [projectId, userId, ago],
  );
}

async function say(projectId: string, userId: string | null, count: number, ago = '10 minutes') {
  for (let index = 0; index < count; index += 1) {
    await admin.query(
      `insert into messages
         (project_id, author_kind, author_user_id, author_agent_key, content, created_at)
       values ($1, $2, $3, $4, 'Hallo', now() - $5::interval)`,
      [projectId, userId ? 'human' : 'agent', userId, userId ? null : 'moderator', ago],
    );
  }
}

type Summary = {
  away_from: Date;
  back_at: Date;
  text: string | null;
  text_status: string;
  dismissed_at: Date | null;
};

async function summary(projectId: string, userId: string): Promise<Summary | undefined> {
  const { rows } = await admin.query<Summary>(
    `select away_from, back_at, text, text_status, dismissed_at from away_summaries
     where project_id = $1 and user_id = $2`,
    [projectId, userId],
  );
  return rows[0];
}

/** The waiting summary jobs of a project, by the person they are for. */
async function summaryJobs(projectId: string) {
  const { rows } = await admin.query<{ key: string; attempts: number; payload: unknown }>(
    `select jobs.key, jobs.max_attempts as attempts, jobs.payload
     from graphile_worker._private_jobs as jobs
     where jobs.key like $1`,
    [`away_summary:${projectId}:%`],
  );
  return new Map(rows.map((row) => [row.key.split(':')[2], row]));
}

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'away-owner@example.com', true),
      ($2, 'Eddie Editor', 'away-editor@example.com', true),
      ($3, 'Sam Stranger', 'away-stranger@example.com', true)`,
    [OWNER, EDITOR, STRANGER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('coming back to a project', () => {
  it('counts after an hour without the project, never on the first visit', async () => {
    const projectId = await newProject();

    expect(await open(projectId, EDITOR)).toBe(false);
    await lastSeen(projectId, EDITOR, '59 minutes');
    expect(await open(projectId, EDITOR)).toBe(false);
    expect(await summary(projectId, EDITOR)).toBeUndefined();

    await lastSeen(projectId, EDITOR, '3 hours');
    expect(await open(projectId, EDITOR)).toBe(true);
    const noted = await summary(projectId, EDITOR);
    expect(noted).toMatchObject({ text: null, text_status: 'none', dismissed_at: null });
    const away = (noted?.back_at.getTime() ?? 0) - (noted?.away_from.getTime() ?? 0);
    expect(Math.round(away / 60_000)).toBe(180);

    // Being there again is no return, and nobody else was away.
    expect(await open(projectId, EDITOR)).toBe(false);
    expect(await summary(projectId, OWNER)).toBeUndefined();
  });

  it('notes nothing for someone outside the project', async () => {
    const projectId = await newProject();

    expect(await open(projectId, STRANGER)).toBe(false);
    expect(await summary(projectId, STRANGER)).toBeUndefined();
  });

  it('schedules the summary once five messages by others came in the meantime', async () => {
    const projectId = await newProject();
    await open(projectId, EDITOR);
    await open(projectId, OWNER);
    await lastSeen(projectId, EDITOR, '2 hours');
    await lastSeen(projectId, OWNER, '2 hours');
    // Four by the owner and one by the moderator; older ones and the editor's own do not count.
    await say(projectId, OWNER, 4);
    await say(projectId, null, 1);
    await say(projectId, OWNER, 3, '5 hours');
    await say(projectId, EDITOR, 2);

    expect(await open(projectId, EDITOR)).toBe(true);
    expect(await summary(projectId, EDITOR)).toMatchObject({ text_status: 'pending' });
    const jobs = await summaryJobs(projectId);
    expect([...jobs.keys()]).toEqual([EDITOR]);
    expect(jobs.get(EDITOR)).toMatchObject({
      attempts: 1,
      payload: { projectId, userId: EDITOR },
    });

    // For the owner only the moderator's and the editor's messages are new: too few to sum up.
    expect(await open(projectId, OWNER)).toBe(true);
    expect(await summary(projectId, OWNER)).toMatchObject({ text_status: 'none' });
    expect([...(await summaryJobs(projectId)).keys()]).toEqual([EDITOR]);
  });

  it('replaces the summary of the absence before', async () => {
    const projectId = await newProject();
    await open(projectId, EDITOR);
    await lastSeen(projectId, EDITOR, '2 hours');
    await say(projectId, OWNER, 5);
    await open(projectId, EDITOR);
    await admin.query(
      `update away_summaries set text = 'Alt', text_status = 'done', dismissed_at = now()
       where project_id = $1 and user_id = $2`,
      [projectId, EDITOR],
    );
    const first = await summary(projectId, EDITOR);

    await lastSeen(projectId, EDITOR, '90 minutes');
    expect(await open(projectId, EDITOR)).toBe(true);
    const second = await summary(projectId, EDITOR);
    expect(second).toMatchObject({ text: null, text_status: 'pending', dismissed_at: null });
    expect(second?.away_from.getTime()).toBeGreaterThan(first?.away_from.getTime() ?? 0);
  });
});

describe('a summary', () => {
  it('is read and closed only by the person it is for', async () => {
    const projectId = await newProject();
    await open(projectId, EDITOR);
    await lastSeen(projectId, EDITOR, '2 hours');
    await open(projectId, EDITOR);
    await admin.query(
      `update away_summaries set text = 'Ihr habt euch geeinigt.', text_status = 'done'
       where project_id = $1 and user_id = $2`,
      [projectId, EDITOR],
    );
    const read = (userId: string) =>
      asUser(app, userId, async (client) => {
        const { rows } = await client.query<{ text: string }>(
          'select text from away_summaries where project_id = $1',
          [projectId],
        );
        return rows;
      });

    expect(await read(EDITOR)).toEqual([{ text: 'Ihr habt euch geeinigt.' }]);
    expect(await read(OWNER)).toEqual([]);
    expect(await read(STRANGER)).toEqual([]);

    const foreign = await commitAs(OWNER, (client) =>
      client.query('update away_summaries set dismissed_at = now() where project_id = $1', [
        projectId,
      ]),
    );
    expect(foreign.rowCount).toBe(0);
    const own = await commitAs(EDITOR, (client) =>
      client.query('update away_summaries set dismissed_at = now() where project_id = $1', [
        projectId,
      ]),
    );
    expect(own.rowCount).toBe(1);
    expect((await summary(projectId, EDITOR))?.dismissed_at).toBeInstanceOf(Date);
  });

  it('is written by the database and the worker only', async () => {
    const projectId = await newProject();
    await open(projectId, EDITOR);
    await lastSeen(projectId, EDITOR, '2 hours');
    await open(projectId, EDITOR);

    await expect(
      asUser(app, EDITOR, (client) =>
        client.query(`update away_summaries set text = 'Selbst geschrieben'`),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, EDITOR, (client) =>
        client.query(`update away_summaries set away_from = now() - interval '1 year'`),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(
          `insert into away_summaries (project_id, user_id, away_from, back_at)
           values ($1, $2, now() - interval '1 day', now())`,
          [projectId, OWNER],
        ),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, EDITOR, (client) => client.query('delete from away_summaries')),
    ).rejects.toMatchObject(rejected);
  });

  it('goes with the membership', async () => {
    const projectId = await newProject();
    await open(projectId, EDITOR);
    await lastSeen(projectId, EDITOR, '2 hours');
    await open(projectId, EDITOR);
    expect(await summary(projectId, EDITOR)).toBeDefined();

    await admin.query('delete from project_members where project_id = $1 and user_id = $2', [
      projectId,
      EDITOR,
    ]);
    expect(await summary(projectId, EDITOR)).toBeUndefined();
  });
});

describe('the run of a summary', () => {
  it('is metered as its own kind', async () => {
    const projectId = await newProject();

    await admin.query(
      `insert into ai_runs (project_id, agent_key, kind, status) values ($1, 'moderator', 'summary', 'done')`,
      [projectId],
    );
    await expect(
      admin.query(
        `insert into ai_runs (project_id, agent_key, kind, status) values ($1, 'moderator', 'digest', 'done')`,
        [projectId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
