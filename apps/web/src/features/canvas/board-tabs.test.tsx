import { MAX_BOARDS_PER_PROJECT, type ProjectBoard, type ProjectDetails } from '@covibes/shared';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BoardTabs } from '@web/features/canvas/board-tabs';
import { projectQuery } from '@web/features/projects/queries';
import { createQueryClient } from '@web/lib/query-client';
import { stubApi } from '@web/test-utils';

const PROJECT_ID = '0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const MAIN: ProjectBoard = {
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Haupt-Canvas',
  kind: 'main',
};
const FLOW: ProjectBoard = {
  id: '44444444-4444-4444-8444-444444444444',
  title: 'Ablauf',
  kind: 'extra',
};
const DATA: ProjectBoard = {
  id: '55555555-5555-4555-8555-555555555555',
  title: 'Datenmodell',
  kind: 'extra',
};
const BOARDS_URL = `/api/projects/${PROJECT_ID}/boards`;

function details(boards: ProjectBoard[], role: ProjectDetails['role'] = 'owner'): ProjectDetails {
  return {
    id: PROJECT_ID,
    name: 'Covibes',
    role,
    members: [],
    boards,
    proposalsOnly: false,
    agents: [{ key: 'moderator', model: null }],
  };
}

/** The tabs as the workspace shows them: from the cached project, the open board in state. */
function renderTabs({
  boards = [MAIN, FLOW, DATA],
  active = MAIN.id,
  readOnly = false,
}: { boards?: ProjectBoard[]; active?: string; readOnly?: boolean } = {}) {
  const queryClient = createQueryClient();
  queryClient.setQueryData(projectQuery(PROJECT_ID).queryKey, details(boards));
  const onSelect = vi.fn((boardId: string) => {
    selected = boardId;
    rerender();
    return Promise.resolve();
  });
  const onNotice = vi.fn();
  let selected = active;

  function Harness() {
    const project = useQuery({ ...projectQuery(PROJECT_ID), enabled: false });
    return (
      <BoardTabs
        projectId={PROJECT_ID}
        boards={project.data?.boards ?? []}
        activeBoardId={selected}
        readOnly={readOnly}
        onSelect={onSelect}
        onNotice={onNotice}
      />
    );
  }
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  function rerender() {
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );
  }
  return { queryClient, onSelect, onNotice };
}

function tab(name: string) {
  return screen.getByRole('tab', { name });
}

