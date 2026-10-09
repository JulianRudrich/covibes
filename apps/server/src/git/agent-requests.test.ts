import {
  ensureTaskIds,
  planDocumentName,
  planNodesFromMarkdown,
  writePlanSection,
  type GitConnectStart,
  type GitRequests,
  type PlanSection,
  type ProjectSummary,
} from '@covibes/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { agentGitRequests, type AgentGitRequests } from '@server/git/agent-requests';
import { createGitlabClient } from '@server/integrations/gitlab/client';
import { createGitConnections } from '@server/integrations/gitlab/connections';
import { gitlabSetup } from '@server/integrations/gitlab/setup';
import { gitlabWriter } from '@server/integrations/gitlab/writer';
import { runGitRequest } from '@server/tasks/git-request';
import { memoryBoards } from '@server/test-boards';
import { APP_URL, createTestServer } from '@server/testing';

// What the moderator proposes for the repository (spec 29e), built as the worker builds it:
// against the test database and the stand-in for GitLab inside the app.
const test = createTestServer();

function request(path: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  headers.set('origin', APP_URL);
  return test.app.request(path, { ...init, headers });
}

const send = (method: string, path: string, cookie: string, body?: unknown) =>
  request(path, cookie, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const PLAN: Partial<Record<PlanSection, string>> = {
  scope: 'Mitglieder verwalten.',
  milestones: [
    '### Meilenstein 1: Grundgerüst (2 Wochen)',
    'Die App läuft.',
    '- Projekt aufsetzen\n- Login per Link',
    '### Meilenstein 2: Mitglieder',
    '- Mitgliederliste',
    '### Meilenstein 3: Später',
    'Noch offen.',
  ].join('\n\n'),
};

function setUp() {
  const setup = gitlabSetup(test.env);
  if (!setup) throw new Error('The test server has no GitLab');
  const client = createGitlabClient((input, init) =>
    Promise.resolve(test.app.request(input instanceof Request ? input.url : String(input), init)),
  );
  const connections = createGitConnections({ admin: test.db.admin, client, setup });
  const requestsFor = agentGitRequests({
    admin: test.db.admin,
    client,
    connections,
    boards: memoryBoards().boards,
    now: () => new Date('2026-10-09T12:00:00Z'),
  });

  /** A project with a stored plan whose owner picked a repository of the stand-in, if any. */
  async function project(repositoryId: number | null = 101, plan: typeof PLAN | null = PLAN) {
    const owner = await test.signIn();
    const created = await send('POST', '/api/projects', owner, { name: 'Vereins-App' });
    const projectId = ((await created.json()) as ProjectSummary).id;
    if (plan) {
      // The plan as the collaboration server stores it; the worker reads it from there.
      const doc = new Y.Doc();
      for (const [section, markdown] of Object.entries(plan)) {
        writePlanSection(doc, section as PlanSection, planNodesFromMarkdown(markdown), 'de');
      }
      ensureTaskIds(doc);
      await test.db.adminPool.query(
        `insert into yjs_documents (name, state) values ($1, $2)
         on conflict (name) do update set state = excluded.state`,
        [planDocumentName(projectId), Buffer.from(Y.encodeStateAsUpdate(doc))],
      );
    }
    const git = `/api/projects/${projectId}/git`;
    const started = await send('POST', '/api/git/account/connect', owner, { origin: 'account' });
    const { url } = (await started.json()) as GitConnectStart;
    const allow = /class="allow" href="([^"]+)"/.exec(await (await test.app.request(url)).text());
    await request((allow?.[1] ?? '').replaceAll('&amp;', '&'), owner);
    if (repositoryId !== null) {
      expect((await send('PUT', `${git}/repository`, owner, { repositoryId })).status).toBe(204);
    }
    const waiting = async () =>
      ((await (await request(`${git}/requests`, owner)).json()) as GitRequests).requests;
    return { owner, projectId, git, waiting };
  }

  async function proposing(projectId: string): Promise<AgentGitRequests> {
    const found = await requestsFor(projectId, 'moderator');
    if (!found) throw new Error('The project has no repository');
    return found;
  }

  /** Approves a request as the owner and runs it as the worker would. */
  async function approveAndRun(git: string, owner: string, requestId: string) {
    await send('POST', `${git}/requests/approve`, owner, { requestIds: [requestId] });
    return runGitRequest(
      {
        admin: test.db.admin,
        accessOf: connections.accessOf,
        writers: (target, token) => gitlabWriter(client, target, token),
      },
      { requestId },
    );
  }

  return { requestsFor, project, proposing, approveAndRun };
}

describe('agentGitRequests', () => {
  it('is there for a project with a repository, and names it', async () => {
    const { requestsFor, project, proposing } = setUp();
    const connected = await project();
    const bare = await project(null);

    expect((await proposing(connected.projectId)).repository).toEqual({
      path: 'beispiel-verein/vereins-app',
    });
    expect(await requestsFor(bare.projectId, 'moderator')).toBeUndefined();
    expect(await requestsFor('00000000-0000-4000-8000-000000000000', 'moderator')).toBeUndefined();
  });
});

