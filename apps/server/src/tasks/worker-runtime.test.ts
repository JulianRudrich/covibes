import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { startTestDatabase } from '@covibes/db/testing';
import pg from 'pg';
import { expect, it, vi } from 'vitest';

it('runs non-AI jobs without a provider key, refuses a second worker and recovers after a crash', async () => {
  const database = await startTestDatabase();
  const pool = new pg.Pool({ connectionString: database.adminUrl });
  const children: ChildProcess[] = [];
  const start = () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_ADMIN_URL: database.adminUrl,
      INTERNAL_TOKEN: 'worker-runtime-test-internal-token-0123456789',
      FILES_DIR: tmpdir(),
    };
    delete env.ANTHROPIC_API_KEY;
    // No external services are needed or contacted by this startup and queue test.
    delete env.SMTP_URL;
    delete env.GITLAB_CLIENT_ID;
    delete env.GITLAB_CLIENT_SECRET;
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', fileURLToPath(new URL('../worker.ts', import.meta.url))],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env,
        stdio: 'pipe',
      },
    );
    // Drain output so a verbose queue cannot fill the pipe and stop the process.
    child.stdout.resume();
    child.stderr.resume();
    children.push(child);
    return child;
  };
  try {
    const first = start();
    let owner = '';
    await vi.waitFor(
      async () => {
        expect(first.exitCode).toBeNull();
        const heartbeat = await pool.query<{ instance_id: string; ai_available: boolean }>(
          'select instance_id, ai_available from worker_heartbeats',
        );
        expect(heartbeat.rows).toHaveLength(1);
        expect(heartbeat.rows[0]?.ai_available).toBe(false);
        owner = heartbeat.rows[0]?.instance_id ?? '';
      },
      { timeout: 15_000 },
    );
    const queued = await pool.query<{ id: string }>(
      "select id from graphile_worker.add_job('notification_mail', $1::json)",
      [JSON.stringify({ userId: randomUUID() })],
    );
    const id = queued.rows[0]?.id;
    await vi.waitFor(
      async () => {
        expect(
          (await pool.query('select id from graphile_worker.jobs where id = $1', [id])).rows,
        ).toHaveLength(0);
      },
      { timeout: 10_000 },
    );
    const second = start();
    const exited: unknown = await once(second, 'exit');
    expect(exited).toEqual([1, null]);
    expect(first.exitCode).toBeNull();
    first.kill('SIGKILL');
    await once(first, 'exit');
    const successor = start();
    await vi.waitFor(
      async () => {
        expect(successor.exitCode).toBeNull();
        const heartbeat = await pool.query<{ instance_id: string }>(
          'select instance_id from worker_heartbeats',
        );
        expect(heartbeat.rows[0]?.instance_id).toBeTruthy();
        expect(heartbeat.rows[0]?.instance_id).not.toBe(owner);
      },
      { timeout: 15_000 },
    );
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await once(child, 'exit');
      }
    }
    await pool.end();
    await database.stop();
  }
}, 60_000);
