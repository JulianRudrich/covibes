import { randomUUID } from 'node:crypto';

import type pg from 'pg';

// Different from the migration lock; one owner of the application's worker queues.
const WORKER_LOCK_ID = 4_720_260_941;

export type WorkerLease = {
  instanceId: string;
  /** Fails after the dedicated session was lost or released. */
  assertHeld: () => void;
  recoverJobs: () => Promise<number>;
  heartbeat: (ai: { available: boolean; retryAt: Date | null }) => Promise<void>;
  release: () => Promise<void>;
};

/** The session stays checked out until the runner has stopped: a pool must never lend it out. */
export async function acquireWorkerLease(
  pool: pg.Pool,
  onLost: () => void = () => undefined,
): Promise<WorkerLease | null> {
  const client = await pool.connect();
  let held = false;
  let released = false;
  const lost = () => {
    if (!held || released) return;
    held = false;
    onLost();
  };
  client.on('error', lost);
  client.on('end', lost);
  try {
    const { rows } = await client.query<{ acquired: boolean }>(
      'select pg_try_advisory_lock($1) as acquired',
      [WORKER_LOCK_ID],
    );
    if (!rows[0]?.acquired) {
      client.off('error', lost);
      client.off('end', lost);
      client.release();
      return null;
    }
    held = true;
    const instanceId = randomUUID();
    const assertHeld = () => {
      if (!held || released) throw new Error('Worker ownership is no longer held');
    };
    return {
      instanceId,
      assertHeld,
      recoverJobs: async () => {
        assertHeld();
        const { rows } = await client.query<{ locked_by: string }>(
          'select distinct locked_by from graphile_worker.jobs where locked_by is not null',
        );
        if (rows.length > 0) {
          // Use the lock-owning session itself: a lost lease cannot issue an unlock through
          // some other still-live pooled connection after a successor has started.
          await client.query('select graphile_worker.force_unlock_workers($1::text[])', [
            rows.map((row) => row.locked_by),
          ]);
        }
        return rows.length;
      },
      heartbeat: async (ai) => {
        assertHeld();
        await client.query(
          `insert into worker_heartbeats
             (singleton, instance_id, heartbeat_at, ai_available, ai_retry_at)
           values (true, $1, now(), $2, $3)
           on conflict (singleton) do update set instance_id = excluded.instance_id,
             heartbeat_at = excluded.heartbeat_at, ai_available = excluded.ai_available,
             ai_retry_at = excluded.ai_retry_at`,
          [instanceId, ai.available, ai.retryAt],
        );
      },
      release: async () => {
        if (released) return;
        released = true;
        try {
          if (held) {
            await client.query('delete from worker_heartbeats where instance_id = $1', [
              instanceId,
            ]);
            await client.query('select pg_advisory_unlock($1)', [WORKER_LOCK_ID]);
          }
        } finally {
          held = false;
          client.off('error', lost);
          client.off('end', lost);
          client.release();
        }
      },
    };
  } catch (error) {
    client.off('error', lost);
    client.off('end', lost);
    client.release();
    throw error;
  }
}
