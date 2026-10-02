import { PHASES, type Phase } from '@covibes/shared';
import { z } from 'zod';

import { PHASE_NAMES } from '@server/agents/phases';
import { defineTool, type AgentTool } from '@server/ai-gateway';
import { decide, type Intent } from '@server/rules/decide';

/** Reads and changes the phase of the project a run belongs to. */
export type PhaseWriter = {
  current: () => Promise<Phase>;
  set: (phase: Phase) => Promise<void>;
};

/** How the rule engine treats a change of the phase in one run, like canvas changes (spec 13). */
export type PhaseRules = {
  intent: Promise<Intent>;
  proposalsOnly: boolean;
};

const SUGGEST =
  'Suggest the change in your answer instead; owners and editors change the phase themselves with a click on the phase bar at the top.';

/**
 * `set_phase` (spec 24): the moderator moves the project to another phase. It only does so when
 * someone told it to or accepted its offer. On a question, on its own initiative and in a project
 * that takes proposals only, nothing changes and the moderator suggests the change in words: a
 * phase is one click for the team, so it needs no proposal that waits.
 */
export function setPhaseTool(options: { phases: PhaseWriter; rules?: PhaseRules }): AgentTool {
  return defineTool({
    name: 'set_phase',
    description:
      'Moves the project to another phase, forward or back. It only takes effect when someone told you to change the phase or accepted your offer to move on; otherwise nothing changes and you suggest the change in your answer.',
    input: {
      phase: z.enum(PHASES).describe('The key of the phase the project moves to'),
    },
    run: async ({ phase }) => {
      const name = PHASE_NAMES[phase].en;
      if ((await options.phases.current()) === phase) {
        return `Nothing changed: the project is already in the phase "${name}".`;
      }
      const outcome = decide({
        allowed: true,
        intent: options.rules ? await options.rules.intent : 'instruction',
        proposalsOnly: options.rules?.proposalsOnly ?? false,
        lockedTarget: false,
      });
      if (outcome.kind === 'reject') throw new Error('This tool is not allowed for you.');
      if (outcome.kind === 'proposal') {
        const why =
          outcome.reason === 'proposals_only'
            ? 'this project takes changes by agents as proposals only'
            : 'nobody told you to change the phase';
        return `Nothing changed: ${why}. ${SUGGEST}`;
      }
      await options.phases.set(phase);
      return `The project is now in the phase "${name}". Everyone sees it in the phase bar at the top.`;
    },
  });
}
