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
 * References to an element of the canvas an agent made (spec 37a; handoff "Canvas reference"):
 * the dark agent color on the agent's tint with its border, the base color as border on hover.
 * The moderator has the lighter tint and border of the handoff.
 */
export const AGENT_REFERENCE: Readonly<Record<AgentLook, string>> = {
  moderator:
    'border-agent-moderator-border-2 bg-agent-moderator-tint-2 text-agent-moderator-dark hover:border-agent-moderator hover:bg-agent-moderator-tint',
  backend:
    'border-agent-backend-border bg-agent-backend-tint text-agent-backend-dark hover:border-agent-backend',
  critic:
    'border-agent-critic-border bg-agent-critic-tint text-agent-critic-dark hover:border-agent-critic',
  data: 'border-agent-data-border bg-agent-data-tint text-agent-data-dark hover:border-agent-data',
  product:
    'border-agent-product-border bg-agent-product-tint text-agent-product-dark hover:border-agent-product',
  frontend:
    'border-agent-frontend-border bg-agent-frontend-tint text-agent-frontend-dark hover:border-agent-frontend',
  devops:
    'border-agent-devops-border bg-agent-devops-tint text-agent-devops-dark hover:border-agent-devops',
  security:
    'border-agent-security-border bg-agent-security-tint text-agent-security-dark hover:border-agent-security',
  ml: 'border-agent-ml-border bg-agent-ml-tint text-agent-ml-dark hover:border-agent-ml',
  content:
    'border-agent-content-border bg-agent-content-tint text-agent-content-dark hover:border-agent-content',
  custom:
    'border-agent-custom-border bg-agent-custom-tint text-agent-custom-dark hover:border-agent-custom',
};

/**
 * Box shadow for a block an agent just changed: `0 0 0 4px <base @16 %>, 0 6px 16px <base @14 %>`.
 * Built from the agent's color token, so it follows theme.css without duplicating color values.
 */
export function aiRing(agent: Pick<AgentInfo, 'look' | 'color'>): string {
  const base = agentColor(agent);
  return `0 0 0 4px color-mix(in srgb, ${base} 16%, transparent), 0 6px 16px color-mix(in srgb, ${base} 14%, transparent)`;
}
