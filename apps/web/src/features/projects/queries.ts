import type { CreateProjectInput, ProjectDetails, ProjectSummary } from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

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

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      api<ProjectSummary>('/projects', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey }),
  });
}
