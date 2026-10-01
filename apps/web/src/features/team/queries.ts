import {
  AGENT_KEYS,
  isAgentKey,
  type AgentModel,
  type ProjectAgent,
  type ProjectDetails,
} from '@covibes/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { projectQuery } from '@web/features/projects/queries';
import { api, ApiError } from '@web/lib/api';

function teamPosition(key: string): number {
  return isAgentKey(key) ? AGENT_KEYS.indexOf(key) : AGENT_KEYS.length;
}

function agentsPath(projectId: string, agentKey?: string) {
  const base = `/projects/${encodeURIComponent(projectId)}/agents`;
  return agentKey ? `${base}/${agentKey}` : base;
}

/**
 * Adding and removing agents and choosing their model (spec 14). Every change shows at once and
 * is undone if the server refuses; afterwards the project is loaded again, as it is for everyone
 * else after the live event.
 */
export function useTeamMutations(
  projectId: string,
  /** `name_taken`: the team already has an agent that answers to the new agent's name. */
  onError: (reason: 'name_taken' | 'failed') => void,
) {
  const queryClient = useQueryClient();
  const { queryKey } = projectQuery(projectId);

  async function optimistic(update: (agents: ProjectAgent[]) => ProjectAgent[]) {
    await queryClient.cancelQueries({ queryKey, exact: true });
    const previous = queryClient.getQueryData(queryKey);
    queryClient.setQueryData(queryKey, (project) =>
      project ? { ...project, agents: update(project.agents) } : project,
    );
    return { previous };
  }
  const rollback = (error: unknown, _input: unknown, context?: { previous?: ProjectDetails }) => {
    if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    onError(error instanceof ApiError && error.code === 'name_taken' ? 'name_taken' : 'failed');
  };
  // Only the project: the keys of its messages and runs start with the same parts.
  const reload = () => queryClient.invalidateQueries({ queryKey, exact: true });

  const add = useMutation({
    mutationFn: (agentKey: string) =>
      api<undefined>(agentsPath(projectId), {
        method: 'POST',
        body: JSON.stringify({ agentKey }),
      }),
    onMutate: (agentKey) =>
      optimistic((agents) =>
        // Catalog agents in catalog order; custom agents after them, until the server sorts.
        [...agents.filter((agent) => agent.key !== agentKey), { key: agentKey, model: null }].sort(
          (a, b) => teamPosition(a.key) - teamPosition(b.key),
        ),
      ),
    onError: rollback,
    onSettled: reload,
  });

  const remove = useMutation({
    mutationFn: (agentKey: string) =>
      api<undefined>(agentsPath(projectId, agentKey), { method: 'DELETE' }),
    onMutate: (agentKey) =>
      optimistic((agents) => agents.filter((agent) => agent.key !== agentKey)),
    onError: rollback,
    onSettled: reload,
  });

  const setModel = useMutation({
    mutationFn: ({ agentKey, model }: { agentKey: string; model: AgentModel | null }) =>
      api<undefined>(agentsPath(projectId, agentKey), {
        method: 'PATCH',
        body: JSON.stringify({ model }),
      }),
    onMutate: ({ agentKey, model }) =>
      optimistic((agents) =>
        agents.map((agent) => (agent.key === agentKey ? { ...agent, model } : agent)),
      ),
    onError: rollback,
    onSettled: reload,
  });

  return { add, remove, setModel };
}
