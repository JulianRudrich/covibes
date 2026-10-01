import { z } from 'zod';

import { AGENT_KEYS } from './agents/keys';

// Criteria, decisions and the decision log (spec 16a). The limits match the check constraints of
// migration 0009.

export const CRITERION_MAX_LENGTH = 80;
/** A project has at most this many criteria. */
export const MAX_CRITERIA_PER_PROJECT = 20;

export const criterionTextSchema = z.string().trim().min(1).max(CRITERION_MAX_LENGTH);

/** `POST /api/projects/:projectId/criteria` and `PATCH …/criteria/:criterionId`. */
export const criterionInputSchema = z.object({ text: criterionTextSchema });
export type CriterionInput = z.infer<typeof criterionInputSchema>;

/** A project criterion: a short text the agents assess by, e.g. "EU-Hosting". */
export type Criterion = { id: string; text: string };

export const DECISION_TOPIC_MAX_LENGTH = 80;
export const DECISION_VALUE_MAX_LENGTH = 200;
export const DECISION_REASONING_MAX_LENGTH = 2000;
export const REOPEN_REASON_MAX_LENGTH = 500;

/** An option the team discarded, with a short note why. */
export const decisionAlternativeSchema = z.object({
  name: z.string().trim().min(1).max(DECISION_TOPIC_MAX_LENGTH),
  note: z.string().trim().max(DECISION_VALUE_MAX_LENGTH).default(''),
});
export type DecisionAlternative = z.output<typeof decisionAlternativeSchema>;

/** Recording a decision: what a `decision` proposal holds until someone confirms it. */
export const decisionOperationSchema = z.object({
  op: z.literal('decide'),
  topic: z.string().trim().min(1).max(DECISION_TOPIC_MAX_LENGTH),
  value: z.string().trim().min(1).max(DECISION_VALUE_MAX_LENGTH),
  reasoning: z.string().trim().max(DECISION_REASONING_MAX_LENGTH).default(''),
  alternatives: z.array(decisionAlternativeSchema).max(8).default([]),
});
export type DecisionOperation = z.output<typeof decisionOperationSchema>;

export const DECISION_STATUSES = ['open', 'decided'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/**
 * A decision of the project (`GET /api/projects/:projectId/decisions`): a topic that is open or
 * decided. `decidedBy` is the name of the person who confirmed it.
 */
export type Decision = {
  id: string;
  topic: string;
  status: DecisionStatus;
  value: string | null;
  reasoning: string;
  alternatives: DecisionAlternative[];
  decidedBy: string | null;
  decidedAt: string | null;
  /** Why the decision is open again, if it was decided before. */
  reopenReason: string | null;
};

/** `POST /api/projects/:projectId/decisions/:decisionId/reopen`. */
export const reopenDecisionInputSchema = z.object({
  reason: z.string().trim().min(1).max(REOPEN_REASON_MAX_LENGTH),
});
export type ReopenDecisionInput = z.infer<typeof reopenDecisionInputSchema>;

export const DECISION_LOG_KINDS = [
  'decided',
  'reopened',
  'opened',
  'criterion_added',
  'criterion_changed',
  'criterion_removed',
] as const;
export type DecisionLogKind = (typeof DECISION_LOG_KINDS)[number];

/**
 * An entry of the decision log (`GET /api/projects/:projectId/decisions/log`, newest first).
 * `value` is the decision's value (for `reopened` the one that was reopened) or the criterion's
 * text. `user` confirmed, reopened or changed it; `agentKey` recorded it.
 */
export const decisionLogEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(DECISION_LOG_KINDS),
  decisionId: z.string().nullable(),
  topic: z.string().nullable(),
  value: z.string().nullable(),
  reasoning: z.string().optional(),
  alternatives: z.array(decisionAlternativeSchema).optional(),
  /** Why a decision was reopened. */
  reason: z.string().optional(),
  /** The text of a criterion before it was changed. */
  previous: z.string().optional(),
  user: z.string().nullable(),
  agentKey: z.enum(AGENT_KEYS).nullable(),
  createdAt: z.string(),
});
export type DecisionLogEntry = z.infer<typeof decisionLogEntrySchema>;
