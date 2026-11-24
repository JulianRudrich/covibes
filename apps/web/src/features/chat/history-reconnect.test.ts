import type { ChatMessage } from '@covibes/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { messagesQuery } from '@web/features/chat/queries';
import { useMessageHistory } from '@web/features/chat/use-message-history';
import { messageHistoryCursorKey, messagesQueryKey, type ChatItem } from '@web/features/chat/types';

function message(id: string, day: number): ChatMessage {
  return {
    id,
    projectId: 'project',
    author: { kind: 'human', userId: 'person', name: 'Person' },
    content: id,
    mentions: [],
    replyTo: null,
    status: 'complete',
    createdAt: `2026-11-${String(day).padStart(2, '0')}T12:00:00.000000Z`,
    updatedAt: '2026-11-17T12:00:00Z',
  };
}

describe('history after a reconnect', () => {
  it('discards an older page started before the contiguous message window was reset', async () => {
    const client = new QueryClient();
    const latest = message('latest', 10);
    client.setQueryData(messagesQueryKey('project'), [latest]);
    client.setQueryData(messageHistoryCursorKey('project'), {
      generation: 0,
      before: { at: '2026-11-10T12:00:00.000000Z', id: 'cursor' },
    });
    let respond: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            respond = resolve;
          }),
      ),
    );
    const { result } = renderHook(() => useMessageHistory('project'), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client, children }),
    });
    let loading: Promise<void> | undefined;
    act(() => {
      loading = result.current.loadOlder();
    });
    act(() => {
      client.setQueryData(messageHistoryCursorKey('project'), { generation: 1, before: undefined });
    });
    await act(async () => {
      if (!respond) throw new Error('No history request');
      respond(
        new Response(JSON.stringify({ items: [message('stale-page', 1)], before: null }), {
          status: 200,
        }),
      );
      await loading;
    });
    expect(client.getQueryData(messagesQueryKey('project'))).toEqual([latest]);
    expect(client.getQueryData(messageHistoryCursorKey('project'))).toEqual({
      generation: 1,
      before: undefined,
    });
    expect(result.current.hasOlder).toBe(true);
    client.clear();
  });
  it('resets an exhausted cursor across a missed-message gap but keeps pending and live arrivals', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const old = message('old', 1);
    const latest = message('latest', 10);
    const live = message('live', 11);
    const pending: ChatItem = { ...message('pending', 12), delivery: 'sending' };
    client.setQueryData(messagesQueryKey('project'), [old]);
    client.setQueryData(messageHistoryCursorKey('project'), { generation: 0, before: null });
    let respond: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            respond = resolve;
          }),
      ),
    );
    const loading = client.query({ ...messagesQuery('project'), staleTime: 0 });
    client.setQueryData(messagesQueryKey('project'), [old, live, pending]);
    if (!respond) throw new Error('No fetch request');
    respond(new Response(JSON.stringify([latest]), { status: 200 }));
    const result = await loading;
    expect(result.map((item) => item.id)).toEqual(['latest', 'live', 'pending']);
    expect(client.getQueryData(messageHistoryCursorKey('project'))).toEqual({
      generation: 1,
      before: undefined,
    });
    client.clear();
  });

  it('keeps loaded older pages and their cursor when the refreshed page overlaps', async () => {
    const client = new QueryClient();
    const oldest = message('oldest', 1);
    const overlap = message('overlap', 5);
    const latest = message('latest', 10);
    const cursor = { at: '2026-10-31T12:00:00.000000Z', id: 'cursor' };
    client.setQueryData(messagesQueryKey('project'), [oldest, overlap]);
    client.setQueryData(messageHistoryCursorKey('project'), { generation: 0, before: cursor });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify([overlap, latest]), { status: 200 })),
      ),
    );
    const result = await client.query({ ...messagesQuery('project'), staleTime: 0 });
    expect(result.map((item) => item.id)).toEqual(['oldest', 'overlap', 'latest']);
    expect(client.getQueryData(messageHistoryCursorKey('project'))).toEqual({
      generation: 0,
      before: cursor,
    });
    client.clear();
  });
});
