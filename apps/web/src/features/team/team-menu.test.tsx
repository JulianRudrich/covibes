import type { ProjectAgent } from '@covibes/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CATALOG_MARKS } from '@web/components/ui/agent-marks';
import { TooltipProvider } from '@web/components/ui/tooltip';
import { TeamMenu } from '@web/features/team/team-menu';

const TEAM: ProjectAgent[] = [
  { key: 'moderator', model: null },
  { key: 'critic', model: null },
  { key: 'security', model: 'claude-sonnet-5-5' },
];

function renderMenu({ canEdit = true, canChooseModel = true } = {}) {
  const handlers = { onAdd: vi.fn(), onRemove: vi.fn(), onModelChange: vi.fn() };
  render(
    <TooltipProvider>
      <TeamMenu agents={TEAM} canEdit={canEdit} canChooseModel={canChooseModel} {...handlers} />
    </TooltipProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Team: Moderator, Kritiker, Sicherheit' }));
  return { ...handlers, popover: screen.getByRole('dialog', { name: 'Team' }) };
}

describe('TeamMenu', () => {
  it('shows the team in the header with the marks of the agents (spec 36a)', () => {
    render(
      <TooltipProvider>
        <TeamMenu
          agents={TEAM}
          canEdit
          canChooseModel
          onAdd={vi.fn()}
          onRemove={vi.fn()}
          onModelChange={vi.fn()}
        />
      </TooltipProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Team: Moderator, Kritiker, Sicherheit' });
    expect(
      Array.from(trigger.querySelectorAll('[role="img"] path')).map((path) =>
        path.getAttribute('d'),
      ),
    ).toEqual([CATALOG_MARKS.moderator, CATALOG_MARKS.critic, CATALOG_MARKS.security]);
  });

  it('lists every agent with role and model, and lets editors remove specialists only', () => {
    const { popover, onRemove } = renderMenu({ canChooseModel: false });

    expect(popover).toHaveTextContent('KritikerSchwachstellen und RisikenOpus 5.5');
    expect(within(popover).getByLabelText('Modell von Sicherheit: Sonnet 5.5')).toBeInTheDocument();
    expect(
      within(popover).queryByRole('button', { name: 'Moderator aus dem Team entfernen' }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(popover).getByRole('button', { name: 'Kritiker aus dem Team entfernen' }),
    );
    expect(onRemove).toHaveBeenCalledWith('critic');
  });

  it('offers the catalog agents that are not in the team yet', () => {
    const { popover, onAdd } = renderMenu();

    const add = within(popover).getByRole('heading', { name: 'Agent hinzufügen' });
    expect(add).toBeInTheDocument();
    const offered = within(popover)
      .getAllByRole('button', { name: /hinzufügen$/ })
      .map((button) => button.getAttribute('aria-label'));
    expect(offered).toEqual([
      'Produkt hinzufügen',
      'Frontend hinzufügen',
      'Backend hinzufügen',
      'Daten hinzufügen',
      'DevOps hinzufügen',
      'ML hinzufügen',
      'Content hinzufügen',
    ]);
    fireEvent.click(within(popover).getByRole('button', { name: 'Daten hinzufügen' }));
    expect(onAdd).toHaveBeenCalledWith('data');
  });

  it('only shows the team to viewers', () => {
    const { popover } = renderMenu({ canEdit: false, canChooseModel: false });

    expect(within(popover).queryByRole('heading', { name: 'Agent hinzufügen' })).toBeNull();
    expect(within(popover).queryAllByRole('button')).toEqual([]);
  });

  it('lets owners choose a model, the default as no choice', async () => {
    const { popover, onModelChange } = renderMenu();

    fireEvent.keyDown(
      within(popover).getByRole('button', { name: 'Modell von Kritiker: Opus 5.5' }),
      { key: 'Enter' },
    );
    const options = await screen.findAllByRole('menuitemradio');
    expect(options.map((option) => option.textContent)).toEqual([
      'Opus 5.5 (Standard)',
      'Sonnet 5.5',
      'Haiku 4.5',
    ]);
    expect(options[0]).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Haiku 4.5' }));
    expect(onModelChange).toHaveBeenCalledWith('critic', 'claude-haiku-4-5-20251001');

    fireEvent.keyDown(
      within(popover).getByRole('button', { name: 'Modell von Sicherheit: Sonnet 5.5' }),
      { key: 'Enter' },
    );
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Opus 5.5 (Standard)' }));
    expect(onModelChange).toHaveBeenCalledWith('security', null);
  });
});
