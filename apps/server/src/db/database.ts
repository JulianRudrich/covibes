import type { DB } from '@covibes/db';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';

import type { ServerEnv } from '@server/env';

export type AppDb = Kysely<DB>;

export type Database = {
  /** Role covibes_app: every request on behalf of a user. RLS applies, always via `withUser`. */
  app: AppDb;
  /** Role covibes_admin: only for the login library (and later the worker). */
  adminPool: pg.Pool;
  close: () => Promise<void>;
};

export function createDatabase(
  env: Pick<ServerEnv, 'DATABASE_URL' | 'DATABASE_ADMIN_URL'>,
): Database {
  const app = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: env.DATABASE_URL }) }),
  });
  const adminPool = new pg.Pool({ connectionString: env.DATABASE_ADMIN_URL });
  return {
    app,
    adminPool,
    close: async () => {
      await Promise.all([app.destroy(), adminPool.end()]);
    },
  };
}

/**
 * Runs `fn` in a transaction on behalf of `userId`. The database policies read the id from
 * `app.user_id`, which is set for this transaction only and cannot leak into the next request.
 */
export function withUser<T>(
  db: AppDb,
  userId: string,
  fn: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.user_id', ${userId}, true)`.execute(trx);
    return fn(trx);
  });
}
