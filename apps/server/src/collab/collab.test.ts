import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  addBlock,
  boardDocumentName,
  nodeLocks,
  PLAN_FIELD,
  planDocumentName,
  planNodesFromMarkdown,
  planNodesToMarkdown,
  planToMarkdown,
  readNodes,
  writePlanSection,
  type Author,
  type ProjectBoard,
  type ProjectDetails,
  type ProjectSummary,
} from '@covibes/shared';
import { getRequestListener } from '@hono/node-server';
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
  WebSocketStatus,
} from '@hocuspocus/provider';
import type { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';

import { createBoardClient } from '@server/collab/board-client';
import { createCollab, type Collab } from '@server/collab/collab';
import { closedByServer, rawUpgrade, UNMASKED_FRAME } from '@server/test-sockets';
import { APP_URL, createTestServer } from '@server/testing';
import { attachWebSockets } from '@server/websockets';

const test = createTestServer();
const INTERNAL_TOKEN = 'internal-token-for-the-tests-0123456789';
let collab: Collab;
// The API on the same collaboration server as the WebSockets, as in production.
let api: Hono;
let server: Server;
let port = 0;

async function startServer() {
  collab = createCollab({ db: test.db, auth: test.auth, internalToken: INTERNAL_TOKEN });
  api = test.appWith(collab);
  const listener = getRequestListener(api.fetch);
  server = createServer((request, response) => {
    void listener(request, response);
  });
  attachWebSockets(server, {
    appUrl: test.env.APP_URL,
    routes: new Map([[test.env.COLLAB_PATH, collab.handleUpgrade]]),
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  port = (server.address() as AddressInfo).port;
}

async function stopServer() {
  await collab.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

beforeAll(startServer);
afterAll(stopServer);

const providers: HocuspocusProvider[] = [];
afterEach(() => {
  for (const provider of providers.splice(0)) provider.destroy();
});

type Connected = { doc: Y.Doc; provider: HocuspocusProvider; result: Promise<'ok' | 'denied'> };

/** Connects to a board like a browser: session cookie and origin in the handshake. */
function connect(boardId: string, cookie: string | null, origin = APP_URL): Connected {
  return connectTo(boardDocumentName(boardId), cookie, { origin });
}

/** Connects to a document by its name; the worker sends its token instead of a cookie. */
function connectTo(
  name: string,
  cookie: string | null,
  { origin = APP_URL, token }: { origin?: string; token?: string } = {},
): Connected {
  class BrowserLikeWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { origin, headers: cookie ? { cookie } : {} });
    }
  }
  const doc = new Y.Doc();
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: `ws://127.0.0.1:${String(port)}${test.env.COLLAB_PATH}`,
    WebSocketPolyfill: BrowserLikeWebSocket,
    maxAttempts: 1,
  });
  let settle: (value: 'ok' | 'denied') => void = () => undefined;
  const result = new Promise<'ok' | 'denied'>((resolve) => {
    settle = resolve;
  });
  const provider = new HocuspocusProvider({
    websocketProvider,
    name,
    document: doc,
    ...(token ? { token } : {}),
    onSynced: () => {
      settle('ok');
    },
    onAuthenticationFailed: () => {
      settle('denied');
    },
    onClose: () => {
      settle('denied');
    },
  });
  provider.attach();
  providers.push(provider);
  return { doc, provider, result };
}

async function until(check: () => boolean, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function projectWithBoard(cookie: string) {
  const created = await test.app.request('/api/projects', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Canvas' }),
  });
  const project = (await created.json()) as ProjectSummary;
  const details = (await (
    await test.app.request(`/api/projects/${project.id}`, { headers: { cookie } })
  ).json()) as ProjectDetails;
  const board = details.boards[0];
  if (!board) throw new Error('Project without board');
  return { projectId: project.id, boardId: board.id };
}

async function addMember(projectId: string, cookie: string, role: 'editor' | 'viewer') {
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, session.user.id, role],
  );
  return { kind: 'human', userId: session.user.id } satisfies Author;
}

