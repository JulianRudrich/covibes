import { useQueryClient, type QueryKey } from '@tanstack/react-query';

import { customAgentsQueryKey } from '@web/features/agents/queries';
import { applyLiveEvent } from '@web/features/chat/queries';
import { runsQueryKey } from '@web/features/chat/runs';
import { messagesQueryKey } from '@web/features/chat/types';
import {
  criteriaQueryKey,
  decisionLogQueryKey,
  decisionsQueryKey,
  openVotesQueryKey,
} from '@web/features/decisions/queries';
import { handsQueryKey } from '@web/features/hands/queries';
import { notificationsQuery } from '@web/features/notifications/queries';
import { planStateQueryKey } from '@web/features/plan/queries';
import { projectQuery } from '@web/features/projects/queries';
import { proposalsQueryKey } from '@web/features/proposals/queries';
import { packageQueryKey } from '@web/features/export/package-queries';
import { roadmapQueryKey } from '@web/features/roadmap/queries';
import { invitationsQuery } from '@web/features/share/queries';
import { useLiveChannel } from '@web/features/realtime/live-channel';

/**
 * The live channel of the open project (specs 06 and 11), one connection for chat and boards:
 * messages and runs go into the chat's cache, a change of the boards loads them again. A message
 * that mentions `userId` reloads the notifications. Whatever
 * happened before the channel opened (or while it was down) arrives with a reload.
 */
export function useProjectLive(projectId: string, userId?: string) {
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
    // A changed decision or criterion can leave the plan outdated (spec 25c).
    reload(planStateQueryKey(projectId));
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
        // Someone joined through an invitation (spec 21a); the list is only loaded for owners
        // with the share dialog open.
        const invitations = invitationsQuery(projectId).queryKey;
        if (event.type === 'project' && queryClient.getQueryState(invitations)) {
          reload(invitations);
        }
        // Someone who left the project no longer has its tasks (spec 26b).
        if (event.type === 'project') reload(roadmapQueryKey(projectId));
      } else if (event.type === 'proposals') {
        reload(proposalsQueryKey(projectId));
      } else if (event.type === 'hands') {
        reload(handsQueryKey(projectId));
      } else if (event.type === 'decisions') {
        reloadDecisions();
      } else if (event.type === 'plan') {
        // A generation started or ended, or a suggestion was decided (spec 25b).
        reload(planStateQueryKey(projectId));
      } else if (event.type === 'roadmap') {
        // The plan changed what its roadmap shows (spec 26a).
        reload(roadmapQueryKey(projectId));
      } else if (event.type === 'package') {
        // A suggestion for a text of the package started, ended or was decided (spec 27c); only
        // the open export dialog holds what is loaded again.
        reload(packageQueryKey(projectId));
      } else {
        applyLiveEvent(queryClient, projectId, event);
        // A vote started, got a ballot or ended: "Wartet auf dich" lists the open ones (spec 22a).
        if (event.type === 'message' && event.message.vote) {
          reload(openVotesQueryKey(projectId));
        }
        // Someone mentioned the user here: the bell learns it at once (spec 22a).
        if (
          event.type === 'message' &&
          userId !== undefined &&
          event.message.mentionedUsers?.includes(userId)
        ) {
          reload(notificationsQuery.queryKey);
        }
      }
    },
    onConnect: () => {
      reload(messagesQueryKey(projectId));
      reload(runsQueryKey(projectId));
      reload(projectQuery(projectId).queryKey);
      reload(proposalsQueryKey(projectId));
      reload(handsQueryKey(projectId));
      reload(openVotesQueryKey(projectId));
      reload(planStateQueryKey(projectId));
      reload(roadmapQueryKey(projectId));
      reloadDecisions();
    },
  });
}
