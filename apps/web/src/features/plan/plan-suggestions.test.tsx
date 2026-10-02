import { planNodesFromMarkdown, type PlanState } from '@covibes/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlanSuggestions } from '@web/features/plan/plan-suggestions';

const SCOPE = '11111111-1111-4111-8111-111111111111';
const MILESTONES = '22222222-2222-4222-8222-222222222222';

const QUIET: PlanState = {
  suggestions: [],
  generating: false,
  failure: null,
  outdated: null,
  upToDate: false,
};

const STATE: PlanState = {
  ...QUIET,
  suggestions: [
    {
      id: SCOPE,
      section: 'scope',
      createdAt: '2026-10-02T18:00:00.000Z',
      kind: 'generate',
      handEdited: false,
      content: planNodesFromMarkdown(
        'Die erste Version:\n\n- Mitgliederliste\n- **Login** per Link',
      ),
    },
    {
      id: MILESTONES,
      section: 'milestones',
      createdAt: '2026-10-02T18:00:00.000Z',
      kind: 'generate',
      handEdited: false,
      content: planNodesFromMarkdown(
        '### Meilenstein 1: Grundgerüst\n\n1. Datenmodell\n2. *Login*',
      ),
    },
  ],
};

function renderSuggestions(
  state: PlanState = STATE,
  props: Partial<Parameters<typeof PlanSuggestions>[0]> = {},
) {
  const onDecide = vi.fn();
  const onUpdate = vi.fn();
  render(
    <PlanSuggestions
      state={state}
      language="de"
      onDecide={onDecide}
      onUpdate={onUpdate}
      {...props}
    />,
  );
  return { onDecide, onUpdate };
}

