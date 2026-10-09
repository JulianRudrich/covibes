import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Git actions and their approval (spec 29b): who makes a request, who approves, rejects and takes
// back, what becomes of the actions, and what counts as waiting.
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '3a111111-1111-4111-8111-111111111111';
const EDITOR = '3a222222-2222-4222-8222-222222222222';
const APPROVER = '3a333333-3333-4333-8333-333333333333';
const VIEWER = '3a444444-4444-4444-8444-444444444444';
const STRANGER = '3a555555-5555-4555-8555-555555555555';

const GITLAB = 'https://gitlab.example.com';

/** Runs `fn` as a user and keeps what it changed. */
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

async function account(userId: string) {
  await admin.query(
    `insert into git_accounts
       (user_id, base_url, account_id, account_username, account_name, access_token, scope)
     values ($1, $2, 7, 'olga', 'Olga Owner', 'v1.sealed-access', 'api')
     on conflict (user_id) do nothing`,
    [userId, GITLAB],
  );
}

/** A project with its members and, unless told otherwise, a repository the owner picked. */
async function newProject({ repository = 101 }: { repository?: number | null } = {}) {
  const id = randomUUID();
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Vereins-App', $2)`, [
    id,
    OWNER,
  ]);
  await admin.query(
    `insert into project_members (project_id, user_id, role, can_approve_git) values
      ($1, $2, 'owner', false), ($1, $3, 'editor', false), ($1, $4, 'editor', true),
      ($1, $5, 'viewer', false)`,
    [id, OWNER, EDITOR, APPROVER, VIEWER],
  );
  if (repository !== null) await connect(id, repository);
  return id;
}

async function connect(projectId: string, repository: number) {
  await account(OWNER);
  await admin.query(
    `insert into git_connections
       (project_id, base_url, connected_by, account_id, account_username, account_name,
        repository_id, repository_path, repository_name, repository_url)
     values ($1, $2, $3, 7, 'olga', 'Olga Owner', $4, 'verein/app', 'App', $5)
     on conflict (project_id) do update set repository_id = excluded.repository_id`,
    [projectId, GITLAB, OWNER, repository, `${GITLAB}/verein/app`],
  );
}

const milestone = (title = 'Meilenstein 1: Grundgerüst') => ({
  kind: 'milestone',
  payload: { title, description: 'Die App läuft.' },
});

const issue = (taskId: string = randomUUID(), title = 'Login bauen') => ({
  kind: 'issue',
  payload: { title, description: 'Login bauen', milestone: 'Meilenstein 1: Grundgerüst', taskId },
});

function create(userId: string, projectId: string, actions: unknown = [milestone(), issue()]) {
  return commitAs(userId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `select public.create_git_request($1, 'issues', $2::jsonb) as id`,
      [projectId, JSON.stringify(actions)],
    );
    return rows[0]?.id ?? '';
  });
}

function approve(userId: string, projectId: string, requestIds: string[]) {
  return commitAs(userId, async (client) => {
    const { rows } = await client.query<{ approved: number }>(
      'select public.approve_git_requests($1, $2::uuid[]) as approved',
      [projectId, requestIds],
    );
    return rows[0]?.approved;
  });
}

const reject = (userId: string, projectId: string, requestId: string) =>
  commitAs(userId, (client) =>
    client.query('select public.reject_git_request($1, $2)', [projectId, requestId]),
  );

const withdraw = (userId: string, projectId: string, requestId: string) =>
  commitAs(userId, (client) =>
    client.query('select public.withdraw_git_request($1, $2)', [projectId, requestId]),
  );

async function request(requestId: string) {
  const { rows } = await admin.query<{
    status: string;
    requested_by: string | null;
    requested_by_name: string;
    decided_by: string | null;
    decided_by_name: string;
    decided_at: Date | null;
    finished_at: Date | null;
    repository_id: string;
    repository_path: string;
  }>('select * from git_requests where id = $1', [requestId]);
  return rows[0];
}

async function actions(requestId: string) {
  const { rows } = await admin.query<{
    kind: string;
    title: string;
    status: string;
    task_id: string | null;
    error_code: string | null;
  }>(
    `select kind, title, status, task_id, error_code from git_actions
     where request_id = $1 order by position`,
    [requestId],
  );
  return rows;
}

