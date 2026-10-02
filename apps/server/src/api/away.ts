import {
  AWAY_AUTHORS_SHOWN,
  projectIdSchema,
  type Author,
  type AwayAuthor,
  type AwayBoard,
  type AwayDecision,
  type AwaySummary,
  type AwayTextStatus,
  type CanvasEdge,
  type CanvasNode,
} from '@covibes/shared';
import { Hono } from 'hono';
import { sql } from 'kysely';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { isKnownAgentKey } from '@server/chat/rows';
import type { BoardDocuments } from '@server/collab/collab';
import { withUser, type AppDb } from '@server/db/database';

/** The worker writes the moderator's words within seconds; after this long none will come. */
export const TEXT_WAIT_MS = 2 * 60_000;
/** Decisions the summary lists; whoever was away for longer finds the rest in the log. */
const DECISIONS_SHOWN = 20;

const TEXT_STATUSES: readonly string[] = ['none', 'pending', 'done', 'failed'];

function isTextStatus(value: string): value is AwayTextStatus {
  return TEXT_STATUSES.includes(value);
}

/** One key per author, so changes and messages of the same one add up. */
function authorKey(author: Author): string {
  return author.kind === 'human' ? `human:${author.userId}` : `agent:${author.agentKey}`;
}

/** Counted authors, the busiest first. */
type Counted = { author: Author; count: number }[];

function count(authors: readonly Author[]): Counted {
  const counted = new Map<string, { author: Author; count: number }>();
  for (const author of authors) {
    const key = authorKey(author);
    const entry = counted.get(key);
    if (entry) entry.count += 1;
    else counted.set(key, { author, count: 1 });
  }
  return [...counted.values()].sort((a, b) => b.count - a.count);
}

/**
 * The elements of a board that someone else added or changed in the period. An element counts
 * with its latest change: what was changed again since, or deleted, is not in the board anymore.
 */
export function boardChanges(
  content: { nodes: readonly CanvasNode[]; edges: readonly CanvasEdge[] },
  period: { from: Date; until: Date },
  userId: string,
): Counted {
  const from = period.from.getTime();
  const until = period.until.getTime();
  return count(
    [...content.nodes, ...content.edges].flatMap((element) => {
      const at = Date.parse(element.lastChangedAt);
      const by = element.lastChangedBy;
      if (!(at > from && at <= until)) return [];
      return by.kind === 'human' && by.userId === userId ? [] : [by];
    }),
  );
}

/** The authors a row names, with the people's names; someone whose name is gone is left out. */
function shown(counted: Counted, names: ReadonlyMap<string, string>): AwayAuthor[] {
  return counted
    .flatMap(({ author }): AwayAuthor[] => {
      if (author.kind === 'agent') return [{ kind: 'agent', agentKey: author.agentKey }];
      const name = names.get(author.userId);
      return name ? [{ kind: 'human', name }] : [];
    })
    .slice(0, AWAY_AUTHORS_SHOWN);
}

/**
 * `/api/projects/:projectId/away` (spec 23): what happened while the user did not have the
 * project open. The database notes the absence when the user comes back (`touch_project_seen`);
 * here it is filled with what the project recorded in that time. RLS shows everyone their own.
 */
