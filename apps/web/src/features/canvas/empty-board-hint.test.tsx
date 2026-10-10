import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyBoardHint } from '@web/features/canvas/empty-board-hint';
import { NO_EXPORT } from '@web/features/export/board-image';

// What an empty board says (spec 33).
describe('EmptyBoardHint', () => {
  it('says how to start: with the tools below, or by asking an agent', () => {
    render(<EmptyBoardHint readOnly={false} />);

    expect(screen.getByText('Dieses Board ist noch leer')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Leg unten Notizen, Blöcke und Rahmen an, oder bitte im Chat einen Agent, etwas zu zeichnen.',
      ),
    ).toBeInTheDocument();
  });

  it('tells viewers that the board will fill, without steps they cannot take', () => {
    render(<EmptyBoardHint readOnly />);

    expect(screen.getByText('Dieses Board ist noch leer')).toBeInTheDocument();
    expect(
      screen.getByText('Sobald das Team etwas anlegt, erscheint es hier.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Leg unten/)).not.toBeInTheDocument();
  });

  it('takes no clicks and is no part of an export', () => {
    const { container } = render(<EmptyBoardHint readOnly={false} />);
    const hint = container.firstElementChild;

    // Drawing starts right through it.
    expect(hint).toHaveClass('pointer-events-none');
    expect(hint).toHaveAttribute(NO_EXPORT);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
