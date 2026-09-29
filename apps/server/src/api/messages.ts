import type { DB } from '@covibes/db';
import {
  AGENT_KEYS,
  MESSAGE_PAGE_SIZE,
  MESSAGE_STATUSES,
  parseMentions,
  projectIdSchema,
  sendMessageInputSchema,
  type AgentKey,
  type ChatMessage,
  type MessageStatus,
} from '@covibes/shared';
import { Hono } from 'hono';
import type { Transaction } from 'kysely';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { withUser, type AppDb } from '@server/db/database';
import type { LivePublisher } from '@server/realtime/realtime';

function isAgentKey(value: string | null): value is AgentKey {
  return (AGENT_KEYS as readonly (string | null)[]).includes(value);
}

function isStatus(value: string): value is MessageStatus {
  return (MESSAGE_STATUSES as readonly string[]).includes(value);
}

function selectMessages(trx: Transaction<DB>) {
  return trx
    .selectFrom('messages')
    .leftJoin('users', 'users.id', 'messages.author_user_id')
    .select([
      'messages.id',
      'messages.project_id',
      'messages.author_kind',
      'messages.author_user_id',
      'messages.author_agent_key',
      'users.name as author_name',
      'messages.content',
      'messages.mentions',
      'messages.reply_to',
      'messages.status',
      'messages.created_at',
      'messages.updated_at',
    ]);
}

type MessageRow = Awaited<ReturnType<ReturnType<typeof selectMessages>['executeTakeFirstOrThrow']>>;

/** The API form of a row. Agents that this version does not know yet are left out. */
function toMessage(row: MessageRow): ChatMessage | undefined {
  let author: ChatMessage['author'];
  if (row.author_kind === 'agent') {
    if (!isAgentKey(row.author_agent_key)) return undefined;
    author = { kind: 'agent', agentKey: row.author_agent_key };
  } else {
    if (!row.author_user_id) return undefined;
    author = { kind: 'human', userId: row.author_user_id, name: row.author_name ?? '' };
  }
  return {
    id: row.id,
    projectId: row.project_id,
    author,
    content: row.content,
    mentions: row.mentions.filter(isAgentKey),
    replyTo: row.reply_to,
    status: isStatus(row.status) ? row.status : 'complete',
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

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
export function messageRoutes(db: AppDb, auth: Auth, live: LivePublisher) {
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
    const { id, content } = input.data;

    const result = await withUser(db, user.id, async (trx) => {
      const member = await membership(trx, projectId.data, user.id);
      if (!member) return 'not_found' as const;
      if (member.role === 'viewer') return 'forbidden' as const;

      // Sending the same id again (e.g. after a lost answer) returns the stored message.
      const inserted = await trx
        .insertInto('messages')
        .values({
          id,
          project_id: projectId.data,
          author_kind: 'human',
          author_user_id: user.id,
          content,
          mentions: parseMentions(content),
        })
        .onConflict((conflict) => conflict.column('id').doNothing())
        .returning('id')
        .executeTakeFirst();
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
