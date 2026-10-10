import type { UsageOverview } from '@covibes/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Dialog } from '@web/components/ui/dialog';
import { usageOverviewQueryKey } from '@web/features/usage/queries';
import { UsageDialog } from '@web/features/usage/usage-dialog';
import { formatUntil } from '@web/lib/format';

// The dialog "Verbrauch" of the project's owners (spec 31b).
const PROJECT_ID = '0c6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const URL = `/api/projects/${PROJECT_ID}/usage`;
const OLGA = '5d1f0a5e-2f3b-4a53-9a44-0f6f4f4e8a01';
const ENDS = '2026-11-01T00:00:00.000Z';

const amount = (costUsd: number, runs: number, inputTokens = 0, outputTokens = 0) => ({
  costUsd,
  runs,
  inputTokens,
  outputTokens,
});

const OCTOBER: UsageOverview = {
  month: '2026-10',
  current: true,
  limits: { projectMonthUsd: 100, userDayUsd: 15 },
  endsAt: ENDS,
  total: amount(6.17, 42, 1_234_567, 85_300),
  byAgent: [
    { agentKey: 'moderator', ...amount(4.1, 30) },
    { agentKey: 'backend', ...amount(2.06, 11) },
    // A custom agent nobody knows any more.
    { agentKey: '9b1f4a0e-7d0c-4a43-8a17-2f5a3f0c1d11', ...amount(0.01, 1) },
  ],
  bySource: [
    { kind: 'member', userId: OLGA, name: 'Olga Owner', ...amount(3.5, 20) },
    { kind: 'nobody', ...amount(2.5, 21) },
    { kind: 'left', ...amount(0.17, 1) },
  ],
  byDay: [
    { day: '2026-10-01', costUsd: 1.02, runs: 9 },
    { day: '2026-10-02', costUsd: 0, runs: 0 },
    { day: '2026-10-03', costUsd: 4.4, runs: 28 },
    { day: '2026-10-04', costUsd: 0.75, runs: 5 },
  ],
};

const SEPTEMBER: UsageOverview = {
  month: '2026-09',
  current: false,
  limits: OCTOBER.limits,
  endsAt: '2026-10-01T00:00:00.000Z',
  total: amount(31.5, 210, 9_000_000, 400_000),
  byAgent: [{ agentKey: 'moderator', ...amount(31.5, 210) }],
  bySource: [{ kind: 'member', userId: OLGA, name: 'Olga Owner', ...amount(31.5, 210) }],
  byDay: Array.from({ length: 30 }, (_, index) => ({
    day: `2026-09-${String(index + 1).padStart(2, '0')}`,
    costUsd: index === 11 ? 31.5 : 0,
    runs: index === 11 ? 210 : 0,
  })),
};

/** Renders the open dialog; `months` are the server's answers by what was asked for. */
function renderDialog(months: Record<string, UsageOverview | null>) {
  const server = { months };
  const asked = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      asked(url);
      const answer = server.months[url.startsWith(URL) ? url.slice(URL.length) : 'none'];
      return Promise.resolve(
        answer
          ? Response.json(answer)
          : new Response(JSON.stringify({ error: { code: 'internal', message: 'x' } }), {
              status: 500,
            }),
      );
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Dialog open>
        <UsageDialog projectId={PROJECT_ID} />
      </Dialog>
    </QueryClientProvider>,
  );
  return {
    asked,
    /** A run cost something; the live channel loads the running month again. */
    arrive: (next: UsageOverview) => {
      server.months = { ...server.months, '': next };
      return queryClient.invalidateQueries({
        queryKey: usageOverviewQueryKey(PROJECT_ID, null),
      });
    },
  };
}

const dialog = () => screen.findByRole('dialog', { name: 'Verbrauch' });
/** Amounts are written with spaces that do not break; the tests read them as plain ones. */
const plain = (text: string | null) => (text ?? '').replace(/\s+/g, ' ');
const section = async (name: string) => within(await dialog()).findByRole('region', { name });

