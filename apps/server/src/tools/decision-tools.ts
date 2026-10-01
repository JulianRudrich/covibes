import {
  COMPARISON_OPTION_MAX_LENGTH,
  COMPARISON_RATINGS,
  comparisonSchema,
  CRITERION_MAX_LENGTH,
  DECISION_REASONING_MAX_LENGTH,
  DECISION_TOPIC_MAX_LENGTH,
  DECISION_VALUE_MAX_LENGTH,
  decisionOperationSchema,
  MAX_CRITERIA_PER_PROJECT,
  type DecisionProcess,
  type ModeratorStance,
} from '@covibes/shared';
import { z } from 'zod';

import { defineTool, type AgentTool } from '@server/ai-gateway';
import { decide, type Intent } from '@server/rules/decide';
import type { DecisionWriter } from '@server/tasks/run-decisions';

const sameText = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * `update_criteria` (spec 16a): the moderator records the criteria the team stated and removes
 * the ones it is asked to. Recording is no change of the team's work, so it runs directly; the
 * decision log names the agent.
 */
export function updateCriteriaTool(options: { decisions: DecisionWriter }): AgentTool {
  return defineTool({
    name: 'update_criteria',
    description:
      'Records project criteria that the team stated (goals, budget, time, know-how, priorities) as short texts of a few words each, or removes criteria by their id. Never invent criteria.',
    input: {
      add: z
        .array(z.string().trim().min(1).max(CRITERION_MAX_LENGTH))
        .max(MAX_CRITERIA_PER_PROJECT)
        .optional()
        .describe('Criteria to add, each a short text such as "EU-Hosting" or "Team: 3 Devs"'),
      remove: z
        .array(z.uuid())
        .max(MAX_CRITERIA_PER_PROJECT)
        .optional()
        .describe('Ids of criteria to remove, from the criteria in the context'),
    },
    run: async ({ add = [], remove = [] }) => {
      const { criteria } = await options.decisions.load();
      const removed = await options.decisions.removeCriteria(remove);
      const kept = criteria.filter((criterion) => !remove.includes(criterion.id));
      const fresh = add.filter(
        (text, index) =>
          !kept.some((criterion) => sameText(criterion.text, text)) &&
          add.findIndex((other) => sameText(other, text)) === index,
      );
      const room = Math.max(0, MAX_CRITERIA_PER_PROJECT - kept.length);
      const added = fresh.slice(0, room);
      await options.decisions.addCriteria(added);

      const notes = [
        added.length > 0 ? `Added: ${added.join('; ')}.` : null,
        removed > 0 ? `Removed: ${String(removed)}.` : null,
        fresh.length > added.length
          ? `Not added, a project has at most ${String(MAX_CRITERIA_PER_PROJECT)} criteria: ${fresh.slice(room).join('; ')}.`
          : null,
        add.length > fresh.length ? 'The others were there already.' : null,
      ].filter((note) => note !== null);
      return notes.length > 0 ? notes.join(' ') : 'Nothing changed.';
    },
  });
}

/** How the rule engine treats recording a decision, like canvas changes (spec 13). */
export type DecisionRules = {
  intent: Promise<Intent>;
  proposalsOnly: boolean;
};

/**
 * `record_decision` (spec 16a): the moderator records what the team decided, with reasoning and
 * discarded alternatives. On an instruction or an accepted offer the decision is recorded right
 * away, confirmed by the person who asked for it; otherwise it becomes a proposal that someone in
 * the team confirms. Without a value the topic is noted as open. A decided topic stays as it is
 * until a person reopens it.
 */