describe('PlanSuggestions', () => {
  it('shows a card per suggested section with its text, in the look of the plan', () => {
    renderSuggestions();

    const section = screen.getByRole('region', { name: 'Vorschläge des Moderators' });
    expect(section).toHaveTextContent('Moderator· 2 Vorschläge für den Plan');
    const cards = within(section).getAllByRole('listitem', { name: /^Vorschlag für/ });
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
      'Vorschlag für „MVP-Umfang“',
      'Vorschlag für „Meilensteine und Aufgaben“',
    ]);
    const [scope, milestones] = cards;
    if (!scope || !milestones) throw new Error('The cards are missing');
    expect(scope).toHaveClass('border-dashed', 'border-agent-moderator');
    expect(within(scope).getByText('MVP-Umfang')).toHaveClass('font-semibold');
    expect(within(scope).getByText('Vorschlag')).toBeInTheDocument();
    expect(within(scope).getByText('Die erste Version:').tagName).toBe('P');
    expect(
      within(scope)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Mitgliederliste', 'Login per Link']);
    expect(within(scope).getByText('Login').tagName).toBe('STRONG');

    expect(within(milestones).getByRole('heading', { level: 3 })).toHaveTextContent(
      'Meilenstein 1: Grundgerüst',
    );
    expect(milestones.querySelector('ol')).toBeInTheDocument();
    expect(within(milestones).getByText('Login').tagName).toBe('EM');
  });

  it('accepts and rejects a suggestion, and accepts all at once', () => {
    const { onDecide } = renderSuggestions();

    fireEvent.click(screen.getByRole('button', { name: '„MVP-Umfang“ übernehmen' }));
    expect(onDecide).toHaveBeenLastCalledWith({ suggestionId: SCOPE, decision: 'accept' });
    fireEvent.click(screen.getByRole('button', { name: '„Meilensteine und Aufgaben“ verwerfen' }));
    expect(onDecide).toHaveBeenLastCalledWith({ suggestionId: MILESTONES, decision: 'reject' });
    fireEvent.click(screen.getByRole('button', { name: 'Alle übernehmen' }));
    expect(onDecide).toHaveBeenLastCalledWith({ suggestionId: null, decision: 'accept' });
    expect(onDecide).toHaveBeenCalledTimes(3);
  });

  it('shows the suggestions without buttons to someone who only reads', () => {
    renderSuggestions(STATE, { onDecide: undefined, onUpdate: undefined });

    expect(screen.getAllByRole('listitem', { name: /^Vorschlag für/ })).toHaveLength(2);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('names the sections in the language of the project and offers "all" only for several', () => {
    const [first] = STATE.suggestions;
    renderSuggestions({ ...STATE, suggestions: first ? [first] : [] }, { language: 'en' });

    expect(screen.getByRole('listitem', { name: 'Vorschlag für „MVP scope“' })).toBeInTheDocument();
    expect(screen.getByText('· 1 Vorschlag für den Plan')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alle übernehmen' })).not.toBeInTheDocument();
  });

  it('says so while the moderator writes', () => {
    renderSuggestions({ ...QUIET, generating: true });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Der Moderator schreibt den Plan … Das dauert etwa eine Minute.',
    );
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('says why a generation gave nothing', () => {
    const failed = render(
      <PlanSuggestions
        state={{ ...QUIET, failure: { kind: 'failed', resetsAt: null } }}
        language="de"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Der Plan konnte nicht erzeugt werden. Am Plan hat sich nichts geändert.',
    );
    failed.unmount();

    const quota = render(
      <PlanSuggestions
        state={{ ...QUIET, failure: { kind: 'quota', resetsAt: null } }}
        language="de"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Das KI-Kontingent ist gerade aufgebraucht. Am Plan hat sich nichts geändert.',
    );
    quota.unmount();

    render(
      <PlanSuggestions
        state={{
          ...QUIET,
          failure: { kind: 'quota', resetsAt: new Date(2026, 9, 2, 22, 30).toISOString() },
        }}
        language="de"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('und ab 22:30 wieder frei');
  });

  it('is nothing while nothing waits', () => {
    const { container } = render(<PlanSuggestions state={QUIET} language="de" />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('an outdated plan (spec 25c)', () => {
  const OUTDATED: PlanState = {
    ...QUIET,
    outdated: {
      changes: [
        { kind: 'reopened', topic: 'Hosting' },
        { kind: 'decided', topic: 'Zahlung' },
        { kind: 'criteria', topic: null },
      ],
      more: 2,
    },
  };

  it('says what changed and offers the update', () => {
    const { onUpdate } = renderSuggestions(OUTDATED);

    const note = screen.getByRole('status');
    expect(note).toHaveTextContent('Der Plan ist nicht mehr aktuell');
    expect(note).toHaveTextContent(
      'Seit dem letzten Stand: „Hosting“ wurde wieder geöffnet, „Zahlung“ wurde entschieden, die Kriterien haben sich geändert und 2 weitere Änderungen.',
    );
    fireEvent.click(within(note).getByRole('button', { name: 'Aktualisieren' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('tells viewers without offering the update', () => {
    renderSuggestions(OUTDATED, { onDecide: undefined, onUpdate: undefined });

    expect(screen.getByRole('status')).toHaveTextContent('Der Plan ist nicht mehr aktuell');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('steps back while the moderator writes or its suggestions wait', () => {
    const writing = render(
      <PlanSuggestions state={{ ...OUTDATED, generating: true }} language="de" />,
    );
    expect(screen.queryByText('Der Plan ist nicht mehr aktuell')).not.toBeInTheDocument();
    writing.unmount();

    render(
      <PlanSuggestions state={{ ...OUTDATED, suggestions: STATE.suggestions }} language="de" />,
    );
    expect(screen.queryByText('Der Plan ist nicht mehr aktuell')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem', { name: /^Vorschlag für/ })).toHaveLength(2);
  });

  it('says so when an update found nothing to change', () => {
    renderSuggestions({ ...QUIET, upToDate: true });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Der Moderator hat den Plan geprüft: Es muss nichts geändert werden.',
    );
  });
});

describe('the suggestion of an update (spec 25c)', () => {
  const UPDATE: PlanState = {
    ...QUIET,
    suggestions: [
      {
        id: SCOPE,
        section: 'tech',
        createdAt: '2026-10-02T18:00:00.000Z',
        kind: 'update',
        handEdited: true,
        content: planNodesFromMarkdown('React.\n\nHosting bei einem verwalteten Dienst.'),
      },
    ],
  };
  const sections = { tech: planNodesFromMarkdown('React.\n\nHosting auf einem eigenen Server.') };

  it('shows what it changes in its section, and the whole text on request', () => {
    renderSuggestions(UPDATE, { sections });

    const card = screen.getByRole('listitem', { name: 'Vorschlag für „Tech-Empfehlung“' });
    expect(within(card).getByText('Aktualisierung')).toBeInTheDocument();
    expect(card).toHaveTextContent(
      'Dieser Abschnitt wurde von Hand geändert. Schau nach, ob eure Änderungen erhalten bleiben.',
    );
    const lines = within(card)
      .getAllByRole('listitem')
      .map((line) => line.textContent);
    expect(lines).toEqual([
      'React.',
      'entfällt: Hosting auf einem eigenen Server.',
      'neu: Hosting bei einem verwalteten Dienst.',
    ]);
    expect(within(card).getByText('Hosting auf einem eigenen Server.')).toHaveClass(
      'bg-danger-bg',
      'line-through',
    );
    expect(within(card).getByText('Hosting bei einem verwalteten Dienst.')).toHaveClass(
      'bg-success-bg',
    );

    const toggle = within(card).getByRole('button', {
      name: 'Ansicht für „Tech-Empfehlung“ wechseln',
    });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveTextContent('Ganzen Text anzeigen');
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent('Änderungen anzeigen');
    expect(within(card).queryByText(/entfällt/)).not.toBeInTheDocument();
    expect(within(card).getByText('Hosting bei einem verwalteten Dienst.').tagName).toBe('P');
  });

  it('shows the text of a generation first, with the changes one click away', () => {
    const [update] = UPDATE.suggestions;
    renderSuggestions(
      { ...QUIET, suggestions: update ? [{ ...update, kind: 'generate', handEdited: false }] : [] },
      { sections },
    );

    const card = screen.getByRole('listitem', { name: 'Vorschlag für „Tech-Empfehlung“' });
    expect(within(card).queryByText(/von Hand geändert/)).not.toBeInTheDocument();
    expect(within(card).getByText('Hosting bei einem verwalteten Dienst.').tagName).toBe('P');
    fireEvent.click(within(card).getByRole('button', { name: /Ansicht für/ }));
    expect(within(card).getByText(/entfällt/)).toBeInTheDocument();
  });

  it('has nothing to compare with while its section is empty or missing', () => {
    renderSuggestions(UPDATE, { sections: { tech: [{ type: 'paragraph' }] } });

    const card = screen.getByRole('listitem', { name: 'Vorschlag für „Tech-Empfehlung“' });
    expect(within(card).queryByRole('button', { name: /Ansicht für/ })).not.toBeInTheDocument();
    expect(within(card).getByText('React.').tagName).toBe('P');
  });
});
