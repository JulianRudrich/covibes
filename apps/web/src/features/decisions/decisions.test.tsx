import type { Criterion, Decision, DecisionLogEntry } from '@covibes/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CriteriaSection } from '@web/features/decisions/criteria-section';
import { DecisionsSection } from '@web/features/decisions/decisions-section';

const CANVAS: Decision = {
  id: '11111111-1111-4111-8111-111111111111',
  topic: 'Canvas',
  status: 'decided',
  value: 'React Flow',
  reasoning: 'Strukturierte Blöcke und MIT-Lizenz.',
  alternatives: [{ name: 'tldraw', note: 'Lizenz' }],
  decidedBy: 'Sam',
  decidedAt: '2026-09-30T18:00:00.000Z',
  reopenReason: null,
  comparison: null,
  tally: null,
};

const HOSTING: Decision = {
  id: '22222222-2222-4222-8222-222222222222',
  topic: 'Hosting des Servers',
  status: 'open',
  value: null,
  reasoning: '',
  alternatives: [],
  decidedBy: null,
  decidedAt: null,
  reopenReason: 'Zu teuer im Betrieb',
  comparison: null,
  tally: null,
};

function renderDecisions(
  props: Partial<Parameters<typeof DecisionsSection>[0]> = {},
  decisions = [CANVAS, HOSTING],
) {
  const onOpenLog = vi.fn();
  render(
    <DecisionsSection decisions={decisions} log={undefined} onOpenLog={onOpenLog} {...props} />,
  );
  return { onOpenLog, section: screen.getByRole('region', { name: 'Entscheidungen' }) };
}

