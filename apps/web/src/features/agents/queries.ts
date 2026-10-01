import type {
  AddKnowledgeLinkInput,
  AgentKnowledgeItem,
  CreateCustomAgentInput,
  CustomAgent,
  UpdateCustomAgentInput,
} from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import { projectQuery } from '@web/features/projects/queries';
import { api } from '@web/lib/api';

/** React Query key of the custom agents a user can use in a project. */
export function customAgentsQueryKey(projectId: string) {
  return ['agents', projectId] as const;
}

/**
 * The custom agents the user can use in the project (spec 19): their personal agents and the
 * agents shared in the project, with instructions. The live channel reloads them with the project.
 */
export function customAgentsQuery(projectId: string) {
  return queryOptions({
    queryKey: customAgentsQueryKey(projectId),
    queryFn: () => api<CustomAgent[]>(`/agents?projectId=${encodeURIComponent(projectId)}`),
  });
}

/**
 * Creating, changing and deleting custom agents. Afterwards the list and the project (its team and
 * its directory of agents) are loaded again, as they are for everyone else after the live event.
 */
export function useCustomAgentMutations(projectId: string) {
  const queryClient = useQueryClient();
  const reload = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: customAgentsQueryKey(projectId), exact: true }),
      // Only the project: the keys of its messages and runs start with the same parts.
      queryClient.invalidateQueries({ queryKey: projectQuery(projectId).queryKey, exact: true }),
    ]);

  const create = useMutation({
    mutationFn: (input: CreateCustomAgentInput) =>
      api<CustomAgent>('/agents', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: reload,
  });

  const update = useMutation({
    mutationFn: ({ key, input }: { key: string; input: UpdateCustomAgentInput }) =>
      api<CustomAgent>(`/agents/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: reload,
  });

  const remove = useMutation({
    mutationFn: (key: string) =>
      api<undefined>(`/agents/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    onSuccess: reload,
  });

  return { create, update, remove };
}

/** The path of an agent's knowledge below `/api`. */
function knowledgePath(agentKey: string): string {
  return `/agents/${encodeURIComponent(agentKey)}/knowledge`;
}

/** The address a file of an agent's knowledge is downloaded from. */
export function knowledgeFileUrl(agentKey: string, itemId: string): string {
  return `/api${knowledgePath(agentKey)}/${encodeURIComponent(itemId)}/content`;
}

/** The knowledge of a custom agent (spec 20b): its files and links, oldest first. */
export function agentKnowledgeQuery(agentKey: string) {
  return queryOptions({
    queryKey: ['agent-knowledge', agentKey] as const,
    queryFn: () => api<AgentKnowledgeItem[]>(knowledgePath(agentKey)),
  });
}

/** Adding a file or a link to an agent's knowledge and removing an entry; each applies at once. */
export function useAgentKnowledgeMutations(agentKey: string) {
  const queryClient = useQueryClient();
  const reload = () =>
    queryClient.invalidateQueries({ queryKey: agentKnowledgeQuery(agentKey).queryKey });

  const addFile = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.set('file', file);
      return api<AgentKnowledgeItem>(`${knowledgePath(agentKey)}/files`, {
        method: 'POST',
        body: form,
      });
    },
    onSettled: reload,
  });

  const addLink = useMutation({
    mutationFn: (input: AddKnowledgeLinkInput) =>
      api<AgentKnowledgeItem>(`${knowledgePath(agentKey)}/links`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSettled: reload,
  });

  const remove = useMutation({
    mutationFn: (itemId: string) =>
      api<undefined>(`${knowledgePath(agentKey)}/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
      }),
    onSettled: reload,
  });

  return { addFile, addLink, remove };
}
