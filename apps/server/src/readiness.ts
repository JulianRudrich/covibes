import { readMigrations } from '@covibes/db';
import type pg from 'pg';

import type { BoardDocuments } from '@server/collab/collab';

type Checks = {
  database: boolean;
  migrations: boolean;
  worker: boolean;
  collaboration: boolean;
};

export type Readiness = {
  status: 'ready' | 'not_ready';
  checks: Checks;
  ai: 'available' | 'degraded';
  queue: { pending: number; oldestAgeSeconds: number } | null;
};

/** Bounded and content-free: a slow/unreachable database must not hang the health probe. */
export async function readiness(
  pool: { connect: () => Promise<pg.PoolClient> },
  documents: Pick<BoardDocuments, 'persistenceState'>,
  options: { timeoutMs?: number; now?: Date; migrationsDir?: string } = {},
): Promise<Readiness> {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const fallback: Readiness = {
    status: 'not_ready',
    checks: { database: false, migrations: false, worker: false, collaboration: false },
    ai: 'degraded',
    queue: null,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const inspect = async (): Promise<Readiness> => {
    const expected = readMigrations(options.migrationsDir);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("set local statement_timeout = '1500ms'");
      const migrations = await client.query<{ name: string; checksum: string }>(
        'select name, checksum from schema_migrations',
      );
      const applied = new Map(migrations.rows.map((row) => [row.name, row.checksum]));
      const heartbeat = await client.query<{ heartbeat_at: Date; ai_available: boolean }>(
        'select heartbeat_at, ai_available from worker_heartbeats where singleton = true',
      );
      const queue = await client.query<{ pending: number; oldest_age_seconds: number }>(
        `select count(*) filter (where locked_at is null and run_at <= now())::integer as pending,
          coalesce(greatest(0, extract(epoch from now() - min(run_at)
            filter (where locked_at is null and run_at <= now()))), 0)::float8 as oldest_age_seconds
         from graphile_worker.jobs where attempts < max_attempts`,
      );
      const beat = heartbeat.rows[0];
      const now = options.now ?? new Date();
      const store = documents.persistenceState?.();
      const checks: Checks = {
        database: true,
        migrations:
          expected.length > 0 &&
          expected.every((migration) => applied.get(migration.name) === migration.checksum),
        worker: beat !== undefined && now.getTime() - beat.heartbeat_at.getTime() < 45_000,
        collaboration: !store?.closed && (store?.failed ?? 0) === 0,
      };
      return {
        status: Object.values(checks).every(Boolean) ? 'ready' : 'not_ready',
        checks,
        ai: checks.worker && beat?.ai_available ? 'available' : 'degraded',
        queue: queue.rows[0]
          ? { pending: queue.rows[0].pending, oldestAgeSeconds: queue.rows[0].oldest_age_seconds }
          : null,
      };
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
  };
  try {
    return await Promise.race([
      inspect().catch(() => fallback),
      new Promise<Readiness>((resolve) => {
        timer = setTimeout(() => {
          resolve(fallback);
        }, timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
