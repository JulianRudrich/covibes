import { randomUUID } from 'node:crypto';

import {
  addBlock,
  addFrame,
  isRoadmap,
  planNodesFromMarkdown,
  readRoadmap,
  ROADMAP_DIAGRAM,
  roadmapLayout,
  writePlanSection,
  type ApiErrorBody,
  type CanvasNode,
  type PlanSection,
  type ProjectBoard,
  type ProjectDetails,
  type ProjectSummary,
  type Roadmap,
  type RoadmapPlace,
} from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { APP_URL, createTestServer } from '@server/testing';

// The roadmap of the plan (spec 26a).
const test = createTestServer();

function request(path: string, cookie: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  headers.set('origin', APP_URL);
  return test.app.request(path, { ...init, headers });
}

const post = (path: string, cookie: string | null) => request(path, cookie, { method: 'POST' });

async function errorCode(response: Response) {
  return ((await response.json()) as ApiErrorBody).error.code;
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
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Vereins-App' }),
  });
  const projectId = ((await created.json()) as ProjectSummary).id;
  const details = (await (
    await request(`/api/projects/${projectId}`, owner)
  ).json()) as ProjectDetails;
  return {
    owner,
    projectId,
    mainBoardId: details.boards[0]?.id ?? '',
    roadmap: `/api/projects/${projectId}/roadmap`,
  };
}

async function member(projectId: string, role: 'editor' | 'viewer') {
  const cookie = await test.signIn();
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, await userIdOf(cookie), role],
  );
  return cookie;
}

/** Writes sections into the plan, as accepting the moderator's suggestions does. */
function writePlan(projectId: string, sections: Partial<Record<PlanSection, string>>) {
  return test.collab.changePlan(projectId, (doc) => {
    for (const [section, markdown] of Object.entries(sections)) {
      writePlanSection(doc, section as PlanSection, planNodesFromMarkdown(markdown), 'de');
    }
  });
}

const MILESTONES = [
  '### Meilenstein 1: Grundgerüst (2 Wochen)',
  'Die App läuft und jeder kann sich anmelden.',
  '- Login per Link\n- Projekt anlegen',
  '### Meilenstein 2: Mitglieder',
  'Der Verein verwaltet seine Mitglieder.',
  '- Mitgliederliste\n- Import aus Excel',
].join('\n\n');

async function nodesOf(boardId: string): Promise<CanvasNode[]> {
  return (await test.collab.readBoard(boardId)).nodes;
}

describe('reading the roadmap', () => {
  it('gives every member the milestones of the plan as it stands', async () => {
    const { projectId, roadmap } = await createProject();
    const viewer = await member(projectId, 'viewer');
    await writePlan(projectId, {
      milestones: MILESTONES,
      costs: '- Meilenstein 1: 2 Wochen\n- Meilenstein 2: 3 Wochen',
    });

    const response = await request(roadmap, viewer);

    expect(response.status).toBe(200);
    expect((await response.json()) as Roadmap).toEqual({
      milestones: [
        {
          number: 1,
          title: 'Grundgerüst',
          goal: 'Die App läuft und jeder kann sich anmelden.',
          duration: { text: '2 Wochen', weeks: 2 },
          tasks: [{ text: 'Login per Link' }, { text: 'Projekt anlegen' }],
        },
        {
          number: 2,
          title: 'Mitglieder',
          goal: 'Der Verein verwaltet seine Mitglieder.',
          // The heading has no time; the costs give it.
          duration: { text: '3 Wochen', weeks: 3 },
          tasks: [{ text: 'Mitgliederliste' }, { text: 'Import aus Excel' }],
        },
      ],
    });
  });

  it('is empty while the plan has no milestones', async () => {
    const { owner, roadmap } = await createProject();

    const response = await request(roadmap, owner);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ milestones: [] });
  });

  it('is for members with a session', async () => {
    const { roadmap } = await createProject();

    expect((await request(roadmap, null)).status).toBe(401);
    const stranger = await request(roadmap, await test.signIn());
    expect(stranger.status).toBe(404);
    expect(await errorCode(stranger)).toBe('not_found');
    expect((await request('/api/projects/demo/roadmap', await test.signIn())).status).toBe(404);
  });
});

