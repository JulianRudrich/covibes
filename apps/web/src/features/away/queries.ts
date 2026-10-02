import type { AwaySummary } from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@web/lib/api';

/** How often the section asks again while the moderator is still writing. */
const TEXT_REFRESH_MS = 3_000;

export function awayQueryKey(projectId: string) {
  return ['projects', projectId, 'away'] as const;
}

/**
 * "Seit du weg warst" of a project (spec 23): what happened while the user did not have it open,
 * or null. It only changes when the user comes back from an absence (the workspace then loads it
 * again) and when the moderator's words arrive, which it asks for until they are there.
 */
export function awayQuery(projectId: string) {
  return queryOptions({
    queryKey: awayQueryKey(projectId),
    queryFn: () => api<AwaySummary | null>(`/projects/${encodeURIComponent(projectId)}/away`),
    staleTime: Infinity,
    refetchInterval: (query) =>
      query.state.data?.textStatus === 'pending' ? TEXT_REFRESH_MS : false,
  });
}

/** "Verstanden": the section goes at once and stays closed until the next return. */
export function useDismissAway(projectId: string) {
  const queryClient = useQueryClient();
  const queryKey = awayQueryKey(projectId);
  return useMutation({
    mutationFn: () =>
      api<undefined>(`/projects/${encodeURIComponent(projectId)}/away/dismiss`, {
        method: 'POST',
      }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData<AwaySummary | null>(queryKey, null);
    },
    // If closing failed, the server still has it: show it again.
    onError: () => queryClient.invalidateQueries({ queryKey, exact: true }),
  });
}
