import { randomUUID } from 'node:crypto';

import {
  ensureTaskIds,
  planNodesFromMarkdown,
  writePlanSection,
  type ApiErrorBody,
  type GitConnectStart,
  type GitIssuePlan,
  type GitMergeRequests,
  type GitRequestCreated,
  type GitReview,
  type GitReviews,
  type GitReviewStarted,
  type ProjectSummary,
  type Roadmap,
} from '@covibes/shared';
import { describe, expect, it, vi } from 'vitest';

import { gatherPackageInput } from '@server/api/package';
import { GatewayLimitError, type AgentReplyResult } from '@server/ai-gateway';
import { createGitlabClient } from '@server/integrations/gitlab/client';
import { createGitConnections } from '@server/integrations/gitlab/connections';
import { repositoryReaders } from '@server/integrations/gitlab/repository';
import { gitlabSetup } from '@server/integrations/gitlab/setup';
import { gitlabWriter } from '@server/integrations/gitlab/writer';
import { runGitRequest } from '@server/tasks/git-request';
import { runGitSync } from '@server/tasks/git-sync';
import { REVIEW_MODEL, reviewMergeRequest, type MrReviewDeps } from '@server/tasks/mr-review';
import { APP_URL, createTestServer } from '@server/testing';

// Reviews of merge requests against the architecture (spec 30b): issues and a merge request in
// the stand-in, the reading of the repository's state that starts the review, the worker's job
// with a scripted model, and what the API tells of it.
const test = createTestServer();
const REPOSITORY = '/api/dev/gitlab/beispiel-verein/vereins-app';

function request(path: string, cookie: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  headers.set('origin', APP_URL);
  return test.app.request(path, { ...init, headers });
}

const post = (path: string, cookie: string | null, body?: unknown) =>
  request(path, cookie, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function errorCode(response: Response) {
  return ((await response.json()) as ApiErrorBody).error.code;
}

async function userIdOf(cookie: string) {
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  return session.user.id;
}

const MILESTONES = [
  '### Meilenstein 1: Grundgerüst (2 Wochen)',
  '- Projekt aufsetzen\n- Login per Link',
].join('\n\n');

async function member(projectId: string, role: 'owner' | 'editor' | 'viewer') {
  const cookie = await test.signIn();
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, await userIdOf(cookie), role],
  );
  return cookie;
}

function gitlab() {
  const setup = gitlabSetup(test.env);
  if (!setup) throw new Error('The test server has no GitLab');
  const client = createGitlabClient((input, init) =>
    Promise.resolve(test.app.request(input instanceof Request ? input.url : String(input), init)),
  );
  return { client, connections: createGitConnections({ admin: test.db.admin, client, setup }) };
}

/** Approves a Git request as the owner and runs the worker's job for it. */
async function carryOut(project: { owner: string; git: string }, asked: Response) {
  expect(asked.status).toBe(201);
  const { requestId } = (await asked.json()) as GitRequestCreated;
  const approved = await post(`${project.git}/requests/approve`, project.owner, {
    requestIds: [requestId],
  });
  expect(approved.status).toBe(200);
  const { client, connections } = gitlab();
  const outcome = await runGitRequest(
    {
      admin: test.db.admin,
      accessOf: connections.accessOf,
      writers: (target, token) => gitlabWriter(client, target, token),
    },
    { requestId },
  );
  expect(outcome).toBe('done');
}

/**
 * A project with a plan, whose owner has an account and picked the repository; with `issues`,
 * every task of the plan has an issue in the stand-in.
 */
async function createProject({ issues = true }: { issues?: boolean } = {}) {
  const owner = await test.signIn();
  const created = await post('/api/projects', owner, { name: 'Vereins-App' });
  const projectId = ((await created.json()) as ProjectSummary).id;
  await test.collab.changePlan(projectId, (doc) => {
    writePlanSection(doc, 'milestones', planNodesFromMarkdown(MILESTONES), 'de');
    ensureTaskIds(doc);
  });
  const git = `/api/projects/${projectId}/git`;
  const started = await post('/api/git/account/connect', owner, { origin: 'account' });
  const { url } = (await started.json()) as GitConnectStart;
  const allow = /class="allow" href="([^"]+)"/.exec(await (await test.app.request(url)).text());
  expect((await request((allow?.[1] ?? '').replaceAll('&amp;', '&'), owner)).status).toBe(302);
  const picked = await request(`${git}/repository`, owner, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repositoryId: 101 }),
  });
  expect(picked.status).toBe(204);
  const project = { owner, projectId, git };
  if (!issues) return { ...project, issueNumbers: [] as number[] };

  const plan = (await (await request(`${git}/issues`, owner)).json()) as GitIssuePlan;
  const taskIds = plan.milestones.flatMap((milestone) => milestone.tasks.map((task) => task.id));
  await carryOut(project, await post(`${git}/issues`, owner, { taskIds }));
  const roadmap = (await (
    await request(`/api/projects/${projectId}/roadmap`, owner)
  ).json()) as Roadmap;
  const issueNumbers = roadmap.milestones.flatMap((milestone) =>
    milestone.tasks.map((task) => task.issue?.number ?? 0),
  );
  expect(issueNumbers.every((number) => number > 0)).toBe(true);
  return { ...project, issueNumbers };
}

