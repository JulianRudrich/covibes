import type { ChatMessage, MessageDebate } from '@covibes/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatMessageView } from '@web/features/chat/chat-message';
import { messagesQueryKey, type ChatItem } from '@web/features/chat/types';
import { DebateCard } from '@web/features/debates/debate-card';
import { useStopDebate } from '@web/features/debates/queries';

const PROJECT = '0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const CREATED_AT = new Date(2026, 9, 1, 14, 5).toISOString();

const DEBATE: MessageDebate = {
  id: '11111111-1111-4111-8111-111111111111',
  topic: 'Echtzeit-Dienst',
  question: 'Braucht das MVP einen eigenen Echtzeit-Dienst?',
  participants: ['backend', 'critic'],
  rounds: 2,
  turns: 0,
  status: 'running',
  stopped: false,
  stoppedBy: null,
};

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    projectId: PROJECT,
    author: { kind: 'agent', agentKey: 'moderator' },
    content: 'Backend und Kritiker debattieren jetzt.',
    mentions: [],
    replyTo: null,
    status: 'complete',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function renderCard(debate: MessageDebate, canStop = true) {
  const onStop = vi.fn();
  render(<DebateCard debate={debate} onStop={canStop ? onStop : undefined} />);
  return { onStop, card: screen.getByRole('group', { name: 'Debatte · Echtzeit-Dienst' }) };
}

describe('DebateCard', () => {
  it('shows the question, who debates and whose turn it is', () => {
    const { card, onStop } = renderCard({ ...DEBATE, turns: 1 });

    expect(card).toHaveTextContent('Braucht das MVP einen eigenen Echtzeit-Dienst?');
    const [backend, critic] = within(card).getAllByRole('listitem');
    expect(backend).toHaveTextContent('Backend');
    expect(critic).toHaveTextContent('Kritiker');
    expect(critic).toHaveAttribute('aria-current', 'true');
    expect(backend).not.toHaveAttribute('aria-current');
    expect(within(card).getByText('Kritiker')).toHaveClass('text-agent-critic-dark');
    expect(card).toHaveTextContent('Runde 1 von 2 · Kritiker ist dran');

    fireEvent.click(within(card).getByRole('button', { name: 'Debatte beenden' }));
    expect(onStop).toHaveBeenCalledWith({ ...DEBATE, turns: 1 });
  });

  it('counts the rounds as the turns go by', () => {
    const { card } = renderCard({ ...DEBATE, turns: 2 });
    expect(card).toHaveTextContent('Runde 2 von 2 · Backend ist dran');
  });

  it('offers viewers no ending', () => {
    const { card } = renderCard(DEBATE, false);
    expect(card).toHaveTextContent('Runde 1 von 2 · Backend ist dran');
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('says that the debate ends after the turn in progress', () => {
    const { card } = renderCard({ ...DEBATE, turns: 1, stopped: true, stoppedBy: 'Olga' });
    expect(card).toHaveTextContent('Wird nach diesem Beitrag beendet');
    expect(within(card).queryByRole('button')).toBeNull();
    expect(within(card).getAllByRole('listitem')[1]).not.toHaveAttribute('aria-current');
  });

  it('says that the moderator sums up', () => {
    const { card } = renderCard({ ...DEBATE, turns: 4, status: 'summarizing' });
    expect(card).toHaveTextContent('Der Moderator fasst zusammen');
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('shows how the debate ended', () => {
    const { card } = renderCard({ ...DEBATE, turns: 4, status: 'done' });
    expect(card).toHaveTextContent('Beendet nach 2 Runden');
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('names who ended it early, and says so when it was aborted', () => {
    const early = { ...DEBATE, turns: 1, status: 'done' as const, stopped: true };
    const { rerender } = render(<DebateCard debate={{ ...early, stoppedBy: 'Olga' }} />);
    const card = screen.getByRole('group', { name: 'Debatte · Echtzeit-Dienst' });
    expect(card).toHaveTextContent('Vorzeitig beendet von Olga');

    rerender(<DebateCard debate={early} />);
    expect(card).toHaveTextContent('Vorzeitig beendet');
    expect(card).not.toHaveTextContent('von');

    rerender(<DebateCard debate={{ ...DEBATE, turns: 1, status: 'failed' }} />);
    expect(card).toHaveTextContent('Abgebrochen: Ein Agent konnte nicht antworten.');
    expect(within(card).getByText(/Abgebrochen/)).toHaveClass('text-danger');
  });
});

describe('debates in the chat', () => {
  it('show their card in the moderator message that opens them', () => {
    const onStopDebate = vi.fn();
    render(
      <ChatMessageView
        item={message({ debate: DEBATE })}
        isOwn={false}
        onStopDebate={onStopDebate}
      />,
    );

    const article = screen.getByRole('article');
    const card = within(article).getByRole('group', { name: 'Debatte · Echtzeit-Dienst' });
    fireEvent.click(within(card).getByRole('button', { name: 'Debatte beenden' }));
    expect(onStopDebate).toHaveBeenCalledWith(DEBATE);
  });

  it('mark every turn with its round and the summary as such', () => {
    const turn = message({
      id: 'turn',
      author: { kind: 'agent', agentKey: 'backend' },
      content: 'Ein Dienst reicht.',
      debateTurn: { debateId: DEBATE.id, round: 1, rounds: 2 },
    });
    const { rerender } = render(<ChatMessageView item={turn} isOwn={false} />);
    expect(screen.getByRole('article')).toHaveTextContent('Debatte · Runde 1 von 2');
    expect(screen.getByText('Debatte · Runde 1 von 2')).toHaveClass('text-meta', 'text-text-3');

    rerender(
      <ChatMessageView
        item={message({
          id: 'summary',
          content: 'Beide sind sich einig.',
          debateTurn: { debateId: DEBATE.id, round: null, rounds: 2 },
        })}
        isOwn={false}
      />,
    );
    expect(screen.getByRole('article')).toHaveTextContent('Debatte · Zusammenfassung');
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
});

describe('useStopDebate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup(response: () => Response) {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const key = messagesQueryKey(PROJECT);
    queryClient.setQueryData<ChatItem[]>(key, [message({ debate: DEBATE })]);
    const onFailure = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useStopDebate(PROJECT, 'Olga', onFailure), { wrapper });
    const debate = () => queryClient.getQueryData<ChatItem[]>(key)?.[0]?.debate;
    return { stop: result.current, fetchMock, onFailure, debate };
  }

  it('asks the server and shows at once that the debate is ending', async () => {
    const { stop, fetchMock, onFailure, debate } = setup(() => new Response(null, { status: 204 }));

    act(() => {
      stop(DEBATE);
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/projects/${PROJECT}/debates/${DEBATE.id}/stop`),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(debate()).toMatchObject({ stopped: true, stoppedBy: 'Olga' });
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('takes it back with a note when the server fails', async () => {
    const { stop, onFailure, debate } = setup(
      () =>
        new Response(JSON.stringify({ error: { code: 'internal', message: 'Oops' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
    );

    act(() => {
      stop(DEBATE);
    });

    await waitFor(() => {
      expect(onFailure).toHaveBeenCalledWith('failed');
    });
    expect(debate()).toMatchObject({ stopped: false, stoppedBy: null });
  });

  it('says so when the debate is over already', async () => {
    const { stop, onFailure } = setup(
      () =>
        new Response(JSON.stringify({ error: { code: 'already_decided', message: 'Done' } }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
    );

    act(() => {
      stop(DEBATE);
    });

    await waitFor(() => {
      expect(onFailure).toHaveBeenCalledWith('already_decided');
    });
  });
});
