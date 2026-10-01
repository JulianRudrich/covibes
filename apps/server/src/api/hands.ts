import type { DB } from '@covibes/db';
import {
  castVoteInputSchema,
  handRaiseSchema,
  projectIdSchema,
  type ApiErrorCode,
  type HandRaise,
} from '@covibes/shared';
import { Hono, type Context } from 'hono';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { isKnownAgentKey } from '@server/chat/rows';
import { withUser, type AppDb } from '@server/db/database';

function membership(trx: Transaction<DB>, projectId: string, userId: string) {
  return trx
    .selectFrom('project_members')
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .select('role')
    .executeTakeFirst();
}

/** SQLSTATEs of the deciding functions (migrations 0008 to 0010) and what they mean for the API. */
const FUNCTION_ERRORS: Readonly<Record<string, ApiErrorCode>> = {
  P0002: 'not_found',
  '42501': 'forbidden',
  '55000': 'already_decided',
  '22023': 'invalid_input',
};

export function functionError(error: unknown): ApiErrorCode | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? FUNCTION_ERRORS[code] : undefined;
}

type Target = 'hand_raises' | 'offers' | 'votes' | 'debates';

/**
 * Runs a deciding function (migration 0008) for an owner or editor. The row must belong to the
 * project of the path; the function checks the role again and that nobody decided before. The
 * function announces the change live itself, through the database.
 */
export async function decideByFunction(
  db: AppDb,
  c: Context<{ Variables: SessionVariables }>,
  /** `open` is the status in which the row can still be decided; "open" unless given. */
  target: { table: Target; idParam: string; open?: string },
  call: (trx: Transaction<DB>, id: string) => Promise<unknown>,
): Promise<Response> {
  const user = c.get('user');
  if (!user) return apiError(c, 'unauthorized');
  const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
  const id = z.uuid().safeParse(c.req.param(target.idParam));
  if (!projectId.success || !id.success) return apiError(c, 'not_found');

  try {
    const outcome = await withUser(db, user.id, async (trx) => {
      const member = await membership(trx, projectId.data, user.id);
      if (!member) return 'not_found' as const;
      const row = await trx
        .selectFrom(target.table)
        .where('id', '=', id.data)
        .where('project_id', '=', projectId.data)
        .select('status')
        .executeTakeFirst();
      if (!row) return 'not_found' as const;
      if (member.role === 'viewer') return 'forbidden' as const;
      if (row.status !== (target.open ?? 'open')) return 'already_decided' as const;
      await call(trx, id.data);
      return 'done' as const;
    });
    if (outcome !== 'done') return apiError(c, outcome);
    return c.body(null, 204);
  } catch (error) {
    const code = functionError(error);
    if (code) return apiError(c, code);
    throw error;
  }
}

/**
 * `/api/projects/:projectId/hands` (spec 15): the open raised hands of the specialists, and
 * listening to or dismissing them (owners and editors).
 */
export function handRoutes(db: AppDb, auth: Auth) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const rows = await withUser(db, user.id, async (trx) => {
      if (!(await membership(trx, projectId.data, user.id))) return undefined;
      return await trx
        .selectFrom('hand_raises')
        .select(['id', 'project_id', 'agent_key', 'reason', 'created_at'])
        .where('project_id', '=', projectId.data)
        .where('status', '=', 'open')
        .orderBy('created_at')
        .orderBy('id')
        .execute();
    });
    if (!rows) return apiError(c, 'not_found');
    const hands = rows.flatMap((row) => {
      if (!isKnownAgentKey(row.agent_key)) return [];
      const hand = handRaiseSchema.safeParse({
        id: row.id,
        projectId: row.project_id,
        agentKey: row.agent_key,
        reason: row.reason,
        createdAt: row.created_at.toISOString(),
      });
      return hand.success ? [hand.data] : [];
    });
    return c.json<HandRaise[]>(hands);
  });

  // "Anhören": the agent speaks; its run is queued by the database function.
  routes.post('/:handId/listen', (c) =>
    decideByFunction(db, c, { table: 'hand_raises', idParam: 'handId' }, (trx, id) =>
      sql`select public.listen_to_hand(${id})`.execute(trx),
    ),
  );

  routes.post('/:handId/dismiss', (c) =>
    decideByFunction(db, c, { table: 'hand_raises', idParam: 'handId' }, (trx, id) =>
      sql`select public.dismiss_hand(${id})`.execute(trx),
    ),
  );

  return routes;
}

/**
 * `/api/projects/:projectId/votes` (spec 16b): owners and editors vote on the card of a moderator
 * message, and owners end a vote early. The database function ends the vote once everyone voted,
 * records the winner as the decision and announces the changed message.
 */
export function voteRoutes(db: AppDb, auth: Auth) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.post('/:voteId/cast', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = castVoteInputSchema.safeParse(body);
    return decideByFunction(db, c, { table: 'votes', idParam: 'voteId' }, (trx, id) => {
      // An option that does not exist is refused by the function ('22023').
      const option = input.success ? input.data.option : -1;
      return sql`select public.cast_vote(${id}, ${option})`.execute(trx);
    });
  });

  routes.post('/:voteId/close', (c) =>
    decideByFunction(db, c, { table: 'votes', idParam: 'voteId' }, (trx, id) =>
      sql`select public.close_vote(${id})`.execute(trx),
    ),
  );

  return routes;
}

/**
 * `/api/projects/:projectId/debates` (spec 18): owners and editors end a running debate early.
 * The turn in progress is finished, then the moderator sums up; the database function announces
 * the changed card.
 */
export function debateRoutes(db: AppDb, auth: Auth) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.post('/:debateId/stop', (c) =>
    decideByFunction(db, c, { table: 'debates', idParam: 'debateId', open: 'running' }, (trx, id) =>
      sql`select public.stop_debate(${id})`.execute(trx),
    ),
  );

  return routes;
}

/**
 * `/api/projects/:projectId/offers` (spec 15): owners and editors accept or decline the
 * moderator's offers of help. Accepting starts the moderator; everyone gets the changed message.
 */
export function offerRoutes(db: AppDb, auth: Auth) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.post('/:offerId/accept', (c) =>
    decideByFunction(db, c, { table: 'offers', idParam: 'offerId' }, (trx, id) =>
      sql`select public.decide_offer(${id}, true)`.execute(trx),
    ),
  );

  routes.post('/:offerId/decline', (c) =>
    decideByFunction(db, c, { table: 'offers', idParam: 'offerId' }, (trx, id) =>
      sql`select public.decide_offer(${id}, false)`.execute(trx),
    ),
  );

  return routes;
}
