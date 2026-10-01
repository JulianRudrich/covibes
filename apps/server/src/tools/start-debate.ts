import {
  AGENT_KEYS,
  DEBATE_DEFAULT_ROUNDS,
  DEBATE_MAX_PARTICIPANTS,
  DEBATE_MAX_ROUNDS,
  DEBATE_MIN_PARTICIPANTS,
  DEBATE_QUESTION_MAX_LENGTH,
  DEBATE_TOPIC_MAX_LENGTH,
  type AgentKey,
} from '@covibes/shared';
import { z } from 'zod';

import { findAgent } from '@server/agents/catalog';
import { defineTool, type AgentTool } from '@server/ai-gateway';
import type { DebateWriter } from '@server/tasks/run-debates';

function names(keys: readonly AgentKey[]): string {
  return keys.map((key) => findAgent(key)?.names.en ?? key).join(', ');
}

/**
 * `start_debate` (spec 18): the moderator opens a visible debate between two or three specialists
 * of the team. The debate is tied to the moderator's answer and starts once that answer is
 * finished; the database then queues turn after turn and, at the end, the moderator's summary.
 */
export function startDebateTool(options: { debates: DebateWriter }): AgentTool {
  return defineTool({
    name: 'start_debate',
    description:
      'Opens a visible debate between two or three specialists of the team on one question. They take turns in the chat for the given number of rounds and answer each other; afterwards you are called to sum up. Only use it when someone asks for a debate or accepted your offer of one.',
    input: {
      topic: z
        .string()
        .trim()
        .min(1)
        .max(DEBATE_TOPIC_MAX_LENGTH)
        .describe('What the debate is about, in one to four words, e.g. "Monolith oder Dienste"'),
      question: z
        .string()
        .trim()
        .min(1)
        .max(DEBATE_QUESTION_MAX_LENGTH)
        .describe('The question to debate, as one sentence in the language of the conversation'),
      participants: z
        .array(z.enum(AGENT_KEYS).exclude(['moderator']))
        .min(DEBATE_MIN_PARTICIPANTS)
        .max(DEBATE_MAX_PARTICIPANTS)
        .describe('The keys of the specialists who debate, in the order they speak'),
      rounds: z
        .number()
        .int()
        .min(1)
        .max(DEBATE_MAX_ROUNDS)
        .optional()
        .describe('How often everyone speaks: 2 unless the team asks for more or fewer'),
    },
    run: async ({ topic, question, participants, rounds = DEBATE_DEFAULT_ROUNDS }) => {
      const unique = participants.filter((key, index) => participants.indexOf(key) === index);
      if (unique.length < DEBATE_MIN_PARTICIPANTS) {
        throw new Error('A debate needs at least two different participants.');
      }
      const team = await options.debates.team();
      const missing = unique.filter((key) => !team.has(key));
      if (missing.length > 0) {
        return `Not in the team: ${names(missing)}. No debate was opened. Only agents of the team can debate: choose others, or add them with add_agents first and open the debate once they are in the team.`;
      }

      const outcome = await options.debates.start({
        topic,
        question,
        participants: unique,
        rounds,
      });
      if (outcome === 'busy') {
        return 'A debate is running already, and there is only one at a time. No second debate was opened.';
      }
      return `Opened the debate "${topic}" between ${names(unique)} with ${String(rounds)} ${rounds === 1 ? 'round' : 'rounds'}. It shows as a card in your answer and starts as soon as your answer is finished. Say in one or two sentences what is debated and who takes part; do not argue yourself. You are called to sum up when it is over.`;
    },
  });
}
