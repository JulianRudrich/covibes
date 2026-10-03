import type { Roadmap, RoadmapAssignee } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';

import { roadmapQuery } from '@web/features/roadmap/queries';

/** What owners and editors need to assign tasks (spec 26b): who can take one, and how. */
export type TaskAssigning = {
  members: readonly RoadmapAssignee[];
  onAssign: (taskId: string, assignee: RoadmapAssignee | null) => void;
};

/**
 * Where the canvas gets the roadmap from (spec 26a): in a project it loads it, the read-only view
 * hands over the one of its snapshot. Without a provider there is none.
 */
export type RoadmapSource = {
  projectId: string | null;
  /** The roadmap of a snapshot; null when the snapshot has none. */
  roadmap?: Roadmap | null;
  /** Opens the plan, where the milestones are written; missing where that is not possible. */
  onOpenPlan?: () => void;
  /** Missing for viewers and in the read-only view: they see the assignees and change nothing. */
  assigning?: TaskAssigning;
};

const RoadmapContext = createContext<RoadmapSource>({ projectId: null, roadmap: null });

export const RoadmapProvider = RoadmapContext.Provider;

export function useRoadmapSource(): RoadmapSource {
  return useContext(RoadmapContext);
}

/** The roadmap while it is needed (`enabled`); undefined while it loads or when there is none. */
export function useRoadmap(enabled = true): Roadmap | undefined {
  const { projectId, roadmap } = useRoadmapSource();
  const query = useQuery({
    ...roadmapQuery(projectId ?? ''),
    enabled: enabled && projectId !== null && roadmap === undefined,
  });
  if (roadmap !== undefined) return roadmap ?? undefined;
  return query.data;
}
