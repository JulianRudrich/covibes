import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ADMIN_ROLE, APP_ROLE, bootstrapCluster, connectionUrl, DATABASE_NAME } from './bootstrap';

export type RunningPostgres = {
  port: number;
  adminUrl: string;
  appUrl: string;
  stop: () => Promise<void>;
};

type StartOptions = {
  dataDir: string;
  port: number;
  postgresPassword: string;
  adminPassword: string;
  appPassword: string;
};

type Binaries = { initdb: string; pg_ctl: string; postgres: string };

/**
 * The PostgreSQL programs from the platform package of `embedded-postgres`. Its JavaScript is not
 * used: its `stop()` kills the server on Windows and hangs if the server has already exited, and
 * it installs a Ctrl+C handler that ends the process before `pnpm dev` has shut down cleanly.
 */
async function findBinaries(): Promise<Binaries> {
  const os = platform() === 'win32' ? 'windows' : platform();
  const embeddedEntry = createRequire(import.meta.url).resolve('embedded-postgres');
  const entry = createRequire(embeddedEntry).resolve(`@embedded-postgres/${os}-${arch()}`);
  const binaries = (await import(pathToFileURL(entry).href)) as Binaries;
  if (platform() !== 'win32') {
    // npm does not always keep the executable bit.
    for (const file of [binaries.initdb, binaries.pg_ctl, binaries.postgres])
      chmodSync(file, 0o755);
  }
  return binaries;
}

/**
 * Runs a PostgreSQL program. stdout stays unconnected: a server started by pg_ctl would inherit
 * the pipe and keep it open. stderr is only captured for programs that do not start a server.
 */
function run(
  binary: string,
  args: string[],
  captureErrors = false,
): Promise<{ code: number; errors: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ['ignore', 'ignore', captureErrors ? 'pipe' : 'ignore'],
      windowsHide: true,
      env: { ...process.env, LC_MESSAGES: 'C' },
    });
    let errors = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      errors += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      resolve({ code: code ?? 1, errors });
    });
  });
}

async function initCluster(binaries: Binaries, dataDir: string, password: string): Promise<void> {
  const passwordFile = join(tmpdir(), `covibes-initdb-${randomUUID()}`);
  writeFileSync(passwordFile, password, { mode: 0o600 });
  try {
    const result = await run(
      binaries.initdb,
      [
        `--pgdata=${dataDir}`,
        '--username=postgres',
        `--pwfile=${passwordFile}`,
        '--auth=scram-sha-256',
        // UTF-8 and the same text rules on every machine, whatever the operating system's locale.
        '--encoding=UTF8',
        '--locale=C',
        '--locale-provider=builtin',
        '--builtin-locale=C.UTF-8',
      ],
      true,
    );
    if (result.code !== 0) throw new Error(`initdb failed:\n${result.errors}`);
  } finally {
    rmSync(passwordFile, { force: true });
  }
}

async function isRunning(binaries: Binaries, dataDir: string): Promise<boolean> {
  return (await run(binaries.pg_ctl, ['status', '-D', dataDir])).code === 0;
}

/**
 * "fast" closes open connections and writes everything to disk. "immediate" is the fallback; the
 * next start then recovers from the write-ahead log. A server that shuts down by itself (Ctrl+C
 * reaches it too) counts as stopped.
 */
async function stopCluster(binaries: Binaries, dataDir: string): Promise<void> {
  for (const mode of ['fast', 'immediate']) {
    if (!(await isRunning(binaries, dataDir))) return;
    await run(binaries.pg_ctl, ['stop', '-D', dataDir, '-m', mode, '-w', '-t', '30']);
  }
  if (await isRunning(binaries, dataDir)) {
    throw new Error(`PostgreSQL in ${dataDir} does not stop.`);
  }
}

function logTail(logFile: string): string {
  if (!existsSync(logFile)) return '';
  return readFileSync(logFile, 'utf8').trimEnd().split(/\r?\n/).slice(-15).join('\n');
}

/** Starts PostgreSQL from the bundled programs, creates roles and the database. */
export async function startEmbeddedPostgres(options: StartOptions): Promise<RunningPostgres> {
  const binaries = await findBinaries();
  // Next to the data folder, not inside: crash recovery opens every file in it, and on Windows
  // the open log file would block that for 30 seconds.
  const logFile = `${options.dataDir}.log`;

  if (existsSync(join(options.dataDir, 'PG_VERSION'))) {
    // A server left over from a hard-killed `pnpm dev` would block the port and the data folder.
    await stopCluster(binaries, options.dataDir);
  } else {
    await initCluster(binaries, options.dataDir, options.postgresPassword);
  }

  const started = await run(binaries.pg_ctl, [
    'start',
    '-D',
    options.dataDir,
    '-l',
    logFile,
    '-w',
    '-t',
    '60',
    // Only reachable from this machine, whatever postgresql.conf says.
    '-o',
    `-p ${String(options.port)} -c listen_addresses=localhost`,
  ]);
  if (started.code !== 0) {
    throw new Error(`PostgreSQL did not start. Last lines of ${logFile}:\n${logTail(logFile)}`);
  }
  const stop = () => stopCluster(binaries, options.dataDir);

  const url = (user: string, password: string, database: string) =>
    connectionUrl({ user, password, database, port: options.port });

  try {
    await bootstrapCluster({
      superuserUrl: url('postgres', options.postgresPassword, 'postgres'),
      adminPassword: options.adminPassword,
      appPassword: options.appPassword,
    });
  } catch (error) {
    await stop();
    throw error;
  }

  return {
    port: options.port,
    adminUrl: url(ADMIN_ROLE, options.adminPassword, DATABASE_NAME),
    appUrl: url(APP_ROLE, options.appPassword, DATABASE_NAME),
    stop,
  };
}
