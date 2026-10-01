import { randomUUID } from 'node:crypto';

import type { DB } from '@covibes/db';
import {
  addKnowledgeLinkInputSchema,
  KNOWLEDGE_URL_MAX_LENGTH,
  MAX_AGENT_KNOWLEDGE,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  type AgentKnowledgeItem,
} from '@covibes/shared';
import { Hono } from 'hono';
import type { Transaction } from 'kysely';
import { z } from 'zod';

import { KNOWLEDGE_COLUMNS, toKnowledgeEntry } from '@server/agents/knowledge';
import { apiError } from '@server/api/errors';
import { fileHeaders } from '@server/api/files';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { withUser, type AppDb } from '@server/db/database';
import type { RateLimiter } from '@server/rate-limit';
import { cleanFileName, detectFile } from '@server/storage/file-kind';
import type { FileStorage } from '@server/storage/storage';

/** Same limit as the check constraint on `agent_knowledge.name`. */
const NAME_MAX_LENGTH = 200;

function hasCode(error: unknown, code: string): boolean {
  return (error as { code?: unknown } | null)?.code === code;
}

/**
 * Whether one more entry fits. RLS shows the agent to those who may read its instructions; anyone
 * else gets "not found", like for an agent that does not exist.
 */
async function checkRoom(
  trx: Transaction<DB>,
  agentId: string,
): Promise<'not_found' | 'limit_reached' | undefined> {
  const agent = await trx
    .selectFrom('custom_agents')
    .select('id')
    .where('id', '=', agentId)
    .executeTakeFirst();
  if (!agent) return 'not_found';
  const count = await trx
    .selectFrom('agent_knowledge')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('agent_id', '=', agentId)
    .executeTakeFirstOrThrow();
  return Number(count.count) >= MAX_AGENT_KNOWLEDGE ? 'limit_reached' : undefined;
}

/**
 * `/api/agents/:agentId/knowledge` (spec 20b): the files and links of a custom agent. Who may
 * read the agent's instructions sees its knowledge, who may edit the agent maintains it; RLS
 * enforces both, the checks here only make the answers clearer.
 */
