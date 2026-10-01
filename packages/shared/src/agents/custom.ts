import { z } from 'zod';

import { AGENT_KEYS, AGENT_MENTION_NAMES, AGENT_MODELS, isAgentKey } from './keys';
import type { MentionNames } from './mentions';

// Custom agents (spec 19): people create their own agents, personal or shared in a project. In a
// team they are referred to like catalog agents; their key is their id.

/** Same limits as the check constraints on `custom_agents` (packages/db/migrations). */
export const CUSTOM_AGENT_NAME_MIN_LENGTH = 2;
export const CUSTOM_AGENT_NAME_MAX_LENGTH = 24;
export const CUSTOM_AGENT_ROLE_MAX_LENGTH = 120;
export const CUSTOM_AGENT_INSTRUCTIONS_MAX_LENGTH = 4000;

/** The six custom colors by number (`--color-agent-custom-N` in theme.css). */
export const CUSTOM_AGENT_COLORS = [1, 2, 3, 4, 5, 6] as const;
export type CustomAgentColor = (typeof CUSTOM_AGENT_COLORS)[number];

/** Personal agents per person, and shared agents per project. */
export const MAX_PERSONAL_AGENTS = 20;
export const MAX_SHARED_AGENTS = 20;

/** Lowercase ids as PostgreSQL prints them; a catalog key never looks like one. */
const CUSTOM_AGENT_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCustomAgentKey(value: unknown): value is string {
  return typeof value === 'string' && CUSTOM_AGENT_KEY.test(value);
}

/**
 * The key of any agent: a catalog key or the id of a custom agent. Wherever an agent is referred
 * to (team, messages, runs, proposals, raised hands, debates, canvas authors), it is this.
 */
export const agentKeySchema = z.union([z.enum(AGENT_KEYS), z.string().regex(CUSTOM_AGENT_KEY)]);

/** Words of letters, digits and `_`, separated by single spaces or hyphens. */
const NAME = /^[\p{L}\p{N}_]+(?:[ -][\p{L}\p{N}_]+)*$/u;

/** How a custom agent is mentioned: its name with hyphens for spaces, e.g. `UX-Writer`. */
export function mentionHandle(name: string): string {
  return name.trim().replace(/ /g, '-');
}

/**
 * Two letters for the avatar of a custom agent: the initials of its first two words, or the first
 * two letters of a single word. Catalog agents show one letter, so the two kinds are told apart.
 */
export function agentInitials(name: string): string {
  const words = name.split(/[ -]/).filter((word) => word !== '');
  const [first = '', second] = words;
  // Whole characters, not UTF-16 units: a name may start with a letter outside the basic plane.
  const letters =
    second === undefined
      ? Array.from(first).slice(0, 2)
      : [Array.from(first)[0] ?? '', Array.from(second)[0] ?? ''];
  return letters.join('').toUpperCase();
}

const CATALOG_NAMES: ReadonlySet<string> = new Set(Object.values(AGENT_MENTION_NAMES).flat());

/** Whether a catalog agent answers to this name already, e.g. "Backend" or "UX". */
export function isCatalogAgentName(name: string): boolean {
  return CATALOG_NAMES.has(mentionHandle(name).toLowerCase());
}

export const customAgentNameSchema = z
  .string()
  .trim()
  .min(CUSTOM_AGENT_NAME_MIN_LENGTH)
  .max(CUSTOM_AGENT_NAME_MAX_LENGTH)
  .regex(NAME)
  .refine((name) => !isCatalogAgentName(name), 'A catalog agent answers to this name');

const noNul = (text: string) => !text.includes('\u0000');

const customAgentFields = {
  name: customAgentNameSchema,
  /** What the agent does, in one line. */
  role: z.string().trim().min(1).max(CUSTOM_AGENT_ROLE_MAX_LENGTH).refine(noNul),
  instructions: z.string().trim().max(CUSTOM_AGENT_INSTRUCTIONS_MAX_LENGTH).refine(noNul),
  /** With it the agent has the canvas tools; without it it only talks. */
  canDraw: z.boolean(),
  /** Null is the default model of all agents. */
  model: z.enum(AGENT_MODELS).nullable(),
  color: z.literal([...CUSTOM_AGENT_COLORS]),
  /** The project the agent is shared in; null for a personal agent. */
  projectId: z.uuid().nullable(),
};

/** `POST /api/agents`. */
export const createCustomAgentInputSchema = z.object({
  ...customAgentFields,
  instructions: customAgentFields.instructions.default(''),
  canDraw: customAgentFields.canDraw.default(true),
  model: customAgentFields.model.default(null),
  projectId: customAgentFields.projectId.default(null),
  /** The catalog specialist the agent was created from, if any. */
  template: z.enum(AGENT_KEYS).exclude(['moderator']).nullable().default(null),
});
export type CreateCustomAgentInput = z.input<typeof createCustomAgentInputSchema>;

/** `PATCH /api/agents/:agentId`: at least one field. */
export const updateCustomAgentInputSchema = z
  .object(customAgentFields)
  .partial()
  .refine((input) => Object.keys(input).length > 0, 'Nothing to change');
export type UpdateCustomAgentInput = z.input<typeof updateCustomAgentInputSchema>;

export const CUSTOM_AGENT_SCOPES = ['personal', 'project'] as const;
export type CustomAgentScope = (typeof CUSTOM_AGENT_SCOPES)[number];

/**
 * What the members of a project know about a custom agent the project refers to (its directory):
 * enough to show and mention it, never its instructions.
 */
export const customAgentSummarySchema = z.object({
  key: z.uuid(),
  name: z.string(),
  role: z.string(),
  color: z.number().int().min(1).max(CUSTOM_AGENT_COLORS.length),
  model: z.enum(AGENT_MODELS).nullable(),
  canDraw: z.boolean(),
  scope: z.enum(CUSTOM_AGENT_SCOPES),
  ownerId: z.uuid(),
  ownerName: z.string(),
  /** Deleted agents stay in the directory, so their messages keep their name. */
  deleted: z.boolean(),
});
export type CustomAgentSummary = z.infer<typeof customAgentSummarySchema>;

/** A custom agent as those see it who may use or edit it (`GET /api/agents`). */
export const customAgentSchema = customAgentSummarySchema.extend({
  instructions: z.string(),
  projectId: z.uuid().nullable(),
  template: z.enum(AGENT_KEYS).nullable(),
});
export type CustomAgent = z.infer<typeof customAgentSchema>;

/**
 * The names the agents of a team answer to: catalog agents to their fixed names, custom agents to
 * their handle. Keys that are neither are left out.
 */
export function teamMentionNames(
  team: readonly string[],
  customAgents: readonly Pick<CustomAgentSummary, 'key' | 'name'>[],
): MentionNames {
  const custom = new Map(customAgents.map((agent) => [agent.key, agent.name]));
  const names: Record<string, readonly string[]> = {};
  for (const key of team) {
    const name = custom.get(key);
    if (isAgentKey(key)) names[key] = AGENT_MENTION_NAMES[key];
    else if (name !== undefined) names[key] = [mentionHandle(name).toLowerCase()];
  }
  return names;
}
