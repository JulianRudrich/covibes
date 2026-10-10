import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Reviews of merge requests (spec 30b): who starts one, once per state of the commits, within the
// bounds of a day, and who reads them.
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '3c111111-1111-4111-8111-111111111111';
const EDITOR = '3c222222-2222-4222-8222-222222222222';
const VIEWER = '3c333333-3333-4333-8333-333333333333';
const STRANGER = '3c444444-4444-4444-8444-444444444444';

const GITLAB = 'https://gitlab.example.com';
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const NEXT_SHA = 'b2c3d4e5f60718293a4b5c6d7e8f90123456789a';

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

/** A project with an owner, an editor and a viewer and, unless told otherwise, a repository. */
async function newProject({ repository = true }: { repository?: boolean } = {}) {
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

type Asked = { number?: number; sha?: string; issue?: number | null };

/** A person asks for the review of a merge request. */
const ask = (userId: string, projectId: string, { number = 7, sha = SHA, issue = 4 }: Asked = {}) =>
  commitAs(userId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `select public.request_git_review($1, $2, $3, 'Login per Link', $4, '4-login', 'Coder', $5)
         as id`,
      [projectId, number, sha, `${GITLAB}/verein/app/-/merge_requests/${String(number)}`, issue],
    );
    return rows[0]?.id;
  });

/** The reading of the repository's state starts a review, or a person through the server. */
async function start(
  projectId: string,
  trigger: 'auto' | 'manual',
  { number = 7, sha = SHA, issue = 4 }: Asked = {},
) {
  const { rows } = await admin.query<{ id: string | null }>(
    `select private.start_git_review(
       $1, $2, $3, 'Login per Link', $4, '4-login', 'Coder', $5, $6, null
     ) as id`,
    [
      projectId,
      number,
      sha,
      `${GITLAB}/verein/app/-/merge_requests/${String(number)}`,
      issue,
      trigger,
    ],
  );
  return rows[0]?.id ?? null;
}

async function reviewOf(id: string | null | undefined) {
  const { rows } = await admin.query<{
    number: string;
    sha: string;
    base_url: string;
    repository_id: string;
    issue_number: string | null;
    trigger: string;
    requested_by: string | null;
    run_id: string;
    verdict: string | null;
    kind: string;
    agent_key: string;
    status: string;
  }>(
    `select g.number, g.sha, g.base_url, g.repository_id, g.issue_number, g.trigger,
            g.requested_by, g.run_id, g.verdict, r.kind, r.agent_key, r.status
     from git_reviews g join ai_runs r on r.id = g.run_id where g.id = $1`,
    [id],
  );
  return rows[0];
}

async function jobsOf(projectId: string) {
  const { rows } = await admin.query<{ queue: string | null; attempts: number; payload: unknown }>(
    `select q.queue_name as queue, j.max_attempts as attempts, j.payload
     from graphile_worker._private_jobs j
     join graphile_worker._private_tasks t on t.id = j.task_id
     left join graphile_worker._private_job_queues q on q.id = j.job_queue_id
     where t.identifier = 'mr_review' and q.queue_name = $1`,
    [`review:${projectId}`],
  );
  return rows;
}

/** The run of a review ends: the model wrote it, or it failed. */
async function finish(id: string | null | undefined, status: 'done' | 'error') {
  await admin.query(
    `update ai_runs set status = $2, finished_at = now()
     where id = (select run_id from git_reviews where id = $1)`,
    [id, status],
  );
  if (status === 'done') {
    await admin.query(
      `update git_reviews set verdict = 'fits', summary = 'Passt.', finished_at = now()
       where id = $1`,
      [id],
    );
  }
}

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'gitreview-owner@example.com', true),
      ($2, 'Eddie Editor', 'gitreview-editor@example.com', true),
      ($3, 'Vera Viewer', 'gitreview-viewer@example.com', true),
      ($4, 'Sam Stranger', 'gitreview-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('request_git_review', () => {
  it('starts a review for an editor: a run of the moderator and its job', async () => {
    const projectId = await newProject();

    const id = await ask(EDITOR, projectId);

    expect(await reviewOf(id)).toMatchObject({
      number: '7',
      sha: SHA,
      base_url: GITLAB,
      repository_id: '101',
      issue_number: '4',
      trigger: 'manual',
      requested_by: EDITOR,
      verdict: null,
      kind: 'review',
      agent_key: 'moderator',
      status: 'queued',
    });
    const jobs = await jobsOf(projectId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ attempts: 1 });
    expect(jobs[0]?.payload).toMatchObject({ reviewId: id });
  });

  it('is for owners and editors of a project with a repository', async () => {
    const projectId = await newProject();
    const bare = await newProject({ repository: false });

    await expect(ask(VIEWER, projectId)).rejects.toMatchObject({ code: '42501' });
    await expect(ask(STRANGER, projectId)).rejects.toMatchObject({ code: '42501' });
    await expect(ask(OWNER, bare)).rejects.toMatchObject({ code: 'P0002' });
    expect(await jobsOf(projectId)).toEqual([]);
  });

  it('reviews a state of the commits once, and a new state anew', async () => {
    const projectId = await newProject();
    const first = await ask(OWNER, projectId);

    // It runs: a second click starts nothing.
    await expect(ask(EDITOR, projectId)).rejects.toMatchObject({ code: '55000' });
    await finish(first, 'done');
    await expect(ask(EDITOR, projectId)).rejects.toMatchObject({ code: '55000' });

    const second = await ask(EDITOR, projectId, { sha: NEXT_SHA });
    expect(second).not.toBe(first);
    expect(await jobsOf(projectId)).toHaveLength(2);
    // The review of the state before stays.
    expect(await reviewOf(first)).toMatchObject({ sha: SHA, verdict: 'fits' });
  });

  it('starts a review again that failed or was lost, with a run of its own', async () => {
    const projectId = await newProject();
    const failed = await ask(OWNER, projectId);
    const before = await reviewOf(failed);
    await finish(failed, 'error');

    expect(await ask(EDITOR, projectId)).toBe(failed);

    const after = await reviewOf(failed);
    expect(after).toMatchObject({ status: 'queued', requested_by: EDITOR });
    expect(after?.run_id).not.toBe(before?.run_id);

    // A run that neither ended nor failed for ten minutes is taken as lost.
    await admin.query(
      `update ai_runs set created_at = now() - interval '11 minutes' where id = $1`,
      [after?.run_id],
    );
    expect(await ask(OWNER, projectId)).toBe(failed);
  });

  it('takes no state that is no commit', async () => {
    const projectId = await newProject();

    await expect(ask(OWNER, projectId, { sha: 'main; drop table' })).rejects.toMatchObject({
      code: '23514',
    });
  });
});