export function agentKnowledgeRoutes(
  db: AppDb,
  auth: Auth,
  storage: FileStorage,
  limiter: RateLimiter,
) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  routes.get('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const agentId = z.uuid().safeParse(c.req.param('agentId'));
    if (!agentId.success) return apiError(c, 'not_found');

    const rows = await withUser(db, user.id, async (trx) => {
      const agent = await trx
        .selectFrom('custom_agents')
        .select('id')
        .where('id', '=', agentId.data)
        .executeTakeFirst();
      if (!agent) return undefined;
      return trx
        .selectFrom('agent_knowledge')
        .select(KNOWLEDGE_COLUMNS)
        .where('agent_id', '=', agentId.data)
        .orderBy('created_at')
        .orderBy('id')
        .execute();
    });
    if (!rows) return apiError(c, 'not_found');
    return c.json<AgentKnowledgeItem[]>(rows.map(toKnowledgeEntry));
  });

  // One file per request, as the form field `file`; the same kinds and limits as uploads.
  routes.post('/files', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const agentId = z.uuid().safeParse(c.req.param('agentId'));
    if (!agentId.success) return apiError(c, 'not_found');
    if (!limiter.take(user.id)) return apiError(c, 'too_many_requests');

    const form = await c.req.parseBody().catch(() => undefined);
    const upload = form?.file;
    if (!(upload instanceof File)) return apiError(c, 'invalid_input');
    if (upload.size === 0) return apiError(c, 'invalid_input');
    if (upload.size > MAX_FILE_BYTES) return apiError(c, 'too_large');
    const content = new Uint8Array(await upload.arrayBuffer());
    const name = cleanFileName(upload.name);
    const detected = detectFile(name, content);
    if (!detected) return apiError(c, 'unsupported_file');
    if (detected.kind === 'image' && content.byteLength > MAX_IMAGE_BYTES) {
      return apiError(c, 'too_large');
    }

    const storageKey = randomUUID();
    try {
      const result = await withUser(db, user.id, async (trx) => {
        const failure = await checkRoom(trx, agentId.data);
        if (failure) return failure;
        const row = await trx
          .insertInto('agent_knowledge')
          .values({
            agent_id: agentId.data,
            kind: 'file',
            name,
            file_kind: detected.kind,
            media_type: detected.mediaType,
            size_bytes: content.byteLength,
            storage_key: storageKey,
            created_by: user.id,
          })
          .returning(KNOWLEDGE_COLUMNS)
          .executeTakeFirstOrThrow();
        // Inside the transaction: without the content the row must not exist.
        await storage.put(storageKey, content);
        return toKnowledgeEntry(row);
      });
      if (typeof result === 'string') return apiError(c, result);
      return c.json<AgentKnowledgeItem>(result, 201);
    } catch (error) {
      // Visible but not editable: a viewer of the project the agent is shared in.
      if (hasCode(error, '42501')) return apiError(c, 'forbidden');
      throw error;
    }
  });

  routes.post('/links', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const agentId = z.uuid().safeParse(c.req.param('agentId'));
    if (!agentId.success) return apiError(c, 'not_found');
    const body: unknown = await c.req.json().catch(() => undefined);
    const input = addKnowledgeLinkInputSchema.safeParse(body);
    if (!input.success) return apiError(c, 'invalid_input');
    // The address as a browser would send it, e.g. with spaces encoded.
    const url = new URL(input.data.url).href;
    if (url.length > KNOWLEDGE_URL_MAX_LENGTH) return apiError(c, 'invalid_input');

    try {
      const result = await withUser(db, user.id, async (trx) => {
        const failure = await checkRoom(trx, agentId.data);
        if (failure) return failure;
        const row = await trx
          .insertInto('agent_knowledge')
          .values({
            agent_id: agentId.data,
            kind: 'link',
            name: url.slice(0, NAME_MAX_LENGTH),
            url,
            note: input.data.note,
            created_by: user.id,
          })
          .returning(KNOWLEDGE_COLUMNS)
          .executeTakeFirstOrThrow();
        return toKnowledgeEntry(row);
      });
      if (typeof result === 'string') return apiError(c, result);
      return c.json<AgentKnowledgeItem>(result, 201);
    } catch (error) {
      if (hasCode(error, '42501')) return apiError(c, 'forbidden');
      throw error;
    }
  });

  // A file of the knowledge, for those who see it.
  routes.get('/:itemId/content', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const agentId = z.uuid().safeParse(c.req.param('agentId'));
    const itemId = z.uuid().safeParse(c.req.param('itemId'));
    if (!agentId.success || !itemId.success) return apiError(c, 'not_found');

    const file = await withUser(db, user.id, (trx) =>
      trx
        .selectFrom('agent_knowledge')
        .select(['name', 'file_kind', 'media_type', 'storage_key'])
        .where('id', '=', itemId.data)
        .where('agent_id', '=', agentId.data)
        .where('kind', '=', 'file')
        .executeTakeFirst(),
    );
    const content = file?.storage_key ? await storage.get(file.storage_key) : undefined;
    if (!file || !content) return apiError(c, 'not_found');
    return c.body(
      new Uint8Array(content),
      200,
      fileHeaders({
        name: file.name,
        kind: file.file_kind ?? '',
        mediaType: file.media_type ?? 'application/octet-stream',
        size: content.byteLength,
      }),
    );
  });

  routes.delete('/:itemId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const agentId = z.uuid().safeParse(c.req.param('agentId'));
    const itemId = z.uuid().safeParse(c.req.param('itemId'));
    if (!agentId.success || !itemId.success) return apiError(c, 'not_found');

    const result = await withUser(db, user.id, async (trx) => {
      const deleted = await trx
        .deleteFrom('agent_knowledge')
        .where('id', '=', itemId.data)
        .where('agent_id', '=', agentId.data)
        .returning('storage_key')
        .executeTakeFirst();
      if (deleted) return { storageKey: deleted.storage_key };
      // Visible but not removed: a viewer of the project the agent is shared in.
      const visible = await trx
        .selectFrom('agent_knowledge')
        .select('id')
        .where('id', '=', itemId.data)
        .where('agent_id', '=', agentId.data)
        .executeTakeFirst();
      return visible ? ('forbidden' as const) : ('not_found' as const);
    });
    if (typeof result === 'string') return apiError(c, result);
    if (result.storageKey) await storage.delete(result.storageKey);
    return c.body(null, 204);
  });

  return routes;
}
