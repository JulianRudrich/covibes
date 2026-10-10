import type { UsageOverview, UsageState } from '@covibes/shared';
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

/** `month` null: the running month, whichever the server says that is. */
export function usageOverviewQueryKey(projectId: string, month: string | null) {
  return ['projects', projectId, 'usage', 'overview', month ?? 'running'] as const;
}

/**
 * What the AI cost in the project in one month, for owners (spec 31b). Only the open dialog holds
 * it; the live channel loads the running month again whenever a run cost something.
 */
export function usageOverviewQuery(projectId: string, month: string | null) {
  return queryOptions({
    queryKey: usageOverviewQueryKey(projectId, month),
    queryFn: () =>
      api<UsageOverview>(
        `/projects/${encodeURIComponent(projectId)}/usage${month === null ? '' : `?month=${month}`}`,
      ),
  });
}
