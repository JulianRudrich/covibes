import { randomUUID } from 'node:crypto';

import {
  addBlock,
  updateNode,
  type ChatMessage,
  type ProjectBoard,
  type ProjectSummary,
} from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { projectBoardIds, referencesOf, type BoardReader } from '@server/chat/references';
import { createTestServer } from '@server/testing';

// What a person's message refers to on the canvas (spec 37a): names in square brackets, which
// the server matches to elements of the project's boards when the message is posted.
const test = createTestServer();

function request(path: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  if (init.body) headers.set('content-type', 'application/json');
  return test.app.request(path, { ...init, headers });
}

async function userIdOf(cookie: string) {
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  return session.user.id;
}

async function createProject() {
  const owner = await test.signIn();
  const created = await request('/api/projects', owner, {
    method: 'POST',
    body: JSON.stringify({ name: 'Verweise' }),
  });
  const projectId = ((await created.json()) as ProjectSummary).id;
  const mainBoardId = (await projectBoardIds(test.db.admin, projectId))[0] ?? '';
  const ownerId = await userIdOf(owner);

  /** Puts a block on a board, made by the owner or by an agent. */
  async function block(
    label: string,
    options: { boardId?: string; agent?: string; position?: { x: number; y: number } } = {},
  ) {
    const id = randomUUID();
    await test.collab.changeBoard({ boardId: options.boardId ?? mainBoardId, projectId }, (doc) => {
      addBlock(
        doc,
        { id, blockType: 'service', position: options.position ?? { x: 0, y: 0 }, label },
        options.agent
          ? { kind: 'agent', agentKey: options.agent }
          : { kind: 'human', userId: ownerId },
      );
    });
    return id;
  }

  async function addBoard(title: string) {
    const response = await request(`/api/projects/${projectId}/boards`, owner, {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
    return ((await response.json()) as ProjectBoard).id;
  }

  async function send(content: string, cookie = owner) {
    const response = await request(`/api/projects/${projectId}/messages`, cookie, {
      method: 'POST',
      body: JSON.stringify({ id: randomUUID(), content }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as ChatMessage;
  }

  async function listed() {
    const response = await request(`/api/projects/${projectId}/messages`, owner);
    return (await response.json()) as ChatMessage[];
  }

  return { owner, ownerId, projectId, mainBoardId, block, addBoard, send, listed };
}

describe('a message that names an element of the canvas', () => {
  it('refers to the element of that name, with who made it', async () => {
    const project = await createProject();
    const gateway = await project.block('AI-Gateway', { agent: 'moderator' });
    const app = await project.block('Web-App');

    const message = await project.send('Wie hängt die [Web-App] am [ai-gateway]?');

    expect(message.references).toEqual([
      { label: 'Web-App', boardId: project.mainBoardId, nodeId: app, by: { kind: 'human' } },
      {
        label: 'ai-gateway',
        boardId: project.mainBoardId,
        nodeId: gateway,
        by: { kind: 'agent', agentKey: 'moderator' },
      },
    ]);
    // The text stays as it was written.
    expect(message.content).toBe('Wie hängt die [Web-App] am [ai-gateway]?');
    // Nobody learns from a reference which person made the element.
    expect(JSON.stringify(message.references)).not.toContain(project.ownerId);
  });

  it('keeps its references for everyone who loads the chat later', async () => {
    const project = await createProject();
    const app = await project.block('Web-App');
    const sent = await project.send('Siehe [Web-App].');

    const [loaded] = await project.listed();

    expect(loaded?.references).toEqual(sent.references);
    expect(loaded?.references?.[0]?.nodeId).toBe(app);
  });

  it('finds an element on any board of the project, the main canvas first', async () => {
    const project = await createProject();
    const flow = await project.addBoard('Ablauf');
    const onMain = await project.block('Datenbank');
    await project.block('Datenbank', { boardId: flow });
    const step = await project.block('Anmelden', { boardId: flow });

    const message = await project.send('[Datenbank] und [Anmelden]');

    expect(message.references?.map((found) => [found.boardId, found.nodeId])).toEqual([
      [project.mainBoardId, onMain],
      [flow, step],
    ]);
  });

  it('leaves a name no element has, and a Markdown link, as text', async () => {
    const project = await createProject();
    await project.block('Web-App');

    const message = await project.send(
      'Das [Backend] fehlt noch, siehe [Web-App](https://example.com/web).',
    );

    expect(message).not.toHaveProperty('references');
    expect(message.content).toContain('[Backend]');
  });

  it('refers to nothing of another project', async () => {
    const project = await createProject();
    const other = await createProject();
    await other.block('Geheimer Dienst');

    const message = await project.send('Was macht der [Geheimer Dienst]?');

    expect(message).not.toHaveProperty('references');
  });

  it('keeps leading to its element after the element is renamed', async () => {
    const project = await createProject();
    const app = await project.block('Web-App');
    const sent = await project.send('Siehe [Web-App].');

    await test.collab.changeBoard(
      { boardId: project.mainBoardId, projectId: project.projectId },
      (doc) => {
        updateNode(doc, app, { label: 'Portal' }, { kind: 'human', userId: project.ownerId });
      },
    );

    const [loaded] = await project.listed();
    // The message keeps the name it was written with, and the element it meant.
    expect(loaded?.references).toEqual(sent.references);
    expect(loaded?.references?.[0]).toMatchObject({ label: 'Web-App', nodeId: app });
    // A new message finds the element by its new name.
    expect((await project.send('[Portal]')).references?.[0]?.nodeId).toBe(app);
    expect(await project.send('[Web-App]')).not.toHaveProperty('references');
  });

  it('holds at most 20 references', async () => {
    const project = await createProject();
    const names = Array.from({ length: 23 }, (_, index) => `Block ${String(index + 1)}`);
    for (const name of names) await project.block(name);

    const message = await project.send(names.map((name) => `[${name}]`).join(' '));

    expect(message.references).toHaveLength(20);
  });
});

describe('referencesOf', () => {
  const BOARD = randomUUID();

  it('reads no board for a text without a name in square brackets', async () => {
    const read: BoardReader = () => Promise.reject(new Error('must not be read'));

    expect(await referencesOf('Hallo Team, wie weit sind wir?', [BOARD], read)).toEqual([]);
    expect(await referencesOf('[Doku](https://example.com)', [BOARD], read)).toEqual([]);
  });

  it('stores the message all the same when a board cannot be read', async () => {
    const read: BoardReader = () => Promise.reject(new Error('gone'));

    expect(await referencesOf('Siehe [Web-App].', [BOARD], read)).toEqual([]);
  });
});
