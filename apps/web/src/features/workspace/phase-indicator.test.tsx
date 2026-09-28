import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PhaseIndicator } from './phase-indicator';

describe('PhaseIndicator', () => {
  it('marks only the active phase as the current step', () => {
    render(<PhaseIndicator active="architecture" />);
    const nav = screen.getByRole('navigation', { name: 'Phasen' });

    const current = nav.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Architektur');
  });

  it('shows all four phases in order, with the number only for upcoming ones', () => {
    render(<PhaseIndicator active="architecture" />);
    const nav = screen.getByRole('navigation', { name: 'Phasen' });

    expect(nav).toHaveTextContent(/Brainstorming.*Entscheiden.*Architektur.*4Projektplan/);
    expect(within(nav).queryByText('1')).not.toBeInTheDocument();
  });
});
