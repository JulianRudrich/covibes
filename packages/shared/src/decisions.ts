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
  /** The comparison the decision followed, if the moderator made one for the topic (spec 16b). */
  comparison: Comparison | null;
  /** The result of the vote that decided, if a vote did. */
  tally: VoteTally | null;
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
  /** The result of the vote that decided (spec 16b). */
  votes: z.array(z.object({ name: z.string(), votes: z.number().int() })).optional(),
  /** The decision followed a comparison of the moderator. */
  compared: z.boolean().optional(),
  user: z.string().nullable(),
  agentKey: z.enum(AGENT_KEYS).nullable(),
  createdAt: z.string(),
});
export type DecisionLogEntry = z.infer<typeof decisionLogEntrySchema>;

// Comparisons and votes (spec 16b) ---------------------------------------------------------------

/** How well an option meets a criterion. */
export const COMPARISON_RATINGS = ['good', 'ok', 'bad'] as const;
export type ComparisonRating = (typeof COMPARISON_RATINGS)[number];

export const COMPARISON_OPTION_MAX_LENGTH = 60;

const optionNameSchema = z.string().trim().min(1).max(COMPARISON_OPTION_MAX_LENGTH);

/**
 * The moderator's comparison of two to four options by the project criteria: one row per
 * criterion with a rating and a short note per option, in the order of `options`. The
 * recommendation depends on the moderator's stance and may be missing.
 */
export const comparisonSchema = z
  .object({
    topic: z.string().trim().min(1).max(DECISION_TOPIC_MAX_LENGTH),
    options: z.array(optionNameSchema).min(2).max(4),
    rows: z
      .array(
        z.object({
          criterion: z.string().trim().min(1).max(CRITERION_MAX_LENGTH),
          cells: z.array(
            z.object({
              rating: z.enum(COMPARISON_RATINGS),
              note: z.string().trim().max(120).default(''),
            }),
          ),
        }),
      )
      .min(1)
      .max(8),
    recommendation: z
      .object({ option: optionNameSchema, reason: z.string().trim().max(300).default('') })
      .nullable()
      .default(null),
  })
  .refine((comparison) =>
    comparison.rows.every((row) => row.cells.length === comparison.options.length),
  );
export type Comparison = z.output<typeof comparisonSchema>;

/** The result of a vote: the votes per option, in the order of the options. */
export const voteTallySchema = z.array(z.object({ name: z.string(), votes: z.number().int() }));
export type VoteTally = z.infer<typeof voteTallySchema>;

export const VOTE_STATUSES = ['open', 'closed'] as const;
export type VoteStatus = (typeof VOTE_STATUSES)[number];

/**
 * A vote that a moderator message carries: owners and editors pick one option; who voted for what
 * is visible. `winner` is the option with the most votes once the vote is closed, or null after a
 * tie.
 */
export const messageVoteSchema = z.object({
  id: z.uuid(),
  topic: z.string(),
  options: z.array(z.string()).min(2).max(5),
  status: z.enum(VOTE_STATUSES),
  winner: z.string().nullable(),
  ballots: z.array(z.object({ userId: z.string(), option: z.number().int() })),
});
export type MessageVote = z.infer<typeof messageVoteSchema>;

/** `POST /api/projects/:projectId/votes/:voteId/cast`: the position of the chosen option. */
export const castVoteInputSchema = z.object({ option: z.number().int().min(0).max(4) });
export type CastVoteInput = z.infer<typeof castVoteInputSchema>;
