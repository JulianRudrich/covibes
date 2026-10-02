import type { DB } from '@covibes/db';
import {
  comparisonSchema,
  criterionInputSchema,
  decisionVariantsSchema,
  DECISION_LOG_KINDS,
  DECISION_STATUSES,
  isAgentKey,
  MAX_CRITERIA_PER_PROJECT,
  projectIdSchema,
  reopenDecisionInputSchema,
  voteTallySchema,
  type ApiErrorCode,
  type Criterion,
  type Decision,
  type DecisionLogEntry,
  type DecisionLogKind,
  type DecisionStatus,
  type DecisionVariants,
} from '@covibes/shared';
import { Hono, type Context } from 'hono';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';

import { apiError } from '@server/api/errors';
import { functionError } from '@server/api/hands';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { withUser, type AppDb } from '@server/db/database';
import { readAlternatives } from '@server/tasks/run-decisions';

/** Entries of the decision log one request returns, newest first. */
const LOG_PAGE_SIZE = 200;

type Routes = Context<{ Variables: SessionVariables }>;

function membership(trx: Transaction<DB>, projectId: string, userId: string) {
  return trx
    .selectFrom('project_members')
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .select('role')
    .executeTakeFirst();
}

type Outcome<T> = { ok: true; value: T } | { ok: false; code: ApiErrorCode };

/**
 * Runs `work` for a member of the project of the path; `write` also requires an owner or editor.
 * Unknown, foreign and malformed projects all look the same from outside.
 */
async function forMember<T>(
  db: AppDb,
  c: Routes,
  access: 'read' | 'write',
  work: (
    trx: Transaction<DB>,
    context: { projectId: string; userId: string },
  ) => Promise<Outcome<T>>,
): Promise<Outcome<T>> {
  const user = c.get('user');
  if (!user) return { ok: false, code: 'unauthorized' };
  const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
  if (!projectId.success) return { ok: false, code: 'not_found' };
  return await withUser(db, user.id, async (trx) => {
    const member = await membership(trx, projectId.data, user.id);
    if (!member) return { ok: false, code: 'not_found' };
    if (access === 'write' && member.role === 'viewer') return { ok: false, code: 'forbidden' };
    return await work(trx, { projectId: projectId.data, userId: user.id });
  });
}

/**
 * `/api/projects/:projectId/criteria` (spec 16a): the project criteria. Members read them; owners
 * and editors add, change and remove them. The database logs every change and announces it.
 */
export function criteriaRoutes(db: AppDb, auth: Auth) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const outcome = await forMember(db, c, 'read', async (trx, { projectId }) => ({
      ok: true,
      value: await trx
        .selectFrom('criteria')
        .select(['id', 'text'])
        .where('project_id', '=', projectId)
        .orderBy('created_at')
        .orderBy('id')
        .execute(),
    }));
    if (!outcome.ok) return apiError(c, outcome.code);
    return c.json<Criterion[]>(outcome.value);
  });

  routes.post('/', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = criterionInputSchema.safeParse(body);
    const outcome = await forMember<Criterion>(
      db,
      c,
      'write',
      async (trx, { projectId, userId }) => {
        if (!input.success) return { ok: false, code: 'invalid_input' };
        const existing = await trx
          .selectFrom('criteria')
          .select(['id', 'text'])
          .where('project_id', '=', projectId)
          .execute();
        // The same criterion twice says nothing new.
        const same = existing.find(
          (criterion) => criterion.text.toLowerCase() === input.data.text.toLowerCase(),
        );
        if (same) return { ok: true, value: same };
        if (existing.length >= MAX_CRITERIA_PER_PROJECT)
          return { ok: false, code: 'limit_reached' };
        const created = await trx
          .insertInto('criteria')
          .values({ project_id: projectId, text: input.data.text, created_by: userId })
          .returning(['id', 'text'])
          .executeTakeFirstOrThrow();
        return { ok: true, value: created };
      },
    );
    if (!outcome.ok) return apiError(c, outcome.code);
    return c.json<Criterion>(outcome.value, 201);
  });

  routes.patch('/:criterionId', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = criterionInputSchema.safeParse(body);
    const id = z.uuid().safeParse(c.req.param('criterionId'));
    const outcome = await forMember<Criterion>(db, c, 'write', async (trx, { projectId }) => {
      if (!id.success) return { ok: false, code: 'not_found' };
      if (!input.success) return { ok: false, code: 'invalid_input' };
      const updated = await trx
        .updateTable('criteria')
        .set({ text: input.data.text })
        .where('project_id', '=', projectId)
        .where('id', '=', id.data)
        .returning(['id', 'text'])
        .executeTakeFirst();
      return updated ? { ok: true, value: updated } : { ok: false, code: 'not_found' };
    });
    if (!outcome.ok) return apiError(c, outcome.code);
    return c.json<Criterion>(outcome.value);
  });

  routes.delete('/:criterionId', async (c) => {
    const id = z.uuid().safeParse(c.req.param('criterionId'));
    const outcome = await forMember<null>(db, c, 'write', async (trx, { projectId }) => {
      if (!id.success) return { ok: false, code: 'not_found' };
      const removed = await trx
        .deleteFrom('criteria')
        .where('project_id', '=', projectId)
        .where('id', '=', id.data)
        .executeTakeFirst();
      return removed.numDeletedRows > 0n
        ? { ok: true, value: null }
        : { ok: false, code: 'not_found' };
    });
    if (!outcome.ok) return apiError(c, outcome.code);
    return c.body(null, 204);
  });

  return routes;
}

