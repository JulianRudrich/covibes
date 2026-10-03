import { ROADMAP, roadmapLayout, type Roadmap, type RoadmapMilestone } from '@covibes/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RoadmapContent } from '@web/features/roadmap/roadmap-content';
import { RoadmapProvider, type TaskAssigning } from '@web/features/roadmap/roadmap-context';

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
  tasks: Array.from({ length: tasks }, (_, index) => ({
    id: null,
    text: `Aufgabe ${String(index + 1)}`,
    assignee: null,
  })),
});

const ROADMAP_WITH_TIMES: Roadmap = {
  milestones: [milestone(1, 3, 2, 'Frontend, API und Datenbank laufen.'), milestone(2, 4, 14)],
};

function renderContent(
  roadmap: Roadmap | undefined,
  onOpenPlan?: () => void,
  assigning?: TaskAssigning,
) {
  return render(
    <RoadmapProvider value={{ projectId: null, roadmap: roadmap ?? null, onOpenPlan, assigning }}>
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

describe('tasks on the roadmap (spec 26b)', () => {
  const LOGIN = '7a000000-0000-4000-8000-000000000001';
  const EXPORT = '7a000000-0000-4000-8000-000000000002';
  const ALEX = { userId: '22222222-2222-4222-8222-222222222222', name: 'Alex Berg' };
  const SAM = { userId: '33333333-3333-4333-8333-333333333333', name: 'Sam Lee' };
  const WITH_TASKS: Roadmap = {
    milestones: [
      {
        number: 1,
        title: 'Grundgerüst',
        goal: '',
        duration: null,
        tasks: [
          { id: LOGIN, text: 'Login bauen', assignee: ALEX },
          { id: EXPORT, text: 'Export', assignee: null },
          // Written a moment ago: the server has given it no id yet.
          { id: null, text: 'Abnahme', assignee: null },
        ],
      },
    ],
  };
  const tasksOf = () =>
    within(screen.getByRole('list', { name: 'Aufgaben' })).getAllByRole('listitem');

  it('shows the assignee of a task and lets owners and editors assign the others', async () => {
    const onAssign = vi.fn();
    renderContent(WITH_TASKS, undefined, { members: [ALEX, SAM], onAssign });
    const [login, exportTask, review] = tasksOf();
    if (!login || !exportTask || !review) throw new Error('The tasks are missing');

    const taken = within(login).getByRole('button', {
      name: '„Login bauen“, zugewiesen an Alex Berg. Zuweisung ändern',
    });
    expect(taken).toHaveTextContent('AB');
    expect(taken).toHaveClass('nodrag');
    const open = within(exportTask).getByRole('button', { name: '„Export“ zuweisen' });
    expect(open).toHaveClass('border-dashed');
    // Without an id there is nothing to assign yet.
    expect(within(review).queryByRole('button')).not.toBeInTheDocument();

    fireEvent.pointerDown(open, { button: 0, ctrlKey: false });
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Zuweisen an')).toBeInTheDocument();
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['ABAlex Berg', 'SLSam Lee', 'Niemand']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Sam Lee' }));

    expect(onAssign).toHaveBeenCalledExactlyOnceWith(EXPORT, SAM);
  });

  it('clears a task with "Niemand" and does nothing for the one who has it', async () => {
    const onAssign = vi.fn();
    renderContent(WITH_TASKS, undefined, { members: [ALEX, SAM], onAssign });
    const trigger = screen.getByRole('button', { name: /^„Login bauen“/ });

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Alex Berg' }));
    expect(onAssign).not.toHaveBeenCalled();

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Niemand' }));
    expect(onAssign).toHaveBeenCalledExactlyOnceWith(LOGIN, null);
  });

  it('shows viewers the assignees without a way to change them', () => {
    renderContent(WITH_TASKS);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Zugewiesen an Alex Berg' })).toHaveTextContent('AB');
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('names nobody in the read-only view', () => {
    const anonymous = { userId: '00000000-0000-4000-8000-000000000000', name: '' };
    const [milestone] = WITH_TASKS.milestones;
    if (!milestone) throw new Error('The milestone is missing');
    renderContent({
      milestones: [
        {
          ...milestone,
          tasks: [{ id: LOGIN, text: 'Login bauen', assignee: anonymous }],
        },
      ],
    });

    expect(screen.getByRole('img', { name: 'Zugewiesen an Teammitglied' })).toHaveTextContent('·');
  });
});
