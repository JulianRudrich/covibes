import { randomUUID } from 'node:crypto';

import {
  addBlock,
  boardDocumentName,
  readEdges,
  readNodes,
  type ApiErrorBody,
  type ApplyResult,
  type CanvasOperationInput,
  type Decision,
  type DecisionLogEntry,
  type Proposal,
  type ProjectDetails,
  type ProjectSummary,
} from '@covibes/shared';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { APP_URL, createTestServer } from '@server/testing';

const test = createTestServer();
const OLGA = { kind: 'human', userId: randomUUID() } as const;

function request(path: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  headers.set('origin', APP_URL);
  return test.app.request(path, { ...init, headers });
}

async function errorOf(response: Response) {
  return ((await response.json()) as ApiErrorBody).error;
}

async function createProject(cookie: string) {
  const created = await request('/api/projects', cookie, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Vorschläge' }),
  });
  const projectId = ((await created.json()) as ProjectSummary).id;
  const details = (await (
    await request(`/api/projects/${projectId}`, cookie)
  ).json()) as ProjectDetails;
  const boardId = details.boards[0]?.id ?? '';
  return { projectId, boardId };
}

async function addMember(projectId: string, cookie: string, role: 'editor' | 'viewer') {
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, session.user.id, role],
  );
}

/** A proposal of the backend agent, as the worker stores it. */
async function propose(
  projectId: string,
  boardId: string,
  operations: CanvasOperationInput[],
): Promise<string> {
  const row = await test.db.admin
    .insertInto('proposals')
    .values({
      project_id: projectId,
      board_id: boardId,
      agent_key: 'backend',
      reason: 'question',
      operations: JSON.stringify(operations),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

function queueWithArrow(from: string): { queue: string; operations: CanvasOperationInput[] } {
  const queue = randomUUID();
  return {
    queue,
    operations: [
      { op: 'add_block', block: { id: queue, position: { x: 0, y: 200 }, label: 'Queue' } },
      { op: 'add_edge', edge: { id: randomUUID(), source: from, target: queue, label: 'Jobs' } },
    ],
  };
}

/** Changes the board the way a browser would, through the collaboration server. */
async function onBoard<T>(projectId: string, boardId: string, fn: (doc: Y.Doc) => T): Promise<T> {
  return await test.collab.changeBoard({ projectId, boardId }, (doc) => fn(doc));
}

/** The stored board, once the collaboration server has written it. */
async function storedBoard(boardId: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const deadline = Date.now() + 5_000;
  for (;;) {
    const { rows } = await test.db.adminPool.query<{ state: Buffer }>(
      'select state from yjs_documents where name = $1',
      [boardDocumentName(boardId)],
    );
    const state = rows[0]?.state;
    if (state) {
      Y.applyUpdate(doc, new Uint8Array(state));
      return doc;
    }
    if (Date.now() > deadline) throw new Error('The board was not stored');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function proposalRow(id: string) {
  return await test.db.admin
    .selectFrom('proposals')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
}

describe('proposals', () => {
  it('lists the open proposals of the project to its members', async () => {
    const owner = await test.signIn();
    const viewer = await test.signIn();
    const stranger = await test.signIn();
    const { projectId, boardId } = await createProject(owner);
    await addMember(projectId, viewer, 'viewer');
    const { operations } = queueWithArrow(randomUUID());
    const id = await propose(projectId, boardId, operations.slice(0, 1));

    const listed = (await (
      await request(`/api/projects/${projectId}/proposals`, viewer)
    ).json()) as Proposal[];
    expect(listed).toEqual([
      expect.objectContaining({
        id,
        projectId,
        boardId,
        agentKey: 'backend',
        status: 'open',
        reason: 'question',
        operations: [expect.objectContaining({ op: 'add_block' }) as unknown],
      }),
    ]);
    expect((await request(`/api/projects/${projectId}/proposals`, stranger)).status).toBe(404);
  });

  it('applies a proposal onto the board with the agent as author, once', async () => {
    const owner = await test.signIn();
    const { projectId, boardId } = await createProject(owner);
    const api = randomUUID();
    await onBoard(projectId, boardId, (doc) =>
      addBlock(doc, { id: api, position: { x: 0, y: 0 }, label: 'API' }, OLGA),
    );
    const { queue, operations } = queueWithArrow(api);
    const id = await propose(projectId, boardId, operations);
    const publish = vi.spyOn(test.realtime, 'publish');

    const applied = await request(`/api/projects/${projectId}/proposals/${id}/apply`, owner, {
      method: 'POST',
    });

    expect(applied.status).toBe(200);
    expect((await applied.json()) as ApplyResult).toEqual({ applied: 2, skipped: 0 });
    const board = await storedBoard(boardId);
    expect(readNodes(board).find((node) => node.id === queue)).toMatchObject({
      label: 'Queue',
      createdBy: { kind: 'agent', agentKey: 'backend' },
    });
    expect(readEdges(board)).toMatchObject([{ source: api, target: queue, label: 'Jobs' }]);
    expect(await proposalRow(id)).toMatchObject({
      status: 'applied',
      decided_at: expect.any(Date) as unknown,
    });
    expect(publish).toHaveBeenCalledWith(projectId, { type: 'proposals' });
    publish.mockRestore();

    const again = await request(`/api/projects/${projectId}/proposals/${id}/apply`, owner, {
      method: 'POST',
    });
    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe('already_decided');
  });

  it('lets editors reject, and viewers neither apply nor reject', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const viewer = await test.signIn();
    const { projectId, boardId } = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    await addMember(projectId, viewer, 'viewer');
    const id = await propose(projectId, boardId, queueWithArrow(randomUUID()).operations);

    for (const action of ['apply', 'reject']) {
      const refused = await request(
        `/api/projects/${projectId}/proposals/${id}/${action}`,
        viewer,
        {
          method: 'POST',
        },
      );
      expect(refused.status).toBe(403);
    }
    const rejected = await request(`/api/projects/${projectId}/proposals/${id}/reject`, editor, {
      method: 'POST',
    });
    expect(rejected.status).toBe(204);
    expect(await proposalRow(id)).toMatchObject({ status: 'rejected' });
  });

  it('keeps a proposal open while someone edits a block it changes', async () => {
    const owner = await test.signIn();
    const { projectId, boardId } = await createProject(owner);
    const api = randomUUID();
    await onBoard(projectId, boardId, (doc) =>
      addBlock(doc, { id: api, position: { x: 0, y: 0 }, label: 'API' }, OLGA),
    );
    const id = await propose(projectId, boardId, [
      { op: 'update_node', id: api, changes: { label: 'Gateway' } },
    ]);

    // Sam edits the block: the lock lives in the awareness of the board.
    const editing = await test.collab.hocuspocus.openDirectConnection(boardDocumentName(boardId), {
      user: { id: 'sam', name: 'Sam', role: 'editor' },
      boardId,
      projectId,
    });
    editing.document?.awareness.setLocalState({
      user: { id: 'sam', name: 'Sam' },
      editing: { nodeId: api, since: Date.now() },
    });
    try {
      const refused = await request(`/api/projects/${projectId}/proposals/${id}/apply`, owner, {
        method: 'POST',
      });
      expect(refused.status).toBe(409);
      expect(await errorOf(refused)).toMatchObject({ code: 'being_edited', detail: 'Sam' });
      expect(await proposalRow(id)).toMatchObject({ status: 'open', decided_at: null });
    } finally {
      editing.document?.awareness.setLocalState(null);
      await editing.disconnect();
    }
  });

  it('answers unknown and foreign proposals with 404', async () => {
    const owner = await test.signIn();
    const other = await test.signIn();
    const { projectId, boardId } = await createProject(owner);
    const own = await createProject(other);
    const id = await propose(projectId, boardId, queueWithArrow(randomUUID()).operations);

    for (const path of [
      `/api/projects/${projectId}/proposals/${randomUUID()}/apply`,
      `/api/projects/${own.projectId}/proposals/${id}/apply`,
      `/api/projects/${projectId}/proposals/not-a-uuid/reject`,
    ]) {
      const response = await request(path, other, { method: 'POST' });
      expect(response.status).toBe(404);
    }
  });
});

describe('variants (spec 17)', () => {
  /** Two variants with one block each, as the worker stores them. */
  async function proposeVariants(projectId: string, boardId: string) {
    const [monolith, service] = [randomUUID(), randomUUID()];
    const row = await test.db.admin
      .insertInto('proposals')
      .values({
        project_id: projectId,
        board_id: boardId,
        kind: 'variants',
        agent_key: 'moderator',
        reason: 'variants',
        operations: JSON.stringify([
          {
            op: 'variants',
            topic: 'Architektur',
            variants: [
              {
                name: 'Monolith',
                summary: 'Ein Dienst für alles.',
                operations: [
                  {
                    op: 'add_block',
                    block: { id: monolith, position: { x: 0, y: 0 }, label: 'Server' },
                  },
                ],
              },
              {
                name: 'Echtzeit-Dienst',
                summary: 'Eigener Dienst für Live-Daten.',
                operations: [
                  {
                    op: 'add_block',
                    block: { id: service, position: { x: 400, y: 0 }, label: 'Echtzeit' },
                  },
                ],
              },
            ],
          },
        ]),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { id: row.id, monolith, service };
  }

  const adopt = (projectId: string, id: string, cookie: string, body?: unknown) =>
    request(`/api/projects/${projectId}/proposals/${id}/apply`, cookie, {
      method: 'POST',
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });

  it('are listed with their board and all variants', async () => {
    const owner = await test.signIn();
    const { projectId, boardId } = await createProject(owner);
    const { id } = await proposeVariants(projectId, boardId);

    const listed = (await (
      await request(`/api/projects/${projectId}/proposals`, owner)
    ).json()) as Proposal[];
    expect(listed).toMatchObject([
      {
        id,
        kind: 'variants',
        boardId,
        reason: 'variants',
        operations: [
          {
            op: 'variants',
            topic: 'Architektur',
            variants: [{ name: 'Monolith' }, { name: 'Echtzeit-Dienst' }],
          },
        ],
      },
    ]);
  });

  it('draw the adopted variant and record it as the decision with its snapshot', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const viewer = await test.signIn();
    const { projectId, boardId } = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    await addMember(projectId, viewer, 'viewer');
    const { id, monolith, service } = await proposeVariants(projectId, boardId);

    expect((await adopt(projectId, id, viewer, { variant: 1 })).status).toBe(403);
    // Which variant has to be said, and it has to exist; the proposal stays open.
    expect((await adopt(projectId, id, editor)).status).toBe(400);
    expect((await adopt(projectId, id, editor, { variant: 2 })).status).toBe(400);
    expect(await proposalRow(id)).toMatchObject({ status: 'open', chosen: null });

    const adopted = await adopt(projectId, id, editor, { variant: 1 });
    expect(adopted.status).toBe(200);
    expect((await adopted.json()) as ApplyResult).toEqual({ applied: 1, skipped: 0 });
    const board = await storedBoard(boardId);
    expect(readNodes(board)).toMatchObject([
      { id: service, label: 'Echtzeit', createdBy: { kind: 'agent', agentKey: 'moderator' } },
    ]);
    expect(readNodes(board).some((node) => node.id === monolith)).toBe(false);
    expect(await proposalRow(id)).toMatchObject({ status: 'applied', chosen: 1 });

    const decisions = (await (
      await request(`/api/projects/${projectId}/decisions`, viewer)
    ).json()) as Decision[];
    expect(decisions).toMatchObject([
      {
        topic: 'Architektur',
        status: 'decided',
        value: 'Echtzeit-Dienst',
        reasoning: 'Eigener Dienst für Live-Daten.',
        alternatives: [{ name: 'Monolith', note: 'Ein Dienst für alles.' }],
        variants: {
          chosen: 1,
          variants: [
            { name: 'Monolith', operations: [{ op: 'add_block' }] },
            { name: 'Echtzeit-Dienst', operations: [{ op: 'add_block' }] },
          ],
        },
      },
    ]);
    const log = (await (
      await request(`/api/projects/${projectId}/decisions/log`, owner)
    ).json()) as DecisionLogEntry[];
    expect(log[0]).toMatchObject({
      kind: 'decided',
      topic: 'Architektur',
      variants: { chosen: 1, variants: [{ name: 'Monolith' }, { name: 'Echtzeit-Dienst' }] },
    });

    expect((await adopt(projectId, id, owner, { variant: 0 })).status).toBe(409);
  });

  it('are removed as a whole when rejected', async () => {
    const owner = await test.signIn();
    const { projectId, boardId } = await createProject(owner);
    const { id } = await proposeVariants(projectId, boardId);

    const rejected = await request(`/api/projects/${projectId}/proposals/${id}/reject`, owner, {
      method: 'POST',
    });
    expect(rejected.status).toBe(204);
    expect(await proposalRow(id)).toMatchObject({ status: 'rejected', chosen: null });
    const decisions = (await (
      await request(`/api/projects/${projectId}/decisions`, owner)
    ).json()) as Decision[];
    expect(decisions).toEqual([]);
  });
});

describe('team proposals', () => {
  async function proposeTeam(projectId: string, agentKeys: string[]) {
    const row = await test.db.admin
      .insertInto('proposals')
      .values({
        project_id: projectId,
        board_id: null,
        kind: 'team',
        agent_key: 'moderator',
        reason: 'initiative',
        operations: JSON.stringify(
          agentKeys.map((agentKey) => ({ op: 'add_agent', agentKey, reason: 'Passt.' })),
        ),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  it('are listed with their kind and without a board', async () => {
    const owner = await test.signIn();
    const { projectId } = await createProject(owner);
    const id = await proposeTeam(projectId, ['critic']);

    const listed = (await (
      await request(`/api/projects/${projectId}/proposals`, owner)
    ).json()) as Proposal[];
    expect(listed).toEqual([
      expect.objectContaining({
        id,
        kind: 'team',
        boardId: null,
        agentKey: 'moderator',
        operations: [{ op: 'add_agent', agentKey: 'critic', reason: 'Passt.' }],
      }),
    ]);
  });

  it('add their agents to the team when applied, and everyone hears of it', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const { projectId } = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    await test.db.admin
      .insertInto('project_agents')
      .values({ project_id: projectId, agent_key: 'security' })
      .execute();
    const id = await proposeTeam(projectId, ['critic', 'security']);
    const publish = vi.spyOn(test.realtime, 'publish');

    const applied = await request(`/api/projects/${projectId}/proposals/${id}/apply`, editor, {
      method: 'POST',
    });

    expect(applied.status).toBe(200);
    expect((await applied.json()) as ApplyResult).toEqual({ applied: 1, skipped: 1 });
    const details = (await (
      await request(`/api/projects/${projectId}`, owner)
    ).json()) as ProjectDetails;
    expect(details.agents.map((agent) => agent.key)).toEqual(['moderator', 'critic', 'security']);
    expect(await proposalRow(id)).toMatchObject({ status: 'applied' });
    expect(publish).toHaveBeenCalledWith(projectId, { type: 'proposals' });
    expect(publish).toHaveBeenCalledWith(projectId, { type: 'project' });
    publish.mockRestore();
  });

  it('change nothing when rejected', async () => {
    const owner = await test.signIn();
    const { projectId } = await createProject(owner);
    const id = await proposeTeam(projectId, ['critic']);

    const rejected = await request(`/api/projects/${projectId}/proposals/${id}/reject`, owner, {
      method: 'POST',
    });

    expect(rejected.status).toBe(204);
    const details = (await (
      await request(`/api/projects/${projectId}`, owner)
    ).json()) as ProjectDetails;
    expect(details.agents.map((agent) => agent.key)).toEqual(['moderator']);
  });
});

describe('the proposals-only mode', () => {
  it('is switched by owners only and announced live', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const { projectId } = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    const publish = vi.spyOn(test.realtime, 'publish');
    const patch = (cookie: string, body: unknown) =>
      request(`/api/projects/${projectId}`, cookie, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    expect((await patch(editor, { proposalsOnly: true })).status).toBe(403);
    expect((await patch(owner, { proposalsOnly: 'yes' })).status).toBe(400);
    expect((await patch(owner, { proposalsOnly: true })).status).toBe(204);

    const details = (await (
      await request(`/api/projects/${projectId}`, editor)
    ).json()) as ProjectDetails;
    expect(details.proposalsOnly).toBe(true);
    expect(publish).toHaveBeenCalledWith(projectId, { type: 'project' });
    publish.mockRestore();
  });
});
