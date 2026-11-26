import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readMigrations } from '@covibes/db';
import { startTestDatabase, type TestDatabase } from '@covibes/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { readiness } from '@server/readiness';

let database: TestDatabase;
let pool: pg.Pool;
const documents = { persistenceState: () => ({ pending: 0, failed: 0, closed: false }) };
beforeAll(async () => {
  database = await startTestDatabase();
  pool = new pg.Pool({ connectionString: database.adminUrl });
});
afterAll(async () => {
  await pool.end();
  await database.stop();
});
beforeEach(async () => {
  await pool.query(
    `insert into worker_heartbeats (singleton, instance_id, heartbeat_at, ai_available)
    values (true, $1, now(), true) on conflict (singleton) do update
    set heartbeat_at = now(), ai_available = true`,
    [randomUUID()],
  );
});

describe('readiness (spec 41)', () => {
  it('checks the configured deployment directory and refuses an empty migration bundle', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'covibes-readiness-migrations-'));
    try {
      for (const migration of readMigrations()) {
        writeFileSync(join(directory, migration.name), migration.sql);
      }
      expect(await readiness(pool, documents, { migrationsDir: directory })).toMatchObject({
        status: 'ready',
        checks: { migrations: true },
      });
      rmSync(directory, { recursive: true });
      const empty = mkdtempSync(join(tmpdir(), 'covibes-readiness-empty-'));
      try {
        expect(await readiness(pool, documents, { migrationsDir: empty })).toMatchObject({
          status: 'not_ready',
          checks: { migrations: false },
        });
      } finally {
        rmSync(empty, { recursive: true });
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('requires a current worker and database while reporting AI degradation separately', async () => {
    expect(await readiness(pool, documents)).toMatchObject({ status: 'ready', ai: 'available' });
    await pool.query('update worker_heartbeats set ai_available = false');
    expect(await readiness(pool, documents)).toMatchObject({ status: 'ready', ai: 'degraded' });
    await pool.query("update worker_heartbeats set heartbeat_at = now() - interval '2 minutes'");
    expect(await readiness(pool, documents)).toMatchObject({
      status: 'not_ready',
      checks: { database: true, worker: false },
    });
  });

  it('checks migration checksums rather than assuming that a database connection is sufficient', async () => {
    const original = await pool.query<{ name: string; checksum: string }>(
      'select name, checksum from schema_migrations order by name desc limit 1',
    );
    const migration = original.rows[0];
    if (!migration) throw new Error('No migration applied');
    try {
      await pool.query('update schema_migrations set checksum = $2 where name = $1', [
        migration.name,
        'wrong-checksum',
      ]);
      expect(await readiness(pool, documents)).toMatchObject({
        status: 'not_ready',
        checks: { database: true, migrations: false },
      });
    } finally {
      await pool.query('update schema_migrations set checksum = $2 where name = $1', [
        migration.name,
        migration.checksum,
      ]);
    }
  });

  it('fails on collaboration store failures and exposes waiting queue age without payloads', async () => {
    await pool.query(
      "select graphile_worker.add_job('notification_mail', '{}'::json, run_at => now() - interval '90 seconds')",
    );
    const state = await readiness(pool, {
      persistenceState: () => ({ pending: 1, failed: 1, closed: false }),
    });
    expect(state).toMatchObject({
      status: 'not_ready',
      checks: { collaboration: false },
      queue: { pending: 1 },
    });
    expect(state.queue?.oldestAgeSeconds).toBeGreaterThanOrEqual(90);
  });

  it('bounds an unavailable database connection', async () => {
    const unavailable = { connect: () => new Promise<pg.PoolClient>(() => undefined) };
    expect(await readiness(unavailable, documents, { timeoutMs: 10 })).toMatchObject({
      status: 'not_ready',
      checks: { database: false },
    });
  });

  it('keeps operational ledgers unavailable to application users', async () => {
    const app = new pg.Pool({ connectionString: database.appUrl });
    try {
      await expect(app.query('select * from worker_heartbeats')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(app.query('select * from tool_commands')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(app.query('select * from board_history_outbox')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await app.end();
    }
  });
});
