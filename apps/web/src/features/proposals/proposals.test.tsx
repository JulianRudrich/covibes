import type {
  CanvasProposal,
  DecisionProposal,
  Proposal,
  TeamProposal,
  VariantsProposal,
} from '@covibes/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProposalLayer } from '@web/features/proposals/proposal-layer';
import { proposalOverlay } from '@web/features/proposals/proposal-overlay';
import { proposalSummary } from '@web/features/proposals/summary';
import { WaitingForYou } from '@web/features/proposals/waiting-for-you';
import { VARIANTS } from '@web/features/proposals/variants-fixture';

const PROJECT = '0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const BOARD = '11111111-1111-4111-8111-111111111111';
const OTHER_BOARD = '12222222-2222-4222-8222-222222222222';
const API = '22222222-2222-4222-8222-222222222222';
const QUEUE = '33333333-3333-4333-8333-333333333333';
const WORKER = '44444444-4444-4444-8444-444444444444';

function proposal(overrides: Partial<CanvasProposal> = {}): CanvasProposal {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    projectId: PROJECT,
    kind: 'canvas',
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

function teamProposal(): TeamProposal {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    projectId: PROJECT,
    kind: 'team',
    boardId: null,
    agentKey: 'moderator',
    status: 'open',
    reason: 'initiative',
    names: {},
    operations: [
      { op: 'add_agent', agentKey: 'critic', reason: 'Findet Risiken früh.' },
      { op: 'add_agent', agentKey: 'security', reason: '' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('team proposals (spec 14)', () => {
  it('leave the canvas alone', () => {
    const proposals: Proposal[] = [teamProposal(), proposal()];
    const overlay = proposalOverlay(proposals, BOARD, new Set([API]));
    expect(overlay.elements.every((element) => element.proposalId === proposal().id)).toBe(true);
  });

  it('show the agents to add with their reasons under "Wartet auf dich"', () => {
    const onDecide = vi.fn();
    const team = teamProposal();
    render(
      <WaitingForYou
        proposals={[team]}
        decided={[{ id: 'y', name: '', agents: ['data', 'ml'], status: 'applied' }]}
        canDecide
        onDecide={onDecide}
        activeBoardId={BOARD}
        onOpenBoard={vi.fn()}
      />,
    );

    const section = screen.getByRole('region', { name: 'Wartet auf dich' });
    const [card] = within(section).getAllByRole('listitem');
    if (!card) throw new Error('The card is missing');
    expect(card).toHaveTextContent('Moderator· Vorschlag');
    expect(card).toHaveTextContent('Ins Team holen');
    expect(card).toHaveTextContent('Kritiker · Findet Risiken früh.');
    expect(within(card).getByText('Sicherheit').tagName).toBe('STRONG');
    fireEvent.click(within(card).getByRole('button', { name: 'Übernehmen' }));
    expect(onDecide).toHaveBeenCalledWith(team, 'apply');
    expect(section).toHaveTextContent('Daten und ML übernommen');
  });
});

describe('decision proposals (spec 16a)', () => {
  const decision: DecisionProposal = {
    id: '88888888-8888-4888-8888-888888888888',
    projectId: PROJECT,
    kind: 'decision',
    boardId: null,
    agentKey: 'moderator',
    status: 'open',
    reason: 'question',
    names: {},
    operations: [
      {
        op: 'decide',
        topic: 'Canvas',
        value: 'React Flow',
        reasoning: 'Strukturierte Blöcke, MIT-Lizenz',
        alternatives: [{ name: 'tldraw', note: 'Lizenz' }],
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('leave the canvas alone', () => {
    expect(proposalOverlay([decision], BOARD, new Set()).elements).toEqual([]);
  });

  it('wait for the owner while the owner decides (spec 16b)', () => {
    render(
      <WaitingForYou
        proposals={[decision]}
        decided={[]}
        canDecide
        canConfirmDecisions={false}
        onDecide={vi.fn()}
        activeBoardId={BOARD}
        onOpenBoard={vi.fn()}
      />,
    );
    const section = screen.getByRole('region', { name: 'Wartet auf dich' });
    expect(section).toHaveTextContent('Der Owner entscheidet.');
    expect(within(section).queryByRole('button')).toBeNull();
  });

  it('wait under "Wartet auf dich" until someone confirms them', () => {
    const onDecide = vi.fn();
    render(
      <WaitingForYou
        proposals={[decision]}
        decided={[
          { id: 'z', name: 'Backend: Hono', decision: true, status: 'applied' },
          { id: 'q', name: 'Hosting: Frankfurt', decision: true, status: 'rejected' },
        ]}
        canDecide
        onDecide={onDecide}
        activeBoardId={BOARD}
        onOpenBoard={vi.fn()}
      />,
    );

    const section = screen.getByRole('region', { name: 'Wartet auf dich' });
    const [card] = within(section).getAllByRole('listitem');
    if (!card) throw new Error('The card is missing');
    expect(card).toHaveTextContent('Moderator· Entscheidung');
    expect(card).toHaveTextContent('Canvas: React Flow');
    expect(card).toHaveTextContent('Strukturierte Blöcke, MIT-Lizenz');
    expect(within(card).getByText('Canvas').tagName).toBe('STRONG');
    fireEvent.click(within(card).getByRole('button', { name: 'Bestätigen' }));
    expect(onDecide).toHaveBeenCalledWith(decision, 'apply');
    fireEvent.click(within(card).getByRole('button', { name: 'Verwerfen' }));
    expect(onDecide).toHaveBeenCalledWith(decision, 'reject');
    expect(section).toHaveTextContent('Backend: Hono bestätigt');
    expect(section).toHaveTextContent('Hosting: Frankfurt verworfen');
  });
});

describe('raised hands and votes under "Wartet auf dich" (spec 22a)', () => {
  const hand = {
    id: '99999999-9999-4999-8999-999999999999',
    projectId: PROJECT,
    agentKey: 'critic' as const,
    reason: 'Einwand zu den Kosten',
    createdAt: new Date().toISOString(),
  };
  const vote = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    messageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    topic: 'Hosting',
    options: ['Eigener Server', 'Verwalteter Dienst'],
    status: 'open' as const,
    winner: null,
    ballots: [{ userId: 'someone', option: 0 }],
    createdAt: new Date().toISOString(),
  };

  it('wait with their buttons and count like proposals', () => {
    const onHand = vi.fn();
    const onVote = vi.fn();
    render(
      <WaitingForYou
        proposals={[proposal()]}
        decided={[]}
        canDecide
        onDecide={vi.fn()}
        activeBoardId={BOARD}
        onOpenBoard={vi.fn()}
        hands={[hand]}
        onHand={onHand}
        votes={[vote]}
        onVote={onVote}
        voters={3}
      />,
    );

    const section = screen.getByRole('region', { name: 'Wartet auf dich' });
    expect(within(section).getByLabelText('3 offen')).toHaveTextContent('3');
    const [, handCard, voteCard] = within(section).getAllByRole('listitem');
    if (!handCard || !voteCard) throw new Error('The cards are missing');

    expect(handCard).toHaveTextContent('Kritiker· Handzeichen');
    expect(handCard).toHaveTextContent('Einwand zu den Kosten');
    fireEvent.click(within(handCard).getByRole('button', { name: 'Anhören' }));
    expect(onHand).toHaveBeenCalledWith(hand, 'listen');
    fireEvent.click(within(handCard).getByRole('button', { name: 'Nicht jetzt' }));
    expect(onHand).toHaveBeenCalledWith(hand, 'dismiss');

    expect(voteCard).toHaveTextContent('Moderator· Abstimmung');
    expect(voteCard).toHaveTextContent('Hosting');
    expect(voteCard).toHaveTextContent('1 von 3 haben abgestimmt');
    fireEvent.click(
      within(voteCard).getByRole('button', { name: 'Für Verwalteter Dienst stimmen' }),
    );
    expect(onVote).toHaveBeenCalledWith(vote, 1);
  });

  it('count only what the reader can act on', () => {
    const decision: DecisionProposal = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      projectId: PROJECT,
      kind: 'decision',
      boardId: null,
      agentKey: 'moderator',
      status: 'open',
      reason: 'owner_decides',
      names: {},
      operations: [
        { op: 'decide', topic: 'Canvas', value: 'React Flow', reasoning: '', alternatives: [] },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const props = {
      proposals: [proposal(), decision],
      decided: [],
      onDecide: vi.fn(),
      activeBoardId: BOARD,
      onOpenBoard: vi.fn(),
      hands: [hand],
      onHand: vi.fn(),
    };

    // While the owner decides, the decision does not wait for an editor.
    const { rerender } = render(<WaitingForYou {...props} canDecide canConfirmDecisions={false} />);
    const section = screen.getByRole('region', { name: 'Wartet auf dich' });
    expect(within(section).getByLabelText('2 offen')).toBeInTheDocument();
    expect(within(section).getAllByRole('listitem')).toHaveLength(3);

    rerender(<WaitingForYou {...props} canDecide />);
    expect(within(section).getByLabelText('3 offen')).toBeInTheDocument();

    // Nothing waits for someone who only reads, and nothing can be decided.
    rerender(<WaitingForYou {...props} canDecide={false} />);
    expect(within(section).getByLabelText('0 offen')).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Anhören' })).not.toBeInTheDocument();
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

describe('variants (spec 17)', () => {
  const variants: VariantsProposal = {
    id: '99999999-9999-4999-8999-999999999999',
    projectId: PROJECT,
    kind: 'variants',
    boardId: BOARD,
    agentKey: 'moderator',
    status: 'open',
    reason: 'variants',
    names: {},
    operations: [{ op: 'variants', topic: 'Architektur', variants: VARIANTS }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  function renderLayer(canAdoptVariants: boolean) {
    const onDecide = vi.fn();
    render(
      <ProposalLayer
        overlay={proposalOverlay([variants], BOARD, new Set())}
        rects={new Map()}
        proposals={new Map([[variants.id, variants]])}
        canDecide
        canAdoptVariants={canAdoptVariants}
        onDecide={onDecide}
      />,
    );
    return { onDecide };
  }

  function renderWaiting(props: Partial<Parameters<typeof WaitingForYou>[0]> = {}) {
    const onDecide = vi.fn();
    const onOpenBoard = vi.fn();
    render(
      <WaitingForYou
        proposals={[variants]}
        decided={[]}
        canDecide
        onDecide={onDecide}
        activeBoardId={BOARD}
        onOpenBoard={onOpenBoard}
        {...props}
      />,
    );
    const [card] = within(screen.getByRole('region', { name: 'Wartet auf dich' })).getAllByRole(
      'listitem',
    );
    if (!card) throw new Error('The card is missing');
    return { onDecide, onOpenBoard, card };
  }

  it('draw every variant on its own, each with its frame as the anchor', () => {
    const overlay = proposalOverlay([variants], BOARD, new Set());

    expect(
      overlay.elements.map((element) => [element.label, element.anchor, element.variant]),
    ).toEqual([
      ['Architektur: Monolith', true, { position: 0, name: 'Monolith' }],
      ['App', false, { position: 0, name: 'Monolith' }],
      ['Datenbank', false, { position: 0, name: 'Monolith' }],
      ['Architektur: Microservices', true, { position: 1, name: 'Microservices' }],
      ['Gateway', false, { position: 1, name: 'Microservices' }],
    ]);
    expect(overlay.arrows).toHaveLength(1);
    // Variants of another board stay there.
    expect(proposalOverlay([variants], OTHER_BOARD, new Set()).elements).toEqual([]);
  });

  it('head each variant with its letter and name and adopt it with one button', () => {
    const { onDecide } = renderLayer(true);

    const elements = screen.getAllByTestId('proposal-element');
    const [monolith, , , microservices] = elements;
    if (!monolith || !microservices) throw new Error('The variants are missing');
    expect(elements).toHaveLength(5);
    expect(monolith).toHaveClass('border-dashed');
    expect(monolith).toHaveTextContent('Variante A · Monolith');
    expect(monolith).not.toHaveTextContent('Architektur');
    expect(microservices).toHaveTextContent('Variante B · Microservices');
    // All variants are rejected at once in the overview, not on the canvas.
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Übernehmen',
      'Übernehmen',
    ]);

    fireEvent.click(within(microservices).getByRole('button', { name: 'Übernehmen' }));
    expect(onDecide).toHaveBeenCalledWith(variants, 'apply', 1);
    fireEvent.click(within(monolith).getByRole('button', { name: 'Übernehmen' }));
    expect(onDecide).toHaveBeenLastCalledWith(variants, 'apply', 0);
  });

  it('show the variants without a button to those who do not decide', () => {
    renderLayer(false);
    expect(screen.getAllByTestId('proposal-element')).toHaveLength(5);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('wait under "Wartet auf dich" with a preview and a button per variant', () => {
    const { onDecide, card } = renderWaiting();

    expect(card).toHaveTextContent('Moderator· Varianten');
    expect(card).toHaveTextContent('Architektur');
    expect(card).toHaveTextContent('Variante A · Monolith – Ein Deployment, wenig Betrieb.');
    // The avatar of the agent is an image, too.
    const previews = within(card)
      .getAllByRole('img')
      .filter((image) => image.tagName === 'svg');
    expect(previews.map((preview) => preview.getAttribute('aria-label'))).toEqual([
      'Variante A · Monolith',
      'Variante B · Microservices',
    ]);
    // The preview shows the blocks and the arrow of the variant.
    expect(previews[0]).toHaveTextContent('AppDatenbank');
    expect(previews[0]?.querySelectorAll('path')).toHaveLength(1);

    fireEvent.click(within(card).getByRole('button', { name: 'B übernehmen' }));
    expect(onDecide).toHaveBeenCalledWith(variants, 'apply', 1);
    fireEvent.click(within(card).getByRole('button', { name: 'A übernehmen' }));
    expect(onDecide).toHaveBeenLastCalledWith(variants, 'apply', 0);
    fireEvent.click(within(card).getByRole('button', { name: 'Verwerfen' }));
    expect(onDecide).toHaveBeenLastCalledWith(variants, 'reject');
  });

  it('wait for the owner while the owner decides, and open their board from elsewhere', () => {
    const { card, onOpenBoard } = renderWaiting({
      canConfirmDecisions: false,
      activeBoardId: OTHER_BOARD,
    });

    expect(card).toHaveTextContent('Der Owner entscheidet.');
    expect(within(card).queryByRole('button', { name: /übernehmen/ })).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Architektur' }));
    expect(onOpenBoard).toHaveBeenCalledWith(BOARD);
  });
});

describe('suggestions for the plan under "Wartet auf dich" (spec 25b)', () => {
  function renderWaiting(props: Partial<Parameters<typeof WaitingForYou>[0]> = {}) {
    const onOpenPlan = vi.fn();
    render(
      <WaitingForYou
        proposals={[]}
        decided={[]}
        canDecide
        onDecide={vi.fn()}
        activeBoardId={null}
        onOpenBoard={vi.fn()}
        planSuggestions={5}
        onOpenPlan={onOpenPlan}
        {...props}
      />,
    );
    return { onOpenPlan, section: screen.getByRole('region', { name: 'Wartet auf dich' }) };
  }

  it('wait as one card that opens the plan, and count one by one', () => {
    const { onOpenPlan, section } = renderWaiting();

    expect(within(section).getByLabelText('5 offen')).toHaveTextContent('5');
    expect(section).toHaveTextContent('Moderator· Projektplan');
    expect(section).toHaveTextContent('5 Abschnitte für den Projektplan warten auf dich.');
    fireEvent.click(within(section).getByRole('button', { name: 'Plan öffnen' }));
    expect(onOpenPlan).toHaveBeenCalledTimes(1);
  });

  it('need no button while the plan is open, and use the singular', () => {
    const { section } = renderWaiting({ planSuggestions: 1, onOpenPlan: undefined });

    expect(section).toHaveTextContent('1 Abschnitt für den Projektplan wartet auf dich.');
    expect(within(section).queryByRole('button')).not.toBeInTheDocument();
  });
});
