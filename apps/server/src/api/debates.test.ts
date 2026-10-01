import type { ApiErrorBody, ChatMessage, ProjectSummary } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { loadMessage } from '@server/chat/rows';
import { APP_URL, createTestServer } from '@server/testing';

// Debates in the API (spec 18): the card and the marks in the messages, and ending one early.
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

async function userIdOf(cookie: string) {
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  return session.user.id;
}

async function createProject(cookie: string) {
  const created = await request('/api/projects', cookie, {
    method: 'POST',
    body: JSON.stringify({ name: 'Debatten' }),
  });
  return ((await created.json()) as ProjectSummary).id;
}

async function addMember(projectId: string, cookie: string, role: 'editor' | 'viewer') {
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, await userIdOf(cookie), role],
  );
}

/** A debate whose opening answer is finished, as the worker and the chain leave it. */
async function openDebate(projectId: string) {
  const message = await test.db.admin
    .insertInto('messages')
    .values({
      project_id: projectId,
      author_kind: 'agent',
      author_agent_key: 'moderator',
      content: 'Backend und Kritiker debattieren jetzt.',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const debate = await test.db.admin
    .insertInto('debates')
    .values({
      project_id: projectId,
      message_id: message.id,
      topic: 'Echtzeit-Dienst',
      question: 'Braucht das MVP einen eigenen Echtzeit-Dienst?',
      participants: ['backend', 'critic'],
      rounds: 2,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const opening = await test.db.admin
    .insertInto('ai_runs')
    .values({
      project_id: projectId,
      agent_key: 'moderator',
      reply_message_id: message.id,
      debate_id: debate.id,
      status: 'running',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await finish(opening.id);
  return { debateId: debate.id, messageId: message.id };
}

function finish(runId: string) {
  return test.db.admin
    .updateTable('ai_runs')
    .set({ status: 'done' })
    .where('id', '=', runId)
    .execute();
}

/** Lets the waiting run of the debate write its message and finish, like the worker. */
async function takeTurn(projectId: string, debateId: string, content: string) {
  const run = await test.db.admin
    .selectFrom('ai_runs')
    .select(['id', 'agent_key'])
    .where('debate_id', '=', debateId)
    .where('status', '=', 'queued')
    .executeTakeFirstOrThrow();
  const message = await test.db.admin
    .insertInto('messages')
    .values({
      project_id: projectId,
      author_kind: 'agent',
      author_agent_key: run.agent_key,
      content,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await test.db.admin
    .updateTable('ai_runs')
    .set({ reply_message_id: message.id })
    .where('id', '=', run.id)
    .execute();
  await finish(run.id);
  return message.id;
}

const messagesOf = async (projectId: string, cookie: string) =>
  (await (await request(`/api/projects/${projectId}/messages`, cookie)).json()) as ChatMessage[];

describe('debates', () => {
  it('show as a card in the opening message and as a mark on every turn', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    const { debateId, messageId } = await openDebate(projectId);
    const first = await takeTurn(projectId, debateId, 'Ein Dienst reicht.');

    const messages = await messagesOf(projectId, owner);
    const opening = messages.find((message) => message.id === messageId);
    expect(opening?.debate).toEqual({
      id: debateId,
      topic: 'Echtzeit-Dienst',
      question: 'Braucht das MVP einen eigenen Echtzeit-Dienst?',
      participants: ['backend', 'critic'],
      rounds: 2,
      turns: 1,
      status: 'running',
      stopped: false,
      stoppedBy: null,
    });
    // The opening message carries the card, not the mark of a turn.
    expect(opening?.debateTurn).toBeUndefined();
    const turn = messages.find((message) => message.id === first);
    expect(turn?.debateTurn).toEqual({ debateId, round: 1, rounds: 2 });
    expect(turn?.debate).toBeUndefined();
  });

  it('are ended early by owners and editors; the moderator then sums up', async () => {
    const owner = await test.signIn('debate-olga@example.com');
    const editor = await test.signIn();
    const viewer = await test.signIn();
    const stranger = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    await addMember(projectId, viewer, 'viewer');
    const { debateId, messageId } = await openDebate(projectId);
    const stop = (cookie: string, id = debateId, project = projectId) =>
      request(`/api/projects/${project}/debates/${id}/stop`, cookie, { method: 'POST' });

    const refusedForViewer = await stop(viewer);
    expect(refusedForViewer.status).toBe(403);
    expect((await stop(stranger)).status).toBe(404);
    expect((await stop(owner, '99999999-9999-4999-8999-999999999999')).status).toBe(404);
    const other = await createProject(owner);
    expect((await stop(owner, debateId, other)).status).toBe(404);

    expect((await stop(editor)).status).toBe(204);
    const again = await stop(owner);
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toBe('already_decided');
    const stopped = await loadMessage(test.db.admin, messageId);
    expect(stopped?.debate).toMatchObject({ status: 'running', stopped: true });
    expect(stopped?.debate?.stoppedBy).toEqual(expect.any(String));

    // The turn in progress is finished, then the moderator sums up.
    await takeTurn(projectId, debateId, 'Ein Dienst reicht.');
    const summary = await takeTurn(projectId, debateId, 'Beide sind sich einig.');
    const messages = await messagesOf(projectId, owner);
    expect(messages.find((message) => message.id === messageId)?.debate).toMatchObject({
      status: 'done',
      turns: 1,
      stopped: true,
    });
    expect(messages.find((message) => message.id === summary)).toMatchObject({
      author: { kind: 'agent', agentKey: 'moderator' },
      debateTurn: { debateId, round: null, rounds: 2 },
    });
    expect((await stop(owner)).status).toBe(409);
  });
});
