import type { DB } from '@covibes/db';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { z } from 'zod';

import { reconcileAttempt } from '@server/usage/attempts';

const argumentsSchema = z.tuple([z.uuid(), z.coerce.number().min(0), z.string().trim().min(10)]);
const [id, cost, note] = argumentsSchema.parse(process.argv.slice(2));
const connection = z.url().safeParse(process.env.DATABASE_ADMIN_URL);
if (!connection.success)
  throw new Error('DATABASE_ADMIN_URL must name an admin database connection');
const databaseUrl = connection.data;
const admin = new Kysely<DB>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: databaseUrl }) }),
});
try {
  await reconcileAttempt(admin, id, cost, note);
  console.log(`Reconciled attempt ${id} at ${cost.toFixed(6)} USD`);
} finally {
  await admin.destroy();
}
