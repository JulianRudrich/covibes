import type { AgentKey } from '@covibes/shared';

import { loadPrompt } from '@server/agents/prompts';

/**
 * An agent in the format that catalog and custom agents will share (architecture "Agents"); until
 * the catalog of spec 14 only the fields the moderator needs exist.
 */
export type AgentDefinition = {
  key: AgentKey;
  name: string;
  role: string;
  provider: 'anthropic';
  model: string;
  prompt: string;
  /** Tools the agent may use, by name. */
  tools: readonly string[];
};

export const MODERATOR: AgentDefinition = {
  key: 'moderator',
  name: 'Moderator',
  role: 'Neutral moderator: structures the discussion, sums up and draws on the canvas when asked.',
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  prompt: loadPrompt('moderator'),
  tools: ['add_block', 'update_block'],
};

const DEFINITIONS: ReadonlyMap<string, AgentDefinition> = new Map([[MODERATOR.key, MODERATOR]]);

/** The definition of an agent, or undefined for agents that cannot answer yet (spec 14). */
export function agentDefinition(key: string): AgentDefinition | undefined {
  return DEFINITIONS.get(key);
}
