import type { AgentKey } from '@covibes/shared';

/** Agent-colored labels (badge "Agent", mention chips): dark agent color on the agent tint. */
export const AGENT_TONE: Readonly<Record<AgentKey, string>> = {
  moderator: 'bg-agent-moderator-tint text-agent-moderator-dark',
  backend: 'bg-agent-backend-tint text-agent-backend-dark',
  critic: 'bg-agent-critic-tint text-agent-critic-dark',
  data: 'bg-agent-data-tint text-agent-data-dark',
};

/**
 * Box shadow for a block an agent just changed: `0 0 0 4px <base @16 %>, 0 6px 16px <base @14 %>`.
 * Built from the agent's color token, so it follows theme.css without duplicating color values.
 */
export function aiRing(agent: AgentKey): string {
  const base = `var(--color-agent-${agent})`;
  return `0 0 0 4px color-mix(in srgb, ${base} 16%, transparent), 0 6px 16px color-mix(in srgb, ${base} 14%, transparent)`;
}
