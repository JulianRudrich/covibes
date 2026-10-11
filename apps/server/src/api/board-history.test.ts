import { randomUUID } from 'node:crypto';

import {
  addBlock,
  addEdge,
  addNote,
  boardDocumentName,
  moveNodes,
  removeNodes,
  updateNode,
  type Author,
  type BoardHistory,
  type BoardHistoryUndo,
  type ProjectDetails,
  type ProjectSummary,
} from '@covibes/shared';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { createBoardHistory } from '@server/collab/board-history';
import { withUser } from '@server/db/database';
import { APP_URL, createTestServer } from '@server/testing';

// The history of a board (spec 38): what the server writes when a board is stored, what members
// read of it, and taking an entry back.
const test = createTestServer();
const MODERATOR: Author = { kind: 'agent', agentKey: 'moderator' };

function request(path: string, cookie: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  if (init.body) headers.set('content-type', 'application/json');
  // What changes something comes from the app itself.
  if (init.method === 'POST') headers.set('origin', APP_URL);
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
    body: JSON.stringify({ name: 'Verlauf' }),
  });
  const projectId = ((await created.json()) as ProjectSummary).id;
  const details = (await (
    await request(`/api/projects/${projectId}`, owner)
  ).json()) as ProjectDetails;
  const boardId = details.boards[0]?.id ?? '';
  const ownerId = await userIdOf(owner);
  await test.db.adminPool.query('update users set name = $1 where id = $2', ['Olga', ownerId]);
  return {
    owner,
    ownerId,
    projectId,
    boardId,
    history: `/api/projects/${projectId}/boards/${boardId}/history`,
  };
}

async function member(projectId: string, role: 'editor' | 'viewer', name: string) {
  const cookie = await test.signIn();
  const id = await userIdOf(cookie);
  await test.db.adminPool.query('update users set name = $1 where id = $2', [name, id]);
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, id, role],
  );
  return { cookie, id };
}

async function historyOf(path: string, cookie: string) {
  const response = await request(path, cookie);
  expect(response.status).toBe(200);
  return ((await response.json()) as BoardHistory).entries;
}

const block = (label: string, position = { x: 0, y: 0 }) => ({
  id: randomUUID(),
  blockType: 'service' as const,
  position,
  label,
});

/**
 * A board as the collaboration server holds it, with the recorder that is told what happens to
 * it: who sent a change, and when the board was stored. The clock is the test's.
 */
function openBoard(boardId: string) {
  const doc = new Y.Doc();
  const clock = { now: new Date() };
  const changed = vi.fn();
  const recorder = createBoardHistory({
    adminPool: test.db.adminPool,
    onChanged: changed,
    now: () => clock.now,
  });
  recorder.loaded(boardId, doc);
  return {
    doc,
    changed,
    /** A person changes the board; their change arrives at the server. */
    by: (user: { id: string; name: string }, change: (doc: Y.Doc, author: Author) => void) => {
      change(doc, { kind: 'human', userId: user.id });
      recorder.changed(boardId, doc, user);
    },
    /** The server changes the board for an agent. */
    agent: (change: (doc: Y.Doc) => void) => {
      change(doc);
      recorder.changed(boardId, doc, 'service');
    },
    stored: () => recorder.stored(boardId, doc),
    later: (seconds: number) => {
      clock.now = new Date(clock.now.getTime() + seconds * 1000);
    },
  };
}