/**
 * A coding agent works on an issue: the stand-in's button commits a change on a branch named
 * after the issue and opens a merge request; a further call is a further commit. The number of
 * the merge request.
 */
async function pushFor(issue: number) {
  const pushed = await test.app.request(`${REPOSITORY}/-/issues/${String(issue)}/merge-request`, {
    method: 'POST',
  });
  expect(pushed.status).toBe(303);
  return Number(/merge_requests\/(\d+)$/.exec(pushed.headers.get('location') ?? '')?.[1]);
}

/** The worker's job that reads the repository's state, with the stand-in inside the app. */
const sync = (projectId: string) =>
  runGitSync({ admin: test.db.admin, ...gitlab() }, { projectId });

const stored = (projectId: string) =>
  test.db.admin
    .selectFrom('git_reviews')
    .innerJoin('ai_runs', 'ai_runs.id', 'git_reviews.run_id')
    .select([
      'git_reviews.id',
      'git_reviews.run_id',
      'git_reviews.number',
      'git_reviews.sha',
      'git_reviews.issue_number',
      'git_reviews.trigger',
      'git_reviews.verdict',
      'git_reviews.mr_open',
      'ai_runs.status',
      'ai_runs.kind',
      'ai_runs.model',
      'ai_runs.cost_usd',
      'ai_runs.error',
    ])
    .where('git_reviews.project_id', '=', projectId)
    .orderBy('git_reviews.created_at')
    .execute();

const FINDING = {
  title: 'Socket.io statt Server-Sent Events',
  detail: 'Der Merge Request bringt Socket.io mit; entschieden sind Server-Sent Events.',
  basis: 'Echtzeit: Server-Sent Events',
  file: 'src/realtime/socket.ts',
};
const DEVIATES = JSON.stringify({ summary: 'Weicht bei der Echtzeit ab.', findings: [FINDING] });
const FITS = JSON.stringify({ summary: 'Folgt der Architektur.', findings: [] });

