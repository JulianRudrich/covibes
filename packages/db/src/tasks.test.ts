import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Assigning tasks (spec 26b): who assigns, who can be assigned, who reads, who is notified.
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '2b111111-1111-4111-8111-111111111111';
const EDITOR = '2b222222-2222-4222-8222-222222222222';
const VIEWER = '2b333333-3333-4333-8333-333333333333';
const STRANGER = '2b444444-4444-4444-8444-444444444444';

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

const assign = (
  userId: string,
  projectId: string,
  taskId: string,
  assignee: string | null,
  title = 'Login bauen',
) =>
  commitAs(userId, async (client) => {
    const { rows } = await client.query<{ changed: boolean }>(
      'select public.assign_task($1, $2, $3, $4) as changed',
      [projectId, taskId, assignee, title],
    );
    return rows[0]?.changed;
  });

async function taskOf(projectId: string, taskId: string) {
  const { rows } = await admin.query<{
    title: string;
    assignee_id: string | null;
    assigned_by: string | null;
  }>('select title, assignee_id, assigned_by from tasks where project_id = $1 and id = $2', [
    projectId,
    taskId,
  ]);
  return rows[0];
}

async function notificationsOf(projectId: string) {
  const { rows } = await admin.query<{
    user_id: string;
    kind: string;
    actor_name: string;
    excerpt: string;
    project_name: string;
  }>(
    `select user_id, kind, actor_name, excerpt, project_name from notifications
      where project_id = $1 and kind = 'task_assigned' order by created_at`,
    [projectId],
  );
  return rows;
}

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'tasks-owner@example.com', true),
      ($2, 'Eddie Editor', 'tasks-editor@example.com', true),
      ($3, 'Vera Viewer', 'tasks-viewer@example.com', true),
      ($4, 'Sam Stranger', 'tasks-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('assign_task', () => {
  it('gives a task to a member and tells them who gave it', async () => {
    const projectId = await newProject();
    const taskId = randomUUID();

    expect(await assign(OWNER, projectId, taskId, EDITOR)).toBe(true);

    expect(await taskOf(projectId, taskId)).toEqual({
      title: 'Login bauen',
      assignee_id: EDITOR,
      assigned_by: OWNER,
    });
    expect(await notificationsOf(projectId)).toEqual([
      {
        user_id: EDITOR,
        kind: 'task_assigned',
        actor_name: 'Olga Owner',
        excerpt: 'Login bauen',
        project_name: 'Vereins-App',
      },
    ]);
  });

  it('tells nobody about a task someone takes themselves, or already has', async () => {
    const projectId = await newProject();
    const taskId = randomUUID();

    expect(await assign(EDITOR, projectId, taskId, EDITOR)).toBe(true);
    // The same assignee again changes nothing, whoever asks.
    expect(await assign(OWNER, projectId, taskId, EDITOR, 'Anderer Text')).toBe(false);

    expect(await taskOf(projectId, taskId)).toMatchObject({
      title: 'Login bauen',
      assigned_by: EDITOR,
    });
    expect(await notificationsOf(projectId)).toEqual([]);
  });

  it('passes a task on, tells the new assignee and clears it again', async () => {
    const projectId = await newProject();
    const taskId = randomUUID();
    await assign(OWNER, projectId, taskId, EDITOR);

    // Viewers do tasks too.
    expect(await assign(EDITOR, projectId, taskId, VIEWER, 'Login per Link bauen')).toBe(true);
    expect(await taskOf(projectId, taskId)).toEqual({
      title: 'Login per Link bauen',
      assignee_id: VIEWER,
      assigned_by: EDITOR,
    });
    expect((await notificationsOf(projectId)).map((row) => row.user_id)).toEqual([EDITOR, VIEWER]);

    expect(await assign(OWNER, projectId, taskId, null)).toBe(true);
    expect(await taskOf(projectId, taskId)).toMatchObject({ assignee_id: null });
    // Clearing tells nobody, and clearing what nobody has changes nothing.
    expect(await notificationsOf(projectId)).toHaveLength(2);
    expect(await assign(OWNER, projectId, randomUUID(), null)).toBe(false);
  });

  it('is for owners and editors, and gives tasks to members only', async () => {
    const projectId = await newProject();
    const taskId = randomUUID();

    await expect(assign(VIEWER, projectId, taskId, VIEWER)).rejects.toMatchObject({
      code: '42501',
    });
    await expect(assign(STRANGER, projectId, taskId, STRANGER)).rejects.toMatchObject({
      code: '42501',
    });
    await expect(assign(OWNER, projectId, taskId, STRANGER)).rejects.toMatchObject({
      code: '22023',
    });
    expect(await taskOf(projectId, taskId)).toBeUndefined();
  });

  it('keeps titles within bounds', async () => {
    const projectId = await newProject();
    const taskId = randomUUID();

    await assign(OWNER, projectId, taskId, EDITOR, `  ${'x'.repeat(500)}  `);

    expect((await taskOf(projectId, taskId))?.title).toHaveLength(300);
    expect((await notificationsOf(projectId))[0]?.excerpt).toHaveLength(200);
  });

  it('schedules the mail for the assignee, as for a mention (spec 22b)', async () => {
    const projectId = await newProject();
    const key = `notification_mail:${VIEWER}`;
    const jobs = async () =>
      (await admin.query('select 1 from graphile_worker._private_jobs where key = $1', [key]))
        .rowCount;
    await admin.query('delete from graphile_worker._private_jobs where key = $1', [key]);

    await assign(OWNER, projectId, randomUUID(), VIEWER);

    expect(await jobs()).toBe(1);
    await admin.query('delete from graphile_worker._private_jobs where key = $1', [key]);
  });
});

describe('tasks', () => {
  it('are read by the members of their project and written by nobody directly', async () => {
    const projectId = await newProject();
    const other = await newProject();
    const taskId = randomUUID();
    await assign(OWNER, projectId, taskId, EDITOR);
    await assign(OWNER, other, randomUUID(), EDITOR);
    await admin.query('delete from project_members where project_id = $1 and user_id = $2', [
      other,
      VIEWER,
    ]);

    const read = (userId: string) =>
      asUser(app, userId, (client) =>
        client.query<{ id: string }>('select id from tasks where project_id = any($1)', [
          [projectId, other],
        ]),
      );
    expect((await read(VIEWER)).rows).toEqual([{ id: taskId }]);
    expect((await read(EDITOR)).rows).toHaveLength(2);
    expect((await read(STRANGER)).rows).toEqual([]);

    await expect(
      asUser(app, OWNER, (client) =>
        client.query('update tasks set assignee_id = $1 where id = $2', [OWNER, taskId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asUser(app, OWNER, (client) =>
        client.query('insert into tasks (project_id, id) values ($1, $2)', [
          projectId,
          randomUUID(),
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('lose their assignee when the member leaves, and go with their project', async () => {
    const projectId = await newProject();
    const mine = randomUUID();
    const theirs = randomUUID();
    await assign(OWNER, projectId, mine, OWNER);
    await assign(OWNER, projectId, theirs, EDITOR);

    await admin.query('delete from project_members where project_id = $1 and user_id = $2', [
      projectId,
      EDITOR,
    ]);

    expect(await taskOf(projectId, theirs)).toMatchObject({ assignee_id: null, assigned_by: null });
    expect(await taskOf(projectId, mine)).toMatchObject({ assignee_id: OWNER });

    await admin.query('delete from projects where id = $1', [projectId]);
    expect(await taskOf(projectId, mine)).toBeUndefined();
  });
});
