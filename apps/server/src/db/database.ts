import type { DB } from '@covibes/db';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';

import type { ServerEnv } from '@server/env';

export type AppDb = Kysely<DB>;
export type AdminDb = Kysely<DB>;

export type Database = {
  /** Role covibes_app: every request on behalf of a user. RLS applies, always via `withUser`. */
  app: AppDb;
  /**
   * Role covibes_admin, never for requests on behalf of a user: the worker, the live bridge
   * (reading what the worker announced) and the collaboration storage.
   */
  admin: AdminDb;
  /** The admin role's pool, for the login library and raw queries (LISTEN, bytea). */
  adminPool: pg.Pool;
  close: () => Promise<void>;
};

export function createDatabase(
  env: Pick<ServerEnv, 'DATABASE_URL' | 'DATABASE_ADMIN_URL'>,
): Database {
  const appPool = new pg.Pool({ connectionString: env.DATABASE_URL });
  const adminPool = new pg.Pool({ connectionString: env.DATABASE_ADMIN_URL });
  // An idle connection that breaks (e.g. a database restart) is replaced; it must not end the server.
  for (const pool of [appPool, adminPool]) {
    pool.on('error', (error) => {
      console.error('A database connection failed', error);
    });
  }
  const app = new Kysely<DB>({ dialect: new PostgresDialect({ pool: appPool }) });
  const admin = new Kysely<DB>({ dialect: new PostgresDialect({ pool: adminPool }) });
  return {
    app,
    admin,
    adminPool,
    // Destroying the admin Kysely instance also ends its pool.
    close: async () => {
      await Promise.all([app.destroy(), admin.destroy()]);
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

/**
 * Runs `fn` in a transaction for a read-only link (spec 21b): no user, but the link's token, which
 * the database policies read from `app.share_token`. They show the rows of the link's project that
 * the read-only view needs, and nothing of anyone else.
 */
export function withShareLink<T>(
  db: AppDb,
  token: string,
  fn: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.share_token', ${token}, true)`.execute(trx);
    return fn(trx);
  });
}
