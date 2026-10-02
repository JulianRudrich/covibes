import type { Criterion, Decision, DecisionLogEntry, MessageVote, OpenVote } from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { messagesQueryKey, type ChatItem } from '@web/features/chat/types';
import { api, ApiError } from '@web/lib/api';

export function criteriaQueryKey(projectId: string) {
  return ['projects', projectId, 'criteria'] as const;
}

export function decisionsQueryKey(projectId: string) {
  return ['projects', projectId, 'decisions'] as const;
}

export function decisionLogQueryKey(projectId: string) {
  return ['projects', projectId, 'decisions', 'log'] as const;
}

export function openVotesQueryKey(projectId: string) {
  return ['projects', projectId, 'votes'] as const;
}

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;

/**
 * The open votes of a project, for "Wartet auf dich" (spec 22a). The live channel reloads them
 * when a message with a vote changes.
 */
export function openVotesQuery(projectId: string) {
  return queryOptions({
    queryKey: openVotesQueryKey(projectId),
    queryFn: () => api<OpenVote[]>(`${base(projectId)}/votes`),
    staleTime: Infinity,
  });
}

/**
 * Criteria, decisions and the decision log of a project (spec 16a). The live channel reloads them
 * whenever a decision or the criteria change, so they never go stale on their own.
 */
export function criteriaQuery(projectId: string) {
  return queryOptions({
    queryKey: criteriaQueryKey(projectId),
    queryFn: () => api<Criterion[]>(`${base(projectId)}/criteria`),
    staleTime: Infinity,
  });
}

export function decisionsQuery(projectId: string) {
  return queryOptions({
    queryKey: decisionsQueryKey(projectId),
    queryFn: () => api<Decision[]>(`${base(projectId)}/decisions`),
    staleTime: Infinity,
  });
}

export function decisionLogQuery(projectId: string) {
  return queryOptions({
    queryKey: decisionLogQueryKey(projectId),
    queryFn: () => api<DecisionLogEntry[]>(`${base(projectId)}/decisions/log`),
    staleTime: Infinity,
  });
}

/** Why changing the criteria failed, for the note over the canvas. */
export type CriteriaFailure = 'limit_reached' | 'failed';

/**
 * Adding, changing and removing criteria. Every change shows at once and is undone with a note if
 * the server refuses; afterwards the criteria are loaded again, as they are for everyone else
 * after the live event.
 */
export function useCriteriaMutations(
  projectId: string,
  onFailure: (reason: CriteriaFailure) => void,
) {
  const queryClient = useQueryClient();
  const queryKey = criteriaQueryKey(projectId);

  async function optimistic(update: (criteria: Criterion[]) => Criterion[]) {
    await queryClient.cancelQueries({ queryKey, exact: true });
    const previous = queryClient.getQueryData<Criterion[]>(queryKey);
    queryClient.setQueryData<Criterion[]>(queryKey, (criteria) => update(criteria ?? []));
    return { previous };
  }
  const rollback = (error: unknown, _input: unknown, context?: { previous?: Criterion[] }) => {
    if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    onFailure(
      error instanceof ApiError && error.code === 'limit_reached' ? 'limit_reached' : 'failed',
    );
  };
  // Only the criteria: other keys of the project start with the same parts.
  const reload = () => queryClient.invalidateQueries({ queryKey, exact: true });

  const add = useMutation({
    mutationFn: (text: string) =>
      api<Criterion>(`${base(projectId)}/criteria`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),
    onMutate: (text) =>
      // The id is only a placeholder until the server answers.
      optimistic((criteria) => [...criteria, { id: `new-${String(Date.now())}`, text }]),
    onError: rollback,
    onSettled: reload,
  });

  const change = useMutation({
    mutationFn: ({ id, text }: Criterion) =>
      api<Criterion>(`${base(projectId)}/criteria/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ text }),
      }),
    onMutate: ({ id, text }) =>
      optimistic((criteria) =>
        criteria.map((criterion) => (criterion.id === id ? { id, text } : criterion)),
      ),
    onError: rollback,
    onSettled: reload,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api<undefined>(`${base(projectId)}/criteria/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onMutate: (id) => optimistic((criteria) => criteria.filter((criterion) => criterion.id !== id)),
    onError: rollback,
    onSettled: reload,
  });

  return { add, change, remove };
}

/** Reopens a decision with a reason; the moderator then starts a new round in the chat. */
export function useReopenDecision(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ decisionId, reason }: { decisionId: string; reason: string }) =>
      api<undefined>(`${base(projectId)}/decisions/${encodeURIComponent(decisionId)}/reopen`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: decisionsQueryKey(projectId), exact: true }),
  });
}

/**
 * Voting on the card of a moderator message and ending a vote (spec 16b). The own vote shows at
 * once and is taken back with a note if the server refuses; the vote as the server knows it
 * arrives live with the changed message.
 */
export function useVoteActions(
  projectId: string,
  userId: string,
  onFailure: (reason: 'already_decided' | 'failed') => void,
) {
  const queryClient = useQueryClient();
  const queryKey = messagesQueryKey(projectId);
  const path = (vote: MessageVote, action: 'cast' | 'close') =>
    `${base(projectId)}/votes/${encodeURIComponent(vote.id)}/${action}`;
  const failed = (error: unknown) => {
    onFailure(
      error instanceof ApiError && error.code === 'already_decided' ? 'already_decided' : 'failed',
    );
  };

  const setBallots = (voteId: string, ballots: MessageVote['ballots']) => {
    queryClient.setQueryData<ChatItem[]>(queryKey, (items) =>
      items?.map((item) =>
        item.vote?.id === voteId ? { ...item, vote: { ...item.vote, ballots } } : item,
      ),
    );
    // The same vote under "Wartet auf dich" (spec 22a).
    queryClient.setQueryData<OpenVote[]>(openVotesQueryKey(projectId), (votes) =>
      votes?.map((vote) => (vote.id === voteId ? { ...vote, ballots } : vote)),
    );
  };

  const { mutate: castVote } = useMutation({
    mutationFn: ({ vote, option }: { vote: MessageVote; option: number }) =>
      api<undefined>(path(vote, 'cast'), { method: 'POST', body: JSON.stringify({ option }) }),
    onMutate: ({ vote, option }) => {
      setBallots(vote.id, [
        ...vote.ballots.filter((ballot) => ballot.userId !== userId),
        { userId, option },
      ]);
    },
    onError: (error, { vote }) => {
      setBallots(vote.id, vote.ballots);
      failed(error);
    },
    // The vote no longer waits for the user (spec 22a).
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: openVotesQueryKey(projectId), exact: true }),
  });

  const { mutate: closeVote } = useMutation({
    mutationFn: (vote: MessageVote) => api<undefined>(path(vote, 'close'), { method: 'POST' }),
    onError: failed,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: openVotesQueryKey(projectId), exact: true }),
  });

  return {
    cast: useCallback(
      (vote: MessageVote, option: number) => {
        castVote({ vote, option });
      },
      [castVote],
    ),
    close: useCallback(
      (vote: MessageVote) => {
        closeVote(vote);
      },
      [closeVote],
    ),
  };
}
