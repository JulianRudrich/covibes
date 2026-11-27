import type {
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspaceProject,
  WorkspaceRole,
  WorkspaceSummary,
} from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { projectsQuery } from '@web/features/projects/queries';
import { api, ApiError } from '@web/lib/api';

export const workspacesQuery = queryOptions({
  queryKey: ['workspaces'],
  queryFn: () => api<WorkspaceSummary[]>('/workspaces'),
});

function path(id: string) {
  return `/workspaces/${encodeURIComponent(id)}`;
}

export function workspaceProjectsQuery(id: string) {
  return queryOptions({
    queryKey: ['workspaces', id, 'projects'],
    queryFn: () => api<WorkspaceProject[]>(`${path(id)}/projects`),
  });
}

export function workspaceMembersQuery(id: string) {
  return queryOptions({
    queryKey: ['workspaces', id, 'members'],
    queryFn: () => api<WorkspaceMember[]>(`${path(id)}/members`),
  });
}

export function workspaceInvitationsQuery(id: string) {
  return queryOptions({
    queryKey: ['workspaces', id, 'invitations'],
    queryFn: () => api<WorkspaceInvitation[]>(`${path(id)}/invitations`),
  });
}

async function refresh(client: QueryClient) {
  await Promise.all([
    client.invalidateQueries({ queryKey: workspacesQuery.queryKey }),
    client.invalidateQueries({ queryKey: projectsQuery.queryKey }),
  ]);
}

export function useCreateWorkspace() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api<{ id: string; name: string }>('/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => refresh(client),
  });
}

export function useWorkspaceActions(id: string) {
  const client = useQueryClient();
  const saved = () => refresh(client);
  const rename = useMutation({
    mutationFn: (name: string) =>
      api<undefined>(path(id), { method: 'PATCH', body: JSON.stringify({ name }) }),
    onSuccess: saved,
  });
  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
      api<undefined>(`${path(id)}/members/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    onSuccess: saved,
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) =>
      api<undefined>(`${path(id)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
    onSuccess: saved,
  });
  const invite = useMutation({
    mutationFn: (input: { email?: string; role: 'viewer' | 'editor' }) =>
      api<{ id: string; token: string }>(`${path(id)}/invitations`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: saved,
  });
  const revoke = useMutation({
    mutationFn: (invitationId: string) =>
      api<undefined>(`${path(id)}/invitations/${encodeURIComponent(invitationId)}`, {
        method: 'DELETE',
      }),
    onSuccess: saved,
  });
  const remove = useMutation({
    mutationFn: () => api<undefined>(path(id), { method: 'DELETE' }),
    onSuccess: saved,
  });
  return { rename, setRole, removeMember, invite, revoke, remove };
}

export function useAcceptWorkspaceInvitation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api<{ workspaceId: string }>(`/workspaces/invitations/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
      }),
    onSuccess: () => refresh(client),
  });
}

export function useProjectLifecycle(projectId: string) {
  const client = useQueryClient();
  const move = useMutation({
    mutationFn: (workspaceId: string) =>
      api<undefined>(`/projects/${encodeURIComponent(projectId)}/workspace`, {
        method: 'POST',
        body: JSON.stringify({ workspaceId }),
      }),
    onSuccess: () => refresh(client),
  });
  const remove = useMutation({
    mutationFn: (confirmName: string) =>
      api<undefined>(`/projects/${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmName }),
      }),
    onSuccess: async () => {
      client.removeQueries({ queryKey: ['projects', projectId] });
      await refresh(client);
    },
  });
  return { move, remove };
}

type WorkspaceConflictKey =
  | 'workspaces.actionConflict'
  | 'workspaces.ownerConflict'
  | 'workspaces.deleteConflict'
  | 'workspaces.project.deleteConflict';

export function workspaceErrorKey(
  error: unknown,
  conflict: WorkspaceConflictKey = 'workspaces.actionConflict',
) {
  if (error instanceof ApiError) {
    if (error.code === 'forbidden') return 'workspaces.forbidden';
    if (error.code === 'not_found') return 'workspaces.unavailable';
    if (error.code === 'conflict') return conflict;
  }
  return 'workspaces.actionFailed';
}
