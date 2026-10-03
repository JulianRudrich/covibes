import type { Roadmap, RoadmapPlace } from '@covibes/shared';
import { queryOptions, useMutation } from '@tanstack/react-query';

import { api } from '@web/lib/api';

export function roadmapQueryKey(projectId: string) {
  return ['projects', projectId, 'roadmap'] as const;
}

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/roadmap`;

/**
 * The roadmap of a project (spec 26a): the milestones of its plan as they stand. The live channel
 * loads it again whenever what it shows changed, so it never goes stale on its own.
 */
export function roadmapQuery(projectId: string) {
  return queryOptions({
    queryKey: roadmapQueryKey(projectId),
    queryFn: () => api<Roadmap>(base(projectId)),
    staleTime: Infinity,
  });
}

/**
 * Finds the board and frame that show the roadmap; for owners and editors the server adds one to
 * the main canvas when there is none.
 */
export function useOpenRoadmap(projectId: string) {
  return useMutation({
    mutationFn: () => api<RoadmapPlace>(`${base(projectId)}/open`, { method: 'POST' }),
  });
}
