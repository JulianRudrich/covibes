import type { MessageDebate } from '@covibes/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { messagesQueryKey, type ChatItem } from '@web/features/chat/types';
import { api, ApiError } from '@web/lib/api';

/**
 * "Debatte beenden" on the card of a moderator message (spec 18). The card shows at once that the
 * debate is ending and takes it back with a note if the server refuses; the debate as the server
 * knows it arrives live with the changed message.
 */
export function useStopDebate(
  projectId: string,
  userName: string,
  onFailure: (reason: 'already_decided' | 'failed') => void,
) {
  const queryClient = useQueryClient();
  const queryKey = messagesQueryKey(projectId);
  const setStopped = (debateId: string, stopped: boolean) => {
    queryClient.setQueryData<ChatItem[]>(queryKey, (items) =>
      items?.map((item) =>
        item.debate?.id === debateId
          ? { ...item, debate: { ...item.debate, stopped, stoppedBy: stopped ? userName : null } }
          : item,
      ),
    );
  };

  const { mutate } = useMutation({
    mutationFn: (debate: MessageDebate) =>
      api<undefined>(
        `/projects/${encodeURIComponent(projectId)}/debates/${encodeURIComponent(debate.id)}/stop`,
        { method: 'POST' },
      ),
    onMutate: (debate) => {
      setStopped(debate.id, true);
    },
    onError: (error, debate) => {
      const decided = error instanceof ApiError && error.code === 'already_decided';
      // Ended already: the live channel brings the card as it is. Otherwise it still runs.
      if (!decided) setStopped(debate.id, false);
      onFailure(decided ? 'already_decided' : 'failed');
    },
  });

  return useCallback(
    (debate: MessageDebate) => {
      mutate(debate);
    },
    [mutate],
  );
}