/** The variants of an applied `variants` proposal with the adopted position, or null. */
function readVariants(operations: unknown, chosen: number | null): DecisionVariants | null {
  const first = Array.isArray(operations) ? (operations[0] as { variants?: unknown }) : undefined;
  const parsed = decisionVariantsSchema.safeParse({ chosen, variants: first?.variants });
  return parsed.success ? parsed.data : null;
}

function isStatus(value: string): value is DecisionStatus {
  return (DECISION_STATUSES as readonly string[]).includes(value);
}

function isLogKind(value: string): value is DecisionLogKind {
  return (DECISION_LOG_KINDS as readonly string[]).includes(value);
}

const logDetailsSchema = z.object({
  reasoning: z.string().optional().catch(undefined),
  reason: z.string().optional().catch(undefined),
  previous: z.string().optional().catch(undefined),
  alternatives: z.unknown().optional(),
  comparisonId: z.string().optional().catch(undefined),
  votes: voteTallySchema.optional().catch(undefined),
});

/**
 * The decisions of a project in the order they came up, each with the comparison it followed, the
 * result of the vote that decided and the variants it chose from. `trx` decides what is visible:
 * a member's transaction, or the one of a read-only link (spec 21b), which reads no people.
 */
export async function loadDecisions(trx: Transaction<DB>, projectId: string): Promise<Decision[]> {
  const rows = await trx
    .selectFrom('decisions')
    .leftJoin('users', 'users.id', 'decisions.decided_by')
    .leftJoin('comparisons', 'comparisons.id', 'decisions.comparison_id')
    .leftJoin('votes', 'votes.id', 'decisions.vote_id')
    .leftJoin('proposals as variants', 'variants.id', 'decisions.variants_id')
    .select([
      'comparisons.data as comparison_data',
      'votes.tally as vote_tally',
      'variants.operations as variants_operations',
      'variants.chosen as variants_chosen',
      'decisions.id',
      'decisions.topic',
      'decisions.status',
      'decisions.value',
      'decisions.reasoning',
      'decisions.alternatives',
      'decisions.decided_at',
      'decisions.reopen_reason',
      'users.name as decided_by',
    ])
    .where('decisions.project_id', '=', projectId)
    .orderBy('decisions.created_at')
    .orderBy('decisions.id')
    .execute();
  return rows.flatMap((row) => {
    const comparison = comparisonSchema.safeParse(row.comparison_data);
    const tally = voteTallySchema.safeParse(row.vote_tally);
    return isStatus(row.status)
      ? [
          {
            id: row.id,
            topic: row.topic,
            status: row.status,
            value: row.value,
            reasoning: row.reasoning,
            alternatives: readAlternatives(row.alternatives),
            decidedBy: row.decided_by,
            decidedAt: row.decided_at?.toISOString() ?? null,
            reopenReason: row.reopen_reason,
            comparison: comparison.success ? comparison.data : null,
            tally: tally.success ? tally.data : null,
            variants: readVariants(row.variants_operations, row.variants_chosen),
          },
        ]
      : [];
  });
}

