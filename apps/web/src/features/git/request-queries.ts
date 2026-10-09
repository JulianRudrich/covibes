import type {
  ApproveGitRequestsInput,
  GitIssuePlan,
  GitIssuesInput,
  GitLog,
  GitRequestCreated,
  GitRequests,
  GitRequestsApproved,
} from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { gitQueryKey } from '@web/features/git/queries';
import { api } from '@web/lib/api';

// Git requests in the web app (spec 29b): what waits for approval, the plan's tasks with their
// issues, and the log. The live channel loads them again on `git`.

export function gitRequestsQueryKey(projectId: string) {
  return [...gitQueryKey(projectId), 'requests'] as const;
}

export function gitIssuesQueryKey(projectId: string) {
  return [...gitQueryKey(projectId), 'issues'] as const;
}

export function gitLogQueryKey(projectId: string) {
  return [...gitQueryKey(projectId), 'log'] as const;
}

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/git`;

/** What waits, runs or failed, and what was just done. */
export function gitRequestsQuery(projectId: string) {
  return queryOptions({
    queryKey: gitRequestsQueryKey(projectId),
    queryFn: () => api<GitRequests>(`${base(projectId)}/requests`),
    staleTime: Infinity,
  });
}

/** The plan's tasks with their issues; loaded whenever its dialog opens. */
export function gitIssuesQuery(projectId: string) {
  return queryOptions({
    queryKey: gitIssuesQueryKey(projectId),
    queryFn: () => api<GitIssuePlan>(`${base(projectId)}/issues`),
    staleTime: 0,
    gcTime: 0,
  });
}

/** The log of Git actions; loaded whenever its dialog opens. */
export function gitLogQuery(projectId: string) {
  return queryOptions({
    queryKey: gitLogQueryKey(projectId),
    queryFn: () => api<GitLog>(`${base(projectId)}/log`),
    staleTime: 0,
    gcTime: 0,
  });
}

/** Loads again what a request changed: the queue, the tasks' issues and the log. */
function reloadRequests(queryClient: QueryClient, projectId: string) {
  return Promise.all(
    [gitRequestsQueryKey, gitIssuesQueryKey, gitLogQueryKey].map((key) =>
      queryClient.invalidateQueries({ queryKey: key(projectId), exact: true }),
    ),
  );
}

/** Makes a request for issues of the chosen tasks. */
export function useRequestGitIssues(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GitIssuesInput) =>
      api<GitRequestCreated>(`${base(projectId)}/issues`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSettled: () => reloadRequests(queryClient, projectId),
  });
}

/** Approves one or several requests; the worker runs them. */
export function useApproveGitRequests(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ApproveGitRequestsInput) =>
      api<GitRequestsApproved>(`${base(projectId)}/requests/approve`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSettled: () => reloadRequests(queryClient, projectId),
  });
}

/** Rejects a request (who may approve), or takes it back (who made it). */
export function useEndGitRequest(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, how }: { requestId: string; how: 'reject' | 'withdraw' }) =>
      api<undefined>(`${base(projectId)}/requests/${encodeURIComponent(requestId)}/${how}`, {
        method: 'POST',
      }),
    onSettled: () => reloadRequests(queryClient, projectId),
  });
}
