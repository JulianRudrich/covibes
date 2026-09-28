// Database commands, called via `pnpm db:<command>` from the repo root (spec 02a).
//
//   migrate             start the local database and apply pending migrations
//   migration <name>    create the next migration file
//   types [--verify]    regenerate src/schema.ts from a fresh database (or only check it)
//   backup              copy the local database (only while `pnpm dev` is stopped)
//   restore [folder]    restore the newest or the given backup
//   reset               start over with an empty, migrated database
//
// `restore` and `reset` replace all local data: they ask first and back up the current state.
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { dirname, join, relative } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { format, resolveConfig } from 'prettier';

import { LOCAL_PORT, startLocalDatabase } from './local';
import { readMigrations } from './migrate';
import { paths } from './paths';
import { startTestDatabase } from './testing';

const args = process.argv.slice(2).filter((arg) => arg !== '--yes');
const [command, argument] = args;
const assumeYes = process.argv.includes('--yes');

function isLocalDatabaseRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: LOCAL_PORT });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
}

async function ensureStopped(): Promise<void> {
  if (await isLocalDatabaseRunning()) {
    throw new Error('The local database is running. Stop `pnpm dev` first (Ctrl+C).');
  }
}

async function confirm(question: string): Promise<void> {
  if (assumeYes) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} Type "yes" to continue: `);
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('Cancelled, nothing was changed.');
    process.exit(1);
  }
}

function timestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function backup(): string {
  if (!existsSync(paths.postgres)) throw new Error('There is no local database yet.');
  const target = join(paths.backups, timestamp());
  mkdirSync(target, { recursive: true });
  cpSync(paths.postgres, join(target, 'postgres'), { recursive: true });
  // The database only accepts the passwords it was created with, so they belong to the backup.
  cpSync(paths.localSecrets, join(target, 'local-secrets.json'));
  console.log(`Backup written to ${relative(paths.repoRoot, target)}`);
  return target;
}

function newestBackup(): string {
  const folders = existsSync(paths.backups)
    ? readdirSync(paths.backups, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];
  const newest = folders.at(-1);
  if (!newest) throw new Error('No backup found in backups/. Run `pnpm db:backup` first.');
  return join(paths.backups, newest);
}

async function restore(folder: string | undefined): Promise<void> {
  await ensureStopped();
  const source = folder ? join(paths.repoRoot, folder) : newestBackup();
  if (!existsSync(join(source, 'postgres')) || !existsSync(join(source, 'local-secrets.json'))) {
    throw new Error(`${relative(paths.repoRoot, source)} is not a database backup.`);
  }
  await confirm(`This replaces ALL local data with ${relative(paths.repoRoot, source)}.`);
  if (existsSync(paths.postgres)) backup();
  rmSync(paths.postgres, { recursive: true, force: true });
  cpSync(join(source, 'postgres'), paths.postgres, { recursive: true });
  cpSync(join(source, 'local-secrets.json'), paths.localSecrets);
  console.log('Restored. Start everything again with `pnpm dev`.');
}

async function reset(): Promise<void> {
  await ensureStopped();
  await confirm('This deletes ALL local data and starts with an empty database.');
  if (existsSync(paths.postgres)) backup();
  rmSync(paths.postgres, { recursive: true, force: true });
  const database = await startLocalDatabase();
  await database.stop();
  console.log(`New database with ${String(database.applied.length)} migrations.`);
}

async function migrateLocal(): Promise<void> {
  await ensureStopped();
  const database = await startLocalDatabase();
  await database.stop();
  console.log(
    database.applied.length
      ? `Applied: ${database.applied.join(', ')}`
      : 'The local database is up to date.',
  );
}

function newMigration(name: string | undefined): void {
  if (!name || !/^[a-z0-9_]+$/.test(name)) {
    throw new Error('Usage: pnpm db:migration <name> (lowercase letters, digits and _)');
  }
  const last = readMigrations().at(-1)?.name ?? '0000';
  const next = String(Number(last.slice(0, 4)) + 1).padStart(4, '0');
  const file = join(paths.migrations, `${next}_${name}.sql`);
  writeFileSync(
    file,
    `-- ${name.replace(/_/g, ' ')}\n--\n-- Every new table: RLS, policies and grants for covibes_app in this same migration.\n\n`,
  );
  console.log(`Created ${relative(paths.repoRoot, file)}`);
}

/** Generates the Kysely types from a fresh database, formatted like the rest of the code. */
async function generateTypes(): Promise<string> {
  const database = await startTestDatabase();
  try {
    const require = createRequire(import.meta.url);
    const packageJson = require.resolve('kysely-codegen/package.json');
    const bin = join(dirname(packageJson), 'dist', 'cli', 'bin.js');
    const result = spawnSync(
      process.execPath,
      [
        bin,
        '--dialect',
        'postgres',
        '--url',
        database.adminUrl,
        '--exclude-pattern',
        'public.schema_migrations',
        '--print',
        '--log-level',
        'error',
      ],
      { encoding: 'utf8' },
    );
    if (result.status !== 0) throw new Error(`kysely-codegen failed:\n${result.stderr}`);
    const header = '// Generated by `pnpm db:types` from the migrations. Do not edit by hand.\n\n';
    const options = (await resolveConfig(paths.schemaTypes)) ?? {};
    return await format(header + result.stdout, { ...options, filepath: paths.schemaTypes });
  } finally {
    await database.stop();
  }
}

async function types(verify: boolean): Promise<void> {
  const generated = await generateTypes();
  if (verify) {
    const current = existsSync(paths.schemaTypes) ? readFileSync(paths.schemaTypes, 'utf8') : '';
    if (current.replace(/\r\n/g, '\n') !== generated) {
      throw new Error('src/schema.ts is out of date. Run `pnpm db:types` and commit the result.');
    }
    console.log('src/schema.ts matches the migrations.');
    return;
  }
  writeFileSync(paths.schemaTypes, generated);
  console.log(`Wrote ${relative(paths.repoRoot, paths.schemaTypes)}`);
}

const commands: Record<string, () => Promise<void> | void> = {
  migrate: migrateLocal,
  migration: () => {
    newMigration(argument);
  },
  types: () => types(argument === '--verify' || process.argv.includes('--verify')),
  backup: async () => {
    await ensureStopped();
    backup();
  },
  restore: () => restore(argument),
  reset,
};

const handler = command ? commands[command] : undefined;
if (!handler) {
  console.error(`Usage: pnpm db:<${Object.keys(commands).join('|')}>`);
  process.exit(1);
}

try {
  await handler();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
