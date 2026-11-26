import type { WorkerLease } from '@server/tasks/worker-lease';

/**
 * Frees the jobs of worker processes that ended without shutting down, e.g. killed during a run
 * (on Windows a restart ends the process at once). Graphile Worker would only free them after four
 * hours, and until then the chat would show the agent as typing. Covibes runs exactly one worker
 * process, so when it starts, every lock belongs to a process that is gone. The freed jobs run
 * again right away as their next attempt.
 */
export async function releaseAbandonedJobs(lease: WorkerLease): Promise<number> {
  // Only an exclusive owner can know that every previous queue lock is abandoned.
  lease.assertHeld();
  return lease.recoverJobs();
}
