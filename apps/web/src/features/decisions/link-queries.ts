import type { DecisionLink, DecisionLinkCandidate, DecisionLinkInput } from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@web/lib/api';

export const decisionLinksQueryKey = (projectId: string) =>
  ['projects', projectId, 'decision-links'] as const;
const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/decision-links`;
export function decisionLinksQuery(projectId: string) {
  return queryOptions({
    queryKey: decisionLinksQueryKey(projectId),
    queryFn: () => api<DecisionLink[]>(base(projectId)),
    staleTime: 30_000,
  });
}
export function decisionLinkTargetsQuery(projectId: string, query: string) {
  return queryOptions({
    queryKey: [...decisionLinksQueryKey(projectId), 'targets', query],
    queryFn: () =>
      api<{ targets: DecisionLinkCandidate[]; more: boolean }>(
        `${base(projectId)}/targets?q=${encodeURIComponent(query)}`,
      ),
  });
}
export function useDecisionLinkActions(projectId: string) {
  const client = useQueryClient();
  const reload = () =>
    client.invalidateQueries({ queryKey: decisionLinksQueryKey(projectId), exact: true });
  const add = useMutation({
    mutationFn: (input: DecisionLinkInput) =>
      api<{ id: string }>(base(projectId), { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: reload,
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api<undefined>(`${base(projectId)}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: reload,
  });
  return { add, remove };
}
