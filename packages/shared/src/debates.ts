import { z } from 'zod';

import { agentKeySchema } from './agents/custom';

// Debates (spec 18): on request two or three specialists take turns on a question for a limited
// number of rounds, then the moderator sums up.

/** Same limits as the check constraints on `debates` (packages/db/migrations). */
export const DEBATE_TOPIC_MAX_LENGTH = 80;
export const DEBATE_QUESTION_MAX_LENGTH = 300;
export const DEBATE_MIN_PARTICIPANTS = 2;
export const DEBATE_MAX_PARTICIPANTS = 3;
export const DEBATE_MAX_ROUNDS = 3;
export const DEBATE_DEFAULT_ROUNDS = 2;

/**
 * - `running`: the participants take turns
 * - `summarizing`: the moderator sums up
 * - `done`: over, with the summary or ended before the first turn
 * - `failed`: aborted because a run of the debate failed for good
 */
export const DEBATE_STATUSES = ['running', 'summarizing', 'done', 'failed'] as const;
export type DebateStatus = (typeof DEBATE_STATUSES)[number];

/** The debate that a moderator message opens; the chat shows it as a card in that message. */
export const messageDebateSchema = z.object({
  id: z.uuid(),
  topic: z.string(),
  question: z.string(),
  /** In the order they speak; a round is one turn of each. */
  participants: z.array(agentKeySchema).min(DEBATE_MIN_PARTICIPANTS).max(DEBATE_MAX_PARTICIPANTS),
  rounds: z.number().int().min(1).max(DEBATE_MAX_ROUNDS),
  /** Turns that are finished. */
  turns: z.number().int().min(0),
  status: z.enum(DEBATE_STATUSES),
  /** Whether someone ended the debate early, and who (null if the account is gone). */
  stopped: z.boolean(),
  stoppedBy: z.string().nullable(),
});
export type MessageDebate = z.infer<typeof messageDebateSchema>;

/** Marks a message as a turn of a debate, or as its summary (`round` is null). */
export const messageDebateTurnSchema = z.object({
  debateId: z.uuid(),
  round: z.number().int().min(1).nullable(),
  rounds: z.number().int().min(1).max(DEBATE_MAX_ROUNDS),
});
export type MessageDebateTurn = z.infer<typeof messageDebateTurnSchema>;

/**
 * Where a running debate stands: the round that is being debated and whose turn it is. Null once
 * all turns are taken.
 */
export function debateProgress(debate: {
  participants: readonly string[];
  rounds: number;
  turns: number;
}): { round: number; speaker: string } | null {
  const count = debate.participants.length;
  const speaker = debate.participants[debate.turns % count];
  if (!speaker || debate.turns >= count * debate.rounds) return null;
  return { round: Math.floor(debate.turns / count) + 1, speaker };
}

/** The rounds a debate got through; a round that was begun counts. */
export function debatedRounds(debate: { participants: readonly string[]; turns: number }): number {
  return Math.ceil(debate.turns / debate.participants.length);
}
