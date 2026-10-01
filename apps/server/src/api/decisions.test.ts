import type {
  ApiErrorBody,
  ApplyResult,
  ChatMessage,
  Comparison,
  Criterion,
  Decision,
  DecisionLogEntry,
  Proposal,
  ProjectDetails,
  ProjectSummary,
} from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { APP_URL, createTestServer } from '@server/testing';

// Criteria, decisions and the decision log (spec 16a).
const test = createTestServer();

function request(path: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  headers.set('origin', APP_URL);
  if (init.body) headers.set('content-type', 'application/json');
  return test.app.request(path, { ...init, headers });
}

async function errorOf(response: Response) {
  return ((await response.json()) as ApiErrorBody).error.code;
}

async function userOf(cookie: string) {
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  return session.user;
}

async function createProject(cookie: string) {
  const created = await request('/api/projects', cookie, {
    method: 'POST',
    body: JSON.stringify({ name: 'Entscheiden' }),
  });
  return ((await created.json()) as ProjectSummary).id;
}

async function addMember(projectId: string, cookie: string, role: 'editor' | 'viewer') {
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, (await userOf(cookie)).id, role],
  );
}

const json = async <T>(response: Response) => (await response.json()) as T;

const criteriaOf = async (projectId: string, cookie: string) =>
  json<Criterion[]>(await request(`/api/projects/${projectId}/criteria`, cookie));

const decisionsOf = async (projectId: string, cookie: string) =>
  json<Decision[]>(await request(`/api/projects/${projectId}/decisions`, cookie));

const logOf = async (projectId: string, cookie: string) =>
  json<DecisionLogEntry[]>(await request(`/api/projects/${projectId}/decisions/log`, cookie));

const addCriterion = (projectId: string, cookie: string, text: unknown) =>
  request(`/api/projects/${projectId}/criteria`, cookie, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });

/** A decision of the moderator that waits for confirmation, as the worker stores it. */
async function proposeDecision(projectId: string, topic = 'Canvas', value = 'React Flow') {
  const row = await test.db.admin
    .insertInto('proposals')
    .values({
      project_id: projectId,
      board_id: null,
      kind: 'decision',
      agent_key: 'moderator',
      reason: 'question',
      operations: JSON.stringify([
        {
          op: 'decide',
          topic,
          value,
          reasoning: 'Passt zu den Kriterien',
          alternatives: [{ name: 'tldraw', note: 'Lizenz' }],
        },
      ]),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

const apply = (projectId: string, proposalId: string, cookie: string) =>
  request(`/api/projects/${projectId}/proposals/${proposalId}/apply`, cookie, { method: 'POST' });

describe('criteria', () => {
  it('are added, changed and removed by owners and editors, and logged', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');

    const added = await addCriterion(projectId, editor, '  EU-Hosting ');
    expect(added.status).toBe(201);
    const criterion = await json<Criterion>(added);
    expect(criterion.text).toBe('EU-Hosting');
    // The same text again changes nothing.
    expect(await json<Criterion>(await addCriterion(projectId, owner, 'eu-hosting'))).toEqual(
      criterion,
    );

    const changed = await request(`/api/projects/${projectId}/criteria/${criterion.id}`, owner, {
      method: 'PATCH',
      body: JSON.stringify({ text: 'Hosting in der EU' }),
    });
    expect(await json<Criterion>(changed)).toEqual({ id: criterion.id, text: 'Hosting in der EU' });
    expect(await criteriaOf(projectId, editor)).toEqual([
      { id: criterion.id, text: 'Hosting in der EU' },
    ]);

    const removed = await request(`/api/projects/${projectId}/criteria/${criterion.id}`, editor, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(204);
    expect(await criteriaOf(projectId, owner)).toEqual([]);

    const log = await logOf(projectId, owner);
    expect(log.map((entry) => [entry.kind, entry.value, entry.user])).toEqual([
      ['criterion_removed', 'Hosting in der EU', (await userOf(editor)).name],
      ['criterion_changed', 'Hosting in der EU', (await userOf(owner)).name],
      ['criterion_added', 'EU-Hosting', (await userOf(editor)).name],
    ]);
    expect(log[1]).toMatchObject({ previous: 'EU-Hosting', agentKey: null });
  });

  it('are only read by viewers and hidden from strangers', async () => {
    const owner = await test.signIn();
    const viewer = await test.signIn();
    const stranger = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, viewer, 'viewer');
    const criterion = await json<Criterion>(await addCriterion(projectId, owner, 'Budget: klein'));

    expect(await criteriaOf(projectId, viewer)).toEqual([criterion]);
    expect((await addCriterion(projectId, viewer, 'X')).status).toBe(403);
    const byViewer = await request(`/api/projects/${projectId}/criteria/${criterion.id}`, viewer, {
      method: 'DELETE',
    });
    expect(byViewer.status).toBe(403);
    expect((await request(`/api/projects/${projectId}/criteria`, stranger)).status).toBe(404);
    expect((await addCriterion(projectId, stranger, 'X')).status).toBe(404);
  });

  it('are short, and at most 20 per project', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    expect(await errorOf(await addCriterion(projectId, owner, ''))).toBe('invalid_input');
    expect(await errorOf(await addCriterion(projectId, owner, 'x'.repeat(81)))).toBe(
      'invalid_input',
    );

    await test.db.admin
      .insertInto('criteria')
      .values(
        Array.from({ length: 20 }, (_, index) => ({
          project_id: projectId,
          text: `Kriterium ${String(index)}`,
        })),
      )
      .execute();
    expect(await errorOf(await addCriterion(projectId, owner, 'Eins zu viel'))).toBe(
      'limit_reached',
    );
  });
});

describe('decisions', () => {
  it('are recorded when someone confirms the moderator proposal', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const viewer = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    await addMember(projectId, viewer, 'viewer');
    const proposalId = await proposeDecision(projectId);

    const listed = await json<Proposal[]>(
      await request(`/api/projects/${projectId}/proposals`, viewer),
    );
    expect(listed).toMatchObject([
      {
        id: proposalId,
        kind: 'decision',
        boardId: null,
        operations: [{ op: 'decide', topic: 'Canvas', value: 'React Flow' }],
      },
    ]);
    expect((await apply(projectId, proposalId, viewer)).status).toBe(403);

    const applied = await apply(projectId, proposalId, editor);
    expect(applied.status).toBe(200);
    expect(await json<ApplyResult>(applied)).toEqual({ applied: 1, skipped: 0 });

    const confirmer = (await userOf(editor)).name;
    expect(await decisionsOf(projectId, viewer)).toEqual([
      {
        id: expect.any(String) as unknown,
        topic: 'Canvas',
        status: 'decided',
        value: 'React Flow',
        reasoning: 'Passt zu den Kriterien',
        alternatives: [{ name: 'tldraw', note: 'Lizenz' }],
        decidedBy: confirmer,
        decidedAt: expect.any(String) as unknown,
        reopenReason: null,
        comparison: null,
        tally: null,
      },
    ]);
    expect(await logOf(projectId, owner)).toMatchObject([
      {
        kind: 'decided',
        topic: 'Canvas',
        value: 'React Flow',
        reasoning: 'Passt zu den Kriterien',
        alternatives: [{ name: 'tldraw', note: 'Lizenz' }],
        user: confirmer,
        agentKey: 'moderator',
      },
    ]);
  });

  it('keep a proposal open whose topic was decided in the meantime', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    const first = await proposeDecision(projectId, 'Canvas', 'React Flow');
    const second = await proposeDecision(projectId, 'canvas', 'tldraw');
    expect((await apply(projectId, first, owner)).status).toBe(200);

    const late = await apply(projectId, second, owner);
    expect(late.status).toBe(409);
    expect(await errorOf(late)).toBe('already_decided');
    const row = await test.db.admin
      .selectFrom('proposals')
      .select('status')
      .where('id', '=', second)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('open');
    expect((await decisionsOf(projectId, owner)).map((decision) => decision.value)).toEqual([
      'React Flow',
    ]);
  });

  it('are reopened with a reason by owners and editors, which starts a new round', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const viewer = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    await addMember(projectId, viewer, 'viewer');
    await apply(projectId, await proposeDecision(projectId), owner);
    const [decision] = await decisionsOf(projectId, owner);
    const reopen = (cookie: string, body: unknown, id = decision?.id ?? '') =>
      request(`/api/projects/${projectId}/decisions/${id}/reopen`, cookie, {
        method: 'POST',
        body: JSON.stringify(body),
      });

    expect((await reopen(viewer, { reason: 'Zu teuer' })).status).toBe(403);
    expect(await errorOf(await reopen(editor, { reason: '  ' }))).toBe('invalid_input');
    expect(
      (await reopen(editor, { reason: 'x' }, '2b1f1c1e-6c5f-4a53-9a41-0d2d3f8a7b11')).status,
    ).toBe(404);
    expect((await reopen(editor, { reason: 'Die Lizenz hat sich geändert' })).status).toBe(204);

    expect(await decisionsOf(projectId, owner)).toMatchObject([
      {
        topic: 'Canvas',
        status: 'open',
        value: null,
        decidedBy: null,
        reopenReason: 'Die Lizenz hat sich geändert',
      },
    ]);
    const [entry] = await logOf(projectId, owner);
    expect(entry).toMatchObject({
      kind: 'reopened',
      topic: 'Canvas',
      value: 'React Flow',
      reason: 'Die Lizenz hat sich geändert',
      user: (await userOf(editor)).name,
    });
    const run = await test.db.admin
      .selectFrom('ai_runs')
      .select(['agent_key', 'status'])
      .where('decision_id', '=', decision?.id ?? '')
      .executeTakeFirstOrThrow();
    expect(run).toEqual({ agent_key: 'moderator', status: 'queued' });

    // An open decision cannot be reopened again.
    expect(await errorOf(await reopen(owner, { reason: 'Noch einmal' }))).toBe('already_decided');
  });

  it('are hidden from strangers', async () => {
    const owner = await test.signIn();
    const stranger = await test.signIn();
    const projectId = await createProject(owner);
    expect((await request(`/api/projects/${projectId}/decisions`, stranger)).status).toBe(404);
    expect((await request(`/api/projects/${projectId}/decisions/log`, stranger)).status).toBe(404);
  });
});

