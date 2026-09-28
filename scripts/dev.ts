// `pnpm dev`: starts the local database (with migrations), then server and web app (spec 02a).
// Ctrl+C stops server and web app first and the database last.
import { spawn, type ChildProcess } from 'node:child_process';

import { startLocalDatabase } from '@covibes/db/local';

const pnpmEntry = process.env.npm_execpath;
if (!pnpmEntry) {
  console.error('Start this script through pnpm: `pnpm dev`.');
  process.exit(1);
}

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
};
// A PORT from the caller (e.g. a preview tool) means the web app, which always runs on 5173.
// The server keeps its own port, which the web app's proxy expects.
delete childEnv.PORT;

// pnpm is either a native binary or a JS entry for Node. Both start without a shell, also on Windows.
const pnpmIsScript = /\.[cm]?js$/.test(pnpmEntry);
const children: ChildProcess[] = ['@covibes/server', '@covibes/web'].map((pkg) => {
  const args = ['--filter', pkg, 'dev'];
  return spawn(
    pnpmIsScript ? process.execPath : pnpmEntry,
    pnpmIsScript ? [pnpmEntry, ...args] : args,
    // No stdin: both run without keyboard input, and a shared stdin can stall Vite's start.
    { env: childEnv, stdio: ['ignore', 'inherit', 'inherit'] },
  );
});

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

let stopping = false;
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

process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));
for (const child of children) {
  child.once('exit', (code) => {
    if (!stopping) void stop(code ?? 1);
  });
}
