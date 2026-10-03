import { createHash, randomBytes } from 'node:crypto';

import type { DB } from '@covibes/db';
import {
  customAgentSummarySchema,
  isRoadmap,
  NO_USER_ID,
  projectIdSchema,
  readRoadmap,
  shareBoardInputSchema,
  shareViewInputSchema,
  withAssignees,
  type Author,
  type CreatedShareLink,
  type CustomAgentSummary,
  type RoadmapAssignee,
  type SharedBoard,
  type SharedProject,
  type ShareLinkStatus,
} from '@covibes/shared';
import { Hono } from 'hono';
import { sql, type Transaction } from 'kysely';

import { loadDecisions } from '@server/api/decisions';
import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import type { BoardDocuments } from '@server/collab/collab';
import { withShareLink, withUser, type AppDb } from '@server/db/database';
import type { RateLimiter } from '@server/rate-limit';

/** Requests one read-only link may make per minute: several visitors, each loading now and then. */
export const SHARE_REQUESTS_PER_MINUTE = 240;

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

function roleIn(trx: Transaction<DB>, projectId: string, userId: string) {
  return trx
    .selectFrom('project_members')
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .select('role')
    .executeTakeFirst();
}

/**
 * `/api/projects/:projectId/share-link` (spec 21b): the read-only link of a project. Every member
 * sees whether there is one; owners create it, replace it with a new one and remove it. Only the
 * hash is stored, so the link is told once, in the answer that creates it.
 */
export function shareLinkRoutes(db: AppDb, auth: Auth, deps: { appUrl: string }) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const result = await withUser(db, user.id, async (trx) => {
      if (!(await roleIn(trx, projectId.data, user.id))) return 'not_found' as const;
      const link = await trx
        .selectFrom('share_links')
        .select('created_at')
        .where('project_id', '=', projectId.data)
        .executeTakeFirst();
      return { createdAt: link?.created_at.toISOString() ?? null };
    });
    if (typeof result === 'string') return apiError(c, result);
    return c.json<ShareLinkStatus>({
      active: result.createdAt !== null,
      createdAt: result.createdAt,
    });
  });

  // Creates the link, or replaces it: the one before stops working at once.
  routes.post('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const token = randomBytes(32).toString('base64url');
    const hash = hashOf(token);
    const result = await withUser(db, user.id, async (trx) => {
      const member = await roleIn(trx, projectId.data, user.id);
      if (!member) return 'not_found' as const;
      if (member.role !== 'owner') return 'forbidden' as const;
      return trx
        .insertInto('share_links')
        .values({ project_id: projectId.data, token_hash: hash, created_by: user.id })
        .onConflict((conflict) =>
          conflict
            .column('project_id')
            // Values, not `excluded`: the app role may write the hash but never read it.
            .doUpdateSet({ token_hash: hash, created_by: user.id, created_at: sql`now()` }),
        )
        .returning('created_at')
        .executeTakeFirstOrThrow();
    });
    if (typeof result === 'string') return apiError(c, result);
    return c.json<CreatedShareLink>(
      {
        url: new URL(`/share/${token}`, deps.appUrl).href,
        createdAt: result.created_at.toISOString(),
      },
      201,
    );
  });

  routes.delete('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const result = await withUser(db, user.id, async (trx) => {
      const member = await roleIn(trx, projectId.data, user.id);
      if (!member) return 'not_found' as const;
      if (member.role !== 'owner') return 'forbidden' as const;
      const removed = await trx
        .deleteFrom('share_links')
        .where('project_id', '=', projectId.data)
        .executeTakeFirst();
      return removed.numDeletedRows === 0n ? ('not_found' as const) : undefined;
    });
    if (result) return apiError(c, result);
    return c.body(null, 204);
  });

  return routes;
}

const NOBODY: Author = { kind: 'human', userId: NO_USER_ID };

/** Whoever took a task (spec 26b): the view says that it is taken, not by whom. */
const SOMEONE: RoadmapAssignee = { userId: NO_USER_ID, name: '' };

/** The element without who made or changed it, if that was a person; agents stay. */
function withoutPeople<T extends { createdBy: Author; lastChangedBy: Author }>(element: T): T {
  return {
    ...element,
    createdBy: element.createdBy.kind === 'human' ? NOBODY : element.createdBy,
    lastChangedBy: element.lastChangedBy.kind === 'human' ? NOBODY : element.lastChangedBy,
  };
}

