import { z } from 'zod';

/** Orientation phases of a project, in order (see context/project-overview.md). */
export const PHASES = ['brainstorming', 'decide', 'architecture', 'plan'] as const;

export type Phase = (typeof PHASES)[number];

export const phaseSchema = z.enum(PHASES);

/** The phase of a new project, and of one whose stored phase a later version does not know. */
export const FIRST_PHASE: Phase = 'brainstorming';

/** `PUT /api/projects/:projectId/phase`: owners and editors jump to a phase (spec 24). */
export const setPhaseInputSchema = z.object({ phase: phaseSchema });
export type SetPhaseInput = z.infer<typeof setPhaseInputSchema>;

export type PhaseStatus = 'done' | 'active' | 'upcoming';

/** Derives each phase's status from the currently active phase. */
export function phaseStatuses(active: Phase): { phase: Phase; status: PhaseStatus }[] {
  const activeIndex = PHASES.indexOf(active);
  return PHASES.map((phase, index) => ({
    phase,
    status: index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'upcoming',
  }));
}

/** The phase after the given one; undefined after the last. */
export function nextPhase(phase: Phase): Phase | undefined {
  return PHASES[PHASES.indexOf(phase) + 1];
}

/** A stored phase as one this version knows. */
export function toPhase(value: unknown): Phase {
  const parsed = phaseSchema.safeParse(value);
  return parsed.success ? parsed.data : FIRST_PHASE;
}
