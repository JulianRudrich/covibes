import {
  MESSAGE_PAGE_SIZE,
  messageCursorSchema,
  projectIdSchema,
  type MessagePage,
} from '@covibes/shared';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { z } from 'zod';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { selectMessages, toMessage } from '@server/chat/rows';
import { withUser, type AppDb } from '@server/db/database';

const historyInput = z.object({ before: z.string().max(180).optional() });
const preciseTime =
  sql<string>`to_char(messages.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
    'cursor_at',
  );

/** Bounded, exclusive history pages; the legacy latest-message route stays unchanged. */
export function messageHistoryRoutes(db: AppDb, auth: Auth) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));
  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const project = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!project.success) return apiError(c, 'not_found');
    const input = historyInput.safeParse(c.req.query());
    if (!input.success) return apiError(c, 'invalid_input');
    let raw: unknown;
    try {
      raw = input.data.before ? JSON.parse(input.data.before) : undefined;
    } catch {
      return apiError(c, 'invalid_input');
    }
    const cursor = raw === undefined ? undefined : messageCursorSchema.safeParse(raw);
    if (cursor && !cursor.success) return apiError(c, 'invalid_input');
    const page = await withUser(db, user.id, async (trx): Promise<MessagePage | undefined> => {
      const member = await trx
        .selectFrom('project_members')
        .select('role')
        .where('project_id', '=', project.data)
        .where('user_id', '=', user.id)
        .executeTakeFirst();
      if (!member) return undefined;
      let query = selectMessages(trx)
        .select(preciseTime)
        .where('messages.project_id', '=', project.data);
      if (cursor?.success) {
        const { at, id } = cursor.data;
        const timestamp = sql<Date>`${at}::timestamptz`;
        query = query.where((eb) =>
          eb.or([
            eb('messages.created_at', '<', timestamp),
            eb.and([eb('messages.created_at', '=', timestamp), eb('messages.id', '<', id)]),
          ]),
        );
      }
      const rows = await query
        .orderBy('messages.created_at', 'desc')
        .orderBy('messages.id', 'desc')
        .limit(MESSAGE_PAGE_SIZE + 1)
        .execute();
      const shown = rows.slice(0, MESSAGE_PAGE_SIZE);
      const last = shown.at(-1);
      return {
        items: shown
          .reverse()
          .map(toMessage)
          .filter((item) => item !== undefined),
        before:
          rows.length > MESSAGE_PAGE_SIZE && last ? { at: last.cursor_at, id: last.id } : null,
      };
    });
    return page ? c.json<MessagePage>(page) : apiError(c, 'not_found');
  });

  routes.get('/:messageId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const project = projectIdSchema.safeParse(c.req.param('projectId'));
    const id = z.uuid().safeParse(c.req.param('messageId'));
    if (!project.success || !id.success) return apiError(c, 'not_found');
    const page = await withUser(db, user.id, async (trx): Promise<MessagePage | undefined> => {
      const member = await trx
        .selectFrom('project_members')
        .select('role')
        .where('project_id', '=', project.data)
        .where('user_id', '=', user.id)
        .executeTakeFirst();
      if (!member) return undefined;
      const target = await selectMessages(trx)
        .select(preciseTime)
        .where('messages.project_id', '=', project.data)
        .where('messages.id', '=', id.data)
        .executeTakeFirst();
      if (!target) return undefined;
      const at = sql<Date>`${target.cursor_at}::timestamptz`;
      const rows = await selectMessages(trx)
        .select(preciseTime)
        .where('messages.project_id', '=', project.data)
        .where((eb) =>
          eb.or([
            eb('messages.created_at', '<', at),
            eb.and([eb('messages.created_at', '=', at), eb('messages.id', '<=', target.id)]),
          ]),
        )
        .orderBy('messages.created_at', 'desc')
        .orderBy('messages.id', 'desc')
        .limit(MESSAGE_PAGE_SIZE + 1)
        .execute();
      const shown = rows.slice(0, MESSAGE_PAGE_SIZE);
      const last = shown.at(-1);
      return {
        items: shown
          .reverse()
          .map(toMessage)
          .filter((item) => item !== undefined),
        before:
          rows.length > MESSAGE_PAGE_SIZE && last ? { at: last.cursor_at, id: last.id } : null,
      };
    });
    return page ? c.json<MessagePage>(page) : apiError(c, 'not_found');
  });
  return routes;
}
