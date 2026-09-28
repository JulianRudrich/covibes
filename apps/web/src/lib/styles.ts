import type { AgentKey } from '@covibes/shared';

/**
 * Box shadow for a block an agent just changed: `0 0 0 4px <base @16 %>, 0 6px 16px <base @14 %>`.
 * Built from the agent's color token, so it follows theme.css without duplicating color values.
 */
export function aiRing(agent: AgentKey): string {
  const base = `var(--color-agent-${agent})`;
  return `0 0 0 4px color-mix(in srgb, ${base} 16%, transparent), 0 6px 16px color-mix(in srgb, ${base} 14%, transparent)`;
}
