import {
  boardIdSchema,
  HISTORY_MAX_ENTRIES,
  historyItemsSchema,
  isAgentKey,
  isCustomAgentKey,
  projectIdSchema,
  revertItems,
  type BoardHistory,
  type BoardHistoryEntry,
  type BoardHistoryUndo,
} from '@covibes/shared';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

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
  reverts: string | null;
  undone_at: Date | null;
  undone_by_name: string;
  undone_reverted: number | null;
  undone_kept: number | null;
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

/** By whom an entry was taken back and what came of it; null for one that was not. */
function undoneOf(row: StoredEntry): BoardHistoryEntry['undone'] {
  if (row.undone_at === null) return null;
  return {
    by: row.undone_by_name,
    at: row.undone_at.toISOString(),
    reverted: row.undone_reverted ?? 0,
    kept: row.undone_kept ?? 0,
  };
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
 * `/api/projects/:projectId/boards/:boardId/history` (spec 38): what changed on a board, the
 * newest entry first, and taking an entry back. Every member reads it, viewers included: it says
 * nothing that the board and its elements do not show. Row level security gives the entries of
 * the member's projects; the server adds which of their elements are still on the board. Owners
 * and editors take an entry back, which is a change of the board like any of theirs.
 */
export function boardHistoryRoutes(
  db: AppDb,
  auth: Auth,
  documents: Pick<BoardDocuments, 'readBoard' | 'changeBoard' | 'recordHistory'>,
) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const ids = pathIds(c);
    // Unknown, foreign and malformed ids all look the same from outside.
    if (!ids) return apiError(c, 'not_found');

    const found = await withUser(db, user.id, async (trx) => {
      const board = await trx
        .selectFrom('boards')
        .innerJoin('project_members', 'project_members.project_id', 'boards.project_id')
        .select('project_members.role')
        .where('boards.id', '=', ids.boardId)
        .where('boards.project_id', '=', ids.projectId)
        .where('project_members.user_id', '=', user.id)
        .executeTakeFirst();
      if (!board) return undefined;
      const rows = await trx
        .selectFrom('board_changes')
        .select([
          'id',
          'actor_kind',
          'actor_user_id',
          'actor_agent_key',
          'actor_name',
          'items',
          'updated_at',
          'reverts',
          'undone_at',
          'undone_by_name',
          'undone_reverted',
          'undone_kept',
        ])
        .where('board_id', '=', ids.boardId)
        .orderBy('updated_at', 'desc')
        .orderBy('id', 'desc')
        .limit(HISTORY_MAX_ENTRIES)
        .execute();
      return { rows, role: board.role };
    });
    if (!found) return apiError(c, 'not_found');

    // What is on the board right now; a board that cannot be read leads nowhere.
    const board = await documents.readBoard(ids.boardId).catch(() => ({ nodes: [], edges: [] }));
    const present = new Set([...board.nodes, ...board.edges].map((element) => element.id));

    const entries = found.rows.flatMap((row): BoardHistoryEntry[] => {
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
          reverts: row.reverts !== null,
          undone: undoneOf(row),
          canUndo: found.role !== 'viewer' && row.undone_at === null,
        },
      ];
    });
    return c.json<BoardHistory>({ entries });
  });

  // Takes an entry back (spec 38b): every element of it is set to how it was before, as long as
  // it is still as the entry left it. The answer says how many were set back and how many stayed.
  routes.post('/:entryId/undo', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const ids = pathIds(c);
    const entryId = z.uuid().safeParse(c.req.param('entryId'));
    if (!ids || !entryId.success) return apiError(c, 'not_found');

    const found = await withUser(db, user.id, async (trx) => {
      const member = await trx
        .selectFrom('project_members')
        .select('role')
        .where('project_id', '=', ids.projectId)
        .where('user_id', '=', user.id)
        .executeTakeFirst();
      if (!member) return 'not_found' as const;
      if (member.role === 'viewer') return 'forbidden' as const;
      const entry = await trx
        .selectFrom('board_changes')
        .select(['items', 'undone_at'])
        .where('id', '=', entryId.data)
        .where('board_id', '=', ids.boardId)
        .where('project_id', '=', ids.projectId)
        .executeTakeFirst();
      if (!entry) return 'not_found' as const;
      // Taken back once is taken back; the way back is the entry that did it.
      if (entry.undone_at !== null) return 'already_decided' as const;
      return entry;
    });
    if (typeof found === 'string') return apiError(c, found);
    const items = historyItemsSchema.safeParse(found.items);
    // An entry this version cannot read is not listed either.
    if (!items.success) return apiError(c, 'not_found');

    const result = await documents.changeBoard(ids, async (doc, locks) => {
      // What happened on the board until now is written first, so the entry that follows holds
      // the taking back and nothing else. Both read the board before anything else can change it.
      const earlier = documents.recordHistory(ids.boardId);
      const outcome = revertItems(
        doc,
        items.data,
        { kind: 'human', userId: user.id },
        new Set(locks.keys()),
      );
      // With nothing set back, nothing happened: the entry stays and can be tried again.
      const taken =
        outcome.reverted.length > 0
          ? documents.recordHistory(ids.boardId, {
              reverts: entryId.data,
              by: { userId: user.id, name: user.name },
              removed: outcome.removed,
              reverted: outcome.reverted.length,
              kept: outcome.kept.length,
            })
          : Promise.resolve();
      await Promise.all([earlier, taken]);
      return outcome;
    });

    return c.json<BoardHistoryUndo>({
      reverted: result.reverted.length,
      kept: result.kept.length,
    });
  });

  return routes;
}
