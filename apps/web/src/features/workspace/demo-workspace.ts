import type { AgentKey, Phase } from '@covibes/shared';

// Sample data from the design handoff until real projects exist (spec 04).
export type DemoMember = { id: string; name: string; initials: string; isCurrentUser: boolean };

export const DEMO_MEMBERS: DemoMember[] = [
  { id: 'you', name: '', initials: '', isCurrentUser: true },
  { id: 'alex', name: 'Alex', initials: 'A', isCurrentUser: false },
  { id: 'sam', name: 'Sam', initials: 'S', isCurrentUser: false },
];

export const DEMO_AGENTS: { key: AgentKey; initials: string }[] = [
  { key: 'moderator', initials: 'M' },
  { key: 'backend', initials: 'B' },
  { key: 'kritiker', initials: 'K' },
  { key: 'daten', initials: 'D' },
];

export const DEMO_ACTIVE_PHASE: Phase = 'architecture';
