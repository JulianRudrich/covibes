import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { releaseAbandonedJobs } from '@server/tasks/abandoned-jobs';
import { createTestServer } from '@server/testing';
import { acquireWorkerLease, type WorkerLease } from '@server/tasks/worker-lease';

const test = createTestServer();
let lease: WorkerLease;
beforeEach(async () => {
  const acquired = await acquireWorkerLease(test.db.adminPool);
  if (!acquired) throw new Error('No worker lease acquired');
  lease = acquired;
});
afterEach(async () => {
  await lease.release();
});

/** A job in its own queue, locked like a worker that is running it. */
async function lockedJob(workerId: string) {
  const pool = test.db.adminPool;
  const queue = `test:${randomUUID()}`;
  const {
    rows: [job],
  } = await pool.query<{ id: string }>(
    `select id from graphile_worker.add_job('agent_turn', '{}'::json, queue_name => $1)`,
    [queue],
  );
  if (!job) throw new Error('No job was added');
  await pool.query(
    `update graphile_worker._private_jobs set locked_by = $2, locked_at = now() where id = $1`,
    [job.id, workerId],
  );
  await pool.query(
    `update graphile_worker._private_job_queues set locked_by = $2, locked_at = now()
     where queue_name = $1`,
    [queue, workerId],
  );
  return { id: job.id, queue };
}

async function lockOf(job: { id: string; queue: string }) {
  const { rows } = await test.db.adminPool.query<{ job: string | null; queue: string | null }>(
    `select j.locked_by as job, q.locked_by as queue
     from graphile_worker._private_jobs j
     join graphile_worker._private_job_queues q on q.id = j.job_queue_id
     where j.id = $1`,
    [job.id],
  );
  return rows[0];
}

describe('releaseAbandonedJobs', () => {
  it('frees jobs and queues that a worker left locked', async () => {
    const job = await lockedJob(`worker-${randomUUID()}`);
    expect(await lockOf(job)).toMatchObject({ job: expect.any(String) as unknown });

    expect(await releaseAbandonedJobs(lease)).toBeGreaterThanOrEqual(1);

    expect(await lockOf(job)).toEqual({ job: null, queue: null });
  });

  it('does nothing without locked jobs', async () => {
    await releaseAbandonedJobs(lease);

    expect(await releaseAbandonedJobs(lease)).toBe(0);
  });

  it('refuses a second owner and leaves the live owner’s jobs locked', async () => {
    const job = await lockedJob(`live-worker-${randomUUID()}`);
    expect(await acquireWorkerLease(test.db.adminPool)).toBeNull();
    expect(await lockOf(job)).toMatchObject({
      job: expect.any(String) as unknown,
      queue: expect.any(String) as unknown,
    });
    await releaseAbandonedJobs(lease);
  });

  it('allows a new owner only after release, and rejects recovery with the old lease', async () => {
    await lease.release();
    await expect(releaseAbandonedJobs(lease)).rejects.toThrow(/ownership/);
    const successor = await acquireWorkerLease(test.db.adminPool);
    expect(successor).not.toBeNull();
    await successor?.release();
  });
});
