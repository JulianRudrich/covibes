import type { BoardHistory, BoardHistoryEntry } from '@covibes/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Dialog } from '@web/components/ui/dialog';
import { BoardHistoryDialog } from '@web/features/canvas/board-history';
import { boardHistoryQueryKey } from '@web/features/canvas/history-queries';

// The dialog "Verlauf" of a board (spec 38a).
const PROJECT_ID = '0c6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const BOARD_ID = '33333333-3333-4333-8333-333333333333';
const URL = `/api/projects/${PROJECT_ID}/boards/${BOARD_ID}/history`;

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
let next = 0;
const item = (
  label: string,
  action: BoardHistoryEntry['items'][number]['action'],
  options: { kind?: BoardHistoryEntry['items'][number]['kind']; present?: boolean } = {},
) => {
  next += 1;
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(next).padStart(12, '0')}`,
    kind: options.kind ?? 'block',
    label,
    action,
    present: options.present ?? action !== 'removed',
  };
};

const BY_MODERATOR: BoardHistoryEntry = {
  id: 'e1',
  actor: { kind: 'agent', agentKey: 'moderator' },
  at: minutesAgo(5),
  items: [
    item('Web-App', 'added'),
    item('API', 'added'),
    item('Web-App → API', 'added', { kind: 'edge' }),
  ],
};
const BY_OLGA: BoardHistoryEntry = {
  id: 'e2',
  actor: { kind: 'human', userId: 'u1', name: 'Olga Owner' },
  at: minutesAgo(90),
  items: [
    item('Datenbank', 'moved'),
    item('Alte Notiz', 'removed', { kind: 'sticky' }),
    item('Architektur', 'changed', { kind: 'frame' }),
    // Added by this entry and removed again by a later one.
    item('Entwurf', 'added', { present: false }),
  ],
};

function renderHistory(history: BoardHistory | null) {
  const server = { history };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      return Promise.resolve(
        url === URL && server.history
          ? Response.json(server.history)
          : new Response(JSON.stringify({ error: { code: 'internal', message: 'x' } }), {
              status: 500,
            }),
      );
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenElement = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <Dialog open>
        <BoardHistoryDialog
          projectId={PROJECT_ID}
          boardId={BOARD_ID}
          onOpenElement={onOpenElement}
        />
      </Dialog>
    </QueryClientProvider>,
  );
  return {
    onOpenElement,
    /** The board got an entry; the live channel loads the history again. */
    arrive: (nextHistory: BoardHistory) => {
      server.history = nextHistory;
      return queryClient.invalidateQueries({
        queryKey: boardHistoryQueryKey(PROJECT_ID, BOARD_ID),
      });
    },
  };
}

/** The entries of the list, not the elements inside them. */
const entries = async () =>
  [...(await screen.findByRole('list', { name: 'Verlauf' })).children] as HTMLElement[];
const entryOf = async (name: string) => {
  const found = (await entries()).find((entry) => entry.textContent.includes(`${name} ·`));
  if (!found) throw new Error(`No entry of ${name}`);
  return found;
};

describe('BoardHistoryDialog', () => {
  it('lists who did what and when, the newest entry first', async () => {
    renderHistory({ entries: [BY_MODERATOR, BY_OLGA] });

    const moderator = await entryOf('Moderator');
    const olga = await entryOf('Olga Owner');

    expect(moderator).toHaveTextContent('Moderator · 3 hinzugefügt');
    expect(moderator).toHaveTextContent('vor 5 Minuten');
    expect(olga).toHaveTextContent(
      'Olga Owner · 1 hinzugefügt, 1 entfernt, 1 verschoben, 1 geändert',
    );
    expect(moderator.compareDocumentPosition(olga) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Verlauf' })).toHaveTextContent(
      'Einträge bleiben 30 Tage.',
    );
  });

  it('names the elements of an entry by what happened to them', async () => {
    renderHistory({ entries: [BY_OLGA] });
    const olga = await entryOf('Olga Owner');

    const groups = [...olga.querySelectorAll('ul')].map((list) => [
      list.previousElementSibling?.textContent,
      [...list.querySelectorAll('li')].map((element) => element.textContent),
    ]);

    expect(groups).toEqual([
      ['Hinzugefügt', ['Entwurf']],
      ['Entfernt', ['Alte Notiz']],
      ['Verschoben', ['Datenbank']],
      ['Geändert', ['Architektur']],
    ]);
  });

  it('leads to an element that is still on the board', async () => {
    const { onOpenElement } = renderHistory({ entries: [BY_MODERATOR, BY_OLGA] });
    const moderator = await entryOf('Moderator');

    fireEvent.click(within(moderator).getByRole('button', { name: 'Zu „API“ auf dem Board' }));

    expect(onOpenElement).toHaveBeenCalledExactlyOnceWith(BY_MODERATOR.items[1]?.id);
  });

  it('only names what is gone, and arrows', async () => {
    renderHistory({ entries: [BY_MODERATOR, BY_OLGA] });
    const moderator = await entryOf('Moderator');
    const olga = await entryOf('Olga Owner');

    // The arrow is on the board, but the board brings no arrow into view.
    expect(
      within(moderator)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Web-App', 'API']);
    expect(within(moderator).getByText('Web-App → API')).toBeInTheDocument();
    // What was removed is struck through; what a later entry removed is plain.
    expect(within(olga).getByText('Alte Notiz').parentElement).toHaveClass('line-through');
    expect(within(olga).queryByRole('button', { name: /Entwurf/ })).not.toBeInTheDocument();
    expect(within(olga).queryByRole('button', { name: /Alte Notiz/ })).not.toBeInTheDocument();
    expect(within(olga).getByRole('button', { name: /Datenbank/ })).toBeInTheDocument();
  });

  it('shows the first elements of a large entry and the rest on request', async () => {
    const many: BoardHistoryEntry = {
      ...BY_MODERATOR,
      items: Array.from({ length: 11 }, (_, index) => item(`Block ${String(index + 1)}`, 'added')),
    };
    renderHistory({ entries: [many] });
    const moderator = await entryOf('Moderator');
    const names = () =>
      within(moderator)
        .getAllByRole('button')
        .map((button) => button.textContent)
        .filter((text) => text.startsWith('Block'));

    expect(moderator).toHaveTextContent('11 hinzugefügt');
    expect(names()).toHaveLength(8);

    fireEvent.click(within(moderator).getByRole('button', { name: '3 weitere Elemente zeigen' }));
    expect(names()).toHaveLength(11);

    fireEvent.click(within(moderator).getByRole('button', { name: 'Weniger zeigen' }));
    expect(names()).toHaveLength(8);
  });

  it('names an entry nobody can be named for, and an element without a name by its kind', async () => {
    renderHistory({
      entries: [
        { id: 'e3', actor: { kind: 'unknown' }, at: minutesAgo(1), items: [item('', 'removed')] },
        {
          id: 'e4',
          actor: { kind: 'human', userId: null, name: ' ' },
          at: minutesAgo(2),
          items: [item('  ', 'added', { kind: 'sticky' })],
        },
      ],
    });

    const [first, second] = await entries();

    expect(first).toHaveTextContent('Jemand · 1 entfernt');
    expect(first).toHaveTextContent('Block');
    expect(second).toHaveTextContent('Jemand · 1 hinzugefügt');
    if (!second) throw new Error('No second entry');
    expect(
      within(second).getByRole('button', { name: 'Zu „Notiz“ auf dem Board' }),
    ).toBeInTheDocument();
  });

  it('says that nothing is recorded yet', async () => {
    renderHistory({ entries: [] });

    expect(
      await screen.findByText(
        'Noch nichts aufgezeichnet. Der Verlauf beginnt mit der nächsten Änderung auf diesem Board.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('follows the board: a new entry shows without opening the dialog again', async () => {
    const { arrive } = renderHistory({ entries: [BY_OLGA] });
    await entryOf('Olga Owner');

    await arrive({ entries: [BY_MODERATOR, BY_OLGA] });

    await waitFor(async () => {
      expect(await entries()).toHaveLength(2);
    });
  });

  it('says when the history could not be loaded', async () => {
    renderHistory(null);

    expect(await screen.findByText('Der Verlauf konnte nicht geladen werden.')).toBeInTheDocument();
  });
});
