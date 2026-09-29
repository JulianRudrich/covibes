/**
 * Keys of the agents known to the product. Until the agent catalog (spec 14)
 * exists, these four from the design handoff are the complete list.
 */
export const AGENT_KEYS = ['moderator', 'backend', 'critic', 'data'] as const;

export type AgentKey = (typeof AGENT_KEYS)[number];

/**
 * Names that address an agent with `@`, lowercase. The UI shows agents by their German or English
 * name, so both count: `@Kritiker` and `@Critic` reach the same agent.
 */
export const AGENT_MENTION_NAMES: Readonly<Record<AgentKey, readonly string[]>> = {
  moderator: ['moderator'],
  backend: ['backend'],
  critic: ['critic', 'kritiker'],
  data: ['data', 'daten'],
};