export function recordDecisionTool(options: {
  decisions: DecisionWriter;
  rules?: DecisionRules;
  /** The person who asked for the run, who confirms a decision recorded directly. */
  actorUserId: string | null;
  /** How the project decides (spec 16b); consensus with confirmation by default. */
  process?: DecisionProcess;
  /** Whether the person who asked is an owner; counts while the owner decides. */
  actorIsOwner?: boolean;
}): AgentTool {
  return defineTool({
    name: 'record_decision',
    description:
      'Records a decision of the team in the decision log: the topic, what was decided, why, and the options that were discarded. Without a value it notes the topic as still open. On an instruction or an accepted offer the decision is recorded right away; otherwise it waits until someone in the team confirms it.',
    input: {
      topic: z
        .string()
        .trim()
        .min(1)
        .max(DECISION_TOPIC_MAX_LENGTH)
        .describe('What the decision is about, in one to three words, e.g. "Canvas"'),
      value: z
        .string()
        .trim()
        .min(1)
        .max(DECISION_VALUE_MAX_LENGTH)
        .optional()
        .describe('What was decided, short, e.g. "React Flow"; leave out for an open topic'),
      reasoning: z
        .string()
        .trim()
        .max(DECISION_REASONING_MAX_LENGTH)
        .optional()
        .describe('Why, in one or two sentences, by the criteria of the team where they apply'),
      alternatives: z
        .array(
          z.object({
            name: z.string().trim().min(1).max(DECISION_TOPIC_MAX_LENGTH),
            note: z.string().trim().max(DECISION_VALUE_MAX_LENGTH).optional(),
          }),
        )
        .max(8)
        .optional()
        .describe('The options that were discarded, each with a short note why'),
    },
    run: async ({ topic, value, reasoning, alternatives }) => {
      const intent = options.rules ? await options.rules.intent : 'instruction';
      const { decisions, pending } = await options.decisions.load();
      const existing = decisions.find((decision) => sameText(decision.topic, topic));
      if (existing?.status === 'decided') {
        return `"${existing.topic}" is decided already: ${existing.value ?? ''}. Nothing changed. Someone in the team has to reopen the decision first, in the overview under "Entscheidungen".`;
      }
      if (value === undefined) {
        const opened = !existing && (await options.decisions.open(topic));
        return opened
          ? `Noted "${topic}" as an open decision.`
          : `"${topic}" is noted as an open decision already.`;
      }
      if (pending.some((operation) => sameText(operation.topic, topic))) {
        return `A decision on "${topic}" waits for confirmation already. Nothing changed.`;
      }
      const process = options.process ?? 'consensus';
      if (process === 'vote') {
        return `This project decides by vote, so nothing was recorded. Start a vote on "${topic}" with start_vote; its result is recorded as the decision.`;
      }

      const operation = decisionOperationSchema.parse({
        op: 'decide',
        topic: existing?.topic ?? topic,
        value,
        reasoning,
        alternatives,
      });
      const outcome = decide({
        allowed: true,
        // Informally, what the team says counts without a confirmation step.
        intent: process === 'informal' && intent === 'question' ? 'instruction' : intent,
        proposalsOnly: options.rules?.proposalsOnly ?? false,
        lockedTarget: false,
      });
      const what = `"${operation.topic}: ${operation.value}"`;
      if (outcome.kind === 'reject') throw new Error('This tool is not allowed for you.');
      if (outcome.kind === 'direct' && process === 'owner' && !options.actorIsOwner) {
        await options.decisions.propose(operation, 'owner_decides');
        return `Proposed the decision ${what}. In this project the owner decides: it is not recorded until an owner confirms it under "Wartet auf dich".`;
      }
      if (outcome.kind === 'direct') {
        const recorded = await options.decisions.decide(operation, options.actorUserId);
        return recorded
          ? `Recorded the decision ${what} in the decision log.`
          : `"${operation.topic}" was decided in the meantime. Nothing changed.`;
      }
      await options.decisions.propose(operation, outcome.reason);
      return `Proposed the decision ${what}. It is not recorded until someone in the team confirms it under "Wartet auf dich".`;
    },
  });
}

/**
 * `compare_options` (spec 16b): the moderator compares two to four options by the project
 * criteria. The comparison shows as a card in its answer and changes nothing, so it runs directly.
 * Strictly neutral, the moderator recommends nothing; a recommendation is dropped then.
 */
