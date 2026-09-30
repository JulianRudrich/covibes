import type { ProposalReason } from '@covibes/shared';

/**
 * What the triggering message asks for (spec 13): a clear instruction to change something, or a
 * question (or discussion). Runs an agent starts itself (the observer, spec 15) are own initiative.
 */
export type Intent = 'instruction' | 'question' | 'initiative';

export type Outcome =
  { kind: 'direct' } | { kind: 'proposal'; reason: ProposalReason } | { kind: 'reject' };

/**
 * The rule engine (`architecture.md`, "Rule engine") for one tool call of an agent. The agent's
 * instructions never reach this function, so they cannot change its table.
 */
export function decide(situation: {
  /** The agent may use this tool at all. */
  allowed: boolean;
  intent: Intent;
  /** The project takes even instructions as proposals only. */
  proposalsOnly: boolean;
  /** The element the tool changes is being edited by a human. */
  lockedTarget: boolean;
}): Outcome {
  if (!situation.allowed) return { kind: 'reject' };
  if (situation.intent === 'question') return { kind: 'proposal', reason: 'question' };
  if (situation.intent === 'initiative') return { kind: 'proposal', reason: 'initiative' };
  if (situation.proposalsOnly) return { kind: 'proposal', reason: 'proposals_only' };
  if (situation.lockedTarget) return { kind: 'proposal', reason: 'locked' };
  return { kind: 'direct' };
}