describe('DecisionsSection', () => {
  it('shows decided and open topics as in the handoff', () => {
    const { section } = renderDecisions();

    const [canvas, hosting] = within(section).getAllByRole('listitem');
    if (!canvas || !hosting) throw new Error('The rows are missing');
    expect(canvas).toHaveTextContent('CanvasReact Flow');
    expect(canvas.querySelector('.bg-success-bg')).toBeInTheDocument();
    expect(within(canvas).getByText('React Flow')).toHaveClass('text-body', 'font-medium');
    expect(within(canvas).getByText('Canvas')).toHaveClass('text-meta', 'text-text-3');

    expect(hosting).toHaveTextContent('Hosting des ServersNoch nicht entschiedenoffen');
    expect(hosting.querySelector('.border-dashed')).toBeInTheDocument();
    expect(within(hosting).getByText('offen')).toHaveClass('bg-bg-subtle');
    expect(hosting).toHaveClass('border-divider-row');
  });

  it('says so while nothing is decided', () => {
    const { section } = renderDecisions({}, []);
    expect(section).toHaveTextContent('Noch keine Entscheidungen.');
  });

  it('opens a decision with its reasoning and lets owners and editors reopen it', () => {
    const onReopen = vi.fn();
    renderDecisions({ onReopen });

    fireEvent.click(screen.getByRole('button', { name: /Canvas/ }));
    const dialog = screen.getByRole('dialog', { name: 'Canvas' });
    expect(dialog).toHaveTextContent('Bestätigt von Sam');
    expect(dialog).toHaveTextContent('Strukturierte Blöcke und MIT-Lizenz.');
    expect(dialog).toHaveTextContent('Verworfentldraw – Lizenz');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Wieder öffnen' }));
    const submit = within(dialog).getByRole('button', { name: 'Wieder öffnen' });
    expect(submit).toBeDisabled();
    fireEvent.change(
      within(dialog).getByLabelText('Warum soll die Entscheidung wieder offen sein?'),
      { target: { value: '  Die Lizenz hat sich geändert ' } },
    );
    fireEvent.click(submit);

    expect(onReopen).toHaveBeenCalledWith(CANVAS, 'Die Lizenz hat sich geändert');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows why a decision is open again, and offers viewers no reopening', () => {
    renderDecisions();

    fireEvent.click(screen.getByRole('button', { name: /Hosting des Servers/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Wieder offen: Zu teuer im Betrieb');
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));

    fireEvent.click(screen.getByRole('button', { name: /Canvas/ }));
    expect(screen.queryByRole('button', { name: 'Wieder öffnen' })).not.toBeInTheDocument();
  });

  it('shows the comparison a decision followed and the result of its vote', () => {
    const voted: Decision = {
      ...CANVAS,
      decidedBy: null,
      tally: [
        { name: 'React Flow', votes: 2 },
        { name: 'tldraw', votes: 1 },
      ],
      comparison: {
        topic: 'Canvas',
        options: ['React Flow', 'tldraw'],
        rows: [
          {
            criterion: 'Budget',
            cells: [
              { rating: 'good', note: 'MIT' },
              { rating: 'bad', note: 'kostet' },
            ],
          },
        ],
        recommendation: null,
      },
    };
    renderDecisions({}, [voted]);

    fireEvent.click(screen.getByRole('button', { name: /Canvas/ }));
    const dialog = screen.getByRole('dialog', { name: 'Canvas' });
    expect(dialog).toHaveTextContent('Per Abstimmung entschieden (React Flow 2 · tldraw 1)');
    expect(within(dialog).getByRole('group', { name: 'Vergleich · Canvas' })).toHaveTextContent(
      'Budget',
    );
  });

  it('opens the decision log, newest first', () => {
    const log: DecisionLogEntry[] = [
      {
        id: 'l3',
        kind: 'reopened',
        decisionId: CANVAS.id,
        topic: 'Canvas',
        value: 'React Flow',
        reason: 'Die Lizenz hat sich geändert',
        user: 'Olga',
        agentKey: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'l2',
        kind: 'decided',
        decisionId: CANVAS.id,
        topic: 'Canvas',
        value: 'React Flow',
        reasoning: 'MIT-Lizenz',
        alternatives: [{ name: 'tldraw', note: 'Lizenz' }],
        user: 'Sam',
        agentKey: 'moderator',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'l1',
        kind: 'criterion_changed',
        decisionId: null,
        topic: null,
        value: 'Hosting in der EU',
        previous: 'EU-Hosting',
        user: null,
        agentKey: 'moderator',
        createdAt: new Date().toISOString(),
      },
    ];
    const { onOpenLog } = renderDecisions({ log });

    fireEvent.click(screen.getByRole('button', { name: 'Protokoll' }));
    expect(onOpenLog).toHaveBeenCalledOnce();
    const entries = within(screen.getByRole('dialog', { name: 'Entscheidungsprotokoll' }))
      .getAllByRole('listitem')
      .map((entry) => entry.textContent);
    expect(entries[0]).toContain('Canvas wieder geöffnet (war: React Flow)');
    expect(entries[0]).toContain('Grund: Die Lizenz hat sich geändert');
    expect(entries[0]).toContain('Olga · ');
    expect(entries[1]).toContain('Entschieden: Canvas – React Flow');
    expect(entries[1]).toContain('Verworfen: tldraw');
    expect(entries[1]).toContain('Sam · Moderator · ');
    expect(entries[2]).toContain('Kriterium EU-Hosting geändert zu Hosting in der EU');
  });
});

const CRITERIA: Criterion[] = [
  { id: 'c1', text: 'EU-Hosting' },
  { id: 'c2', text: 'Team: 3 Devs' },
];

function renderCriteria(editable = true, criteria = CRITERIA) {
  const edit = { onAdd: vi.fn(), onChange: vi.fn(), onRemove: vi.fn() };
  render(<CriteriaSection criteria={criteria} edit={editable ? edit : undefined} />);
  return { ...edit, section: screen.getByRole('region', { name: 'Kriterien' }) };
}

describe('CriteriaSection', () => {
  it('shows the criteria as chips, read-only for viewers', () => {
    const { section } = renderCriteria(false);

    const chips = within(section).getAllByRole('listitem');
    expect(chips.map((chip) => chip.textContent)).toEqual(['EU-Hosting', 'Team: 3 Devs']);
    expect(chips[0]?.firstElementChild).toHaveClass(
      'h-[26px]',
      'rounded-btn-s',
      'border-border-soft',
      'bg-bg-muted',
      'text-small',
      'text-text-chip',
    );
    expect(within(section).queryByRole('button')).not.toBeInTheDocument();
  });

  it('says so while there are none', () => {
    const { section } = renderCriteria(false, []);
    expect(section).toHaveTextContent('Noch keine Kriterien.');
  });

  it('lets owners and editors change a criterion in place', () => {
    const { onChange } = renderCriteria();

    fireEvent.click(screen.getByRole('button', { name: 'Kriterium „EU-Hosting“ ändern' }));
    const input = screen.getByRole('textbox', { name: 'Kriterium „EU-Hosting“ ändern' });
    expect(input).toHaveValue('EU-Hosting');
    fireEvent.change(input, { target: { value: ' Hosting in der EU ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith({ id: 'c1', text: 'Hosting in der EU' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('keeps a criterion on Escape or without a change, and removes an emptied one', () => {
    const { onChange, onRemove } = renderCriteria();

    fireEvent.click(screen.getByRole('button', { name: 'Kriterium „EU-Hosting“ ändern' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Anders' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Kriterium „EU-Hosting“ ändern' }));
    fireEvent.blur(screen.getByRole('textbox'));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Kriterium „Team: 3 Devs“ ändern' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  ' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onRemove).toHaveBeenCalledWith('c2');
  });

  it('removes with the cross and adds with the plus', () => {
    const { onAdd, onRemove } = renderCriteria();

    fireEvent.click(screen.getByRole('button', { name: 'Kriterium „Team: 3 Devs“ entfernen' }));
    expect(onRemove).toHaveBeenCalledWith('c2');

    fireEvent.click(screen.getByRole('button', { name: 'Kriterium hinzufügen' }));
    const input = screen.getByRole('textbox', { name: 'Kriterium hinzufügen' });
    fireEvent.change(input, { target: { value: 'Qualität vor Kosten' } });
    fireEvent.blur(input);
    expect(onAdd).toHaveBeenCalledWith('Qualität vor Kosten');

    // Leaving the new chip empty adds nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Kriterium hinzufügen' }));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('offers no more criteria at the limit', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      id: `c${String(index)}`,
      text: `Kriterium ${String(index)}`,
    }));
    renderCriteria(true, many);
    expect(screen.queryByRole('button', { name: 'Kriterium hinzufügen' })).not.toBeInTheDocument();
  });
});