/**
 * `/api/projects/:projectId/decisions` (spec 16a): the decisions of the project and its decision
 * log for members, and reopening a decision with a reason for owners and editors. Decisions are
 * recorded by the moderator or by confirming its proposal (`/proposals/:id/apply`).
 */
export function decisionRoutes(db: AppDb, auth: Auth) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const outcome = await forMember(db, c, 'read', async (trx, { projectId }) => ({
      ok: true,
      value: await loadDecisions(trx, projectId),
    }));
    if (!outcome.ok) return apiError(c, outcome.code);
    return c.json<Decision[]>(outcome.value);
  });

  routes.get('/log', async (c) => {
    const outcome = await forMember(db, c, 'read', async (trx, { projectId }) => ({
      ok: true,
      value: await trx
        .selectFrom('decision_log')
        .leftJoin('users', 'users.id', 'decision_log.actor_user')
        // The variants a decision chose from stay with its log entry as a snapshot (spec 17).
        .leftJoin('proposals as variants', (join) =>
          join.on(sql`variants.id::text`, '=', sql`decision_log.details ->> 'variantsId'`),
        )
        .select([
          'variants.operations as variants_operations',
          'variants.chosen as variants_chosen',
          'decision_log.id',
          'decision_log.kind',
          'decision_log.decision_id',
          'decision_log.topic',
          'decision_log.value',
          'decision_log.details',
          'decision_log.actor_agent',
          'decision_log.created_at',
          'users.name as actor_name',
        ])
        .where('decision_log.project_id', '=', projectId)
        .orderBy('decision_log.created_at', 'desc')
        .orderBy('decision_log.id')
        .limit(LOG_PAGE_SIZE)
        .execute(),
    }));
    if (!outcome.ok) return apiError(c, outcome.code);
    return c.json<DecisionLogEntry[]>(
      outcome.value.flatMap((row) => {
        if (!isLogKind(row.kind)) return [];
        const details = logDetailsSchema.safeParse(row.details);
        const { reasoning, reason, previous, alternatives, comparisonId, votes } = details.success
          ? details.data
          : {};
        const variants = readVariants(row.variants_operations, row.variants_chosen);
        return [
          {
            id: row.id,
            kind: row.kind,
            decisionId: row.decision_id,
            topic: row.topic,
            value: row.value,
            ...(reasoning ? { reasoning } : {}),
            ...(reason ? { reason } : {}),
            ...(previous ? { previous } : {}),
            ...(votes ? { votes } : {}),
            ...(comparisonId ? { compared: true } : {}),
            ...(variants ? { variants } : {}),
            ...(alternatives === undefined ? {} : { alternatives: readAlternatives(alternatives) }),
            user: row.actor_name,
            agentKey: isAgentKey(row.actor_agent) ? row.actor_agent : null,
            createdAt: row.created_at.toISOString(),
          },
        ];
      }),
    );
  });

  // The database function opens the decision again, logs it and starts the moderator's new round.
  routes.post('/:decisionId/reopen', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = reopenDecisionInputSchema.safeParse(body);
    const id = z.uuid().safeParse(c.req.param('decisionId'));
    try {
      const outcome = await forMember<null>(db, c, 'write', async (trx, { projectId }) => {
        if (!id.success) return { ok: false, code: 'not_found' };
        const decision = await trx
          .selectFrom('decisions')
          .select('status')
          .where('project_id', '=', projectId)
          .where('id', '=', id.data)
          .executeTakeFirst();
        if (!decision) return { ok: false, code: 'not_found' };
        if (!input.success) return { ok: false, code: 'invalid_input' };
        if (decision.status !== 'decided') return { ok: false, code: 'already_decided' };
        await sql`select public.reopen_decision(${id.data}, ${input.data.reason})`.execute(trx);
        return { ok: true, value: null };
      });
      if (!outcome.ok) return apiError(c, outcome.code);
      return c.body(null, 204);
    } catch (error) {
      const code = functionError(error);
      if (code) return apiError(c, code);
      throw error;
    }
  });

  return routes;
}
