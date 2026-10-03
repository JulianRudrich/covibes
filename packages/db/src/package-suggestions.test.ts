import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Suggestions for the package's texts (spec 27c): who asks, who reads, who takes over or dismisses.
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '2d111111-1111-4111-8111-111111111111';
const EDITOR = '2d222222-2222-4222-8222-222222222222';
const VIEWER = '2d333333-3333-4333-8333-333333333333';
const STRANGER = '2d444444-4444-4444-8444-444444444444';

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

const start = (userId: string, projectId: string, kind = 'code_standards') =>
  commitAs(userId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      'select public.start_package_suggestion($1, $2) as id',
      [projectId, kind],
    );
    return rows[0]?.id ?? '';
  });

const accept = (userId: string, projectId: string, kind = 'code_standards') =>
  commitAs(userId, async (client) => {
    const { rows } = await client.query<{ content: string | null }>(
      'select public.accept_package_suggestion($1, $2) as content',
      [projectId, kind],
    );
    return rows[0]?.content ?? null;
  });

/** What the worker does once the moderator wrote the text. */
async function write(projectId: string, kind: string, content: string) {
  await admin.query(
    `update ai_runs set status = 'done'
     where id = (select run_id from package_suggestions where project_id = $1 and kind = $2)`,
    [projectId, kind],
  );
  await admin.query(
    'update package_suggestions set content = $3 where project_id = $1 and kind = $2',
    [projectId, kind, content],
  );
}

async function suggestions(projectId: string) {
  const { rows } = await admin.query<{
    kind: string;
    run_id: string;
    content: string | null;
    requested_by: string | null;
  }>(
    `select kind, run_id, content, requested_by from package_suggestions
     where project_id = $1 order by kind`,
    [projectId],
  );
  return rows;
}

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'package-s-owner@example.com', true),
      ($2, 'Eddie Editor', 'package-s-editor@example.com', true),
      ($3, 'Vera Viewer', 'package-s-viewer@example.com', true),
      ($4, 'Sam Stranger', 'package-s-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('asking for a suggestion', () => {
  it('queues a run of the moderator and its job, for owners and editors', async () => {
    const projectId = await newProject();

    const runId = await start(EDITOR, projectId, 'ui_direction');

    const run = await admin.query<{ kind: string; status: string; agent_key: string }>(
      'select kind, status, agent_key from ai_runs where id = $1',
      [runId],
    );
    expect(run.rows).toEqual([{ kind: 'package', status: 'queued', agent_key: 'moderator' }]);
    const jobs = await admin.query<{ attempts: number; kind: string; task: string }>(
      `select j.max_attempts as attempts, j.payload ->> 'kind' as kind, t.identifier as task
       from graphile_worker._private_jobs j
       join graphile_worker._private_tasks t on t.id = j.task_id
       where j.payload ->> 'runId' = $1`,
      [runId],
    );
    expect(jobs.rows).toEqual([{ attempts: 1, kind: 'ui_direction', task: 'package_suggest' }]);
    expect(await suggestions(projectId)).toEqual([
      { kind: 'ui_direction', run_id: runId, content: null, requested_by: EDITOR },
    ]);
  });

  it('is not for viewers or strangers, and only for the texts it knows', async () => {
    const projectId = await newProject();

    await expect(start(VIEWER, projectId)).rejects.toMatchObject(rejected);
    await expect(start(STRANGER, projectId)).rejects.toMatchObject(rejected);
    await expect(start(OWNER, projectId, 'readme')).rejects.toMatchObject({ code: '22023' });
    expect(await suggestions(projectId)).toEqual([]);
  });

  it('runs one at a time per text, until the run ends or is lost', async () => {
    const projectId = await newProject();
    const runId = await start(OWNER, projectId);

    await expect(start(EDITOR, projectId)).rejects.toMatchObject({ code: '55000' });
    // The other text and another project are not held up.
    await expect(start(EDITOR, projectId, 'ui_direction')).resolves.toBeTruthy();
    await expect(start(OWNER, await newProject())).resolves.toBeTruthy();

    await admin.query(`update ai_runs set status = 'error' where id = $1`, [runId]);
    const second = await start(EDITOR, projectId);
    // A run that never ended does not block the text for good.
    await admin.query(
      `update ai_runs set created_at = now() - interval '11 minutes' where id = $1`,
      [second],
    );
    await expect(start(OWNER, projectId)).resolves.toBeTruthy();
  });

  it('takes the place of a suggestion that waited for the same text', async () => {
    const projectId = await newProject();
    await start(OWNER, projectId);
    await write(projectId, 'code_standards', 'TypeScript strict.');

    const runId = await start(EDITOR, projectId);

    expect(await suggestions(projectId)).toEqual([
      { kind: 'code_standards', run_id: runId, content: null, requested_by: EDITOR },
    ]);
  });
});

