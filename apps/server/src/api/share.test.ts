import { randomUUID } from 'node:crypto';

import {
  addBlock,
  addNote,
  boardDocumentName,
  NO_USER_ID,
  type ApiErrorBody,
  type CreatedShareLink,
  type ProjectDetails,
  type ProjectSummary,
  type SharedBoard,
  type SharedProject,
  type ShareLinkStatus,
} from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { shareViewRoutes } from '@server/api/share';
import { createRateLimiter } from '@server/rate-limit';
import { APP_URL, createTestServer } from '@server/testing';

// The read-only link (spec 21b).
const test = createTestServer();

function request(path: string, cookie: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  headers.set('origin', APP_URL);
  if (typeof init.body === 'string') headers.set('content-type', 'application/json');
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

async function addMember(projectId: string, cookie: string, role: 'editor' | 'viewer') {
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, (await userOf(cookie)).id, role],
  );
}

async function createProject(cookie: string, name = 'Vereins-App') {
  const created = await request('/api/projects', cookie, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  const projectId = ((await created.json()) as ProjectSummary).id;
  const details = (await (
    await request(`/api/projects/${projectId}`, cookie)
  ).json()) as ProjectDetails;
  const boardId = details.boards[0]?.id ?? '';
  return { projectId, boardId };
}

const linkPath = (projectId: string) => `/api/projects/${projectId}/share-link`;

async function createLink(cookie: string, projectId: string) {
  const response = await request(linkPath(projectId), cookie, { method: 'POST' });
  expect(response.status).toBe(201);
  const created = (await response.json()) as CreatedShareLink;
  return { ...created, token: created.url.split('/share/')[1] ?? '' };
}

async function statusOf(cookie: string, projectId: string) {
  const response = await request(linkPath(projectId), cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as ShareLinkStatus;
}

// Visitors have no session.
const view = (token: string) =>
  request('/api/share/view', null, { method: 'POST', body: JSON.stringify({ token }) });

const board = (token: string, boardId: string) =>
  request('/api/share/board', null, { method: 'POST', body: JSON.stringify({ token, boardId }) });

describe('the read-only link of a project', () => {
  it('is created by an owner, shown once and seen by every member', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const { projectId } = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    expect(await statusOf(owner, projectId)).toEqual({ active: false, createdAt: null });

    const created = await createLink(owner, projectId);

    expect(created.url).toMatch(new RegExp(`^${APP_URL}/share/[A-Za-z0-9_-]{43}$`));
    const status = await statusOf(editor, projectId);
    expect(status).toEqual({ active: true, createdAt: created.createdAt });
    // Nothing the server tells later contains the link.
    expect(JSON.stringify(status)).not.toContain(created.token);
    expect((await view(created.token)).status).toBe(200);
  });

  it('is replaced and removed by owners only', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const stranger = await test.signIn();
    const { projectId } = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    const first = await createLink(owner, projectId);

    expect((await request(linkPath(projectId), editor, { method: 'POST' })).status).toBe(403);
    expect((await request(linkPath(projectId), editor, { method: 'DELETE' })).status).toBe(403);
    for (const method of ['GET', 'POST', 'DELETE']) {
      expect((await request(linkPath(projectId), stranger, { method })).status, method).toBe(404);
      expect((await request(linkPath(projectId), null, { method })).status, method).toBe(401);
    }

    // A new link replaces the one before, which stops working at once.
    const second = await createLink(owner, projectId);
    expect(second.token).not.toBe(first.token);
    expect((await view(first.token)).status).toBe(404);
    expect((await view(second.token)).status).toBe(200);

    expect((await request(linkPath(projectId), owner, { method: 'DELETE' })).status).toBe(204);
    expect((await view(second.token)).status).toBe(404);
    expect(await statusOf(owner, projectId)).toEqual({ active: false, createdAt: null });
    const again = await request(linkPath(projectId), owner, { method: 'DELETE' });
    expect(again.status).toBe(404);
    expect(await errorOf(again)).toBe('not_found');
  });
});

