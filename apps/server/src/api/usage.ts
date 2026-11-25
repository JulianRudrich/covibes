import {
  projectIdSchema,
  usageMonthSchema,
  type UsageOverview,
  type UsageState,
} from '@covibes/shared';
import { Hono } from 'hono';
import { sql } from 'kysely';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { withUser, type AppDb } from '@server/db/database';
import { usageStateOf, type UsageLimits } from '@server/usage/limits';
import { loadUsageOverview, usageMonthOf } from '@server/usage/overview';

function sqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * `/api/projects/:projectId/usage` (spec 31): what the AI cost, and what its limits say.
 *
 * `/state` is what members learn of the limits. The database gives the totals that count for the
 * person who asks (the project's month, their own day); the answer only says whether a limit is
 * reached and until when, never a number. The worker checks the same limits before every model
 * call.
 *
 * `/` is the usage of one month for the project's owners (part 31b), with its numbers.
 */
export function usageRoutes(
  db: AppDb,
  auth: Auth,
  limits: UsageLimits,
  now: () => Date = () => new Date(),
  readInstanceTotal?: (at: Date) => Promise<number>,
) {
  if ((limits.instanceMonthUsd ?? 0) > 0 && !readInstanceTotal) {
    throw new Error('An operator aggregate reader is required for instance limit state');
  }
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/state', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');
    try {
      const totals = await withUser(db, user.id, async (trx) => {
        const read = await sql<{ project_month: string; user_day: string }>`
          select project_month, user_day from public.usage_totals(${projectId.data})`.execute(trx);
        return read.rows[0];
      });
      const at = now();
      // The app role cannot query a global amount. Only after membership succeeds does this
      // operator-owned reader calculate the coarse state; its amount never leaves this route.
      const instanceTotal =
        (limits.instanceMonthUsd ?? 0) > 0 && readInstanceTotal ? await readInstanceTotal(at) : 0;
      return c.json<UsageState>(
        usageStateOf(
          limits,
          {
            projectMonthUsd: Number(totals?.project_month ?? 0),
            userDayUsd: Number(totals?.user_day ?? 0),
            instanceMonthUsd: instanceTotal,
          },
          at,
        ),
      );
    } catch (error) {
      if (sqlState(error) === 'P0002') return apiError(c, 'not_found');
      throw error;
    }
  });

  // The running month, or with `?month=2026-09` one before it.
  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');
    const at = now();
    const running = usageMonthOf(at);
    const month = usageMonthSchema.safeParse(c.req.query('month') ?? running);
    // A month that has not begun has no usage to show.
    if (!month.success || month.data > running) return apiError(c, 'invalid_input');

    const overview = await withUser(db, user.id, async (trx) => {
      const member = await trx
        .selectFrom('project_members')
        .select('role')
        .where('project_id', '=', projectId.data)
        .where('user_id', '=', user.id)
        .executeTakeFirst();
      if (!member) return 'not_found';
      // The database shows the rows to owners only; say so instead of an empty month.
      if (member.role !== 'owner') return 'forbidden';
      return loadUsageOverview(trx, projectId.data, month.data, limits, at);
    });
    if (typeof overview === 'string') return apiError(c, overview);
    return c.json<UsageOverview>(overview);
  });

  return routes;
}