describe('opening the roadmap', () => {
  it('finds a roadmap on any board, for every member', async () => {
    const { owner, projectId, roadmap } = await createProject();
    const viewer = await member(projectId, 'viewer');
    const created = await request(`/api/projects/${projectId}/boards`, owner, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Zeitplan' }),
    });
    const board = (await created.json()) as ProjectBoard;
    const nodeId = randomUUID();
    await test.collab.changeBoard({ boardId: board.id, projectId }, (doc) => {
      addFrame(
        doc,
        {
          id: nodeId,
          position: { x: 0, y: 0 },
          title: 'Roadmap',
          diagramType: ROADMAP_DIAGRAM,
          size: { width: 600, height: 300 },
        },
        { kind: 'human', userId: randomUUID() },
      );
    });

    const response = await post(`${roadmap}/open`, viewer);

    expect(response.status).toBe(200);
    expect((await response.json()) as RoadmapPlace).toEqual({ boardId: board.id, nodeId });
  });

  it('creates one on the main canvas for owners and editors, with the size of its content', async () => {
    const { projectId, mainBoardId, roadmap } = await createProject();
    const editor = await member(projectId, 'editor');
    await writePlan(projectId, { milestones: MILESTONES });
    const blockId = randomUUID();
    await test.collab.changeBoard({ boardId: mainBoardId, projectId }, (doc) => {
      addBlock(
        doc,
        { id: blockId, position: { x: 300, y: 260 }, label: 'API' },
        { kind: 'agent', agentKey: 'backend' },
      );
    });

    const response = await post(`${roadmap}/open`, editor);

    expect(response.status).toBe(201);
    const place = (await response.json()) as RoadmapPlace;
    expect(place.boardId).toBe(mainBoardId);
    const nodes = await nodesOf(mainBoardId);
    const frame = nodes.find((node) => node.id === place.nodeId);
    const sections = await test.collab.readPlanSections(projectId);
    expect(frame).toMatchObject({
      type: 'frame',
      label: 'Roadmap',
      diagramType: ROADMAP_DIAGRAM,
      size: roadmapLayout(readRoadmap(sections)).size,
      createdBy: { kind: 'human', userId: await userIdOf(editor) },
    });
    // At a free spot: not on the block that was there.
    const block = nodes.find((node) => node.id === blockId);
    if (!frame || !block) throw new Error('A node is missing');
    const overlapping =
      frame.position.x < block.position.x + block.size.width &&
      block.position.x < frame.position.x + frame.size.width &&
      frame.position.y < block.position.y + block.size.height &&
      block.position.y < frame.position.y + frame.size.height;
    expect(overlapping).toBe(false);

    // A project has one roadmap: asking again finds it.
    const again = await post(`${roadmap}/open`, editor);
    expect(again.status).toBe(200);
    expect((await again.json()) as RoadmapPlace).toEqual(place);
    expect((await nodesOf(mainBoardId)).filter(isRoadmap)).toHaveLength(1);
  });

  it('creates one for a plan without milestones too, with the size of an empty roadmap', async () => {
    const { owner, mainBoardId, roadmap } = await createProject();

    const response = await post(`${roadmap}/open`, owner);

    expect(response.status).toBe(201);
    const [frame] = await nodesOf(mainBoardId);
    expect(frame?.size).toEqual(roadmapLayout({ milestones: [] }).size);
  });

  it('tells viewers that there is none, and nobody outside the project anything', async () => {
    const { projectId, mainBoardId, roadmap } = await createProject();
    const viewer = await member(projectId, 'viewer');

    const refused = await post(`${roadmap}/open`, viewer);

    expect(refused.status).toBe(404);
    expect(await errorCode(refused)).toBe('not_found');
    expect(await nodesOf(mainBoardId)).toEqual([]);
    expect((await post(`${roadmap}/open`, await test.signIn())).status).toBe(404);
    expect((await post(`${roadmap}/open`, null)).status).toBe(401);
    expect((await post('/api/projects/demo/roadmap/open', viewer)).status).toBe(404);
    expect(await nodesOf(mainBoardId)).toEqual([]);
  });
});
