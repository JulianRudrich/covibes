import type {
  ApproveGitRequestsInput,
  GitIssuePlan,
  GitIssuesInput,
  GitLog,
  GitMergeRequestPlan,
  GitMergeRequests,
  GitRequestCreated,
  GitRequests,
  GitRequestsApproved,
  GitReview,
  GitReviews,
  GitReviewStarted,
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

export function gitMergeRequestQueryKey(projectId: string) {
  return [...gitQueryKey(projectId), 'merge-request'] as const;
}

export function gitMergeRequestsQueryKey(projectId: string) {
  return [...gitQueryKey(projectId), 'merge-requests'] as const;
}

export function gitReviewsQueryKey(projectId: string) {
  return [...gitQueryKey(projectId), 'reviews'] as const;
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

/**
 * The package next to the repository's default branch (spec 29c); loaded whenever the dialog of
 * the package opens, and again when the package or the repository changed.
 */
export function gitMergeRequestQuery(projectId: string) {
  return queryOptions({
    queryKey: gitMergeRequestQueryKey(projectId),
    queryFn: () => api<GitMergeRequestPlan>(`${base(projectId)}/merge-request`),
    staleTime: 0,
    gcTime: 0,
  });
}

/** The open merge requests of the repository (spec 29d); loaded whenever their dialog opens. */
export function gitMergeRequestsQuery(projectId: string) {
  return queryOptions({
    queryKey: gitMergeRequestsQueryKey(projectId),
    queryFn: () => api<GitMergeRequests>(`${base(projectId)}/merge-requests`),
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * The latest review of every open merge request (spec 30b). The live channel loads it again
 * whenever a review started, ended or the repository's state was read.
 */
export function gitReviewsQuery(projectId: string) {
  return queryOptions({
    queryKey: gitReviewsQueryKey(projectId),
    queryFn: () => api<GitReviews>(`${base(projectId)}/reviews`),
    staleTime: Infinity,
  });
}

/** The reviews that say a merge request goes against the architecture: what the overview shows. */
export function deviatingReviews(reviews: readonly GitReview[] | undefined): GitReview[] {
  return (reviews ?? []).filter(
    (review) => review.open && review.status === 'done' && review.verdict === 'deviates',
  );
}

/** Starts the review of an open merge request at the state its commits have now. */
export function useRequestReview(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (number: number) =>
      api<GitReviewStarted>(`${base(projectId)}/merge-requests/${String(number)}/review`, {
        method: 'POST',
      }),
    onSettled: () =>
      Promise.all(
        [gitMergeRequestsQueryKey, gitReviewsQueryKey].map((key) =>
          queryClient.invalidateQueries({ queryKey: key(projectId), exact: true }),
        ),
      ),
  });
}

/**
 * Loads again what a request changed: the queue, the tasks' issues, the package, the open merge
 * requests and the log.
 */
function reloadRequests(queryClient: QueryClient, projectId: string) {
  return Promise.all(
    [
      gitRequestsQueryKey,
      gitIssuesQueryKey,
      gitLogQueryKey,
      gitMergeRequestQueryKey,
      gitMergeRequestsQueryKey,
    ].map((key) => queryClient.invalidateQueries({ queryKey: key(projectId), exact: true })),
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

/** Makes the request that brings the package into the repository as a merge request. */
export function useRequestMergeRequest(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<GitRequestCreated>(`${base(projectId)}/merge-request`, { method: 'POST' }),
    onSettled: () => reloadRequests(queryClient, projectId),
  });
}

/** Makes the request to merge an open merge request, by its number. */
export function useRequestMerge(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (number: number) =>
      api<GitRequestCreated>(`${base(projectId)}/merge-requests/${String(number)}/merge`, {
        method: 'POST',
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
