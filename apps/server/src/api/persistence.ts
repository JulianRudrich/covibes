import {
  boardDocumentName,
  projectIdFromPlanDocumentName,
  boardIdFromDocumentName,
  persistenceReceiptSchema,
} from '@covibes/shared';
import { Hono } from 'hono';
import { z } from 'zod';

import { apiError } from '@server/api/errors';
import type { Auth } from '@server/auth/auth';
import type { BoardDocuments } from '@server/collab/collab';
import { withUser, type Database } from '@server/db/database';
import { sameSecret } from '@server/secrets';

const flushSchema = z.object({ documentName: z.string().min(1).max(100) });
const commandSchema = z.object({ commandId: z.uuid().optional() });

export function persistenceRoutes(deps: {
  db: Database;
  auth: Auth;
  documents: BoardDocuments;
  token?: string;
}) {
  const routes = new Hono();

  routes.post('/documents/flush', async (c) => {
    const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return apiError(c, 'unauthorized');
    const parsed = flushSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return apiError(c, 'invalid_input');
    const { documentName } = parsed.data;
    const boardId = boardIdFromDocumentName(documentName);
    const planOf = boardId ? undefined : projectIdFromPlanDocumentName(documentName);
    if (!boardId && !planOf) return apiError(c, 'invalid_input');
    const exists = await withUser(deps.db.app, session.user.id, (trx) =>
      boardId
        ? trx.selectFrom('boards').select('id').where('id', '=', boardId).executeTakeFirst()
        : trx
            .selectFrom('projects')
            .select('id')
            .where('id', '=', planOf ?? '')
            .executeTakeFirst(),
    );
    if (!exists) return apiError(c, 'not_found');
    if (!deps.documents.flushDocument) return c.json({ status: 'unavailable' }, 503);
    await deps.documents.flushDocument(documentName);
    return c.json(
      persistenceReceiptSchema.parse({ status: 'saved', savedAt: new Date().toISOString() }),
    );
  });

  routes.post('/internal/boards/:boardId/flush', async (c) => {
    const token = c.req.header('x-internal-token');
    if (!deps.token || !token || !sameSecret(token, deps.token)) return apiError(c, 'forbidden');
    const id = z.uuid().safeParse(c.req.param('boardId'));
    const command = commandSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!id.success || !command.success) return apiError(c, 'invalid_input');
    const board = await deps.db.admin
      .selectFrom('boards')
      .select('id')
      .where('id', '=', id.data)
      .executeTakeFirst();
    if (!board) return apiError(c, 'not_found');
    if (!deps.documents.flushDocument) return c.json({ status: 'unavailable' }, 503);
    await deps.documents.flushDocument(boardDocumentName(id.data), command.data.commandId);
    return c.json({ status: 'saved' });
  });

  return routes;
}
