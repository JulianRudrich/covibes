import { z } from 'zod';

/** Same limits as the check constraint on `projects.name` (packages/db/migrations). */
export const PROJECT_NAME_MAX_LENGTH = 120;

export const projectNameSchema = z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH);

/** Project ids are UUIDs; anything else cannot exist and is answered with "not found". */
export const projectIdSchema = z.uuid();

export const PROJECT_ROLES = ['viewer', 'editor', 'owner'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const createProjectInputSchema = z.object({ name: projectNameSchema });
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

/** One entry of `GET /api/projects`. */
export type ProjectSummary = { id: string; name: string; role: ProjectRole; updatedAt: string };

export type ProjectMember = { userId: string; name: string; role: ProjectRole };

/** `GET /api/projects/:projectId`. */
export type ProjectDetails = {
  id: string;
  name: string;
  role: ProjectRole;
  members: ProjectMember[];
};
