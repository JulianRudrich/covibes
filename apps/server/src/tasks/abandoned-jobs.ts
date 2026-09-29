import { makeWorkerUtils } from 'graphile-worker';
import type pg from 'pg';

/**
 * Frees the jobs of worker processes that ended without shutting down, e.g. killed during a run
 * (on Windows a restart ends the process at once). Graphile Worker would only free them after four
 * hours, and until then the chat would show the agent as typing. Covibes runs exactly one worker
 * process, so when it starts, every lock belongs to a process that is gone. The freed jobs run
 * again right away as their next attempt.
 */
export async function releaseAbandonedJobs(pgPool: pg.Pool): Promise<number> {
  const { rows } = await pgPool.query<{ locked_by: string }>(
    'select distinct locked_by from graphile_worker.jobs where locked_by is not null',
  );
  if (rows.length === 0) return 0;

  const utils = await makeWorkerUtils({ pgPool });
  try {
    await utils.forceUnlockWorkers(rows.map((row) => row.locked_by));
  } finally {
    await utils.release();
  }
  return rows.length;
}
