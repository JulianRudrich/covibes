import { randomUUID } from 'node:crypto';

import {
  ensureTaskIds,
  planNodesFromMarkdown,
  writePlanSection,
  type ApiErrorBody,
  type GitConnectStart,
  type GitIssuePlan,
  type GitLog,
  type GitMergeRequestPlan,
  type GitMergeRequests,
  type GitRequestCreated,
  type GitRequests,
  type GitRequestsApproved,
  type PlanSection,
  type ProjectSummary,
} from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { createGitlabClient } from '@server/integrations/gitlab/client';
import { createGitConnections } from '@server/integrations/gitlab/connections';
import { gitlabSetup } from '@server/integrations/gitlab/setup';
import { gitlabWriter } from '@server/integrations/gitlab/writer';
import { runGitRequest } from '@server/tasks/git-request';
import { APP_URL, createTestServer } from '@server/testing';

// Git requests through the API (spec 29b): from the plan's tasks to issues in the stand-in, with
// the worker's job run by hand.
const test = createTestServer();

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

async function errorOf(response: Response) {
  return ((await response.json()) as ApiErrorBody).error;
}

async function userIdOf(cookie: string) {
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  return session.user.id;
}

const PLAN: Partial<Record<PlanSection, string>> = {
  scope: 'Mitglieder verwalten.',
  milestones: [
    '### Meilenstein 1: Grundgerüst (2 Wochen)',
    'Die App läuft.',
    '- Projekt aufsetzen\n- Login per Link',
    '### Meilenstein 2: Mitglieder',
    '- Mitgliederliste',
  ].join('\n\n'),
};

/** The whole way to GitLab and back: the person has an account afterwards. */
async function connectAccount(cookie: string) {
  const started = await post('/api/git/account/connect', cookie, { origin: 'account' });
  const { url } = (await started.json()) as GitConnectStart;
  const page = await test.app.request(url);
  const allow = /class="allow" href="([^"]+)"/.exec(await page.text())?.[1] ?? '';
  const back = await request(allow.replaceAll('&amp;', '&'), cookie);
  expect(back.status).toBe(302);
}

async function member(
  projectId: string,
  role: 'owner' | 'editor' | 'viewer',
  canApproveGit = false,
) {
  const cookie = await test.signIn();
  await test.db.adminPool.query(
    `insert into project_members (project_id, user_id, role, can_approve_git)
     values ($1, $2, $3, $4)`,
    [projectId, await userIdOf(cookie), role, canApproveGit],
  );
  return cookie;
}

/** A project with a plan whose owner has an account and, unless told otherwise, a repository. */
async function createProject({
  repositoryId = 101,
  plan = true,
  scope = PLAN.scope ?? '',
}: { repositoryId?: number | null; plan?: boolean; scope?: string } = {}) {
  const owner = await test.signIn();
  const created = await post('/api/projects', owner, { name: 'Vereins-App' });
  const projectId = ((await created.json()) as ProjectSummary).id;
  await test.db.adminPool.query('update users set name = $1 where id = $2', [
    'Olga',
    await userIdOf(owner),
  ]);
  if (plan) {
    await test.collab.changePlan(projectId, (doc) => {
      for (const [section, markdown] of Object.entries({ ...PLAN, scope })) {
        writePlanSection(doc, section as PlanSection, planNodesFromMarkdown(markdown), 'de');
      }
      ensureTaskIds(doc);
    });
  }
  const git = `/api/projects/${projectId}/git`;
  await connectAccount(owner);
  if (repositoryId !== null) {
    const picked = await request(`${git}/repository`, owner, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repositoryId }),
    });
    expect(picked.status).toBe(204);
  }
  return { owner, projectId, git };
}

