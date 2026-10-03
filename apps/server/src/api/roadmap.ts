import { randomUUID } from 'node:crypto';

import type { DB } from '@covibes/db';
import {
  addFrame,
  findFreeSpot,
  isRoadmap,
  projectIdSchema,
  readNodes,
  readRoadmap,
  ROADMAP_DIAGRAM,
  ROADMAP_TITLE,
  roadmapLayout,
  type Roadmap,
  type RoadmapPlace,
} from '@covibes/shared';
import { Hono } from 'hono';
import type { Transaction } from 'kysely';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import type { BoardDocuments } from '@server/collab/collab';
import { withUser, type AppDb } from '@server/db/database';
import { centerOfNodes } from '@server/tools/placement';

function membership(trx: Transaction<DB>, projectId: string, userId: string) {
  return trx
    .selectFrom('project_members')
    .select('role')
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
}

/**
 * `/api/projects/:projectId/roadmap` (spec 26a): the roadmap as the plan shows it right now, and
 * where it is on the canvas. The plan is the source; a roadmap frame holds nothing of its own.
 */
export function roadmapRoutes(
  db: AppDb,
  auth: Auth,
  documents: Pick<BoardDocuments, 'changeBoard' | 'readBoard' | 'readPlanSections'>,
) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const member = await withUser(db, user.id, (trx) => membership(trx, projectId.data, user.id));
    if (!member) return apiError(c, 'not_found');
    return c.json<Roadmap>(readRoadmap(await documents.readPlanSections(projectId.data)));
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
