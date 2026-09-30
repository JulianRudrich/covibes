import type { Proposal } from '@covibes/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProposalLayer } from '@web/features/proposals/proposal-layer';
import { proposalOverlay } from '@web/features/proposals/proposal-overlay';
import { proposalSummary } from '@web/features/proposals/summary';
import { WaitingForYou } from '@web/features/proposals/waiting-for-you';

const PROJECT = '0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const BOARD = '11111111-1111-4111-8111-111111111111';
const OTHER_BOARD = '12222222-2222-4222-8222-222222222222';
const API = '22222222-2222-4222-8222-222222222222';
const QUEUE = '33333333-3333-4333-8333-333333333333';
const WORKER = '44444444-4444-4444-8444-444444444444';

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    projectId: PROJECT,
    boardId: BOARD,
    agentKey: 'backend',
    status: 'open',
    reason: 'question',
    names: { [API]: 'API' },
    operations: [
      {
        op: 'add_block',
        block: {
          id: QUEUE,
          position: { x: 0, y: 200 },
          label: 'Queue',
          subtitle: 'Jobs',
          blockType: 'service',
          fields: [],
          frameId: null,
        },
      },
      {
        op: 'add_block',
        block: {
          id: WORKER,
          position: { x: 300, y: 200 },
          label: 'Worker',
          subtitle: '',
          blockType: null,
          fields: [],
          frameId: null,
        },
      },
      { op: 'add_edge', edge: { id: 'e1', source: API, target: QUEUE, label: 'Jobs' } },
      { op: 'update_node', id: API, changes: { label: 'Gateway' } },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('proposalOverlay', () => {
  it('shows new elements, arrows to them and the existing elements a proposal changes', () => {
    const overlay = proposalOverlay([proposal()], BOARD, new Set([API]));

    expect(overlay.elements.map((element) => [element.label, element.anchor])).toEqual([
      ['Queue', true],
      ['Worker', false],
    ]);
    // The first element carries the buttons and is taller for them.
    expect(overlay.elements[0]?.size).toEqual({ width: 216, height: 124 });
    expect(overlay.elements[1]?.size).toEqual({ width: 216, height: 86 });
    expect(overlay.arrows).toMatchObject([{ source: API, target: QUEUE, label: 'Jobs' }]);
    expect([...overlay.changed]).toEqual([[API, 'backend']]);
  });

  it('leaves out proposals of other boards and arrows to elements that are gone', () => {
    expect(proposalOverlay([proposal({ boardId: OTHER_BOARD })], BOARD, new Set([API]))).toEqual({
      elements: [],
      arrows: [],
      changed: new Map(),
    });
    const withoutApi = proposalOverlay([proposal()], BOARD, new Set());
    expect(withoutApi.arrows).toEqual([]);
    expect(withoutApi.changed.size).toBe(0);
  });

  it('shows proposed elements where arranging them would put them', () => {
    const arranged = proposal({
      operations: [
        ...proposal().operations.slice(0, 1),
        { op: 'arrange', moves: [{ id: QUEUE, position: { x: 40, y: 60 } }], frame: null },
      ],
    });
    expect(proposalOverlay([arranged], BOARD, new Set()).elements[0]?.position).toEqual({
      x: 40,
      y: 60,
    });
  });
});

describe('proposalSummary', () => {
  it('names the first new block and counts the other changes', () => {
    expect(proposalSummary(proposal())).toEqual({
      main: { key: 'addBlock', values: { name: 'Queue' } },
      more: 3,
      name: 'Queue',
    });
  });

  it('names existing elements by the names stored with the proposal', () => {
    expect(
      proposalSummary(
        proposal({ operations: [{ op: 'update_node', id: API, changes: { label: 'X' } }] }),
      ),
    ).toEqual({ main: { key: 'updateNode', values: { name: 'API' } }, more: 0, name: 'API' });
  });
});

describe('ProposalLayer', () => {
  function renderLayer(canDecide: boolean) {
    const onDecide = vi.fn();
    const open = proposal();
    render(
      <ProposalLayer
        overlay={proposalOverlay([open], BOARD, new Set([API]))}
        rects={new Map([[API, { x: 0, y: 0, width: 180, height: 96 }]])}
        proposals={new Map([[open.id, open]])}
        canDecide={canDecide}
        onDecide={onDecide}
      />,
    );
    return { onDecide, open };
  }

  it('shows the proposal card of the handoff with its buttons on the first new block', () => {
    const { onDecide, open } = renderLayer(true);

    const [queue, worker] = screen.getAllByTestId('proposal-element');
    if (!queue || !worker) throw new Error('The proposed blocks are missing');
    expect(queue).toHaveClass('border-dashed', 'border-agent-backend', 'bg-agent-backend-tint/95');
    expect(within(queue).getByText('Vorschlag · Backend')).toBeInTheDocument();
    expect(within(queue).getByText('Queue')).toBeInTheDocument();
    expect(within(worker).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('proposal-arrow')).toHaveLength(1);
    expect(screen.getByTestId('proposal-changed')).toHaveTextContent('Vorschlag');

    fireEvent.click(within(queue).getByRole('button', { name: 'Übernehmen' }));
    expect(onDecide).toHaveBeenCalledWith(open, 'apply');
    fireEvent.click(within(queue).getByRole('button', { name: 'Verwerfen' }));
    expect(onDecide).toHaveBeenLastCalledWith(open, 'reject');
  });

  it('shows viewers the proposals without buttons', () => {
    renderLayer(false);
    expect(screen.getAllByTestId('proposal-element')).toHaveLength(2);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('WaitingForYou', () => {
  it('counts open proposals, decides them and lists what was decided', () => {
    const onDecide = vi.fn();
    const onOpenBoard = vi.fn();
    const open = proposal();
    const elsewhere = proposal({
      id: '66666666-6666-4666-8666-666666666666',
      boardId: OTHER_BOARD,
    });
    render(
      <WaitingForYou
        proposals={[open, elsewhere]}
        decided={[{ id: 'x', name: 'Cache', status: 'rejected' }]}
        canDecide
        onDecide={onDecide}
        activeBoardId={BOARD}
        onOpenBoard={onOpenBoard}
      />,
    );

    const section = screen.getByRole('region', { name: 'Wartet auf dich' });
    expect(within(section).getByLabelText('2 offen')).toHaveTextContent('2');
    const [first, second] = within(section).getAllByRole('listitem');
    if (!first || !second) throw new Error('The cards are missing');
    expect(first).toHaveTextContent('Backend· Vorschlag');
    expect(first).toHaveTextContent('Block Queue hinzufügen+ 3 weitere Änderungen');
    expect(within(first).getByText('Queue').tagName).toBe('STRONG');

    fireEvent.click(within(first).getByRole('button', { name: 'Übernehmen' }));
    expect(onDecide).toHaveBeenCalledWith(open, 'apply');
    // A proposal of another board opens that board.
    fireEvent.click(within(second).getByRole('button', { name: /Queue/ }));
    expect(onOpenBoard).toHaveBeenCalledWith(OTHER_BOARD);
    expect(section).toHaveTextContent('Cache verworfen');
  });
});
