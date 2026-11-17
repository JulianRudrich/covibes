import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { LIVE_PATH, type LiveEvent, type ProjectSummary } from '@covibes/shared';
import { getRequestListener } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import {
  closedByServer,
  rawUpgrade,
  resetDuringUpgrade,
  UNMASKED_FRAME,
} from '@server/test-sockets';
import { APP_URL, createTestServer } from '@server/testing';
import { attachWebSockets } from '@server/websockets';

const test = createTestServer();
let server: Server;
let port = 0;

beforeAll(async () => {
  const listener = getRequestListener(test.app.fetch);
  server = createServer((request, response) => {
    void listener(request, response);
  });
  attachWebSockets(server, {
    appUrl: test.env.APP_URL,
    routes: new Map([[LIVE_PATH, test.realtime.handleUpgrade]]),
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  test.realtime.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

type Opened = { socket: WebSocket; events: LiveEvent[] };

/** Opens the live channel like a browser; resolves with the socket or the refusal status. */
function open(projectId: string, cookie: string | null, origin = APP_URL) {
  return new Promise<Opened | number>((resolve) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${String(port)}${LIVE_PATH}?project=${projectId}`,
      { origin, headers: cookie ? { cookie } : {} },
    );
    const events: LiveEvent[] = [];
    socket.on('message', (data: Buffer) => {
      events.push(JSON.parse(data.toString()) as LiveEvent);
    });
    socket.on('open', () => {
      resolve({ socket, events });
    });
    socket.on('unexpected-response', (_request, response) => {
      resolve(response.statusCode ?? 0);
    });
    socket.on('error', () => {
      resolve(0);
    });
  });
}

async function createProject(cookie: string) {
  const response = await test.app.request('/api/projects', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Live' }),
  });
  return ((await response.json()) as ProjectSummary).id;
}

async function healthy() {
  const response = await fetch(`http://127.0.0.1:${String(port)}/health`);
  return response.ok;
}

async function addMember(projectId: string, cookie: string, role: 'editor' | 'viewer') {
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, session.user.id, role],
  );
}

async function until(check: () => boolean, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('live channel', () => {
  it('delivers new messages to every open connection of the project', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    const first = await open(projectId, owner);
    const second = await open(projectId, owner);
    if (typeof first === 'number' || typeof second === 'number') throw new Error('not opened');

    const id = randomUUID();
    await test.app.request(`/api/projects/${projectId}/messages`, {
      method: 'POST',
      headers: { cookie: owner, 'content-type': 'application/json' },
      body: JSON.stringify({ id, content: 'Hello live' }),
    });

    await until(() => first.events.length === 1 && second.events.length === 1);
    expect(first.events[0]).toMatchObject({
      type: 'message',
      message: { id, content: 'Hello live' },
    });
    first.socket.close();
    second.socket.close();
  });

  it('keeps projects apart', async () => {
    const owner = await test.signIn();
    const listening = await createProject(owner);
    const other = await createProject(owner);
    const opened = await open(listening, owner);
    if (typeof opened === 'number') throw new Error('not opened');

    test.realtime.publish(other, {
      type: 'message',
      message: {
        id: randomUUID(),
        projectId: other,
        author: { kind: 'agent', agentKey: 'moderator' },
        content: 'elsewhere',
        mentions: [],
        replyTo: null,
        status: 'complete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(opened.events).toEqual([]);
    opened.socket.close();
  });

  it('refuses connections without a session', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    expect(await open(projectId, null)).toBe(401);
  });

  it('refuses strangers, unknown projects and malformed ids alike', async () => {
    const owner = await test.signIn();
    const stranger = await test.signIn();
    const projectId = await createProject(owner);
    expect(await open(projectId, stranger)).toBe(404);
    expect(await open(randomUUID(), owner)).toBe(404);
    expect(await open('not-a-uuid', owner)).toBe(404);
  });

  it('refuses other origins, even with a valid session', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    expect(await open(projectId, owner, 'https://evil.example')).toBe(403);
  });

  it('refuses more than 20 open connections of one person', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    const sockets: WebSocket[] = [];
    for (let count = 0; count < 20; count += 1) {
      const opened = await open(projectId, owner);
      if (typeof opened === 'number') throw new Error(`refused: ${String(opened)}`);
      sockets.push(opened.socket);
    }

    expect(await open(projectId, owner)).toBe(429);
    for (const socket of sockets) socket.close();
  });

  it('forgets closed connections', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    const opened = await open(projectId, owner);
    if (typeof opened === 'number') throw new Error('not opened');
    expect(test.realtime.connectionCount(projectId)).toBe(1);

    opened.socket.close();
    await until(() => test.realtime.connectionCount(projectId) === 0);
  });

  it('delivers messages to every member, viewers included', async () => {
    const owner = await test.signIn();
    const viewer = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, viewer, 'viewer');
    const writing = await open(projectId, owner);
    const reading = await open(projectId, viewer);
    if (typeof writing === 'number' || typeof reading === 'number') throw new Error('not opened');

    await test.app.request(`/api/projects/${projectId}/messages`, {
      method: 'POST',
      headers: { cookie: owner, 'content-type': 'application/json' },
      body: JSON.stringify({ id: randomUUID(), content: 'For everyone' }),
    });

    await until(() => reading.events.length === 1 && writing.events.length === 1);
    expect(reading.events[0]).toMatchObject({ message: { content: 'For everyone' } });
    writing.socket.close();
    reading.socket.close();
  });
});

describe('robustness', () => {
  it('closes a connection with a broken frame and keeps running', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    const raw = await rawUpgrade(port, `${LIVE_PATH}?project=${projectId}`, {
      Origin: APP_URL,
      Cookie: owner,
    });
    const closed = closedByServer(raw);
    raw.write(UNMASKED_FRAME);
    await closed;
    expect(await healthy()).toBe(true);
  });

  it('closes a connection that sends too much and keeps running', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    const opened = await open(projectId, owner);
    if (typeof opened === 'number') throw new Error('not opened');
    const closeCode = new Promise<number>((resolve) => {
      opened.socket.on('close', (code: number) => {
        resolve(code);
      });
    });

    opened.socket.send('x'.repeat(32 * 1024));

    expect(await closeCode).toBe(1009);
    expect(await healthy()).toBe(true);
  });

  it('survives connections reset during the access check', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    // A slow session check makes sure the reset arrives while the server is still checking.
    const getSession = test.auth.api.getSession;
    const slowed = vi.spyOn(test.auth.api, 'getSession').mockImplementation(async (context) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return getSession(context);
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await resetDuringUpgrade(
        port,
        `${LIVE_PATH}?project=${projectId}`,
        { Origin: APP_URL, Cookie: owner },
        50,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    slowed.mockRestore();
    expect(await healthy()).toBe(true);
  });
});

