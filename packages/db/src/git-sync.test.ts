import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Reading the repository's state (spec 30a): who asks for it and how often, what a webhook
// queues, and who reads what was read.
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '3b111111-1111-4111-8111-111111111111';
const VIEWER = '3b222222-2222-4222-8222-222222222222';
const STRANGER = '3b333333-3333-4333-8333-333333333333';

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

/** A project with an owner and a viewer and, unless told otherwise, a repository. */
async function newProject({ repository = true }: { repository?: boolean } = {}) {
  const id = randomUUID();
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Vereins-App', $2)`, [
    id,
    OWNER,
  ]);
  await admin.query(
    `insert into project_members (project_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'viewer')`,
    [id, OWNER, VIEWER],
  );
  if (repository) {
    await admin.query(
      `insert into git_accounts
         (user_id, base_url, account_id, account_username, access_token)
       values ($1, $2, 7, 'olga', 'v1.sealed') on conflict (user_id) do nothing`,
      [OWNER, GITLAB],
    );
    await admin.query(
      `insert into git_connections
         (project_id, base_url, connected_by, account_id, account_username,
          repository_id, repository_path, repository_name, repository_url)
       values ($1, $2, $3, 7, 'olga', 101, 'verein/app', 'App', $4)`,
      [id, GITLAB, OWNER, `${GITLAB}/verein/app`],
    );
  }
  return id;
}

const ask = (userId: string, projectId: string, force = false) =>
  commitAs(userId, async (client) => {
    const { rows } = await client.query<{ queued: boolean }>(
      'select public.request_git_sync($1, $2) as queued',
      [projectId, force],
    );
    return rows[0]?.queued;
  });

async function jobsOf(projectId: string) {
  const { rows } = await admin.query<{ task: string; queue: string | null; attempts: number }>(
    `select t.identifier as task, q.queue_name as queue, j.max_attempts as attempts
     from graphile_worker._private_jobs j
     join graphile_worker._private_tasks t on t.id = j.task_id
     left join graphile_worker._private_job_queues q on q.id = j.job_queue_id
     where j.key = $1`,
    [`git_sync:${projectId}`],
  );
  return rows;
}