async function issuePlan(git: string, cookie: string) {
  const response = await request(`${git}/issues`, cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as GitIssuePlan;
}

const tasksOf = (plan: GitIssuePlan) => plan.milestones.flatMap((milestone) => milestone.tasks);
const idsOf = (plan: GitIssuePlan) => tasksOf(plan).map((task) => task.id ?? '');

async function requestsOf(git: string, cookie: string) {
  const response = await request(`${git}/requests`, cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as GitRequests;
}

async function ask(git: string, cookie: string, taskIds: string[]) {
  const response = await post(`${git}/issues`, cookie, { taskIds });
  expect(response.status).toBe(201);
  return ((await response.json()) as GitRequestCreated).requestId;
}

const approve = (git: string, cookie: string | null, requestIds: string[]) =>
  post(`${git}/requests/approve`, cookie, { requestIds });

/** The worker's job, with the server's own GitLab: the stand-in inside the app. */
function runJob(requestId: string) {
  const setup = gitlabSetup(test.env);
  if (!setup) throw new Error('The test server has no GitLab');
  const client = createGitlabClient((input, init) =>
    Promise.resolve(test.app.request(input instanceof Request ? input.url : String(input), init)),
  );
  const connections = createGitConnections({ admin: test.db.admin, client, setup });
  return runGitRequest(
    {
      admin: test.db.admin,
      accessOf: connections.accessOf,
      writers: (target, token) => gitlabWriter(client, target, token),
    },
    { requestId },
  );
}

describe('GET /api/projects/:projectId/git/issues', () => {
  it('lists the plan’s tasks by milestone, free to choose, with what the person may do', async () => {
    const project = await createProject();
    const viewer = await member(project.projectId, 'viewer');
    const approver = await member(project.projectId, 'editor', true);

    const plan = await issuePlan(project.git, project.owner);

    expect(plan.repository).toMatchObject({ id: 101, path: 'beispiel-verein/vereins-app' });
    expect(plan).toMatchObject({ canRequest: true, canApprove: true, hasAccount: true });
    expect(
      plan.milestones.map((milestone) => [
        milestone.number,
        milestone.title,
        milestone.tasks.map((task) => [task.text, task.state, task.issue]),
      ]),
    ).toEqual([
      [
        1,
        'Grundgerüst',
        [
          ['Projekt aufsetzen', 'free', null],
          ['Login per Link', 'free', null],
        ],
      ],
      [2, 'Mitglieder', [['Mitgliederliste', 'free', null]]],
    ]);
    expect(idsOf(plan).every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
    expect(await issuePlan(project.git, viewer)).toMatchObject({
      canRequest: false,
      canApprove: false,
      hasAccount: false,
    });
    expect(await issuePlan(project.git, approver)).toMatchObject({
      canRequest: true,
      canApprove: true,
      hasAccount: false,
    });
  });

  it('says that there is no repository, and is there for members only', async () => {
    const project = await createProject({ repositoryId: null });
    const stranger = await test.signIn();

    const plan = await issuePlan(project.git, project.owner);
    expect(plan.repository).toBeNull();
    expect(tasksOf(plan).map((task) => task.state)).toEqual(['free', 'free', 'free']);
    expect((await request(`${project.git}/issues`, stranger)).status).toBe(404);
    expect((await request(`${project.git}/issues`, null)).status).toBe(401);
    expect((await request(`${project.git}/requests`, stranger)).status).toBe(404);
    expect((await request(`${project.git}/log`, stranger)).status).toBe(404);
    expect((await request(`${project.git}/log`, null)).status).toBe(401);
  });
});

describe('POST /api/projects/:projectId/git/issues', () => {
  it('makes a request with a milestone and an issue per chosen task, worded from the plan', async () => {
    const project = await createProject();
    const editor = await member(project.projectId, 'editor');
    await test.db.adminPool.query('update users set name = $1 where id = $2', [
      'Edgar',
      await userIdOf(editor),
    ]);
    const [setup, , list] = idsOf(await issuePlan(project.git, project.owner));

    const requestId = await ask(project.git, editor, [list ?? '', setup ?? '']);

    const { requests, canApprove } = await requestsOf(project.git, editor);
    expect(canApprove).toBe(false);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      id: requestId,
      kind: 'issues',
      status: 'waiting',
      repository: {
        path: 'beispiel-verein/vereins-app',
        url: `${APP_URL}/api/dev/gitlab/beispiel-verein/vereins-app`,
      },
      decidedBy: null,
      decidedAt: null,
    });
    expect(requests[0]?.requestedBy.name).toBe('Edgar');
    // In the order of the plan, whatever the order of the choice.
    expect(
      requests[0]?.actions.map((action) => [action.kind, action.title, action.status]),
    ).toEqual([
      ['milestone', 'Meilenstein 1: Grundgerüst', 'waiting'],
      ['issue', 'Projekt aufsetzen', 'waiting'],
      ['milestone', 'Meilenstein 2: Mitglieder', 'waiting'],
      ['issue', 'Mitgliederliste', 'waiting'],
    ]);
    const stored = await test.db.admin
      .selectFrom('git_actions')
      .select('payload')
      .where('request_id', '=', requestId)
      .where('position', '=', 1)
      .executeTakeFirstOrThrow();
    expect((stored.payload as { description: string }).description).toContain(
      `[\`context/feature-specs/01-01-projekt-aufsetzen.md\`](${APP_URL}/api/dev/gitlab/beispiel-verein/vereins-app/-/blob/main/context/feature-specs/01-01-projekt-aufsetzen.md)`,
    );
    // The tasks are taken now.
    expect(tasksOf(await issuePlan(project.git, project.owner)).map((task) => task.state)).toEqual([
      'requested',
      'free',
      'requested',
    ]);
  });

  it('refuses viewers, unknown tasks, a second issue for a task and a project without a repository', async () => {
    const project = await createProject();
    const viewer = await member(project.projectId, 'viewer');
    const [setup, login] = idsOf(await issuePlan(project.git, project.owner));
    const issues = `${project.git}/issues`;

    expect((await post(issues, viewer, { taskIds: [setup] })).status).toBe(403);
    expect((await post(issues, null, { taskIds: [setup] })).status).toBe(401);
    expect((await post(issues, project.owner, { taskIds: [] })).status).toBe(400);
    expect((await post(issues, project.owner, { taskIds: ['nope'] })).status).toBe(400);
    expect((await post(issues, project.owner, {})).status).toBe(400);
    // A task the plan does not have.
    expect((await post(issues, project.owner, { taskIds: [setup, randomUUID()] })).status).toBe(
      400,
    );
    await ask(project.git, project.owner, [setup ?? '']);
    const again = await post(issues, project.owner, { taskIds: [login, setup] });
    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe('already_running');
    // Naming a task twice asks for it once.
    expect((await post(issues, project.owner, { taskIds: [login, login] })).status).toBe(201);

    const bare = await createProject({ repositoryId: null });
    const [task] = idsOf(await issuePlan(bare.git, bare.owner));
    expect((await post(`${bare.git}/issues`, bare.owner, { taskIds: [task] })).status).toBe(404);
  });
});

describe('approving, rejecting and taking back', () => {
  it('lets who may approve do so with a GitLab account, several requests at once', async () => {
    const project = await createProject();
    const editor = await member(project.projectId, 'editor');
    const approver = await member(project.projectId, 'editor', true);
    const [setup, login, list] = idsOf(await issuePlan(project.git, project.owner));
    const first = await ask(project.git, editor, [setup ?? '']);
    const second = await ask(project.git, editor, [login ?? '']);
    const third = await ask(project.git, editor, [list ?? '']);

    expect((await approve(project.git, editor, [first])).status).toBe(403);
    expect((await approve(project.git, null, [first])).status).toBe(401);
    expect((await approve(project.git, await test.signIn(), [first])).status).toBe(404);
    expect((await post(`${project.git}/requests/approve`, approver, {})).status).toBe(400);
    // The right alone is not enough: the actions run with the approver's own account.
    const noAccount = await approve(project.git, approver, [first]);
    expect(noAccount.status).toBe(403);
    expect(await errorOf(noAccount)).toMatchObject({ code: 'forbidden', detail: 'git_account' });
    expect((await requestsOf(project.git, approver)).hasAccount).toBe(false);

    await connectAccount(approver);
    const approved = await approve(project.git, approver, [first, second, randomUUID()]);

    expect(approved.status).toBe(200);
    expect((await approved.json()) as GitRequestsApproved).toEqual({ approved: 2 });
    const { requests, hasAccount } = await requestsOf(project.git, project.owner);
    expect(hasAccount).toBe(true);
    expect(requests.map((entry) => [entry.id, entry.status])).toEqual([
      [first, 'approved'],
      [second, 'approved'],
      [third, 'waiting'],
    ]);
    expect(requests[0]?.decidedBy?.userId).toBe(await userIdOf(approver));
    // Approved once.
    expect(await (await approve(project.git, project.owner, [first])).json()).toEqual({
      approved: 0,
    });
  });

  it('rejects for who may approve, and takes back for who asked', async () => {
    const project = await createProject();
    const editor = await member(project.projectId, 'editor');
    const [setup, login] = idsOf(await issuePlan(project.git, project.owner));
    const rejected = await ask(project.git, editor, [setup ?? '']);
    const withdrawn = await ask(project.git, editor, [login ?? '']);
    const reject = (cookie: string, id: string) =>
      post(`${project.git}/requests/${id}/reject`, cookie);
    const withdraw = (cookie: string, id: string) =>
      post(`${project.git}/requests/${id}/withdraw`, cookie);

    expect((await reject(editor, rejected)).status).toBe(403);
    expect((await withdraw(project.owner, withdrawn)).status).toBe(403);
    expect((await reject(project.owner, randomUUID())).status).toBe(404);
    expect((await reject(project.owner, 'nope')).status).toBe(404);
    expect((await reject(project.owner, rejected)).status).toBe(204);
    expect((await withdraw(editor, withdrawn)).status).toBe(204);
    const again = await reject(project.owner, rejected);
    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe('already_decided');

    // Nothing waits any more, the tasks are free again, and the log keeps both.
    expect((await requestsOf(project.git, project.owner)).requests).toEqual([]);
    expect(tasksOf(await issuePlan(project.git, project.owner)).map((task) => task.state)).toEqual([
      'free',
      'free',
      'free',
    ]);
    const log = (await (await request(`${project.git}/log`, editor)).json()) as GitLog;
    expect(log.requests.map((entry) => [entry.id, entry.status, entry.decidedBy?.name])).toEqual([
      [withdrawn, 'withdrawn', undefined],
      [rejected, 'rejected', 'Olga'],
    ]);
    expect(log.requests[1]?.actions.map((action) => action.status)).toEqual(['dropped', 'dropped']);
  });
});

describe('an approved request', () => {
  it('creates the milestones and issues in the repository, in the approver’s name', async () => {
    const project = await createProject();
    const viewer = await member(project.projectId, 'viewer');
    const ids = idsOf(await issuePlan(project.git, project.owner));
    const requestId = await ask(project.git, project.owner, ids);
    await approve(project.git, project.owner, [requestId]);

    expect(await runJob(requestId)).toBe('done');

    // What was done shows for a while with what waits, and the tasks have their issues.
    const { requests } = await requestsOf(project.git, viewer);
    expect(requests.map((entry) => entry.status)).toEqual(['done']);
    const issue = (number: number) =>
      `${APP_URL}/api/dev/gitlab/beispiel-verein/vereins-app/-/issues/${String(number)}`;
    expect(
      requests[0]?.actions.map((action) => [action.title, action.status, action.result?.number]),
    ).toEqual([
      ['Meilenstein 1: Grundgerüst', 'done', null],
      ['Projekt aufsetzen', 'done', 4],
      ['Login per Link', 'done', 5],
      ['Meilenstein 2: Mitglieder', 'done', null],
      ['Mitgliederliste', 'done', 6],
    ]);
    expect(
      tasksOf(await issuePlan(project.git, viewer)).map((task) => [task.state, task.issue]),
    ).toEqual([
      ['done', { number: 4, url: issue(4), closed: false }],
      ['done', { number: 5, url: issue(5), closed: false }],
      ['done', { number: 6, url: issue(6), closed: false }],
    ]);
    // Every member reads the log.
    const log = (await (await request(`${project.git}/log`, viewer)).json()) as GitLog;
    expect(log.requests).toHaveLength(1);
    expect(log.requests[0]).toMatchObject({
      id: requestId,
      status: 'done',
      requestedBy: { name: 'Olga' },
      decidedBy: { name: 'Olga' },
    });
    expect(log.requests[0]?.finishedAt).not.toBeNull();

    // The issue as GitLab holds it: by the approver's account, with task, milestone, spec and
    // the note.
    const page = await test.app.request(issue(5));
    const html = await page.text();
    expect(html).toContain('#5 Login per Link');
    expect(html).toContain('Meilenstein 1: Grundgerüst');
    expect(html).toContain('Olga Beispiel');
    expect(html).toContain('**Ziel:** Die App läuft.');
    expect(html).toContain('context/feature-specs/01-02-login-per-link.md');
    expect(html).toContain('Angelegt via Covibes aus dem Projektplan von „Vereins-App“.');
    expect(html).toContain('covibes-action:');

    // A task has one issue: it cannot be asked for again.
    const again = await post(`${project.git}/issues`, project.owner, { taskIds: [ids[0]] });
    expect(again.status).toBe(409);
  });

  it('fails where GitLab refuses, and is tried again or rejected', async () => {
    // The repository "Website" of the stand-in takes no issues.
    const project = await createProject({ repositoryId: 102 });
    const [setup] = idsOf(await issuePlan(project.git, project.owner));
    const requestId = await ask(project.git, project.owner, [setup ?? '']);
    await approve(project.git, project.owner, [requestId]);

    expect(await runJob(requestId)).toBe('failed');

    const { requests } = await requestsOf(project.git, project.owner);
    expect(requests[0]?.status).toBe('failed');
    expect(
      requests[0]?.actions.map((action) => [action.title, action.status, action.error]),
    ).toEqual([
      ['Meilenstein 1: Grundgerüst', 'done', null],
      ['Projekt aufsetzen', 'failed', { code: 'forbidden', detail: '403 Forbidden' }],
    ]);
    // A second approval tries what failed; then the owner rejects it.
    expect(await (await approve(project.git, project.owner, [requestId])).json()).toEqual({
      approved: 1,
    });
    expect(await runJob(requestId)).toBe('failed');
    expect((await post(`${project.git}/requests/${requestId}/reject`, project.owner)).status).toBe(
      204,
    );
    const log = (await (await request(`${project.git}/log`, project.owner)).json()) as GitLog;
    expect(log.requests[0]?.actions.map((action) => action.status)).toEqual(['done', 'dropped']);
    expect((await issuePlan(project.git, project.owner)).milestones[0]?.tasks[0]?.state).toBe(
      'free',
    );
  });

  it('is withdrawn while it waits when the repository is replaced', async () => {
    const project = await createProject();
    const [setup] = idsOf(await issuePlan(project.git, project.owner));
    const requestId = await ask(project.git, project.owner, [setup ?? '']);

    await request(`${project.git}/repository`, project.owner, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repositoryId: 103 }),
    });

    expect((await requestsOf(project.git, project.owner)).requests).toEqual([]);
    const log = (await (await request(`${project.git}/log`, project.owner)).json()) as GitLog;
    expect(log.requests.map((entry) => [entry.id, entry.status])).toEqual([
      [requestId, 'withdrawn'],
    ]);
    // In the new repository the task is free.
    expect((await issuePlan(project.git, project.owner)).milestones[0]?.tasks[0]?.state).toBe(
      'free',
    );
  });
});

