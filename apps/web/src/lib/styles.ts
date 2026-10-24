import { agentColor, type AgentInfo, type AgentLook } from '@web/features/agents/agents';

/** Agent-colored labels (badge "Agent", mention chips): dark agent color on the agent tint. */
export const AGENT_TONE: Readonly<Record<AgentLook, string>> = {
  moderator: 'bg-agent-moderator-tint text-agent-moderator-dark',
  backend: 'bg-agent-backend-tint text-agent-backend-dark',
  critic: 'bg-agent-critic-tint text-agent-critic-dark',
  data: 'bg-agent-data-tint text-agent-data-dark',
  product: 'bg-agent-product-tint text-agent-product-dark',
  frontend: 'bg-agent-frontend-tint text-agent-frontend-dark',
  devops: 'bg-agent-devops-tint text-agent-devops-dark',
  security: 'bg-agent-security-tint text-agent-security-dark',
  ml: 'bg-agent-ml-tint text-agent-ml-dark',
  content: 'bg-agent-content-tint text-agent-content-dark',
  custom: 'bg-agent-custom-tint text-agent-custom-dark',
};

/**
 * The soft glow around an element an agent just changed (handoff, state "just drawn"):
 * `0 0 0 7px <base @18 %>, 0 10px 24px <base @18 %>`. Built from the agent's color token, so it
 * follows theme.css without duplicating color values.
 */
export function aiGlow(agent: Pick<AgentInfo, 'look' | 'color'>): string {
  const ring = `color-mix(in srgb, ${agentColor(agent)} 18%, transparent)`;
  return `0 0 0 7px ${ring}, 0 10px 24px ${ring}`;
}

/** The whole look of an element an agent just changed: a 2 px ring in its base and the glow. */
export function aiRing(agent: Pick<AgentInfo, 'look' | 'color'>): string {
  return `0 0 0 2px ${agentColor(agent)}, ${aiGlow(agent)}`;
}
