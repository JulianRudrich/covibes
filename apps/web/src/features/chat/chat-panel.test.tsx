import { parseMentions, type AiRun, type ChatMessage, type LiveEvent } from '@covibes/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@web/components/ui/tooltip';
import { ChatPanel } from '@web/features/chat/chat-panel';
import { applyLiveEvent } from '@web/features/chat/queries';
import { createQueryClient } from '@web/lib/query-client';

const PROJECT_ID = '0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const OLGA = { id: '11111111-1111-4111-8111-111111111111', name: 'Olga Owner' };
const MESSAGES_URL = `/api/projects/${PROJECT_ID}/messages`;
const RUNS_URL = `/api/projects/${PROJECT_ID}/runs`;

function message(overrides: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'content'>) {
  const now = new Date().toISOString();
  return {
    projectId: PROJECT_ID,
    author: { kind: 'human', userId: '22222222-2222-4222-8222-222222222222', name: 'Alex Berg' },
    // All agents of these tests are in the team, so the server keeps every mention.
    mentions: parseMentions(overrides.content),
    replyTo: null,
    status: 'complete',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } satisfies ChatMessage;
}

type Responder = (init: RequestInit | undefined) => { status?: number; body: unknown };

function jsonBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
}

/** Stubs fetch for the chat routes; POST answers can be queued per test. */
function stubChatApi(history: ChatMessage[]) {
  const posts: Responder[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = init?.method ?? 'GET';
    let answer: { status?: number; body: unknown } = { status: 404, body: {} };
    if (url === MESSAGES_URL && method === 'GET') answer = { body: history };
    if (url === RUNS_URL && method === 'GET') answer = { body: [] };
    if (url === MESSAGES_URL && method === 'POST') {
      const respond = posts.shift();
      if (respond) answer = respond(init);
    }
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, posts };
}

/** Answers a POST like the server: the stored message with Olga as author. */
const stored: Responder = (init) => {
  const body = jsonBody(init) as { id: string; content: string };
  return {
    status: 201,
    body: message({
      id: body.id,
      content: body.content,
      author: { kind: 'human', userId: OLGA.id, name: OLGA.name },
    }),
  };
};

function renderPanel(readOnly = false) {
  const queryClient = createQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ChatPanel
          projectId={PROJECT_ID}
          user={OLGA}
          readOnly={readOnly}
          team={['moderator', 'backend', 'critic', 'data']}
          members={[{ userId: OLGA.id, name: OLGA.name, role: 'owner' }]}
          role={readOnly ? 'viewer' : 'owner'}
          moderatorNeutral
          onNotice={vi.fn()}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

function composer() {
  return screen.getByRole('textbox');
}

function sendByEnter(text: string) {
  fireEvent.change(composer(), { target: { value: text } });
  fireEvent.keyDown(composer(), { key: 'Enter' });
}

describe('ChatPanel', () => {
  it('shows the history with a divider for today', async () => {
    stubChatApi([message({ id: 'a1', content: 'Hallo @Backend' })]);
    renderPanel();

    const list = await screen.findByRole('list', { name: 'Nachrichten' });
    expect(within(list).getByText('Heute')).toBeInTheDocument();
    expect(within(list).getByText('@Backend')).toBeInTheDocument();
    expect(within(list).getByText('Alex Berg')).toBeInTheDocument();
  });

  it('shows a sent message right away and keeps it once the server confirms it', async () => {
    const { fetchMock, posts } = stubChatApi([]);
    posts.push(stored);
    renderPanel();
    await screen.findByText('Noch keine Nachrichten.');

    sendByEnter('  @Moderator, zeichne einen Block  ');

    const list = await screen.findByRole('list', { name: 'Nachrichten' });
    expect(within(list).getByText('@Moderator')).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        MESSAGES_URL,
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(jsonBody(post?.[1])).toMatchObject({
      content: '@Moderator, zeichne einen Block',
    });
    await waitFor(() => {
      expect(screen.queryByText('Wird gesendet …')).not.toBeInTheDocument();
    });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(composer()).toHaveValue('');
  });

  it('marks a failed message and sends it again on request', async () => {
    const { posts } = stubChatApi([]);
    posts.push(() => ({ status: 500, body: { error: { code: 'internal', message: 'x' } } }));
    posts.push(stored);
    renderPanel();
    await screen.findByText('Noch keine Nachrichten.');

    sendByEnter('Hallo Team');

    fireEvent.click(await screen.findByRole('button', { name: 'Erneut senden' }));
    await waitFor(() => {
      expect(screen.queryByText('Nicht gesendet.')).not.toBeInTheDocument();
    });
    expect(screen.getAllByText('Hallo Team')).toHaveLength(1);
  });

  it('shows messages that arrive on the live channel', async () => {
    stubChatApi([]);
    const queryClient = renderPanel();
    await screen.findByText('Noch keine Nachrichten.');

    act(() => {
      applyLiveEvent(queryClient, PROJECT_ID, {
        type: 'message',
        message: message({ id: 'b1', content: 'Live!' }),
      });
    });
    expect(await screen.findByText('Live!')).toBeInTheDocument();
  });

  it('shows viewers a hint instead of the composer', async () => {
    stubChatApi([]);
    renderPanel(true);

    expect(await screen.findByText('Du hast Lesezugriff.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('streams an agent answer live and shows who types and waits in the header', async () => {
    const question = message({
      id: 'q1',
      content: '@Moderator, zeichne einen Block API',
      author: { kind: 'human', userId: OLGA.id, name: OLGA.name },
    });
    stubChatApi([question]);
    const queryClient = renderPanel();
    await screen.findByText('@Moderator');
    const emit = (event: Extract<LiveEvent, { type: 'message' | 'message_delta' | 'run' }>) => {
      act(() => {
        applyLiveEvent(queryClient, PROJECT_ID, event);
      });
    };
    const queued: AiRun = {
      id: 'r1',
      projectId: PROJECT_ID,
      agentKey: 'moderator',
      status: 'queued',
      triggerMessageId: 'q1',
      replyMessageId: null,
      createdAt: new Date().toISOString(),
    };
    const answer = message({
      id: 'a1',
      content: '',
      status: 'streaming',
      author: { kind: 'agent', agentKey: 'moderator' },
      replyTo: 'q1',
    });

    emit({ type: 'run', run: queued });
    expect(await screen.findByText('1 wartet')).toBeInTheDocument();

    emit({ type: 'run', run: { ...queued, status: 'running', replyMessageId: 'a1' } });
    emit({ type: 'message', message: answer });
    emit({ type: 'message_delta', messageId: 'a1', text: 'Ich zeichne' });
    emit({ type: 'message_delta', messageId: 'a1', text: ' den Block.' });

    expect(await screen.findByText('Moderator schreibt')).toBeInTheDocument();
    expect(screen.getByText('Ich zeichne den Block.')).toBeInTheDocument();
    expect(screen.getByText('Antwort an Olga Owner')).toBeInTheDocument();

    emit({
      type: 'message',
      message: { ...answer, status: 'complete', content: 'Ich habe den Block „API“ gezeichnet.' },
    });
    emit({ type: 'run', run: { ...queued, status: 'done', replyMessageId: 'a1' } });

    expect(await screen.findByText('Ich habe den Block „API“ gezeichnet.')).toBeInTheDocument();
    expect(screen.queryByText('Moderator schreibt')).not.toBeInTheDocument();
    expect(screen.queryByText('Ich zeichne den Block.')).not.toBeInTheDocument();
  });
});
