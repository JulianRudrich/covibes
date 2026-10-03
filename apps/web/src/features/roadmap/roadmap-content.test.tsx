import { ROADMAP, roadmapLayout, type Roadmap, type RoadmapMilestone } from '@covibes/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RoadmapContent } from '@web/features/roadmap/roadmap-content';
import { RoadmapProvider } from '@web/features/roadmap/roadmap-context';

const milestone = (
  number: number,
  weeks: number | null,
  tasks: number,
  goal = '',
): RoadmapMilestone => ({
  number,
  title: number === 1 ? 'Grundgerüst und Anmeldung' : 'Mitglieder',
  goal,
  duration: weeks === null ? null : { text: `${String(weeks)} Wochen`, weeks },
  tasks: Array.from({ length: tasks }, (_, index) => ({ text: `Aufgabe ${String(index + 1)}` })),
});

const ROADMAP_WITH_TIMES: Roadmap = {
  milestones: [milestone(1, 3, 2, 'Frontend, API und Datenbank laufen.'), milestone(2, 4, 14)],
};

function renderContent(roadmap: Roadmap | undefined, onOpenPlan?: () => void) {
  return render(
    <RoadmapProvider value={{ projectId: null, roadmap: roadmap ?? null, onOpenPlan }}>
      <RoadmapContent roadmap={roadmap} />
    </RoadmapProvider>,
  );
}

describe('RoadmapContent', () => {
  it('shows every milestone as a column with its time, goal and tasks', () => {
    renderContent(ROADMAP_WITH_TIMES);

    const roadmap = screen.getByRole('list', { name: 'Roadmap mit 2 Meilensteinen' });
    const columns = within(roadmap).getAllByRole('listitem', { name: /^Meilenstein/ });
    expect(columns.map((column) => column.getAttribute('aria-label'))).toEqual([
      'Meilenstein 1: Grundgerüst und Anmeldung',
      'Meilenstein 2: Mitglieder',
    ]);
    const [first, second] = columns;
    if (!first || !second) throw new Error('The columns are missing');

    expect(within(first).getByText('1')).toHaveClass('bg-ink', 'text-on-ink');
    expect(within(first).getByText('3 Wochen · W1–3')).toBeInTheDocument();
    expect(within(first).getByText('Frontend, API und Datenbank laufen.')).toHaveClass(
      'line-clamp-2',
    );
    expect(
      within(within(first).getByRole('list', { name: 'Aufgaben' }))
        .getAllByRole('listitem')
        .map((task) => task.textContent),
    ).toEqual(['Aufgabe 1', 'Aufgabe 2']);

    // A column shows twelve tasks and counts the rest.
    expect(within(second).getByText('4 Wochen · W4–7')).toBeInTheDocument();
    expect(within(second).getAllByRole('listitem')).toHaveLength(12);
    expect(within(second).getByText('+ 2 weitere')).toBeInTheDocument();
  });

  it('puts the columns where the layout says, with the weeks above them', () => {
    const { container } = renderContent(ROADMAP_WITH_TIMES);
    const layout = roadmapLayout(ROADMAP_WITH_TIMES);

    const weeks = [...container.querySelectorAll('[aria-hidden="true"] > span')];
    expect(weeks.map((week) => week.textContent)).toEqual([
      'W1',
      'W2',
      'W3',
      'W4',
      'W5',
      'W6',
      'W7',
    ]);
    expect(weeks[1]).toHaveStyle({ left: `${String(layout.scale?.week)}px` });
    const columns = screen.getAllByRole('listitem', { name: /^Meilenstein/ });
    expect(columns.map((column) => column.style.width)).toEqual(
      layout.columns.map((column) => `${String(column.width)}px`),
    );
    expect(screen.getByRole('list', { name: /^Roadmap/ })).toHaveStyle({
      top: `${String(layout.top)}px`,
      left: `${String(ROADMAP.side)}px`,
    });
  });

  it('shows no scale while a time is missing, and says so at the milestone', () => {
    const { container } = renderContent({
      milestones: [milestone(1, 3, 1), milestone(2, null, 1)],
    });

    expect(container.querySelector('[aria-hidden="true"] > span')).toBeNull();
    expect(screen.getByText('3 Wochen')).toBeInTheDocument();
    expect(screen.getByText('ohne Zeitangabe')).toBeInTheDocument();
    // Without goals, no room is kept for them.
    expect(container.querySelector('.line-clamp-2.text-text-2')).toBeNull();
  });

  it('says where milestones come from while the plan has none, and opens the plan', () => {
    const onOpenPlan = vi.fn();
    renderContent({ milestones: [] }, onOpenPlan);

    expect(screen.getByText('Der Plan hat noch keine Meilensteine.')).toBeInTheDocument();
    expect(screen.getByText(/aus dem Abschnitt „Meilensteine und Aufgaben“/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Plan öffnen' }));
    expect(onOpenPlan).toHaveBeenCalledTimes(1);
  });

  it('offers no way to the plan where there is none, and says that it loads', () => {
    const empty = renderContent({ milestones: [] });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    empty.unmount();

    renderContent(undefined);
    expect(screen.getByText('Roadmap wird geladen …')).toBeInTheDocument();
  });
});
