import {
  markNotificationsReadInputSchema,
  NOTIFICATION_PAGE_SIZE,
  notificationSchema,
  type Notification,
  type NotificationList,
} from '@covibes/shared';
import { Hono } from 'hono';
import { sql } from 'kysely';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { withUser, type AppDb } from '@server/db/database';

/**
 * `/api/notifications` (spec 22a): the notifications of the signed-in person across all projects,
 * and marking them as read. The database writes them (triggers) and shows everyone only their
 * own.
 */
export function notificationRoutes(db: AppDb, auth: Auth) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');

    const result = await withUser(db, user.id, async (trx) => {
      const rows = await trx
        .selectFrom('notifications')
        .select([
          'id',
          'kind',
          'project_id',
          'project_name',
          'actor_name',
          'excerpt',
          'role',
          'created_at',
          'read_at',
        ])
        .orderBy('created_at', 'desc')
        .orderBy('id')
        .limit(NOTIFICATION_PAGE_SIZE)
        .execute();
      const unread = await trx
        .selectFrom('notifications')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('read_at', 'is', null)
        .executeTakeFirstOrThrow();
      return { rows, unread: Number(unread.count) };
    });
    return c.json<NotificationList>({
      notifications: result.rows.flatMap((row): Notification[] => {
        const notification = notificationSchema.safeParse({
          id: row.id,
          kind: row.kind,
          projectId: row.project_id,
          projectName: row.project_name,
          actorName: row.actor_name,
          excerpt: row.excerpt,
          role: row.role,
          createdAt: row.created_at.toISOString(),
          read: row.read_at !== null,
        });
        // A kind from a later version is left out.
        return notification.success ? [notification.data] : [];
      }),
      unread: result.unread,
    });
  });

  routes.post('/read', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = markNotificationsReadInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');
    const target = input.data;

    // RLS limits the update to the person's own notifications.
    await withUser(db, user.id, (trx) =>
      trx
        .updateTable('notifications')
        .set({ read_at: sql`now()` })
        .where('read_at', 'is', null)
        .$if('ids' in target, (query) => query.where('id', 'in', 'ids' in target ? target.ids : []))
        // Opening a project reads its mentions; what else happened there stays until it is seen.
        .$if('projectId' in target, (query) =>
          query
            .where('project_id', '=', 'projectId' in target ? target.projectId : '')
            .where('kind', '=', 'mention'),
        )
        .execute(),
    );
    return c.body(null, 204);
  });

  return routes;
}
