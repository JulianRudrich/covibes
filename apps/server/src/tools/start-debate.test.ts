import type { AgentKey } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import type { DebateWriter } from '@server/tasks/run-debates';
import { startDebateTool } from '@server/tools/start-debate';

/** A debate writer that keeps what `start_debate` opens. */
function debates(team: AgentKey[], outcome: 'started' | 'busy' = 'started') {
  const opened: Parameters<DebateWriter['start']>[0][] = [];
  const writer: DebateWriter = {
    team: () => Promise.resolve(new Set(team)),
    start: (debate) => {
      opened.push(debate);
      return Promise.resolve(outcome);
    },
  };
  return { writer, opened };
}

const INPUT = {
  topic: 'Monolith oder Dienste',
  question: 'Braucht das MVP einen eigenen Echtzeit-Dienst?',
  participants: ['backend', 'critic'],
};

describe('start_debate', () => {
  it('opens a debate between specialists of the team, with two rounds by default', async () => {
    const { writer, opened } = debates(['moderator', 'backend', 'critic']);
    const tool = startDebateTool({ debates: writer });

    const answer = await tool.run(INPUT);

    expect(opened).toEqual([{ ...INPUT, rounds: 2 }]);
    expect(answer).toContain(
      'Opened the debate "Monolith oder Dienste" between Backend, Critic with 2 rounds',
    );
    expect(answer).toContain('do not argue yourself');
  });

  it('takes the rounds the team asks for and names every participant once', async () => {
    const { writer, opened } = debates(['moderator', 'backend', 'critic', 'security']);
    const tool = startDebateTool({ debates: writer });

    const answer = await tool.run({
      ...INPUT,
      participants: ['critic', 'security', 'critic'],
      rounds: 1,
    });

    expect(opened).toMatchObject([{ participants: ['critic', 'security'], rounds: 1 }]);
    expect(answer).toContain('with 1 round.');
  });

  it('opens nothing for agents outside the team', async () => {
    const { writer, opened } = debates(['moderator', 'backend']);
    const tool = startDebateTool({ debates: writer });

    const answer = await tool.run({ ...INPUT, participants: ['backend', 'critic', 'security'] });

    expect(opened).toEqual([]);
    expect(answer).toContain('Not in the team: Critic, Security. No debate was opened.');
  });

  it('says so when a debate is running already', async () => {
    const { writer } = debates(['moderator', 'backend', 'critic'], 'busy');
    const tool = startDebateTool({ debates: writer });

    expect(await tool.run(INPUT)).toContain('A debate is running already');
  });

  it('refuses the moderator, a single participant and more than three rounds', async () => {
    const { writer, opened } = debates(['moderator', 'backend', 'critic']);
    const tool = startDebateTool({ debates: writer });

    await expect(tool.run({ ...INPUT, participants: ['backend', 'moderator'] })).rejects.toThrow();
    await expect(tool.run({ ...INPUT, participants: ['backend', 'backend'] })).rejects.toThrow(
      'at least two different participants',
    );
    await expect(tool.run({ ...INPUT, rounds: 4 })).rejects.toThrow();
    expect(opened).toEqual([]);
  });
});