describe('UsageDialog', () => {
  it('shows what the running month cost against the limit, as an amount and as a share', async () => {
    renderDialog({ '': OCTOBER });

    const total = await section('Gesamt');

    expect(total).toHaveTextContent('6,17 $von 100,00 $');
    expect(total).toHaveTextContent('6,2 %');
    const meter = within(total).getByRole('meter', { name: 'Anteil am Monatslimit des Projekts' });
    expect(meter).toHaveAttribute('aria-valuenow', '6.17');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(plain(meter.getAttribute('aria-valuetext'))).toBe('6,17 $ von 100,00 $, 6,2 %');
    expect(total).toHaveTextContent(`Der Monat zählt neu ab ${formatUntil(ENDS, 'de')}.`);
    expect(total).not.toHaveTextContent('Limit erreicht');
  });

  it('names the runs and the tokens of the month', async () => {
    renderDialog({ '': OCTOBER });

    const total = await section('Gesamt');

    expect(within(total).getByText('Läufe').nextSibling).toHaveTextContent('42');
    expect(within(total).getByText('Eingabe-Tokens').nextSibling).toHaveTextContent('1,2 Mio.');
    expect(within(total).getByText('Ausgabe-Tokens').nextSibling).toHaveTextContent('85.300');
  });

  it('says in words that the limit is reached, and when the agents answer again', async () => {
    renderDialog({ '': { ...OCTOBER, total: amount(104.2, 900) } });

    const total = await section('Gesamt');

    expect(total).toHaveTextContent(
      `Limit erreicht. Die Agents antworten wieder ab ${formatUntil(ENDS, 'de')}.`,
    );
    expect(total).toHaveTextContent('104 %');
    // The meter is full, not more than full.
    expect(within(total).getByRole('meter')).toHaveAttribute('aria-valuenow', '100');
    expect(total).not.toHaveTextContent('Der Monat zählt neu');
  });

  it('shows the amount alone where no limit is set', async () => {
    renderDialog({ '': { ...OCTOBER, limits: { projectMonthUsd: 0, userDayUsd: 0 } } });

    const total = await section('Gesamt');

    expect(total).toHaveTextContent('6,17 $');
    expect(total).toHaveTextContent('Für Projekte ist kein Monatslimit gesetzt.');
    expect(within(total).queryByRole('meter')).not.toBeInTheDocument();
    expect(total).not.toHaveTextContent('%');
    // No daily limit either: the note names none.
    expect(await dialog()).not.toHaveTextContent('Tageslimit');
  });

  it('lists the agents the costs come from, each with its amount and its runs', async () => {
    renderDialog({ '': OCTOBER });

    const rows = within(await section('Je Agent')).getAllByRole('listitem');

    expect(rows.map((row) => plain(row.textContent))).toEqual([
      'MModerator4,10 $30 Läufe',
      'BBackend2,06 $11 Läufe',
      '?Agent0,01 $1 Lauf',
    ]);
  });

  it('lists who the costs are for: members, what ran by itself, and who left', async () => {
    renderDialog({ '': OCTOBER });

    const rows = within(await section('Je Person')).getAllByRole('listitem');

    expect(rows.map((row) => plain(row.textContent))).toEqual([
      'OOOlga Owner3,50 $20 Läufe',
      'Automatisch2,50 $21 Läufe',
      'Nicht mehr im Projekt0,17 $1 Lauf',
    ]);
    // What "Automatisch" means is said where it is listed.
    expect(await dialog()).toHaveTextContent(
      '„Automatisch“ ist, was ohne Auftrag einer Person lief',
    );
  });

  it('draws the largest bar full and the others against it', async () => {
    renderDialog({ '': OCTOBER });

    const rows = within(await section('Je Person')).getAllByRole('listitem');
    const widths = rows.map((row) => row.querySelector<HTMLElement>('[style]')?.style.width);

    expect(widths[0]).toBe('100%');
    expect(Number.parseFloat(widths[1] ?? '')).toBeCloseTo((2.5 / 3.5) * 100);
    expect(Number.parseFloat(widths[2] ?? '')).toBeCloseTo((0.17 / 3.5) * 100);
  });

  it('has a column for every day so far, and names the day with the highest costs', async () => {
    renderDialog({ '': OCTOBER });

    const days = await section('Je Tag');
    const columns = within(within(days).getByRole('group', { name: 'Kosten je Tag' })).getAllByRole(
      'button',
    );

    // The days still to come have no column.
    expect(columns.map((column) => plain(column.getAttribute('aria-label')))).toEqual([
      '1. Oktober: 1,02 $ · 9 Läufe',
      '2. Oktober: 0,00 $ · 0 Läufe',
      '3. Oktober: 4,40 $ · 28 Läufe',
      '4. Oktober: 0,75 $ · 5 Läufe',
    ]);
    expect(days).toHaveTextContent('Höchster Tag: 3. Oktober mit 4,40 $');
  });

  it('names a day under the pointer and under the keyboard, and walks with the arrow keys', async () => {
    renderDialog({ '': OCTOBER });
    const days = await section('Je Tag');
    const group = within(days).getByRole('group', { name: 'Kosten je Tag' });
    const columns = within(group).getAllByRole('button');
    const [first, second, third, fourth] = columns;
    if (!first || !second || !third || !fourth) throw new Error('No columns');

    // One stop for the Tab key: the day with the highest costs.
    expect(columns.map((column) => column.tabIndex)).toEqual([-1, -1, 0, -1]);

    fireEvent.mouseEnter(first);
    expect(days).toHaveTextContent('1. Oktober: 1,02 $ · 9 Läufe');
    fireEvent.mouseLeave(first);
    expect(days).toHaveTextContent('Höchster Tag: 3. Oktober mit 4,40 $');

    act(() => {
      third.focus();
    });
    expect(days).toHaveTextContent('3. Oktober: 4,40 $ · 28 Läufe');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(fourth).toHaveFocus();
    expect(days).toHaveTextContent('4. Oktober: 0,75 $ · 5 Läufe');
    // The last day is the end.
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(fourth).toHaveFocus();
    fireEvent.keyDown(group, { key: 'Home' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(group, { key: 'End' });
    expect(fourth).toHaveFocus();
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(third).toHaveFocus();
    // The Tab key comes back to where the keyboard was.
    expect(columns.map((column) => column.tabIndex)).toEqual([-1, -1, 0, -1]);
  });

  it('shows the month before on request: its amounts, and no limit that could still be reached', async () => {
    const { asked } = renderDialog({ '': OCTOBER, '?month=2026-09': SEPTEMBER });
    const months = within(await dialog());

    const before = await months.findByRole('button', { name: 'September 2026' });
    expect(months.getByRole('button', { name: 'Oktober 2026' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(before).toHaveAttribute('aria-pressed', 'false');
    expect(asked).not.toHaveBeenCalledWith(`${URL}?month=2026-09`);

    fireEvent.click(before);

    expect(before).toHaveAttribute('aria-pressed', 'true');
    const total = await section('Gesamt');
    await waitFor(() => {
      expect(total).toHaveTextContent('31,50 $');
    });
    expect(asked).toHaveBeenCalledWith(`${URL}?month=2026-09`);
    expect(within(total).queryByRole('meter')).not.toBeInTheDocument();
    expect(total).not.toHaveTextContent('von 100,00 $');
    expect(total).not.toHaveTextContent('zählt neu');
    // A whole month: a column for each of its days.
    const columns = within(await section('Je Tag')).getAllByRole('button');
    expect(columns).toHaveLength(30);
    expect(plain(columns[11]?.getAttribute('aria-label') ?? null)).toBe(
      '12. September: 31,50 $ · 210 Läufe',
    );

    fireEvent.click(months.getByRole('button', { name: 'Oktober 2026' }));
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Gesamt' })).toHaveTextContent('6,17 $');
    });
  });

  it('says that a month without usage had none', async () => {
    renderDialog({
      '': { ...OCTOBER, total: amount(0, 0), byAgent: [], bySource: [], byDay: [] },
    });
    const shown = await dialog();

    expect(
      await within(shown).findByText('In diesem Monat ist kein Verbrauch angefallen.'),
    ).toBeInTheDocument();
    expect(await section('Gesamt')).toHaveTextContent('0,00 $von 100,00 $');
    for (const name of ['Je Agent', 'Je Person', 'Je Tag']) {
      expect(within(shown).queryByRole('region', { name })).not.toBeInTheDocument();
    }
  });

  it('says that the amounts are estimates, and names the daily limit as a rule', async () => {
    renderDialog({ '': OCTOBER });
    const shown = await dialog();
    await section('Gesamt');

    expect(shown).toHaveTextContent('Die Beträge sind Schätzungen zu Listenpreisen.');
    expect(shown).toHaveTextContent('Tage und Monate zählen in UTC.');
    expect(shown).toHaveTextContent(
      'Je Person gilt außerdem ein Tageslimit von 15,00 $ über alle Projekte; hier steht nur, was in diesem Projekt verbraucht wurde.',
    );
  });

  it('follows the usage: what arrives shows without opening the dialog again', async () => {
    const { arrive } = renderDialog({ '': OCTOBER });
    const total = await section('Gesamt');
    expect(total).toHaveTextContent('6,17 $');

    await arrive({ ...OCTOBER, total: amount(7.02, 43) });

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Gesamt' })).toHaveTextContent('7,02 $');
    });
  });

  it('says when the usage could not be loaded', async () => {
    renderDialog({ '': null });

    expect(
      await within(await dialog()).findByText('Der Verbrauch konnte nicht geladen werden.'),
    ).toBeInTheDocument();
  });
});
