import { randomUUID } from 'node:crypto';

import type { DB } from '@covibes/db';
import {
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  messageAttachmentSchema,
  projectIdSchema,
  type MessageAttachment,
} from '@covibes/shared';
import { Hono } from 'hono';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import { sessionMiddleware, type SessionVariables } from '@server/auth/session';
import { withUser, type AppDb } from '@server/db/database';
import type { RateLimiter } from '@server/rate-limit';
import { cleanFileName, detectFile } from '@server/storage/file-kind';
import type { FileStorage } from '@server/storage/storage';

/** Uploads one person may start per minute across all projects. */
export const UPLOADS_PER_MINUTE = 30;

/** An upload that was never attached to a message is removed after this long. */
const UNATTACHED_LIFETIME = sql`interval '1 day'`;

function membership(trx: Transaction<DB>, projectId: string, userId: string) {
  return trx
    .selectFrom('project_members')
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .select('role')
    .executeTakeFirst();
}

/** `filename*` of Content-Disposition: the name percent-encoded as UTF-8 (RFC 5987). */
function encodedFileName(name: string): string {
  return encodeURIComponent(name).replace(/['()*]/g, (character) => {
    return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
  });
}

/**
 * `/api/projects/:projectId/files` (spec 20a): owners and editors upload files to attach to their
 * next message; members open them. The server decides what a file is by its content, and serves
 * everything with headers that keep the browser from running it.
 */
export function fileRoutes(db: AppDb, auth: Auth, storage: FileStorage, limiter: RateLimiter) {
  const routes = new Hono<{ Variables: SessionVariables }>();
  routes.use(sessionMiddleware(auth));

  // One file per request, as the form field `file`.
  routes.post('/', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    if (!projectId.success) return apiError(c, 'not_found');
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
    const result = await withUser(db, user.id, async (trx) => {
      const member = await membership(trx, projectId.data, user.id);
      if (!member) return 'not_found' as const;
      if (member.role === 'viewer') return 'forbidden' as const;
      // Uploads the person never sent make room again.
      const stale = await trx
        .deleteFrom('files')
        .where('uploaded_by', '=', user.id)
        .where('message_id', 'is', null)
        .where('created_at', '<', sql<Date>`now() - ${UNATTACHED_LIFETIME}`)
        .returning('storage_key')
        .execute();
      const row = await trx
        .insertInto('files')
        .values({
          project_id: projectId.data,
          uploaded_by: user.id,
          name,
          kind: detected.kind,
          media_type: detected.mediaType,
          size_bytes: content.byteLength,
          storage_key: storageKey,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      // Inside the transaction: without the content the row must not exist.
      await storage.put(storageKey, content);
      return { id: row.id, stale: stale.map((file) => file.storage_key) };
    });
    if (typeof result === 'string') return apiError(c, result);
    await Promise.all(result.stale.map((key) => storage.delete(key)));

    return c.json<MessageAttachment>(
      messageAttachmentSchema.parse({
        id: result.id,
        name,
        kind: detected.kind,
        mediaType: detected.mediaType,
        sizeBytes: content.byteLength,
      }),
      201,
    );
  });

  routes.get('/:fileId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    const fileId = z.uuid().safeParse(c.req.param('fileId'));
    if (!projectId.success || !fileId.success) return apiError(c, 'not_found');

    // RLS shows the row to members only.
    const file = await withUser(db, user.id, (trx) =>
      trx
        .selectFrom('files')
        .select(['name', 'kind', 'media_type', 'storage_key'])
        .where('id', '=', fileId.data)
        .where('project_id', '=', projectId.data)
        .executeTakeFirst(),
    );
    const content = file && (await storage.get(file.storage_key));
    if (!file || !content) return apiError(c, 'not_found');

    // Only images are shown in the browser; everything else is a download, and text is never
    // served as something the browser would run.
    const inline = file.kind === 'image';
    const contentType = file.kind === 'text' ? 'text/plain; charset=utf-8' : file.media_type;
    return c.body(new Uint8Array(content), 200, {
      'content-type': contentType,
      'content-length': String(content.byteLength),
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodedFileName(file.name)}`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=3600',
    });
  });

  // Takes back an upload before its message is sent; attached files stay.
  routes.delete('/:fileId', async (c) => {
    const user = c.get('user');
    if (!user) return apiError(c, 'unauthorized');
    const projectId = projectIdSchema.safeParse(c.req.param('projectId'));
    const fileId = z.uuid().safeParse(c.req.param('fileId'));
    if (!projectId.success || !fileId.success) return apiError(c, 'not_found');

    const deleted = await withUser(db, user.id, (trx) =>
      trx
        .deleteFrom('files')
        .where('id', '=', fileId.data)
        .where('project_id', '=', projectId.data)
        .returning('storage_key')
        .executeTakeFirst(),
    );
    if (!deleted) return apiError(c, 'not_found');
    await storage.delete(deleted.storage_key);
    return c.body(null, 204);
  });

  return routes;
}
