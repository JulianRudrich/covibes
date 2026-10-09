import { randomUUID } from 'node:crypto';

import {
  ensureTaskIds,
  planNodesFromMarkdown,
  writePlanSection,
  type ApiErrorBody,
  type GitConnectStart,
  type GitIssuePlan,
  type GitLog,
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
async function createProject({ repositoryId = 101 }: { repositoryId?: number | null } = {}) {
  const owner = await test.signIn();
  const created = await post('/api/projects', owner, { name: 'Vereins-App' });
  const projectId = ((await created.json()) as ProjectSummary).id;
  await test.db.adminPool.query('update users set name = $1 where id = $2', [
    'Olga',
    await userIdOf(owner),
  ]);
  await test.collab.changePlan(projectId, (doc) => {
    for (const [section, markdown] of Object.entries(PLAN)) {
      writePlanSection(doc, section as PlanSection, planNodesFromMarkdown(markdown), 'de');
    }
    ensureTaskIds(doc);
  });
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
      ['done', { number: 4, url: issue(4) }],
      ['done', { number: 5, url: issue(5) }],
      ['done', { number: 6, url: issue(6) }],
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
