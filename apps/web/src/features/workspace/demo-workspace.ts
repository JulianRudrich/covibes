import type { AgentKey, Phase } from '@covibes/shared';

// Sample data from the design handoff until agents (spec 07) and phases exist per project.
export const DEMO_AGENTS: { key: AgentKey; initials: string }[] = [
  { key: 'moderator', initials: 'M' },
  { key: 'backend', initials: 'B' },
  { key: 'critic', initials: 'K' },
  { key: 'data', initials: 'D' },
];

export const DEMO_ACTIVE_PHASE: Phase = 'architecture';
