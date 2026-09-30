import type { AgentKey } from '@covibes/shared';

// Agent colors on the canvas as complete class names, so Tailwind finds them.

export const AGENT_BORDER: Readonly<Record<AgentKey, string>> = {
  moderator: 'border-agent-moderator',
  backend: 'border-agent-backend',
  critic: 'border-agent-critic',
  data: 'border-agent-data',
};

export const AGENT_BACKGROUND: Readonly<Record<AgentKey, string>> = {
  moderator: 'bg-agent-moderator',
  backend: 'bg-agent-backend',
  critic: 'bg-agent-critic',
  data: 'bg-agent-data',
};

/** Icon tile of a block an agent just changed: agent tint, agent border, icon in the dark color. */
export const AGENT_TILE: Readonly<Record<AgentKey, string>> = {
  moderator: 'border-agent-moderator-border bg-agent-moderator-tint text-agent-moderator-dark',
  backend: 'border-agent-backend-border bg-agent-backend-tint text-agent-backend-dark',
  critic: 'border-agent-critic-border bg-agent-critic-tint text-agent-critic-dark',
  data: 'border-agent-data-border bg-agent-data-tint text-agent-data-dark',
};

export const AGENT_DARK_TEXT: Readonly<Record<AgentKey, string>> = {
  moderator: 'text-agent-moderator-dark',
  backend: 'text-agent-backend-dark',
  critic: 'text-agent-critic-dark',
  data: 'text-agent-data-dark',
};

export const AGENT_TINT_BORDER: Readonly<Record<AgentKey, string>> = {
  moderator: 'border-agent-moderator-tint',
  backend: 'border-agent-backend-tint',
  critic: 'border-agent-critic-tint',
  data: 'border-agent-data-tint',
};

/**
 * Label pill of an arrow an agent just drew (handoff: second tint, second border and dark color
 * for the moderator). Agents without a second tint and border use their only one.
 */
export const AGENT_LABEL: Readonly<Record<AgentKey, string>> = {
  moderator: 'border-agent-moderator-border-2 bg-agent-moderator-tint-2 text-agent-moderator-dark',
  backend: 'border-agent-backend-border bg-agent-backend-tint text-agent-backend-dark',
  critic: 'border-agent-critic-border-2 bg-agent-critic-tint-2 text-agent-critic-dark',
  data: 'border-agent-data-border bg-agent-data-tint text-agent-data-dark',
};

/** The agent's base color as a CSS value, for SVG strokes and arrowheads. */
export function agentColor(agent: AgentKey): string {
  return `var(--color-agent-${agent})`;
}
