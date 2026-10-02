import type {
  AcceptInvitationResult,
  CreatedInvitation,
  CreatedShareLink,
  CreateInvitationInput,
  Invitation,
  InvitationPreview,
  SharedBoard,
  SharedProject,
  ShareLinkStatus,
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

const shareLinkPath = (projectId: string) =>
  `/projects/${encodeURIComponent(projectId)}/share-link`;

/** Whether the project has a read-only link (spec 21b); every member may know. */
export function shareLinkQuery(projectId: string) {
  return queryOptions({
    queryKey: ['share-link', projectId] as const,
    queryFn: () => api<ShareLinkStatus>(shareLinkPath(projectId)),
  });
}

/** Creating (or replacing) and removing the read-only link; owners only. */
export function useShareLinkMutations(projectId: string) {
  const queryClient = useQueryClient();
  const reload = () =>
    queryClient.invalidateQueries({ queryKey: shareLinkQuery(projectId).queryKey });

  const create = useMutation({
    mutationFn: () => api<CreatedShareLink>(shareLinkPath(projectId), { method: 'POST' }),
    onSettled: reload,
  });

  const remove = useMutation({
    mutationFn: () => api<undefined>(shareLinkPath(projectId), { method: 'DELETE' }),
    onSettled: reload,
  });

  return { create, remove };
}

/** How often the read-only view loads again: it is a current picture, not a live session. */
const SHARED_VIEW_REFRESH_MS = 30_000;

/** What a read-only link shows besides the boards: name, boards, decisions and criteria. */
export function sharedProjectQuery(token: string) {
  return queryOptions({
    queryKey: ['shared', token] as const,
    queryFn: () =>
      api<SharedProject>('/share/view', { method: 'POST', body: JSON.stringify({ token }) }),
    retry: false,
    refetchInterval: SHARED_VIEW_REFRESH_MS,
  });
}

/** The content of one board of a read-only link. */
export function sharedBoardQuery(token: string, boardId: string) {
  return queryOptions({
    queryKey: ['shared', token, 'board', boardId] as const,
    queryFn: () =>
      api<SharedBoard>('/share/board', {
        method: 'POST',
        body: JSON.stringify({ token, boardId }),
      }),
    retry: false,
    refetchInterval: SHARED_VIEW_REFRESH_MS,
  });
}