describe('the plan package as a merge request (spec 29c)', () => {
  const mergeRequestPlan = async (git: string, cookie: string) => {
    const response = await request(`${git}/merge-request`, cookie);
    expect(response.status).toBe(200);
    return (await response.json()) as GitMergeRequestPlan;
  };
  const states = (plan: GitMergeRequestPlan) =>
    Object.fromEntries((plan.files ?? []).map((file) => [file.path, file.state]));

  it('compares the package with the default branch: what is new, changed and the same', async () => {
    const project = await createProject();
    const viewer = await member(project.projectId, 'viewer');

    const plan = await mergeRequestPlan(project.git, project.owner);

    expect(plan).toMatchObject({
      repository: { id: 101, path: 'beispiel-verein/vereins-app', defaultBranch: 'main' },
      canRequest: true,
      canApprove: true,
      hasAccount: true,
      problem: null,
      stale: [],
      pending: false,
      last: null,
    });
    // The example repository has an overview of its own; everything else is new there.
    expect(states(plan)).toMatchObject({
      'CLAUDE.md': 'new',
      'AGENTS.md': 'new',
      'context/project-overview.md': 'changed',
      'context/project-plan.md': 'new',
      'context/progress-tracker.md': 'new',
      'context/feature-specs/01-01-projekt-aufsetzen.md': 'new',
    });
    expect(plan.files?.filter((file) => file.state === 'changed')).toHaveLength(1);
    expect(await mergeRequestPlan(project.git, viewer)).toMatchObject({
      canRequest: false,
      canApprove: false,
      hasAccount: false,
    });
  });

  it('leaves the progress tracker of the repository alone, and names earlier feature specs', async () => {
    // The repository "Website" of the stand-in holds a tracker and a spec of an earlier package.
    const project = await createProject({ repositoryId: 102 });

    const plan = await mergeRequestPlan(project.git, project.owner);

    expect(states(plan)['context/progress-tracker.md']).toBe('kept');
    expect(plan.stale).toEqual(['context/feature-specs/01-09-alte-spec.md']);
  });

  it('says what is missing: a repository, a plan, and is there for members only', async () => {
    const bare = await createProject({ repositoryId: null });
    const empty = await createProject({ plan: false });
    const stranger = await test.signIn();

    expect(await mergeRequestPlan(bare.git, bare.owner)).toMatchObject({
      repository: null,
      files: null,
      problem: null,
    });
    expect(await mergeRequestPlan(empty.git, empty.owner)).toMatchObject({
      files: null,
      problem: 'no_plan',
    });
    expect((await request(`${bare.git}/merge-request`, stranger)).status).toBe(404);
    expect((await request(`${bare.git}/merge-request`, null)).status).toBe(401);
    expect((await post(`${bare.git}/merge-request`, bare.owner)).status).toBe(404);
    expect((await post(`${empty.git}/merge-request`, empty.owner)).status).toBe(400);
    expect((await post(`${bare.git}/merge-request`, stranger)).status).toBe(404);
    expect((await post(`${bare.git}/merge-request`, null)).status).toBe(401);
  });

  it('makes one request with the commit and the merge request, and a second one waits', async () => {
    const project = await createProject();
    const editor = await member(project.projectId, 'editor');
    const viewer = await member(project.projectId, 'viewer');

    expect((await post(`${project.git}/merge-request`, viewer)).status).toBe(403);
    const made = await post(`${project.git}/merge-request`, editor);

    expect(made.status).toBe(201);
    const { requestId } = (await made.json()) as GitRequestCreated;
    const { requests } = await requestsOf(project.git, project.owner);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ id: requestId, kind: 'merge_request', status: 'waiting' });
    expect(requests[0]?.actions.map((action) => [action.kind, action.status])).toEqual([
      ['commit', 'waiting'],
      ['merge_request', 'waiting'],
    ]);
    expect(requests[0]?.actions[0]?.title).toMatch(
      /^Plan-Paket auf dem Branch covibes\/plan-\d{4}-\d{2}-\d{2}-[0-9a-f]{6} \(\d+ Dateien\)$/,
    );
    expect(requests[0]?.actions[1]?.title).toBe(
      'Projektplan, Feature-Specs und Diagramme aus Covibes',
    );
    // No answer holds the files of the commit.
    expect(JSON.stringify(requests)).not.toContain('# Vereins-App');

    expect((await mergeRequestPlan(project.git, editor)).pending).toBe(true);
    const again = await post(`${project.git}/merge-request`, project.owner);
    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe('already_running');
  });

  it('brings the package into the repository as a merge request once it is approved', async () => {
    const project = await createProject();
    const made = await post(`${project.git}/merge-request`, project.owner);
    const { requestId } = (await made.json()) as GitRequestCreated;
    await approve(project.git, project.owner, [requestId]);

    expect(await runJob(requestId)).toBe('done');

    const plan = await mergeRequestPlan(project.git, project.owner);
    expect(plan.pending).toBe(false);
    expect(plan.last?.url).toMatch(
      new RegExp(`^${APP_URL}/api/dev/gitlab/beispiel-verein/vereins-app/-/merge_requests/\\d+$`),
    );
    // Nothing changed on the default branch: the package is still new there.
    expect(states(plan)['CLAUDE.md']).toBe('new');

    const log = (await (await request(`${project.git}/log`, project.owner)).json()) as GitLog;
    const [commit, mergeRequest] = log.requests[0]?.actions ?? [];
    expect(log.requests[0]).toMatchObject({ kind: 'merge_request', status: 'done' });
    expect(commit).toMatchObject({ kind: 'commit', status: 'done' });
    expect(commit?.result?.url).toContain('/-/commit/');
    expect(mergeRequest).toMatchObject({ kind: 'merge_request', status: 'done' });
    expect(mergeRequest?.result?.number).toBe(plan.last?.number);

    // The merge request as GitLab holds it: by the approver's account, with what the package
    // holds and the note.
    const page = await test.app.request(plan.last?.url ?? '');
    const html = await page.text();
    expect(html).toContain('Projektplan, Feature-Specs und Diagramme aus Covibes');
    expect(html).toContain('Olga Beispiel');
    expect(html).toContain('Das Plan-Paket von „Vereins-App“');
    expect(html).toContain('<code>context/feature-specs/01-02-login-per-link.md</code> (neu)');
    expect(html).toContain('<code>context/project-overview.md</code> (geändert)');
    expect(html).toContain('Angelegt via Covibes aus dem Projektplan von „Vereins-App“.');

    // After it is done, the package can be asked for again.
    expect((await post(`${project.git}/merge-request`, project.owner)).status).toBe(201);
  });

  it('commits a package that is larger than what the API takes from a browser', async () => {
    // The worker sends the commit to GitLab, here the stand-in inside the app; a plan of a
    // real project is larger than the 64 KB a page may send.
    const project = await createProject({ scope: 'Mitglieder verwalten. '.repeat(6000) });
    const made = await post(`${project.git}/merge-request`, project.owner);
    const { requestId } = (await made.json()) as GitRequestCreated;
    await approve(project.git, project.owner, [requestId]);

    expect(await runJob(requestId)).toBe('done');

    // A page still cannot send that much to the API itself.
    const large = await post(`${project.git}/issues`, project.owner, {
      taskIds: [],
      padding: 'x'.repeat(70_000),
    });
    expect(large.status).toBe(413);
  });
});

