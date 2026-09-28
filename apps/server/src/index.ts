import { serve } from '@hono/node-server';
import { EnvValidationError } from '@covibes/shared';

import { createApp } from '@server/app';
import { createAuth } from '@server/auth/auth';
import { createDatabase } from '@server/db/database';
import { loadServerEnv, type ServerEnv } from '@server/env';
import { DevOutbox } from '@server/integrations/mail/mailer';

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
// Until real delivery comes with the deployment, every mail lands in the development mailbox.
const outbox = new DevOutbox();
const auth = createAuth({ env, adminPool: db.adminPool, mailer: outbox });

const server = serve(
  { fetch: createApp({ env, db, auth, outbox }).fetch, port: env.PORT, hostname: env.HOST },
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
