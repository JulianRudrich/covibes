import type { DB } from '@covibes/db';
import { planDocumentName } from '@covibes/shared';
import type { Kysely } from 'kysely';
import * as Y from 'yjs';

/**
 * Reads the plan of a project as the collaboration server last stored it (spec 25b). The worker
 * is another process than the server that holds the live documents; what it reads here is at most
 * a few seconds behind what people see, which is enough for an agent's context.
 */
export async function readStoredPlan<T>(
  admin: Kysely<DB>,
  projectId: string,
  read: (doc: Y.Doc) => T,
): Promise<T> {
  const row = await admin
    .selectFrom('yjs_documents')
    .select('state')
    .where('name', '=', planDocumentName(projectId))
    .executeTakeFirst();
  const doc = new Y.Doc();
  try {
    if (row) Y.applyUpdate(doc, new Uint8Array(row.state));
    return read(doc);
  } finally {
    doc.destroy();
  }
}
