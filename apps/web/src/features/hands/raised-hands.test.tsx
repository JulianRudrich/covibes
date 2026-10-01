import type { HandRaise } from '@covibes/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@web/components/ui/tooltip';
import { RaisedHands } from '@web/features/hands/raised-hands';

const PROJECT = '0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';

function hand(overrides: Partial<HandRaise> = {}): HandRaise {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    projectId: PROJECT,
    agentKey: 'critic',
    reason: 'Einwand zu den Kosten',
    createdAt: '2026-09-30T12:00:00.000Z',
    ...overrides,
  };
}

const SECURITY = hand({
  id: '22222222-2222-4222-8222-222222222222',
  agentKey: 'security',
  reason: 'Welche Daten gehen an externe KI-Anbieter?',
});

function renderHands(hands: HandRaise[], onDecide?: () => void) {
  render(
    <TooltipProvider>
      <RaisedHands hands={hands} onDecide={onDecide} />
    </TooltipProvider>,
  );
}

describe('RaisedHands', () => {
  it('shows each raised hand in its agent colors, as in the handoff', () => {
    renderHands([hand(), SECURITY], vi.fn());

    const [critic, security] = within(
      screen.getByRole('list', { name: 'Handzeichen' }),
    ).getAllByRole('listitem');
    if (!critic || !security) throw new Error('The cards are missing');
    expect(critic).toHaveTextContent('Kritiker meldet sich – Einwand zu den Kosten');
    expect(critic).toHaveClass('border-agent-critic-border', 'bg-agent-critic-tint-2');
    expect(within(critic).getByText('Kritiker meldet sich')).toHaveClass('text-agent-critic-dark');
    expect(within(critic).getByRole('button', { name: 'Anhören' })).toHaveClass(
      'border-agent-critic-border-2',
      'text-agent-critic-dark',
    );
    // Agents without a second tint use their only one.
    expect(security).toHaveClass('border-agent-security-border', 'bg-agent-security-tint');
  });

  it('lets owners and editors listen or dismiss', () => {
    const onDecide = vi.fn();
    renderHands([hand(), SECURITY], onDecide);

    fireEvent.click(screen.getAllByRole('button', { name: 'Anhören' })[0] as HTMLElement);
    expect(onDecide).toHaveBeenCalledWith(hand(), 'listen');
    fireEvent.click(screen.getByRole('button', { name: 'Sicherheit: nicht jetzt' }));
    expect(onDecide).toHaveBeenCalledWith(SECURITY, 'dismiss');
  });

  it('only shows the cards to viewers', () => {
    renderHands([hand()]);
    expect(screen.getByRole('listitem')).toHaveTextContent('Kritiker meldet sich');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders nothing without raised hands', () => {
    const { container } = render(<RaisedHands hands={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
