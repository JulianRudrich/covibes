import type { GitRequest } from '@covibes/shared';

/** How far a request is: its issues, and how many of its actions are done. */
export function requestProgress(request: Pick<GitRequest, 'actions'>) {
  const actions = request.actions.filter((action) => action.status !== 'dropped');
  return {
    issues: request.actions.filter((action) => action.kind === 'issue').length,
    total: actions.length,
    done: actions.filter((action) => action.status === 'done').length,
    /** Why the first failed action failed. */
    error: request.actions.find((action) => action.error !== null)?.error ?? null,
  };
}

/** The Git requests the user can act on: those that wait or failed, for who may approve. */
export function gitRequestsToDecide(
  git: { canApprove: boolean; requests: readonly GitRequest[] } | undefined,
): number {
  if (!git?.canApprove) return 0;
  return git.requests.filter(
    (request) => request.status === 'waiting' || request.status === 'failed',
  ).length;
}
