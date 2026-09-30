import { z } from 'zod';

/** Same limits as the check constraint on `projects.name` (packages/db/migrations). */
export const PROJECT_NAME_MAX_LENGTH = 120;

export const projectNameSchema = z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH);

/** Project ids are UUIDs; anything else cannot exist and is answered with "not found". */
export const projectIdSchema = z.uuid();

export const PROJECT_ROLES = ['viewer', 'editor', 'owner'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const createProjectInputSchema = z.object({ name: projectNameSchema });

/** `PATCH /api/projects/:projectId` (owners): the settings that exist so far. */
export const updateProjectInputSchema = z.object({ proposalsOnly: z.boolean() });
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;

/** `projects.settings` as stored; unknown keys from later versions are kept. */
export const projectSettingsSchema = z.looseObject({
  proposalsOnly: z.boolean().optional().catch(undefined),
});
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

/** One entry of `GET /api/projects`. */
export type ProjectSummary = { id: string; name: string; role: ProjectRole; updatedAt: string };

export type ProjectMember = { userId: string; name: string; role: ProjectRole };

/** Every project has exactly one `main` board, which cannot be renamed or deleted (spec 11). */
export type ProjectBoard = { id: string; title: string; kind: 'main' | 'extra' };

/** Stricter than the check constraint on `boards.title` (80), so tabs stay readable. */
export const BOARD_TITLE_MAX_LENGTH = 60;

/** Boards per project, the main canvas included. */
export const MAX_BOARDS_PER_PROJECT = 20;

export const boardIdSchema = z.uuid();

export const boardTitleSchema = z.string().trim().min(1).max(BOARD_TITLE_MAX_LENGTH);

/** `POST /api/projects/:projectId/boards`; without a title the board is named "Board N". */
export const createBoardInputSchema = z.object({ title: boardTitleSchema.optional() });
export type CreateBoardInput = z.input<typeof createBoardInputSchema>;

/** `PATCH /api/projects/:projectId/boards/:boardId`. */
export const renameBoardInputSchema = z.object({ title: boardTitleSchema });
export type RenameBoardInput = z.input<typeof renameBoardInputSchema>;

/**
 * The title of a new board without one: "Board N" with the lowest free N from 2 on, since the
 * main canvas counts as the first.
 */
export function nextBoardTitle(titles: readonly string[]): string {
  const taken = new Set(titles.map((title) => title.trim()));
  let number = 2;
  while (taken.has(`Board ${String(number)}`)) number += 1;
  return `Board ${String(number)}`;
}

/** `GET /api/projects/:projectId`. */
export type ProjectDetails = {
  id: string;
  name: string;
  role: ProjectRole;
  members: ProjectMember[];
  /** Ordered by position, the main board first. */
  boards: ProjectBoard[];
  /** Even instructions to agents arrive as proposals first (spec 13). */
  proposalsOnly: boolean;
};
