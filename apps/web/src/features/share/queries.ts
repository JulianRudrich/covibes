import type {
  AcceptInvitationResult,
  CreatedInvitation,
  CreateInvitationInput,
  Invitation,
  InvitationPreview,
  UpdateMemberInput,
} from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import { projectQuery, projectsQuery } from '@web/features/projects/queries';
import { api } from '@web/lib/api';

const invitationsPath = (projectId: string) =>
  `/projects/${encodeURIComponent(projectId)}/invitations`;

/** The open invitations of a project (spec 21a); owners only. */
export function invitationsQuery(projectId: string) {
  return queryOptions({
    queryKey: ['invitations', projectId] as const,
    queryFn: () => api<Invitation[]>(invitationsPath(projectId)),
  });
}

/** Inviting by link or mail, sending a mail again and revoking; the list loads again afterwards. */
export function useInvitationMutations(projectId: string) {
  const queryClient = useQueryClient();
  const reload = () =>
    queryClient.invalidateQueries({ queryKey: invitationsQuery(projectId).queryKey });

  const create = useMutation({
    mutationFn: (input: CreateInvitationInput) =>
      api<CreatedInvitation>(invitationsPath(projectId), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSettled: reload,
  });

  const resend = useMutation({
    mutationFn: (invitationId: string) =>
      api<Invitation>(`${invitationsPath(projectId)}/${encodeURIComponent(invitationId)}/resend`, {
        method: 'POST',
      }),
    onSettled: reload,
  });

  const revoke = useMutation({
    mutationFn: (invitationId: string) =>
      api<undefined>(`${invitationsPath(projectId)}/${encodeURIComponent(invitationId)}`, {
        method: 'DELETE',
      }),
    onSettled: reload,
  });

  return { create, resend, revoke };
}

/**
 * Changing a member's role or Git approval right, removing a member and leaving. The project is
 * loaded again afterwards, as it is for everyone else after the live event.
 */
export function useMemberMutations(projectId: string) {
  const queryClient = useQueryClient();
  const path = (userId: string) =>
    `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`;
  // Only the project: the keys of its messages and runs start with the same parts.
  const reload = () =>
    queryClient.invalidateQueries({ queryKey: projectQuery(projectId).queryKey, exact: true });

  const update = useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: UpdateMemberInput }) =>
      api<undefined>(path(userId), { method: 'PATCH', body: JSON.stringify(input) }),
    onSettled: reload,
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api<undefined>(path(userId), { method: 'DELETE' }),
    onSettled: reload,
  });

  /** Leaving: the project is gone from the list, and nothing of it is loaded again. */
  const leave = useMutation({
    mutationFn: (userId: string) => api<undefined>(path(userId), { method: 'DELETE' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey, exact: true }),
  });

  return { update, remove, leave };
}

/** What an invitation link leads to; the token goes in the body, not into an address. */
export function invitationPreviewQuery(token: string) {
  return queryOptions({
    queryKey: ['invitation', token] as const,
    queryFn: () =>
      api<InvitationPreview>('/invitations/preview', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    retry: false,
    staleTime: 0,
  });
}

export function useAcceptInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api<AcceptInvitationResult>('/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey, exact: true }),
  });
}
