import { useQueryClient, type QueryKey } from '@tanstack/react-query';

import { customAgentsQueryKey } from '@web/features/agents/queries';
import { applyLiveEvent } from '@web/features/chat/queries';
import { runsQueryKey } from '@web/features/chat/runs';
import { messagesQueryKey } from '@web/features/chat/types';
import {
  criteriaQueryKey,
  decisionLogQueryKey,
  decisionsQueryKey,
} from '@web/features/decisions/queries';
import { handsQueryKey } from '@web/features/hands/queries';
import { projectQuery } from '@web/features/projects/queries';
import { proposalsQueryKey } from '@web/features/proposals/queries';
import { useLiveChannel } from '@web/features/realtime/live-channel';

/**
 * The live channel of the open project (specs 06 and 11), one connection for chat and boards:
 * messages and runs go into the chat's cache, a change of the boards loads them again. Whatever
 * happened before the channel opened (or while it was down) arrives with a reload.
 */
export function useProjectLive(projectId: string) {
  const queryClient = useQueryClient();

  // The reload has to start after the channel opened. A request still running from before (the
  // first load) may have read its data earlier, and React Query would reuse it instead of asking
  // again; so it is cancelled first, which keeps anything the live channel already wrote.
  // Only this query: the keys of messages and runs start with the key of the project.
  function reload(queryKey: QueryKey) {
    void queryClient
      .cancelQueries({ queryKey, exact: true })
      .then(() => queryClient.invalidateQueries({ queryKey, exact: true }));
  }

  function reloadDecisions() {
    reload(criteriaQueryKey(projectId));
    reload(decisionsQueryKey(projectId));
    // The log is only loaded once its dialog opened.
    if (queryClient.getQueryState(decisionLogQueryKey(projectId))) {
      reload(decisionLogQueryKey(projectId));
    }
  }

  useLiveChannel(projectId, {
    onEvent: (event) => {
      if (event.type === 'boards' || event.type === 'project') {
        reload(projectQuery(projectId).queryKey);
        // Custom agents (spec 19) change with the project; the list is only loaded for editors.
        if (
          event.type === 'project' &&
          queryClient.getQueryState(customAgentsQueryKey(projectId))
        ) {
          reload(customAgentsQueryKey(projectId));
        }
      } else if (event.type === 'proposals') {
        reload(proposalsQueryKey(projectId));
      } else if (event.type === 'hands') {
        reload(handsQueryKey(projectId));
      } else if (event.type === 'decisions') {
        reloadDecisions();
      } else {
        applyLiveEvent(queryClient, projectId, event);
      }
    },
    onConnect: () => {
      reload(messagesQueryKey(projectId));
      reload(runsQueryKey(projectId));
      reload(projectQuery(projectId).queryKey);
      reload(proposalsQueryKey(projectId));
      reload(handsQueryKey(projectId));
      reloadDecisions();
    },
  });
}
