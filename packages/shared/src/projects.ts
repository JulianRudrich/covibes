import { z } from 'zod';

import { agentKeySchema, type CustomAgentSummary } from './agents/custom';
import { AGENT_MODELS, type AgentModel } from './agents/keys';

/** Same limits as the check constraint on `projects.name` (packages/db/migrations). */
export const PROJECT_NAME_MAX_LENGTH = 120;

export const projectNameSchema = z.string().trim().min(1).max(PROJECT_NAME_MAX_LENGTH);

/** Project ids are UUIDs; anything else cannot exist and is answered with "not found". */
export const projectIdSchema = z.uuid();

export const PROJECT_ROLES = ['viewer', 'editor', 'owner'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const createProjectInputSchema = z.object({ name: projectNameSchema });

/** `PATCH /api/projects/:projectId` (owners): the settings that exist so far. */
/**
 * The moderator's stance (spec 16b): neutral by the team's criteria (default), with its own
 * opinion, or strictly neutral without any recommendation.
 */
export const MODERATOR_STANCES = ['criteria', 'opinion', 'strict'] as const;
export type ModeratorStance = (typeof MODERATOR_STANCES)[number];

/**
 * How a project decides (spec 16b): by consensus that someone confirms (default), by vote, by its
 * owner, or informally in the chat.
 */
export const DECISION_PROCESSES = ['consensus', 'vote', 'owner', 'informal'] as const;
export type DecisionProcess = (typeof DECISION_PROCESSES)[number];

/** `PATCH /api/projects/:projectId`: owners change the settings that are given. */
export const updateProjectInputSchema = z
  .object({
    proposalsOnly: z.boolean().optional(),
    observer: z.boolean().optional(),
    webAccess: z.boolean().optional(),
    stance: z.enum(MODERATOR_STANCES).optional(),
    decisionProcess: z.enum(DECISION_PROCESSES).optional(),
  })
  // At least one setting: keys that are not given are not part of the parsed input.
  .refine((input) => Object.keys(input).length > 0);
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;

/** `projects.settings` as stored; unknown keys from later versions are kept. */
export const projectSettingsSchema = z.looseObject({
  proposalsOnly: z.boolean().optional().catch(undefined),
  /** Agents speak up on their own (spec 15); on unless switched off. */
  observer: z.boolean().optional().catch(undefined),
  /** Agents search the web and read links (spec 20b); on unless switched off. */
  webAccess: z.boolean().optional().catch(undefined),
  stance: z.enum(MODERATOR_STANCES).optional().catch(undefined),
  decisionProcess: z.enum(DECISION_PROCESSES).optional().catch(undefined),
  /** The moderator asked for the project criteria (spec 16a) and does not ask again. */
  criteriaAsked: z.boolean().optional().catch(undefined),
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

/**
 * An agent of the project's team (spec 14): a catalog agent or a custom agent (spec 19). `model`
 * null is the agent's own default.
 */
export type ProjectAgent = { key: string; model: AgentModel | null };

/**
 * `POST /api/projects/:projectId/agents`: owners and editors add a catalog agent, or a custom
 * agent they may use.
 */
export const addProjectAgentInputSchema = z.object({ agentKey: agentKeySchema });
export type AddProjectAgentInput = z.infer<typeof addProjectAgentInputSchema>;

/** `PATCH /api/projects/:projectId/agents/:agentKey`: owners choose the model; null resets it. */
export const updateProjectAgentInputSchema = z.object({ model: z.enum(AGENT_MODELS).nullable() });
export type UpdateProjectAgentInput = z.infer<typeof updateProjectAgentInputSchema>;

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
  /** The observer lets agents offer help and raise hands (spec 15). */
  observer: boolean;
  /** Agents may search the web and read links (spec 20b). */
  webAccess: boolean;
  /** The moderator's stance and how the project decides (spec 16b). */
  stance: ModeratorStance;
  decisionProcess: DecisionProcess;
  /** The project's team: catalog agents in catalog order, then custom agents by name. */
  agents: ProjectAgent[];
  /** The custom agents the project refers to: its team, its shared agents, earlier authors. */
  customAgents: CustomAgentSummary[];
};