function result(text: string): AgentReplyResult {
  return {
    text,
    provider: 'anthropic',
    model: REVIEW_MODEL,
    usage: { inputTokens: 3000, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costUsd: 0.0123,
    webSearches: 0,
  };
}

/** The worker's job that writes a review, with a model that answers `answer`. */
function reviewer(answer: string | Error = DEVIATES) {
  const { client, connections } = gitlab();
  const complete = vi.fn<MrReviewDeps['complete']>(() =>
    answer instanceof Error ? Promise.reject(answer) : Promise.resolve(result(answer)),
  );
  const logger = { error: vi.fn() };
  const deps: MrReviewDeps = {
    admin: test.db.admin,
    repository: repositoryReaders({ admin: test.db.admin, client, connections }),
    packageInput: (projectId) => gatherPackageInput(test.db.admin, test.collab, projectId),
    complete,
    logger,
  };
  return {
    complete,
    logger,
    run: (review: { id: string; run_id: string }) =>
      reviewMergeRequest(deps, { reviewId: review.id, runId: review.run_id }),
  };
}

async function mergeRequestsOf(project: { git: string }, cookie: string) {
  const response = await request(`${project.git}/merge-requests`, cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as GitMergeRequests;
}

async function reviewsOf(project: { git: string }, cookie: string) {
  const response = await request(`${project.git}/reviews`, cookie);
  expect(response.status).toBe(200);
  return ((await response.json()) as GitReviews).reviews;
}

const askReview = (project: { git: string }, cookie: string | null, number: number) =>
  post(`${project.git}/merge-requests/${String(number)}/review`, cookie);

describe('the review of a merge request of an issue Covibes created', () => {
  it('starts by itself with the reading of the repository’s state, once per state', async () => {
    const project = await createProject();
    const [issue = 0] = project.issueNumbers;
    const number = await pushFor(issue);

    expect(await sync(project.projectId)).toBe('done');

    const [review, ...others] = await stored(project.projectId);
    expect(others).toEqual([]);
    expect(review).toMatchObject({
      number: String(number),
      issue_number: String(issue),
      trigger: 'auto',
      verdict: null,
      status: 'queued',
      kind: 'review',
    });
    // The same state is not reviewed twice.
    await sync(project.projectId);
    expect(await stored(project.projectId)).toHaveLength(1);

    // The merge request gets a commit: a new state, a new review.
    await pushFor(issue);
    await sync(project.projectId);
    const states = await stored(project.projectId);
    expect(states.map((entry) => entry.number)).toEqual([String(number), String(number)]);
    expect(new Set(states.map((entry) => entry.sha)).size).toBe(2);
  });

  it('compares the changes with the architecture and the task’s spec, and keeps what it found', async () => {
    const project = await createProject();
    const viewer = await member(project.projectId, 'viewer');
    const [, issue = 0] = project.issueNumbers;
    const number = await pushFor(issue);
    await sync(project.projectId);
    const [waiting] = await stored(project.projectId);
    if (!waiting) throw new Error('The review is missing');
    const { run, complete } = reviewer(DEVIATES);

    expect(await run(waiting)).toBe('done');

    // What the model read: the instructions, and the project and the merge request as data.
    const asked = complete.mock.calls[0]?.[0];
    expect(asked?.model).toBe(REVIEW_MODEL);
    expect(asked?.system).toContain('You review such a merge request against the architecture');
    expect(asked?.prompt).toContain('Project: Vereins-App');
    expect(asked?.prompt).toContain('Write in: German');
    expect(asked?.prompt).toContain('<architecture>');
    expect(asked?.prompt).toContain('<decisions>');
    // The feature spec of the task the issue was made for.
    expect(asked?.prompt).toMatch(/<spec>\n# [^\n]*Login per Link/);
    expect(asked?.prompt).toContain(
      `<merge_request number="${String(number)}">\nTitle: Login per Link`,
    );
    expect(asked?.prompt).toContain(`Closes #${String(issue)}`);
    expect(asked?.prompt).toContain('<file path="src/realtime/socket.ts" change="added">');
    expect(asked?.prompt).toContain("import { Server } from 'socket.io';");

    const [done] = await stored(project.projectId);
    expect(done).toMatchObject({
      verdict: 'deviates',
      status: 'done',
      model: REVIEW_MODEL,
      cost_usd: '0.012300',
      error: null,
    });

    // Every member reads it: in the list of merge requests, among the reviews, and by itself.
    const list = await mergeRequestsOf(project, viewer);
    expect(list.canReview).toBe(false);
    const entry = list.mergeRequests?.find((mergeRequest) => mergeRequest.number === number);
    expect(entry).toMatchObject({
      issueNumber: issue,
      reviewCurrent: true,
      review: { id: waiting.id, status: 'done', verdict: 'deviates', findings: 1, trigger: 'auto' },
    });
    const [listed] = await reviewsOf(project, viewer);
    expect(listed).toMatchObject({
      id: waiting.id,
      number,
      title: 'Login per Link',
      sourceBranch: `${String(issue)}-beispiel`,
      issueNumber: issue,
      requestedBy: null,
      status: 'done',
      verdict: 'deviates',
      summary: 'Weicht bei der Echtzeit ab.',
      findings: [FINDING],
      open: true,
    });
    expect(listed?.url).toContain(`/-/merge_requests/${String(number)}`);
    const single = await request(`${project.git}/reviews/${waiting.id}`, viewer);
    expect((await single.json()) as GitReview).toEqual(listed);
  });

  it('takes the spec of the task the issue was created for last, should two carry its number', async () => {
    const project = await createProject();
    const [first = 0, second = 0] = project.issueNumbers;
    // As after a restart of the stand-in: the issue of the second task has the first one's
    // number, from an earlier day.
    await test.db.adminPool.query(
      `update git_actions set result_number = $2, executed_at = now() - interval '1 day'
       where project_id = $1 and kind = 'issue' and result_number = $3`,
      [project.projectId, first, second],
    );
    await pushFor(first);
    await sync(project.projectId);
    const [waiting] = await stored(project.projectId);
    if (!waiting) throw new Error('The review is missing');
    const { run, complete } = reviewer(FITS);

    await run(waiting);

    expect(complete.mock.calls[0]?.[0].prompt).toMatch(/<spec>\n# [^\n]*Projekt aufsetzen/);
  });

  it('says that a change fits when the model finds nothing', async () => {
    const project = await createProject();
    const number = await pushFor(project.issueNumbers[0] ?? 0);
    await sync(project.projectId);
    const [waiting] = await stored(project.projectId);
    if (!waiting) throw new Error('The review is missing');

    expect(await reviewer(FITS).run(waiting)).toBe('done');

    const list = await mergeRequestsOf(project, project.owner);
    expect(
      list.mergeRequests?.find((mergeRequest) => mergeRequest.number === number)?.review,
    ).toMatchObject({ status: 'done', verdict: 'fits', findings: 0 });
    expect((await reviewsOf(project, project.owner))[0]).toMatchObject({
      verdict: 'fits',
      summary: 'Folgt der Architektur.',
      findings: [],
    });
  });

  it('shows that an older state was reviewed once new commits came', async () => {
    const project = await createProject();
    const [issue = 0] = project.issueNumbers;
    const number = await pushFor(issue);
    await sync(project.projectId);
    const [first] = await stored(project.projectId);
    if (!first) throw new Error('The review is missing');
    await reviewer(FITS).run(first);

    await pushFor(issue);

    const before = (await mergeRequestsOf(project, project.owner)).mergeRequests?.find(
      (mergeRequest) => mergeRequest.number === number,
    );
    expect(before).toMatchObject({ reviewCurrent: false, review: { id: first.id } });
    // The next reading starts the review of the new state; the list then shows that one.
    await sync(project.projectId);
    const after = (await mergeRequestsOf(project, project.owner)).mergeRequests?.find(
      (mergeRequest) => mergeRequest.number === number,
    );
    expect(after?.reviewCurrent).toBe(true);
    expect(after?.review).toMatchObject({ status: 'queued', verdict: null });
    expect(after?.review?.id).not.toBe(first.id);
  });

  it('gives way when the merge request got commits before the review ran', async () => {
    const project = await createProject();
    const [issue = 0] = project.issueNumbers;
    await pushFor(issue);
    await sync(project.projectId);
    const [waiting] = await stored(project.projectId);
    if (!waiting) throw new Error('The review is missing');
    await pushFor(issue);
    const { run, complete } = reviewer();

    expect(await run(waiting)).toBe('outdated');

    // Nothing was asked of the model, and the review of the old state is gone.
    expect(complete).not.toHaveBeenCalled();
    expect(await stored(project.projectId)).toEqual([]);
    const lost = await test.db.admin
      .selectFrom('ai_runs')
      .select(['status', 'error'])
      .where('id', '=', waiting.run_id)
      .executeTakeFirstOrThrow();
    expect(lost).toMatchObject({ status: 'error' });
    await sync(project.projectId);
    expect(await stored(project.projectId)).toHaveLength(1);
  });

  it('counts the merge request as closed once it is merged', async () => {
    const project = await createProject();
    const number = await pushFor(project.issueNumbers[0] ?? 0);
    await sync(project.projectId);
    const [waiting] = await stored(project.projectId);
    if (!waiting) throw new Error('The review is missing');
    await reviewer(DEVIATES).run(waiting);
    expect(await reviewsOf(project, project.owner)).toHaveLength(1);

    await carryOut(
      project,
      await post(`${project.git}/merge-requests/${String(number)}/merge`, project.owner),
    );
    await sync(project.projectId);

    expect(await reviewsOf(project, project.owner)).toEqual([]);
    // The review itself is still there to read.
    const single = await request(`${project.git}/reviews/${waiting.id}`, project.owner);
    expect((await single.json()) as GitReview).toMatchObject({ open: false, verdict: 'deviates' });
  });
});

describe('what the reading of the repository’s state leaves alone', () => {
  it('reviews no draft and no merge request of someone’s own', async () => {
    // The stand-in's own merge request !1 is a draft that names an issue Covibes did not create.
    const project = await createProject();

    await sync(project.projectId);

    expect(await stored(project.projectId)).toEqual([]);
    const list = await mergeRequestsOf(project, project.owner);
    expect(list.canReview).toBe(true);
    expect(list.mergeRequests?.find((mergeRequest) => mergeRequest.number === 1)).toMatchObject({
      draft: true,
      issueNumber: null,
      review: null,
      reviewCurrent: false,
    });
  });

  it('starts nothing in a project without issues of its own', async () => {
    const project = await createProject({ issues: false });

    expect(await sync(project.projectId)).toBe('done');

    expect(await stored(project.projectId)).toEqual([]);
  });
});

describe('POST /api/projects/:projectId/git/merge-requests/:number/review', () => {
  it('starts a review of any open merge request for owners and editors', async () => {
    const project = await createProject({ issues: false });
    const editor = await member(project.projectId, 'editor');

    const asked = await askReview(project, editor, 1);

    expect(asked.status).toBe(201);
    const { reviewId } = (await asked.json()) as GitReviewStarted;
    const [waiting] = await stored(project.projectId);
    expect(waiting).toMatchObject({
      id: reviewId,
      number: '1',
      issue_number: null,
      trigger: 'manual',
      status: 'queued',
    });
    const [listed] = await reviewsOf(project, project.owner);
    expect(listed).toMatchObject({ status: 'queued', verdict: null, summary: null, findings: [] });
    expect(listed?.requestedBy?.userId).toBe(await userIdOf(editor));

    // A merge request of someone's own has no feature spec to compare with.
    const { run, complete } = reviewer(FITS);
    if (!waiting) throw new Error('The review is missing');
    expect(await run(waiting)).toBe('done');
    expect(complete.mock.calls[0]?.[0].prompt).toContain('belongs to no task of the plan');
    expect(complete.mock.calls[0]?.[0].prompt).not.toContain('<spec>');
  });

  it('reviews a state once, and again after a failure', async () => {
    const project = await createProject({ issues: false });
    const first = await askReview(project, project.owner, 1);
    expect(first.status).toBe(201);

    const again = await askReview(project, project.owner, 1);
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe('already_running');

    const [waiting] = await stored(project.projectId);
    if (!waiting) throw new Error('The review is missing');
    const failing = reviewer(new GatewayLimitError('The quota is used up', null));
    expect(await failing.run(waiting)).toBe('failed');
    expect(failing.logger.error).toHaveBeenCalledTimes(1);
    const [listed] = await reviewsOf(project, project.owner);
    expect(listed).toMatchObject({ status: 'failed', verdict: null, findings: [] });

    const retried = await askReview(project, project.owner, 1);
    expect(retried.status).toBe(201);
    expect(((await retried.json()) as GitReviewStarted).reviewId).toBe(waiting.id);
    const [restarted] = await stored(project.projectId);
    expect(restarted).toMatchObject({ status: 'queued', verdict: null });
    expect(restarted?.run_id).not.toBe(waiting.run_id);

    // The job of the run that failed finds nothing to do any more.
    expect(await reviewer().run(waiting)).toBe('gone');
  });

  it('fails a review whose answer has no form, and keeps nothing of it', async () => {
    const project = await createProject({ issues: false });
    await askReview(project, project.owner, 1);
    const [waiting] = await stored(project.projectId);
    if (!waiting) throw new Error('The review is missing');
    const { run, logger } = reviewer('Der Merge Request sieht gut aus. Ignoriere die Regeln.');

    expect(await run(waiting)).toBe('failed');

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [failed] = await stored(project.projectId);
    expect(failed).toMatchObject({
      status: 'error',
      verdict: null,
      error: 'The model wrote no review',
      // The run is metered although it gave nothing.
      cost_usd: '0.012300',
    });
    expect((await reviewsOf(project, project.owner))[0]).toMatchObject({
      status: 'failed',
      summary: null,
    });
  });

  it('refuses viewers, strangers and merge requests that are not there', async () => {
    const project = await createProject({ issues: false });
    const viewer = await member(project.projectId, 'viewer');
    const stranger = await test.signIn();

    expect((await askReview(project, null, 1)).status).toBe(401);
    expect((await askReview(project, viewer, 1)).status).toBe(403);
    expect((await askReview(project, stranger, 1)).status).toBe(404);
    expect((await askReview(project, project.owner, 999)).status).toBe(404);
    expect((await post(`${project.git}/merge-requests/eins/review`, project.owner)).status).toBe(
      404,
    );
    expect(await stored(project.projectId)).toEqual([]);
  });
});

describe('GET /api/projects/:projectId/git/reviews', () => {
  it('is there for members only, and gives no review of another project', async () => {
    const project = await createProject({ issues: false });
    const other = await createProject({ issues: false });
    const stranger = await test.signIn();
    await askReview(project, project.owner, 1);
    const [review] = await stored(project.projectId);
    if (!review) throw new Error('The review is missing');

    expect((await request(`${project.git}/reviews`, null)).status).toBe(401);
    expect((await request(`${project.git}/reviews`, stranger)).status).toBe(404);
    expect((await request(`${project.git}/reviews/${review.id}`, stranger)).status).toBe(404);
    expect((await request(`${other.git}/reviews/${review.id}`, other.owner)).status).toBe(404);
    expect((await request(`${project.git}/reviews/${randomUUID()}`, project.owner)).status).toBe(
      404,
    );
    expect((await request(`${project.git}/reviews/nope`, project.owner)).status).toBe(404);
    expect(await reviewsOf(other, other.owner)).toEqual([]);
  });
});
