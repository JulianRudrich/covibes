import type { PlanState, PlanVersion, PlanVersionContent } from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@web/lib/api';

export function planStateQueryKey(projectId: string) {
  return ['projects', projectId, 'plan'] as const;
}

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/plan`;

/**
 * What waits around the plan of a project (spec 25b): the moderator's open suggestions, whether a
 * generation runs and whether the last one failed. The live channel reloads it whenever any of
 * that changes, so it never goes stale on its own.
 */
export function planStateQuery(projectId: string) {
  return queryOptions({
    queryKey: planStateQueryKey(projectId),
    queryFn: () => api<PlanState>(base(projectId)),
    staleTime: Infinity,
  });
}

/** The versions of the plan (spec 25c), newest first; loaded whenever the dialog opens. */
export function planVersionsQuery(projectId: string) {
  return queryOptions({
    queryKey: [...planStateQueryKey(projectId), 'versions'] as const,
    queryFn: () => api<PlanVersion[]>(`${base(projectId)}/versions`),
  });
}

/** One version with the plan as it stood; a version never changes. */
export function planVersionQuery(projectId: string, versionId: string) {
  return queryOptions({
    queryKey: [...planStateQueryKey(projectId), 'versions', versionId] as const,
    queryFn: () =>
      api<PlanVersionContent>(`${base(projectId)}/versions/${encodeURIComponent(versionId)}`),
    staleTime: Infinity,
  });
}

export type PlanDecision =
  | { suggestionId: string; decision: 'accept' | 'reject' }
  | { suggestionId: null; decision: 'accept' };

/**
 * Starting a generation and deciding suggestions. Both show at once: the plan says that the
 * moderator writes, and a decided suggestion leaves the list. The server's state follows through
 * the live channel; after a failure it is loaded again, which brings back what was hidden.
 */
export function usePlanActions(projectId: string, onFailed: () => void) {
  const queryClient = useQueryClient();
  const queryKey = planStateQueryKey(projectId);
  const reload = () => queryClient.invalidateQueries({ queryKey, exact: true });
  const change = async (update: (state: PlanState) => PlanState) => {
    await queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData<PlanState>(queryKey, (state) => state && update(state));
  };

  // "Plan erzeugen" writes all sections; "Aktualisieren" only what a change affects (spec 25c).
  const start = useMutation({
    mutationFn: (kind: 'generate' | 'update') =>
      api<undefined>(`${base(projectId)}/${kind}`, { method: 'POST' }),
    onMutate: () =>
      change((state) => ({ ...state, generating: true, failure: null, upToDate: false })),
    onError: () => {
      onFailed();
      return reload();
    },
  });

  const decide = useMutation({
    mutationFn: ({ suggestionId, decision }: PlanDecision) =>
      api<undefined>(
        suggestionId === null
          ? `${base(projectId)}/suggestions/accept`
          : `${base(projectId)}/suggestions/${encodeURIComponent(suggestionId)}/${decision}`,
        { method: 'POST' },
      ),
    onMutate: ({ suggestionId }) =>
      change((state) => ({
        ...state,
        suggestions:
          suggestionId === null
            ? []
            : state.suggestions.filter((suggestion) => suggestion.id !== suggestionId),
      })),
    onError: () => {
      onFailed();
      return reload();
    },
  });

  return {
    generate: () => {
      start.mutate('generate');
    },
    update: () => {
      start.mutate('update');
    },
    decide: (decision: PlanDecision) => {
      decide.mutate(decision);
    },
  };
}