describe('the history of a board', () => {
  it('records what an agent drew as one entry, arrows by what they connect', async () => {
    const project = await createProject();
    const board = openBoard(project.boardId);
    const web = block('Web-App');
    const api = block('API', { x: 300, y: 0 });

    board.agent((doc) => {
      addBlock(doc, web, MODERATOR);
      addBlock(doc, api, MODERATOR);
      addEdge(doc, { id: randomUUID(), source: web.id, target: api.id }, MODERATOR);
    });
    await board.stored();

    const entries = await historyOf(project.history, project.owner);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actor).toEqual({ kind: 'agent', agentKey: 'moderator' });
    expect(entries[0]?.items.map((item) => [item.kind, item.label, item.action])).toEqual([
      ['block', 'Web-App', 'added'],
      ['block', 'API', 'added'],
      ['edge', 'Web-App → API', 'added'],
    ]);
    expect(board.changed).toHaveBeenCalledExactlyOnceWith(project.projectId, project.boardId);
  });

  it('records what people do, each under their name, the newest first', async () => {
    const project = await createProject();
    const alex = await member(project.projectId, 'editor', 'Alex');
    const board = openBoard(project.boardId);
    const api = block('API');

    board.by({ id: project.ownerId, name: 'Olga' }, (doc, author) => {
      addBlock(doc, api, author);
    });
    await board.stored();
    board.later(5);
    board.by({ id: alex.id, name: 'Alex' }, (doc, author) => {
      moveNodes(doc, [[api.id, { x: 400, y: 120 }]], author);
    });
    await board.stored();

    const entries = await historyOf(project.history, project.owner);
    expect(entries.map((entry) => [entry.actor, entry.items.map((item) => item.action)])).toEqual([
      [{ kind: 'human', userId: alex.id, name: 'Alex' }, ['moved']],
      [{ kind: 'human', userId: project.ownerId, name: 'Olga' }, ['added']],
    ]);
  });

  it('attributes a removed element to who removed it', async () => {
    const project = await createProject();
    const alex = await member(project.projectId, 'editor', 'Alex');
    const board = openBoard(project.boardId);
    const drawn = block('Gateway');
    board.agent((doc) => {
      addBlock(doc, drawn, MODERATOR);
    });
    await board.stored();
    board.later(5);

    // Two people are at work; Alex removes the moderator's block.
    board.by({ id: project.ownerId, name: 'Olga' }, (doc, author) => {
      addNote(doc, { id: randomUUID(), position: { x: 0, y: 300 }, text: 'Offene Frage' }, author);
    });
    board.by({ id: alex.id, name: 'Alex' }, (doc, author) => {
      removeNodes(doc, [drawn.id], author);
    });
    await board.stored();

    const [first, second] = await historyOf(project.history, project.owner);
    const byName = new Map(
      [first, second].map((entry) => [
        entry?.actor.kind === 'human' ? entry.actor.name : '',
        entry?.items.map((item) => `${item.label}: ${item.action}`),
      ]),
    );
    expect(byName.get('Alex')).toEqual(['Gateway: removed']);
    expect(byName.get('Olga')).toEqual(['Offene Frage: added']);
  });

  it('lets an entry grow while its author goes on within a minute', async () => {
    const project = await createProject();
    const board = openBoard(project.boardId);
    const olga = { id: project.ownerId, name: 'Olga' };
    const api = block('API');

    board.by(olga, (doc, author) => {
      addBlock(doc, api, author);
    });
    await board.stored();
    board.later(20);
    board.by(olga, (doc, author) => {
      updateNode(doc, api.id, { label: 'Schnittstelle' }, author);
      addBlock(doc, block('Web-App', { x: 300, y: 0 }), author);
    });
    await board.stored();

    const entries = await historyOf(project.history, project.owner);
    expect(entries).toHaveLength(1);
    // The block was added by this entry, under the name it ended with.
    expect(entries[0]?.items.map((item) => `${item.label}: ${item.action}`)).toEqual([
      'Schnittstelle: added',
      'Web-App: added',
    ]);
    expect(board.changed).toHaveBeenCalledTimes(2);
  });

  it('starts a new entry after a minute, and when someone else was in between', async () => {
    const project = await createProject();
    const board = openBoard(project.boardId);
    const olga = { id: project.ownerId, name: 'Olga' };
    const add = (label: string) => {
      board.by(olga, (doc, author) => {
        addBlock(doc, block(label), author);
      });
      return board.stored();
    };

    await add('Eins');
    board.later(61);
    await add('Zwei');
    board.later(5);
    board.agent((doc) => {
      addBlock(doc, block('Vom Moderator'), MODERATOR);
    });
    await board.stored();
    board.later(5);
    await add('Drei');

    const entries = await historyOf(project.history, project.owner);
    expect(entries.map((entry) => entry.items.map((item) => item.label))).toEqual([
      ['Drei'],
      ['Vom Moderator'],
      ['Zwei'],
      ['Eins'],
    ]);
  });

  it('forgets an entry whose author put everything back', async () => {
    const project = await createProject();
    const board = openBoard(project.boardId);
    const olga = { id: project.ownerId, name: 'Olga' };
    const note = { id: randomUUID(), position: { x: 0, y: 0 }, text: 'Versehen' };

    board.by(olga, (doc, author) => {
      addNote(doc, note, author);
    });
    await board.stored();
    board.later(3);
    board.by(olga, (doc, author) => {
      removeNodes(doc, [note.id], author);
    });
    await board.stored();

    expect(await historyOf(project.history, project.owner)).toEqual([]);
  });

  it('writes nothing for a board that was stored unchanged', async () => {
    const project = await createProject();
    const board = openBoard(project.boardId);

    await board.stored();

    expect(await historyOf(project.history, project.owner)).toEqual([]);
    expect(board.changed).not.toHaveBeenCalled();
  });

  it('says which elements of an entry are still on the board', async () => {
    const project = await createProject();
    const kept = block('Bleibt');
    const gone = block('Geht', { x: 300, y: 0 });
    // Through the collaboration server, as an agent's tools change a board.
    await test.collab.changeBoard(
      { boardId: project.boardId, projectId: project.projectId },
      (doc) => {
        addBlock(doc, kept, MODERATOR);
        addBlock(doc, gone, MODERATOR);
      },
    );
    await test.collab.recordHistory(project.boardId);
    await test.collab.changeBoard(
      { boardId: project.boardId, projectId: project.projectId },
      (doc) => {
        removeNodes(doc, [gone.id], MODERATOR);
      },
    );
    await test.collab.recordHistory(project.boardId);

    const entries = await historyOf(project.history, project.owner);

    const added = entries.find((entry) => entry.items.some((item) => item.action === 'added'));
    expect(added?.items.map((item) => [item.label, item.present])).toEqual([
      ['Bleibt', true],
      ['Geht', false],
    ]);
    // What the element was is the server's to keep, not the list's to show.
    expect(JSON.stringify(entries)).not.toContain('"before"');
  });

  it('keeps entries for 30 days and at most 200 per board', async () => {
    const project = await createProject();
    const item = {
      id: randomUUID(),
      kind: 'block',
      label: 'Alt',
      action: 'removed',
      before: null,
      after: null,
    };
    const insert = (count: number, age: string) =>
      test.db.adminPool.query(
        `insert into board_changes (project_id, board_id, actor_kind, items, created_at, updated_at)
         select $1, $2, 'unknown', $3::jsonb, now() - $4::interval - (n || ' seconds')::interval,
                now() - $4::interval - (n || ' seconds')::interval
         from generate_series(1, $5::int) n`,
        [project.projectId, project.boardId, JSON.stringify([item]), age, count],
      );
    await insert(3, '31 days');
    await insert(210, '1 day');
    const board = openBoard(project.boardId);

    board.agent((doc) => {
      addBlock(doc, block('Neu'), MODERATOR);
    });
    await board.stored();

    const stored = await test.db.adminPool.query<{ count: string; oldest: Date }>(
      'select count(*) as count, min(updated_at) as oldest from board_changes where board_id = $1',
      [project.boardId],
    );
    expect(Number(stored.rows[0]?.count)).toBe(200);
    expect(Date.now() - (stored.rows[0]?.oldest.getTime() ?? 0)).toBeLessThan(2 * 24 * 60 * 60_000);
  });

  it('is read by every member of the project, and by nobody else', async () => {
    const project = await createProject();
    const viewer = await member(project.projectId, 'viewer', 'Vera');
    const stranger = await test.signIn();
    const other = await createProject();
    const board = openBoard(project.boardId);
    board.agent((doc) => {
      addBlock(doc, block('API'), MODERATOR);
    });
    await board.stored();

    expect(await historyOf(project.history, viewer.cookie)).toHaveLength(1);
    expect((await request(project.history, null)).status).toBe(401);
    expect((await request(project.history, stranger)).status).toBe(404);
    // A board is found under its own project only.
    expect(
      (
        await request(
          `/api/projects/${other.projectId}/boards/${project.boardId}/history`,
          other.owner,
        )
      ).status,
    ).toBe(404);
    expect(
      (await request(`/api/projects/${project.projectId}/boards/nope/history`, project.owner))
        .status,
    ).toBe(404);
    expect(await historyOf(other.history, other.owner)).toEqual([]);
  });

  it('is written by the server only: no member adds, changes or removes an entry', async () => {
    const project = await createProject();
    const board = openBoard(project.boardId);
    board.agent((doc) => {
      addBlock(doc, block('API'), MODERATOR);
    });
    await board.stored();
    const asOwner = <T>(run: Parameters<typeof withUser<T>>[2]) =>
      withUser(test.db.app, project.ownerId, run);
    const denied = { code: '42501' };

    await expect(
      asOwner((trx) =>
        trx
          .insertInto('board_changes')
          .values({
            project_id: project.projectId,
            board_id: project.boardId,
            actor_kind: 'unknown',
            items: JSON.stringify([{ id: randomUUID() }]),
          })
          .execute(),
      ),
    ).rejects.toMatchObject(denied);
    await expect(
      asOwner((trx) => trx.updateTable('board_changes').set({ actor_name: 'x' }).execute()),
    ).rejects.toMatchObject(denied);
    await expect(asOwner((trx) => trx.deleteFrom('board_changes').execute())).rejects.toMatchObject(
      denied,
    );
    expect(await historyOf(project.history, project.owner)).toHaveLength(1);
  });

  it('keeps the name of a person who left, and goes with the board when it is deleted', async () => {
    const project = await createProject();
    const alex = await member(project.projectId, 'editor', 'Alex');
    const board = openBoard(project.boardId);
    board.by({ id: alex.id, name: 'Alex' }, (doc, author) => {
      addBlock(doc, block('API'), author);
    });
    await board.stored();

    await test.db.adminPool.query('delete from users where id = $1', [alex.id]);

    const [entry] = await historyOf(project.history, project.owner);
    expect(entry?.actor).toEqual({ kind: 'human', userId: null, name: 'Alex' });

    await test.db.adminPool.query('delete from projects where id = $1', [project.projectId]);
    const left = await test.db.adminPool.query('select 1 from board_changes where board_id = $1', [
      project.boardId,
    ]);
    expect(left.rowCount).toBe(0);
  });
});

