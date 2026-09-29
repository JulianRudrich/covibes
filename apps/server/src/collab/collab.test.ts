import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  addBlock,
  boardDocumentName,
  readNodes,
  type Author,
  type ProjectDetails,
  type ProjectSummary,
} from '@covibes/shared';
import { getRequestListener } from '@hono/node-server';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';

import { createCollab, type Collab } from '@server/collab/collab';
import { APP_URL, createTestServer } from '@server/testing';

const test = createTestServer();
let collab: Collab;
let server: Server;
let port = 0;

async function startServer() {
  collab = createCollab({ env: test.env, db: test.db, auth: test.auth });
  const listener = getRequestListener(test.app.fetch);
  server = createServer((request, response) => {
    void listener(request, response);
  });
  collab.attach(server);
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

/** Connects like a browser: session cookie and origin in the handshake. */
function connect(boardId: string, cookie: string | null, origin = APP_URL): Connected {
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
    name: boardDocumentName(boardId),
    document: doc,
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