describe('connecting to a board', () => {
  it('refuses connections without a session', async () => {
    const owner = await test.signIn();
    const { boardId } = await projectWithBoard(owner);
    expect(await connect(boardId, null).result).toBe('denied');
  });

  it('refuses people outside the project and unknown boards', async () => {
    const owner = await test.signIn();
    const stranger = await test.signIn();
    const { boardId } = await projectWithBoard(owner);
    expect(await connect(boardId, stranger).result).toBe('denied');
    expect(await connect('0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de', owner).result).toBe('denied');
  });

  it('refuses connections from other sites', async () => {
    const owner = await test.signIn();
    const { boardId } = await projectWithBoard(owner);
    expect(await connect(boardId, owner, 'https://evil.example').result).toBe('denied');
  });

  it('closes an account across board and plan documents while keeping another person connected', async () => {
    const owner = await test.signIn();
    const member = await test.signIn();
    const first = await projectWithBoard(owner);
    const second = await projectWithBoard(owner);
    const author = await addMember(first.projectId, member, 'editor');
    await addMember(second.projectId, member, 'editor');
    const board = connect(first.boardId, member);
    const anotherBoard = connect(second.boardId, member);
    const plan = connectTo(planDocumentName(first.projectId), member);
    const staying = connect(first.boardId, owner);
    expect(
      await Promise.all([board.result, anotherBoard.result, plan.result, staying.result]),
    ).toEqual(['ok', 'ok', 'ok', 'ok']);
    const closed = new Set<string>();
    board.provider.on('close', () => closed.add('board'));
    anotherBoard.provider.on('close', () => closed.add('another-board'));
    plan.provider.on('close', () => closed.add('plan'));
    let survivorClosed = false;
    staying.provider.on('close', () => {
      survivorClosed = true;
    });

    collab.closeAccount(author.userId);

    await until(() => closed.size === 3);
    expect(survivorClosed).toBe(false);
    expect(staying.provider.isSynced).toBe(true);
  });
});

