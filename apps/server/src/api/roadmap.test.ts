import { randomUUID } from 'node:crypto';

import {
  addBlock,
  addFrame,
  ensureTaskIds,
  isRoadmap,
  planNodesFromMarkdown,
  readRoadmap,
  ROADMAP_DIAGRAM,
  roadmapLayout,
  writePlanSection,
  type ApiErrorBody,
  type CanvasNode,
  type NotificationList,
  type PlanSection,
  type ProjectBoard,
  type ProjectDetails,
  type ProjectSummary,
  type Roadmap,
  type RoadmapPlace,
  type RoadmapTask,
} from '@covibes/shared';
import { describe, expect, it, vi } from 'vitest';

import { APP_URL, createTestServer } from '@server/testing';

// The roadmap of the plan (spec 26a) and who takes its tasks (spec 26b).
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

/** Gives the account a name the roadmap and the notifications show. */
async function named(cookie: string, name: string) {
  const id = await userIdOf(cookie);
  await test.db.adminPool.query('update users set name = $1 where id = $2', [name, id]);
  return { cookie, id };
}

/**
 * Writes sections into the plan, as people do in the editor, and gives the tasks their ids, as the
 * server does once it stored the plan (spec 26b).
 */
function writePlan(projectId: string, sections: Partial<Record<PlanSection, string>>) {
  return test.collab.changePlan(projectId, (doc) => {
    for (const [section, markdown] of Object.entries(sections)) {
      writePlanSection(doc, section as PlanSection, planNodesFromMarkdown(markdown), 'de');
    }
    ensureTaskIds(doc);
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
    // Every task comes with the id it carries in the plan, and with nobody on it yet.
    const task = (text: string) => ({ id: expect.any(String) as unknown, text, assignee: null });
    expect((await response.json()) as Roadmap).toEqual({
      milestones: [
        {
          number: 1,
          title: 'Grundgerüst',
          goal: 'Die App läuft und jeder kann sich anmelden.',
          duration: { text: '2 Wochen', weeks: 2 },
          tasks: [task('Login per Link'), task('Projekt anlegen')],
        },
        {
          number: 2,
          title: 'Mitglieder',
          goal: 'Der Verein verwaltet seine Mitglieder.',
          // The heading has no time; the costs give it.
          duration: { text: '3 Wochen', weeks: 3 },
          tasks: [task('Mitgliederliste'), task('Import aus Excel')],
        },
      ],
    });
  });

  it('gives a task without an id until the server gave it one', async () => {
    const { owner, projectId, roadmap } = await createProject();
    await test.collab.changePlan(projectId, (doc) => {
      writePlanSection(doc, 'milestones', planNodesFromMarkdown(MILESTONES), 'de');
    });

    const response = await request(roadmap, owner);

    expect(((await response.json()) as Roadmap).milestones[0]?.tasks).toEqual([
      { id: null, text: 'Login per Link', assignee: null },
      { id: null, text: 'Projekt anlegen', assignee: null },
    ]);
  });

  it('asks for ids when it reads a task without one, and only then', async () => {
    const { owner, projectId, roadmap } = await createProject();
    const giveTaskIds = vi.fn();
    const app = test.appWith({ ...test.collab, giveTaskIds });
    const read = () =>
      app.request(roadmap, { headers: new Headers({ cookie: owner, origin: APP_URL }) });
    // A plan from before tasks had ids, which nobody has changed since.
    await test.collab.changePlan(projectId, (doc) => {
      writePlanSection(doc, 'milestones', planNodesFromMarkdown(MILESTONES), 'de');
    });

    expect((await read()).status).toBe(200);
    expect(giveTaskIds).toHaveBeenCalledExactlyOnceWith(projectId);

    await test.collab.changePlan(projectId, (doc) => ensureTaskIds(doc));
    const withIds = (await (await read()).json()) as Roadmap;
    expect(withIds.milestones[0]?.tasks.every((task) => task.id !== null)).toBe(true);
    expect(giveTaskIds).toHaveBeenCalledTimes(1);
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

describe('assigning tasks (spec 26b)', () => {
  async function tasksOf(roadmap: string, cookie: string): Promise<RoadmapTask[]> {
    const response = await request(roadmap, cookie);
    expect(response.status).toBe(200);
    return ((await response.json()) as Roadmap).milestones.flatMap((milestone) => milestone.tasks);
  }

  const assign = (roadmap: string, cookie: string | null, taskId: string, body: unknown) =>
    request(`${roadmap}/tasks/${taskId}/assignee`, cookie, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  /** A project whose plan has milestones, and the id of each of its tasks by the task's text. */
  async function projectWithTasks() {
    const project = await createProject();
    await writePlan(project.projectId, { milestones: MILESTONES });
    const tasks = await tasksOf(project.roadmap, project.owner);
    const idOf = (text: string) => tasks.find((task) => task.text === text)?.id ?? '';
    return { ...project, idOf };
  }

  it('shows every member who took a task, until that person leaves the project', async () => {
    const { owner, projectId, roadmap, idOf } = await projectWithTasks();
    const alex = await named(await member(projectId, 'editor'), 'Alex Berg');
    const viewer = await member(projectId, 'viewer');

    const assigned = await assign(roadmap, owner, idOf('Projekt anlegen'), { userId: alex.id });

    expect(assigned.status).toBe(204);
    expect((await tasksOf(roadmap, viewer)).map((task) => [task.text, task.assignee])).toEqual([
      ['Login per Link', null],
      ['Projekt anlegen', { userId: alex.id, name: 'Alex Berg' }],
      ['Mitgliederliste', null],
      ['Import aus Excel', null],
    ]);

    await test.db.adminPool.query(
      'delete from project_members where project_id = $1 and user_id = $2',
      [projectId, alex.id],
    );
    expect((await tasksOf(roadmap, viewer)).every((task) => task.assignee === null)).toBe(true);
  });

  it('is done, passed on and undone by owners and editors, and announced once per change', async () => {
    const { owner, projectId, roadmap, idOf } = await projectWithTasks();
    const editor = await named(await member(projectId, 'editor'), 'Eddie');
    const viewer = await named(await member(projectId, 'viewer'), 'Vera');
    const taskId = idOf('Mitgliederliste');
    const assigneeOf = async () =>
      (await tasksOf(roadmap, owner)).find((task) => task.id === taskId)?.assignee?.userId ?? null;
    const publish = vi.spyOn(test.realtime, 'publish');
    const announced = { type: 'roadmap' };

    expect((await assign(roadmap, owner, taskId, { userId: editor.id })).status).toBe(204);
    expect(await assigneeOf()).toBe(editor.id);
    // The same assignee again changes nothing, so there is nothing to announce.
    expect((await assign(roadmap, owner, taskId, { userId: editor.id })).status).toBe(204);
    expect(publish.mock.calls).toEqual([[projectId, announced]]);

    // An editor passes the task on (viewers do tasks too) and takes it from everyone.
    expect((await assign(roadmap, editor.cookie, taskId, { userId: viewer.id })).status).toBe(204);
    expect(await assigneeOf()).toBe(viewer.id);
    expect((await assign(roadmap, editor.cookie, taskId, { userId: null })).status).toBe(204);
    expect(await assigneeOf()).toBeNull();
    expect((await assign(roadmap, editor.cookie, taskId, { userId: null })).status).toBe(204);
    expect(publish.mock.calls).toEqual([
      [projectId, announced],
      [projectId, announced],
      [projectId, announced],
    ]);
    publish.mockRestore();
  });

  it('is not for viewers, strangers or someone without a session', async () => {
    const { owner, projectId, roadmap, idOf } = await projectWithTasks();
    const viewer = await named(await member(projectId, 'viewer'), 'Vera');
    const taskId = idOf('Login per Link');
    const publish = vi.spyOn(test.realtime, 'publish');

    const refused = await assign(roadmap, viewer.cookie, taskId, { userId: viewer.id });
    expect(refused.status).toBe(403);
    expect(await errorCode(refused)).toBe('forbidden');
    const stranger = await assign(roadmap, await test.signIn(), taskId, { userId: null });
    expect(stranger.status).toBe(404);
    expect(await errorCode(stranger)).toBe('not_found');
    expect((await assign(roadmap, null, taskId, { userId: null })).status).toBe(401);
    expect(
      (await assign('/api/projects/demo/roadmap', owner, taskId, { userId: null })).status,
    ).toBe(404);

    expect(publish).not.toHaveBeenCalled();
    publish.mockRestore();
    expect((await tasksOf(roadmap, owner)).every((task) => task.assignee === null)).toBe(true);
  });

  it('takes the tasks of the plan as it stands only', async () => {
    const { owner, projectId, roadmap, idOf } = await projectWithTasks();
    const other = await projectWithTasks();
    const userId = await userIdOf(owner);
    const leaving = idOf('Import aus Excel');
    expect((await assign(roadmap, owner, leaving, { userId })).status).toBe(204);

    // An id no task has, one that is none, and the task of another project's plan.
    for (const taskId of [randomUUID(), 'nope', other.idOf('Login per Link')]) {
      const response = await assign(roadmap, owner, taskId, { userId });
      expect(response.status, taskId).toBe(404);
      expect(await errorCode(response)).toBe('not_found');
    }

    // A task that left the plan is no task any more, and its assignment shows nowhere.
    await writePlan(projectId, {
      milestones: '### Meilenstein 1: Grundgerüst\n\n- Login per Link',
    });
    expect((await assign(roadmap, owner, leaving, { userId: null })).status).toBe(404);
    expect((await tasksOf(roadmap, owner)).map((task) => [task.text, task.assignee])).toEqual([
      ['Login per Link', null],
    ]);
  });

  it('refuses an assignee who is no member, and input that is none', async () => {
    const { owner, roadmap, idOf } = await projectWithTasks();
    const taskId = idOf('Login per Link');
    const stranger = await userIdOf(await test.signIn());

    for (const body of [
      { userId: stranger },
      { userId: randomUUID() },
      {},
      { userId: 'alex' },
      { userId: null, title: 'Anderer Text' },
      'kein Objekt',
    ]) {
      const response = await assign(roadmap, owner, taskId, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await errorCode(response)).toBe('invalid_input');
    }
    expect((await tasksOf(roadmap, owner)).every((task) => task.assignee === null)).toBe(true);
  });

  it('notifies the assignee, and nobody who takes a task themselves', async () => {
    const { owner, projectId, roadmap, idOf } = await projectWithTasks();
    await named(owner, 'Olga');
    const alex = await named(await member(projectId, 'editor'), 'Alex');
    const assignedTo = async (cookie: string) => {
      const response = await request('/api/notifications', cookie);
      return ((await response.json()) as NotificationList).notifications.filter(
        (notification) => notification.kind === 'task_assigned',
      );
    };

    await assign(roadmap, owner, idOf('Login per Link'), { userId: alex.id });
    await assign(roadmap, alex.cookie, idOf('Mitgliederliste'), { userId: alex.id });

    expect(await assignedTo(alex.cookie)).toEqual([
      {
        id: expect.any(String) as unknown,
        kind: 'task_assigned',
        projectId,
        projectName: 'Vereins-App',
        actorName: 'Olga',
        // The task as the plan words it.
        excerpt: 'Login per Link',
        role: null,
        createdAt: expect.any(String) as unknown,
        read: false,
      },
    ]);
    expect(await assignedTo(owner)).toEqual([]);
  });
});
