import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Written-out feature specs of the package (spec 27d): who asks, who reads, what the worker keeps.
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '2e111111-1111-4111-8111-111111111111';
const EDITOR = '2e222222-2222-4222-8222-222222222222';
const VIEWER = '2e333333-3333-4333-8333-333333333333';
const STRANGER = '2e444444-4444-4444-8444-444444444444';

const rejected = { code: '42501' };

const UPSERT = `
  insert into package_specs (project_id, task_text, content)
  values ($1, $2, $3)
  on conflict (project_id, md5(task_text)) do update set content = excluded.content`;

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
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Vereins-App', $2)`, [
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

const start = (userId: string, projectId: string, milestone: number | null = 1) =>
  commitAs(userId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      'select public.start_package_specs($1, $2) as id',
      [projectId, milestone],
    );
    return rows[0]?.id ?? '';
  });

async function runs(projectId: string) {
  const { rows } = await admin.query<{
    milestone: number;
    run_id: string;
    requested_by: string | null;
  }>(
    `select milestone, run_id, requested_by from package_spec_runs
     where project_id = $1 order by milestone`,
    [projectId],
  );
  return rows;
}

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'package-f-owner@example.com', true),
      ($2, 'Eddie Editor', 'package-f-editor@example.com', true),
      ($3, 'Vera Viewer', 'package-f-viewer@example.com', true),
      ($4, 'Sam Stranger', 'package-f-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('asking for the specs of a milestone', () => {
  it('queues a run of the moderator and its job, for owners and editors', async () => {
    const projectId = await newProject();

    const runId = await start(EDITOR, projectId, 2);

    const run = await admin.query<{ kind: string; status: string; agent_key: string }>(
      'select kind, status, agent_key from ai_runs where id = $1',
      [runId],
    );
    expect(run.rows).toEqual([{ kind: 'package', status: 'queued', agent_key: 'moderator' }]);
    const jobs = await admin.query<{ attempts: number; milestone: string; task: string }>(
      `select j.max_attempts as attempts, j.payload ->> 'milestone' as milestone,
              t.identifier as task
       from graphile_worker._private_jobs j
       join graphile_worker._private_tasks t on t.id = j.task_id
       where j.payload ->> 'runId' = $1`,
      [runId],
    );
    expect(jobs.rows).toEqual([{ attempts: 1, milestone: '2', task: 'package_specs' }]);
    expect(await runs(projectId)).toEqual([{ milestone: 2, run_id: runId, requested_by: EDITOR }]);
  });

  it('is not for viewers or strangers, and only for milestones a plan can have', async () => {
    const projectId = await newProject();

    await expect(start(VIEWER, projectId)).rejects.toMatchObject(rejected);
    await expect(start(STRANGER, projectId)).rejects.toMatchObject(rejected);
    await expect(start(OWNER, projectId, 0)).rejects.toMatchObject({ code: '22023' });
    await expect(start(OWNER, projectId, 25)).rejects.toMatchObject({ code: '22023' });
    await expect(start(OWNER, projectId, null)).rejects.toMatchObject({ code: '22023' });
    expect(await runs(projectId)).toEqual([]);
  });

  it('runs one at a time per milestone, until the run ends or is lost', async () => {
    const projectId = await newProject();
    const runId = await start(OWNER, projectId);

    await expect(start(EDITOR, projectId)).rejects.toMatchObject({ code: '55000' });
    // Another milestone and another project are not held up.
    await expect(start(EDITOR, projectId, 2)).resolves.toBeTruthy();
    await expect(start(OWNER, await newProject())).resolves.toBeTruthy();

    await admin.query(`update ai_runs set status = 'done' where id = $1`, [runId]);
    const second = await start(EDITOR, projectId);
    expect((await runs(projectId))[0]).toEqual({
      milestone: 1,
      run_id: second,
      requested_by: EDITOR,
    });
    // A run that never ended does not block the milestone for good.
    await admin.query(
      `update ai_runs set created_at = now() - interval '11 minutes' where id = $1`,
      [second],
    );
    await expect(start(OWNER, projectId)).resolves.toBeTruthy();
  });
});

describe('written specs', () => {
  it('are kept once per task text, the latest one counts', async () => {
    const projectId = await newProject();

    await admin.query(UPSERT, [projectId, 'Login per Link', '## Ziel\n\nAlt.']);
    await admin.query(UPSERT, [projectId, 'Login per Link', '## Ziel\n\nNeu.']);
    await admin.query(UPSERT, [projectId, 'Mitgliederliste', '## Ziel\n\nListe.']);

    const { rows } = await admin.query<{ task_text: string; content: string }>(
      'select task_text, content from package_specs where project_id = $1 order by task_text',
      [projectId],
    );
    expect(rows).toEqual([
      { task_text: 'Login per Link', content: '## Ziel\n\nNeu.' },
      { task_text: 'Mitgliederliste', content: '## Ziel\n\nListe.' },
    ]);
  });

  it('are read by the members only, and written by the worker only', async () => {
    const projectId = await newProject();
    await admin.query(UPSERT, [projectId, 'Login per Link', '## Ziel\n\nAnmelden.']);
    await start(OWNER, projectId);
    const read = (userId: string, table: string) =>
      asUser(app, userId, async (client) => {
        const found = await client.query(`select 1 from ${table} where project_id = $1`, [
          projectId,
        ]);
        return found.rowCount;
      });

    expect(await read(VIEWER, 'package_specs')).toBe(1);
    expect(await read(VIEWER, 'package_spec_runs')).toBe(1);
    expect(await read(STRANGER, 'package_specs')).toBe(0);
    expect(await read(STRANGER, 'package_spec_runs')).toBe(0);
    await expect(
      commitAs(OWNER, (client) => client.query(UPSERT, [projectId, 'Export', '## Ziel\n\nMein.'])),
    ).rejects.toMatchObject(rejected);
    await expect(
      commitAs(OWNER, (client) =>
        client.query('delete from package_specs where project_id = $1', [projectId]),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      commitAs(OWNER, (client) =>
        client.query('delete from package_spec_runs where project_id = $1', [projectId]),
      ),
    ).rejects.toMatchObject(rejected);
  });

  it('stay when their run is removed, and go with their project', async () => {
    const projectId = await newProject();
    const runId = await start(OWNER, projectId);
    await admin.query(
      `insert into package_specs (project_id, task_text, content, run_id)
       values ($1, 'Login per Link', '## Ziel', $2)`,
      [projectId, runId],
    );

    await admin.query('delete from ai_runs where id = $1', [runId]);
    const kept = await admin.query<{ run_id: string | null }>(
      'select run_id from package_specs where project_id = $1',
      [projectId],
    );
    expect(kept.rows).toEqual([{ run_id: null }]);
    expect(await runs(projectId)).toEqual([]);

    await admin.query('delete from projects where id = $1', [projectId]);
    const gone = await admin.query('select 1 from package_specs where project_id = $1', [
      projectId,
    ]);
    expect(gone.rowCount).toBe(0);
  });
});
