import { describe, expect, it } from 'vitest';

import { decisionLinkInputSchema, sameDecisionTarget } from './decision-links';

const ID = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
describe('decision link identities', () => {
  it('keeps equal node IDs on different boards and task IDs distinct', () => {
    const a = { kind: 'block' as const, boardId: ID, id: ID };
    expect(sameDecisionTarget(a, { ...a })).toBe(true);
    expect(sameDecisionTarget(a, { ...a, boardId: OTHER })).toBe(false);
    expect(sameDecisionTarget(a, { kind: 'task', id: ID })).toBe(false);
  });
  it('requires stable UUID identities and board scope for a block', () => {
    expect(
      decisionLinkInputSchema.safeParse({ decisionId: ID, target: { kind: 'block', id: ID } })
        .success,
    ).toBe(false);
    expect(
      decisionLinkInputSchema.safeParse({ decisionId: ID, target: { kind: 'task', id: OTHER } })
        .success,
    ).toBe(true);
  });
});