describe('a suggestion', () => {
  it('is read by the members only', async () => {
    const projectId = await newProject();
    await start(OWNER, projectId);
    await write(projectId, 'code_standards', 'TypeScript strict.');
    const read = (userId: string) =>
      asUser(app, userId, async (client) => {
        const { rows } = await client.query<{ content: string }>(
          'select content from package_suggestions where project_id = $1',
          [projectId],
        );
        return rows;
      });

    expect(await read(VIEWER)).toEqual([{ content: 'TypeScript strict.' }]);
    expect(await read(STRANGER)).toEqual([]);
  });

  it('is written by the worker only', async () => {
    const projectId = await newProject();
    await start(OWNER, projectId);

    await expect(
      commitAs(OWNER, (client) =>
        client.query(`update package_suggestions set content = 'Mine.' where project_id = $1`, [
          projectId,
        ]),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      commitAs(OWNER, (client) =>
        client.query(
          `insert into package_suggestions (project_id, kind, run_id, content)
           select $1, 'ui_direction', run_id, 'Mine.' from package_suggestions
           where project_id = $1`,
          [projectId],
        ),
      ),
    ).rejects.toMatchObject(rejected);
  });

  it('is dismissed by owners and editors, not by viewers', async () => {
    const projectId = await newProject();
    await start(OWNER, projectId);
    await write(projectId, 'code_standards', 'TypeScript strict.');
    const dismiss = (userId: string) =>
      commitAs(userId, async (client) => {
        const removed = await client.query(
          `delete from package_suggestions where project_id = $1 and kind = 'code_standards'`,
          [projectId],
        );
        return removed.rowCount;
      });

    expect(await dismiss(VIEWER)).toBe(0);
    expect(await suggestions(projectId)).toHaveLength(1);
    expect(await dismiss(EDITOR)).toBe(1);
    expect(await suggestions(projectId)).toEqual([]);
  });

  it('becomes the text of the team in the name of who takes it over', async () => {
    const projectId = await newProject();
    await commitAs(OWNER, (client) =>
      client.query(
        `insert into package_texts (project_id, kind, content, updated_by)
         values ($1, 'code_standards', 'Alt.', $2)`,
        [projectId, OWNER],
      ),
    );
    await start(OWNER, projectId);
    await write(projectId, 'code_standards', 'TypeScript strict.');

    const content = await accept(EDITOR, projectId);

    expect(content).toBe('TypeScript strict.');
    expect(await suggestions(projectId)).toEqual([]);
    const texts = await admin.query<{ content: string; updated_by: string }>(
      'select content, updated_by from package_texts where project_id = $1',
      [projectId],
    );
    expect(texts.rows).toEqual([{ content: 'TypeScript strict.', updated_by: EDITOR }]);
  });

  it('cannot be taken over before it is written, or by viewers', async () => {
    const projectId = await newProject();
    await start(OWNER, projectId);

    expect(await accept(OWNER, projectId)).toBeNull();
    expect(await accept(OWNER, projectId, 'ui_direction')).toBeNull();
    // The suggestion still waits for the moderator.
    expect(await suggestions(projectId)).toHaveLength(1);

    await write(projectId, 'code_standards', 'TypeScript strict.');
    await expect(accept(VIEWER, projectId)).rejects.toMatchObject(rejected);
    await expect(accept(STRANGER, projectId)).rejects.toMatchObject(rejected);
    expect(await suggestions(projectId)).toHaveLength(1);
  });

  it('goes with its run and with its project', async () => {
    const projectId = await newProject();
    const runId = await start(OWNER, projectId);
    await start(OWNER, projectId, 'ui_direction');

    await admin.query('delete from ai_runs where id = $1', [runId]);
    expect((await suggestions(projectId)).map((row) => row.kind)).toEqual(['ui_direction']);

    await admin.query('delete from projects where id = $1', [projectId]);
    expect(await suggestions(projectId)).toEqual([]);
  });
});
