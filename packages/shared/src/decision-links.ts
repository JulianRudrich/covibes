import { z } from 'zod';

export const MAX_DECISION_LINKS = 1000;

export const decisionLinkTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('block'), boardId: z.uuid(), id: z.uuid() }),
  z.object({ kind: z.literal('task'), id: z.uuid() }),
]);
export type DecisionLinkTarget = z.infer<typeof decisionLinkTargetSchema>;

export const decisionLinkInputSchema = z.object({
  decisionId: z.uuid(),
  target: decisionLinkTargetSchema,
});
export type DecisionLinkInput = z.infer<typeof decisionLinkInputSchema>;

export const decisionLinkTargetQuerySchema = z.object({
  q: z.string().trim().max(200).default(''),
});

/** Identity remains navigable after a rename; the label is resolved from the current document. */
export type DecisionLinkCandidate = {
  target: DecisionLinkTarget;
  label: string;
  context: string;
};
export type DecisionLink = DecisionLinkCandidate & {
  id: string;
  decisionId: string;
  topic: string;
  status: 'open' | 'decided';
  available: boolean;
};

/** Compare identities without confusing the same node UUID on two different boards. */
export function sameDecisionTarget(a: DecisionLinkTarget, b: DecisionLinkTarget): boolean {
  return (
    a.kind === b.kind &&
    a.id === b.id &&
    (a.kind !== 'block' || b.kind !== 'block' || a.boardId === b.boardId)
  );
}
