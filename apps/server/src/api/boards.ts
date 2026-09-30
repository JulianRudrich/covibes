import type { DB } from '@covibes/db';
import {
  boardIdSchema,
  createBoardInputSchema,
  MAX_BOARDS_PER_PROJECT,
  nextBoardTitle,
  projectIdSchema,
  renameBoardInputSchema,
  type ProjectBoard,
} from '@covibes/shared';
import { Hono, type Context } from 'hono';
import { sql, type Transaction } from 'kysely';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import type { BoardDocuments } from '@server/collab/collab';
import { withUser, type AppDb } from '@server/db/database';
import type { LivePublisher } from '@server/realtime/realtime';

function membership(trx: Transaction<DB>, projectId: string, userId: string) {
  return trx
    .selectFrom('project_members')
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .select('role')
    .executeTakeFirst();
}

function findBoard(trx: Transaction<DB>, projectId: string, boardId: string) {
  return trx
    .selectFrom('boards')
    .where('project_id', '=', projectId)
    .where('id', '=', boardId)
    .select(['id', 'title', 'kind'])
    .executeTakeFirst();
}

function toBoard(row: { id: string; title: string; kind: string }): ProjectBoard {
  return { id: row.id, title: row.title, kind: row.kind === 'main' ? 'main' : 'extra' };
}

/** The JSON body; an empty body counts as `{}`, broken JSON as undefined. */
async function optionalJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Project and board id from the path; malformed ids cannot exist and count as not found. */
function pathIds(c: Context) {
  const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
  const boardId = boardIdSchema.safeParse(c.req.param('boardId'));
  return projectId.success && boardId.success
    ? { projectId: projectId.data, boardId: boardId.data }
    : undefined;
}

/**
 * `/api/projects/:projectId/boards` (spec 11): owners and editors create, rename and delete the
 * further boards of a project; the main canvas stays as it is. Everything runs through
 * `withUser`, so RLS checks every row; the explicit checks only make the answers clearer.
 * Every change is announced on the project's live channel.
 */
export function boardRoutes(db: AppDb, auth: Auth, live: LivePublisher, documents: BoardDocuments) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.post('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');
    const input = createBoardInputSchema.safeParse(await optionalJson(c));
    if (!input.success) return apiError(c, 'invalid_input');

    const result = await withUser(db, user.id, async (trx) => {
      const member = await membership(trx, projectId.data, user.id);
      if (!member) return 'not_found' as const;
      if (member.role === 'viewer') return 'forbidden' as const;

      // Two boards created at the same moment must not both slip under the limit.
      await sql`select pg_advisory_xact_lock(hashtextextended(${projectId.data}, 0))`.execute(trx);
      const boards = await trx
        .selectFrom('boards')
        .where('project_id', '=', projectId.data)
        .select(['title', 'position'])
        .execute();
      if (boards.length >= MAX_BOARDS_PER_PROJECT) return 'limit_reached' as const;

      const row = await trx
        .insertInto('boards')
        .values({
          project_id: projectId.data,
          title: input.data.title ?? nextBoardTitle(boards.map((board) => board.title)),
          kind: 'extra',
          position: Math.max(0, ...boards.map((board) => board.position)) + 1,
        })
        .returning(['id', 'title', 'kind'])
        .executeTakeFirstOrThrow();
      return toBoard(row);
    });

    if (typeof result === 'string') return apiError(c, result);
    live.publish(projectId.data, { type: 'boards' });
    return c.json<ProjectBoard>(result, 201);
  });

  routes.patch('/:boardId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const ids = pathIds(c);
    if (!ids) return apiError(c, 'not_found');
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = renameBoardInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');

    const result = await withUser(db, user.id, async (trx) => {
      const board = await findBoard(trx, ids.projectId, ids.boardId);
      if (!board) return 'not_found' as const;
      if (board.kind === 'main') return 'forbidden' as const;
      // Viewers see the board, but RLS lets them change nothing.
      const row = await trx
        .updateTable('boards')
        .set({ title: input.data.title })
        .where('id', '=', ids.boardId)
        .returning(['id', 'title', 'kind'])
        .executeTakeFirst();
      return row ? toBoard(row) : ('forbidden' as const);
    });

    if (typeof result === 'string') return apiError(c, result);
    live.publish(ids.projectId, { type: 'boards' });
    return c.json<ProjectBoard>(result);
  });

  routes.delete('/:boardId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const ids = pathIds(c);
    if (!ids) return apiError(c, 'not_found');

    const result = await withUser(db, user.id, async (trx) => {
      const board = await findBoard(trx, ids.projectId, ids.boardId);
      if (!board) return 'not_found' as const;
      if (board.kind === 'main') return 'forbidden' as const;
      const deleted = await trx
        .deleteFrom('boards')
        .where('id', '=', ids.boardId)
        .executeTakeFirst();
      return deleted.numDeletedRows > 0n ? ('deleted' as const) : ('forbidden' as const);
    });

    if (result !== 'deleted') return apiError(c, result);
    // First the announcement, so open tabs switch to the main canvas before their connection to
    // the deleted board closes.
    live.publish(ids.projectId, { type: 'boards' });
    await documents.deleteBoard(ids.boardId);
    return c.body(null, 204);
  });

  return routes;
}
