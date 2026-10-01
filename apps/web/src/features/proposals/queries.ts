import type { AgentKey, Proposal } from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import { proposalSummary } from '@web/features/proposals/summary';
import { api, ApiError } from '@web/lib/api';

export function proposalsQueryKey(projectId: string) {
  return ['projects', projectId, 'proposals'] as const;
}

/** Decided proposals of this session, for the lines under "Wartet auf dich"; never loaded. */
export function decidedQueryKey(projectId: string) {
  return ['projects', projectId, 'proposals', 'decided'] as const;
}

/**
 * `name` is what a canvas proposal is about or the decision that was confirmed (spec 16a); a team
 * proposal (spec 14) names its agents.
 */
export type DecidedProposal = {
  id: string;
  name: string;
  agents?: AgentKey[];
  /** A decision is confirmed instead of applied. */
  decision?: boolean;
  status: 'applied' | 'rejected';
};

/**
 * The open proposals of a project (spec 13). The live channel reloads them when an agent proposes
 * something or someone decides, so they never go stale on their own.
 */
export function proposalsQuery(projectId: string) {
  return queryOptions({
    queryKey: proposalsQueryKey(projectId),
    queryFn: () => api<Proposal[]>(`/projects/${encodeURIComponent(projectId)}/proposals`),
    staleTime: Infinity,
  });
}

export type Decision = 'apply' | 'reject';

/** Why a decision failed, for the note over the canvas. */
export type DecisionFailure =
  { reason: 'being_edited'; name: string } | { reason: 'already_decided' } | { reason: 'failed' };

function failureOf(error: unknown): DecisionFailure {
  if (error instanceof ApiError && error.code === 'being_edited') {
    return { reason: 'being_edited', name: error.detail ?? '' };
  }
  if (error instanceof ApiError && error.code === 'already_decided') {
    return { reason: 'already_decided' };
  }
  return { reason: 'failed' };
}

/**
 * Applying and rejecting proposals, on the canvas and in the overview alike. The proposal
 * disappears at once and comes back if the server refuses; then `onFailure` explains why.
 */
export function useProposalDecisions(
  projectId: string,
  onFailure: (failure: DecisionFailure) => void,
) {
  const queryClient = useQueryClient();
  const queryKey = proposalsQueryKey(projectId);

  const mutation = useMutation({
    mutationFn: ({ proposal, decision }: { proposal: Proposal; decision: Decision }) =>
      api<unknown>(
        `/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(proposal.id)}/${decision}`,
        { method: 'POST' },
      ),
    onMutate: async ({ proposal }) => {
      await queryClient.cancelQueries({ queryKey, exact: true });
      const previous = queryClient.getQueryData<Proposal[]>(queryKey);
      queryClient.setQueryData<Proposal[]>(queryKey, (open) =>
        open?.filter((entry) => entry.id !== proposal.id),
      );
      return { previous };
    },
    onSuccess: (_result, { proposal, decision }) => {
      queryClient.setQueryData<DecidedProposal[]>(decidedQueryKey(projectId), (decided = []) => [
        ...decided,
        {
          id: proposal.id,
          ...(proposal.kind === 'team'
            ? { name: '', agents: proposal.operations.map((operation) => operation.agentKey) }
            : proposal.kind === 'decision'
              ? {
                  name: proposal.operations
                    .map((operation) => `${operation.topic}: ${operation.value}`)
                    .join(', '),
                  decision: true,
                }
              : { name: proposalSummary(proposal).name }),
          status: decision === 'apply' ? 'applied' : 'rejected',
        },
      ]);
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      onFailure(failureOf(error));
    },
    // Only the proposals: the keys of messages and runs start with the project's too.
    onSettled: () => queryClient.invalidateQueries({ queryKey, exact: true }),
  });

  return {
    decide: (proposal: Proposal, decision: Decision) => {
      mutation.mutate({ proposal, decision });
    },
  };
}
