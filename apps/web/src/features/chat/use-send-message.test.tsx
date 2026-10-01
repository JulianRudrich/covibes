import { MESSAGE_MAX_LENGTH, type ChatMessage } from '@covibes/shared';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { applyLiveEvent, messagesQuery } from '@web/features/chat/queries';
import { messagesQueryKey, type ChatItem } from '@web/features/chat/types';
import { useSendMessage } from '@web/features/chat/use-send-message';
import { createQueryClient } from '@web/lib/query-client';

const PROJECT_ID = '0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const MESSAGES_URL = `/api/projects/${PROJECT_ID}/messages`;
const OLGA = { userId: '11111111-1111-4111-8111-111111111111', name: 'Olga Owner' };

// Fixtures lie in the past, so optimistic messages (created now) sort after them.
const EARLIER: ChatMessage = {
  id: '22222222-2222-4222-8222-222222222222',
  projectId: PROJECT_ID,
  author: { kind: 'human', userId: '33333333-3333-4333-8333-333333333333', name: 'Alex Berg' },
  content: 'Earlier',
  mentions: [],
  replyTo: null,
  status: 'complete',
  createdAt: '2020-01-01T08:00:00.000Z',
  updatedAt: '2020-01-01T08:00:00.000Z',
};

type PendingRequest = {
  method: string;
  url: string;
  body: unknown;
  respond: (status: number, body: unknown) => void;
  /** The server could not be reached, or its answer got lost. */
  fail: () => void;
};

/** Replaces fetch; every request waits until the test answers it. */
function stubFetch() {
  const requests: PendingRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
          requests.push({
            method: init?.method ?? 'GET',
            url: input instanceof Request ? input.url : input.toString(),
            body,
            respond: (status, answer) => {
              resolve(
                new Response(JSON.stringify(answer), {
                  status,
                  headers: { 'content-type': 'application/json' },
                }),
              );
            },
            fail: () => {
              reject(new TypeError('Failed to fetch'));
            },
          });
        }),
    ),
  );
  return requests;
}

/** The message as the server stores it: its own timestamps, no delivery state. */
function stored(id: string, content: string): ChatMessage {
  return {
    id,
    projectId: PROJECT_ID,
    author: { kind: 'human', ...OLGA },
    content,
    mentions: [],
    replyTo: null,
    status: 'complete',
    createdAt: '2020-01-01T09:00:00.000Z',
    updatedAt: '2020-01-01T09:00:00.000Z',
  };
}

/** The chat as the panel uses it: the message list and the sending hook. */
/** The names the team answers to: the moderator and backend. */
const TEAM = { moderator: ['moderator'], backend: ['backend'] };

function renderChat() {
  const requests = stubFetch();
  const queryClient = createQueryClient();
  const renders: ChatItem[][] = [];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => {
      const list = useQuery(messagesQuery(PROJECT_ID));
      renders.push(list.data ?? []);
      return { list, chat: useSendMessage(PROJECT_ID, OLGA, TEAM) };
    },
    { wrapper },
  );

  const items = (): ChatItem[] => result.current.list.data ?? [];
  const nth = (method: string, index: number): PendingRequest => {
    const request = requests.filter((candidate) => candidate.method === method)[index];
    if (!request) throw new Error(`No ${method} request #${String(index)}`);
    return request;
  };
  const send = (text: string): boolean => {
    let sent = false;
    act(() => {
      sent = result.current.chat.send(text);
    });
    return sent;
  };
  const retry = (id: string) => {
    act(() => {
      result.current.chat.retry(id);
    });
  };
  const reload = () => {
    act(() => {
      void queryClient.invalidateQueries({ queryKey: messagesQueryKey(PROJECT_ID) });
    });
  };
  return { requests, queryClient, renders, result, items, nth, send, retry, reload };
}

type Chat = ReturnType<typeof renderChat>;

async function renderLoadedChat(): Promise<Chat> {
  const chat = renderChat();
  await waitFor(() => {
    expect(chat.requests).toHaveLength(1);
  });
  chat.nth('GET', 0).respond(200, [EARLIER]);
  await waitFor(() => {
    expect(chat.items()).toEqual([EARLIER]);
  });
  return chat;
}