type Project = Awaited<ReturnType<typeof createProject>>;

/** Changes a board through the collaboration server, as tools do, and writes its history. */
async function draw(project: Project, change: (doc: Y.Doc) => void) {
  await test.collab.changeBoard({ boardId: project.boardId, projectId: project.projectId }, change);
  await test.collab.recordHistory(project.boardId);
}

/** What the moderator draws to start with: two blocks and the arrow between them. */
async function drawn(project: Project) {
  const web = block('Web-App');
  const api = block('API', { x: 300, y: 0 });
  const line = { id: randomUUID(), source: web.id, target: api.id };
  await draw(project, (doc) => {
    addBlock(doc, web, MODERATOR);
    addBlock(doc, api, MODERATOR);
    addEdge(doc, line, MODERATOR);
  });
  return { web, api, line };
}

async function undo(project: Project, entryId: string | undefined, cookie: string) {
  return request(`${project.history}/${entryId ?? ''}/undo`, cookie, { method: 'POST' });
}

async function outcomeOf(response: Response) {
  expect(response.status).toBe(200);
  return (await response.json()) as BoardHistoryUndo;
}

/** The board as it is: what is on it, by id, with what tells one state from another. */
async function boardOf(project: Project) {
  const { nodes, edges } = await test.collab.readBoard(project.boardId);
  return {
    nodes: new Map(nodes.map((node) => [node.id, node])),
    edges: new Map(edges.map((edge) => [edge.id, edge])),
  };
}

