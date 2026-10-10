import type {
  GitAccountState,
  GitConnectInput,
  GitConnectStart,
  GitRepository,
  GitRepositoryInput,
  GitState,
  GitSyncInput,
  GitSyncRequested,
  GitWebhook,
} from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@web/lib/api';

/** Everything the web app holds about the person's own GitLab account. */
export const gitAccountQueryKey = ['git', 'account'] as const;

export function gitQueryKey(projectId: string) {
  return ['projects', projectId, 'git'] as const;
}

export function gitWebhookQueryKey(projectId: string) {
  return [...gitQueryKey(projectId), 'webhook'] as const;
}

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/git`;

/** The person's own GitLab account (spec 29a). */
export const gitAccountQuery = queryOptions({
  queryKey: gitAccountQueryKey,
  queryFn: () => api<GitAccountState>('/git/account'),
  staleTime: 30_000,
});

/**
 * The repository of a project (specs 28a and 29a), and the person's own account to pick it with.
 * The live channel loads it again whenever the project's connection changed.
 */
export function gitStateQuery(projectId: string) {
  return queryOptions({
    queryKey: gitQueryKey(projectId),
    queryFn: () => api<GitState>(base(projectId)),
    staleTime: Infinity,
  });
}

/** The repositories the person's own account works in, narrowed by a search, to pick from. */
export function gitRepositoriesQuery(projectId: string, search: string) {
  return queryOptions({
    queryKey: [...gitQueryKey(projectId), 'repositories', search] as const,
    queryFn: () =>
      api<GitRepository[]>(
        `${base(projectId)}/repositories${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      ),
    staleTime: 30_000,
  });
}

/** Starts the OAuth flow: the address of GitLab's consent page, where the browser goes next. */
export function useConnectGitAccount() {
  return useMutation({
    mutationFn: (input: GitConnectInput) =>
      api<GitConnectStart>('/git/account/connect', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  });
}

/** Ends the own account; the projects it served are disconnected by the server. */
export function useDisconnectGitAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<undefined>('/git/account', { method: 'DELETE' }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: gitAccountQueryKey }),
        // Every project's state names the own account.
        queryClient.invalidateQueries({
          predicate: (query) => query.queryKey[0] === 'projects' && query.queryKey[2] === 'git',
        }),
      ]),
  });
}

/** Picks the repository of the project; the state follows from the server. */
export function usePickGitRepository(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GitRepositoryInput) =>
      api<undefined>(`${base(projectId)}/repository`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: gitQueryKey(projectId) }),
  });
}

/** Removes the repository from the project; the account of who picked it stays. */
export function useRemoveGitRepository(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<undefined>(base(projectId), { method: 'DELETE' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: gitQueryKey(projectId) }),
  });
}

/**
 * Asks the server to read the repository's state (spec 30a); `force` is a person's click. The
 * server says whether it queued a reading; what was read arrives through the live channel.
 */
export function useRequestGitSync(projectId: string) {
  return useMutation({
    mutationFn: (input: GitSyncInput) =>
      api<GitSyncRequested>(`${base(projectId)}/sync`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  });
}

/** The webhook an owner enters in GitLab (spec 30a); loaded when the owner asks for it. */
export function gitWebhookQuery(projectId: string) {
  return queryOptions({
    queryKey: gitWebhookQueryKey(projectId),
    queryFn: () => api<GitWebhook>(`${base(projectId)}/webhook`),
    staleTime: 0,
    gcTime: 0,
  });
}

/** Replaces the webhook's secret; the one entered in GitLab stops working. */
export function useRenewGitWebhook(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<GitWebhook>(`${base(projectId)}/webhook/renew`, { method: 'POST' }),
    onSuccess: (webhook) => {
      queryClient.setQueryData(gitWebhookQueryKey(projectId), webhook);
    },
  });
}
