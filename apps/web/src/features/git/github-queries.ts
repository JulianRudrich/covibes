import type {
  GitConnectInput,
  GitConnectStart,
  GithubAccountState,
  GithubInstallations,
  GithubRepositoryInput,
  GitRepository,
} from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import { gitQueryKey } from '@web/features/git/queries';
import { api } from '@web/lib/api';

export const githubAccountQuery = queryOptions({
  queryKey: ['github', 'account'] as const,
  queryFn: () => api<GithubAccountState>('/github/account'),
  staleTime: 30_000,
});

export function useConnectGithubAccount() {
  return useMutation({
    mutationFn: (input: GitConnectInput) =>
      api<GitConnectStart>('/github/account/connect', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  });
}

export function useDisconnectGithubAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<undefined>('/github/account', { method: 'DELETE' }),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: githubAccountQuery.queryKey }),
        client.invalidateQueries({
          predicate: (query) => query.queryKey[0] === 'projects' && query.queryKey[2] === 'git',
        }),
      ]),
  });
}

export function githubInstallationsQuery(projectId: string, page: number) {
  return queryOptions({
    queryKey: ['github', projectId, 'installations', page] as const,
    queryFn: () =>
      api<GithubInstallations>(
        `/projects/${encodeURIComponent(projectId)}/github/installations?page=${String(page)}`,
      ),
  });
}

export function githubRepositoriesQuery(projectId: string, installationId: number, search: string) {
  const query = new URLSearchParams({ installationId: String(installationId), search });
  return queryOptions({
    queryKey: ['github', projectId, 'repositories', installationId, search] as const,
    queryFn: () =>
      api<GitRepository[]>(
        `/projects/${encodeURIComponent(projectId)}/github/repositories?${query.toString()}`,
      ),
  });
}

export function usePickGithubRepository(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: GithubRepositoryInput) =>
      api<undefined>(`/projects/${encodeURIComponent(projectId)}/github/repository`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSettled: () => client.invalidateQueries({ queryKey: gitQueryKey(projectId) }),
  });
}
