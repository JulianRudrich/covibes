import type { AgentLook } from '@web/features/agents/agents';

// Agent colors on the canvas as complete class names, so Tailwind finds them. `custom` is the look
// of custom agents (spec 19); `agentClass` adds the class that picks one of their six colors.

export const AGENT_BORDER: Readonly<Record<AgentLook, string>> = {
  moderator: 'border-agent-moderator',
  backend: 'border-agent-backend',
  critic: 'border-agent-critic',
  data: 'border-agent-data',
  product: 'border-agent-product',
  frontend: 'border-agent-frontend',
  devops: 'border-agent-devops',
  security: 'border-agent-security',
  ml: 'border-agent-ml',
  content: 'border-agent-content',
  custom: 'border-agent-custom',
};

export const AGENT_BACKGROUND: Readonly<Record<AgentLook, string>> = {
  moderator: 'bg-agent-moderator',
  backend: 'bg-agent-backend',
  critic: 'bg-agent-critic',
  data: 'bg-agent-data',
  product: 'bg-agent-product',
  frontend: 'bg-agent-frontend',
  devops: 'bg-agent-devops',
  security: 'bg-agent-security',
  ml: 'bg-agent-ml',
  content: 'bg-agent-content',
  custom: 'bg-agent-custom',
};

/** Icon tile of a block an agent just changed: agent tint, agent border, icon in the dark color. */
export const AGENT_TILE: Readonly<Record<AgentLook, string>> = {
  moderator: 'border-agent-moderator-border bg-agent-moderator-tint text-agent-moderator-dark',
  backend: 'border-agent-backend-border bg-agent-backend-tint text-agent-backend-dark',
  critic: 'border-agent-critic-border bg-agent-critic-tint text-agent-critic-dark',
  data: 'border-agent-data-border bg-agent-data-tint text-agent-data-dark',
  product: 'border-agent-product-border bg-agent-product-tint text-agent-product-dark',
  frontend: 'border-agent-frontend-border bg-agent-frontend-tint text-agent-frontend-dark',
  devops: 'border-agent-devops-border bg-agent-devops-tint text-agent-devops-dark',
  security: 'border-agent-security-border bg-agent-security-tint text-agent-security-dark',
  ml: 'border-agent-ml-border bg-agent-ml-tint text-agent-ml-dark',
  content: 'border-agent-content-border bg-agent-content-tint text-agent-content-dark',
  custom: 'border-agent-custom-border bg-agent-custom-tint text-agent-custom-dark',
};

export const AGENT_DARK_TEXT: Readonly<Record<AgentLook, string>> = {
  moderator: 'text-agent-moderator-dark',
  backend: 'text-agent-backend-dark',
  critic: 'text-agent-critic-dark',
  data: 'text-agent-data-dark',
  product: 'text-agent-product-dark',
  frontend: 'text-agent-frontend-dark',
  devops: 'text-agent-devops-dark',
  security: 'text-agent-security-dark',
  ml: 'text-agent-ml-dark',
  content: 'text-agent-content-dark',
  custom: 'text-agent-custom-dark',
};

export const AGENT_TINT_BORDER: Readonly<Record<AgentLook, string>> = {
  moderator: 'border-agent-moderator-tint',
  backend: 'border-agent-backend-tint',
  critic: 'border-agent-critic-tint',
  data: 'border-agent-data-tint',
  product: 'border-agent-product-tint',
  frontend: 'border-agent-frontend-tint',
  devops: 'border-agent-devops-tint',
  security: 'border-agent-security-tint',
  ml: 'border-agent-ml-tint',
  content: 'border-agent-content-tint',
  custom: 'border-agent-custom-tint',
};

/**
 * Label pill of an arrow an agent just drew (handoff: second tint, second border and dark color
 * for the moderator). Agents without a second tint and border use their only one.
 */