async function moderatorMessage(projectId: string) {
  const row = await test.db.admin
    .insertInto('messages')
    .values({
      project_id: projectId,
      author_kind: 'agent',
      author_agent_key: 'moderator',
      content: 'Bitte stimmt ab.',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** An open vote with its moderator message, as the worker stores it. */
async function startVote(projectId: string, topic = 'Canvas') {
  const messageId = await moderatorMessage(projectId);
  const row = await test.db.admin
    .insertInto('votes')
    .values({
      project_id: projectId,
      message_id: messageId,
      topic,
      options: JSON.stringify(['React Flow', 'tldraw']),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { voteId: row.id, messageId };
}

async function voteOf(projectId: string, messageId: string, cookie: string) {
  const messages = await json<ChatMessage[]>(
    await request(`/api/projects/${projectId}/messages`, cookie),
  );
  return messages.find((message) => message.id === messageId)?.vote;
}

const castVote = (projectId: string, voteId: string, cookie: string, option: unknown) =>
  request(`/api/projects/${projectId}/votes/${voteId}/cast`, cookie, {
    method: 'POST',
    body: JSON.stringify({ option }),
  });

const patchProject = (projectId: string, cookie: string, body: unknown) =>
  request(`/api/projects/${projectId}`, cookie, { method: 'PATCH', body: JSON.stringify(body) });

describe('votes (spec 16b)', () => {
  it('collect the votes of owners and editors and record the winner once all voted', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const viewer = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    await addMember(projectId, viewer, 'viewer');
    const { voteId, messageId } = await startVote(projectId);

    expect((await castVote(projectId, voteId, viewer, 0)).status).toBe(403);
    expect(await errorOf(await castVote(projectId, voteId, editor, 7))).toBe('invalid_input');
    expect((await castVote(projectId, voteId, editor, 1)).status).toBe(204);
    expect(await voteOf(projectId, messageId, viewer)).toEqual({
      id: voteId,
      topic: 'Canvas',
      options: ['React Flow', 'tldraw'],
      status: 'open',
      winner: null,
      ballots: [{ userId: (await userOf(editor)).id, option: 1 }],
    });

    // The editor changes the vote, then the owner's vote completes it.
    expect((await castVote(projectId, voteId, editor, 0)).status).toBe(204);
    expect((await castVote(projectId, voteId, owner, 0)).status).toBe(204);
    expect(await voteOf(projectId, messageId, owner)).toMatchObject({
      status: 'closed',
      winner: 'React Flow',
    });
    expect(await decisionsOf(projectId, viewer)).toMatchObject([
      {
        topic: 'Canvas',
        status: 'decided',
        value: 'React Flow',
        decidedBy: null,
        tally: [
          { name: 'React Flow', votes: 2 },
          { name: 'tldraw', votes: 0 },
        ],
      },
    ]);
    expect((await logOf(projectId, owner))[0]).toMatchObject({
      kind: 'decided',
      votes: [
        { name: 'React Flow', votes: 2 },
        { name: 'tldraw', votes: 0 },
      ],
      agentKey: 'moderator',
    });
    expect(await errorOf(await castVote(projectId, voteId, owner, 1))).toBe('already_decided');
  });

  it('are ended early by owners only', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    const { voteId, messageId } = await startVote(projectId);
    await castVote(projectId, voteId, editor, 1);
    const close = (cookie: string) =>
      request(`/api/projects/${projectId}/votes/${voteId}/close`, cookie, { method: 'POST' });

    expect((await close(editor)).status).toBe(403);
    expect((await close(owner)).status).toBe(204);
    expect(await voteOf(projectId, messageId, editor)).toMatchObject({
      status: 'closed',
      winner: 'tldraw',
    });
  });
});

describe('comparisons (spec 16b)', () => {
  it('show in their message and go along with the decision on their topic', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    const comparison: Comparison = {
      topic: 'Canvas',
      options: ['React Flow', 'tldraw'],
      rows: [
        {
          criterion: 'Kleines Budget',
          cells: [
            { rating: 'good', note: 'MIT' },
            { rating: 'bad', note: 'Lizenz kostet' },
          ],
        },
      ],
      recommendation: { option: 'React Flow', reason: 'Passt zum Budget.' },
    };
    const messageId = await moderatorMessage(projectId);
    await test.db.admin
      .insertInto('comparisons')
      .values({
        project_id: projectId,
        message_id: messageId,
        topic: 'Canvas',
        data: JSON.stringify(comparison),
      })
      .execute();

    const messages = await json<ChatMessage[]>(
      await request(`/api/projects/${projectId}/messages`, owner),
    );
    expect(messages.find((message) => message.id === messageId)?.comparison).toEqual(comparison);

    await apply(projectId, await proposeDecision(projectId), owner);
    expect(await decisionsOf(projectId, owner)).toMatchObject([
      { topic: 'Canvas', comparison, tally: null },
    ]);
    expect((await logOf(projectId, owner))[0]).toMatchObject({ kind: 'decided', compared: true });
  });
});

describe('project settings (spec 16b)', () => {
  it('have defaults, and owners change the stance and the decision process', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    const details = async () =>
      json<ProjectDetails>(await request(`/api/projects/${projectId}`, editor));

    expect(await details()).toMatchObject({ stance: 'criteria', decisionProcess: 'consensus' });
    expect((await patchProject(projectId, editor, { stance: 'opinion' })).status).toBe(403);
    expect((await patchProject(projectId, owner, { stance: 'loud' })).status).toBe(400);
    expect((await patchProject(projectId, owner, { stance: 'strict' })).status).toBe(204);
    expect((await patchProject(projectId, owner, { decisionProcess: 'vote' })).status).toBe(204);
    expect(await details()).toMatchObject({
      stance: 'strict',
      decisionProcess: 'vote',
      observer: true,
      proposalsOnly: false,
    });
  });

  it('let only owners confirm a decision while the owner decides', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    await patchProject(projectId, owner, { decisionProcess: 'owner' });
    const proposalId = await proposeDecision(projectId);

    const byEditor = await apply(projectId, proposalId, editor);
    expect(byEditor.status).toBe(403);
    expect(await decisionsOf(projectId, owner)).toEqual([]);
    expect((await apply(projectId, proposalId, owner)).status).toBe(200);
    expect(await decisionsOf(projectId, owner)).toMatchObject([
      { topic: 'Canvas', decidedBy: (await userOf(owner)).name },
    ]);
  });
});
