import { randomUUID } from 'node:crypto';

import {
  boardDocumentName,
  MAX_BOARDS_PER_PROJECT,
  type ApiErrorBody,
  type ProjectBoard,
  type ProjectDetails,
  type ProjectSummary,
} from '@covibes/shared';
import { describe, expect, it, vi } from 'vitest';

import { APP_URL, createTestServer } from '@server/testing';

const test = createTestServer();

/** Like the browser: same origin, so the CSRF protection lets bodiless changes through. */
function request(path: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  headers.set('origin', APP_URL);
  return test.app.request(path, { ...init, headers });
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

async function errorCode(response: Response) {
  return ((await response.json()) as ApiErrorBody).error.code;
}

async function createProject(cookie: string) {
  const response = await request('/api/projects', cookie, json('POST', { name: 'Boards' }));
  const projectId = ((await response.json()) as ProjectSummary).id;
  return { projectId, mainBoardId: (await boards(cookie, projectId))[0]?.id ?? '' };
}

async function boards(cookie: string, projectId: string) {
  const response = await request(`/api/projects/${projectId}`, cookie);
  return ((await response.json()) as ProjectDetails).boards;
}

function createBoard(cookie: string, projectId: string, body?: unknown) {
  return request(
    `/api/projects/${projectId}/boards`,
    cookie,
    body === undefined ? { method: 'POST' } : json('POST', body),
  );
}

function renameBoard(cookie: string, projectId: string, boardId: string, title: unknown) {
  return request(`/api/projects/${projectId}/boards/${boardId}`, cookie, json('PATCH', { title }));
}

function deleteBoard(cookie: string, projectId: string, boardId: string) {
  return request(`/api/projects/${projectId}/boards/${boardId}`, cookie, { method: 'DELETE' });
}

async function addMember(projectId: string, cookie: string, role: 'editor' | 'viewer') {
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, session.user.id, role],
  );
}

describe('creating boards', () => {
  it('answers 401 without a session', async () => {
    const response = await test.app.request(`/api/projects/${randomUUID()}/boards`, {
      method: 'POST',
      headers: { origin: APP_URL },
    });
    expect(response.status).toBe(401);
  });

  it('names new boards "Board N" with the next free number and puts them last', async () => {
    const owner = await test.signIn();
    const { projectId } = await createProject(owner);

    const first = await createBoard(owner, projectId);
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ title: 'Board 2', kind: 'extra' });
    const named = await createBoard(owner, projectId, { title: '  Datenmodell  ' });
    expect(await named.json()).toMatchObject({ title: 'Datenmodell', kind: 'extra' });
    const third = (await (await createBoard(owner, projectId, {})).json()) as ProjectBoard;
    expect(third.title).toBe('Board 3');

    expect((await boards(owner, projectId)).map((board) => board.title)).toEqual([
      'Haupt-Canvas',
      'Board 2',
      'Datenmodell',
      'Board 3',
    ]);
  });

  it('validates the title', async () => {
    const owner = await test.signIn();
    const { projectId } = await createProject(owner);
    for (const body of [{ title: '' }, { title: '   ' }, { title: 'x'.repeat(61) }, 'text']) {
      const response = await createBoard(owner, projectId, body);
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe('invalid_input');
    }
    const broken = await request(`/api/projects/${projectId}/boards`, owner, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(broken.status).toBe(400);
  });

  it(`stops at ${String(MAX_BOARDS_PER_PROJECT)} boards, the main canvas included`, async () => {
    const owner = await test.signIn();
    const { projectId } = await createProject(owner);
    // Created at the same time, so the limit must also hold for concurrent requests.
    const responses = await Promise.all(
      Array.from({ length: MAX_BOARDS_PER_PROJECT }, async () => createBoard(owner, projectId)),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(MAX_BOARDS_PER_PROJECT - 1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(1);
    const refused = responses.find((response) => response.status === 409);
    expect(refused && (await errorCode(refused))).toBe('limit_reached');
    expect(await boards(owner, projectId)).toHaveLength(MAX_BOARDS_PER_PROJECT);
  });
});

describe('roles', () => {
  it('lets editors create, rename and delete boards', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const { projectId } = await createProject(owner);
    await addMember(projectId, editor, 'editor');

    const board = (await (await createBoard(editor, projectId)).json()) as ProjectBoard;
    const renamed = await renameBoard(editor, projectId, board.id, ' Ablauf ');
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toEqual({ id: board.id, title: 'Ablauf', kind: 'extra' });
    expect((await deleteBoard(editor, projectId, board.id)).status).toBe(204);
    expect(await boards(owner, projectId)).toHaveLength(1);
  });

  it('lets viewers only look', async () => {
    const owner = await test.signIn();
    const viewer = await test.signIn();
    const { projectId } = await createProject(owner);
    await addMember(projectId, viewer, 'viewer');
    const board = (await (await createBoard(owner, projectId)).json()) as ProjectBoard;

    for (const response of [
      await createBoard(viewer, projectId),
      await renameBoard(viewer, projectId, board.id, 'Nein'),
      await deleteBoard(viewer, projectId, board.id),
    ]) {
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe('forbidden');
    }
    expect((await boards(owner, projectId)).map((entry) => entry.title)).toEqual([
      'Haupt-Canvas',
      'Board 2',
    ]);
  });

  it('hides the boards of other projects', async () => {
    const owner = await test.signIn();
    const stranger = await test.signIn();
    const { projectId } = await createProject(owner);
    const board = (await (await createBoard(owner, projectId)).json()) as ProjectBoard;
    const own = await createProject(stranger);

    for (const response of [
      await createBoard(stranger, projectId),
      await renameBoard(stranger, projectId, board.id, 'Fremd'),
      await deleteBoard(stranger, projectId, board.id),
      // A foreign board through the stranger's own project.
      await renameBoard(stranger, own.projectId, board.id, 'Fremd'),
      await deleteBoard(stranger, own.projectId, board.id),
      await deleteBoard(owner, projectId, 'not-a-uuid'),
    ]) {
      expect(response.status).toBe(404);
    }
    expect(await boards(owner, projectId)).toHaveLength(2);
  });
});

