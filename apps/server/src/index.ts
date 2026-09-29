import { Server } from 'node:http';

import { serve } from '@hono/node-server';
import { EnvValidationError, LIVE_PATH } from '@covibes/shared';

import { createApp } from '@server/app';
import { createAuth } from '@server/auth/auth';
import { createCollab } from '@server/collab/collab';
import { createDatabase } from '@server/db/database';
import { loadServerEnv, type ServerEnv } from '@server/env';
import { createMailSetup } from '@server/integrations/mail/mailer';
import { createRealtime } from '@server/realtime/realtime';
import { attachWebSockets } from '@server/websockets';

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
const collab = createCollab({ db, auth });
const realtime = createRealtime({ db, auth });

const server = serve(
  {
    fetch: createApp({ env, db, auth, mail, live: realtime }).fetch,
    port: env.PORT,
    hostname: env.HOST,
  },
  (info) => {
    console.log(`Covibes server listening on http://${env.HOST}:${String(info.port)}`);
  },
);
if (!(server instanceof Server)) throw new Error('Expected a plain HTTP server');
const upgrades = attachWebSockets(server, {
  appUrl: env.APP_URL,
  routes: new Map([
    [env.COLLAB_PATH, collab.handleUpgrade],
    [LIVE_PATH, realtime.handleUpgrade],
  ]),
});

// Accept nothing new, store all open documents, then close the pools so the database can stop.
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  upgrades.stop();
  server.close();
  realtime.close();
  await collab.close();
  await db.close();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
