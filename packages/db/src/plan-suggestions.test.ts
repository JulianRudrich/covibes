import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Generating the plan (spec 25b): who starts a generation, the suggestions and who decides them.
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '1b111111-1111-4111-8111-111111111111';
const EDITOR = '1b222222-2222-4222-8222-222222222222';
const VIEWER = '1b333333-3333-4333-8333-333333333333';
const STRANGER = '1b444444-4444-4444-8444-444444444444';

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
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Plan', $2)`, [
    id,
    OWNER,
  ]);
  await admin.query(
    `insert into project_members (project_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'editor'), ($1, $4, 'viewer')`,
    [id, OWNER, EDITOR, VIEWER],
  );
  return id;
}

const start = (userId: string, projectId: string) =>
  commitAs(userId, async (client) => {
    const { rows } = await client.query<{ run: string }>(
      'select public.start_plan_generation($1) as run',
      [projectId],
    );
    return rows[0]?.run ?? '';
  });

/** The worker's suggestions of one generation. */
async function suggest(projectId: string, sections: string[]) {
  const ids: Record<string, string> = {};
  for (const section of sections) {
    const { rows } = await admin.query<{ id: string }>(
      `insert into plan_suggestions (project_id, section, content)
       values ($1, $2, '[{"type": "paragraph"}]') returning id`,
      [projectId, section],
    );
    ids[section] = rows[0]?.id ?? '';
  }
  return ids;
}

const decide = (userId: string, projectId: string, id: string | null, status: string) =>
  commitAs(userId, async (client) => {
    const { rows } = await client.query<{ section: string; status: string; decided_by: string }>(
      'select section, status, decided_by from public.decide_plan_suggestions($1, $2, $3)',
      [projectId, id, status],
    );
    return rows;
  });

async function statuses(projectId: string) {
  const { rows } = await admin.query<{ section: string; status: string }>(
    'select section, status from plan_suggestions where project_id = $1 order by section',
    [projectId],
  );
  return Object.fromEntries(rows.map((row) => [row.section, row.status]));
}

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'plan-s-owner@example.com', true),
      ($2, 'Eddie Editor', 'plan-s-editor@example.com', true),
      ($3, 'Vera Viewer', 'plan-s-viewer@example.com', true),
      ($4, 'Sam Stranger', 'plan-s-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('starting a generation', () => {
  it('queues a run of the moderator and its job, for owners and editors', async () => {
    const projectId = await newProject();

    const runId = await start(EDITOR, projectId);

    const run = await admin.query<{ kind: string; status: string; agent_key: string }>(
      'select kind, status, agent_key from ai_runs where id = $1',
      [runId],
    );
    expect(run.rows).toEqual([{ kind: 'plan', status: 'queued', agent_key: 'moderator' }]);
    const jobs = await admin.query<{ attempts: number }>(
      `select max_attempts as attempts from graphile_worker._private_jobs
       where payload ->> 'runId' = $1`,
      [runId],
    );
    expect(jobs.rows).toEqual([{ attempts: 1 }]);
  });

  it('is not for viewers or strangers', async () => {
    const projectId = await newProject();

    await expect(start(VIEWER, projectId)).rejects.toMatchObject(rejected);
    await expect(start(STRANGER, projectId)).rejects.toMatchObject(rejected);
  });

  it('runs one at a time, until the run ends or is lost', async () => {
    const projectId = await newProject();
    const runId = await start(OWNER, projectId);

    await expect(start(EDITOR, projectId)).rejects.toMatchObject({ code: '55000' });
    // Another project is not held up.
    await expect(start(OWNER, await newProject())).resolves.toBeTruthy();

    await admin.query(`update ai_runs set status = 'done' where id = $1`, [runId]);
    const second = await start(EDITOR, projectId);
    // A run that never ended does not block the plan for good.
    await admin.query(
      `update ai_runs set created_at = now() - interval '11 minutes' where id = $1`,
      [second],
    );
    await expect(start(OWNER, projectId)).resolves.toBeTruthy();
  });
});