async function jobsOf(requestId: string) {
  const { rows } = await admin.query<{ task: string; queue: string | null; attempts: number }>(
    `select t.identifier as task, q.queue_name as queue, j.max_attempts as attempts
     from graphile_worker._private_jobs j
     join graphile_worker._private_tasks t on t.id = j.task_id
     left join graphile_worker._private_job_queues q on q.id = j.job_queue_id
     where j.payload ->> 'requestId' = $1`,
    [requestId],
  );
  return rows;
}

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'gitreq-owner@example.com', true),
      ($2, 'Edgar Editor', 'gitreq-editor@example.com', true),
      ($3, 'Ada Approver', 'gitreq-approver@example.com', true),
      ($4, 'Vera Viewer', 'gitreq-viewer@example.com', true),
      ($5, 'Sam Stranger', 'gitreq-stranger@example.com', true)`,
    [OWNER, EDITOR, APPROVER, VIEWER, STRANGER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('create_git_request', () => {
  it('stores the request for the project’s repository, with its actions in their order', async () => {
    const projectId = await newProject();
    const taskId = randomUUID();

    const requestId = await create(EDITOR, projectId, [milestone(), issue(taskId)]);

    expect(await request(requestId)).toMatchObject({
      status: 'waiting',
      requested_by: EDITOR,
      requested_by_name: 'Edgar Editor',
      decided_by: null,
      decided_at: null,
      repository_id: '101',
      repository_path: 'verein/app',
    });
    expect(await actions(requestId)).toEqual([
      {
        kind: 'milestone',
        title: 'Meilenstein 1: Grundgerüst',
        status: 'waiting',
        task_id: null,
        error_code: null,
      },
      { kind: 'issue', title: 'Login bauen', status: 'waiting', task_id: taskId, error_code: null },
    ]);
  });

  it('is for owners and editors of a project with a repository', async () => {
    const projectId = await newProject();
    const bare = await newProject({ repository: null });

    await expect(create(VIEWER, projectId)).rejects.toMatchObject({ code: '42501' });
    await expect(create(STRANGER, projectId)).rejects.toMatchObject({ code: '42501' });
    await expect(create(OWNER, bare)).rejects.toMatchObject({ code: 'P0002' });
    expect(await create(OWNER, projectId)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('takes only actions it can read', async () => {
    const projectId = await newProject();
    const invalid = { code: '22023' };

    await expect(create(OWNER, projectId, [])).rejects.toMatchObject(invalid);
    await expect(create(OWNER, projectId, { kind: 'issue' })).rejects.toMatchObject(invalid);
    await expect(create(OWNER, projectId, ['issue'])).rejects.toMatchObject(invalid);
    await expect(create(OWNER, projectId, [{ kind: 'issue' }])).rejects.toMatchObject(invalid);
    await expect(
      create(
        OWNER,
        projectId,
        Array.from({ length: 151 }, () => issue()),
      ),
    ).rejects.toMatchObject(invalid);
    // An issue names its task.
    await expect(
      create(OWNER, projectId, [{ kind: 'issue', payload: { title: 'x' } }]),
    ).rejects.toMatchObject(invalid);
    // A kind the table does not know.
    await expect(
      create(OWNER, projectId, [{ kind: 'tag', payload: { title: 'x' } }]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      commitAs(OWNER, (client) =>
        client.query(`select public.create_git_request($1, 'merge', '[]'::jsonb)`, [projectId]),
      ),
    ).rejects.toMatchObject(invalid);
  });

  it('gives a task one issue per repository', async () => {
    const projectId = await newProject();
    const taskId = randomUUID();
    const taken = { code: '23505' };

    const first = await create(EDITOR, projectId, [issue(taskId)]);
    // While one waits, and twice in one request.
    await expect(create(OWNER, projectId, [issue(taskId)])).rejects.toMatchObject(taken);
    await expect(
      create(OWNER, projectId, [issue(randomUUID()), issue(randomUUID()), issue(taskId)]),
    ).rejects.toMatchObject(taken);
    const twice = randomUUID();
    await expect(create(OWNER, projectId, [issue(twice), issue(twice)])).rejects.toMatchObject(
      taken,
    );

    // Once it has its issue.
    await admin.query(`update git_actions set status = 'done' where request_id = $1`, [first]);
    await admin.query(`update git_requests set status = 'done' where id = $1`, [first]);
    await expect(create(OWNER, projectId, [issue(taskId)])).rejects.toMatchObject(taken);

    // In another repository the task has none yet.
    await connect(projectId, 102);
    expect(await create(OWNER, projectId, [issue(taskId)])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('frees the task of a request that was rejected', async () => {
    const projectId = await newProject();
    const taskId = randomUUID();
    await account(OWNER);
    const first = await create(EDITOR, projectId, [issue(taskId)]);

    await reject(OWNER, projectId, first);

    expect(await create(EDITOR, projectId, [issue(taskId)])).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('approve_git_requests', () => {
  it('is for who may approve Git actions, with a GitLab account of their own', async () => {
    const projectId = await newProject();
    const requestId = await create(EDITOR, projectId);
    await admin.query('delete from git_accounts where user_id = $1', [APPROVER]);

    await expect(approve(EDITOR, projectId, [requestId])).rejects.toMatchObject({ code: '42501' });
    await expect(approve(VIEWER, projectId, [requestId])).rejects.toMatchObject({ code: '42501' });
    await expect(approve(STRANGER, projectId, [requestId])).rejects.toMatchObject({
      code: '42501',
    });
    // The right alone is not enough: the actions run with the approver's account.
    await expect(approve(APPROVER, projectId, [requestId])).rejects.toMatchObject({
      code: '28000',
    });
    expect((await request(requestId))?.status).toBe('waiting');
    expect(await jobsOf(requestId)).toEqual([]);

    await account(APPROVER);
    expect(await approve(APPROVER, projectId, [requestId])).toBe(1);

    expect(await request(requestId)).toMatchObject({
      status: 'approved',
      decided_by: APPROVER,
      decided_by_name: 'Ada Approver',
    });
    expect((await request(requestId))?.decided_at).toBeInstanceOf(Date);
    // One job per request, in the project's own queue.
    expect(await jobsOf(requestId)).toEqual([
      { task: 'git_request', queue: `git:${projectId}`, attempts: 3 },
    ]);
  });

  it('approves several at once, and only what waits or failed', async () => {
    const projectId = await newProject();
    const other = await newProject();
    const first = await create(EDITOR, projectId);
    const second = await create(EDITOR, projectId);
    const rejected = await create(EDITOR, projectId);
    const elsewhere = await create(EDITOR, other);
    await reject(OWNER, projectId, rejected);

    expect(
      await approve(OWNER, projectId, [first, second, rejected, elsewhere, randomUUID()]),
    ).toBe(2);

    expect((await request(first))?.status).toBe('approved');
    expect((await request(second))?.status).toBe('approved');
    expect((await request(rejected))?.status).toBe('rejected');
    // A request of another project is not approved through this one.
    expect((await request(elsewhere))?.status).toBe('waiting');
    // Approved once: a second approval finds nothing to do.
    expect(await approve(OWNER, projectId, [first, second])).toBe(0);
    expect(await jobsOf(first)).toHaveLength(1);
  });

  it('tries a failed request again, with what failed waiting anew', async () => {
    const projectId = await newProject();
    const requestId = await create(EDITOR, projectId, [milestone(), issue(), issue()]);
    await approve(OWNER, projectId, [requestId]);
    // What the worker writes after a run in which GitLab refused the second issue.
    await admin.query(
      `update git_actions set status = 'done', result_number = position + 1
       where request_id = $1 and position < 2`,
      [requestId],
    );
    await admin.query(
      `update git_actions set status = 'failed', error_code = 'forbidden', error_detail = '403'
       where request_id = $1 and position = 2`,
      [requestId],
    );
    await admin.query(
      `update git_requests set status = 'failed', finished_at = now() where id = $1`,
      [requestId],
    );
    await account(APPROVER);

    expect(await approve(APPROVER, projectId, [requestId])).toBe(1);

    expect(await request(requestId)).toMatchObject({
      status: 'approved',
      decided_by: APPROVER,
      finished_at: null,
    });
    expect((await actions(requestId)).map((action) => [action.status, action.error_code])).toEqual([
      ['done', null],
      ['done', null],
      ['waiting', null],
    ]);
    expect(await jobsOf(requestId)).toHaveLength(2);
  });
});

describe('reject_git_request and withdraw_git_request', () => {
  it('rejects what waits or failed, and keeps what is done', async () => {
    const projectId = await newProject();
    const requestId = await create(EDITOR, projectId, [milestone(), issue(), issue()]);
    await admin.query(
      `update git_actions set status = 'done' where request_id = $1 and position = 0`,
      [requestId],
    );
    await admin.query(
      `update git_actions set status = 'failed', error_code = 'failed'
       where request_id = $1 and position = 1`,
      [requestId],
    );
    await admin.query(`update git_requests set status = 'failed' where id = $1`, [requestId]);

    await expect(reject(EDITOR, projectId, requestId)).rejects.toMatchObject({ code: '42501' });
    await reject(APPROVER, projectId, requestId);

    expect(await request(requestId)).toMatchObject({
      status: 'rejected',
      decided_by: APPROVER,
      decided_by_name: 'Ada Approver',
    });
    expect((await request(requestId))?.finished_at).toBeInstanceOf(Date);
    expect((await actions(requestId)).map((action) => action.status)).toEqual([
      'done',
      'dropped',
      'dropped',
    ]);
    // Decided once.
    await expect(reject(OWNER, projectId, requestId)).rejects.toMatchObject({ code: '55000' });
    await expect(reject(OWNER, projectId, randomUUID())).rejects.toMatchObject({ code: 'P0002' });
    // Not through another project.
    const other = await newProject();
    const elsewhere = await create(EDITOR, other);
    await expect(reject(OWNER, projectId, elsewhere)).rejects.toMatchObject({ code: 'P0002' });
  });

  it('lets who made a request take it back while it waits', async () => {
    const projectId = await newProject();
    const requestId = await create(EDITOR, projectId);

    await expect(withdraw(OWNER, projectId, requestId)).rejects.toMatchObject({ code: '42501' });
    await expect(withdraw(STRANGER, projectId, requestId)).rejects.toMatchObject({
      code: 'P0002',
    });
    await withdraw(EDITOR, projectId, requestId);

    expect(await request(requestId)).toMatchObject({ status: 'withdrawn', decided_by: null });
    expect((await actions(requestId)).map((action) => action.status)).toEqual([
      'dropped',
      'dropped',
    ]);
    await expect(withdraw(EDITOR, projectId, requestId)).rejects.toMatchObject({ code: '55000' });

    // What was approved is no longer its maker's to take back.
    const approved = await create(EDITOR, projectId);
    await approve(OWNER, projectId, [approved]);
    await expect(withdraw(EDITOR, projectId, approved)).rejects.toMatchObject({ code: '55000' });
  });
});

describe('a request and the project’s repository', () => {
  it('is taken back when the repository is replaced or removed, unless it runs or is done', async () => {
    const projectId = await newProject();
    const waiting = await create(EDITOR, projectId);
    const failed = await create(EDITOR, projectId);
    const running = await create(EDITOR, projectId);
    const done = await create(EDITOR, projectId);
    await admin.query(`update git_requests set status = 'failed' where id = $1`, [failed]);
    await admin.query(`update git_requests set status = 'approved' where id = $1`, [running]);
    await admin.query(`update git_requests set status = 'done' where id = $1`, [done]);

    // The same repository picked again changes nothing.
    await connect(projectId, 101);
    expect((await request(waiting))?.status).toBe('waiting');

    await connect(projectId, 102);

    expect((await request(waiting))?.status).toBe('withdrawn');
    expect((await request(failed))?.status).toBe('withdrawn');
    expect((await request(running))?.status).toBe('approved');
    expect((await request(done))?.status).toBe('done');
    expect((await actions(waiting)).map((action) => action.status)).toEqual(['dropped', 'dropped']);

    const next = await create(EDITOR, projectId);
    await admin.query('delete from git_connections where project_id = $1', [projectId]);
    expect((await request(next))?.status).toBe('withdrawn');
  });
});

describe('reading and writing the tables', () => {
  it('lets every member read requests and actions, and nobody else', async () => {
    const projectId = await newProject();
    const requestId = await create(EDITOR, projectId);
    const read = (userId: string) =>
      asUser(app, userId, async (client) => {
        const requests = await client.query('select 1 from git_requests where id = $1', [
          requestId,
        ]);
        const steps = await client.query('select 1 from git_actions where request_id = $1', [
          requestId,
        ]);
        return [requests.rowCount, steps.rowCount];
      });

    expect(await read(VIEWER)).toEqual([1, 2]);
    expect(await read(OWNER)).toEqual([1, 2]);
    expect(await read(STRANGER)).toEqual([0, 0]);
  });

  it('is written through the functions only', async () => {
    const projectId = await newProject();
    const requestId = await create(EDITOR, projectId);
    const attempt = (sql: string) => asUser(app, OWNER, (client) => client.query(sql, [requestId]));
    const refused = { code: '42501' };

    await expect(
      attempt(`update git_requests set status = 'approved' where id = $1`),
    ).rejects.toMatchObject(refused);
    await expect(attempt('delete from git_requests where id = $1')).rejects.toMatchObject(refused);
    await expect(
      attempt(`update git_actions set status = 'done' where request_id = $1`),
    ).rejects.toMatchObject(refused);
    await expect(
      attempt(
        `insert into git_actions (request_id, project_id, position, kind, title, payload)
         select id, project_id, 9, 'milestone', 'x', '{}'::jsonb from git_requests where id = $1`,
      ),
    ).rejects.toMatchObject(refused);
  });
});

describe('what waits for whom', () => {
  it('counts requests that wait or failed for who may approve, and schedules their mail', async () => {
    const projectId = await newProject();
    const keys = [OWNER, APPROVER, EDITOR, VIEWER].map((id) => `notification_mail:${id}`);
    await admin.query('delete from graphile_worker._private_jobs where key = any ($1)', [keys]);
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

    const waiting = await create(EDITOR, projectId);
    const failed = await create(EDITOR, projectId);
    const done = await create(EDITOR, projectId);
    await admin.query(`update git_requests set status = 'failed' where id = $1`, [failed]);
    await admin.query(`update git_requests set status = 'done' where id = $1`, [done]);

    expect(await count(OWNER)).toBe(2);
    expect(await count(APPROVER)).toBe(2);
    expect(await count(EDITOR)).toBe(0);
    expect(await count(VIEWER)).toBe(0);
    expect(await mailed(OWNER)).toBe(2);
    expect(await mailed(APPROVER)).toBe(2);
    expect(await mailed(EDITOR)).toBeUndefined();
    expect(await mailed(VIEWER)).toBeUndefined();
    // The mail about what waits goes to who may approve.
    const jobs = await admin.query<{ key: string }>(
      'select key from graphile_worker._private_jobs where key = any ($1) order by key',
      [keys],
    );
    expect(jobs.rows.map((row) => row.key)).toEqual(
      [`notification_mail:${OWNER}`, `notification_mail:${APPROVER}`].sort(),
    );

    await reject(OWNER, projectId, waiting);
    expect(await count(OWNER)).toBe(1);
  });

  it('announces a request, its decision and every action that ended', async () => {
    const projectId = await newProject();
    const heard: string[] = [];
    const listener = await admin.connect();
    listener.on('notification', (message) => {
      // Other tests announce on the same channel.
      let payload: { kind?: string; projectId?: string };
      try {
        payload = JSON.parse(message.payload ?? '') as typeof payload;
      } catch {
        return;
      }
      if (payload.projectId === projectId && payload.kind) heard.push(payload.kind);
    });
    await listener.query('listen covibes_live');
    try {
      const requestId = await create(EDITOR, projectId);
      await expect.poll(() => heard).toEqual(['git']);
      await approve(OWNER, projectId, [requestId]);
      await expect.poll(() => heard).toEqual(['git', 'git']);
      // An action that only starts tells nobody; its end does.
      await admin.query(
        `update git_actions set status = 'started' where request_id = $1 and position = 0`,
        [requestId],
      );
      await admin.query(
        `update git_actions set status = 'done' where request_id = $1 and position = 0`,
        [requestId],
      );
      await expect.poll(() => heard).toEqual(['git', 'git', 'git']);
    } finally {
      await listener.query('unlisten covibes_live');
      listener.release();
    }
  });
});

describe('a request for the plan package (spec 29c)', () => {
  const commit = {
    kind: 'commit',
    payload: {
      title: 'Plan-Paket auf dem Branch covibes/plan-1',
      branch: 'covibes/plan-1',
      startBranch: 'main',
      message: 'Projektplan aus Covibes',
      files: [{ path: 'CLAUDE.md', content: '# Vereins-App\n', mode: 'write' }],
    },
  };
  const mergeRequest = {
    kind: 'merge_request',
    payload: {
      title: 'Projektplan aus Covibes',
      description: '',
      sourceBranch: 'covibes/plan-1',
      targetBranch: 'main',
    },
  };
  const createPackage = (userId: string, projectId: string) =>
    commitAs(userId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `select public.create_git_request($1, 'merge_request', $2::jsonb) as id`,
        [projectId, JSON.stringify([commit, mergeRequest])],
      );
      return rows[0]?.id ?? '';
    });

  it('holds the commit and the merge request as its actions', async () => {
    const projectId = await newProject();

    const requestId = await createPackage(EDITOR, projectId);

    expect(await request(requestId)).toMatchObject({ status: 'waiting', requested_by: EDITOR });
    expect(
      (await actions(requestId)).map((action) => [action.kind, action.title, action.task_id]),
    ).toEqual([
      ['commit', 'Plan-Paket auf dem Branch covibes/plan-1', null],
      ['merge_request', 'Projektplan aus Covibes', null],
    ]);
    // The files of the commit are kept with it: what is approved is what was shown.
    const { rows } = await admin.query<{ path: string }>(
      `select payload -> 'files' -> 0 ->> 'path' as path from git_actions
       where request_id = $1 and kind = 'commit'`,
      [requestId],
    );
    expect(rows).toEqual([{ path: 'CLAUDE.md' }]);
  });

  it('waits alone: a second one is refused until the first is decided', async () => {
    const projectId = await newProject();
    const other = await newProject();
    const first = await createPackage(EDITOR, projectId);
    const taken = { code: '23505' };

    await expect(createPackage(OWNER, projectId)).rejects.toMatchObject(taken);
    // Issues, and the package of another project, are not held up.
    expect(await create(EDITOR, projectId)).toMatch(/^[0-9a-f-]{36}$/);
    expect(await createPackage(EDITOR, other)).toMatch(/^[0-9a-f-]{36}$/);

    // Neither while it runs, nor after it failed.
    await approve(OWNER, projectId, [first]);
    await expect(createPackage(OWNER, projectId)).rejects.toMatchObject(taken);
    await admin.query(`update git_requests set status = 'failed' where id = $1`, [first]);
    await expect(createPackage(OWNER, projectId)).rejects.toMatchObject(taken);

    await reject(OWNER, projectId, first);
    const second = await createPackage(OWNER, projectId);
    await admin.query(`update git_requests set status = 'done' where id = $1`, [second]);
    expect(await createPackage(OWNER, projectId)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('records a merge request that could not follow its commit', async () => {
    const projectId = await newProject();
    const requestId = await createPackage(EDITOR, projectId);

    await admin.query(
      `update git_actions set status = 'failed', error_code = 'blocked'
       where request_id = $1 and kind = 'merge_request'`,
      [requestId],
    );

    expect((await actions(requestId)).map((action) => action.error_code)).toEqual([
      null,
      'blocked',
    ]);
    await expect(
      admin.query(`update git_actions set error_code = 'whatever' where request_id = $1`, [
        requestId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('a request to merge (spec 29d)', () => {
  const merge = (number: number) => ({
    kind: 'merge',
    payload: { title: `!${String(number)} Login per Link`, number, sha: 'abc123' },
  });
  const createMerge = (userId: string, projectId: string, actions: unknown) =>
    commitAs(userId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `select public.create_git_request($1, 'merge', $2::jsonb) as id`,
        [projectId, JSON.stringify(actions)],
      );
      return rows[0]?.id ?? '';
    });

  it('holds the merging of one merge request as its action', async () => {
    const projectId = await newProject();

    const requestId = await createMerge(EDITOR, projectId, [merge(7)]);

    expect(await request(requestId)).toMatchObject({ status: 'waiting', requested_by: EDITOR });
    expect((await actions(requestId)).map((action) => [action.kind, action.title])).toEqual([
      ['merge', '!7 Login per Link'],
    ]);
    // A merge names its merge request.
    await expect(
      createMerge(OWNER, projectId, [{ kind: 'merge', payload: { title: 'x' } }]),
    ).rejects.toMatchObject({ code: '22023' });
  });

  it('waits alone per merge request, in its repository', async () => {
    const projectId = await newProject();
    const first = await createMerge(EDITOR, projectId, [merge(7)]);
    const taken = { code: '23505' };

    await expect(createMerge(OWNER, projectId, [merge(7)])).rejects.toMatchObject(taken);
    // Another merge request, and the package, are not held up.
    expect(await createMerge(OWNER, projectId, [merge(8)])).toMatch(/^[0-9a-f-]{36}$/);

    // Neither while it runs, nor after it failed; once it is decided, it can be asked for again.
    await approve(OWNER, projectId, [first]);
    await expect(createMerge(OWNER, projectId, [merge(7)])).rejects.toMatchObject(taken);
    await admin.query(`update git_requests set status = 'failed' where id = $1`, [first]);
    await expect(createMerge(OWNER, projectId, [merge(7)])).rejects.toMatchObject(taken);
    await reject(OWNER, projectId, first);
    expect(await createMerge(OWNER, projectId, [merge(7)])).toMatch(/^[0-9a-f-]{36}$/);

    // The same number in another repository is another merge request.
    const other = await newProject({ repository: 102 });
    expect(await createMerge(EDITOR, other, [merge(7)])).toMatch(/^[0-9a-f-]{36}$/);
  });
});
