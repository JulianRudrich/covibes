import type { UsageState } from '@covibes/shared';
import { queryOptions } from '@tanstack/react-query';

import { api } from '@web/lib/api';

export function usageStateQueryKey(projectId: string) {
  return ['projects', projectId, 'usage', 'state'] as const;
}

/**
 * Whether a limit of the AI is reached for this project or for the person (spec 31a). The live
 * channel loads it again whenever a run cost something, so it never goes stale on its own.
 */
export function usageStateQuery(projectId: string) {
  return queryOptions({
    queryKey: usageStateQueryKey(projectId),
    queryFn: () => api<UsageState>(`/projects/${encodeURIComponent(projectId)}/usage/state`),
    staleTime: Infinity,
  });
}
