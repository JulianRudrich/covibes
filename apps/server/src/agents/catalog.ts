import {
  AGENT_KEYS,
  DEFAULT_AGENT_MODEL,
  isAgentKey,
  type AgentKey,
  type AgentModel,
} from '@covibes/shared';

import { loadPrompt } from '@server/agents/prompts';

/**
 * An agent in the format that catalog and custom agents share (`architecture.md`, "Agents").
 * The instructions are the agent's role plus the rules all agents share, so no role can drop them.
 */
export type AgentDefinition = {
  key: AgentKey;
  /** Display names; the prompt names agents in both languages. */
  names: { de: string; en: string };
  /** What the agent does, in one line, for the team overview in the prompt. */
  role: string;
  provider: 'anthropic';
  /** The default model; owners choose another one per project (spec 14). */
  model: AgentModel;
  effort: 'low' | 'medium' | 'high';
  /** The role's prompt file followed by `common.md`. */
  prompt: string;
  /** Tools the agent may use, by name. */
  tools: readonly string[];
  scope: 'catalog';
};

/** The canvas tools every catalog agent uses (specs 08 to 13). */
const CANVAS_TOOLS = [
  'add_block',
  'update_block',
  'connect_blocks',
  'add_note',
  'add_frame',
  'arrange_frame',
] as const;

const COMMON_PROMPT = loadPrompt('common');

/** What differs between the catalog agents; everything else is the same for all of them. */
const ROLES: Readonly<
  Record<AgentKey, { names: AgentDefinition['names']; role: string; tools?: readonly string[] }>
> = {
  moderator: {
    names: { de: 'Moderator', en: 'Moderator' },
    role: 'neutral moderation: structures the discussion, sums up and puts the team together',
    tools: [
      ...CANVAS_TOOLS,
      'add_agents',
      'update_criteria',
      'record_decision',
      'compare_options',
      'start_vote',
      'propose_variants',
    ],
  },
  critic: {
    names: { de: 'Kritiker', en: 'Critic' },
    role: 'finds weak points, risks, contradictions and unchecked assumptions',
  },
  product: {
    names: { de: 'Produkt', en: 'Product' },
    role: 'users, value, scope and priorities',
  },
  frontend: {
    names: { de: 'Frontend', en: 'Frontend' },
    role: 'frontend and UX: screens, flows, interaction and accessibility',
  },
  backend: {
    names: { de: 'Backend', en: 'Backend' },
    role: 'backend and APIs: services, interfaces, business logic and integrations',
  },
  data: {
    names: { de: 'Daten', en: 'Data' },
    role: 'data and databases: data models, storage, queries and migrations',
  },
  devops: {
    names: { de: 'DevOps', en: 'DevOps' },
    role: 'infrastructure, deployment and operations',
  },
  security: {
    names: { de: 'Sicherheit', en: 'Security' },
    role: 'security and privacy: access, secrets, personal data and data protection law',
  },
  ml: {
    names: { de: 'ML', en: 'ML' },
    role: 'machine learning and models: fit, data, evaluation and costs',
  },
  content: {
    names: { de: 'Content', en: 'Content' },
    role: 'content and SEO: texts, information architecture and findability',
  },
};

/** The catalog in the order of `AGENT_KEYS`: the moderator and nine specialists. */
export const CATALOG: readonly AgentDefinition[] = AGENT_KEYS.map((key) => ({
  key,
  ...ROLES[key],
  provider: 'anthropic',
  model: DEFAULT_AGENT_MODEL,
  effort: 'medium',
  prompt: `${loadPrompt(key)}\n\n${COMMON_PROMPT}`,
  tools: ROLES[key].tools ?? CANVAS_TOOLS,
  scope: 'catalog',
}));

const BY_KEY: ReadonlyMap<string, AgentDefinition> = new Map(
  CATALOG.map((agent) => [agent.key, agent]),
);

export const MODERATOR: AgentDefinition = agentDefinition('moderator');

/** The definition of a catalog agent. */
export function agentDefinition(key: AgentKey): AgentDefinition {
  const agent = BY_KEY.get(key);
  if (!agent) throw new Error(`No catalog agent "${key}"`);
  return agent;
}

/** The definition for a stored key, or undefined for keys that are no catalog agent. */
export function findAgent(key: string): AgentDefinition | undefined {
  return isAgentKey(key) ? BY_KEY.get(key) : undefined;
}

/** The agent's name for the prompt, e.g. `Critic` or `Critic ("Kritiker" in German)`. */
export function describeName(agent: AgentDefinition): string {
  return agent.names.de === agent.names.en
    ? agent.names.en
    : `${agent.names.en} ("${agent.names.de}" in German)`;
}
