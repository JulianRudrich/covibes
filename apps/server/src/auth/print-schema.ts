// Prints the SQL Better Auth needs for the current configuration, compared against a fresh
// database with all existing migrations. Use it to write a new migration after changing the auth
// configuration: `pnpm --filter @covibes/server auth:schema`.
import { startTestDatabase } from '@covibes/db/testing';
import { getMigrations } from 'better-auth/db/migration';
import pg from 'pg';

import { authOptions } from '@server/auth/auth';
import { DevOutbox } from '@server/integrations/mail/mailer';

const database = await startTestDatabase();
const adminPool = new pg.Pool({ connectionString: database.adminUrl });
try {
  const options = authOptions({
    env: {
      APP_URL: 'http://localhost:5173',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      NODE_ENV: 'development',
      GITLAB_CLIENT_ID: undefined,
      GITLAB_CLIENT_SECRET: undefined,
      GITLAB_ISSUER: undefined,
    },
    adminPool,
    mailer: new DevOutbox(),
  });
  const { compileMigrations } = await getMigrations(options);
  console.log(await compileMigrations());
} finally {
  await adminPool.end();
  await database.stop();
}
