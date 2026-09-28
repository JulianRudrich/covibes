/**
 * Keys of the agents known to the product. Until the agent catalog (spec 14)
 * exists, these four from the design handoff are the complete list.
 */
export const AGENT_KEYS = ['moderator', 'backend', 'kritiker', 'daten'] as const;

export type AgentKey = (typeof AGENT_KEYS)[number];