/**
 * `/api/share` (spec 21b): what a read-only link shows, without a session. The token comes in
 * the body and is set for the transaction; the database policies then let the request read the
 * rows of that one project the view needs, and no person. A link nobody issued (or one that was
 * replaced or removed) is "not found".
 */
export function shareViewRoutes(db: AppDb, documents: BoardDocuments, limiter: RateLimiter) {
  const routes = new Hono();

  routes.post('/view', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = shareViewInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'not_found');
    if (!limiter.take(hashOf(input.data.token))) return apiError(c, 'too_many_requests');

    const view = await withShareLink(db, input.data.token, async (trx) => {
      const project = await trx
        .selectFrom('projects')
        .select(['id', 'name'])
        .where('id', '=', sql<string>`private.shared_project_id()`)
        .executeTakeFirst();
      if (!project) return undefined;
      const boards = await trx
        .selectFrom('boards')
        .where('project_id', '=', project.id)
        .select(['id', 'title', 'kind'])
        .orderBy('kind', 'desc') // 'main' before 'extra'
        .orderBy('position')
        .orderBy('created_at')
        .execute();
      const criteria = await trx
        .selectFrom('criteria')
        .select(['id', 'text'])
        .where('project_id', '=', project.id)
        .orderBy('created_at')
        .orderBy('id')
        .execute();
      // The join on `users` finds nobody here, so no decision says who confirmed it.
      const decisions = await loadDecisions(trx, project.id);
      const agents = await sql<{ id: string; name: string; color: number; deleted: boolean }>`
        select * from public.shared_agent_directory()
      `.execute(trx);
      return { project, boards, criteria, decisions, agents: agents.rows };
    });
    if (!view) return apiError(c, 'not_found');

    return c.json<SharedProject>({
      name: view.project.name,
      boards: view.boards.map((board) => ({
        id: board.id,
        title: board.title,
        kind: board.kind === 'main' ? ('main' as const) : ('extra' as const),
      })),
      decisions: view.decisions.map((decision) => ({ ...decision, decidedBy: null })),
      criteria: view.criteria,
      customAgents: view.agents.flatMap((agent): CustomAgentSummary[] => {
        // Only what the canvas needs to name an agent; the rest is neutral.
        const summary = customAgentSummarySchema.safeParse({
          key: agent.id,
          name: agent.name,
          role: '',
          color: agent.color,
          model: null,
          canDraw: true,
          scope: 'project',
          ownerId: NO_USER_ID,
          ownerName: '',
          deleted: agent.deleted,
        });
        return summary.success ? [summary.data] : [];
      }),
    });
  });

  routes.post('/board', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = shareBoardInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'not_found');
    if (!limiter.take(hashOf(input.data.token))) return apiError(c, 'too_many_requests');

    // The policies show the link the boards of its project only.
    const board = await withShareLink(db, input.data.token, async (trx) => {
      const found = await trx
        .selectFrom('boards')
        .select(['id', 'project_id'])
        .where('id', '=', input.data.boardId)
        .where('project_id', '=', sql<string>`private.shared_project_id()`)
        .executeTakeFirst();
      if (!found) return undefined;
      // Which tasks of the plan are taken (spec 26b); by whom is not read. Someone who left the
      // project has no task any more.
      const taken = await trx
        .selectFrom('tasks')
        .select('id')
        .where('project_id', '=', found.project_id)
        .where('assignee_id', 'is not', null)
        .execute();
      return { ...found, taken: taken.map((task) => task.id) };
    });
    if (!board) return apiError(c, 'not_found');

    const content = await documents.readBoard(board.id);
    // A roadmap shows the plan's milestones (spec 26a); the board brings them along.
    const roadmap = content.nodes.some(isRoadmap)
      ? withAssignees(
          readRoadmap(await documents.readPlanSections(board.project_id)),
          new Map(board.taken.map((taskId) => [taskId, SOMEONE])),
        )
      : null;
    return c.json<SharedBoard>({
      nodes: content.nodes.map(withoutPeople),
      edges: content.edges.map(withoutPeople),
      roadmap,
    });
  });

  return routes;
}
