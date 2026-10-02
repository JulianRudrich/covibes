import { useEffect } from 'react';

import { api } from '@web/lib/api';

/** How often an open, visible project is reported as seen. */
const SEEN_EVERY_MS = 2 * 60_000;

/**
 * Tells the server that the project is open and visible right now (spec 22b): on opening it,
 * whenever the tab comes back to the front, and every two minutes while it stays there. What
 * waits in the project then counts as seen, so no mail tells the person about it. A tab in the
 * background reports nothing: its owner is not looking.
 */
export function useProjectSeen(projectId: string): void {
  useEffect(() => {
    const report = () => {
      if (document.visibilityState !== 'visible') return;
      // Best effort: a report that fails only means a mail the person did not need.
      void api(`/projects/${encodeURIComponent(projectId)}/seen`, { method: 'POST' }).catch(
        () => undefined,
      );
    };
    report();
    const timer = setInterval(report, SEEN_EVERY_MS);
    document.addEventListener('visibilitychange', report);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', report);
    };
  }, [projectId]);
}
