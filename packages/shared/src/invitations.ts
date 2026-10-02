import { z } from 'zod';

import { PROJECT_ROLES } from './projects';

// Invitations and members (spec 21a): owners invite people by link or by email with a role, and
// manage who is in the project.

/** What an invitation makes someone; an owner is made in the member list. */
export const INVITATION_ROLES = ['editor', 'viewer'] as const;
export type InvitationRole = (typeof INVITATION_ROLES)[number];

/** A link for several people, or a mail to one address that works once. */
export const INVITATION_KINDS = ['link', 'email'] as const;
export type InvitationKind = (typeof INVITATION_KINDS)[number];

/** How long an invitation works; the same as the default of `invitations.expires_at`. */
export const INVITATION_DAYS = 7;
export const MAX_OPEN_INVITATIONS = 20;
/** The same limit as in the database function `accept_invitation`. */
export const MAX_PROJECT_MEMBERS = 50;

/** The secret of an invitation link: 32 random bytes as base64url. */
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const invitationEmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** `POST /api/projects/:projectId/invitations`. */
export const createInvitationInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('link'), role: z.enum(INVITATION_ROLES) }),
  z.object({
    kind: z.literal('email'),
    role: z.enum(INVITATION_ROLES),
    email: invitationEmailSchema,
  }),
]);
export type CreateInvitationInput = z.input<typeof createInvitationInputSchema>;

/** An open invitation as owners see it; never its link. */
export const invitationSchema = z.object({
  id: z.uuid(),
  kind: z.enum(INVITATION_KINDS),
  role: z.enum(INVITATION_ROLES),
  /** The address of an invitation by mail. */
  email: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  /** How many people joined through it. */
  uses: z.number().int().min(0),
});
export type Invitation = z.infer<typeof invitationSchema>;

/** A new invitation: `url` is the link of a link invitation, shown this once. */
export type CreatedInvitation = { invitation: Invitation; url: string | null };

/** `POST /api/invitations/preview` and `…/accept`: the token from the link. */
export const invitationTokenInputSchema = z.object({ token: invitationTokenSchema });

/**
 * What an invitation link leads to: `open` to join, `member` for someone who is in the project
 * already, or why it no longer works.
 */
export const INVITATION_STATUSES = ['open', 'member', 'expired', 'revoked', 'used'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** The project and who invites are only told while the invitation works. */
export const invitationPreviewSchema = z.object({
  status: z.enum(INVITATION_STATUSES),
  /** Only for a member, to go to the project. */
  projectId: z.uuid().nullable(),
  projectName: z.string().nullable(),
  role: z.enum(INVITATION_ROLES).nullable(),
  invitedBy: z.string().nullable(),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

/** `joined` and `member` come with the project; `full` means it has all the members it can take. */
export const ACCEPT_STATUSES = ['joined', 'member', 'full', 'expired', 'revoked', 'used'] as const;
export const acceptInvitationResultSchema = z.object({
  status: z.enum(ACCEPT_STATUSES),
  projectId: z.uuid().nullable(),
});
export type AcceptInvitationResult = z.infer<typeof acceptInvitationResultSchema>;

/** `PATCH /api/projects/:projectId/members/:userId` (owners): at least one of the two. */
export const updateMemberInputSchema = z
  .object({
    role: z.enum(PROJECT_ROLES).optional(),
    /** The right to approve Git actions, for editors; owners always have it. */
    canApproveGit: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'Nothing to change');
export type UpdateMemberInput = z.infer<typeof updateMemberInputSchema>;
