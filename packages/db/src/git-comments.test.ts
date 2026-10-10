import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

// The review as a comment (spec 30c): a Git request of its own kind, once per review, and what
// waits for an older review of a merge request is taken back.
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '3d111111-1111-4111-8111-111111111111';
const EDITOR = '3d222222-2222-4222-8222-222222222222';
const VIEWER = '3d333333-3333-4333-8333-333333333333';

const GITLAB = 'https://gitlab.example.com';
const sha = (index: number) =>
  `${index.toString(16).padStart(8, '0')}c3d4e5f60718293a4b5c6d7e8f901234`;

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

/** A project with an owner, an editor and a viewer, and a repository. */
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
  await admin.query(
    `insert into git_accounts (user_id, base_url, account_id, account_username, access_token)
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
  return id;
}

let states = 0;

/** A review of a merge request, written unless told otherwise. */
async function newReview(projectId: string, number = 7, written = true) {
  states += 1;
  const { rows } = await admin.query<{ id: string }>(
    `select private.start_git_review(
       $1, $2, $3, 'Login per Link', $4, '4-login', 'Coder', 4, 'auto', null
     ) as id`,
    [projectId, number, sha(states), `${GITLAB}/verein/app/-/merge_requests/${String(number)}`],
  );
  const id = rows[0]?.id ?? '';
  if (written) {
    await admin.query(
      `update git_reviews set verdict = 'deviates', summary = 'Weicht ab.', finished_at = now()
       where id = $1`,
      [id],
    );
  }
  return id;
}

const comment = (reviewId: string, number = 7, extra: Record<string, unknown> = {}) => [
  {
    kind: 'comment',
    payload: {
      title: `Review von !${String(number)}`,
      number,
      reviewId,
      body: 'Der Merge Request weicht ab.',
      ...extra,
    },
  },
];

/** A person lays a comment before the approvers. */
const ask = (userId: string, projectId: string, actions: unknown) =>
  commitAs(userId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `select public.create_git_request($1, 'comment', $2::jsonb) as id`,
      [projectId, JSON.stringify(actions)],
    );
    return rows[0]?.id ?? '';
  });

/** The moderator does, through the worker. */
async function propose(projectId: string, actions: unknown) {
  const { rows } = await admin.query<{ id: string }>(
    `select private.insert_git_request($1, 'comment', $2::jsonb, null, 'moderator') as id`,
    [projectId, JSON.stringify(actions)],
  );
  return rows[0]?.id ?? '';
}

async function requestOf(id: string) {
  const { rows } = await admin.query<{
    kind: string;
    status: string;
    agent_key: string | null;
    requested_by: string | null;
    action_kind: string;
    action_status: string;
    title: string;
    payload: Record<string, unknown>;
  }>(
    `select r.kind, r.status, r.agent_key, r.requested_by, a.kind as action_kind,
            a.status as action_status, a.title, a.payload
     from git_requests r join git_actions a on a.request_id = r.id where r.id = $1`,
    [id],
  );
  return rows[0];
}

const setStatus = (id: string, status: string) =>
  admin.query(`update git_requests set status = $2 where id = $1`, [id, status]);

async function withdrawOlder(projectId: string, number: number, reviewId: string) {
  const { rows } = await admin.query<{ taken: number }>(
    `select private.withdraw_older_review_comments($1, $2, $3) as taken`,
    [projectId, number, reviewId],
  );
  return rows[0]?.taken;
}

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'gitcomment-owner@example.com', true),
      ($2, 'Eddie Editor', 'gitcomment-editor@example.com', true),
      ($3, 'Vera Viewer', 'gitcomment-viewer@example.com', true)`,
    [OWNER, EDITOR, VIEWER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('a request to post a review as a comment', () => {
  it('waits for approval with its one action, made by a person or by the moderator', async () => {
    const projectId = await newProject();
    const first = await newReview(projectId, 7);
    const second = await newReview(projectId, 8);

    const asked = await ask(EDITOR, projectId, comment(first, 7));
    const proposed = await propose(projectId, comment(second, 8));

    expect(await requestOf(asked)).toMatchObject({
      kind: 'comment',
      status: 'waiting',
      agent_key: null,
      requested_by: EDITOR,
      action_kind: 'comment',
      action_status: 'waiting',
      title: 'Review von !7',
      payload: { number: 7, reviewId: first, body: 'Der Merge Request weicht ab.' },
    });
    expect(await requestOf(proposed)).toMatchObject({
      status: 'waiting',
      agent_key: 'moderator',
      requested_by: null,
    });
  });

  it('is for owners and editors', async () => {
    const projectId = await newProject();
    const review = await newReview(projectId);

    await expect(ask(VIEWER, projectId, comment(review))).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('needs a written review of this project, and the merge request the review is for', async () => {
    const projectId = await newProject();
    const other = await newProject();
    const written = await newReview(projectId, 7);
    const running = await newReview(projectId, 8, false);
    const foreign = await newReview(other, 7);
    const gone = { code: 'P0002' };

    await expect(ask(OWNER, projectId, comment(running, 8))).rejects.toMatchObject(gone);
    await expect(ask(OWNER, projectId, comment(foreign, 7))).rejects.toMatchObject(gone);
    await expect(ask(OWNER, projectId, comment(written, 9))).rejects.toMatchObject(gone);
    await expect(ask(OWNER, projectId, comment(randomUUID(), 7))).rejects.toMatchObject(gone);
    await expect(ask(OWNER, projectId, comment('no-review', 7))).rejects.toMatchObject({
      code: '22P02',
    });
  });

  it('names its merge request, its review and its text', async () => {
    const projectId = await newProject();
    const review = await newReview(projectId);
    const invalid = { code: '22023' };

    for (const missing of ['number', 'reviewId', 'body', 'title']) {
      const [action] = comment(review);
      const payload = Object.fromEntries(
        Object.entries(action?.payload ?? {}).filter(([key]) => key !== missing),
      );
      await expect(
        ask(OWNER, projectId, [{ kind: 'comment', payload }]),
        missing,
      ).rejects.toMatchObject(invalid);
    }
  });

  it('is made once per review while it waits, runs or failed, and never after it was posted', async () => {
    const projectId = await newProject();
    const review = await newReview(projectId);
    const first = await ask(OWNER, projectId, comment(review));
    const taken = { code: '23505' };

    await expect(ask(EDITOR, projectId, comment(review))).rejects.toMatchObject(taken);
    await expect(propose(projectId, comment(review))).rejects.toMatchObject(taken);
    for (const status of ['approved', 'failed']) {
      await setStatus(first, status);
      await expect(ask(EDITOR, projectId, comment(review))).rejects.toMatchObject(taken);
    }
    // Two comments for one review in one request are one too many as well.
    const other = await newReview(projectId, 8);
    await expect(
      ask(OWNER, projectId, [...comment(other, 8), ...comment(other, 8)]),
    ).rejects.toMatchObject(taken);

    // Rejected or taken back, it can be laid before the approvers again.
    await setStatus(first, 'rejected');
    const second = await ask(EDITOR, projectId, comment(review));
    expect(second).not.toBe(first);
    await setStatus(second, 'done');
    await expect(ask(OWNER, projectId, comment(review))).rejects.toMatchObject(taken);
  });
});

describe('withdraw_older_review_comments', () => {
  it('takes back what waits for an older review of the merge request, and nothing else', async () => {
    const projectId = await newProject();
    const older = await newReview(projectId, 7);
    const approved = await newReview(projectId, 7);
    const elsewhere = await newReview(projectId, 8);
    const newer = await newReview(projectId, 7);
    const waiting = await propose(projectId, comment(older, 7));
    const running = await propose(projectId, comment(approved, 7));
    await setStatus(running, 'approved');
    const other = await propose(projectId, comment(elsewhere, 8));
    const own = await propose(projectId, comment(newer, 7));

    expect(await withdrawOlder(projectId, 7, newer)).toBe(1);

    expect(await requestOf(waiting)).toMatchObject({
      status: 'withdrawn',
      action_status: 'dropped',
    });
    // What runs is finished; another merge request and the newer review keep theirs.
    expect((await requestOf(running))?.status).toBe('approved');
    expect((await requestOf(other))?.status).toBe('waiting');
    expect((await requestOf(own))?.status).toBe('waiting');
    expect(await withdrawOlder(projectId, 7, newer)).toBe(0);
    // The older review can be laid before the approvers again by a person.
    expect(await ask(OWNER, projectId, comment(older, 7))).not.toBe(waiting);
  });

  it('is not for the app role to call', async () => {
    const projectId = await newProject();
    const review = await newReview(projectId);

    await expect(
      commitAs(OWNER, (client) =>
        client.query('select private.withdraw_older_review_comments($1, 7, $2)', [
          projectId,
          review,
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
