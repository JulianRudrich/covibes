// `pnpm dev`: starts the local database (with migrations), then the server and, once the server
// answers, the worker for agent runs and the web app (specs 02a and 07). Ctrl+C stops them first
// and the database last.
import { spawn, type ChildProcess } from 'node:child_process';

import { startLocalDatabase } from '@covibes/db/local';

const SERVER_HEALTH_URL = 'http://127.0.0.1:3001/health';

const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) {
  console.error('Start this script through pnpm: `pnpm dev`.');
  process.exit(1);
}
const pnpmEntry: string = npmExecPath;

console.log('Starting the local database …');
const database = await startLocalDatabase();
console.log(
  `Database ready on 127.0.0.1:${String(database.port)}` +
    (database.applied.length ? `, applied migrations: ${database.applied.join(', ')}` : ''),
);

const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: database.appUrl,
  DATABASE_ADMIN_URL: database.adminUrl,
  BETTER_AUTH_SECRET: database.secrets.betterAuthSecret,
  // Server and worker share it; the worker uses it to draw on boards for the agents.
  INTERNAL_TOKEN: database.secrets.internalToken,
  COLLAB_URL: 'ws://127.0.0.1:3001/api/collab',
};
// A PORT from the caller (e.g. a preview tool) means the web app, which always runs on 5173.
// The server keeps its own port, which the web app's proxy expects.
delete childEnv.PORT;

const children: ChildProcess[] = [];
let stopping = false;
const isStopping = () => stopping;

// pnpm is either a native binary or a JS entry for Node. Both start without a shell, also on Windows.
const pnpmIsScript = /\.[cm]?js$/.test(pnpmEntry);
function startPackage(pkg: string, script = 'dev'): void {
  const args = ['--filter', pkg, script];
  const child = spawn(
    pnpmIsScript ? process.execPath : pnpmEntry,
    pnpmIsScript ? [pnpmEntry, ...args] : args,
    // No stdin: both run without keyboard input, and a shared stdin can stall Vite's start.
    { env: childEnv, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  child.once('exit', (code) => {
    if (!stopping) void stop(code ?? 1);
  });
  children.push(child);
}

/** Ends a child process; after 10 seconds the database is stopped anyway. */
function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 10_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill();
  });
}

async function stop(exitCode: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  await Promise.all(children.map(stopChild));
  try {
    await database.stop();
    console.log('Database stopped.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    exitCode = 1;
  }
  process.exit(exitCode);
}

/** The web app's first request needs the server, so the web app waits until it answers. */
async function waitForServer(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!stopping && Date.now() < deadline) {
    try {
      if ((await fetch(SERVER_HEALTH_URL)).ok) return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));

startPackage('@covibes/server');
if (await waitForServer()) {
  startPackage('@covibes/server', 'dev:worker');
  startPackage('@covibes/web');
} else if (!isStopping()) {
  console.error(`The server did not answer on ${SERVER_HEALTH_URL}.`);
  await stop(1);
}
