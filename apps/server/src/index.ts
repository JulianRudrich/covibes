import { Server } from 'node:http';

import { serve } from '@hono/node-server';
import { EnvValidationError } from '@covibes/shared';

import { createApp } from '@server/app';
import { createAuth } from '@server/auth/auth';
import { createCollab } from '@server/collab/collab';
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
const collab = createCollab({ env, db, auth });

const server = serve(
  { fetch: createApp({ env, db, auth, mail }).fetch, port: env.PORT, hostname: env.HOST },
  (info) => {
    console.log(`Covibes server listening on http://${env.HOST}:${String(info.port)}`);
  },
);
if (!(server instanceof Server)) throw new Error('Expected a plain HTTP server');
collab.attach(server);

// Store all open documents first, then close the pools so the database can stop right away.
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await collab.close();
  server.close();
  await db.close();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
