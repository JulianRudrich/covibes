import { projectIdSchema, type AiRun } from '@covibes/shared';
import { Hono } from 'hono';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { selectRuns, toRun } from '@server/chat/rows';
import { withUser, type AppDb } from '@server/db/database';

/**
 * `GET /api/projects/:projectId/runs` (spec 07): the agent runs that still wait or work, oldest
 * first. The chat derives its status pill from them after a reload; later changes arrive live.
 */
export function runRoutes(db: AppDb, auth: Auth) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const runs = await withUser(db, user.id, async (trx) => {
      const member = await trx
        .selectFrom('project_members')
        .where('project_id', '=', projectId.data)
        .where('user_id', '=', user.id)
        .select('role')
        .executeTakeFirst();
      if (!member) return undefined;
      return selectRuns(trx)
        .where('project_id', '=', projectId.data)
        .where('status', 'in', ['queued', 'running'])
        .orderBy('created_at')
        .orderBy('id')
        .execute();
    });
    if (!runs) return apiError(c, 'not_found');
    return c.json<AiRun[]>(runs.map(toRun).filter((run) => run !== undefined));
  });

  return routes;
}
