// `node dist/setup.js`: prepares the database before Covibes starts in Docker (spec 02b).
// Creates the roles covibes_admin and covibes_app (or updates their passwords), creates the
// database and applies pending migrations. Only this step knows the superuser password.
import { ADMIN_ROLE, bootstrapCluster, DATABASE_NAME, migrate } from '@covibes/db';
import { defineEnv, EnvValidationError } from '@covibes/shared';
import { z } from 'zod';

const setupEnvSchema = z.object({
  /** Superuser of the PostgreSQL server, e.g. `postgres://postgres:…@db:5432/postgres`. */
  DATABASE_SUPERUSER_URL: z.url(),
  COVIBES_ADMIN_PASSWORD: z.string().min(16),
  COVIBES_APP_PASSWORD: z.string().min(16),
  MIGRATIONS_DIR: z.string().min(1),
});

try {
  const env = defineEnv(setupEnvSchema, process.env);
  await bootstrapCluster({
    superuserUrl: env.DATABASE_SUPERUSER_URL,
    adminPassword: env.COVIBES_ADMIN_PASSWORD,
    appPassword: env.COVIBES_APP_PASSWORD,
  });

  const adminUrl = new URL(env.DATABASE_SUPERUSER_URL);
  adminUrl.username = ADMIN_ROLE;
  adminUrl.password = env.COVIBES_ADMIN_PASSWORD;
  adminUrl.pathname = `/${DATABASE_NAME}`;
  const applied = await migrate(adminUrl.toString(), env.MIGRATIONS_DIR);
  console.log(
    applied.length
      ? `Database ready, applied migrations: ${applied.join(', ')}`
      : 'Database ready, no pending migrations',
  );
} catch (error) {
  console.error(
    error instanceof EnvValidationError || error instanceof Error ? error.message : error,
  );
  process.exit(1);
}
