import type { ProjectSeen } from '@covibes/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { awayQueryKey } from '@web/features/away/queries';
import { api } from '@web/lib/api';

/** How often an open, visible project is reported as seen. */
const SEEN_EVERY_MS = 2 * 60_000;

/**
 * Tells the server that the project is open and visible right now (spec 22b): on opening it,
 * whenever the tab comes back to the front, and every two minutes while it stays there. What
 * waits in the project then counts as seen, so no mail tells the person about it. A tab in the
 * background reports nothing: its owner is not looking.
 *
 * The server answers whether the person is back from an absence (spec 23); then "Seit du weg
 * warst" has something new and is loaded again.
 */
export function useProjectSeen(projectId: string): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const report = () => {
      if (document.visibilityState !== 'visible') return;
      api<ProjectSeen | undefined>(`/projects/${encodeURIComponent(projectId)}/seen`, {
        method: 'POST',
      })
        .then(async (seen) => {
          if (!seen?.returned) return;
          const summary = { queryKey: awayQueryKey(projectId), exact: true };
          // A question that is still on its way may be answered from before the server noted
          // the return; it is dropped, so the summary is asked for again in any case.
          await queryClient.cancelQueries(summary);
          await queryClient.invalidateQueries(summary);
        })
        // Best effort: a report that fails only means a mail the person did not need.
        .catch(() => undefined);
    };
    report();
    const timer = setInterval(report, SEEN_EVERY_MS);
    document.addEventListener('visibilitychange', report);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', report);
    };
  }, [projectId, queryClient]);
}
