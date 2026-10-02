import { randomUUID } from 'node:crypto';

import {
  addBlock,
  addNote,
  awaySummarySchema,
  type ApiErrorBody,
  type Author,
  type AwaySummary,
  type CanvasEdge,
  type CanvasNode,
  type ProjectDetails,
  type ProjectSeen,
  type ProjectSummary,
} from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { boardChanges } from '@server/api/away';
import { APP_URL, createTestServer } from '@server/testing';

// "Since you were away" (spec 23): what the summary lists for someone who comes back.
const test = createTestServer();

function request(path: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  headers.set('origin', APP_URL);
  if (typeof init.body === 'string') headers.set('content-type', 'application/json');
  return test.app.request(path, { ...init, headers });
}

async function person(name: string) {
  const cookie = await test.signIn();
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  await test.db.adminPool.query('update users set name = $1 where id = $2', [
    name,
    session.user.id,
  ]);
  return { cookie, id: session.user.id };
}

async function createProject(cookie: string) {
  const created = await request('/api/projects', cookie, {
    method: 'POST',
    body: JSON.stringify({ name: 'Vereins-App' }),
  });
  const projectId = ((await created.json()) as ProjectSummary).id;
  const details = (await (
    await request(`/api/projects/${projectId}`, cookie)
  ).json()) as ProjectDetails;
  return { projectId, boardId: details.boards[0]?.id ?? '' };
}

async function addMember(projectId: string, userId: string, role: 'editor' | 'viewer') {
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, userId, role],
  );
}

async function say(cookie: string, projectId: string, content: string) {
  const response = await request(`/api/projects/${projectId}/messages`, cookie, {
    method: 'POST',
    body: JSON.stringify({ id: randomUUID(), content }),
  });
  expect(response.status).toBe(201);
}

/** Reports the project as open; true if the person is back from an absence. */
async function open(cookie: string, projectId: string): Promise<boolean> {
  const response = await request(`/api/projects/${projectId}/seen`, cookie, { method: 'POST' });
  expect(response.status).toBe(200);
  return ((await response.json()) as ProjectSeen).returned;
}

/** Moves the person's last visit into the past. */
async function lastSeen(projectId: string, userId: string, ago: string) {
  await test.db.adminPool.query(
    `update member_activity set last_seen_at = now() - $3::interval
     where project_id = $1 and user_id = $2`,
    [projectId, userId, ago],
  );
}

async function awayOf(cookie: string, projectId: string): Promise<AwaySummary | null> {
  const response = await request(`/api/projects/${projectId}/away`, cookie);
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  return body === null ? null : awaySummarySchema.parse(body);
}

/** A project of Olga with Alex as editor, who opened it once and has been away for two hours. */
async function projectWithAbsence() {
  const olga = await person('Olga');
  const alex = await person('Alex Berg');
  const { projectId, boardId } = await createProject(olga.cookie);
  await addMember(projectId, alex.id, 'editor');
  expect(await open(alex.cookie, projectId)).toBe(false);
  // The project is older than the absence, so its first board is no news.
  await test.db.adminPool.query(
    `update boards set created_at = now() - interval '1 day' where project_id = $1`,
    [projectId],
  );
  await lastSeen(projectId, alex.id, '2 hours');
  return { olga, alex, projectId, boardId };
}