describe('working together', () => {
  it('shows a new block to the other member', async () => {
    const owner = await test.signIn();
    const { projectId, boardId } = await projectWithBoard(owner);
    const editor = await test.signIn();
    const editorAuthor = await addMember(projectId, editor, 'editor');

    const a = connect(boardId, owner);
    const b = connect(boardId, editor);
    expect(await Promise.all([a.result, b.result])).toEqual(['ok', 'ok']);

    addBlock(
      b.doc,
      { id: crypto.randomUUID(), position: { x: 10, y: 20 }, label: 'Web-App' },
      editorAuthor,
    );
    await until(() => readNodes(a.doc).length === 1);
    expect(readNodes(a.doc)[0]).toMatchObject({ label: 'Web-App', createdBy: editorAuthor });
  });

  it('lets viewers read but not change', async () => {
    const owner = await test.signIn();
    const { projectId, boardId } = await projectWithBoard(owner);
    const viewer = await test.signIn();
    const viewerAuthor = await addMember(projectId, viewer, 'viewer');

    const ownerConnection = connect(boardId, owner);
    const viewerConnection = connect(boardId, viewer);
    expect(await Promise.all([ownerConnection.result, viewerConnection.result])).toEqual([
      'ok',
      'ok',
    ]);
    expect(viewerConnection.provider.authorizedScope).toBe('readonly');

    addBlock(
      ownerConnection.doc,
      { id: crypto.randomUUID(), position: { x: 0, y: 0 }, label: 'Von Owner' },
      { kind: 'agent', agentKey: 'moderator' },
    );
    await until(() => readNodes(viewerConnection.doc).length === 1);

    addBlock(
      viewerConnection.doc,
      { id: crypto.randomUUID(), position: { x: 0, y: 0 }, label: 'Von Leser' },
      viewerAuthor,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(readNodes(ownerConnection.doc).map((node) => node.label)).toEqual(['Von Owner']);
  });
});

describe('persistence', () => {
  it('keeps the canvas across a server restart', async () => {
    const owner = await test.signIn();
    const { boardId } = await projectWithBoard(owner);
    const first = connect(boardId, owner);
    expect(await first.result).toBe('ok');
    addBlock(
      first.doc,
      { id: crypto.randomUUID(), position: { x: 5, y: 5 }, label: 'Bleibt' },
      { kind: 'agent', agentKey: 'backend' },
    );
    await until(() => first.provider.unsyncedChanges === 0);

    await stopServer();
    await startServer();

    const second = connect(boardId, owner);
    expect(await second.result).toBe('ok');
    expect(readNodes(second.doc).map((node) => node.label)).toEqual(['Bleibt']);
  });
});

describe('deleting a board', () => {
  async function storedDocument(boardId: string) {
    const { rowCount } = await test.db.adminPool.query(
      'select 1 from yjs_documents where name = $1',
      [boardDocumentName(boardId)],
    );
    return rowCount === 1;
  }

  it('closes the connections and removes the canvas for good', async () => {
    const owner = await test.signIn();
    const { projectId } = await projectWithBoard(owner);
    const created = await api.request(`/api/projects/${projectId}/boards`, {
      method: 'POST',
      headers: { cookie: owner, origin: APP_URL },
    });
    expect(created.status).toBe(201);
    const board = (await created.json()) as ProjectBoard;

    const open = connect(board.id, owner);
    expect(await open.result).toBe('ok');
    let closed = false;
    open.provider.on('close', () => {
      closed = true;
    });
    addBlock(
      open.doc,
      { id: crypto.randomUUID(), position: { x: 0, y: 0 }, label: 'Weg damit' },
      { kind: 'agent', agentKey: 'backend' },
    );
    await until(() => open.provider.unsyncedChanges === 0);
    collab.hocuspocus.flushPendingStores();
    const deadline = Date.now() + 3_000;
    while (!(await storedDocument(board.id)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(await storedDocument(board.id)).toBe(true);

    // A change right before the delete would be stored after it, if nothing stopped it.
    addBlock(
      open.doc,
      { id: crypto.randomUUID(), position: { x: 300, y: 0 }, label: 'Kurz davor' },
      { kind: 'agent', agentKey: 'backend' },
    );
    await until(() => open.provider.unsyncedChanges === 0);
    const deleted = await api.request(`/api/projects/${projectId}/boards/${board.id}`, {
      method: 'DELETE',
      headers: { cookie: owner, origin: APP_URL },
    });
    expect(deleted.status).toBe(204);

    await until(() => closed);
    await until(
      () => !collab.hocuspocus.documents.has(boardDocumentName(board.id)),
      collab.hocuspocus.configuration.maxDebounce + 1_000,
    );
    expect(await storedDocument(board.id)).toBe(false);
    expect(await connect(board.id, owner).result).toBe('denied');
  });
});

describe('robustness', () => {
  it('closes a connection with a broken frame, even without a session, and keeps running', async () => {
    const raw = await rawUpgrade(port, test.env.COLLAB_PATH, { Origin: APP_URL });
    const closed = closedByServer(raw);
    raw.write(UNMASKED_FRAME);
    await closed;
    const health = await fetch(`http://127.0.0.1:${String(port)}/health`);
    expect(health.ok).toBe(true);
  });
});

describe('the worker', () => {
  function boards(token = INTERNAL_TOKEN, onPort = port) {
    return createBoardClient({
      collabUrl: `ws://127.0.0.1:${String(onPort)}${test.env.COLLAB_PATH}`,
      appUrl: APP_URL,
      token,
      timeoutMs: 5_000,
    });
  }
  const moderator: Author = { kind: 'agent', agentKey: 'moderator' };

  it('draws on a board with the internal token, and members see it live', async () => {
    const owner = await test.signIn();
    const { boardId } = await projectWithBoard(owner);
    const member = connect(boardId, owner);
    expect(await member.result).toBe('ok');

    await boards().withBoard(boardId, (doc) => {
      addBlock(doc, { id: randomUUID(), position: { x: 0, y: 0 }, label: 'API' }, moderator);
    });

    await until(() => readNodes(member.doc).some((node) => node.label === 'API'));
    expect(readNodes(member.doc)[0]?.createdBy).toEqual(moderator);
  });

  it('knows who edits which block, from the awareness of the people on the board', async () => {
    const owner = await test.signIn();
    const { boardId } = await projectWithBoard(owner);
    const member = connect(boardId, owner);
    expect(await member.result).toBe('ok');
    const blockId = randomUUID();
    member.provider.awareness?.setLocalState({
      user: { id: 'olga', name: 'Olga' },
      editing: { nodeId: blockId, since: 1 },
    });
    // Once another client sees the lock, the server has it too.
    const observer = connect(boardId, owner);
    expect(await observer.result).toBe('ok');
    await until(() =>
      nodeLocks(observer.provider.awareness?.getStates() ?? new Map()).has(blockId),
    );

    const locks = await boards().withBoard(boardId, (_, session) => session.locks());

    expect(locks.get(blockId)).toMatchObject({ name: 'Olga', userId: 'olga' });
  });

  it('is refused with a wrong token', async () => {
    const owner = await test.signIn();
    const { boardId } = await projectWithBoard(owner);

    await expect(
      boards('a-wrong-token-that-is-long-enough-000000').withBoard(boardId, () => undefined),
    ).rejects.toThrow(/refused/);
  });

  it('cannot open boards that do not exist', async () => {
    await expect(boards().withBoard(randomUUID(), () => undefined)).rejects.toThrow(/refused/);
  });

  it('gets no service access from a server without an internal token', async () => {
    const owner = await test.signIn();
    const { boardId } = await projectWithBoard(owner);
    const plain = createCollab({ db: test.db, auth: test.auth });
    const plainServer = createServer();
    attachWebSockets(plainServer, {
      appUrl: test.env.APP_URL,
      routes: new Map([[test.env.COLLAB_PATH, plain.handleUpgrade]]),
    });
    await new Promise<void>((resolve) => {
      plainServer.listen(0, '127.0.0.1', resolve);
    });
    try {
      const plainPort = (plainServer.address() as AddressInfo).port;
      await expect(
        boards(INTERNAL_TOKEN, plainPort).withBoard(boardId, () => undefined),
      ).rejects.toThrow(/refused/);
    } finally {
      await plain.close();
      plainServer.closeAllConnections();
      await new Promise((resolve) => plainServer.close(resolve));
    }
  });
});

describe('losing access (spec 21a)', () => {
  const member = (projectId: string, userId: string, cookie: string, init: RequestInit) =>
    api.request(`/api/projects/${projectId}/members/${userId}`, {
      ...init,
      headers: { cookie, origin: APP_URL, 'content-type': 'application/json' },
    });
  const disconnected = (connection: Connected) =>
    until(
      () =>
        connection.provider.configuration.websocketProvider.status === WebSocketStatus.Disconnected,
    );

  it('reconnects a board with the new rights after a role change', async () => {
    const owner = await test.signIn();
    const { projectId, boardId } = await projectWithBoard(owner);
    const viewer = await test.signIn();
    const { userId } = await addMember(projectId, viewer, 'viewer');
    const reading = connect(boardId, viewer);
    const ownerConnection = connect(boardId, owner);
    expect(await Promise.all([reading.result, ownerConnection.result])).toEqual(['ok', 'ok']);
    expect(reading.provider.authorizedScope).toBe('readonly');

    const changed = await member(projectId, userId, owner, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'editor' }),
    });
    expect(changed.status).toBe(204);

    // The server closes the connection; the browser connects again and may write now.
    await disconnected(reading);
    expect(ownerConnection.provider.configuration.websocketProvider.status).toBe(
      WebSocketStatus.Connected,
    );
    const writing = connect(boardId, viewer);
    expect(await writing.result).toBe('ok');
    expect(writing.provider.authorizedScope).toBe('read-write');
  });

  it('closes the boards of a removed member and refuses them afterwards', async () => {
    const owner = await test.signIn();
    const { projectId, boardId } = await projectWithBoard(owner);
    const editor = await test.signIn();
    const { userId } = await addMember(projectId, editor, 'editor');
    const working = connect(boardId, editor);
    expect(await working.result).toBe('ok');

    const removed = await member(projectId, userId, owner, { method: 'DELETE' });
    expect(removed.status).toBe(204);

    await disconnected(working);
    expect(await connect(boardId, editor).result).toBe('denied');
  });
});

