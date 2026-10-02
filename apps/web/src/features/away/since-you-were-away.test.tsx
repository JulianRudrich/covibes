import type { AwaySummary } from '@covibes/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SinceYouWereAway } from '@web/features/away/since-you-were-away';

const DECISION = '11111111-1111-4111-8111-111111111111';
const MAIN = '33333333-3333-4333-8333-333333333333';
const EXTRA = '44444444-4444-4444-8444-444444444444';

const SUMMARY: AwaySummary = {
  since: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
  until: new Date().toISOString(),
  text: 'Olga und Sam haben sich auf React Flow geeinigt. Offen ist noch das Hosting.',
  textStatus: 'done',
  decisions: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      kind: 'decided',
      decisionId: DECISION,
      topic: 'Canvas',
      value: 'React Flow',
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      kind: 'reopened',
      decisionId: null,
      topic: 'Sprache',
      value: 'Go',
    },
  ],
  criteriaChanges: 2,
  boards: [
    {
      boardId: MAIN,
      title: 'Haupt-Canvas',
      isNew: false,
      changed: 5,
      by: [
        { kind: 'human', name: 'Olga' },
        { kind: 'agent', agentKey: 'moderator' },
      ],
      authors: 2,
    },
    { boardId: EXTRA, title: 'Datenmodell', isNew: true, changed: 3, by: [], authors: 0 },
  ],
  messages: {
    count: 12,
    mentions: 1,
    by: [
      { kind: 'human', name: 'Olga' },
      { kind: 'human', name: 'Sam' },
      { kind: 'agent', agentKey: 'critic' },
    ],
    authors: 5,
  },
};

function renderSection(summary: AwaySummary = SUMMARY, waiting = 3) {
  const onOpenDecision = vi.fn();
  const onOpenBoard = vi.fn();
  const onDismiss = vi.fn();
  render(
    <SinceYouWereAway
      summary={summary}
      waiting={waiting}
      onOpenDecision={onOpenDecision}
      onOpenBoard={onOpenBoard}
      onDismiss={onDismiss}
    />,
  );
  const section = screen.getByRole('region', { name: 'Seit du weg warst' });
  return { section, onOpenDecision, onOpenBoard, onDismiss };
}

describe('SinceYouWereAway', () => {
  it("shows the moderator's words and what happened, line by line", () => {
    const { section } = renderSection();

    expect(section).toHaveTextContent('zuletzt hier vorgestern');
    expect(within(section).getByText('Moderator')).toHaveClass('text-agent-moderator-dark');
    expect(section).toHaveTextContent('· Zusammenfassung');
    expect(
      within(section).getByText(
        'Olga und Sam haben sich auf React Flow geeinigt. Offen ist noch das Hosting.',
      ),
    ).toHaveClass('text-body', 'text-text-body');

    const rows = within(section)
      .getAllByRole('listitem')
      .map((row) => row.textContent);
    expect(rows).toEqual([
      'Entschieden: Canvas – React Flow',
      'Wieder geöffnet: Sprache',
      '2 Kriterien geändert',
      'Haupt-Canvas: 5 Änderungen von Olga und Moderator',
      'Neues Board: Datenmodell',
      '12 neue Nachrichten von Olga, Sam, Kritiker und 2 weiteren',
      '1 Nachricht erwähnt dich',
      '3 Sachen warten auf dich',
    ]);
    expect(within(section).getByText('Canvas')).toHaveClass('font-semibold', 'text-text');
  });

  it('opens a decision and a board from their lines', () => {
    const { section, onOpenDecision, onOpenBoard } = renderSection();

    fireEvent.click(within(section).getByRole('button', { name: /Entschieden: Canvas/ }));
    expect(onOpenDecision).toHaveBeenCalledExactlyOnceWith(DECISION);
    // A decision that is gone has nothing to open.
    expect(
      within(section).queryByRole('button', { name: /Wieder geöffnet/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(within(section).getByRole('button', { name: /Haupt-Canvas/ }));
    fireEvent.click(within(section).getByRole('button', { name: /Neues Board: Datenmodell/ }));
    expect(onOpenBoard.mock.calls).toEqual([[MAIN], [EXTRA]]);
  });

  it('closes with "Verstanden"', () => {
    const { section, onDismiss } = renderSection();

    fireEvent.click(within(section).getByRole('button', { name: 'Verstanden' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('says so while the moderator is still writing', () => {
    const { section } = renderSection({ ...SUMMARY, text: null, textStatus: 'pending' });

    const status = within(section).getByRole('status');
    expect(status).toHaveTextContent('Fasst die Unterhaltung für dich zusammen …');
    expect(status).toHaveClass('animate-pulse', 'text-text-3');
    expect(within(section).getByText('Moderator')).toBeInTheDocument();
  });

  it.each(['none', 'failed'] as const)(
    'stands without the moderator when there are no words (%s)',
    (textStatus) => {
      const { section } = renderSection({ ...SUMMARY, text: null, textStatus });

      expect(within(section).queryByText('Moderator')).not.toBeInTheDocument();
      expect(within(section).queryByRole('status')).not.toBeInTheDocument();
      expect(within(section).getAllByRole('listitem')).toHaveLength(8);
    },
  );

  it('leaves out what did not happen and uses the singular', () => {
    const { section } = renderSection(
      {
        ...SUMMARY,
        text: null,
        textStatus: 'none',
        decisions: [],
        criteriaChanges: 1,
        boards: [
          { boardId: MAIN, title: 'Haupt-Canvas', isNew: false, changed: 1, by: [], authors: 1 },
        ],
        messages: { count: 1, mentions: 0, by: [], authors: 1 },
      },
      0,
    );

    expect(
      within(section)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual(['1 Kriterium geändert', 'Haupt-Canvas: 1 Änderung', '1 neue Nachricht']);
  });
});