describe('issues', () => {
  it('asks for the issues of every task without one, in the moderator’s name', async () => {
    const { project, proposing } = setUp();
    const { projectId, waiting } = await project();
    const git = await proposing(projectId);

    expect(await git.issues({})).toEqual({ outcome: 'requested', issues: 3, milestones: 2 });

    const [made] = await waiting();
    expect(made).toMatchObject({
      kind: 'issues',
      status: 'waiting',
      agentKey: 'moderator',
      requestedBy: { userId: null, name: '' },
    });
    expect(made?.actions.map((action) => [action.kind, action.title])).toEqual([
      ['milestone', 'Meilenstein 1: Grundgerüst'],
      ['issue', 'Projekt aufsetzen'],
      ['issue', 'Login per Link'],
      ['milestone', 'Meilenstein 2: Mitglieder'],
      ['issue', 'Mitgliederliste'],
    ]);
    // Asked for once: a second proposal finds nothing left.
    expect(await git.issues({})).toEqual({ outcome: 'none' });
    expect(await waiting()).toHaveLength(1);
  });

  it('takes one milestone by its number, and says what a milestone does not have', async () => {
    const { project, proposing } = setUp();
    const { projectId, waiting } = await project();
    const git = await proposing(projectId);

    expect(await git.issues({ milestone: 2 })).toEqual({
      outcome: 'requested',
      issues: 1,
      milestones: 1,
    });
    expect((await waiting())[0]?.actions.map((action) => action.title)).toEqual([
      'Meilenstein 2: Mitglieder',
      'Mitgliederliste',
    ]);
    expect(await git.issues({ milestone: 2 })).toEqual({ outcome: 'none' });
    expect(await git.issues({ milestone: 3 })).toEqual({ outcome: 'no_tasks' });
    expect(await git.issues({ milestone: 9 })).toEqual({ outcome: 'no_milestone' });
    // The other milestones are still free.
    expect(await git.issues({})).toEqual({ outcome: 'requested', issues: 2, milestones: 1 });
  });

  it('finds no tasks in a project without a plan', async () => {
    const { project, proposing } = setUp();
    const { projectId } = await project(101, null);

    expect(await (await proposing(projectId)).issues({})).toEqual({ outcome: 'no_tasks' });
  });
});

describe('planMergeRequest', () => {
  it('asks for the merge request of the package, once', async () => {
    const { project, proposing } = setUp();
    const { projectId, waiting } = await project();
    const git = await proposing(projectId);

    const first = await git.planMergeRequest();

    expect(first.outcome).toBe('requested');
    if (first.outcome !== 'requested') return;
    // The example repository has an overview of its own; other tests may have merged more.
    expect(first.added + first.changed).toBeGreaterThan(0);
    const [made] = await waiting();
    expect(made).toMatchObject({ kind: 'merge_request', status: 'waiting', agentKey: 'moderator' });
    expect(made?.actions.map((action) => action.kind)).toEqual(['commit', 'merge_request']);
    expect(made?.actions[0]?.title).toMatch(
      /^Plan-Paket auf dem Branch covibes\/plan-2026-10-09-[0-9a-f]{6} \(\d+ Dateien\)$/,
    );
    expect(await git.planMergeRequest()).toEqual({ outcome: 'waiting' });
  });

  it('has nothing to ask for without a plan, or once the repository holds the package', async () => {
    const { project, proposing, approveAndRun } = setUp();
    const empty = await project(101, null);
    expect(await (await proposing(empty.projectId)).planMergeRequest()).toEqual({
      outcome: 'no_plan',
    });

    // "Notizen" is the repository this file merges into.
    const { projectId, git: base, owner, waiting } = await project(103);
    const git = await proposing(projectId);
    expect((await git.planMergeRequest()).outcome).toBe('requested');
    const [packaged] = await waiting();
    expect(await approveAndRun(base, owner, packaged?.id ?? '')).toBe('done');
    // The merge request is open; merging it brings the package to the default branch.
    const number = (await waiting())[0]?.actions[1]?.result?.number ?? 0;
    expect(await git.merge(number)).toMatchObject({ outcome: 'requested', number });
    const merging = (await waiting()).find((entry) => entry.kind === 'merge');
    expect(merging).toMatchObject({ agentKey: 'moderator', status: 'waiting' });
    expect(await approveAndRun(base, owner, merging?.id ?? '')).toBe('done');

    expect(await git.planMergeRequest()).toEqual({ outcome: 'up_to_date' });
    expect(await git.merge(number)).toEqual({ outcome: 'not_open' });
  });
});

describe('merge', () => {
  it('asks to merge an open merge request once, and no draft or unknown one', async () => {
    const { project, proposing, approveAndRun } = setUp();
    const { projectId, git: base, owner, waiting } = await project();
    const git = await proposing(projectId);
    await git.planMergeRequest();
    const [packaged] = await waiting();
    expect(await approveAndRun(base, owner, packaged?.id ?? '')).toBe('done');
    const number = (await waiting())[0]?.actions[1]?.result?.number ?? 0;

    expect(await git.merge(number)).toEqual({
      outcome: 'requested',
      number,
      title: 'Projektplan, Feature-Specs und Diagramme aus Covibes',
    });
    expect(await git.merge(number)).toEqual({ outcome: 'waiting' });
    // The example's own merge request !1 is a draft, !2 is merged.
    expect(await git.merge(1)).toEqual({ outcome: 'draft' });
    expect(await git.merge(2)).toEqual({ outcome: 'not_open' });
    expect(await git.merge(999)).toEqual({ outcome: 'not_found' });
  });
});