describe('the main canvas', () => {
  it('can neither be renamed nor deleted', async () => {
    const owner = await test.signIn();
    const { projectId, mainBoardId } = await createProject(owner);

    for (const response of [
      await renameBoard(owner, projectId, mainBoardId, 'Anders'),
      await deleteBoard(owner, projectId, mainBoardId),
    ]) {
      expect(response.status).toBe(403);
    }
    expect(await boards(owner, projectId)).toEqual([
      { id: mainBoardId, title: 'Haupt-Canvas', kind: 'main' },
    ]);
  });
});

describe('deleting', () => {
  it('removes the stored canvas of the board', async () => {
    const owner = await test.signIn();
    const { projectId, mainBoardId } = await createProject(owner);
    const board = (await (await createBoard(owner, projectId)).json()) as ProjectBoard;
    for (const id of [board.id, mainBoardId]) {
      await test.db.adminPool.query('insert into yjs_documents (name, state) values ($1, $2)', [
        boardDocumentName(id),
        Buffer.from([0, 0]),
      ]);
    }

    expect((await deleteBoard(owner, projectId, board.id)).status).toBe(204);

    const { rows } = await test.db.adminPool.query<{ name: string }>(
      'select name from yjs_documents where name = any($1)',
      [[boardDocumentName(board.id), boardDocumentName(mainBoardId)]],
    );
    expect(rows.map((row) => row.name)).toEqual([boardDocumentName(mainBoardId)]);
    expect((await deleteBoard(owner, projectId, board.id)).status).toBe(404);
  });
});

describe('live', () => {
  it('announces every change on the live channel of the project', async () => {
    const owner = await test.signIn();
    const viewer = await test.signIn();
    const { projectId, mainBoardId } = await createProject(owner);
    await addMember(projectId, viewer, 'viewer');
    const publish = vi.spyOn(test.realtime, 'publish');

    const board = (await (await createBoard(owner, projectId)).json()) as ProjectBoard;
    await renameBoard(owner, projectId, board.id, 'Ablauf');
    await deleteBoard(owner, projectId, board.id);
    // Refused changes are not announced.
    await createBoard(viewer, projectId);
    await renameBoard(owner, projectId, mainBoardId, 'Anders');

    expect(publish.mock.calls).toEqual([
      [projectId, { type: 'boards' }],
      [projectId, { type: 'boards' }],
      [projectId, { type: 'boards' }],
    ]);
    publish.mockRestore();
  });
});
