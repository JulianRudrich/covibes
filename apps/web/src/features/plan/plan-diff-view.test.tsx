import { diffPlanLines } from '@covibes/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlanDiffView } from '@web/features/plan/plan-diff-view';

const same = (count: number, from = 1) =>
  Array.from({ length: count }, (_, index) => `Zeile ${String(from + index)}`);

const rows = () => screen.getAllByRole('listitem').map((row) => row.textContent);

describe('PlanDiffView', () => {
  it('folds long unchanged stretches and opens one on a click', () => {
    render(
      <PlanDiffView
        lines={diffPlanLines(
          [...same(8), 'Eigener Server', ...same(7, 20)],
          [...same(8), 'Verwalteter Dienst', ...same(7, 20)],
        )}
      />,
    );

    expect(rows()).toEqual([
      '… 6 unveränderte Zeilen anzeigen',
      'Zeile 7',
      'Zeile 8',
      'entfällt: Eigener Server',
      'neu: Verwalteter Dienst',
      'Zeile 20',
      'Zeile 21',
      '… 5 unveränderte Zeilen anzeigen',
    ]);

    fireEvent.click(screen.getByRole('button', { name: '… 5 unveränderte Zeilen anzeigen' }));

    // The other stretch stays folded.
    expect(rows()).toEqual([
      '… 6 unveränderte Zeilen anzeigen',
      'Zeile 7',
      'Zeile 8',
      'entfällt: Eigener Server',
      'neu: Verwalteter Dienst',
      ...same(7, 20),
    ]);

    fireEvent.click(screen.getByRole('button', { name: '… 6 unveränderte Zeilen anzeigen' }));
    expect(rows()).toHaveLength(17);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says so when nothing differs', () => {
    render(<PlanDiffView lines={diffPlanLines(same(12), same(12))} />);

    expect(screen.getByText('Keine Unterschiede.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });
});