describe('the read-only view', () => {
  it('shows the boards, decisions and criteria of the project, and no chat', async () => {
    const owner = await test.signIn(`olga-${randomUUID()}@example.com`);
    const { id: ownerId, name: ownerName } = await userOf(owner);
    const { projectId, boardId } = await createProject(owner, 'Sportverein');
    await request(`/api/projects/${projectId}/boards`, owner, {
      method: 'POST',
      body: JSON.stringify({ title: 'Ablauf' }),
    });
    await request(`/api/projects/${projectId}/criteria`, owner, {
      method: 'POST',
      body: JSON.stringify({ text: 'Kleines Budget' }),
    });
    await test.db.adminPool.query(
      // One after the other: decisions are listed in the order they came up.
      `insert into decisions
         (project_id, topic, status, value, reasoning, decided_by, decided_at, created_at)
       values ($1, 'Datenbank', 'decided', 'PostgreSQL', 'Bewährt und frei.', $2, now(), now()),
              ($1, 'Hosting', 'open', null, '', null, null, now() + interval '1 second')`,
      [projectId, ownerId],
    );
    await request(`/api/projects/${projectId}/messages`, owner, {
      method: 'POST',
      body: JSON.stringify({ id: randomUUID(), content: 'Das bleibt unter uns.' }),
    });
    const agent = await test.db.adminPool.query<{ id: string }>(
      `insert into custom_agents (owner_id, project_id, name, role, instructions, color)
       values ($1, $2, 'Jurist ' || $3, 'Recht', 'Geheime Anweisung', 3) returning id`,
      [ownerId, projectId, randomUUID().slice(0, 8)],
    );
    const { token } = await createLink(owner, projectId);

    const response = await view(token);

    expect(response.status).toBe(200);
    const shared = (await response.json()) as SharedProject;
    expect(shared).toMatchObject({
      name: 'Sportverein',
      boards: [
        { id: boardId, title: 'Haupt-Canvas', kind: 'main' },
        { title: 'Ablauf', kind: 'extra' },
      ],
      criteria: [{ text: 'Kleines Budget' }],
      decisions: [
        {
          topic: 'Datenbank',
          status: 'decided',
          value: 'PostgreSQL',
          reasoning: 'Bewährt und frei.',
          // Not who confirmed it.
          decidedBy: null,
        },
        { topic: 'Hosting', status: 'open', value: null },
      ],
      customAgents: [
        {
          key: agent.rows[0]?.id,
          color: 3,
          role: '',
          ownerId: NO_USER_ID,
          ownerName: '',
        },
      ],
    });
    // No person, no message and no instruction is anywhere in the answer.
    const text = JSON.stringify(shared);
    for (const secret of [ownerId, ownerName, 'Das bleibt unter uns.', 'Geheime Anweisung']) {
      expect(text).not.toContain(secret);
    }
  });

  it('shows a board with its content and without the people who drew it', async () => {
    const owner = await test.signIn();
    const { id: ownerId } = await userOf(owner);
    const { projectId, boardId } = await createProject(owner);
    const blockId = randomUUID();
    const noteId = randomUUID();
    await test.collab.changeBoard({ boardId, projectId }, (doc) => {
      addBlock(
        doc,
        { id: blockId, position: { x: 40, y: 40 }, label: 'API', subtitle: 'REST' },
        { kind: 'human', userId: ownerId },
      );
      addNote(
        doc,
        { id: noteId, position: { x: 400, y: 40 }, text: 'Offene Frage' },
        { kind: 'agent', agentKey: 'moderator' },
      );
    });
    const { token } = await createLink(owner, projectId);

    const response = await board(token, boardId);

    expect(response.status).toBe(200);
    const content = (await response.json()) as SharedBoard;
    const nobody = { kind: 'human', userId: NO_USER_ID };
    expect(content.nodes.find((node) => node.id === blockId)).toMatchObject({
      type: 'block',
      label: 'API',
      subtitle: 'REST',
      createdBy: nobody,
      lastChangedBy: nobody,
    });
    // Agents are part of the plan and keep their name.
    expect(content.nodes.find((node) => node.id === noteId)).toMatchObject({
      type: 'sticky',
      label: 'Offene Frage',
      createdBy: { kind: 'agent', agentKey: 'moderator' },
    });
    expect(content.edges).toEqual([]);
    expect(JSON.stringify(content)).not.toContain(ownerId);
  });

  it('shows what is on a board right now while people work on it', async () => {
    const owner = await test.signIn();
    const { projectId, boardId } = await createProject(owner);
    const { token } = await createLink(owner, projectId);
    // Nothing was ever drawn: the board is empty, not missing.
    expect((await (await board(token, boardId)).json()) as SharedBoard).toEqual({
      nodes: [],
      edges: [],
    });

    const working = await test.collab.hocuspocus.openDirectConnection(boardDocumentName(boardId), {
      user: { id: 'service', name: 'Covibes', role: 'editor' },
      boardId,
      projectId,
    });
    try {
      await working.transact((doc) => {
        addBlock(
          doc,
          { id: randomUUID(), position: { x: 0, y: 0 }, label: 'Gerade gezeichnet' },
          { kind: 'agent', agentKey: 'backend' },
        );
      });

      const content = (await (await board(token, boardId)).json()) as SharedBoard;
      expect(content.nodes.map((node) => node.label)).toEqual(['Gerade gezeichnet']);
    } finally {
      await working.disconnect();
    }
  });

  it('shows nothing with a wrong link, and no board of another project', async () => {
    const owner = await test.signIn();
    const shared = await createProject(owner);
    const secret = await createProject(owner, 'Geheim');
    const { token } = await createLink(owner, shared.projectId);

    for (const wrong of ['A'.repeat(43), 'kurz', '']) {
      expect((await view(wrong)).status, wrong).toBe(404);
      expect((await board(wrong, shared.boardId)).status, wrong).toBe(404);
    }
    expect((await board(token, secret.boardId)).status).toBe(404);
    expect((await board(token, randomUUID())).status).toBe(404);
    expect((await board(token, 'kein-board')).status).toBe(404);
    expect(
      (await request('/api/share/view', null, { method: 'POST', body: 'kein json' })).status,
    ).toBe(404);
    // The link opens no other door: the API of the project still needs a session.
    expect((await request(`/api/projects/${shared.projectId}`, null)).status).toBe(401);
  });

  it('answers a link only so often per minute', async () => {
    const owner = await test.signIn();
    const { projectId, boardId } = await createProject(owner);
    const { token } = await createLink(owner, projectId);
    const routes = shareViewRoutes(
      test.db.app,
      test.collab,
      createRateLimiter({ limit: 2, windowMs: 60_000 }),
    );
    const ask = (path: string, body: Record<string, unknown>) =>
      routes.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    expect((await ask('/view', { token })).status).toBe(200);
    expect((await ask('/board', { token, boardId })).status).toBe(200);
    expect((await ask('/view', { token })).status).toBe(429);
    expect((await ask('/board', { token, boardId })).status).toBe(429);
  });
});