describe('the suggestions of a generation', () => {
  it('are read by the members only, and written by the worker only', async () => {
    const projectId = await newProject();
    await suggest(projectId, ['scope', 'risks']);
    const read = (userId: string) =>
      asUser(app, userId, async (client) => {
        const { rows } = await client.query<{ section: string }>(
          'select section from plan_suggestions where project_id = $1 order by section',
          [projectId],
        );
        return rows.map((row) => row.section);
      });

    expect(await read(VIEWER)).toEqual(['risks', 'scope']);
    expect(await read(STRANGER)).toEqual([]);
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(
          `insert into plan_suggestions (project_id, section, content) values ($1, 'tech', '[]')`,
          [projectId],
        ),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(`update plan_suggestions set status = 'accepted', decided_at = now()`),
      ),
    ).rejects.toMatchObject(rejected);
  });

  it('are one per section while open', async () => {
    const projectId = await newProject();
    const { scope } = await suggest(projectId, ['scope']);

    await expect(suggest(projectId, ['scope'])).rejects.toMatchObject({ code: '23505' });
    await admin.query(
      `update plan_suggestions set status = 'replaced', decided_at = now() where id = $1`,
      [scope],
    );
    await expect(suggest(projectId, ['scope'])).resolves.toBeTruthy();
    await expect(suggest(projectId, ['launch'])).rejects.toMatchObject({ code: '23514' });
  });

  it('are accepted or rejected by owners and editors, once', async () => {
    const projectId = await newProject();
    const { scope, risks } = await suggest(projectId, ['scope', 'risks', 'tech']);

    expect(await decide(EDITOR, projectId, scope ?? '', 'accepted')).toEqual([
      { section: 'scope', status: 'accepted', decided_by: EDITOR },
    ]);
    expect(await decide(OWNER, projectId, risks ?? '', 'rejected')).toEqual([
      { section: 'risks', status: 'rejected', decided_by: OWNER },
    ]);
    expect(await statuses(projectId)).toEqual({
      risks: 'rejected',
      scope: 'accepted',
      tech: 'open',
    });

    await expect(decide(OWNER, projectId, scope ?? '', 'rejected')).rejects.toMatchObject({
      code: '55000',
    });
    await expect(decide(OWNER, projectId, randomUUID(), 'accepted')).rejects.toMatchObject({
      code: 'P0002',
    });
    await expect(decide(OWNER, projectId, scope ?? '', 'maybe')).rejects.toMatchObject({
      code: '22023',
    });
    // A suggestion belongs to its project.
    await expect(decide(OWNER, await newProject(), scope ?? '', 'accepted')).rejects.toMatchObject({
      code: 'P0002',
    });
  });

  it('are decided all at once without an id', async () => {
    const projectId = await newProject();
    const { scope } = await suggest(projectId, ['scope', 'risks', 'tech']);
    await decide(OWNER, projectId, scope ?? '', 'rejected');

    const accepted = await decide(EDITOR, projectId, null, 'accepted');

    expect(accepted.map((row) => row.section).sort()).toEqual(['risks', 'tech']);
    expect(await statuses(projectId)).toEqual({
      risks: 'accepted',
      scope: 'rejected',
      tech: 'accepted',
    });
    // Nothing is left: deciding all again decides nothing.
    expect(await decide(EDITOR, projectId, null, 'rejected')).toEqual([]);
  });

  it('are not decided by viewers or strangers', async () => {
    const projectId = await newProject();
    const { scope } = await suggest(projectId, ['scope']);

    await expect(decide(VIEWER, projectId, scope ?? '', 'accepted')).rejects.toMatchObject(
      rejected,
    );
    await expect(decide(STRANGER, projectId, scope ?? '', 'accepted')).rejects.toMatchObject({
      code: 'P0002',
    });
    expect(await statuses(projectId)).toEqual({ scope: 'open' });
  });
});

describe('suggestions that wait', () => {
  it('count for owners and editors, in the app and for the mails', async () => {
    const projectId = await newProject();
    const count = (userId: string) =>
      asUser(app, userId, async (client) => {
        const { rows } = await client.query<{ waiting: number }>(
          'select public.project_waiting_count($1) as waiting',
          [projectId],
        );
        return rows[0]?.waiting;
      });
    const mailed = async (userId: string) => {
      const { rows } = await admin.query<{ project_id: string; waiting: number }>(
        'select project_id, waiting from public.waiting_for_user($1)',
        [userId],
      );
      return rows.find((row) => row.project_id === projectId)?.waiting;
    };
    expect(await count(OWNER)).toBe(0);

    const { scope } = await suggest(projectId, ['scope', 'risks']);

    expect(await count(OWNER)).toBe(2);
    expect(await count(EDITOR)).toBe(2);
    expect(await count(VIEWER)).toBe(0);
    expect(await mailed(EDITOR)).toBe(2);
    expect(await mailed(VIEWER)).toBeUndefined();
    // The mail about what waits is scheduled like for a proposal.
    const jobs = await admin.query(
      'select 1 from graphile_worker._private_jobs where key = any ($1)',
      [[`notification_mail:${OWNER}`, `notification_mail:${EDITOR}`]],
    );
    expect(jobs.rowCount).toBe(2);

    await decide(OWNER, projectId, scope ?? '', 'accepted');
    expect(await count(EDITOR)).toBe(1);
    expect(await mailed(OWNER)).toBe(1);
  });
});