describe('merging a merge request (spec 29d)', () => {
  const openMergeRequests = async (git: string, cookie: string) => {
    const response = await request(`${git}/merge-requests`, cookie);
    expect(response.status).toBe(200);
    return (await response.json()) as GitMergeRequests;
  };

  /** A project whose plan package is a merge request in its repository; its number there. */
  async function packaged(repositoryId: number) {
    const project = await createProject({ repositoryId });
    const made = await post(`${project.git}/merge-request`, project.owner);
    const { requestId } = (await made.json()) as GitRequestCreated;
    await approve(project.git, project.owner, [requestId]);
    expect(await runJob(requestId)).toBe('done');
    const open = await openMergeRequests(project.git, project.owner);
    const number = open.mergeRequests?.[0]?.number ?? 0;
    return { ...project, number, merge: `${project.git}/merge-requests/${String(number)}/merge` };
  }

  it('lists the open merge requests of the repository, with what the person may do', async () => {
    const project = await createProject();
    const viewer = await member(project.projectId, 'viewer');
    const stranger = await test.signIn();

    const list = await openMergeRequests(project.git, project.owner);

    expect(list).toMatchObject({
      repository: { id: 101 },
      canRequest: true,
      canApprove: true,
      hasAccount: true,
    });
    // The example's draft is always there; other tests may have opened more.
    expect(list.mergeRequests?.find((entry) => entry.number === 1)).toMatchObject({
      title: 'Login per E-Mail-Link',
      draft: true,
      conflicts: false,
      requested: false,
      sourceBranch: 'feature/login',
      targetBranch: 'main',
      author: 'Olga Beispiel',
      url: `${APP_URL}/api/dev/gitlab/beispiel-verein/vereins-app/-/merge_requests/1`,
    });
    expect(await openMergeRequests(project.git, viewer)).toMatchObject({ canRequest: false });
    expect((await request(`${project.git}/merge-requests`, stranger)).status).toBe(404);
    expect((await request(`${project.git}/merge-requests`, null)).status).toBe(401);

    const bare = await createProject({ repositoryId: null });
    expect(await openMergeRequests(bare.git, bare.owner)).toMatchObject({
      repository: null,
      mergeRequests: null,
    });
  });

  it('makes one request per merge request, and none for a draft or what is not there', async () => {
    const project = await packaged(101);
    const editor = await member(project.projectId, 'editor');
    const viewer = await member(project.projectId, 'viewer');
    const draft = await createProject();

    expect((await post(project.merge, viewer)).status).toBe(403);
    expect((await post(project.merge, null)).status).toBe(401);
    expect((await post(`${project.git}/merge-requests/99/merge`, editor)).status).toBe(404);
    expect((await post(`${project.git}/merge-requests/nope/merge`, editor)).status).toBe(404);
    expect((await post(`${draft.git}/merge-requests/1/merge`, draft.owner)).status).toBe(400);

    const made = await post(project.merge, editor);
    expect(made.status).toBe(201);
    const { requestId } = (await made.json()) as GitRequestCreated;
    const { requests } = await requestsOf(project.git, project.owner);
    const waiting = requests.find((entry) => entry.id === requestId);
    expect(waiting).toMatchObject({ kind: 'merge', status: 'waiting' });
    expect(waiting?.actions.map((action) => [action.kind, action.title])).toEqual([
      ['merge', `!${String(project.number)} Projektplan, Feature-Specs und Diagramme aus Covibes`],
    ]);
    expect(
      (await openMergeRequests(project.git, editor)).mergeRequests?.find(
        (entry) => entry.number === project.number,
      )?.requested,
    ).toBe(true);
    const again = await post(project.merge, project.owner);
    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe('already_running');
  });

  it('merges once it is approved: the default branch then holds the package', async () => {
    // "Notizen" is the repository no other test merges into.
    const project = await packaged(103);
    const made = await post(project.merge, project.owner);
    const { requestId } = (await made.json()) as GitRequestCreated;
    await approve(project.git, project.owner, [requestId]);

    expect(await runJob(requestId)).toBe('done');

    const log = (await (await request(`${project.git}/log`, project.owner)).json()) as GitLog;
    expect(log.requests[0]).toMatchObject({ kind: 'merge', status: 'done' });
    expect(log.requests[0]?.actions[0]).toMatchObject({
      kind: 'merge',
      status: 'done',
      result: { number: project.number, existed: false },
    });
    // It is no longer open, and the package is in the repository: nothing differs any more.
    const open = await openMergeRequests(project.git, project.owner);
    expect(open.mergeRequests?.map((entry) => entry.number)).not.toContain(project.number);
    const response = await request(`${project.git}/merge-request`, project.owner);
    const plan = (await response.json()) as GitMergeRequestPlan;
    expect(plan.files?.every((file) => file.state === 'same' || file.state === 'kept')).toBe(true);
    expect((await post(`${project.git}/merge-request`, project.owner)).status).toBe(400);
    // The spec an issue links to is a file of the default branch now.
    const spec = await test.app.request(
      `${APP_URL}/api/dev/gitlab/olga.beispiel/notizen/-/blob/master/context/feature-specs/01-01-projekt-aufsetzen.md`,
    );
    expect(spec.status).toBe(200);
  });
});
