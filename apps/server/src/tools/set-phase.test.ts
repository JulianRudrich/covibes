import type { Phase } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import type { Intent } from '@server/rules/decide';
import { setPhaseTool } from '@server/tools/set-phase';

/** A project's phase kept in memory. */
function memoryPhase(start: Phase = 'brainstorming') {
  let phase = start;
  return {
    get: () => phase,
    phases: {
      current: () => Promise.resolve(phase),
      set: (next: Phase) => {
        phase = next;
        return Promise.resolve();
      },
    },
  };
}

function toolFor(intent: Intent, proposalsOnly = false, start: Phase = 'brainstorming') {
  const project = memoryPhase(start);
  const tool = setPhaseTool({
    phases: project.phases,
    rules: { intent: Promise.resolve(intent), proposalsOnly },
  });
  return { tool, project };
}

describe('set_phase', () => {
  it('moves the project on an instruction, forward and back', async () => {
    const { tool, project } = toolFor('instruction');

    expect(await tool.run({ phase: 'architecture' })).toBe(
      'The project is now in the phase "Architecture". Everyone sees it in the phase bar at the top.',
    );
    expect(project.get()).toBe('architecture');

    await tool.run({ phase: 'decide' });
    expect(project.get()).toBe('decide');
  });

  it.each(['question', 'initiative'] as const)(
    'changes nothing on a %s and tells the moderator to suggest it',
    async (intent) => {
      const { tool, project } = toolFor(intent);

      const answer = await tool.run({ phase: 'decide' });

      expect(answer).toContain('Nothing changed: nobody told you to change the phase.');
      expect(answer).toContain('Suggest the change in your answer instead');
      expect(answer).toContain('click on the phase bar');
      expect(project.get()).toBe('brainstorming');
    },
  );

  it('changes nothing in a project that takes proposals only', async () => {
    const { tool, project } = toolFor('instruction', true);

    expect(await tool.run({ phase: 'decide' })).toContain(
      'Nothing changed: this project takes changes by agents as proposals only.',
    );
    expect(project.get()).toBe('brainstorming');
  });

  it('says so when the project is in that phase already', async () => {
    const { tool, project } = toolFor('instruction', false, 'plan');

    expect(await tool.run({ phase: 'plan' })).toBe(
      'Nothing changed: the project is already in the phase "Project plan".',
    );
    expect(project.get()).toBe('plan');
  });

  it('takes only the four phases', async () => {
    const { tool, project } = toolFor('instruction');

    await expect(tool.run({ phase: 'launch' })).rejects.toThrow();
    await expect(tool.run({})).rejects.toThrow();
    expect(project.get()).toBe('brainstorming');
  });

  it('counts as an instruction without rules, like the other tools', async () => {
    const project = memoryPhase();
    const tool = setPhaseTool({ phases: project.phases });

    await tool.run({ phase: 'decide' });
    expect(project.get()).toBe('decide');
  });
});