describe('the summary of an absence', () => {
  it('lists the decisions, criteria, boards and messages of the time away', async () => {
    const { olga, alex, projectId, boardId } = await projectWithAbsence();
    // Before Alex left: none of this is news.
    await test.db.adminPool.query(
      `insert into messages (project_id, author_kind, author_user_id, content, created_at)
       values ($1, 'human', $2, 'Von gestern', now() - interval '5 hours')`,
      [projectId, olga.id],
    );
    await test.db.adminPool.query(
      `insert into decision_log (project_id, kind, topic, value, created_at)
       values ($1, 'decided', 'Sprache', 'TypeScript', now() - interval '5 hours')`,
      [projectId],
    );

    // While Alex was away.
    await say(olga.cookie, projectId, 'Ich nehme React Flow, einverstanden?');
    await say(olga.cookie, projectId, '@Alex-Berg schau dir bitte das Datenmodell an.');
    await test.db.adminPool.query(
      `insert into messages (project_id, author_kind, author_agent_key, content)
       values ($1, 'agent', 'moderator', 'Ich halte das fest.')`,
      [projectId],
    );
    const decision = await test.db.adminPool.query<{ id: string }>(
      `insert into decisions (project_id, topic, status, value, decided_at)
       values ($1, 'Canvas', 'decided', 'tldraw', now()) returning id`,
      [projectId],
    );
    const decisionId = decision.rows[0]?.id ?? '';
    await test.db.adminPool.query(
      `insert into decision_log (project_id, kind, decision_id, topic, value) values
        ($1, 'reopened', $2, 'Canvas', 'tldraw'),
        ($1, 'decided', $2, 'Canvas', 'React Flow'),
        ($1, 'opened', null, 'Hosting', null)`,
      [projectId, decisionId],
    );
    const criterion = await request(`/api/projects/${projectId}/criteria`, olga.cookie, {
      method: 'POST',
      body: JSON.stringify({ text: 'Günstig im Betrieb' }),
    });
    expect(criterion.status).toBe(201);
    await test.collab.changeBoard({ boardId, projectId }, (doc) => {
      const at = (x: number) => ({ x, y: 40 });
      const byOlga: Author = { kind: 'human', userId: olga.id };
      addBlock(doc, { id: randomUUID(), position: at(40), label: 'API', subtitle: '' }, byOlga);
      addBlock(doc, { id: randomUUID(), position: at(300), label: 'Web', subtitle: '' }, byOlga);
      addNote(
        doc,
        { id: randomUUID(), position: at(600), text: 'Offen' },
        { kind: 'agent', agentKey: 'moderator' },
      );
      // What Alex drew is no news to Alex.
      addBlock(
        doc,
        { id: randomUUID(), position: at(900), label: 'Meins', subtitle: '' },
        { kind: 'human', userId: alex.id },
      );
    });
    // Two versions of the plan were kept meanwhile, one long before (spec 25c).
    await test.db.adminPool.query(
      `insert into plan_versions (project_id, number, content, reason, created_at) values
        ($1, 1, '[]', 'generated', now() - interval '5 hours'),
        ($1, 2, '[]', 'manual', now()),
        ($1, 3, '[]', 'updated', now())`,
      [projectId],
    );
    const extra = await test.db.adminPool.query<{ id: string }>(
      `insert into boards (project_id, title, kind, position)
       values ($1, 'Datenmodell', 'extra', 1) returning id`,
      [projectId],
    );

    expect(await open(alex.cookie, projectId)).toBe(true);
    const summary = await awayOf(alex.cookie, projectId);

    expect(summary).toMatchObject({
      text: null,
      textStatus: 'none',
      // The decision shows as it stood in the end; a topic that was only opened is no decision.
      decisions: [{ kind: 'decided', decisionId, topic: 'Canvas', value: 'React Flow' }],
      criteriaChanges: 1,
      planVersions: 2,
      boards: [
        {
          boardId,
          isNew: false,
          changed: 3,
          by: [
            { kind: 'human', name: 'Olga' },
            { kind: 'agent', agentKey: 'moderator' },
          ],
          authors: 2,
        },
        { boardId: extra.rows[0]?.id, title: 'Datenmodell', isNew: true, changed: 0, by: [] },
      ],
      messages: {
        count: 3,
        mentions: 1,
        by: [
          { kind: 'human', name: 'Olga' },
          { kind: 'agent', agentKey: 'moderator' },
        ],
        authors: 2,
      },
    });
    const hours =
      (Date.parse(summary?.until ?? '') - Date.parse(summary?.since ?? '')) / (60 * 60_000);
    expect(hours).toBeCloseTo(2, 1);

    // Olga was there all along, and what came after the return is not part of it.
    expect(await open(olga.cookie, projectId)).toBe(false);
    expect(await awayOf(olga.cookie, projectId)).toBeNull();
    await say(olga.cookie, projectId, 'Schön, dass du wieder da bist.');
    expect((await awayOf(alex.cookie, projectId))?.messages.count).toBe(3);
  });

  it('is nothing when nothing happened, on a first visit and for a stranger', async () => {
    const { olga, alex, projectId } = await projectWithAbsence();
    const stranger = await person('Sam');

    expect(await awayOf(olga.cookie, projectId)).toBeNull();
    expect(await open(alex.cookie, projectId)).toBe(true);
    expect(await awayOf(alex.cookie, projectId)).toBeNull();

    expect(await open(stranger.cookie, projectId)).toBe(false);
    expect(await awayOf(stranger.cookie, projectId)).toBeNull();
    const closed = await request(`/api/projects/${projectId}/away/dismiss`, stranger.cookie, {
      method: 'POST',
    });
    expect(closed.status).toBe(404);
    expect(((await closed.json()) as ApiErrorBody).error.code).toBe('not_found');
  });

  it('needs a session', async () => {
    const { projectId } = await projectWithAbsence();

    expect((await test.app.request(`/api/projects/${projectId}/away`)).status).toBe(401);
    const closed = await test.app.request(`/api/projects/${projectId}/away/dismiss`, {
      method: 'POST',
      headers: { origin: APP_URL },
    });
    expect(closed.status).toBe(401);
  });

  it('stays closed once the person closed it, until the next return', async () => {
    const { olga, alex, projectId } = await projectWithAbsence();
    await say(olga.cookie, projectId, 'Erste Neuigkeit');
    await open(alex.cookie, projectId);
    expect((await awayOf(alex.cookie, projectId))?.messages.count).toBe(1);

    const closed = await request(`/api/projects/${projectId}/away/dismiss`, alex.cookie, {
      method: 'POST',
    });
    expect(closed.status).toBe(204);
    expect(await awayOf(alex.cookie, projectId)).toBeNull();

    await lastSeen(projectId, alex.id, '90 minutes');
    await say(olga.cookie, projectId, 'Zweite Neuigkeit');
    expect(await open(alex.cookie, projectId)).toBe(true);
    // The message from before the first return is older than this absence.
    await test.db.adminPool.query(
      `update messages set created_at = now() - interval '3 hours'
       where project_id = $1 and content = 'Erste Neuigkeit'`,
      [projectId],
    );
    expect((await awayOf(alex.cookie, projectId))?.messages.count).toBe(1);
  });
});

