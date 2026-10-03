import { Server } from 'node:http';

import { serve } from '@hono/node-server';
import { EnvValidationError, LIVE_PATH } from '@covibes/shared';

import { createApp } from '@server/app';
import { createAuth } from '@server/auth/auth';
import { createCollab } from '@server/collab/collab';
import { createDatabase } from '@server/db/database';
import { loadServerEnv, type ServerEnv } from '@server/env';
import { createMailSetup } from '@server/integrations/mail/mailer';
import { createRoadmapAnnouncer } from '@server/plan/roadmap-live';
import { projectConnections } from '@server/realtime/connections';
import { startLiveBridge } from '@server/realtime/notifications';
import { createRealtime } from '@server/realtime/realtime';
import { defaultFilesDir, localStorage } from '@server/storage/storage';
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
const realtime = createRealtime({ db, auth });
const collab = createCollab({
  db,
  auth,
  internalToken: env.INTERNAL_TOKEN,
  // Everyone with the project open learns when a stored plan changed its roadmap (spec 26a).
  onPlanStored: createRoadmapAnnouncer(realtime),
});
// Forwards what the worker announces (runs, agent messages, streamed text) to the live channels.
const liveBridge = startLiveBridge({ adminPool: db.adminPool, admin: db.admin, live: realtime });

const server = serve(
  {
    fetch: createApp({
      env,
      db,
      auth,
      mail,
      live: realtime,
      documents: collab,
      connections: projectConnections(realtime, collab),
      files: localStorage(env.FILES_DIR ?? defaultFilesDir()),
    }).fetch,
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
  liveBridge.stop();
  realtime.close();
  await collab.close();
  await db.close();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
