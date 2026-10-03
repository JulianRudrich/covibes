import type { Roadmap, RoadmapAssignee, RoadmapPlace } from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@web/lib/api';

export function roadmapQueryKey(projectId: string) {
  return ['projects', projectId, 'roadmap'] as const;
}

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/roadmap`;

/**
 * The roadmap of a project (spec 26a): the milestones of its plan as they stand, with who took
 * which task (spec 26b). The live channel loads it again whenever what it shows changed, so it
 * never goes stale on its own.
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

/** The roadmap with another assignee on one of its tasks. */
function withAssignee(roadmap: Roadmap, taskId: string, assignee: RoadmapAssignee | null): Roadmap {
  return {
    milestones: roadmap.milestones.map((milestone) =>
      milestone.tasks.some((task) => task.id === taskId)
        ? {
            ...milestone,
            tasks: milestone.tasks.map((task) =>
              task.id === taskId ? { ...task, assignee } : task,
            ),
          }
        : milestone,
    ),
  };
}

/**
 * Gives a task to a member, or to nobody (spec 26b). The roadmap shows it at once; the server's
 * state follows through the live channel, and after a failure it is loaded again.
 */
export function useAssignTask(projectId: string, onFailed: () => void) {
  const queryClient = useQueryClient();
  const queryKey = roadmapQueryKey(projectId);
  return useMutation({
    mutationFn: ({ taskId, assignee }: { taskId: string; assignee: RoadmapAssignee | null }) =>
      api<undefined>(`${base(projectId)}/tasks/${encodeURIComponent(taskId)}/assignee`, {
        method: 'PUT',
        body: JSON.stringify({ userId: assignee?.userId ?? null }),
      }),
    onMutate: async ({ taskId, assignee }) => {
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData<Roadmap>(
        queryKey,
        (roadmap) => roadmap && withAssignee(roadmap, taskId, assignee),
      );
    },
    onError: () => {
      onFailed();
      return queryClient.invalidateQueries({ queryKey, exact: true });
    },
  });
}
