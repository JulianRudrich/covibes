import {
  CRITERION_MAX_LENGTH,
  DECISION_REASONING_MAX_LENGTH,
  DECISION_TOPIC_MAX_LENGTH,
  DECISION_VALUE_MAX_LENGTH,
  decisionOperationSchema,
  MAX_CRITERIA_PER_PROJECT,
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

      const operation = decisionOperationSchema.parse({
        op: 'decide',
        topic: existing?.topic ?? topic,
        value,
        reasoning,
        alternatives,
      });
      const outcome = decide({
        allowed: true,
        intent,
        proposalsOnly: options.rules?.proposalsOnly ?? false,
        lockedTarget: false,
      });
      const what = `"${operation.topic}: ${operation.value}"`;
      if (outcome.kind === 'reject') throw new Error('This tool is not allowed for you.');
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
