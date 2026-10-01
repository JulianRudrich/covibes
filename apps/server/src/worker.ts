import type { DB } from '@covibes/db';
import { EnvValidationError } from '@covibes/shared';
import { run } from 'graphile-worker';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import { MODERATOR } from '@server/agents/catalog';
import {
  checkClaudeAccess,
  completeText,
  GatewayConfigError,
  streamAgentReply,
} from '@server/ai-gateway';
import { createBoardClient } from '@server/collab/board-client';
import { releaseAbandonedJobs } from '@server/tasks/abandoned-jobs';
import { AGENT_TURN_TASK, agentTurnTask } from '@server/tasks/agent-turn';
import { OBSERVE_TASK, observeTask } from '@server/tasks/observe';
import { loadWorkerEnv, type WorkerEnv } from '@server/worker-env';

// The worker process (spec 07): runs the jobs the database creates for agent mentions and the
// observer (spec 15). Every agent has its own queue per project, so it answers one request after
// the other; up to five runs of different agents or projects work at the same time.
const CONCURRENCY = 5;

function readEnvOrExit(): WorkerEnv {
  try {
    return loadWorkerEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

const env = readEnvOrExit();

// Without a usable model the worker does not start, so a missing login shows at once and not in
// the first answer.
try {
  const access = await checkClaudeAccess(MODERATOR.model);
  console.log(`Covibes worker: ${access.model} via ${access.credentials}`);
} catch (error) {
  if (error instanceof GatewayConfigError) {
    console.error(`Covibes worker cannot start. ${error.message}`);
    process.exit(1);
  }
  throw error;
}

const pgPool = new pg.Pool({ connectionString: env.DATABASE_ADMIN_URL });
// A connection that breaks (e.g. a database restart) fails its query and is replaced; it must not
// end the worker, whether it was idle or in use.
function logConnectionError(error: Error) {
  console.error('Covibes worker: a database connection failed', error);
}
pgPool.on('error', logConnectionError);
pgPool.on('connect', (client) => {
  client.on('error', logConnectionError);
});
const admin = new Kysely<DB>({ dialect: new PostgresDialect({ pool: pgPool }) });
const boards = createBoardClient({
  collabUrl: env.COLLAB_URL,
  appUrl: env.APP_URL,
  token: env.INTERNAL_TOKEN,
});

const released = await releaseAbandonedJobs(pgPool);
if (released > 0) {
  console.log(`Covibes worker: resumed the jobs of ${String(released)} ended worker(s)`);
}

const runner = await run({
  pgPool,
  concurrency: CONCURRENCY,
  // Shutdown is handled below, so the pool closes after the last job.
  noHandleSignals: true,
  // No scheduled jobs yet; without this the worker looks for a crontab file.
  parsedCronItems: [],
  taskList: {
    [AGENT_TURN_TASK]: agentTurnTask({
      admin,
      boards,
      reply: streamAgentReply,
      complete: completeText,
    }),
    [OBSERVE_TASK]: observeTask({ admin, complete: completeText }),
  },
});

// Take no new jobs, give running ones a few seconds, then abort them; they are retried later.
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await runner.stop();
  await admin.destroy();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
