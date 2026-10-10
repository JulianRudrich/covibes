import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { gitStateQuery, useRequestGitSync } from '@web/features/git/queries';

/** How often an open project asks for the state of its repository (spec 30a). */
export const GIT_SYNC_INTERVAL_MS = 5 * 60_000;

/**
 * Keeps the status of the tasks up to date while a project is open (spec 30a): it asks the server
 * to read the repository's state when the project opens, then every few minutes, and when the
 * person comes back to a tab that rested. A hidden tab asks nothing. The server decides whether
 * it is time; what it read arrives through the live channel.
 */
export function useGitSync(projectId: string) {
  // A project without a repository has nothing to read; another repository is read at once.
  const repositoryId =
    useQuery({
      ...gitStateQuery(projectId),
      select: (state) => state.connection?.repository.id ?? null,
    }).data ?? null;
  const { mutate } = useRequestGitSync(projectId);

  useEffect(() => {
    if (repositoryId === null) return;
    let asked = 0;
    const ask = () => {
      if (document.visibilityState !== 'visible') return;
      asked = Date.now();
      mutate({});
    };
    const back = () => {
      if (Date.now() - asked >= GIT_SYNC_INTERVAL_MS) ask();
    };
    ask();
    const timer = setInterval(ask, GIT_SYNC_INTERVAL_MS);
    document.addEventListener('visibilitychange', back);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', back);
    };
  }, [repositoryId, mutate]);
}
