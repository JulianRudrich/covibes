import { planNodesFromMarkdown, type PlanState } from '@covibes/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlanSuggestions } from '@web/features/plan/plan-suggestions';

const SCOPE = '11111111-1111-4111-8111-111111111111';
const MILESTONES = '22222222-2222-4222-8222-222222222222';

const STATE: PlanState = {
  generating: false,
  failure: null,
  suggestions: [
    {
      id: SCOPE,
      section: 'scope',
      createdAt: '2026-10-02T18:00:00.000Z',
      content: planNodesFromMarkdown(
        'Die erste Version:\n\n- Mitgliederliste\n- **Login** per Link',
      ),
    },
    {
      id: MILESTONES,
      section: 'milestones',
      createdAt: '2026-10-02T18:00:00.000Z',
      content: planNodesFromMarkdown(
        '### Meilenstein 1: Grundgerüst\n\n1. Datenmodell\n2. *Login*',
      ),
    },
  ],
};

function renderSuggestions(
  state: PlanState = STATE,
  canDecide = true,
  language: 'de' | 'en' = 'de',
) {
  const onDecide = vi.fn();
  render(
    <PlanSuggestions
      state={state}
      language={language}
      onDecide={canDecide ? onDecide : undefined}
    />,
  );
  return { onDecide };
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
    renderSuggestions(STATE, false);

    expect(screen.getAllByRole('listitem', { name: /^Vorschlag für/ })).toHaveLength(2);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('names the sections in the language of the project and offers "all" only for several', () => {
    const [first] = STATE.suggestions;
    renderSuggestions({ ...STATE, suggestions: first ? [first] : [] }, true, 'en');

    expect(screen.getByRole('listitem', { name: 'Vorschlag für „MVP scope“' })).toBeInTheDocument();
    expect(screen.getByText('· 1 Vorschlag für den Plan')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alle übernehmen' })).not.toBeInTheDocument();
  });

  it('says so while the moderator writes', () => {
    renderSuggestions({ suggestions: [], generating: true, failure: null });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Der Moderator schreibt den Plan … Das dauert etwa eine Minute.',
    );
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('says why a generation gave nothing', () => {
    const { unmount } = render(
      <PlanSuggestions
        state={{ suggestions: [], generating: false, failure: { kind: 'failed', resetsAt: null } }}
        language="de"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Der Plan konnte nicht erzeugt werden. Am Plan hat sich nichts geändert.',
    );
    unmount();

    const quota = render(
      <PlanSuggestions
        state={{ suggestions: [], generating: false, failure: { kind: 'quota', resetsAt: null } }}
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
          suggestions: [],
          generating: false,
          failure: { kind: 'quota', resetsAt: new Date(2026, 9, 2, 22, 30).toISOString() },
        }}
        language="de"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('und ab 22:30 wieder frei');
  });

  it('is nothing while nothing waits', () => {
    const { container } = render(
      <PlanSuggestions
        state={{ suggestions: [], generating: false, failure: null }}
        language="de"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
