import { randomUUID } from 'node:crypto';

import type { DB } from '@covibes/db';
import {
  addFrame,
  assignTaskInputSchema,
  findFreeSpot,
  isRoadmap,
  projectIdSchema,
  readNodes,
  readRoadmap,
  ROADMAP_DIAGRAM,
  ROADMAP_TITLE,
  roadmapLayout,
  withAssignees,
  withIssues,
  type Roadmap,
  type RoadmapPlace,
} from '@covibes/shared';
import { Hono } from 'hono';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import type { BoardDocuments } from '@server/collab/collab';
import { withUser, type AppDb } from '@server/db/database';
import { loadAssignees } from '@server/plan/assignees';
import { loadTaskIssues } from '@server/plan/task-issues';
import type { LivePublisher } from '@server/realtime/realtime';
import { centerOfNodes } from '@server/tools/placement';

function sqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

function membership(trx: Transaction<DB>, projectId: string, userId: string) {
  return trx
    .selectFrom('project_members')
    .select('role')
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
}

/**
 * `/api/projects/:projectId/roadmap` (specs 26a and 26b): the roadmap as the plan shows it right
 * now, where it is on the canvas, and who takes which of its tasks. The plan is the source; a
 * roadmap frame holds nothing of its own. An assignment is announced on the project's live
 * channel.
 */
export function roadmapRoutes(
  db: AppDb,
  auth: Auth,
  live: LivePublisher,
  documents: Pick<BoardDocuments, 'changeBoard' | 'readBoard' | 'readPlanSections' | 'giveTaskIds'>,
) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const stored = await withUser(db, user.id, async (trx) => {
      if (!(await membership(trx, projectId.data, user.id))) return undefined;
      return {
        assignees: await loadAssignees(trx, projectId.data),
        // After the handover the repository owns the status of a task (spec 30a).
        issues: await loadTaskIssues(trx, projectId.data),
      };
    });
    if (!stored) return apiError(c, 'not_found');
    const roadmap = readRoadmap(await documents.readPlanSections(projectId.data));
    // A task without an id cannot be assigned. The server gives ids after it stored a plan; a
    // plan from before that, or one nobody changed since, gets them now, and the roadmap is
    // announced again once they are there.
    if (roadmap.milestones.some((milestone) => milestone.tasks.some((task) => task.id === null))) {
      documents.giveTaskIds?.(projectId.data);
    }
    return c.json<Roadmap>(withIssues(withAssignees(roadmap, stored.assignees), stored.issues));
  });

  /**
   * Gives a task to a member, or to nobody (spec 26b). The task must be one of the plan as it
   * stands; its text there is how the assignment and its notification read. The database checks
   * who may assign and who can be assigned, and notifies the assignee.
   */
  routes.put('/tasks/:taskId/assignee', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    const taskId = z.uuid().safeParse(c.req.param('taskId'));
    if (!projectId.success || !taskId.success) return apiError(c, 'not_found');
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = assignTaskInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');

    const member = await withUser(db, user.id, (trx) => membership(trx, projectId.data, user.id));
    if (!member) return apiError(c, 'not_found');
    const task = readRoadmap(await documents.readPlanSections(projectId.data))
      .milestones.flatMap((milestone) => milestone.tasks)
      .find((candidate) => candidate.id === taskId.data);
    if (!task) return apiError(c, 'not_found');

    try {
      const changed = await withUser(db, user.id, async (trx) => {
        const assigned = await sql<{ changed: boolean }>`
          select public.assign_task(
            ${projectId.data}, ${taskId.data}, ${input.data.userId}, ${task.text}
          ) as changed`.execute(trx);
        return assigned.rows[0]?.changed === true;
      });
      // Assigning it to who has it already changes nothing, and there is nothing to load again.
      if (changed) live.publish(projectId.data, { type: 'roadmap' });
      return c.body(null, 204);
    } catch (error) {
      const state = sqlState(error);
      if (state === '42501') return apiError(c, 'forbidden');
      if (state === '22023') return apiError(c, 'invalid_input');
      throw error;
    }
  });

  /**
   * Where the roadmap is: the first one on the boards in their order. Without one, owners and
   * editors get a new one on the main canvas, at a free spot next to what is there; viewers learn
   * that there is none.
   */
  routes.post('/open', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const project = await withUser(db, user.id, async (trx) => {
      const member = await membership(trx, projectId.data, user.id);
      if (!member) return undefined;
      const boards = await trx
        .selectFrom('boards')
        .select(['id', 'kind'])
        .where('project_id', '=', projectId.data)
        .orderBy('kind', 'desc') // 'main' before 'extra'
        .orderBy('position')
        .orderBy('created_at')
        .execute();
      return { role: member.role, boards };
    });
    if (!project) return apiError(c, 'not_found');

    for (const board of project.boards) {
      const { nodes } = await documents.readBoard(board.id);
      const roadmap = nodes.find(isRoadmap);
      if (roadmap) return c.json<RoadmapPlace>({ boardId: board.id, nodeId: roadmap.id });
    }
    const main = project.boards.find((board) => board.kind === 'main');
    if (project.role === 'viewer' || !main) return apiError(c, 'not_found');

    // It starts with the size of what the plan has now; the web app keeps it fitted from there.
    const { size } = roadmapLayout(readRoadmap(await documents.readPlanSections(projectId.data)));
    const placed = await documents.changeBoard(
      { boardId: main.id, projectId: projectId.data },
      (doc) => {
        const nodes = readNodes(doc);
        // A project has one roadmap, also when two people ask for it at the same moment.
        const existing = nodes.find(isRoadmap);
        if (existing) return { nodeId: existing.id, created: false };
        const frame = addFrame(
          doc,
          {
            id: randomUUID(),
            position: findFreeSpot(nodes, centerOfNodes(nodes), size),
            title: ROADMAP_TITLE,
            diagramType: ROADMAP_DIAGRAM,
            size,
          },
          { kind: 'human', userId: user.id },
        );
        return { nodeId: frame.id, created: true };
      },
    );
    return c.json<RoadmapPlace>(
      { boardId: main.id, nodeId: placed.nodeId },
      placed.created ? 201 : 200,
    );
  });

  return routes;
}
