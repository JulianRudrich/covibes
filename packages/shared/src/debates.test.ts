import { describe, expect, it } from 'vitest';

import { debatedRounds, debateProgress, messageDebateSchema } from './debates';
import { chatMessageSchema } from './messages';

const DEBATE = {
  id: '11111111-1111-4111-8111-111111111111',
  topic: 'Architektur',
  question: 'Monolith oder getrennte Dienste?',
  participants: ['backend', 'critic'],
  rounds: 2,
  turns: 0,
  status: 'running',
  stopped: false,
  stoppedBy: null,
};

describe('debates (spec 18)', () => {
  it('tells the round and the speaker from the finished turns', () => {
    const debate = messageDebateSchema.parse(DEBATE);
    expect(debateProgress(debate)).toEqual({ round: 1, speaker: 'backend' });
    expect(debateProgress({ ...debate, turns: 1 })).toEqual({ round: 1, speaker: 'critic' });
    expect(debateProgress({ ...debate, turns: 2 })).toEqual({ round: 2, speaker: 'backend' });
    expect(debateProgress({ ...debate, turns: 4 })).toBeNull();

    const three = { ...debate, participants: ['backend', 'critic', 'security'] as const };
    expect(debateProgress({ ...three, turns: 5 })).toEqual({ round: 2, speaker: 'security' });
  });

  it('counts a round that was begun', () => {
    const debate = messageDebateSchema.parse(DEBATE);
    expect(debatedRounds(debate)).toBe(0);
    expect(debatedRounds({ ...debate, turns: 1 })).toBe(1);
    expect(debatedRounds({ ...debate, turns: 2 })).toBe(1);
    expect(debatedRounds({ ...debate, turns: 3 })).toBe(2);
  });

  it('takes two or three known agents and up to three rounds', () => {
    expect(messageDebateSchema.safeParse({ ...DEBATE, participants: ['backend'] }).success).toBe(
      false,
    );
    expect(
      messageDebateSchema.safeParse({ ...DEBATE, participants: ['backend', 'nobody'] }).success,
    ).toBe(false);
    expect(messageDebateSchema.safeParse({ ...DEBATE, rounds: 4 }).success).toBe(false);
  });

  it('is part of a chat message, as the card or as the mark of a turn', () => {
    const message = {
      id: 'm1',
      projectId: 'p1',
      author: { kind: 'agent', agentKey: 'moderator' },
      content: 'Die Debatte beginnt.',
      mentions: [],
      replyTo: null,
      status: 'complete',
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
    };
    expect(chatMessageSchema.parse({ ...message, debate: DEBATE }).debate?.topic).toBe(
      'Architektur',
    );
    const turn = chatMessageSchema.parse({
      ...message,
      debateTurn: { debateId: DEBATE.id, round: null, rounds: 2 },
    });
    expect(turn.debateTurn).toEqual({ debateId: DEBATE.id, round: null, rounds: 2 });
  });
});