describe("the moderator's words", () => {
  async function returned() {
    const { olga, alex, projectId } = await projectWithAbsence();
    for (const text of ['Eins', 'Zwei', 'Drei', 'Vier', 'Fünf']) {
      await say(olga.cookie, projectId, text);
    }
    expect(await open(alex.cookie, projectId)).toBe(true);
    const write = (set: string) =>
      test.db.adminPool.query(
        `update away_summaries set ${set} where project_id = $1 and user_id = $2`,
        [projectId, alex.id],
      );
    return { alex, projectId, write };
  }

  it('are announced while the worker writes them and shown once they are there', async () => {
    const { alex, projectId, write } = await returned();
    expect(await awayOf(alex.cookie, projectId)).toMatchObject({
      text: null,
      textStatus: 'pending',
    });

    await write(`text = 'Olga hat fünf Punkte gesammelt.', text_status = 'done'`);
    expect(await awayOf(alex.cookie, projectId)).toMatchObject({
      text: 'Olga hat fünf Punkte gesammelt.',
      textStatus: 'done',
    });
  });

  it('are given up when the worker does not answer or the model fails', async () => {
    const { alex, projectId, write } = await returned();

    // Alex came back three minutes ago, after the five messages.
    await test.db.adminPool.query(
      `update messages set created_at = now() - interval '10 minutes' where project_id = $1`,
      [projectId],
    );
    await write(`back_at = now() - interval '3 minutes'`);
    expect(await awayOf(alex.cookie, projectId)).toMatchObject({
      text: null,
      textStatus: 'failed',
      messages: { count: 5 },
    });

    await write(`back_at = now(), text_status = 'failed'`);
    expect(await awayOf(alex.cookie, projectId)).toMatchObject({
      text: null,
      textStatus: 'failed',
    });
  });
});

describe('what changed on a board', () => {
  const OLGA = randomUUID();
  const ALEX = randomUUID();
  const period = {
    from: new Date('2026-10-01T18:00:00.000Z'),
    until: new Date('2026-10-02T08:00:00.000Z'),
  };

  function node(by: Author, at: string): CanvasNode {
    return {
      id: randomUUID(),
      type: 'block',
      blockType: null,
      position: { x: 0, y: 0 },
      size: { width: 180, height: 96 },
      label: '',
      subtitle: '',
      frameId: null,
      diagramType: null,
      fields: [],
      createdBy: by,
      lastChangedBy: by,
      lastChangedAt: at,
    };
  }

  function edge(by: Author, at: string): CanvasEdge {
    return {
      id: randomUUID(),
      source: randomUUID(),
      target: randomUUID(),
      sourceHandle: null,
      targetHandle: null,
      label: '',
      createdBy: by,
      lastChangedBy: by,
      lastChangedAt: at,
    };
  }

  it('counts the elements others changed in the period, the busiest author first', () => {
    const olga: Author = { kind: 'human', userId: OLGA };
    const moderator: Author = { kind: 'agent', agentKey: 'moderator' };
    const content = {
      nodes: [
        node(olga, '2026-10-01T19:00:00.000Z'),
        node(moderator, '2026-10-01T20:00:00.000Z'),
        node(moderator, '2026-10-02T07:59:59.000Z'),
        // Too early, too late, exactly at the start, and the returning person's own.
        node(olga, '2026-10-01T17:59:59.000Z'),
        node(olga, '2026-10-02T08:00:01.000Z'),
        node(olga, '2026-10-01T18:00:00.000Z'),
        node({ kind: 'human', userId: ALEX }, '2026-10-01T21:00:00.000Z'),
      ],
      edges: [edge(moderator, '2026-10-01T22:00:00.000Z'), edge(olga, '2026-10-02T08:00:00.000Z')],
    };

    expect(boardChanges(content, period, ALEX)).toEqual([
      { author: moderator, count: 3 },
      { author: olga, count: 2 },
    ]);
    expect(boardChanges({ nodes: [], edges: [] }, period, ALEX)).toEqual([]);
  });
});
