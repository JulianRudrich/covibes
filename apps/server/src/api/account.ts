import { Hono } from 'hono';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { withUser, type AppDb } from '@server/db/database';

/** Personal data only, through the normal application role and its access policies. */
export function accountRoutes(db: AppDb, auth: Auth) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));
  routes.get('/export', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return apiError(c, 'unauthorized');
    const data = await withUser(db, user.id, async (trx) => {
      const memberships = await trx
        .selectFrom('project_members')
        .where('user_id', '=', user.id)
        .select(['project_id', 'role', 'created_at'])
        .execute();
      const messages = await trx
        .selectFrom('messages')
        .where('author_user_id', '=', user.id)
        .select(['id', 'project_id', 'content', 'created_at', 'updated_at'])
        .execute();
      const agents = await trx
        .selectFrom('custom_agents')
        .where('owner_id', '=', user.id)
        .select(['id', 'project_id', 'name', 'role', 'instructions', 'created_at'])
        .execute();
      const files = await trx
        .selectFrom('files')
        .where('uploaded_by', '=', user.id)
        .select(['id', 'project_id', 'name', 'kind', 'media_type', 'size_bytes', 'created_at'])
        .execute();
      const notifications = await trx
        .selectFrom('notifications')
        .where('user_id', '=', user.id)
        .select(['id', 'kind', 'project_id', 'excerpt', 'created_at', 'read_at'])
        .execute();
      const notificationSettings = await trx
        .selectFrom('notification_settings')
        .where('user_id', '=', user.id)
        .select(['email'])
        .executeTakeFirst();
      return { memberships, messages, agents, files, notifications, notificationSettings };
    });
    c.header('Cache-Control', 'no-store');
    c.header('Content-Disposition', 'attachment; filename="covibes-personal-data.json"');
    return c.json({
      format: 'covibes-personal-data-v1',
      exportedAt: new Date().toISOString(),
      profile: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        locale: session.user.locale,
        createdAt: session.user.createdAt,
      },
      ...data,
    });
  });
  return routes;
}
