import { describe, expect, it } from 'vitest';

import { applyProposalInputSchema, variantLetter, variantsOperationSchema } from './decisions';
import { proposalSchema } from './proposals';

const BOARD = '11111111-1111-4111-8111-111111111111';
const FRAME = '22222222-2222-4222-8222-222222222222';

function variant(name: string) {
  return {
    name,
    operations: [{ op: 'add_frame', frame: { id: FRAME, position: { x: 0, y: 0 }, title: name } }],
  };
}

describe('variants (spec 17)', () => {
  it('letters variants by their position', () => {
    expect([0, 1, 2].map(variantLetter)).toEqual(['A', 'B', 'C']);
  });

  it('takes two or three variants for a topic and fills in what is optional', () => {
    const operation = variantsOperationSchema.parse({
      op: 'variants',
      topic: ' Architektur ',
      variants: [variant('Monolith'), variant('Microservices')],
    });
    expect(operation.topic).toBe('Architektur');
    expect(operation.variants[0]).toMatchObject({ name: 'Monolith', summary: '' });
    expect(operation.variants[0]?.operations[0]).toMatchObject({ op: 'add_frame', members: [] });

    const one = { op: 'variants', topic: 'Architektur', variants: [variant('Monolith')] };
    expect(variantsOperationSchema.safeParse(one).success).toBe(false);
    const four = { ...one, variants: ['A', 'B', 'C', 'D'].map(variant) };
    expect(variantsOperationSchema.safeParse(four).success).toBe(false);
  });

  it('is a proposal on a board', () => {
    const proposal = {
      id: '33333333-3333-4333-8333-333333333333',
      projectId: '44444444-4444-4444-8444-444444444444',
      kind: 'variants',
      boardId: BOARD,
      agentKey: 'moderator',
      status: 'open',
      reason: 'variants',
      names: {},
      operations: [
        { op: 'variants', topic: 'Architektur', variants: [variant('A'), variant('B')] },
      ],
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
    };
    expect(proposalSchema.safeParse(proposal).success).toBe(true);
    expect(proposalSchema.safeParse({ ...proposal, boardId: null }).success).toBe(false);
    expect(proposalSchema.safeParse({ ...proposal, operations: [] }).success).toBe(false);
  });

  it('names the variant to adopt by its position', () => {
    expect(applyProposalInputSchema.parse({})).toEqual({});
    expect(applyProposalInputSchema.parse({ variant: 2 })).toEqual({ variant: 2 });
    expect(applyProposalInputSchema.safeParse({ variant: 3 }).success).toBe(false);
    expect(applyProposalInputSchema.safeParse({ variant: 0.5 }).success).toBe(false);
  });
});