/** Lets time pass for a project: its last request was `seconds` ago, and its job has run. */
async function later(projectId: string, seconds: number) {
  await admin.query(
    `update git_sync set requested_at = now() - make_interval(secs => $2) where project_id = $1`,
    [projectId, seconds],
  );
  await admin.query('delete from graphile_worker._private_jobs where key = $1', [
    `git_sync:${projectId}`,
  ]);
}

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'gitsync-owner@example.com', true),
      ($2, 'Vera Viewer', 'gitsync-viewer@example.com', true),
      ($3, 'Sam Stranger', 'gitsync-stranger@example.com', true)`,
    [OWNER, VIEWER, STRANGER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('request_git_sync', () => {
  it('queues the job for a member of a project with a repository, one per project', async () => {
    const projectId = await newProject();

    expect(await ask(VIEWER, projectId)).toBe(true);

    expect(await jobsOf(projectId)).toEqual([
      { task: 'git_sync', queue: `git-sync:${projectId}`, attempts: 2 },
    ]);
    const { rows } = await admin.query<{ requested_at: Date | null; synced_at: Date | null }>(
      'select requested_at, synced_at from git_sync where project_id = $1',
      [projectId],
    );
    expect(rows[0]?.requested_at).toBeInstanceOf(Date);
    expect(rows[0]?.synced_at).toBeNull();
  });

  it('reads not more often than every two minutes, and with a click every ten seconds', async () => {
    const projectId = await newProject();
    expect(await ask(OWNER, projectId)).toBe(true);

    // Asked a moment ago: neither the interval nor a second click queue another reading.
    expect(await ask(VIEWER, projectId)).toBe(false);
    expect(await ask(OWNER, projectId, true)).toBe(false);

    await later(projectId, 30);
    expect(await ask(VIEWER, projectId)).toBe(false);
    expect(await ask(VIEWER, projectId, true)).toBe(true);

    await later(projectId, 121);
    expect(await ask(OWNER, projectId)).toBe(true);
    expect(await jobsOf(projectId)).toHaveLength(1);
  });

  it('queues nothing without a repository, and is there for members only', async () => {
    const bare = await newProject({ repository: false });
    const projectId = await newProject();

    expect(await ask(OWNER, bare)).toBe(false);
    expect(await jobsOf(bare)).toEqual([]);
    await expect(ask(STRANGER, projectId)).rejects.toMatchObject({ code: 'P0002' });
    await expect(ask(STRANGER, randomUUID())).rejects.toMatchObject({ code: 'P0002' });
  });
});

describe('queue_git_sync', () => {
  it('turns a burst of calls into one job, as a webhook sends them', async () => {
    const projectId = await newProject();

    for (let call = 0; call < 5; call += 1) {
      const { rows } = await admin.query<{ queued: boolean }>(
        'select private.queue_git_sync($1) as queued',
        [projectId],
      );
      expect(rows[0]?.queued).toBe(true);
    }

    expect(await jobsOf(projectId)).toHaveLength(1);
  });

  it('is not for the app role to call', async () => {
    const projectId = await newProject();

    await expect(
      asUser(app, OWNER, (client) =>
        client.query('select private.queue_git_sync($1)', [projectId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('what was read', () => {
  it('is read by members: the state of the issues and when it was read', async () => {
    const projectId = await newProject();
    await admin.query(
      `insert into git_issue_states (project_id, base_url, repository_id, number, state)
       values ($1, $2, 101, 4, 'opened'), ($1, $2, 101, 5, 'closed')`,
      [projectId, GITLAB],
    );
    await admin.query(
      `insert into git_sync (project_id, requested_at, synced_at) values ($1, now(), now())`,
      [projectId],
    );
    const read = (userId: string) =>
      asUser(app, userId, async (client) => {
        const states = await client.query<{ number: string; state: string }>(
          'select number, state from git_issue_states where project_id = $1 order by number',
          [projectId],
        );
        const sync = await client.query('select 1 from git_sync where project_id = $1', [
          projectId,
        ]);
        return { states: states.rows, synced: sync.rowCount };
      });

    expect(await read(VIEWER)).toEqual({
      states: [
        { number: '4', state: 'opened' },
        { number: '5', state: 'closed' },
      ],
      synced: 1,
    });
    expect(await read(STRANGER)).toEqual({ states: [], synced: 0 });
  });

  it('is written by the worker only, and knows two states', async () => {
    const projectId = await newProject();
    const refused = { code: '42501' };

    await expect(
      asUser(app, OWNER, (client) =>
        client.query(
          `insert into git_issue_states (project_id, base_url, repository_id, number, state)
           values ($1, $2, 101, 4, 'closed')`,
          [projectId, GITLAB],
        ),
      ),
    ).rejects.toMatchObject(refused);
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(`insert into git_sync (project_id) values ($1)`, [projectId]),
      ),
    ).rejects.toMatchObject(refused);
    await expect(
      admin.query(
        `insert into git_issue_states (project_id, base_url, repository_id, number, state)
         values ($1, $2, 101, 4, 'merged')`,
        [projectId, GITLAB],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('starts anew when the project gets another repository or loses its repository', async () => {
    const synced = async (projectId: string) => {
      const { rowCount } = await admin.query('select 1 from git_sync where project_id = $1', [
        projectId,
      ]);
      return rowCount;
    };
    const changed = await newProject();
    const removed = await newProject();
    const kept = await newProject();
    for (const projectId of [changed, removed, kept]) {
      await admin.query(
        `insert into git_sync (project_id, requested_at, synced_at) values ($1, now(), now())`,
        [projectId],
      );
    }

    await admin.query(`update git_connections set repository_id = 103 where project_id = $1`, [
      changed,
    ]);
    await admin.query(`delete from git_connections where project_id = $1`, [removed]);
    // The same repository under a new name is still the same repository.
    await admin.query(`update git_connections set repository_name = 'Neu' where project_id = $1`, [
      kept,
    ]);

    expect(await synced(changed)).toBe(0);
    expect(await synced(removed)).toBe(0);
    expect(await synced(kept)).toBe(1);
    // Nothing holds the next reading back.
    expect(await ask(OWNER, changed)).toBe(true);
  });

  it('keeps the secret of the webhook from every user', async () => {
    const projectId = await newProject();
    await admin.query(`insert into git_webhooks (project_id, secret) values ($1, 'v1.sealed')`, [
      projectId,
    ]);

    await expect(
      asUser(app, OWNER, (client) =>
        client.query('select secret from git_webhooks where project_id = $1', [projectId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
