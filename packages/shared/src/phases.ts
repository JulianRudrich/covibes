/** Orientation phases of a project, in order (see context/project-overview.md). */
export const PHASES = ['brainstorming', 'decide', 'architecture', 'plan'] as const;

export type Phase = (typeof PHASES)[number];

export type PhaseStatus = 'done' | 'active' | 'upcoming';

/** Derives each phase's status from the currently active phase. */
export function phaseStatuses(active: Phase): { phase: Phase; status: PhaseStatus }[] {
  const activeIndex = PHASES.indexOf(active);
  return PHASES.map((phase, index) => ({
    phase,
    status: index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'upcoming',
  }));
}
