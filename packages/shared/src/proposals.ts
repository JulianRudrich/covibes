import { z } from 'zod';

import { AGENT_KEYS } from './agents/keys';
import { canvasOperationSchema } from './canvas/operations';

/**
 * Why an agent's change became a proposal (spec 13): the triggering message was a question, the
 * agent acted on its own, the project only takes proposals, or a human was editing the block.
 */
export const PROPOSAL_REASONS = ['question', 'initiative', 'proposals_only', 'locked'] as const;
export type ProposalReason = (typeof PROPOSAL_REASONS)[number];

export const PROPOSAL_STATUSES = ['open', 'applied', 'rejected'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** A proposal of an agent: canvas changes that wait until someone applies or rejects them. */
export const proposalSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  boardId: z.uuid(),
  agentKey: z.enum(AGENT_KEYS),
  status: z.enum(PROPOSAL_STATUSES),
  reason: z.enum(PROPOSAL_REASONS),
  operations: z.array(canvasOperationSchema),
  /** Titles of the existing elements the operations refer to, as they were when proposed. */
  names: z.record(z.string(), z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Proposal = z.output<typeof proposalSchema>;