/** Sends `text` and returns the id of the optimistic message once it is shown. */
async function sendAndShow(chat: Chat, text: string): Promise<string> {
  expect(chat.send(text)).toBe(true);
  await waitFor(() => {
    expect(chat.items()).toHaveLength(2);
  });
  const id = chat.items()[1]?.id;
  if (id === undefined) throw new Error('No optimistic message');
  return id;
}

/** Lets answered requests and the cache updates they cause run to the end. */
async function settle() {
  await act(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      }),
  );
}

describe('useSendMessage', () => {
  it('shows a message right away and confirms it with the stored version', async () => {
    const chat = await renderLoadedChat();

    const id = await sendAndShow(chat, '  @Moderator, draw a block  ');

    const optimistic = chat.items()[1];
    expect(optimistic).toMatchObject({
      id,
      projectId: PROJECT_ID,
      author: { kind: 'human', ...OLGA },
      content: '@Moderator, draw a block',
      mentions: ['moderator'],
      replyTo: null,
      status: 'complete',
      delivery: 'sending',
    });
    expect(optimistic?.createdAt).toBe(optimistic?.updatedAt);
    const post = chat.nth('POST', 0);
    expect(post.url).toBe(MESSAGES_URL);
    expect(post.body).toEqual({ id, content: '@Moderator, draw a block' });

    const confirmed: ChatMessage = {
      ...stored(id, '@Moderator, draw a block'),
      mentions: ['moderator'],
    };
    post.respond(201, confirmed);
    await waitFor(() => {
      expect(chat.items()).toEqual([EARLIER, confirmed]);
    });
    expect(chat.items()[1]).not.toHaveProperty('delivery');
  });

  it('marks a failed message and sends it again with the same id', async () => {
    const chat = await renderLoadedChat();
    const id = await sendAndShow(chat, 'Hello team');

    chat.nth('POST', 0).respond(500, {
      error: { code: 'internal', message: 'Something went wrong.' },
    });
    await waitFor(() => {
      expect(chat.items()[1]).toMatchObject({ id, delivery: 'failed' });
    });

    chat.retry(id);
    // A second click while it is on its way does not send it once more.
    chat.retry(id);
    await waitFor(() => {
      expect(chat.items()[1]).toMatchObject({ id, delivery: 'sending' });
    });
    expect(chat.requests.filter((request) => request.method === 'POST')).toHaveLength(2);
    expect(chat.nth('POST', 1).body).toEqual({ id, content: 'Hello team' });

    chat.nth('POST', 1).respond(201, stored(id, 'Hello team'));
    await waitFor(() => {
      expect(chat.items()).toEqual([EARLIER, stored(id, 'Hello team')]);
    });
  });

  it('ignores empty and too long text', async () => {
    const chat = await renderLoadedChat();

    expect(chat.send('')).toBe(false);
    expect(chat.send(' \n\t ')).toBe(false);
    expect(chat.send('x'.repeat(MESSAGE_MAX_LENGTH + 1))).toBe(false);
    expect(chat.requests.filter((request) => request.method === 'POST')).toHaveLength(0);
    expect(chat.items()).toEqual([EARLIER]);

    // The limit applies after trimming.
    await sendAndShow(chat, ` ${'x'.repeat(MESSAGE_MAX_LENGTH)} `);
    expect(chat.items()[1]?.content).toHaveLength(MESSAGE_MAX_LENGTH);
  });

  it('does not send while the message list is not loaded', async () => {
    const chat = renderChat();
    await waitFor(() => {
      expect(chat.requests).toHaveLength(1);
    });

    expect(chat.send('Too early')).toBe(false);
    expect(chat.requests).toHaveLength(1);
  });

  it('keeps one message when the server already stored the first attempt', async () => {
    const chat = await renderLoadedChat();
    const id = await sendAndShow(chat, 'Hello team');

    // The server stores the message, but its answer gets lost.
    chat.nth('POST', 0).fail();
    await waitFor(() => {
      expect(chat.items()[1]).toMatchObject({ id, delivery: 'failed' });
    });

    chat.retry(id);
    expect(chat.nth('POST', 1).body).toEqual({ id, content: 'Hello team' });
    // For a known id the server answers 200 with the stored message.
    chat.nth('POST', 1).respond(200, stored(id, 'Hello team'));
    await waitFor(() => {
      expect(chat.items()).toEqual([EARLIER, stored(id, 'Hello team')]);
    });
  });

  it('keeps a message that is still being sent when the list reloads', async () => {
    const chat = await renderLoadedChat();
    const id = await sendAndShow(chat, 'Hello team');

    chat.reload();
    await waitFor(() => {
      expect(chat.requests.filter((request) => request.method === 'GET')).toHaveLength(2);
    });
    const later: ChatMessage = {
      ...EARLIER,
      id: '44444444-4444-4444-8444-444444444444',
      content: 'Later',
      createdAt: '2020-01-01T08:30:00.000Z',
      updatedAt: '2020-01-01T08:30:00.000Z',
    };
    chat.nth('GET', 1).respond(200, [EARLIER, later]);
    await waitFor(() => {
      expect(chat.items().map((item) => item.id)).toEqual([EARLIER.id, later.id, id]);
    });
    expect(chat.items()[2]).toMatchObject({ delivery: 'sending' });

    chat.nth('POST', 0).respond(201, stored(id, 'Hello team'));
    await waitFor(() => {
      expect(chat.items()).toEqual([EARLIER, later, stored(id, 'Hello team')]);
    });
  });

  it('keeps a confirmed message that an older reload does not contain', async () => {
    const chat = await renderLoadedChat();
    chat.reload();
    await waitFor(() => {
      expect(chat.requests).toHaveLength(2);
    });
    const id = await sendAndShow(chat, 'Hello team');

    chat.nth('POST', 0).respond(201, stored(id, 'Hello team'));
    await waitFor(() => {
      expect(chat.items()[1]).toEqual(stored(id, 'Hello team'));
    });
    // The server read this list before it stored the message.
    chat.nth('GET', 1).respond(200, [EARLIER]);
    await waitFor(() => {
      expect(chat.result.current.list.isFetching).toBe(false);
    });

    expect(chat.items()).toEqual([EARLIER, stored(id, 'Hello team')]);
  });

  it('takes a live event that arrives before the POST answer without duplicates or flicker', async () => {
    const chat = await renderLoadedChat();
    const id = await sendAndShow(chat, 'Hello team');

    act(() => {
      applyLiveEvent(chat.queryClient, PROJECT_ID, {
        type: 'message',
        message: stored(id, 'Hello team'),
      });
    });
    await waitFor(() => {
      expect(chat.items()[1]).toEqual(stored(id, 'Hello team'));
    });
    chat.nth('POST', 0).respond(201, stored(id, 'Hello team'));
    await settle();

    expect(chat.items()).toEqual([EARLIER, stored(id, 'Hello team')]);
    const copies = chat.renders.map((items) =>
      items.filter((item) => item.id === id).map((item) => item.delivery ?? 'confirmed'),
    );
    const firstConfirmed = copies.findIndex((states) => states[0] === 'confirmed');
    expect(firstConfirmed).toBeGreaterThan(-1);
    for (const states of copies.slice(firstConfirmed)) expect(states).toEqual(['confirmed']);
  });

  it('does not mark a message as failed that already arrived over the live channel', async () => {
    const chat = await renderLoadedChat();
    const id = await sendAndShow(chat, 'Hello team');

    act(() => {
      applyLiveEvent(chat.queryClient, PROJECT_ID, {
        type: 'message',
        message: stored(id, 'Hello team'),
      });
    });
    chat.nth('POST', 0).fail();
    await settle();

    expect(chat.items()).toEqual([EARLIER, stored(id, 'Hello team')]);
    chat.retry(id);
    expect(chat.requests.filter((request) => request.method === 'POST')).toHaveLength(1);
  });
});

describe('applyLiveEvent', () => {
  it('ignores events while the message list is not loaded', () => {
    const queryClient = createQueryClient();

    applyLiveEvent(queryClient, PROJECT_ID, { type: 'message', message: EARLIER });

    expect(queryClient.getQueryData(messagesQueryKey(PROJECT_ID))).toBeUndefined();
  });
});
