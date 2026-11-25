import type { ChatMessage, LiveEvent } from '@covibes/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';

import { compareItems, mergeServerMessages, upsertMessage } from '@web/features/chat/message-cache';
import { applyRunEvent } from '@web/features/chat/runs';
import {
  messageHistoryCursorKey,
  messagesQueryKey,
  type ChatItem,
  type MessageHistoryState,
} from '@web/features/chat/types';
import { api } from '@web/lib/api';

/** The latest messages of a project, oldest first, including those still being sent. */
export function messagesQuery(projectId: string) {
  return queryOptions({
    queryKey: messagesQueryKey(projectId),
    queryFn: async ({ client, queryKey }) => {
      const initial = client.getQueryData<ChatItem[]>(queryKey) ?? [];
      const newestKnown = initial.findLast((item) => item.delivery === undefined);
      const server = await api<ChatMessage[]>(
        `/projects/${encodeURIComponent(projectId)}/messages`,
      );
      // A reconnect can miss more than one page. Keeping an old prefix beside a disjoint
      // latest page would show a false continuous history and could keep an exhausted cursor.
      const first = server[0];
      const gap =
        newestKnown &&
        first &&
        compareItems(newestKnown, first) < 0 &&
        !server.some((message) => message.id === newestKnown.id);
      if (gap || !newestKnown)
        client.setQueryData<MessageHistoryState>(messageHistoryCursorKey(projectId), (state) => ({
          generation: (state?.generation ?? 0) + 1,
          before: undefined,
        }));
      // Keep optimistic sends and live arrivals that happened while the request was in flight.
      const current = client.getQueryData<ChatItem[]>(queryKey) ?? [];
      const continuous = gap
        ? current.filter((item) => item.delivery !== undefined || compareItems(item, first) >= 0)
        : current;
      return mergeServerMessages(server, continuous);
    },
    // While the chat is open, the live channel keeps the list current, so it never goes stale on
    // its own (no reload on window focus); the chat reloads it after a reconnect. Mounting the chat
    // again still reloads it, because nothing listened while it was closed.
    staleTime: Infinity,
    refetchOnMount: 'always',
  });
}

/**
 * Applies a live channel event to the cache: run changes to the runs (`applyRunEvent`), everything
 * else to the messages, which ignore events while the list is not loaded. Text deltas are appended
 * to their message only while it is still streaming, so a delta that arrives after the finished
 * message cannot change the stored text.
 */
export function applyLiveEvent(
  queryClient: QueryClient,
  projectId: string,
  event: Extract<LiveEvent, { type: 'message' | 'message_delta' | 'run' }>,
) {
  if (event.type === 'run') {
    applyRunEvent(queryClient, projectId, event.run);
    return;
  }
  queryClient.setQueryData<ChatItem[]>(messagesQueryKey(projectId), (items) => {
    if (!items) return items;
    if (event.type === 'message') return upsertMessage(items, event.message);
    return items.map((item) =>
      item.id === event.messageId && item.status === 'streaming'
        ? { ...item, content: item.content + event.text }
        : item,
    );
  });
}
