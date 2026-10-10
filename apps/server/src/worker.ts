import type { DB } from '@covibes/db';
import { EnvValidationError, readEdges, readNodes, readPlan } from '@covibes/shared';
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
import { gatherPackageInput, type PackageReaders } from '@server/api/package';
import { createBoardClient } from '@server/collab/board-client';
import { agentGitRequests } from '@server/git/agent-requests';
import { createGitlabClient } from '@server/integrations/gitlab/client';
import { createGitConnections } from '@server/integrations/gitlab/connections';
import { repositoryReaders } from '@server/integrations/gitlab/repository';
import { gitlabSetup } from '@server/integrations/gitlab/setup';
import { gitlabWriter } from '@server/integrations/gitlab/writer';
import { createWorkerMailer } from '@server/integrations/mail/mailer';
import { readStoredPlan } from '@server/plan/stored-plan';
import { defaultFilesDir, localStorage } from '@server/storage/storage';
import { releaseAbandonedJobs } from '@server/tasks/abandoned-jobs';
import { AGENT_TURN_TASK, agentTurnTask } from '@server/tasks/agent-turn';
import { AWAY_SUMMARY_TASK, awaySummaryTask } from '@server/tasks/away-summary';
import { GIT_REQUEST_TASK, gitRequestTask } from '@server/tasks/git-request';
import { GIT_SYNC_TASK, gitSyncTask } from '@server/tasks/git-sync';
import { MR_REVIEW_TASK, mrReviewTask } from '@server/tasks/mr-review';
import { usageGuard, usageLimitsOf } from '@server/usage/limits';
import { NOTIFICATION_MAIL_TASK, notificationMailTask } from '@server/tasks/notification-mails';
import { OBSERVE_TASK, observeTask } from '@server/tasks/observe';
import { PACKAGE_SPECS_TASK, packageSpecsTask } from '@server/tasks/package-specs';
import { PACKAGE_SUGGEST_TASK, packageSuggestTask } from '@server/tasks/package-suggest';
import { PLAN_GENERATE_TASK, planGenerateTask } from '@server/tasks/plan-generate';
import { loadWorkerEnv, type WorkerEnv } from '@server/worker-env';

// The worker process (spec 07): runs the jobs the database creates for agent mentions, the
// observer (spec 15), the notification mails (spec 22b), the summaries for people who come back
// (spec 23) and the generation of the plan (spec 25b). Every agent has its own queue per project, so it answers one request after the
// other; up to five runs of different agents or projects work at the same time.
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

// The repositories projects are connected to (spec 28b). The worker shares the settings of the
// connections with the server; without them, agents read no repository and no Git request runs.
const gitSetup = gitlabSetup(env);
const gitClient = createGitlabClient();
const gitConnections = gitSetup
  ? createGitConnections({ admin, client: gitClient, setup: gitSetup })
  : undefined;
const repository = gitConnections
  ? repositoryReaders({ admin, client: gitClient, connections: gitConnections })
  : undefined;

// The plan and the boards as the package for coding agents is built from them.
const packageReaders: PackageReaders = {
  readPlan: (projectId) => readStoredPlan(admin, projectId, (doc) => readPlan(doc)),
  readBoard: (boardId) =>
    boards.withBoard(boardId, (doc) => ({ nodes: readNodes(doc), edges: readEdges(doc) })),
};

// The limits of the AI (spec 31a): every job that calls a model checks them first.
const limits = usageGuard(admin, usageLimitsOf(env));

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
      files: localStorage(env.FILES_DIR ?? defaultFilesDir()),
      ...(repository ? { repository } : {}),
      // The moderator proposes Git actions (spec 29e); they wait for approval like everyone's.
      ...(gitConnections
        ? {
            gitRequests: agentGitRequests({
              admin,
              client: gitClient,
              connections: gitConnections,
              boards,
            }),
          }
        : {}),
      limits,
      reply: streamAgentReply,
      complete: completeText,
    }),
    [OBSERVE_TASK]: observeTask({ admin, complete: completeText, limits }),
    // The moderator writes the project plan as suggestions per section (spec 25b).
    [PLAN_GENERATE_TASK]: planGenerateTask({ admin, boards, complete: completeText, limits }),
    // The moderator suggests a text of the package for coding agents (spec 27c).
    [PACKAGE_SUGGEST_TASK]: packageSuggestTask({ admin, complete: completeText, limits }),
    // The moderator writes the feature specs of a milestone out (spec 27d).
    [PACKAGE_SPECS_TASK]: packageSpecsTask({ admin, boards, complete: completeText, limits }),
    // An approved Git request runs with the access of who approved it (spec 29b). Without a
    // GitLab nobody has an account, so nothing can be approved and no such job exists.
    ...(gitConnections
      ? {
          [GIT_REQUEST_TASK]: gitRequestTask({
            admin,
            accessOf: gitConnections.accessOf,
            writers: (target, token) => gitlabWriter(gitClient, target, token),
          }),
          // Reads the state of a project's repository (spec 30a).
          [GIT_SYNC_TASK]: gitSyncTask({
            admin,
            client: gitClient,
            connections: gitConnections,
          }),
        }
      : {}),
    // The review of a merge request against the architecture (spec 30b): it reads the repository
    // and writes into Covibes only.
    ...(repository
      ? {
          [MR_REVIEW_TASK]: mrReviewTask({
            admin,
            repository,
            packageInput: (projectId) => gatherPackageInput(admin, packageReaders, projectId),
            complete: completeText,
            limits,
          }),
        }
      : {}),
    // The moderator sums up the conversation for a member who comes back (spec 23).
    [AWAY_SUMMARY_TASK]: awaySummaryTask({ admin, complete: completeText, limits }),
    // Sums up by mail what a person has not seen in the app (spec 22b).
    [NOTIFICATION_MAIL_TASK]: notificationMailTask({
      admin,
      mailer: createWorkerMailer(env),
      appUrl: env.APP_URL,
    }),
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