describe('start_git_review', () => {
  it('starts a review by itself once per state, and not again after a failure', async () => {
    const projectId = await newProject();

    const id = await start(projectId, 'auto');

    expect(await reviewOf(id)).toMatchObject({ trigger: 'auto', requested_by: null });
    expect(await start(projectId, 'auto')).toBeNull();
    await finish(id, 'error');
    // The next reading does not try a merge request again that could not be reviewed.
    expect(await start(projectId, 'auto')).toBeNull();
    expect(await start(projectId, 'auto', { sha: NEXT_SHA })).not.toBeNull();
    expect(await jobsOf(projectId)).toHaveLength(2);
  });

  it('starts nothing for a project without a repository', async () => {
    const bare = await newProject({ repository: false });

    expect(await start(bare, 'auto')).toBeNull();
    expect(await start(bare, 'manual')).toBeNull();
  });

  it('stops by itself after 20 reviews a day, and for everyone after 60', async () => {
    const projectId = await newProject();
    const sha = (index: number) => `${index.toString(16).padStart(8, '0')}${SHA.slice(8)}`;
    for (let index = 0; index < 20; index += 1) {
      expect(await start(projectId, 'auto', { sha: sha(index) })).not.toBeNull();
    }

    expect(await start(projectId, 'auto', { sha: sha(20) })).toBeNull();
    // A person still gets one.
    expect(await ask(OWNER, projectId, { sha: sha(20) })).toBeDefined();

    for (let index = 21; index < 60; index += 1) {
      expect(await start(projectId, 'manual', { sha: sha(index) })).not.toBeNull();
    }
    await expect(ask(OWNER, projectId, { sha: sha(60) })).rejects.toMatchObject({
      code: '53400',
    });

    // Yesterday's reviews do not count.
    await admin.query(
      `update git_reviews set created_at = now() - interval '25 hours' where project_id = $1`,
      [projectId],
    );
    expect(await start(projectId, 'auto', { sha: sha(60) })).not.toBeNull();
  });

  it('is not for the app role to call', async () => {
    const projectId = await newProject();

    await expect(
      asUser(app, OWNER, (client) =>
        client.query(
          `select private.start_git_review(
             $1, 7, $2, 'x', 'https://gitlab.example.com/x', 'b', 'a', null, 'manual', null
           )`,
          [projectId, SHA],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('a review', () => {
  it('is read by members, and written by nobody but the worker', async () => {
    const projectId = await newProject();
    const id = await ask(OWNER, projectId);
    const read = (userId: string) =>
      asUser(app, userId, async (client) => {
        const { rowCount } = await client.query('select 1 from git_reviews where id = $1', [id]);
        return rowCount;
      });

    expect(await read(VIEWER)).toBe(1);
    expect(await read(STRANGER)).toBe(0);
    await expect(
      asUser(app, OWNER, (client) =>
        client.query(`update git_reviews set verdict = 'fits' where id = $1`, [id]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asUser(app, OWNER, (client) => client.query('delete from git_reviews where id = $1', [id])),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('knows two verdicts and keeps its findings as a list', async () => {
    const projectId = await newProject();
    const id = await ask(OWNER, projectId);

    await expect(
      admin.query(`update git_reviews set verdict = 'maybe' where id = $1`, [id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      admin.query(`update git_reviews set findings = '{"title": "x"}'::jsonb where id = $1`, [id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('goes with its project, and with its run', async () => {
    const projectId = await newProject();
    const id = await ask(OWNER, projectId);
    const other = await ask(OWNER, projectId, { sha: NEXT_SHA });
    const review = await reviewOf(id);

    await admin.query('delete from ai_runs where id = $1', [review?.run_id]);
    expect(await reviewOf(id)).toBeUndefined();

    await admin.query('delete from projects where id = $1', [projectId]);
    expect(await reviewOf(other)).toBeUndefined();
  });
});
