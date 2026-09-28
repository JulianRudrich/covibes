import { serve } from '@hono/node-server';
import { EnvValidationError } from '@covibes/shared';

import { createApp } from '@server/app';
import { createAuth } from '@server/auth/auth';
import { createDatabase } from '@server/db/database';
import { loadServerEnv, type ServerEnv } from '@server/env';
import { createMailSetup } from '@server/integrations/mail/mailer';

function readEnvOrExit(): ServerEnv {
  try {
    return loadServerEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

const env = readEnvOrExit();
const db = createDatabase(env);
// Locally the development mailbox, in the Docker image SMTP (or no login by mail).
const mail = createMailSetup(env);
const auth = createAuth({ env, adminPool: db.adminPool, mailer: mail.mailer });

const server = serve(
  { fetch: createApp({ env, db, auth, mail }).fetch, port: env.PORT, hostname: env.HOST },
  (info) => {
    console.log(`Covibes server listening on http://${env.HOST}:${String(info.port)}`);
  },
);

// Closing the pools lets the database shut down without waiting for open connections.
function shutdown() {
  server.close();
  void db.close().finally(() => process.exit(0));
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
