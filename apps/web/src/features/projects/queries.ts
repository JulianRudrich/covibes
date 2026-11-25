import type {
  CreateProjectInput,
  Phase,
  ProjectBoard,
  ProjectDetails,
  ProjectSummary,
  UpdateProjectInput,
} from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { api } from '@web/lib/api';

export const projectsQuery = queryOptions({
  queryKey: ['projects'],
  queryFn: () => api<ProjectSummary[]>('/projects'),
});

export function projectQuery(projectId: string) {
  return queryOptions({
    queryKey: ['projects', projectId],
    queryFn: () => api<ProjectDetails>(`/projects/${encodeURIComponent(projectId)}`),
  });
}

export function useCreateProject(workspaceId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      api<{ id: string }>(
        workspaceId ? `/workspaces/${encodeURIComponent(workspaceId)}/projects` : '/projects',
        { method: 'POST', body: JSON.stringify(input) },
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
      ]),
  });
}

function boardsPath(projectId: string, boardId?: string) {
  const base = `/projects/${encodeURIComponent(projectId)}/boards`;
  return boardId ? `${base}/${encodeURIComponent(boardId)}` : base;
}

/** Changes the boards in the cached project details. */
function updateBoards(
  queryClient: QueryClient,
  projectId: string,
  update: (boards: ProjectBoard[]) => ProjectBoard[],
) {
  queryClient.setQueryData(projectQuery(projectId).queryKey, (project) =>
    project ? { ...project, boards: update(project.boards) } : project,
  );
}

/**
 * Creating, renaming and deleting boards (spec 11). Renaming and deleting show at once and are
 * undone if the server refuses; a new board is added once the server created it. Afterwards the
 * boards are loaded again, as they are for everyone else after the live event.
 */
export function useBoardMutations(projectId: string) {
  const queryClient = useQueryClient();
  const { queryKey } = projectQuery(projectId);

  async function optimistic(update: (boards: ProjectBoard[]) => ProjectBoard[]) {
    await queryClient.cancelQueries({ queryKey, exact: true });
    const previous = queryClient.getQueryData(queryKey);
    updateBoards(queryClient, projectId, update);
    return { previous };
  }
  const rollback = (_error: unknown, _input: unknown, context?: { previous?: ProjectDetails }) => {
    if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
  };
  // Only the project: the keys of its messages and runs start with the same parts.
  const reload = () => queryClient.invalidateQueries({ queryKey, exact: true });

  const create = useMutation({
    mutationFn: () => api<ProjectBoard>(boardsPath(projectId), { method: 'POST', body: '{}' }),
    onSuccess: (board) => {
      updateBoards(queryClient, projectId, (boards) => [
        ...boards.filter((entry) => entry.id !== board.id),
        board,
      ]);
    },
    onSettled: reload,
  });

  const rename = useMutation({
    mutationFn: ({ boardId, title }: { boardId: string; title: string }) =>
      api<ProjectBoard>(boardsPath(projectId, boardId), {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      }),
    onMutate: ({ boardId, title }) =>
      optimistic((boards) =>
        boards.map((board) => (board.id === boardId ? { ...board, title } : board)),
      ),
    onError: rollback,
    onSettled: reload,
  });

  const remove = useMutation({
    mutationFn: (boardId: string) =>
      api<undefined>(boardsPath(projectId, boardId), { method: 'DELETE' }),
    onMutate: (boardId) => optimistic((boards) => boards.filter((board) => board.id !== boardId)),
    onError: rollback,
    onSettled: reload,
  });

  return { create, rename, remove };
}

/** The owner switches the proposals-only mode (spec 13); shown at once, undone if refused. */
export function useUpdateProject(projectId: string) {
  const queryClient = useQueryClient();
  const { queryKey } = projectQuery(projectId);
  return useMutation({
    mutationFn: (input: UpdateProjectInput) =>
      api<undefined>(`/projects/${encodeURIComponent(projectId)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey, exact: true });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (project) => project && { ...project, ...input });
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey, exact: true }),
  });
}

/**
 * Jumps to another phase (spec 24): shown at once, taken back if the server refuses. Everyone
 * else learns of it through the live channel.
 */
export function useSetPhase(projectId: string) {
  const queryClient = useQueryClient();
  const { queryKey } = projectQuery(projectId);
  return useMutation({
    mutationFn: (phase: Phase) =>
      api<undefined>(`/projects/${encodeURIComponent(projectId)}/phase`, {
        method: 'PUT',
        body: JSON.stringify({ phase }),
      }),
    onMutate: async (phase) => {
      await queryClient.cancelQueries({ queryKey, exact: true });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (project) => project && { ...project, phase });
      return { previous };
    },
    onError: (_error, _phase, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey, exact: true }),
  });
}
