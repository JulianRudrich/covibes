import {
  boardIdSchema,
  HISTORY_MAX_ENTRIES,
  historyItemsSchema,
  isAgentKey,
  isCustomAgentKey,
  projectIdSchema,
  type BoardHistory,
  type BoardHistoryEntry,
} from '@covibes/shared';
import { Hono } from 'hono';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import type { BoardDocuments } from '@server/collab/collab';
import { withUser, type AppDb } from '@server/db/database';

type StoredEntry = {
  id: string;
  actor_kind: string;
  actor_user_id: string | null;
  actor_agent_key: string | null;
  actor_name: string;
  items: unknown;
  updated_at: Date;
};

/** The author of an entry as the list shows them; an agent this version does not know is nobody. */
function actorOf(row: StoredEntry): BoardHistoryEntry['actor'] {
  if (row.actor_kind === 'human') {
    return { kind: 'human', userId: row.actor_user_id, name: row.actor_name };
  }
  const key = row.actor_agent_key;
  if (row.actor_kind === 'agent' && key !== null && (isAgentKey(key) || isCustomAgentKey(key))) {
    return { kind: 'agent', agentKey: key };
  }
  return { kind: 'unknown' };
}

/**
 * `/api/projects/:projectId/boards/:boardId/history` (spec 38a): what changed on a board, the
 * newest entry first. Every member reads it, viewers included: it says nothing that the board
 * and its elements do not show. Row level security gives the entries of the member's projects;
 * the server adds which of their elements are still on the board.
 */
export function boardHistoryRoutes(
  db: AppDb,
  auth: Auth,
  documents: Pick<BoardDocuments, 'readBoard'>,
) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    const boardId = boardIdSchema.safeParse(c.req.param('boardId'));
    // Unknown, foreign and malformed ids all look the same from outside.
    if (!projectId.success || !boardId.success) return apiError(c, 'not_found');

    const rows = await withUser(db, user.id, async (trx) => {
      const board = await trx
        .selectFrom('boards')
        .select('id')
        .where('id', '=', boardId.data)
        .where('project_id', '=', projectId.data)
        .executeTakeFirst();
      if (!board) return undefined;
      return trx
        .selectFrom('board_changes')
        .select([
          'id',
          'actor_kind',
          'actor_user_id',
          'actor_agent_key',
          'actor_name',
          'items',
          'updated_at',
        ])
        .where('board_id', '=', boardId.data)
        .orderBy('updated_at', 'desc')
        .orderBy('id', 'desc')
        .limit(HISTORY_MAX_ENTRIES)
        .execute();
    });
    if (!rows) return apiError(c, 'not_found');

    // What is on the board right now; a board that cannot be read leads nowhere.
    const board = await documents.readBoard(boardId.data).catch(() => ({ nodes: [], edges: [] }));
    const present = new Set([...board.nodes, ...board.edges].map((element) => element.id));

    const entries = rows.flatMap((row): BoardHistoryEntry[] => {
      const items = historyItemsSchema.safeParse(row.items);
      // An entry this version cannot read is left out rather than shown wrong.
      if (!items.success) return [];
      return [
        {
          id: row.id,
          actor: actorOf(row),
          at: row.updated_at.toISOString(),
          items: items.data.map((item) => ({
            id: item.id,
            kind: item.kind,
            label: item.label,
            action: item.action,
            present: present.has(item.id),
          })),
        },
      ];
    });
    return c.json<BoardHistory>({ entries });
  });

  return routes;
}
