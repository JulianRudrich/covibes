import { z } from 'zod';

import { PROJECT_ROLES, projectNameSchema } from './projects';
import { languageSchema } from './language';

export const workspaceIdSchema = z.uuid();
export const workspaceNameSchema = z.string().trim().min(1).max(100);
export const createWorkspaceInputSchema = z.object({ name: workspaceNameSchema });
export const workspaceMemberInputSchema = z.object({ role: z.enum(PROJECT_ROLES) });
export const workspaceInvitationInputSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase())
    .optional(),
  role: z.enum(['viewer', 'editor']).default('editor'),
});
export const workspaceInvitationTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const workspaceProjectInputSchema = z.object({
  name: projectNameSchema,
  language: languageSchema.optional(),
});
export const moveProjectInputSchema = z.object({ workspaceId: workspaceIdSchema });

export type WorkspaceRole = (typeof PROJECT_ROLES)[number];
export type WorkspaceSummary = {
  id: string;
  name: string;
  kind: 'personal' | 'team';
  role: WorkspaceRole;
  /** Only projects the person can open are counted. */
  projectCount: number;
  memberCount: number;
  createdAt: string;
};
export type WorkspaceMember = { userId: string; name: string; role: WorkspaceRole };
export type WorkspaceProject = {
  id: string;
  name: string;
  workspaceId: string;
  role: WorkspaceRole;
  updatedAt: string;
};
export type WorkspaceInvitation = {
  id: string;
  workspaceId: string;
  email: string | null;
  role: 'viewer' | 'editor';
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};

export const AI_PROVIDERS = ['anthropic', 'openai'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export type WorkspaceAiSettings = {
  configured: AiProvider[];
  canStoreKeys: boolean;
  month: string;
  spending: { instanceUsd: number; workspaceUsd: number };
};
