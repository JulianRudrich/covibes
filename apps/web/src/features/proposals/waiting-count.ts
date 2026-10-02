import type { HandRaise, OpenVote, Proposal } from '@covibes/shared';

/**
 * How much waits for the user in the open project (spec 22a): what they can act on. Nothing for
 * viewers, and no decisions or variants for editors while only the owner decides.
 */
export function waitingCount({
  proposals,
  hands,
  votes,
  canDecide,
  canConfirmDecisions,
}: {
  proposals: readonly Proposal[];
  hands: readonly HandRaise[];
  votes: readonly OpenVote[];
  canDecide: boolean;
  canConfirmDecisions: boolean;
}): number {
  if (!canDecide) return 0;
  return (
    proposals.filter(
      (proposal) =>
        canConfirmDecisions || (proposal.kind !== 'decision' && proposal.kind !== 'variants'),
    ).length +
    hands.length +
    votes.length
  );
}
