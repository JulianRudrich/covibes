import { projectIdSchema, type UsageState } from '@covibes/shared';
import { Hono } from 'hono';
import { sql } from 'kysely';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { withUser, type AppDb } from '@server/db/database';
import { usageStateOf, type UsageLimits } from '@server/usage/limits';

function sqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * `/api/projects/:projectId/usage` (spec 31a): what members learn of the limits of the AI. The
 * database gives the totals that count for the person who asks (the project's month, their own
 * day); the answer only says whether a limit is reached and until when, never a number. The
 * worker checks the same limits before every model call.
 */
export function usageRoutes(
  db: AppDb,
  auth: Auth,
  limits: UsageLimits,
  now: () => Date = () => new Date(),
) {
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
      return c.json<UsageState>(
        usageStateOf(
          limits,
          {
            projectMonthUsd: Number(totals?.project_month ?? 0),
            userDayUsd: Number(totals?.user_day ?? 0),
          },
          now(),
        ),
      );
    } catch (error) {
      if (sqlState(error) === 'P0002') return apiError(c, 'not_found');
      throw error;
    }
  });

  return routes;
}