export const AGENT_LABEL: Readonly<Record<AgentLook, string>> = {
  moderator: 'border-agent-moderator-border-2 bg-agent-moderator-tint-2 text-agent-moderator-dark',
  backend: 'border-agent-backend-border bg-agent-backend-tint text-agent-backend-dark',
  critic: 'border-agent-critic-border-2 bg-agent-critic-tint-2 text-agent-critic-dark',
  data: 'border-agent-data-border bg-agent-data-tint text-agent-data-dark',
  product: 'border-agent-product-border bg-agent-product-tint text-agent-product-dark',
  frontend: 'border-agent-frontend-border bg-agent-frontend-tint text-agent-frontend-dark',
  devops: 'border-agent-devops-border bg-agent-devops-tint text-agent-devops-dark',
  security: 'border-agent-security-border bg-agent-security-tint text-agent-security-dark',
  ml: 'border-agent-ml-border bg-agent-ml-tint text-agent-ml-dark',
  content: 'border-agent-content-border bg-agent-content-tint text-agent-content-dark',
  custom: 'border-agent-custom-border bg-agent-custom-tint text-agent-custom-dark',
};

/**
 * A proposal of the agent (spec 13, handoff state "Proposal"): its base color for the dashed
 * border, its tint (slightly transparent) behind the content.
 */
export const AGENT_PROPOSAL: Readonly<Record<AgentLook, string>> = {
  moderator: 'border-agent-moderator bg-agent-moderator-tint/95',
  backend: 'border-agent-backend bg-agent-backend-tint/95',
  critic: 'border-agent-critic bg-agent-critic-tint/95',
  data: 'border-agent-data bg-agent-data-tint/95',
  product: 'border-agent-product bg-agent-product-tint/95',
  frontend: 'border-agent-frontend bg-agent-frontend-tint/95',
  devops: 'border-agent-devops bg-agent-devops-tint/95',
  security: 'border-agent-security bg-agent-security-tint/95',
  ml: 'border-agent-ml bg-agent-ml-tint/95',
  content: 'border-agent-content bg-agent-content-tint/95',
  custom: 'border-agent-custom bg-agent-custom-tint/95',
};

/**
 * A raised hand (handoff: the critic's card above the composer): its second tint and border; agents
 * without them use their only ones.
 */
export const AGENT_HAND: Readonly<Record<AgentLook, string>> = {
  moderator: 'border-agent-moderator-border bg-agent-moderator-tint-2',
  backend: 'border-agent-backend-border bg-agent-backend-tint',
  critic: 'border-agent-critic-border bg-agent-critic-tint-2',
  data: 'border-agent-data-border bg-agent-data-tint',
  product: 'border-agent-product-border bg-agent-product-tint',
  frontend: 'border-agent-frontend-border bg-agent-frontend-tint',
  devops: 'border-agent-devops-border bg-agent-devops-tint',
  security: 'border-agent-security-border bg-agent-security-tint',
  ml: 'border-agent-ml-border bg-agent-ml-tint',
  content: 'border-agent-content-border bg-agent-content-tint',
  custom: 'border-agent-custom-border bg-agent-custom-tint',
};

/** The "Anhören" button of a raised hand: the agent's second border, dark text, tint on hover. */
export const AGENT_HAND_BUTTON: Readonly<Record<AgentLook, string>> = {
  moderator:
    'border-agent-moderator-border-2 text-agent-moderator-dark hover:bg-agent-moderator-tint',
  backend: 'border-agent-backend-border text-agent-backend-dark hover:bg-agent-backend-tint',
  critic: 'border-agent-critic-border-2 text-agent-critic-dark hover:bg-agent-critic-tint',
  data: 'border-agent-data-border text-agent-data-dark hover:bg-agent-data-tint',
  product: 'border-agent-product-border text-agent-product-dark hover:bg-agent-product-tint',
  frontend: 'border-agent-frontend-border text-agent-frontend-dark hover:bg-agent-frontend-tint',
  devops: 'border-agent-devops-border text-agent-devops-dark hover:bg-agent-devops-tint',
  security: 'border-agent-security-border text-agent-security-dark hover:bg-agent-security-tint',
  ml: 'border-agent-ml-border text-agent-ml-dark hover:bg-agent-ml-tint',
  content: 'border-agent-content-border text-agent-content-dark hover:bg-agent-content-tint',
  custom: 'border-agent-custom-border text-agent-custom-dark hover:bg-agent-custom-tint',
};
