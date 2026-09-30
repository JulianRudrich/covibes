/**
 * Keys of the catalog agents (spec 14): the moderator and nine specialists, in the order the UI
 * lists them.
 */
export const AGENT_KEYS = [
  'moderator',
  'critic',
  'product',
  'frontend',
  'backend',
  'data',
  'devops',
  'security',
  'ml',
  'content',
] as const;

export type AgentKey = (typeof AGENT_KEYS)[number];

export function isAgentKey(value: unknown): value is AgentKey {
  return (AGENT_KEYS as readonly unknown[]).includes(value);
}

/**
 * Names that address an agent with `@`, lowercase. The UI shows agents by their German or English
 * name, so both count: `@Kritiker` and `@Critic` reach the same agent.
 */
export const AGENT_MENTION_NAMES: Readonly<Record<AgentKey, readonly string[]>> = {
  moderator: ['moderator'],
  critic: ['critic', 'kritiker'],
  product: ['product', 'produkt'],
  frontend: ['frontend', 'ux'],
  backend: ['backend'],
  data: ['data', 'daten', 'datenbank'],
  devops: ['devops', 'infra'],
  security: ['security', 'sicherheit', 'datenschutz', 'privacy'],
  ml: ['ml'],
  content: ['content', 'seo'],
};

/** The models an owner can choose for an agent (spec 14); the first is every agent's default. */
export const AGENT_MODELS = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-4-5-20251001',
] as const;
export type AgentModel = (typeof AGENT_MODELS)[number];
export const DEFAULT_AGENT_MODEL: AgentModel = 'claude-opus-5-5';

export function isAgentModel(value: unknown): value is AgentModel {
  return (AGENT_MODELS as readonly unknown[]).includes(value);
}
