import {
  AGENT_KEYS,
  type AgentKey,
  type AgentModel,
  type ProjectAgent,
  type ProjectDetails,
} from '@covibes/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { projectQuery } from '@web/features/projects/queries';
import { api } from '@web/lib/api';

function agentsPath(projectId: string, agentKey?: AgentKey) {
  const base = `/projects/${encodeURIComponent(projectId)}/agents`;
  return agentKey ? `${base}/${agentKey}` : base;
}

/**
 * Adding and removing agents and choosing their model (spec 14). Every change shows at once and
 * is undone if the server refuses; afterwards the project is loaded again, as it is for everyone
 * else after the live event.
 */
export function useTeamMutations(projectId: string, onError: () => void) {
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
  const rollback = (_error: unknown, _input: unknown, context?: { previous?: ProjectDetails }) => {
    if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    onError();
  };
  // Only the project: the keys of its messages and runs start with the same parts.
  const reload = () => queryClient.invalidateQueries({ queryKey, exact: true });

  const add = useMutation({
    mutationFn: (agentKey: AgentKey) =>
      api<undefined>(agentsPath(projectId), {
        method: 'POST',
        body: JSON.stringify({ agentKey }),
      }),
    onMutate: (agentKey) =>
      optimistic((agents) =>
        [...agents.filter((agent) => agent.key !== agentKey), { key: agentKey, model: null }].sort(
          (a, b) => AGENT_KEYS.indexOf(a.key) - AGENT_KEYS.indexOf(b.key),
        ),
      ),
    onError: rollback,
    onSettled: reload,
  });

  const remove = useMutation({
    mutationFn: (agentKey: AgentKey) =>
      api<undefined>(agentsPath(projectId, agentKey), { method: 'DELETE' }),
    onMutate: (agentKey) =>
      optimistic((agents) => agents.filter((agent) => agent.key !== agentKey)),
    onError: rollback,
    onSettled: reload,
  });

  const setModel = useMutation({
    mutationFn: ({ agentKey, model }: { agentKey: AgentKey; model: AgentModel | null }) =>
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