describe('the plan of a project (spec 25a)', () => {
  const plan = (projectId: string, cookie: string | null) =>
    connectTo(planDocumentName(projectId), cookie);

  /** Writes a paragraph the way the editor stores it. */
  function write(doc: Y.Doc, text: string) {
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText(text)]);
    doc.getXmlFragment(PLAN_FIELD).push([paragraph]);
  }

  /** The plan as the XML the shared document holds. */
  const textOf = (doc: Y.Doc) => doc.getXmlFragment(PLAN_FIELD).toJSON();

  it('is written together by the members and kept across a restart', async () => {
    const owner = await test.signIn();
    const { projectId } = await projectWithBoard(owner);
    const editor = await test.signIn();
    await addMember(projectId, editor, 'editor');
    const a = plan(projectId, owner);
    const b = plan(projectId, editor);
    expect(await Promise.all([a.result, b.result])).toEqual(['ok', 'ok']);

    write(b.doc, 'Erste Version: Mitgliederliste');
    await until(() => textOf(a.doc).includes('Mitgliederliste'));
    await until(() => b.provider.unsyncedChanges === 0);

    await stopServer();
    await startServer();

    const again = plan(projectId, owner);
    expect(await again.result).toBe('ok');
    expect(textOf(again.doc)).toBe('<paragraph>Erste Version: Mitgliederliste</paragraph>');
  });

  it('is read but not changed by viewers', async () => {
    const owner = await test.signIn();
    const { projectId } = await projectWithBoard(owner);
    const viewer = await test.signIn();
    await addMember(projectId, viewer, 'viewer');
    const writing = plan(projectId, owner);
    const reading = plan(projectId, viewer);
    expect(await Promise.all([writing.result, reading.result])).toEqual(['ok', 'ok']);
    expect(reading.provider.authorizedScope).toBe('readonly');

    write(writing.doc, 'Vom Owner');
    await until(() => textOf(reading.doc).includes('Vom Owner'));
    write(reading.doc, 'Vom Leser');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(textOf(writing.doc)).toBe('<paragraph>Vom Owner</paragraph>');
  });

  it('is closed to everyone outside the project', async () => {
    const owner = await test.signIn();
    const stranger = await test.signIn();
    const { projectId } = await projectWithBoard(owner);

    expect(await plan(projectId, null).result).toBe('denied');
    expect(await plan(projectId, stranger).result).toBe('denied');
    expect(await plan('0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de', owner).result).toBe('denied');
    expect(await connectTo(`plan:${projectId}:x`, owner).result).toBe('denied');
    expect(await connectTo(`notes:${projectId}`, owner).result).toBe('denied');
  });

  it('opens for the worker with the internal token, for projects that exist', async () => {
    const owner = await test.signIn();
    const { projectId } = await projectWithBoard(owner);
    const member = plan(projectId, owner);
    const worker = connectTo(planDocumentName(projectId), null, { token: INTERNAL_TOKEN });
    expect(await Promise.all([member.result, worker.result])).toEqual(['ok', 'ok']);

    write(worker.doc, 'Vom Moderator');
    await until(() => textOf(member.doc).includes('Vom Moderator'));

    expect(
      await connectTo(planDocumentName(randomUUID()), null, { token: INTERNAL_TOKEN }).result,
    ).toBe('denied');
    expect(
      await connectTo(planDocumentName(projectId), null, { token: 'wrong-token' }).result,
    ).toBe('denied');
  });

  it('closes for a member who is removed, like the boards', async () => {
    const owner = await test.signIn();
    const { projectId } = await projectWithBoard(owner);
    const editor = await test.signIn();
    const { userId } = await addMember(projectId, editor, 'editor');
    const working = plan(projectId, editor);
    expect(await working.result).toBe('ok');

    const removed = await api.request(`/api/projects/${projectId}/members/${userId}`, {
      method: 'DELETE',
      headers: { cookie: owner, origin: APP_URL },
    });
    expect(removed.status).toBe(204);

    await until(
      () =>
        working.provider.configuration.websocketProvider.status === WebSocketStatus.Disconnected,
    );
    expect(await plan(projectId, editor).result).toBe('denied');
  });
});