describe('losing access (spec 21a)', () => {
  async function userIdOf(cookie: string) {
    const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
    if (!session) throw new Error('No session');
    return session.user.id;
  }

  it('closes the connections of a removed member, after telling them to load the project again', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    const ownerLive = await open(projectId, owner);
    const editorLive = await open(projectId, editor);
    const secondTab = await open(projectId, editor);
    if (
      typeof ownerLive === 'number' ||
      typeof editorLive === 'number' ||
      typeof secondTab === 'number'
    ) {
      throw new Error('not opened');
    }
    const closed = (socket: WebSocket) =>
      new Promise<number>((resolve) => {
        socket.on('close', (code: number) => {
          resolve(code);
        });
      });
    const codes = Promise.all([closed(editorLive.socket), closed(secondTab.socket)]);

    const removed = await test.app.request(
      `/api/projects/${projectId}/members/${await userIdOf(editor)}`,
      { method: 'DELETE', headers: { cookie: owner, origin: APP_URL } },
    );
    expect(removed.status).toBe(204);

    expect(await codes).toEqual([4403, 4403]);
    expect(editorLive.events).toContainEqual({ type: 'project' });
    expect(secondTab.events).toContainEqual({ type: 'project' });
    // The others stay connected, and the removed member does not get back in.
    expect(ownerLive.socket.readyState).toBe(WebSocket.OPEN);
    // Client close events can arrive before the server removes the sockets from the channel.
    await until(() => test.realtime.connectionCount(projectId) === 1);
    expect(test.realtime.connectionCount(projectId)).toBe(1);
    expect(await open(projectId, editor)).toBe(404);
    ownerLive.socket.close();
  });

  it('keeps the live connection of a member whose role changed', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    const editorLive = await open(projectId, editor);
    if (typeof editorLive === 'number') throw new Error('not opened');

    const changed = await test.app.request(
      `/api/projects/${projectId}/members/${await userIdOf(editor)}`,
      {
        method: 'PATCH',
        headers: { cookie: owner, origin: APP_URL, 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'viewer' }),
      },
    );
    expect(changed.status).toBe(204);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(editorLive.socket.readyState).toBe(WebSocket.OPEN);
    editorLive.socket.close();
  });
});
