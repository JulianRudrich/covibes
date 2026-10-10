import { randomUUID } from 'node:crypto';

import type { GitActionDraft, ProjectSummary } from '@covibes/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  RepositoryWriteError,
  type RepositoryWriteFailure,
  type RepositoryWriter,
} from '@server/integrations/git-host';
import { GitlabError } from '@server/integrations/gitlab/client';
import { runGitRequest, type GitRequestDeps } from '@server/tasks/git-request';
import { APP_URL, createTestServer } from '@server/testing';

// The job of an approved Git request (spec 29b), with a scripted repository.
const test = createTestServer();

const GITLAB = 'https://gitlab.example.com';
const NOW = Date.parse('2026-10-09T10:00:00Z');

const milestone = (title: string): GitActionDraft => ({
  kind: 'milestone',
  payload: { title, description: `Ziel von ${title}` },
});

const issue = (title: string, of: string | null = 'M1'): GitActionDraft => ({
  kind: 'issue',
  payload: { title, description: `Text von ${title}`, milestone: of, taskId: randomUUID() },
});

/** An approved request with its actions, as the database holds it once someone approved. */
async function approved(actions: GitActionDraft[]) {
  const cookie = await test.signIn();
  const created = await test.app.request('/api/projects', {
    method: 'POST',
    headers: { cookie, origin: APP_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Vereins-App' }),
  });
  const projectId = ((await created.json()) as ProjectSummary).id;
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  const approver = session?.user.id ?? '';
  const requestId = randomUUID();
  await test.db.admin
    .insertInto('git_requests')
    .values({
      id: requestId,
      project_id: projectId,
      kind: 'issues',
      status: 'approved',
      base_url: GITLAB,
      repository_id: '101',
      repository_path: 'verein/app',
      repository_url: `${GITLAB}/verein/app`,
      requested_by: approver,
      decided_by: approver,
      decided_at: new Date(NOW),
    })
    .execute();
  await test.db.admin
    .insertInto('git_actions')
    .values(
      actions.map((action, position) => ({
        request_id: requestId,
        project_id: projectId,
        position,
        kind: action.kind,
        title: action.payload.title,
        payload: JSON.stringify(action.payload),
        task_id: action.kind === 'issue' ? action.payload.taskId : null,
      })),
    )
    .execute();
  return { requestId, approver };
}

/** Sets a failed request back as a second approval does. */
async function approveAgain(requestId: string) {
  await test.db.admin
    .updateTable('git_requests')
    .set({ status: 'approved', finished_at: null })
    .where('id', '=', requestId)
    .execute();
  await test.db.admin
    .updateTable('git_actions')
    .set({ status: 'waiting', error_code: null, error_detail: '' })
    .where('request_id', '=', requestId)
    .where('status', '=', 'failed')
    .execute();
}

const refuse = (code: RepositoryWriteFailure, detail = '') =>
  new RepositoryWriteError(code, detail);

/**
 * A repository that keeps what is written to it. `fails` names what it refuses, by the title of
 * the milestone or issue; `lost` names issues it creates without the answer arriving.
 */
function repository({
  fails = {},
  lost = [],
}: { fails?: Record<string, Error>; lost?: string[] } = {}) {
  const calls: string[] = [];
  const milestones = new Map<string, number>();
  const issues: {
    number: number;
    title: string;
    description: string;
    milestoneId: number | null;
  }[] = [];
  const targets: { baseUrl: string; repositoryId: number; token: string }[] = [];
  const state = { fails, lost };
  /** The branches that hold a commit, and the merge requests that are open, by their branch. */
  const branches = new Set<string>();
  const mergeRequests = new Map<string, number>();
  /** The merge requests that are merged, by their number. */
  const merged: number[] = [];
  /** The comments at merge requests, in the order they were posted. */
  const comments: { number: number; body: string }[] = [];
  const commentUrl = (number: number, place: number) =>
    `${GITLAB}/verein/app/-/merge_requests/${String(number)}#note_${String(place)}`;
  const writer: RepositoryWriter = {
    ensureMilestone({ title }) {
      calls.push(`milestone ${title}`);
      const failure = state.fails[title];
      if (failure) return Promise.reject(failure);
      const existing = milestones.get(title);
      const id = existing ?? milestones.size + 11;
      milestones.set(title, id);
      return Promise.resolve({
        id,
        url: `${GITLAB}/verein/app/-/milestones/${String(id)}`,
        existed: existing !== undefined,
      });
    },
    createIssue({ title, description, milestoneId }) {
      calls.push(`issue ${title}`);
      const failure = state.fails[title];
      if (failure) return Promise.reject(failure);
      const number = issues.length + 1;
      issues.push({ number, title, description, milestoneId });
      if (state.lost.includes(title)) return Promise.reject(new Error('The connection broke'));
      return Promise.resolve({ number, url: `${GITLAB}/verein/app/-/issues/${String(number)}` });
    },
    findIssue(mark) {
      calls.push('find');
      const found = issues.find((entry) => entry.description.includes(mark));
      return Promise.resolve(
        found && {
          number: found.number,
          url: `${GITLAB}/verein/app/-/issues/${String(found.number)}`,
        },
      );
    },
    commitFiles({ branch, files }) {
      calls.push(`commit ${branch} ${String(files.length)}`);
      const failure = state.fails[branch];
      if (failure) return Promise.reject(failure);
      const existed = branches.has(branch);
      branches.add(branch);
      return Promise.resolve({
        url: existed ? null : `${GITLAB}/verein/app/-/commit/abc`,
        added: existed ? 0 : files.length,
        changed: 0,
        existed,
      });
    },
    openMergeRequest({ sourceBranch, title }) {
      calls.push(`merge request ${sourceBranch}`);
      const failure = state.fails[title];
      if (failure) return Promise.reject(failure);
      const open = mergeRequests.get(sourceBranch);
      const number = open ?? mergeRequests.size + 7;
      mergeRequests.set(sourceBranch, number);
      return Promise.resolve({
        number,
        url: `${GITLAB}/verein/app/-/merge_requests/${String(number)}`,
        existed: open !== undefined,
      });
    },
    mergeMergeRequest({ number, sha }) {
      calls.push(`merge ${String(number)} ${String(sha)}`);
      const failure = state.fails[`!${String(number)}`];
      if (failure) return Promise.reject(failure);
      const existed = merged.includes(number);
      if (!existed) merged.push(number);
      return Promise.resolve({
        number,
        url: `${GITLAB}/verein/app/-/merge_requests/${String(number)}`,
        existed,
      });
    },
    commentOnMergeRequest({ number, body }) {
      const name = `comment ${String(number)}`;
      calls.push(name);
      const failure = state.fails[name];
      if (failure) return Promise.reject(failure);
      comments.push({ number, body });
      if (state.lost.includes(name)) return Promise.reject(new Error('The connection broke'));
      return Promise.resolve({ url: commentUrl(number, comments.length) });
    },
    findMergeRequestComment(number, mark) {
      calls.push('find comment');
      const place = comments.findIndex(
        (entry) => entry.number === number && entry.body.includes(mark),
      );
      return Promise.resolve(place === -1 ? undefined : { url: commentUrl(number, place + 1) });
    },
  };
  return {
    calls,
    issues,
    milestones,
    targets,
    state,
    writer,
    branches,
    mergeRequests,
    merged,
    comments,
  };
}

function deps(
  repo: ReturnType<typeof repository>,
  accessOf: GitRequestDeps['accessOf'] = () => Promise.resolve({ baseUrl: GITLAB, token: 'token' }),
): GitRequestDeps {
  return {
    admin: test.db.admin,
    accessOf,
    writers: (target, token) => {
      repo.targets.push({ ...target, token });
      return repo.writer;
    },
    now: () => NOW,
  };
}

async function stored(requestId: string) {
  const request = await test.db.admin
    .selectFrom('git_requests')
    .select(['status', 'finished_at'])
    .where('id', '=', requestId)
    .executeTakeFirstOrThrow();
  const actions = await test.db.admin
    .selectFrom('git_actions')
    .selectAll()
    .where('request_id', '=', requestId)
    .orderBy('position')
    .execute();
  return {
    request,
    actions,
    outcomes: actions.map((action) => [action.title, action.status, action.error_code]),
  };
}

describe('runGitRequest', () => {
  it('runs the actions in their order with the approver’s access, and records what they made', async () => {
    const { requestId, approver } = await approved([
      milestone('M1'),
      issue('Aufsetzen'),
      issue('Login'),
    ]);
    const repo = repository();
    const asked: string[] = [];

    const outcome = await runGitRequest(
      deps(repo, (userId) => {
        asked.push(userId);
        return Promise.resolve({ baseUrl: GITLAB, token: 'approver-token' });
      }),
      { requestId },
    );

    expect(outcome).toBe('done');
    expect(asked).toEqual([approver]);
    expect(repo.targets).toEqual([{ baseUrl: GITLAB, repositoryId: 101, token: 'approver-token' }]);
    expect(repo.calls).toEqual(['milestone M1', 'issue Aufsetzen', 'issue Login']);
    const { request, actions } = await stored(requestId);
    expect(request.status).toBe('done');
    expect(request.finished_at).toEqual(new Date(NOW));
    expect(
      actions.map((action) => [
        action.status,
        action.result_id,
        action.result_number,
        action.result_url,
        action.result_existed,
        action.attempts,
        action.executed_by,
      ]),
    ).toEqual([
      ['done', '11', null, `${GITLAB}/verein/app/-/milestones/11`, false, 1, approver],
      ['done', null, '1', `${GITLAB}/verein/app/-/issues/1`, false, 1, approver],
      ['done', null, '2', `${GITLAB}/verein/app/-/issues/2`, false, 1, approver],
    ]);
    // An issue belongs to its milestone and carries the mark of its action.
    expect(repo.issues[0]).toEqual({
      number: 1,
      title: 'Aufsetzen',
      milestoneId: 11,
      description: `Text von Aufsetzen\n\n<!-- covibes-action:${actions[1]?.id ?? ''} -->`,
    });
  });

  it('does nothing for a request that is not approved, and refuses a payload it cannot read', async () => {
    const { requestId } = await approved([issue('Aufsetzen', null)]);
    await test.db.admin
      .updateTable('git_requests')
      .set({ status: 'rejected' })
      .where('id', '=', requestId)
      .execute();
    const repo = repository();

    expect(await runGitRequest(deps(repo), { requestId })).toBe('gone');
    expect(await runGitRequest(deps(repo), { requestId: randomUUID() })).toBe('gone');
    await expect(runGitRequest(deps(repo), { requestId: 'nope' })).rejects.toThrow();
    expect(repo.calls).toEqual([]);
    expect((await stored(requestId)).outcomes).toEqual([['Aufsetzen', 'waiting', null]]);
  });

  it('fails an action the repository refuses, with the reason, and goes on with the others', async () => {
    const { requestId } = await approved([
      milestone('M1'),
      issue('Aufsetzen'),
      issue('Zu lang'),
      issue('Login'),
    ]);
    const repo = repository({
      fails: { 'Zu lang': refuse('invalid', `{"title":["is too long"]} ${'x'.repeat(400)}`) },
    });

    expect(await runGitRequest(deps(repo), { requestId })).toBe('failed');

    const { request, actions, outcomes } = await stored(requestId);
    expect(request.status).toBe('failed');
    expect(outcomes).toEqual([
      ['M1', 'done', null],
      ['Aufsetzen', 'done', null],
      ['Zu lang', 'failed', 'invalid'],
      ['Login', 'done', null],
    ]);
    expect(actions[2]?.error_detail).toHaveLength(300);
    expect(actions[2]?.error_detail.startsWith('{"title":["is too long"]}')).toBe(true);
  });

  it('fails the issues of a milestone that is not there without asking for them', async () => {
    const { requestId } = await approved([
      milestone('M1'),
      issue('Aufsetzen'),
      milestone('M2'),
      issue('Liste', 'M2'),
      issue('Frei', null),
    ]);
    const repo = repository({ fails: { M1: refuse('forbidden', '403 Forbidden') } });

    expect(await runGitRequest(deps(repo), { requestId })).toBe('failed');

    expect((await stored(requestId)).outcomes).toEqual([
      ['M1', 'failed', 'forbidden'],
      ['Aufsetzen', 'failed', 'milestone'],
      ['M2', 'done', null],
      ['Liste', 'done', null],
      ['Frei', 'done', null],
    ]);
    expect(repo.calls).toEqual(['milestone M1', 'milestone M2', 'issue Liste', 'issue Frei']);
    expect(repo.issues.map((entry) => entry.milestoneId)).toEqual([11, null]);
  });

  it('stops when the repository cannot be reached or is gone, and lets the rest wait', async () => {
    for (const code of ['unreachable', 'not_found'] as const) {
      const { requestId } = await approved([milestone('M1'), issue('Aufsetzen'), issue('Login')]);
      const repo = repository({ fails: { Aufsetzen: refuse(code, 'weg') } });

      expect(await runGitRequest(deps(repo), { requestId })).toBe('failed');

      expect((await stored(requestId)).outcomes).toEqual([
        ['M1', 'done', null],
        ['Aufsetzen', 'failed', code],
        ['Login', 'waiting', null],
      ]);
      expect(repo.calls).toEqual(['milestone M1', 'issue Aufsetzen']);
    }
  });

  it('runs nothing without an account of the approver at the repository’s GitLab', async () => {
    const cases: [GitRequestDeps['accessOf'], string, string][] = [
      [() => Promise.resolve(undefined), 'no_account', ''],
      [
        () => Promise.resolve({ baseUrl: 'https://other.example.com', token: 't' }),
        'no_account',
        '',
      ],
      // Renewing the token did not reach GitLab.
      [
        () => Promise.reject(new GitlabError(0, 'GitLab is not reachable: ECONNREFUSED')),
        'unreachable',
        'GitLab is not reachable: ECONNREFUSED',
      ],
    ];
    for (const [accessOf, code, detail] of cases) {
      const { requestId } = await approved([milestone('M1'), issue('Aufsetzen')]);
      const repo = repository();

      expect(await runGitRequest(deps(repo, accessOf), { requestId })).toBe('failed');

      const { actions, outcomes, request } = await stored(requestId);
      expect(request.status).toBe('failed');
      expect(outcomes).toEqual([
        ['M1', 'failed', code],
        ['Aufsetzen', 'waiting', null],
      ]);
      expect(actions[0]?.error_detail).toBe(detail);
      expect(repo.calls).toEqual([]);
    }
  });

  it('takes a token GitLab no longer accepts as no account, and stops', async () => {
    const { requestId } = await approved([milestone('M1'), issue('Aufsetzen')]);
    const repo = repository({ fails: { M1: refuse('unauthorized', '401 Unauthorized') } });

    expect(await runGitRequest(deps(repo), { requestId })).toBe('failed');

    expect((await stored(requestId)).outcomes).toEqual([
      ['M1', 'failed', 'no_account'],
      ['Aufsetzen', 'waiting', null],
    ]);
  });

  it('runs only what is not done when it is approved again', async () => {
    const { requestId } = await approved([milestone('M1'), issue('Aufsetzen'), issue('Login')]);
    const repo = repository({ fails: { Login: refuse('unreachable', '502') } });
    expect(await runGitRequest(deps(repo), { requestId })).toBe('failed');
    repo.state.fails = {};
    repo.calls.length = 0;
    await approveAgain(requestId);

    expect(await runGitRequest(deps(repo), { requestId })).toBe('done');

    // The milestone and the first issue are not asked for again; the issue that failed looks
    // for itself first, since its call may have arrived.
    expect(repo.calls).toEqual(['find', 'issue Login']);
    expect(repo.issues.map((entry) => [entry.title, entry.milestoneId])).toEqual([
      ['Aufsetzen', 11],
      ['Login', 11],
    ]);
    const { request, actions } = await stored(requestId);
    expect(request.status).toBe('done');
    expect(actions.map((action) => action.attempts)).toEqual([1, 1, 2]);
    // A third run finds nothing to do.
    expect(await runGitRequest(deps(repo), { requestId })).toBe('gone');
  });

  it('creates nothing twice when an answer was lost', async () => {
    const { requestId } = await approved([issue('Aufsetzen', null), issue('Login', null)]);
    const repo = repository({ lost: ['Aufsetzen'] });

    // A fault of our own: the job fails and is tried again; the action stays started.
    await expect(runGitRequest(deps(repo), { requestId })).rejects.toThrow('The connection broke');
    expect((await stored(requestId)).outcomes).toEqual([
      ['Aufsetzen', 'started', null],
      ['Login', 'waiting', null],
    ]);
    expect((await stored(requestId)).request.status).toBe('approved');

    repo.state.lost = [];
    expect(await runGitRequest(deps(repo), { requestId })).toBe('done');

    expect(repo.issues.map((entry) => entry.title)).toEqual(['Aufsetzen', 'Login']);
    const { actions } = await stored(requestId);
    expect(actions.map((action) => [action.status, action.result_number])).toEqual([
      ['done', '1'],
      ['done', '2'],
    ]);
  });

  it('fails an action whose payload does not read, and goes on', async () => {
    const { requestId } = await approved([issue('Aufsetzen', null), issue('Login', null)]);
    await test.db.admin
      .updateTable('git_actions')
      .set({ payload: JSON.stringify({ title: 'Aufsetzen' }) })
      .where('request_id', '=', requestId)
      .where('position', '=', 0)
      .execute();
    const repo = repository();

    expect(await runGitRequest(deps(repo), { requestId })).toBe('failed');

    expect((await stored(requestId)).outcomes).toEqual([
      ['Aufsetzen', 'failed', 'invalid'],
      ['Login', 'done', null],
    ]);
  });
});

describe('the plan package as a merge request (spec 29c)', () => {
  const BRANCH = 'covibes/plan-2026-10-09-a1b2c3';
  const TITLE = 'Projektplan aus Covibes';
  const commit: GitActionDraft = {
    kind: 'commit',
    payload: {
      title: `Plan-Paket auf dem Branch ${BRANCH} (2 Dateien)`,
      branch: BRANCH,
      startBranch: 'main',
      message: TITLE,
      files: [
        { path: 'CLAUDE.md', content: '# Vereins-App\n', mode: 'write' },
        { path: 'context/progress-tracker.md', content: '# Fortschritt\n', mode: 'create' },
      ],
    },
  };
  const mergeRequest: GitActionDraft = {
    kind: 'merge_request',
    payload: {
      title: TITLE,
      description: 'Das Paket.',
      sourceBranch: BRANCH,
      targetBranch: 'main',
    },
  };

  it('commits the files on the branch, then opens the merge request for it', async () => {
    const { requestId } = await approved([commit, mergeRequest]);
    const repo = repository();

    expect(await runGitRequest(deps(repo), { requestId })).toBe('done');

    expect(repo.calls).toEqual([`commit ${BRANCH} 2`, `merge request ${BRANCH}`]);
    const { actions, request } = await stored(requestId);
    expect(request.status).toBe('done');
    expect(
      actions.map((action) => [
        action.kind,
        action.status,
        action.result_number,
        action.result_url,
        action.result_existed,
      ]),
    ).toEqual([
      ['commit', 'done', null, `${GITLAB}/verein/app/-/commit/abc`, false],
      ['merge_request', 'done', '7', `${GITLAB}/verein/app/-/merge_requests/7`, false],
    ]);
  });

  it('opens no merge request when its commit did not work', async () => {
    const { requestId } = await approved([commit, mergeRequest]);
    const nothing = 'Nothing to commit: the repository holds these files already';
    const repo = repository({ fails: { [BRANCH]: refuse('invalid', nothing) } });

    expect(await runGitRequest(deps(repo), { requestId })).toBe('failed');

    const { actions, outcomes } = await stored(requestId);
    expect(outcomes.map(([, status, code]) => [status, code])).toEqual([
      ['failed', 'invalid'],
      ['failed', 'blocked'],
    ]);
    expect(actions[0]?.error_detail).toBe(nothing);
    expect(repo.calls).toEqual([`commit ${BRANCH} 2`]);
  });

  it('creates no second commit and no second merge request when it runs again', async () => {
    const { requestId } = await approved([commit, mergeRequest]);
    const repo = repository({ fails: { [TITLE]: refuse('unreachable', '502') } });
    expect(await runGitRequest(deps(repo), { requestId })).toBe('failed');
    expect((await stored(requestId)).outcomes.map(([, status]) => status)).toEqual([
      'done',
      'failed',
    ]);
    repo.state.fails = {};
    repo.calls.length = 0;
    await approveAgain(requestId);

    expect(await runGitRequest(deps(repo), { requestId })).toBe('done');

    // The commit is done and not asked for again; its merge request follows.
    expect(repo.calls).toEqual([`merge request ${BRANCH}`]);
    expect(repo.branches.size).toBe(1);
    expect(repo.mergeRequests.size).toBe(1);
  });

  it('continues a commit whose answer was lost: the branch is compared, not created anew', async () => {
    const { requestId } = await approved([commit, mergeRequest]);
    const repo = repository();
    // The branch is there, as after a commit whose answer never arrived.
    repo.branches.add(BRANCH);
    await test.db.admin
      .updateTable('git_actions')
      .set({ status: 'started', attempts: 1 })
      .where('request_id', '=', requestId)
      .where('position', '=', 0)
      .execute();

    expect(await runGitRequest(deps(repo), { requestId })).toBe('done');

    const { actions } = await stored(requestId);
    expect(actions.map((action) => [action.status, action.result_existed])).toEqual([
      ['done', true],
      ['done', false],
    ]);
  });
});

describe('merging a merge request (spec 29d)', () => {
  const merge: GitActionDraft = {
    kind: 'merge',
    payload: { title: '!7 Login per Link', number: 7, sha: 'abc123' },
  };

  it('merges with the approver’s access, holding on to the commit that was approved', async () => {
    const { requestId } = await approved([merge]);
    const repo = repository();

    expect(await runGitRequest(deps(repo), { requestId })).toBe('done');

    expect(repo.calls).toEqual(['merge 7 abc123']);
    const { actions, request } = await stored(requestId);
    expect(request.status).toBe('done');
    expect(
      actions.map((action) => [
        action.kind,
        action.status,
        action.result_number,
        action.result_url,
        action.result_existed,
      ]),
    ).toEqual([['merge', 'done', '7', `${GITLAB}/verein/app/-/merge_requests/7`, false]]);
  });

  it('fails with the reason when GitLab does not merge, and merges nothing twice', async () => {
    const { requestId } = await approved([merge]);
    const refused = 'SHA does not match HEAD of source branch';
    const repo = repository({ fails: { '!7': refuse('invalid', refused) } });

    expect(await runGitRequest(deps(repo), { requestId })).toBe('failed');
    const failed = await stored(requestId);
    expect(failed.outcomes).toEqual([['!7 Login per Link', 'failed', 'invalid']]);
    expect(failed.actions[0]?.error_detail).toBe(refused);

    repo.state.fails = {};
    await approveAgain(requestId);
    expect(await runGitRequest(deps(repo), { requestId })).toBe('done');
    // A run after it is merged finds it merged.
    await approveAgain(requestId);
    await test.db.admin
      .updateTable('git_actions')
      .set({ status: 'started' })
      .where('request_id', '=', requestId)
      .execute();
    await test.db.admin
      .updateTable('git_requests')
      .set({ status: 'approved' })
      .where('id', '=', requestId)
      .execute();
    expect(await runGitRequest(deps(repo), { requestId })).toBe('done');
    expect((await stored(requestId)).actions[0]?.result_existed).toBe(true);
    expect(repo.merged).toEqual([7]);
  });
});

describe('the review as a comment (spec 30c)', () => {
  const comment: GitActionDraft = {
    kind: 'comment',
    payload: {
      title: 'Review von !7: 1 Abweichung',
      number: 7,
      reviewId: '9c000000-0000-4000-8000-000000000007',
      body: '### Review gegen die Architektur\n\nWeicht ab.',
    },
  };

  it('posts the comment at the merge request with the approver’s access, with its mark', async () => {
    const { requestId, approver } = await approved([comment]);
    const repo = repository();
    const accessOf = vi.fn<GitRequestDeps['accessOf']>(() =>
      Promise.resolve({ baseUrl: GITLAB, token: 'token-of-the-approver' }),
    );

    expect(await runGitRequest(deps(repo, accessOf), { requestId })).toBe('done');

    expect(accessOf).toHaveBeenCalledWith(approver);
    expect(repo.targets.at(-1)?.token).toBe('token-of-the-approver');
    expect(repo.calls).toEqual(['comment 7']);
    const { actions, request } = await stored(requestId);
    expect(request.status).toBe('done');
    expect(repo.comments).toEqual([
      {
        number: 7,
        body: `### Review gegen die Architektur\n\nWeicht ab.\n\n<!-- covibes-action:${
          actions[0]?.id ?? ''
        } -->`,
      },
    ]);
    expect(
      actions.map((action) => [
        action.kind,
        action.status,
        action.result_number,
        action.result_url,
        action.result_existed,
      ]),
    ).toEqual([['comment', 'done', '7', `${GITLAB}/verein/app/-/merge_requests/7#note_1`, false]]);
  });

  it('posts nothing twice when an answer was lost', async () => {
    const { requestId } = await approved([comment]);
    const repo = repository({ lost: ['comment 7'] });

    await expect(runGitRequest(deps(repo), { requestId })).rejects.toThrow('The connection broke');
    expect((await stored(requestId)).outcomes).toEqual([
      ['Review von !7: 1 Abweichung', 'started', null],
    ]);

    repo.state.lost = [];
    expect(await runGitRequest(deps(repo), { requestId })).toBe('done');

    // The second try looked first and found the comment by its mark.
    expect(repo.calls).toEqual(['comment 7', 'find comment']);
    expect(repo.comments).toHaveLength(1);
    const { actions } = await stored(requestId);
    expect(actions[0]).toMatchObject({
      status: 'done',
      result_url: `${GITLAB}/verein/app/-/merge_requests/7#note_1`,
      result_existed: true,
    });
  });

  it('fails with the reason when GitLab refuses the comment, and posts it on a second approval', async () => {
    const { requestId } = await approved([comment]);
    const repo = repository({ fails: { 'comment 7': refuse('not_found', '404 Not found') } });

    expect(await runGitRequest(deps(repo), { requestId })).toBe('failed');
    const failed = await stored(requestId);
    expect(failed.outcomes).toEqual([['Review von !7: 1 Abweichung', 'failed', 'not_found']]);
    expect(repo.comments).toEqual([]);

    repo.state.fails = {};
    await approveAgain(requestId);
    expect(await runGitRequest(deps(repo), { requestId })).toBe('done');
    expect(repo.comments).toHaveLength(1);
  });

  it('fails a comment whose payload does not read', async () => {
    const { requestId } = await approved([
      { kind: 'comment', payload: { ...comment.payload, reviewId: 'no-review' } },
    ]);
    const repo = repository();

    expect(await runGitRequest(deps(repo), { requestId })).toBe('failed');

    expect(repo.calls).toEqual([]);
    expect((await stored(requestId)).outcomes).toEqual([
      ['Review von !7: 1 Abweichung', 'failed', 'invalid'],
    ]);
  });
});