export function awayRoutes(db: AppDb, auth: Auth, documents: Pick<BoardDocuments, 'readBoard'>) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const summary = await withUser(db, user.id, async (trx): Promise<AwaySummary | null> => {
      const noted = await trx
        .selectFrom('away_summaries')
        .select(['away_from', 'back_at', 'text', 'text_status', 'dismissed_at'])
        .where('project_id', '=', projectId.data)
        .where('user_id', '=', user.id)
        .executeTakeFirst();
      if (!noted || noted.dismissed_at) return null;
      const period = { from: noted.away_from, until: noted.back_at };

      const log = await trx
        .selectFrom('decision_log')
        .select(['id', 'kind', 'decision_id', 'topic', 'value'])
        .where('project_id', '=', projectId.data)
        .where('created_at', '>', period.from)
        .where('created_at', '<=', period.until)
        .orderBy('created_at')
        .orderBy('id')
        .execute();
      // A decision that was made, reopened and made again shows as it stood in the end.
      const latest = new Map<string, AwayDecision>();
      for (const entry of log) {
        if (entry.kind !== 'decided' && entry.kind !== 'reopened') continue;
        const key = entry.decision_id ?? entry.id;
        latest.delete(key);
        latest.set(key, {
          id: entry.id,
          kind: entry.kind,
          decisionId: entry.decision_id,
          topic: entry.topic ?? '',
          value: entry.value,
        });
      }
      const decisions = [...latest.values()].slice(-DECISIONS_SHOWN);
      const criteriaChanges = log.filter((entry) => entry.kind.startsWith('criterion_')).length;

      const written = await trx
        .selectFrom('messages')
        .select((eb) => [
          'author_user_id',
          'author_agent_key',
          eb.fn.countAll<string>().as('count'),
          eb.fn
            .countAll<string>()
            .filterWhere(sql<boolean>`${user.id}::uuid = any(mentioned_users)`)
            .as('mentions'),
        ])
        .where('project_id', '=', projectId.data)
        .where('status', '=', 'complete')
        .where('created_at', '>', period.from)
        .where('created_at', '<=', period.until)
        .where((eb) =>
          eb.or([eb('author_user_id', 'is', null), eb('author_user_id', '<>', user.id)]),
        )
        .groupBy(['author_user_id', 'author_agent_key'])
        .execute();
      const writers: Counted = written
        .flatMap((row): Counted => {
          const total = Number(row.count);
          if (row.author_user_id) {
            return [{ author: { kind: 'human', userId: row.author_user_id }, count: total }];
          }
          return isKnownAgentKey(row.author_agent_key)
            ? [{ author: { kind: 'agent', agentKey: row.author_agent_key }, count: total }]
            : [];
        })
        .sort((a, b) => b.count - a.count);

      const boardRows = await trx
        .selectFrom('boards')
        .select(['id', 'title', 'created_at'])
        .where('project_id', '=', projectId.data)
        .orderBy('kind', 'desc') // 'main' before 'extra'
        .orderBy('position')
        .orderBy('created_at')
        .execute();
      const changedBoards = (
        await Promise.all(
          boardRows.map(async (board) => ({
            board,
            changes: boardChanges(await documents.readBoard(board.id), period, user.id),
            isNew: board.created_at > period.from && board.created_at <= period.until,
          })),
        )
      ).filter(({ changes, isNew }) => isNew || changes.length > 0);

      const messageCount = written.reduce((sum, row) => sum + Number(row.count), 0);
      if (
        decisions.length === 0 &&
        criteriaChanges === 0 &&
        changedBoards.length === 0 &&
        messageCount === 0
      ) {
        return null;
      }

      // Names of the people involved; RLS shows those of current and former members.
      const userIds = [
        ...new Set(
          [...writers, ...changedBoards.flatMap(({ changes }) => changes)].flatMap(({ author }) =>
            author.kind === 'human' ? [author.userId] : [],
          ),
        ),
      ];
      const people =
        userIds.length > 0
          ? await trx
              .selectFrom('users')
              .select(['id', 'name'])
              .where('id', 'in', userIds)
              .execute()
          : [];
      const names = new Map(people.map((person) => [person.id, person.name]));

      const waited = Date.now() - noted.back_at.getTime();
      const status = isTextStatus(noted.text_status) ? noted.text_status : 'none';
      const textStatus: AwayTextStatus =
        status === 'pending' && waited > TEXT_WAIT_MS
          ? 'failed'
          : status === 'done' && !noted.text
            ? 'none'
            : status;

      return {
        since: noted.away_from.toISOString(),
        until: noted.back_at.toISOString(),
        text: textStatus === 'done' ? noted.text : null,
        textStatus,
        decisions,
        criteriaChanges,
        boards: changedBoards.map(({ board, changes, isNew }): AwayBoard => ({
          boardId: board.id,
          title: board.title,
          isNew,
          changed: changes.reduce((sum, entry) => sum + entry.count, 0),
          by: shown(changes, names),
          authors: changes.length,
        })),
        messages: {
          count: messageCount,
          mentions: written.reduce((sum, row) => sum + Number(row.mentions), 0),
          by: shown(writers, names),
          authors: writers.length,
        },
      };
    });
    return c.json<AwaySummary | null>(summary);
  });

  // "Verstanden": the summary is read and stays closed until the next return.
  routes.post('/dismiss', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const member = await withUser(db, user.id, async (trx) => {
      const membership = await trx
        .selectFrom('project_members')
        .select('role')
        .where('project_id', '=', projectId.data)
        .where('user_id', '=', user.id)
        .executeTakeFirst();
      if (!membership) return false;
      await trx
        .updateTable('away_summaries')
        .set({ dismissed_at: sql`now()` })
        .where('project_id', '=', projectId.data)
        .where('user_id', '=', user.id)
        .where('dismissed_at', 'is', null)
        .execute();
      return true;
    });
    if (!member) return apiError(c, 'not_found');
    return c.body(null, 204);
  });

  return routes;
}
