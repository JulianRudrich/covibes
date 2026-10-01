import type { DB } from '@covibes/db';
import {
  MESSAGE_PAGE_SIZE,
  parseMentions,
  projectIdSchema,
  sendMessageInputSchema,
  type ChatMessage,
} from '@covibes/shared';
import { Hono } from 'hono';
import type { Transaction } from 'kysely';

import { loadTeamMentionNames } from '@server/api/agents';
import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { selectMessages, toMessage } from '@server/chat/rows';
import { withUser, type AppDb } from '@server/db/database';
import type { LivePublisher } from '@server/realtime/realtime';
import type { RateLimiter } from '@server/rate-limit';

function membership(trx: Transaction<DB>, projectId: string, userId: string) {
  return trx
    .selectFrom('project_members')
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .select('role')
    .executeTakeFirst();
}

/**
 * `/api/projects/:projectId/messages` (spec 06). Reads and writes through `withUser`, so RLS checks
 * every row; the explicit role check only makes the answers clearer (403 for viewers).
 */
export function messageRoutes(db: AppDb, auth: Auth, live: LivePublisher, limiter: RateLimiter) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');

    const messages = await withUser(db, user.id, async (trx) => {
      if (!(await membership(trx, projectId.data, user.id))) return undefined;
      // The latest messages, oldest first.
      const rows = await selectMessages(trx)
        .where('messages.project_id', '=', projectId.data)
        .orderBy('messages.created_at', 'desc')
        .orderBy('messages.id', 'desc')
        .limit(MESSAGE_PAGE_SIZE)
        .execute();
      return rows.reverse();
    });
    if (!messages) return apiError(c, 'not_found');
    return c.json<ChatMessage[]>(
      messages.map(toMessage).filter((message) => message !== undefined),
    );
  });

  routes.post('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = sendMessageInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');
    // Mentions start paid agent runs, so nobody may flood the chat.
    if (!limiter.take(user.id)) return apiError(c, 'too_many_requests');
    const { id, content } = input.data;
    const attachments = input.data.attachments ?? [];

    const result = await withUser(db, user.id, async (trx) => {
      const member = await membership(trx, projectId.data, user.id);
      if (!member) return 'not_found' as const;
      if (member.role === 'viewer') return 'forbidden' as const;

      // Only agents of the team answer (spec 14); other mentions stay plain text. Catalog agents
      // go by their fixed names, custom agents by their handle (spec 19).
      const names = await loadTeamMentionNames(trx, projectId.data);
      // Files to take along (spec 20a): the sender's own uploads in this project that are attached
      // to nothing yet, or to this very message when it is sent again.
      if (attachments.length > 0) {
        const usable = await trx
          .selectFrom('files')
          .select('id')
          .where('id', 'in', attachments)
          .where('project_id', '=', projectId.data)
          .where('uploaded_by', '=', user.id)
          .where((eb) => eb.or([eb('message_id', 'is', null), eb('message_id', '=', id)]))
          .execute();
        if (usable.length !== attachments.length) return 'invalid_input' as const;
      }
      // Sending the same id again (e.g. after a lost answer) returns the stored message.
      const inserted = await trx
        .insertInto('messages')
        .values({
          id,
          project_id: projectId.data,
          author_kind: 'human',
          author_user_id: user.id,
          content,
          mentions: parseMentions(content, names),
        })
        .onConflict((conflict) => conflict.column('id').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (inserted && attachments.length > 0) {
        await trx
          .updateTable('files')
          .set({ message_id: id })
          .where('id', 'in', attachments)
          .where('message_id', 'is', null)
          .execute();
      }
      const row = await selectMessages(trx).where('messages.id', '=', id).executeTakeFirst();
      const message = row && toMessage(row);
      const ownMessage =
        message?.projectId === projectId.data &&
        message.author.kind === 'human' &&
        message.author.userId === user.id;
      if (!ownMessage) return 'invalid_input' as const;
      return { message, created: inserted !== undefined };
    });

    if (typeof result === 'string') return apiError(c, result);
    if (result.created) live.publish(projectId.data, { type: 'message', message: result.message });
    return c.json<ChatMessage>(result.message, result.created ? 201 : 200);
  });

  return routes;
}
