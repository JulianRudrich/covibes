import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PhaseIndicator } from './phase-indicator';

describe('PhaseIndicator', () => {
  it('marks only the active phase as the current step', () => {
    render(<PhaseIndicator active="architecture" />);
    const nav = screen.getByRole('navigation', { name: 'Phasen' });

    const current = nav.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName('Architektur: Aktuelle Phase');
  });

  it('shows the step, the phase, a segment per phase and what comes next (spec 36b)', () => {
    render(<PhaseIndicator active="architecture" />);
    const nav = screen.getByRole('navigation', { name: 'Phasen' });

    expect(nav).toHaveTextContent('Schritt 3 von 4Architektur');
    expect(nav).toHaveTextContent('Danach: Projektplan');
    expect(
      within(nav)
        .getAllByRole('button')
        .map((segment) => segment.ariaLabel),
    ).toEqual([
      'Brainstorming: Abgeschlossen',
      'Entscheiden: Abgeschlossen',
      'Architektur: Aktuelle Phase',
      'Projektplan: Kommt noch',
    ]);
  });

  it('says nothing about a next phase in the last one', () => {
    render(<PhaseIndicator active="plan" />);
    const nav = screen.getByRole('navigation', { name: 'Phasen' });

    expect(nav).toHaveTextContent('Schritt 4 von 4Projektplan');
    expect(nav).not.toHaveTextContent('Danach');
  });

  it('says what a phase is for and changes to it (spec 24)', async () => {
    const onSelect = vi.fn();
    const onAsk = vi.fn();
    render(<PhaseIndicator active="decide" onSelect={onSelect} onAsk={onAsk} />);

    fireEvent.click(screen.getByRole('button', { name: /Projektplan/ }));
    const card = await screen.findByRole('dialog', { name: 'Projektplan' });
    expect(card).toHaveTextContent('Kommt noch');
    expect(card).toHaveTextContent('Aus dem Ergebnis den Projektplan machen');
    expect(within(card).queryByRole('button', { name: 'Moderator fragen' })).toBeNull();

    fireEvent.click(within(card).getByRole('button', { name: 'Zu dieser Phase wechseln' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('plan');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // Back works the same way: phases are orientation, not a one-way street.
    fireEvent.click(screen.getByRole('button', { name: /Brainstorming/ }));
    const earlier = await screen.findByRole('dialog', { name: 'Brainstorming' });
    expect(earlier).toHaveTextContent('Abgeschlossen');
    fireEvent.click(within(earlier).getByRole('button', { name: 'Zu dieser Phase wechseln' }));
    expect(onSelect).toHaveBeenLastCalledWith('brainstorming');
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('asks the moderator for the next step from the current phase', async () => {
    const onSelect = vi.fn();
    const onAsk = vi.fn();
    render(<PhaseIndicator active="decide" onSelect={onSelect} onAsk={onAsk} />);

    fireEvent.click(screen.getByRole('button', { name: /Entscheiden/ }));
    const card = await screen.findByRole('dialog', { name: 'Entscheiden' });
    expect(card).toHaveTextContent('Aktuelle Phase');
    expect(card).toHaveTextContent('Optionen nach euren Kriterien abwägen');
    expect(card).toHaveTextContent('Wie geht es weiter?');
    expect(within(card).queryByRole('button', { name: 'Zu dieser Phase wechseln' })).toBeNull();

    fireEvent.click(within(card).getByRole('button', { name: 'Moderator fragen' }));
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('only explains the phases to someone who cannot change them', async () => {
    render(<PhaseIndicator active="decide" />);

    fireEvent.click(screen.getByRole('button', { name: /Architektur/ }));
    const card = await screen.findByRole('dialog', { name: 'Architektur' });
    expect(card).toHaveTextContent('Ausarbeiten, wie das Produkt gebaut wird');
    expect(within(card).queryByRole('button')).toBeNull();

    fireEvent.keyDown(card, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /Entscheiden/ }));
    const current = await screen.findByRole('dialog', { name: 'Entscheiden' });
    expect(within(current).queryByRole('button')).toBeNull();
    expect(current).not.toHaveTextContent('Wie geht es weiter?');
  });
});
