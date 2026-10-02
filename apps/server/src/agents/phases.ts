import { nextPhase, PHASES, type Phase } from '@covibes/shared';

// The phases of a project as the agents are told about them (spec 24).

/** The names of the phases in the product, in both languages of the app. */
export const PHASE_NAMES: Readonly<Record<Phase, { en: string; de: string }>> = {
  brainstorming: { en: 'Brainstorming', de: 'Brainstorming' },
  decide: { en: 'Decide', de: 'Entscheiden' },
  architecture: { en: 'Architecture', de: 'Architektur' },
  plan: { en: 'Project plan', de: 'Projektplan' },
};

/** What each phase is for, in one line. */
const PURPOSES: Readonly<Record<Phase, string>> = {
  brainstorming:
    'collect ideas, goals and criteria and put them in order; nothing has to be decided yet',
  decide: 'weigh the options by the criteria and record the decisions the project needs',
  architecture:
    'work out how the product is built, with its components, data and flows, on the basis of the decisions',
  plan: 'turn the result into the project plan: scope, milestones, tasks, risks, costs and time',
};

function named(phase: Phase): string {
  const { en, de } = PHASE_NAMES[phase];
  return en === de ? `"${en}"` : `"${en}" (in German "${de}")`;
}

/**
 * The current phase for an agent's context: its name, what it is for, and the phase that follows.
 * The tool `set_phase` and the observer's answer name a phase by its key.
 */
export function describePhase(phase: Phase): string {
  const next = nextPhase(phase);
  return [
    `The project is in the phase ${named(phase)}, key ${phase}, number ${String(
      PHASES.indexOf(phase) + 1,
    )} of ${String(PHASES.length)}: ${PURPOSES[phase]}.`,
    next
      ? `The phase after it is ${named(next)}, key ${next}: ${PURPOSES[next]}.`
      : 'It is the last phase.',
  ].join('\n');
}
