import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Logger, runMigrations as runQueueMigrations } from 'graphile-worker';
import pg from 'pg';

import { paths } from './paths';

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;
// Arbitrary constant: serializes concurrent migration runs against the same database.
const MIGRATION_LOCK_ID = 4_720_260_928;

export class MigrationChangedError extends Error {
  constructor(readonly migration: string) {
    super(
      `Migration ${migration} was changed after it had been applied. Applied migrations are never edited; add a new migration instead.`,
    );
    this.name = 'MigrationChangedError';
  }
}

export type Migration = { name: string; sql: string; checksum: string };

export function readMigrations(dir = paths.migrations): Migration[] {
  return readdirSync(dir)
    .filter((name) => MIGRATION_FILE.test(name))
    .sort()
    .map((name) => {
      // Line endings are normalized so a checkout with CRLF produces the same checksum.
      const sql = readFileSync(join(dir, name), 'utf8').replace(/\r\n/g, '\n');
      const checksum = createHash('sha256').update(sql).digest('hex');
      return { name, sql, checksum };
    });
}

// Graphile Worker logs every migration step; ours report what they applied themselves.
const quietLogger = new Logger(() => () => undefined);

/**
 * Applies all pending migrations in order, each in its own transaction. Returns their names.
 * The job queue (Graphile Worker, spec 07) brings its own schema `graphile_worker`; it is installed
 * first, so our migrations can refer to it and no job is ever added before the queue exists.
 */
export async function migrate(adminUrl: string, dir = paths.migrations): Promise<string[]> {
  await runQueueMigrations({ connectionString: adminUrl, logger: quietLogger });
  const migrations = readMigrations(dir);
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      create table if not exists public.schema_migrations (
        name text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )`);
    await client.query('alter table public.schema_migrations enable row level security');

    const result = await client.query<{ name: string; checksum: string }>(
      'select name, checksum from public.schema_migrations',
    );
    const applied = new Map(result.rows.map((row) => [row.name, row.checksum]));

    const newlyApplied: string[] = [];
    for (const migration of migrations) {
      const appliedChecksum = applied.get(migration.name);
      if (appliedChecksum !== undefined) {
        if (appliedChecksum !== migration.checksum) throw new MigrationChangedError(migration.name);
        continue;
      }
      await client.query('begin');
      try {
        await client.query(migration.sql);
        await client.query(
          'insert into public.schema_migrations (name, checksum) values ($1, $2)',
          [migration.name, migration.checksum],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration ${migration.name} failed: ${(error as Error).message}`, {
          cause: error,
        });
      }
      newlyApplied.push(migration.name);
    }
    return newlyApplied;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    await client.end();
  }
}
