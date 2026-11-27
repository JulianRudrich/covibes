import type { DB } from '@covibes/db';
import type { Task } from 'graphile-worker';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import type { FileStorage } from '@server/storage/storage';

export const FILE_CLEANUP_TASK = 'file_cleanup';
const payloadSchema = z.object({ key: z.uuid() });

/** Durable, idempotent physical cleanup after a metadata transaction has committed. */
export async function cleanStoredFile(admin: Kysely<DB>, files: FileStorage, key: string) {
  return admin.transaction().execute(async (trx) => {
    const pending = await trx
      .selectFrom('file_cleanup')
      .select('storage_key')
      .where('storage_key', '=', key)
      .forUpdate()
      .executeTakeFirst();
    if (!pending) return 'nothing' as const;
    const [file, knowledge] = await Promise.all([
      trx.selectFrom('files').select('id').where('storage_key', '=', key).executeTakeFirst(),
      trx
        .selectFrom('agent_knowledge')
        .select('id')
        .where('storage_key', '=', key)
        .executeTakeFirst(),
    ]);
    if (!file && !knowledge) await files.delete(key);
    await trx.deleteFrom('file_cleanup').where('storage_key', '=', key).execute();
    return file || knowledge ? ('referenced' as const) : ('deleted' as const);
  });
}

export function fileCleanupTask(admin: Kysely<DB>, files: FileStorage): Task {
  return async (payload) => {
    const { key } = payloadSchema.parse(payload);
    try {
      await cleanStoredFile(admin, files, key);
    } catch {
      // A fresh follow-up job avoids silently exhausting the worker's retry count.
      // The durable row remains until physical cleanup succeeds, including on restart.
      await admin.transaction().execute(async (trx) => {
        await trx
          .updateTable('file_cleanup')
          .set({
            attempts: sql`attempts + 1`,
            last_error_at: new Date(),
          })
          .where('storage_key', '=', key)
          .execute();
        await sql`select graphile_worker.add_job(${FILE_CLEANUP_TASK}::text,
          json_build_object('key',${key}::text)::json,
          run_at:=now()+interval '5 minutes', job_key:=('file_cleanup:'||${key}::text))`.execute(
          trx,
        );
      });
      console.warn('Covibes file cleanup is pending; the worker scheduled another attempt.');
    }
  };
}
