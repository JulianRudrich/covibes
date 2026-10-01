import { z } from 'zod';

import { AGENT_KEYS } from './agents/keys';
import { canvasOperationSchema } from './canvas/operations';
import { decisionOperationSchema } from './decisions';

/**
 * Why an agent's change became a proposal (spec 13): the triggering message was a question, the
 * agent acted on its own, the project only takes proposals, or a human was editing the block.
 */
export const PROPOSAL_REASONS = ['question', 'initiative', 'proposals_only', 'locked'] as const;
export type ProposalReason = (typeof PROPOSAL_REASONS)[number];

export const PROPOSAL_STATUSES = ['open', 'applied', 'rejected'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_KINDS = ['canvas', 'team', 'decision'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/** A change of the project's team (spec 14): the moderator proposes a specialist. */
export const teamOperationSchema = z.object({
  op: z.literal('add_agent'),
  agentKey: z.enum(AGENT_KEYS),
  /** Why the agent fits the project, in one line. */
  reason: z.string().max(200).default(''),
});
export type TeamOperation = z.output<typeof teamOperationSchema>;

const proposalFields = {
  id: z.uuid(),
  projectId: z.uuid(),
  agentKey: z.enum(AGENT_KEYS),
  status: z.enum(PROPOSAL_STATUSES),
  reason: z.enum(PROPOSAL_REASONS),
  /** Titles of the existing elements the operations refer to, as they were when proposed. */
  names: z.record(z.string(), z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
};

/**
 * A proposal of an agent that waits until someone applies or rejects it: canvas changes on a board
 * (spec 13), additions to the team (spec 14) or a decision to confirm (spec 16a).
 */
export const proposalSchema = z.discriminatedUnion('kind', [
  z.object({
    ...proposalFields,
    kind: z.literal('canvas'),
    boardId: z.uuid(),
    operations: z.array(canvasOperationSchema),
  }),
  z.object({
    ...proposalFields,
    kind: z.literal('team'),
    boardId: z.null(),
    operations: z.array(teamOperationSchema),
  }),
  z.object({
    ...proposalFields,
    kind: z.literal('decision'),
    boardId: z.null(),
    operations: z.array(decisionOperationSchema),
  }),
]);
export type Proposal = z.output<typeof proposalSchema>;
export type CanvasProposal = Extract<Proposal, { kind: 'canvas' }>;
export type TeamProposal = Extract<Proposal, { kind: 'team' }>;
export type DecisionProposal = Extract<Proposal, { kind: 'decision' }>;