describe('reading and following the plan (spec 26a)', () => {
  const moderator: Author = { kind: 'agent', agentKey: 'moderator' };
  const milestonesOf = async (projectId: string) =>
    planNodesToMarkdown((await collab.readPlanSections(projectId)).milestones ?? []);

  function writeMilestones(doc: Y.Doc, markdown: string) {
    writePlanSection(doc, 'milestones', planNodesFromMarkdown(markdown), 'de');
  }

  it('reads the sections of the stored plan without opening it', async () => {
    const owner = await test.signIn();
    const { projectId } = await projectWithBoard(owner);
    expect(await collab.readPlanSections(projectId)).toEqual({});

    await collab.changePlan(projectId, (doc) => {
      writeMilestones(doc, '### Meilenstein 1: Grundgerüst (2 Wochen)');
    });

    expect(await milestonesOf(projectId)).toBe('### Meilenstein 1: Grundgerüst (2 Wochen)');
    expect(collab.hocuspocus.documents.has(planDocumentName(projectId))).toBe(false);
  });

  it('reads what people write right now while they have the plan open', async () => {
    const owner = await test.signIn();
    const { projectId } = await projectWithBoard(owner);
    const writing = connectTo(planDocumentName(projectId), owner);
    expect(await writing.result).toBe('ok');

    writeMilestones(writing.doc, '### Meilenstein 1: Gerade geschrieben');
    await until(() => writing.provider.unsyncedChanges === 0);

    expect(await milestonesOf(projectId)).toBe('### Meilenstein 1: Gerade geschrieben');
  });

  it('tells who follows the plan once it is stored, and stores it even when that fails', async () => {
    const owner = await test.signIn();
    const { projectId, boardId } = await projectWithBoard(owner);
    const seen: { projectId: string; plan: string }[] = [];
    const following = createCollab({
      db: test.db,
      auth: test.auth,
      onPlanStored: (storedProjectId, doc) => {
        seen.push({ projectId: storedProjectId, plan: planToMarkdown(doc) });
      },
    });
    try {
      await following.changePlan(projectId, (doc) => {
        writeMilestones(doc, '### Meilenstein 1: Grundgerüst');
      });
      expect(seen).toEqual([
        { projectId, plan: expect.stringContaining('### Meilenstein 1: Grundgerüst') as unknown },
      ]);
      // A board is no plan.
      await following.changeBoard({ boardId, projectId }, (doc) => {
        addBlock(doc, { id: randomUUID(), position: { x: 0, y: 0 }, label: 'API' }, moderator);
      });
      expect(seen).toHaveLength(1);
    } finally {
      await following.close();
    }

    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing = createCollab({
      db: test.db,
      auth: test.auth,
      onPlanStored: () => {
        throw new Error('The announcement failed');
      },
    });
    try {
      await failing.changePlan(projectId, (doc) => {
        writeMilestones(doc, '### Meilenstein 1: Trotzdem gespeichert');
      });
      expect(errors).toHaveBeenCalledWith('Following a stored plan failed', expect.any(Error));
    } finally {
      errors.mockRestore();
      await failing.close();
    }
    expect(await milestonesOf(projectId)).toBe('### Meilenstein 1: Trotzdem gespeichert');
  });
});
