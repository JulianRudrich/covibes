import type { AgentKey } from '@covibes/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import { ChatMessageView } from '@web/features/chat/chat-message';
import { MentionText } from '@web/features/chat/mention-text';
import type { ChatItem } from '@web/features/chat/types';
import { i18n } from '@web/i18n';

// A local time, so the expected clock time holds in every time zone.
const CREATED_AT = new Date(2026, 8, 28, 14, 5).toISOString();

function human(overrides: Partial<ChatItem> = {}): ChatItem {
  return {
    id: 'message-1',
    projectId: 'project-1',
    author: { kind: 'human', userId: 'user-alex', name: 'Alex Adams' },
    content: 'Die Architektur steht fast. Was machen wir mit den AI-Kosten?',
    mentions: [],
    replyTo: null,
    status: 'complete',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function agentMessage(agentKey: AgentKey): ChatItem {
  return human({
    id: `message-${agentKey}`,
    author: { kind: 'agent', agentKey },
    content: 'Ich habe die Architektur nach euren Kriterien gezeichnet.',
  });
}

function messageText(article: HTMLElement): HTMLElement {
  const paragraph = article.querySelector('p');
  if (!paragraph) throw new Error('The message has no text paragraph.');
  return paragraph;
}

describe('ChatMessageView', () => {
  it('shows another person with a round avatar, the name and the time', () => {
    render(<ChatMessageView item={human()} isOwn={false} />);
    const article = screen.getByRole('article', { name: 'Alex Adams 14:05' });

    const avatar = article.querySelector('[role="img"]');
    expect(avatar).toHaveClass('rounded-full', 'bg-human-avatar-bg', 'size-7');
    expect(avatar).toHaveTextContent('AA');
    expect(within(article).getByText('Alex Adams')).toHaveClass('font-semibold', 'text-text');
    expect(within(article).queryByText('Agent')).not.toBeInTheDocument();
    expect(messageText(article)).toHaveTextContent('Die Architektur steht fast.');
  });

  it('keeps the avatar out of the accessibility tree, since the name is next to it', () => {
    render(<ChatMessageView item={human()} isOwn={false} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows the signed-in user as "Du" in name and avatar', () => {
    render(<ChatMessageView item={human()} isOwn />);
    const article = screen.getByRole('article', { name: 'Du 14:05' });

    expect(article.querySelector('[role="img"]')).toHaveTextContent('Du');
    expect(article).not.toHaveTextContent('Alex');
  });

  it('renders the time as a machine-readable, tabular clock time', () => {
    render(<ChatMessageView item={human()} isOwn={false} />);
    const time = screen.getByText('14:05');

    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', CREATED_AT);
    expect(time).toHaveClass('text-meta', 'text-text-4', 'tabular-nums');
  });

  it('follows the language of the app', () => {
    const english = i18n.cloneInstance({ lng: 'en' });
    render(
      <I18nextProvider i18n={english}>
        <ChatMessageView item={human()} isOwn />
      </I18nextProvider>,
    );

    expect(screen.getByRole('article', { name: /^You 2:05\sPM$/ })).toBeInTheDocument();
  });

  it.each([
    ['backend', 'Backend', 'B'],
    ['critic', 'Kritiker', 'K'],
    ['data', 'Daten', 'D'],
  ] as const)('shows the %s agent in its colors with the badge "Agent"', (key, name, initial) => {
    render(<ChatMessageView item={agentMessage(key)} isOwn={false} />);
    const article = screen.getByRole('article', { name: `${name} Agent 14:05` });

    const avatar = article.querySelector('[role="img"]');
    expect(avatar).toHaveClass(`bg-agent-${key}`, 'rounded-md', 'size-7', 'text-status');
    expect(avatar).not.toHaveClass('rounded-full');
    expect(avatar).toHaveTextContent(initial);
    expect(within(article).getByText(name)).toHaveClass(`text-agent-${key}-dark`, 'font-semibold');
    expect(within(article).getByText('Agent')).toHaveClass(
      `bg-agent-${key}-tint`,
      `text-agent-${key}-dark`,
    );
  });

  it('shows the moderator in its card with the badge "Agent · neutral"', () => {
    render(<ChatMessageView item={agentMessage('moderator')} isOwn={false} />);
    const card = screen.getByRole('article', { name: 'Moderator Agent · neutral 14:05' });

    expect(card).toHaveClass(
      'rounded-panel',
      'border-agent-moderator-border',
      'bg-agent-moderator-tint-2',
      'p-3',
    );
    const avatar = card.querySelector('[role="img"]');
    expect(avatar).toHaveClass('bg-agent-moderator', 'size-6', 'rounded-btn-s');
    expect(avatar).toHaveTextContent('M');
    expect(within(card).getByText('Moderator')).toHaveClass('text-agent-moderator-dark');
    expect(within(card).getByText('Agent · neutral')).toHaveClass('bg-agent-moderator-tint');
    expect(within(card).getByText('14:05')).toHaveClass('ml-auto');
  });

  it('ignores "isOwn" for agents', () => {
    render(<ChatMessageView item={agentMessage('backend')} isOwn />);

    expect(screen.getByRole('article', { name: 'Backend Agent 14:05' })).toBeInTheDocument();
  });

  it('marks a message that is still being sent', () => {
    render(<ChatMessageView item={human({ delivery: 'sending' })} isOwn onRetry={vi.fn()} />);
    const article = screen.getByRole('article', { name: 'Du 14:05 Wird gesendet …' });

    expect(article).toHaveClass('opacity-60');
    expect(within(article).getByText('Wird gesendet …')).toHaveClass('sr-only');
    expect(within(article).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows a failed message with an error and sends it again on request', () => {
    const onRetry = vi.fn();
    render(<ChatMessageView item={human({ delivery: 'failed' })} isOwn onRetry={onRetry} />);
    const article = screen.getByRole('article', { name: 'Du 14:05 Nicht gesendet.' });

    expect(article).not.toHaveClass('opacity-60');
    expect(within(article).getByText('Nicht gesendet.')).toHaveClass('text-danger');
    fireEvent.click(within(article).getByRole('button', { name: 'Erneut senden' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith('message-1');
  });

  it('offers no retry without a handler', () => {
    render(<ChatMessageView item={human({ delivery: 'failed' })} isOwn />);

    expect(screen.getByText('Nicht gesendet.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows confirmed messages without a delivery state', () => {
    render(<ChatMessageView item={human()} isOwn />);
    const article = screen.getByRole('article', { name: 'Du 14:05' });

    expect(article).not.toHaveClass('opacity-60');
    expect(article).not.toHaveTextContent(/Wird gesendet|Nicht gesendet/);
  });

  it('renders chips only for mentions of known agents, in the agent colors', () => {
    const content =
      '@Backend, passt das? @Kritiker und @moderator, @Sam schaut auch. Mail: sam@data.dev';
    render(
      <ChatMessageView
        item={human({ content, mentions: ['backend', 'critic', 'moderator'] })}
        isOwn={false}
      />,
    );
    const text = messageText(screen.getByRole('article'));

    const chips = Array.from(text.querySelectorAll('span.rounded-xs'));
    expect(chips.map((chip) => chip.textContent)).toEqual(['@Backend', '@Kritiker', '@moderator']);
    expect(within(text).getByText('@Backend')).toHaveClass(
      'bg-agent-backend-tint',
      'text-agent-backend-dark',
      'px-[5px]',
      'py-0.5',
      'font-medium',
    );
    expect(within(text).getByText('@Kritiker')).toHaveClass(
      'bg-agent-critic-tint',
      'text-agent-critic-dark',
    );
    expect(within(text).getByText('@moderator')).toHaveClass(
      'bg-agent-moderator-tint',
      'text-agent-moderator-dark',
    );
    expect(within(text).queryByText('@Sam')).not.toBeInTheDocument();
    expect(text).toHaveTextContent(content);
  });

  it('shows web addresses as links that open in a new tab, next to mentions', () => {
    const content =
      '@Backend lies https://example.org/preise?plan=basis. Quellen: https://a.example/x, [Doku](https://b.example/y)';
    render(<ChatMessageView item={human({ content, mentions: ['backend'] })} isOwn={false} />);
    const text = messageText(screen.getByRole('article'));

    const links = within(text).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['https://example.org/preise?plan=basis', 'https://example.org/preise?plan=basis'],
      ['https://a.example/x', 'https://a.example/x'],
      ['Doku', 'https://b.example/y'],
    ]);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(within(text).getByText('@Backend')).toHaveClass('bg-agent-backend-tint');
    // Nothing but web addresses becomes a link.
    render(
      <ChatMessageView item={human({ content: 'javascript:alert(1) www.example.org' })} isOwn />,
    );
    expect(within(screen.getAllByRole('article')[1] as HTMLElement).queryByRole('link')).toBeNull();
  });

  it('shows a chip for the people the server found mentioned, the own one stronger (spec 22a)', () => {
    const people = [
      { userId: 'user-alex', name: 'Alex Berg' },
      { userId: 'user-olga', name: 'Olga' },
      { userId: 'user-sam', name: 'Sam' },
    ];
    render(
      <ChatMessageView
        item={human({
          content: '@Alex-Berg und @olga, fragt @Backend. @Sam war nicht gemeint.',
          mentions: ['backend'],
          mentionedUsers: ['user-alex', 'user-olga'],
        })}
        isOwn={false}
        people={people}
        currentUserId="user-olga"
      />,
    );
    const text = messageText(screen.getByRole('article'));

    const chips = Array.from(text.querySelectorAll('span.rounded-xs'));
    expect(chips.map((chip) => chip.textContent)).toEqual(['@Alex-Berg', '@olga', '@Backend']);
    expect(within(text).getByText('@Alex-Berg')).toHaveClass('bg-bg-subtle', 'text-text');
    // The reader's own mention stands out.
    expect(within(text).getByText('@olga')).toHaveClass('bg-ink', 'text-on-ink');
    expect(within(text).getByText('@Backend')).toHaveClass('bg-agent-backend-tint');
    // Sam is a member, but the server stored no mention of them.
    expect(within(text).queryByText('@Sam')).not.toBeInTheDocument();
  });

  it('shows no chip for an agent that the server did not keep, e.g. one outside the team', () => {
    const content = '@Sicherheit und @Moderator, was meint ihr?';
    render(<ChatMessageView item={human({ content, mentions: ['moderator'] })} isOwn={false} />);
    const text = messageText(screen.getByRole('article'));

    const chips = Array.from(text.querySelectorAll('span.rounded-xs'));
    expect(chips.map((chip) => chip.textContent)).toEqual(['@Moderator']);
    expect(text).toHaveTextContent(content);
  });

  it('shows chips in agent answers for the agents of the team', () => {
    render(
      <ChatMessageView
        item={{ ...agentMessage('moderator'), content: 'Fragt @Backend oder @Sicherheit.' }}
        isOwn={false}
        team={['moderator', 'backend']}
      />,
    );
    const text = messageText(screen.getByRole('article'));

    const chips = Array.from(text.querySelectorAll('span.rounded-xs'));
    expect(chips.map((chip) => chip.textContent)).toEqual(['@Backend']);
  });

  it('shows the avatar letters of the catalog agents', () => {
    render(<ChatMessageView item={agentMessage('ml')} isOwn={false} />);
    // The name is right next to it, so the avatar itself is hidden from screen readers.
    const avatar = screen.getByRole('article').querySelector('.bg-agent-ml');
    expect(avatar).toHaveTextContent('ML');
  });

  it('keeps line breaks and lets long words wrap', () => {
    const content = 'Erste Zeile\nZweite Zeile\n\n@Daten, dritte Zeile';
    render(<ChatMessageView item={human({ content, mentions: ['data'] })} isOwn={false} />);
    const text = messageText(screen.getByRole('article'));

    expect(text).toHaveTextContent(content, { normalizeWhitespace: false });
    expect(text).toHaveClass('text-body', 'leading-[1.55]', 'text-text-body', 'wrap-break-word');
    expect(within(text).getByText('@Daten')).toHaveClass('bg-agent-data-tint');
  });

  it('shows a streaming answer with typing dots instead of the time and a blinking caret', () => {
    render(
      <ChatMessageView
        item={{ ...agentMessage('backend'), status: 'streaming', content: 'Ich schau' }}
        isOwn={false}
      />,
    );
    const article = screen.getByRole('article', { name: 'Backend Agent schreibt' });

    expect(within(article).queryByText('14:05')).not.toBeInTheDocument();
    expect(within(article).getByText('schreibt')).toHaveClass('text-agent-backend-dark');
    const text = messageText(article);
    expect(text).toHaveTextContent('Ich schau');
    expect(text.querySelector('.animate-caret-blink')).toHaveClass('bg-agent-backend');
  });

  it('shows only the caret while a streaming answer is still empty', () => {
    render(
      <ChatMessageView
        item={{ ...agentMessage('moderator'), status: 'streaming', content: '' }}
        isOwn={false}
      />,
    );
    const text = messageText(screen.getByRole('article'));

    expect(text).toHaveTextContent('');
    expect(text.querySelector('.animate-caret-blink')).toBeInTheDocument();
  });

  it('shows the finished answer without dots and caret', () => {
    render(<ChatMessageView item={agentMessage('moderator')} isOwn={false} />);
    const article = screen.getByRole('article');

    expect(within(article).queryByText('schreibt')).not.toBeInTheDocument();
    expect(article.querySelector('.animate-caret-blink')).not.toBeInTheDocument();
  });

  it('says whom an answer replies to', () => {
    render(
      <ChatMessageView item={agentMessage('moderator')} isOwn={false} replyToName="Sam Stone" />,
    );

    expect(screen.getByText('Antwort an Sam Stone')).toHaveClass('text-meta', 'text-text-3');
  });

  it('marks an agent answer that failed', () => {
    render(
      <ChatMessageView
        item={{
          ...agentMessage('moderator'),
          status: 'error',
          content: 'Ich konnte gerade nicht antworten.',
        }}
        isOwn={false}
      />,
    );

    expect(screen.getByText('Die Antwort ist fehlgeschlagen.')).toHaveClass('text-danger');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('offers of help (spec 15)', () => {
  function offerMessage(overrides: Partial<NonNullable<ChatItem['offer']>> = {}): ChatItem {
    return {
      ...agentMessage('moderator'),
      content: 'Ihr seid euch einig: React Flow. Soll ich das festhalten?',
      offer: {
        id: '33333333-3333-4333-8333-333333333333',
        kind: 'consensus',
        action: 'Ja, festhalten',
        status: 'open',
        decidedBy: null,
        ...overrides,
      },
    };
  }

  it('offers its action and "Später" in the moderator card', () => {
    const onOffer = vi.fn();
    const item = offerMessage();
    render(<ChatMessageView item={item} isOwn={false} onOffer={onOffer} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ja, festhalten' }));
    expect(onOffer).toHaveBeenCalledWith(item, true);
    expect(screen.getByRole('button', { name: 'Ja, festhalten' })).toHaveClass('bg-ink');
    fireEvent.click(screen.getByRole('button', { name: 'Später' }));
    expect(onOffer).toHaveBeenCalledWith(item, false);
  });

  it('shows viewers no buttons', () => {
    render(<ChatMessageView item={offerMessage()} isOwn={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('replaces the buttons with who decided', () => {
    const { rerender } = render(
      <ChatMessageView
        item={offerMessage({ status: 'accepted', decidedBy: 'Sam' })}
        isOwn={false}
        onOffer={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Angenommen von Sam')).toHaveClass(
      'border-agent-moderator-divider',
      'text-agent-moderator-dark',
    );

    rerender(
      <ChatMessageView
        item={offerMessage({ status: 'declined', decidedBy: null })}
        isOwn={false}
      />,
    );
    expect(screen.getByText('Verschoben')).toBeInTheDocument();
  });
});

describe('comparison and vote (spec 16b)', () => {
  const comparison: NonNullable<ChatItem['comparison']> = {
    topic: 'Canvas',
    options: ['React Flow', 'tldraw'],
    rows: [
      {
        criterion: 'Kleines Budget',
        cells: [
          { rating: 'good', note: 'MIT-Lizenz' },
          { rating: 'bad', note: '' },
        ],
      },
    ],
    recommendation: { option: 'React Flow', reason: 'Passt zum Budget.' },
  };

  it('shows the comparison as a card in the moderator message', () => {
    render(<ChatMessageView item={{ ...agentMessage('moderator'), comparison }} isOwn={false} />);

    const card = screen.getByRole('group', { name: 'Vergleich · Canvas' });
    expect(card).toHaveTextContent('React Flowtldraw');
    expect(card).toHaveTextContent('Kleines Budget');
    expect(card).toHaveTextContent('React Flow: passt. MIT-Lizenz');
    // Without a note the rating itself is the text.
    expect(card).toHaveTextContent('tldraw: passt nicht. passt nicht');
    expect(card).toHaveTextContent('Empfehlung: React Flow – Passt zum Budget.');
    expect(card.querySelector('.text-success')).toBeInTheDocument();
    expect(card.querySelector('.text-danger')).toBeInTheDocument();
  });

  const vote: NonNullable<ChatItem['vote']> = {
    id: '44444444-4444-4444-8444-444444444444',
    topic: 'Canvas',
    options: ['React Flow', 'tldraw'],
    status: 'open',
    winner: null,
    ballots: [{ userId: 'user-alex', option: 0 }],
  };
  const voters = [
    { userId: 'user-alex', name: 'Alex Adams' },
    { userId: 'user-olga', name: 'Olga Owner' },
  ];

  function renderVote(
    item: NonNullable<ChatItem['vote']>,
    options: { owner?: boolean; viewer?: boolean } = {},
  ) {
    const onVote = vi.fn();
    const onClose = vi.fn();
    render(
      <ChatMessageView
        item={{ ...agentMessage('moderator'), vote: item }}
        isOwn={false}
        voting={{
          voters,
          userId: 'user-olga',
          canVote: !options.viewer,
          canClose: options.owner === true,
          onVote,
          onClose,
        }}
      />,
    );
    return { onVote, onClose, card: screen.getByRole('group', { name: 'Abstimmung · Canvas' }) };
  }

  it('lets owners and editors vote on the card, and owners end the vote', () => {
    const { onVote, onClose, card } = renderVote(vote, { owner: true });

    expect(card).toHaveTextContent('1 von 2 haben abgestimmt');
    const first = within(card).getByRole('button', { name: 'Für React Flow stimmen, 1 Stimme' });
    expect(within(first).getByRole('img', { name: 'Alex Adams' })).toHaveTextContent('AA');
    fireEvent.click(within(card).getByRole('button', { name: 'Für tldraw stimmen, 0 Stimmen' }));
    expect(onVote).toHaveBeenCalledWith(vote, 1);
    fireEvent.click(within(card).getByRole('button', { name: 'Abstimmung beenden' }));
    expect(onClose).toHaveBeenCalledWith(vote);
  });

  it('marks the own vote and offers editors no ending', () => {
    const mine = { ...vote, ballots: [...vote.ballots, { userId: 'user-olga', option: 1 }] };
    const { card } = renderVote(mine);

    expect(within(card).getByRole('button', { name: /tldraw/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(card).getByRole('button', { name: /React Flow/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(card).queryByRole('button', { name: 'Abstimmung beenden' })).toBeNull();
  });

  it('shows viewers the vote without buttons', () => {
    const { card } = renderVote(vote, { viewer: true });
    expect(within(card).queryByRole('button')).toBeNull();
    expect(card).toHaveTextContent('React Flow');
  });

  it('shows the result once the vote is closed: the winner or a tie', () => {
    const closed = { ...vote, status: 'closed' as const, winner: 'React Flow' };
    const { card } = renderVote(closed, { owner: true });
    expect(within(card).queryByRole('button')).toBeNull();
    expect(card).toHaveTextContent('Entschieden: React Flow');
    expect(within(card).getByLabelText('React Flow: 1 Stimme')).toHaveClass('border-success');
  });

  it('says so when a vote ended in a tie', () => {
    const { card } = renderVote({ ...vote, status: 'closed', winner: null });
    expect(card).toHaveTextContent('Gleichstand – keine Entscheidung');
  });

  it('drops "neutral" from the moderator badge when it has its own opinion', () => {
    const { rerender } = render(<ChatMessageView item={agentMessage('moderator')} isOwn={false} />);
    expect(screen.getByText('Agent · neutral')).toBeInTheDocument();
    rerender(
      <ChatMessageView item={agentMessage('moderator')} isOwn={false} moderatorNeutral={false} />,
    );
    expect(screen.queryByText('Agent · neutral')).not.toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
  });
});

describe('MentionText', () => {
  it('keeps the text unchanged when nothing is mentioned', () => {
    const { container } = render(
      <MentionText text={'Zeile eins\n  eingerückt'} agents={['moderator']} />,
    );
    const wrapper = container.firstElementChild;

    expect(wrapper).toHaveClass('whitespace-pre-wrap');
    expect(wrapper?.textContent).toBe('Zeile eins\n  eingerückt');
    expect(wrapper?.children).toHaveLength(0);
  });
});