export function compareOptionsTool(options: {
  decisions: DecisionWriter;
  stance?: ModeratorStance;
}): AgentTool {
  const name = z.string().trim().min(1).max(COMPARISON_OPTION_MAX_LENGTH);
  return defineTool({
    name: 'compare_options',
    description:
      'Shows a comparison of two to four options as a card in your answer: one row per criterion of the project, with a rating and a short note for every option. Use the criteria of the project; add a row of your own only where they leave out something decisive.',
    input: {
      topic: z
        .string()
        .trim()
        .min(1)
        .max(DECISION_TOPIC_MAX_LENGTH)
        .describe('What is being decided, in one to three words, e.g. "Canvas"'),
      options: z.array(name).min(2).max(4).describe('The names of the options'),
      rows: z
        .array(
          z.object({
            criterion: z.string().trim().min(1).max(CRITERION_MAX_LENGTH),
            ratings: z
              .array(
                z.object({
                  option: name,
                  rating: z
                    .enum(COMPARISON_RATINGS)
                    .describe('good: meets the criterion; ok: partly; bad: does not'),
                  note: z.string().trim().max(120).optional().describe('Why, in a few words'),
                }),
              )
              .describe('One rating per option'),
          }),
        )
        .min(1)
        .max(8),
      recommendation: z
        .object({ option: name, reason: z.string().trim().max(300) })
        .optional()
        .describe('Which option you recommend and why, if your stance allows a recommendation'),
    },
    run: async ({ topic, options: names, rows, recommendation }) => {
      const cellsOf = (row: (typeof rows)[number]) =>
        names.map((option) => {
          const rating = row.ratings.find((entry) => sameText(entry.option, option));
          if (!rating) {
            throw new Error(`The row "${row.criterion}" has no rating for "${option}".`);
          }
          return { rating: rating.rating, note: rating.note ?? '' };
        });
      const recommended = recommendation
        ? names.find((option) => sameText(option, recommendation.option))
        : undefined;
      if (recommendation && !recommended) {
        throw new Error(`"${recommendation.option}" is none of the options.`);
      }
      const strict = options.stance === 'strict';
      const comparison = comparisonSchema.parse({
        topic,
        options: names,
        rows: rows.map((row) => ({ criterion: row.criterion, cells: cellsOf(row) })),
        recommendation:
          recommendation && recommended && !strict
            ? { option: recommended, reason: recommendation.reason }
            : null,
      });
      await options.decisions.compare(comparison);
      return `The comparison of "${topic}" is shown as a card in your answer. Do not repeat it in your text; sum it up in one or two sentences.${
        recommendation && strict
          ? ' Your stance is strictly neutral, so the card shows no recommendation; do not recommend in your text either.'
          : ''
      }`;
    },
  });
}

/**
 * `start_vote` (spec 16b): the moderator starts a vote on a topic. The vote shows as a card in its
 * answer; owners and editors vote there, and the database records the winner as the decision.
 */
export function startVoteTool(options: { decisions: DecisionWriter }): AgentTool {
  return defineTool({
    name: 'start_vote',
    description:
      'Starts a vote of the team on a topic, as a card in your answer with two to five options. Owners and editors vote there; the option with the most votes is recorded as the decision once everyone has voted or an owner ends the vote.',
    input: {
      topic: z
        .string()
        .trim()
        .min(1)
        .max(DECISION_TOPIC_MAX_LENGTH)
        .describe('What is being decided, in one to three words, e.g. "Canvas"'),
      options: z
        .array(z.string().trim().min(1).max(COMPARISON_OPTION_MAX_LENGTH))
        .min(2)
        .max(5)
        .describe('The options to choose from, short, e.g. "React Flow"'),
    },
    run: async ({ topic, options: names }) => {
      const { decisions, votes } = await options.decisions.load();
      const existing = decisions.find((decision) => sameText(decision.topic, topic));
      if (existing?.status === 'decided') {
        return `"${existing.topic}" is decided already: ${existing.value ?? ''}. No vote was started. Someone in the team has to reopen the decision first, in the overview under "Entscheidungen".`;
      }
      if (votes.some((vote) => sameText(vote.topic, topic))) {
        return `A vote on "${topic}" is open already. No second vote was started.`;
      }
      const unique = names.filter(
        (option, index) => names.findIndex((other) => sameText(other, option)) === index,
      );
      if (unique.length < 2) throw new Error('A vote needs at least two different options.');
      const started = await options.decisions.startVote(existing?.topic ?? topic, unique);
      return started
        ? `Started the vote on "${topic}". Its card is shown in your answer; ask the team in one sentence to vote there. The result is recorded as the decision.`
        : 'This answer has a vote already; only one vote per answer.';
    },
  });
}