describe('taking an entry back', () => {
  it('removes what an agent drew, as a new entry by the person who took it back', async () => {
    const project = await createProject();
    await drawn(project);
    const [entry] = await historyOf(project.history, project.owner);
    expect(entry).toMatchObject({ reverts: false, undone: null, canUndo: true });

    const outcome = await outcomeOf(await undo(project, entry?.id, project.owner));

    expect(outcome).toEqual({ reverted: 3, kept: 0 });
    const board = await boardOf(project);
    expect(board.nodes.size + board.edges.size).toBe(0);
    const [taking, taken, ...rest] = await historyOf(project.history, project.owner);
    expect(rest).toEqual([]);
    expect(taking).toMatchObject({
      actor: { kind: 'human', userId: project.ownerId, name: 'Olga' },
      reverts: true,
      undone: null,
      canUndo: true,
    });
    expect(taking?.items.map((item) => [item.label, item.action, item.present])).toEqual([
      ['Web-App', 'removed', false],
      ['API', 'removed', false],
      ['Web-App → API', 'removed', false],
    ]);
    expect(taken).toMatchObject({
      id: entry?.id,
      actor: { kind: 'agent', agentKey: 'moderator' },
      reverts: false,
      undone: { by: 'Olga', reverted: 3, kept: 0 },
      canUndo: false,
    });
    expect(Date.parse(taken?.undone?.at ?? '')).not.toBeNaN();
  });

  it('brings back what was removed and sets back what was moved or changed', async () => {
    const project = await createProject();
    const alex = await member(project.projectId, 'editor', 'Alex');
    const author: Author = { kind: 'human', userId: alex.id };
    const { web, api, line } = await drawn(project);
    const before = await boardOf(project);
    // Alex moves one block and renames the other; then the renamed one is removed.
    await draw(project, (doc) => {
      moveNodes(doc, [[web.id, { x: 0, y: 300 }]], author);
      updateNode(doc, api.id, { label: 'Schnittstelle' }, author);
    });
    await draw(project, (doc) => {
      removeNodes(doc, [api.id], author);
    });
    const [removal, change] = await historyOf(project.history, project.owner);
    expect(removal?.items.map((item) => item.action)).toEqual(['removed', 'removed']);
    expect(change?.items.map((item) => item.action)).toEqual(['moved', 'changed']);

    // The removal first: the block is back as it was removed, with its arrow.
    expect(await outcomeOf(await undo(project, removal?.id, project.owner))).toEqual({
      reverted: 2,
      kept: 0,
    });
    const restored = await boardOf(project);
    expect(restored.nodes.get(api.id)).toMatchObject({
      label: 'Schnittstelle',
      createdBy: MODERATOR,
      lastChangedBy: { kind: 'human', userId: project.ownerId },
    });
    expect(restored.edges.get(line.id)).toMatchObject({ source: web.id, target: api.id });

    // Then what Alex changed: the board is as the moderator drew it.
    expect(await outcomeOf(await undo(project, change?.id, project.owner))).toEqual({
      reverted: 2,
      kept: 0,
    });
    const after = await boardOf(project);
    expect(after.nodes.get(web.id)?.position).toEqual(before.nodes.get(web.id)?.position);
    expect(after.nodes.get(api.id)?.label).toBe('API');
    expect([...after.nodes.keys()].sort()).toEqual([...before.nodes.keys()].sort());
    expect([...after.edges.keys()]).toEqual([line.id]);
  });

  it('leaves alone what was changed since, and says how many stayed', async () => {
    const project = await createProject();
    const alex = await member(project.projectId, 'editor', 'Alex');
    const { web, api, line } = await drawn(project);
    const [entry] = await historyOf(project.history, project.owner);
    // Alex builds on it: the API gets another name. Its arrow hangs on a block that stays.
    await draw(project, (doc) => {
      updateNode(doc, api.id, { label: 'Gateway' }, { kind: 'human', userId: alex.id });
    });

    const outcome = await outcomeOf(await undo(project, entry?.id, project.owner));

    // The arrow goes; the renamed block stays, and so the other block it would leave alone goes.
    expect(outcome).toEqual({ reverted: 2, kept: 1 });
    const board = await boardOf(project);
    expect([...board.nodes.keys()]).toEqual([api.id]);
    expect(board.nodes.get(api.id)?.label).toBe('Gateway');
    expect(board.edges.has(line.id)).toBe(false);
    expect(board.nodes.has(web.id)).toBe(false);
    const entries = await historyOf(project.history, project.owner);
    expect(entries.find((candidate) => candidate.id === entry?.id)?.undone).toMatchObject({
      by: 'Olga',
      reverted: 2,
      kept: 1,
    });
    // Taken back once is taken back.
    const again = await undo(project, entry?.id, project.owner);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: 'already_decided' } });
  });

  it('takes nothing back while nothing is as the entry left it, and can be tried again', async () => {
    const project = await createProject();
    const alex = await member(project.projectId, 'editor', 'Alex');
    const author: Author = { kind: 'human', userId: alex.id };
    const api = block('API');
    await draw(project, (doc) => {
      addBlock(doc, api, MODERATOR);
    });
    const [entry] = await historyOf(project.history, project.owner);
    await draw(project, (doc) => {
      updateNode(doc, api.id, { label: 'Gateway' }, author);
    });

    expect(await outcomeOf(await undo(project, entry?.id, project.owner))).toEqual({
      reverted: 0,
      kept: 1,
    });

    // Nothing happened: no new entry, and the entry is not taken back.
    const entries = await historyOf(project.history, project.owner);
    expect(entries).toHaveLength(2);
    expect(entries.every((candidate) => candidate.undone === null && !candidate.reverts)).toBe(
      true,
    );
    expect((await boardOf(project)).nodes.get(api.id)?.label).toBe('Gateway');

    // Alex gives the block its name back; now the entry can be taken back.
    await draw(project, (doc) => {
      updateNode(doc, api.id, { label: 'API' }, author);
    });
    expect(await outcomeOf(await undo(project, entry?.id, alex.cookie))).toEqual({
      reverted: 1,
      kept: 0,
    });
    expect((await boardOf(project)).nodes.size).toBe(0);
  });

  it('can be taken back itself, which brings the change back', async () => {
    const project = await createProject();
    const alex = await member(project.projectId, 'editor', 'Alex');
    const { web, api, line } = await drawn(project);
    const [entry] = await historyOf(project.history, project.owner);
    await outcomeOf(await undo(project, entry?.id, project.owner));
    const [taking] = await historyOf(project.history, project.owner);

    const outcome = await outcomeOf(await undo(project, taking?.id, alex.cookie));

    expect(outcome).toEqual({ reverted: 3, kept: 0 });
    const board = await boardOf(project);
    expect([...board.nodes.keys()].sort()).toEqual([web.id, api.id].sort());
    expect([...board.edges.keys()]).toEqual([line.id]);
    // The moderator's elements are the moderator's again, brought back by Alex.
    expect(board.nodes.get(api.id)).toMatchObject({
      createdBy: MODERATOR,
      lastChangedBy: { kind: 'human', userId: alex.id },
    });
    const [again, first, original] = await historyOf(project.history, project.owner);
    expect(again).toMatchObject({
      actor: { kind: 'human', userId: alex.id, name: 'Alex' },
      reverts: true,
      undone: null,
      canUndo: true,
    });
    expect(again?.items.map((item) => [item.action, item.present])).toEqual([
      ['added', true],
      ['added', true],
      ['added', true],
    ]);
    expect(first).toMatchObject({ id: taking?.id, undone: { by: 'Alex' }, canUndo: false });
    // What was taken back first stays taken back; the way on is the newest entry.
    expect(original).toMatchObject({ id: entry?.id, undone: { by: 'Olga' }, canUndo: false });
  });

  it('writes what others did meanwhile as theirs, apart from the taking back', async () => {
    const project = await createProject();
    const alex = await member(project.projectId, 'editor', 'Alex');
    await drawn(project);
    const [entry] = await historyOf(project.history, project.owner);
    // Alex has the board open and adds a note that is not stored yet.
    const open = await test.collab.hocuspocus.openDirectConnection(
      boardDocumentName(project.boardId),
      {
        user: { id: alex.id, name: 'Alex', role: 'editor' },
        boardId: project.boardId,
        projectId: project.projectId,
      },
    );
    try {
      if (!open.document) throw new Error('The board is not open');
      addNote(
        open.document,
        { id: randomUUID(), position: { x: 0, y: 400 }, text: 'Offene Frage' },
        { kind: 'human', userId: alex.id },
      );

      expect(await outcomeOf(await undo(project, entry?.id, project.owner))).toEqual({
        reverted: 3,
        kept: 0,
      });
    } finally {
      await open.disconnect();
    }

    const entries = await historyOf(project.history, project.owner);
    const by = (name: string) =>
      entries.filter(
        (candidate) => candidate.actor.kind === 'human' && candidate.actor.name === name,
      );
    expect(by('Alex').map((candidate) => [candidate.reverts, candidate.items])).toEqual([
      [false, [expect.objectContaining({ label: 'Offene Frage', action: 'added' })]],
    ]);
    expect(by('Olga')).toHaveLength(1);
    expect(by('Olga')[0]).toMatchObject({ reverts: true });
    expect(by('Olga')[0]?.items.map((item) => item.action)).toEqual([
      'removed',
      'removed',
      'removed',
    ]);
  });

  it('touches nothing that someone is editing', async () => {
    const project = await createProject();
    const api = block('API');
    const other = block('Web-App', { x: 300, y: 0 });
    await draw(project, (doc) => {
      addBlock(doc, api, MODERATOR);
      addBlock(doc, other, MODERATOR);
    });
    const [entry] = await historyOf(project.history, project.owner);
    // Sam edits the block: the lock lives in the awareness of the board.
    const editing = await test.collab.hocuspocus.openDirectConnection(
      boardDocumentName(project.boardId),
      {
        user: { id: 'sam', name: 'Sam', role: 'editor' },
        boardId: project.boardId,
        projectId: project.projectId,
      },
    );
    editing.document?.awareness.setLocalState({
      user: { id: 'sam', name: 'Sam' },
      editing: { nodeId: api.id, since: Date.now() },
    });
    try {
      expect(await outcomeOf(await undo(project, entry?.id, project.owner))).toEqual({
        reverted: 1,
        kept: 1,
      });
    } finally {
      editing.document?.awareness.setLocalState(null);
      await editing.disconnect();
    }

    expect([...(await boardOf(project)).nodes.keys()]).toEqual([api.id]);
  });

  it('is for owners and editors, and only for an entry of the board', async () => {
    const project = await createProject();
    const viewer = await member(project.projectId, 'viewer', 'Vera');
    const stranger = await test.signIn();
    const other = await createProject();
    await drawn(project);
    await drawn(other);
    const [entry] = await historyOf(project.history, project.owner);
    const [foreign] = await historyOf(other.history, other.owner);

    // A viewer reads the history and is offered nothing to take back.
    expect((await historyOf(project.history, viewer.cookie))[0]).toMatchObject({ canUndo: false });
    expect((await undo(project, entry?.id, viewer.cookie)).status).toBe(403);
    expect((await undo(project, entry?.id, stranger)).status).toBe(404);
    expect(
      (await request(`${project.history}/${entry?.id ?? ''}/undo`, null, { method: 'POST' }))
        .status,
    ).toBe(401);
    // An entry is found under its own board only.
    expect((await undo(project, foreign?.id, project.owner)).status).toBe(404);
    expect((await undo(other, entry?.id, other.owner)).status).toBe(404);
    expect((await undo(project, randomUUID(), project.owner)).status).toBe(404);
    expect((await undo(project, 'nope', project.owner)).status).toBe(404);

    // Nothing of it changed a board or its history.
    expect((await boardOf(project)).nodes.size).toBe(2);
    expect((await boardOf(other)).nodes.size).toBe(2);
    expect(await historyOf(project.history, project.owner)).toHaveLength(1);
    expect((await historyOf(project.history, project.owner))[0]?.undone).toBeNull();
  });

  it('keeps the name of who took an entry back, and outlives the entry it took back', async () => {
    const project = await createProject();
    const alex = await member(project.projectId, 'editor', 'Alex');
    await drawn(project);
    const [entry] = await historyOf(project.history, project.owner);
    await outcomeOf(await undo(project, entry?.id, alex.cookie));

    await test.db.adminPool.query('delete from users where id = $1', [alex.id]);

    const [taking, taken] = await historyOf(project.history, project.owner);
    expect(taken?.undone).toMatchObject({ by: 'Alex' });
    expect(taking).toMatchObject({ actor: { kind: 'human', userId: null, name: 'Alex' } });

    // Once the entry that was taken back is gone, the taking back is an entry like any other.
    await test.db.adminPool.query('delete from board_changes where id = $1', [entry?.id]);
    const [left, ...rest] = await historyOf(project.history, project.owner);
    expect(rest).toEqual([]);
    expect(left).toMatchObject({ id: taking?.id, reverts: false, undone: null, canUndo: true });
  });
});
