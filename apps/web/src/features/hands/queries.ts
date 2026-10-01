import type { ChatMessage, HandRaise, MessageOffer } from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import { messagesQueryKey, type ChatItem } from '@web/features/chat/types';
import { api, ApiError } from '@web/lib/api';

export function handsQueryKey(projectId: string) {
  return ['projects', projectId, 'hands'] as const;
}

/**
 * The open raised hands of a project (spec 15). The live channel reloads them when an agent raises
 * a hand or someone listens to it or dismisses it.
 */
export function handsQuery(projectId: string) {
  return queryOptions({
    queryKey: handsQueryKey(projectId),
    queryFn: () => api<HandRaise[]>(`/projects/${encodeURIComponent(projectId)}/hands`),
    staleTime: Infinity,
  });
}

export type HandDecision = 'listen' | 'dismiss';

/** Why deciding failed, for the note over the canvas. */
function failureOf(error: unknown): 'already_decided' | 'failed' {
  return error instanceof ApiError && error.code === 'already_decided'
    ? 'already_decided'
    : 'failed';
}

/**
 * Listening to or dismissing a raised hand: the card disappears at once and comes back with a
 * note if the server refuses. Someone else deciding first counts as done.
 */
export function useHandDecisions(
  projectId: string,
  onFailure: (reason: 'already_decided' | 'failed') => void,
) {
  const queryClient = useQueryClient();
  const queryKey = handsQueryKey(projectId);

  const mutation = useMutation({
    mutationFn: ({ hand, decision }: { hand: HandRaise; decision: HandDecision }) =>
      api<undefined>(
        `/projects/${encodeURIComponent(projectId)}/hands/${encodeURIComponent(hand.id)}/${decision}`,
        { method: 'POST' },
      ),
    onMutate: async ({ hand }) => {
      await queryClient.cancelQueries({ queryKey, exact: true });
      const previous = queryClient.getQueryData<HandRaise[]>(queryKey);
      queryClient.setQueryData<HandRaise[]>(queryKey, (open) =>
        open?.filter((entry) => entry.id !== hand.id),
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      const reason = failureOf(error);
      if (reason === 'failed' && context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      onFailure(reason);
    },
    // Only the raised hands: the keys of messages and runs start with the project's too.
    onSettled: () => queryClient.invalidateQueries({ queryKey, exact: true }),
  });

  return (hand: HandRaise, decision: HandDecision) => {
    mutation.mutate({ hand, decision });
  };
}

/** The offer of a message with a new status, in the cached messages. */
function setOfferStatus(
  items: readonly ChatItem[] | undefined,
  offerId: string,
  change: Pick<MessageOffer, 'status' | 'decidedBy'>,
): ChatItem[] | undefined {
  return items?.map((item) =>
    item.offer?.id === offerId ? { ...item, offer: { ...item.offer, ...change } } : item,
  );
}

/**
 * Accepting or declining the moderator's offer of help (spec 15). The buttons give way to the
 * line with the decision at once; if the server refuses, they come back with a note. The changed
 * message arrives live for everyone.
 */
export function useOfferDecisions(
  projectId: string,
  userName: string,
  onFailure: (reason: 'already_decided' | 'failed') => void,
) {
  const queryClient = useQueryClient();
  const queryKey = messagesQueryKey(projectId);

  const mutation = useMutation({
    mutationFn: ({ offer, accept }: { offer: MessageOffer; accept: boolean }) =>
      api<undefined>(
        `/projects/${encodeURIComponent(projectId)}/offers/${encodeURIComponent(offer.id)}/${accept ? 'accept' : 'decline'}`,
        { method: 'POST' },
      ),
    onMutate: ({ offer, accept }) => {
      queryClient.setQueryData<ChatItem[]>(queryKey, (items) =>
        setOfferStatus(items, offer.id, {
          status: accept ? 'accepted' : 'declined',
          decidedBy: userName,
        }),
      );
    },
    onError: (error, { offer }) => {
      const reason = failureOf(error);
      if (reason === 'failed') {
        queryClient.setQueryData<ChatItem[]>(queryKey, (items) =>
          setOfferStatus(items, offer.id, { status: 'open', decidedBy: null }),
        );
      }
      onFailure(reason);
    },
  });

  return (message: ChatMessage, accept: boolean) => {
    if (message.offer) mutation.mutate({ offer: message.offer, accept });
  };
}
