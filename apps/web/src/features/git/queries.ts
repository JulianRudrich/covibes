import type { GitConnectStart, GitRepository, GitRepositoryInput, GitState } from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@web/lib/api';

export function gitQueryKey(projectId: string) {
  return ['projects', projectId, 'git'] as const;
}

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/git`;

/**
 * The project's connection to GitLab (spec 28a). The live channel loads it again whenever it
 * changed, so it never goes stale on its own.
 */
export function gitStateQuery(projectId: string) {
  return queryOptions({
    queryKey: gitQueryKey(projectId),
    queryFn: () => api<GitState>(base(projectId)),
    staleTime: Infinity,
  });
}

/** The repositories the connected account works in, narrowed by a search, to pick from. */
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
export function useConnectGit(projectId: string) {
  return useMutation({
    mutationFn: () => api<GitConnectStart>(`${base(projectId)}/connect`, { method: 'POST' }),
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

/** Ends the project's connection. */
export function useDisconnectGit(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<undefined>(base(projectId), { method: 'DELETE' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: gitQueryKey(projectId) }),
  });
}
