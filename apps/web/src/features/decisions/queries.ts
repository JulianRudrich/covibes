import type { Criterion, Decision, DecisionLogEntry } from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

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

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;

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
