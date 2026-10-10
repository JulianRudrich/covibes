import {
  parseMentions,
  type AiRun,
  type ChatMessage,
  type LiveEvent,
  type UsageState,
} from '@covibes/shared';
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

const USAGE_URL = `/api/projects/${PROJECT_ID}/usage/state`;

/**
 * Stubs fetch for the chat routes; POST answers can be queued per test. `usage` is what the
 * server says of the limits of the AI (spec 31a); without it that route is unknown.
 */
function stubChatApi(history: ChatMessage[], usage?: UsageState) {
  const posts: Responder[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = init?.method ?? 'GET';
    let answer: { status?: number; body: unknown } = { status: 404, body: {} };
    if (url === MESSAGES_URL && method === 'GET') answer = { body: history };
    if (url === RUNS_URL && method === 'GET') answer = { body: [] };
    if (url === USAGE_URL && method === 'GET' && usage) answer = { body: usage };
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

function renderPanel(readOnly = false, team = ['moderator', 'backend', 'critic', 'data']) {
  const queryClient = createQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ChatPanel
          projectId={PROJECT_ID}
          user={OLGA}
          readOnly={readOnly}
          team={team}
          members={[{ userId: OLGA.id, name: OLGA.name, role: 'owner', canApproveGit: true }]}
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

/** The heading of the chat before its first message (spec 33). */
const EMPTY = 'Hier beginnt das Gespräch';

describe('ChatPanel', () => {
  it('says what the empty chat is for and offers first messages to the moderator (spec 33)', async () => {
    const { fetchMock } = stubChatApi([]);
    renderPanel();

    expect(await screen.findByRole('heading', { name: EMPTY })).toBeInTheDocument();
    expect(
      screen.getByText('Schreib deinem Team, oder ruf mit @ einen Agent.'),
    ).toBeInTheDocument();
    const starters = within(
      screen.getByRole('group', { name: 'Der Moderator hilft beim Einstieg:' }),
    );
    expect(starters.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Projekt vorstellen',
      'Kriterien festlegen',
      'Team kennenlernen',
    ]);

    // A starter puts its message into the field and sends nothing: a run costs something.
    fireEvent.click(starters.getByRole('button', { name: 'Kriterien festlegen' }));
    expect(composer()).toHaveValue(
      '@Moderator Welche Kriterien sollten wir für unser Projekt festlegen?',
    );
    expect(composer()).toHaveFocus();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);

    // Another one replaces it, and the person writes on behind it.
    fireEvent.click(starters.getByRole('button', { name: 'Projekt vorstellen' }));
    expect(composer()).toHaveValue('@Moderator Wir planen Folgendes: ');
    const field = composer() as HTMLTextAreaElement;
    expect(field.selectionStart).toBe(field.value.length);
    // The same one again, after the person emptied the field.
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.click(starters.getByRole('button', { name: 'Projekt vorstellen' }));
    expect(field).toHaveValue('@Moderator Wir planen Folgendes: ');
  });

  it('sends a first message like any other, and the start is gone with it', async () => {
    const { posts } = stubChatApi([]);
    posts.push(stored);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Team kennenlernen' }));

    fireEvent.keyDown(composer(), { key: 'Enter' });

    const list = await screen.findByRole('list', { name: 'Nachrichten' });
    expect(
      within(list).getByText(/Stell uns bitte kurz die Agents im Team vor/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: EMPTY })).not.toBeInTheDocument();
    expect(composer()).toHaveValue('');
  });

  it('offers no first messages without a moderator in the team', async () => {
    stubChatApi([]);
    renderPanel(false, ['backend']);

    expect(await screen.findByRole('heading', { name: EMPTY })).toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Projekt vorstellen' })).not.toBeInTheDocument();
  });

  it('tells viewers of an empty chat that messages will appear, without anything to do', async () => {
    stubChatApi([]);
    renderPanel(true);

    expect(
      await screen.findByText(
        'Noch keine Nachrichten. Sobald das Team schreibt, liest du hier mit.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: EMPTY })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Projekt vorstellen' })).not.toBeInTheDocument();
  });

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
    await screen.findByRole('heading', { name: EMPTY });

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
    await screen.findByRole('heading', { name: EMPTY });

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
    await screen.findByRole('heading', { name: EMPTY });

    act(() => {
      applyLiveEvent(queryClient, PROJECT_ID, {
        type: 'message',
        message: message({ id: 'b1', content: 'Live!' }),
      });
    });
    expect(await screen.findByText('Live!')).toBeInTheDocument();
  });

  it('says above the composer that a limit of the AI is reached, and lets people keep writing', async () => {
    const resetsAt = new Date(Date.now() + 20 * 24 * 60 * 60_000).toISOString();
    const { posts } = stubChatApi([], {
      project: { reached: true, resetsAt },
      user: { reached: false, resetsAt: null },
    });
    posts.push(stored);
    renderPanel();

    const note = await screen.findByText(/Das KI-Limit dieses Projekts für diesen Monat/);
    expect(note).toHaveTextContent('alles andere geht weiter');
    // Only the AI pauses: the composer is there and sends.
    expect(composer().compareDocumentPosition(note)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
    sendByEnter('Wir machen ohne die Agents weiter.');
    expect(await screen.findByText('Wir machen ohne die Agents weiter.')).toBeVisible();
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
