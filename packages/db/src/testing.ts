import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';

import { startEmbeddedPostgres } from './embedded';
import { randomSecret } from './local-secrets';
import { migrate } from './migrate';

export type TestDatabase = { adminUrl: string; appUrl: string; stop: () => Promise<void> };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

/** A fresh, migrated database in a temporary folder for one test run. */
export async function startTestDatabase(): Promise<TestDatabase> {
  const dataDir = mkdtempSync(join(tmpdir(), 'covibes-test-db-'));
  const running = await startEmbeddedPostgres({
    dataDir,
    port: await freePort(),
    postgresPassword: randomSecret(24),
    adminPassword: randomSecret(24),
    appPassword: randomSecret(24),
  });
  await migrate(running.adminUrl);
  return {
    adminUrl: running.adminUrl,
    appUrl: running.appUrl,
    stop: async () => {
      await running.stop();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(`${dataDir}.log`, { force: true });
    },
  };
}

/**
 * Runs `fn` in a transaction as `userId` (or as nobody with `null`), exactly like the server's
 * `withUser`, and always rolls back. Use one call per assertion: an error aborts the transaction.
 */
export async function asUser<T>(
  pool: pg.Pool,
  userId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (userId) await client.query("select set_config('app.user_id', $1, true)", [userId]);
    return await fn(client);
  } finally {
    await client.query('rollback');
    client.release();
  }
}