describe('BoardTabs', () => {
  it('shows the main canvas first and switches boards by click', () => {
    const { onSelect } = renderTabs();

    expect(screen.getAllByRole('tab').map((entry) => entry.textContent)).toEqual([
      'Haupt-Canvas',
      'Ablauf',
      'Datenmodell',
    ]);
    expect(tab('Haupt-Canvas')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Ablauf')).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(tab('Ablauf'));
    expect(onSelect).toHaveBeenCalledWith(FLOW.id);
    expect(tab('Ablauf')).toHaveAttribute('aria-selected', 'true');
  });

  it('moves between the tabs with the arrow keys', () => {
    renderTabs();
    tab('Haupt-Canvas').focus();

    fireEvent.keyDown(tab('Haupt-Canvas'), { key: 'ArrowRight' });
    expect(tab('Ablauf')).toHaveFocus();
    fireEvent.keyDown(tab('Ablauf'), { key: 'End' });
    expect(tab('Datenmodell')).toHaveFocus();
    fireEvent.keyDown(tab('Datenmodell'), { key: 'ArrowRight' });
    expect(tab('Haupt-Canvas')).toHaveFocus();
  });

  it('adds "Board N" at the end and opens it', async () => {
    const created: ProjectBoard = {
      id: '66666666-6666-4666-8666-666666666666',
      title: 'Board 2',
      kind: 'extra',
    };
    const api = stubApi({
      [`POST ${BOARDS_URL}`]: () => ({ status: 201, body: created }),
      [`GET /api/projects/${PROJECT_ID}`]: () => ({ body: details([MAIN, FLOW, DATA, created]) }),
    });
    const { onSelect } = renderTabs();

    fireEvent.click(screen.getByRole('button', { name: 'Board' }));

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(created.id);
    });
    expect(tab('Board 2')).toHaveAttribute('aria-selected', 'true');
    expect(api).toHaveBeenCalledWith(BOARDS_URL, expect.objectContaining({ method: 'POST' }));
  });

  it(`adds no board beyond ${String(MAX_BOARDS_PER_PROJECT)}`, () => {
    const api = stubApi({});
    const many = Array.from({ length: MAX_BOARDS_PER_PROJECT - 1 }, (_, index) => ({
      id: `board-${String(index)}`,
      title: `Board ${String(index + 2)}`,
      kind: 'extra' as const,
    }));
    const { onNotice } = renderTabs({ boards: [MAIN, ...many] });

    fireEvent.click(screen.getByRole('button', { name: 'Board' }));

    expect(onNotice).toHaveBeenCalledWith('Ein Projekt hat höchstens 20 Boards.');
    expect(api).not.toHaveBeenCalled();
  });

  it('renames a board in place: Enter saves, Escape cancels', async () => {
    // The server does not answer, so the new title shows before it does.
    const api = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', api);
    renderTabs();

    fireEvent.doubleClick(tab('Datenmodell'));
    const cancelled = screen.getByRole('textbox', { name: 'Name des Boards' });
    fireEvent.change(cancelled, { target: { value: 'Verworfen' } });
    fireEvent.keyDown(cancelled, { key: 'Escape' });
    expect(tab('Datenmodell')).toBeInTheDocument();

    fireEvent.doubleClick(tab('Ablauf'));
    const field = screen.getByRole('textbox', { name: 'Name des Boards' });
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: '  Prozess  ' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(await screen.findByRole('tab', { name: 'Prozess' })).toBeInTheDocument();
    expect(api).toHaveBeenCalledOnce();
    expect(api).toHaveBeenCalledWith(
      `${BOARDS_URL}/${FLOW.id}`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ title: 'Prozess' }) }),
    );
  });

  it('keeps the old title and says so when renaming fails', async () => {
    stubApi({
      [`PATCH ${BOARDS_URL}/${FLOW.id}`]: () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'x' } },
      }),
    });
    const { onNotice } = renderTabs();

    fireEvent.doubleClick(tab('Ablauf'));
    const field = screen.getByRole('textbox', { name: 'Name des Boards' });
    fireEvent.change(field, { target: { value: 'Prozess' } });
    fireEvent.blur(field);

    await waitFor(() => {
      expect(onNotice).toHaveBeenCalledWith(
        'Das hat nicht geklappt. Bitte versuche es noch einmal.',
      );
    });
    expect(tab('Ablauf')).toBeInTheDocument();
  });

  it('offers rename and delete in the menu of the open board, never for the main canvas', async () => {
    renderTabs({ active: FLOW.id });

    expect(screen.queryByRole('button', { name: 'Menü für „Haupt-Canvas“' })).toBeNull();
    fireEvent.doubleClick(tab('Haupt-Canvas'));
    expect(screen.queryByRole('textbox')).toBeNull();

    const chevron = screen.getByRole('button', { name: 'Menü für „Ablauf“' });
    fireEvent.pointerDown(chevron, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Umbenennen' }));
    expect(await screen.findByRole('textbox', { name: 'Name des Boards' })).toHaveValue('Ablauf');
  });

  it('opens the menu of another board by right-click', async () => {
    renderTabs();

    fireEvent.contextMenu(tab('Datenmodell'));

    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Löschen' })).toBeInTheDocument();
  });

  it('deletes after confirming, and opens the main canvas first if the board was open', async () => {
    const api = stubApi({
      [`DELETE ${BOARDS_URL}/${FLOW.id}`]: () => ({ status: 204, body: null }),
      [`GET /api/projects/${PROJECT_ID}`]: () => ({ body: details([MAIN, DATA]) }),
    });
    const { onSelect } = renderTabs({ active: FLOW.id });

    fireEvent.contextMenu(tab('Ablauf'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Löschen' }));
    const dialog = await screen.findByRole('dialog', { name: '„Ablauf“ löschen?' });
    expect(dialog).toHaveTextContent('Das lässt sich nicht rückgängig machen.');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Board löschen' }));
      await Promise.resolve();
    });

    expect(onSelect).toHaveBeenCalledWith(MAIN.id);
    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: 'Ablauf' })).toBeNull();
    });
    expect(api).toHaveBeenCalledWith(
      `${BOARDS_URL}/${FLOW.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lets viewers only switch', () => {
    renderTabs({ readOnly: true });

    expect(screen.queryByRole('button', { name: 'Board' })).toBeNull();
    fireEvent.doubleClick(tab('Ablauf'));
    fireEvent.contextMenu(tab('Ablauf'));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });
});
