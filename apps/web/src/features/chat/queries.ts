import type { ChatMessage, LiveEvent } from '@covibes/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';

import { mergeServerMessages, upsertMessage } from '@web/features/chat/message-cache';
import { messagesQueryKey, type ChatItem } from '@web/features/chat/types';
import { api } from '@web/lib/api';

/** The latest messages of a project, oldest first, including those still being sent. */
export function messagesQuery(projectId: string) {
  return queryOptions({
    queryKey: messagesQueryKey(projectId),
    queryFn: async ({ client, queryKey }) => {
      const server = await api<ChatMessage[]>(
        `/projects/${encodeURIComponent(projectId)}/messages`,
      );
      // Read the cache only now, so messages sent or received during the request are kept.
      return mergeServerMessages(server, client.getQueryData<ChatItem[]>(queryKey) ?? []);
    },
    // While the chat is open, the live channel keeps the list current, so it never goes stale on
    // its own (no reload on window focus); the chat reloads it after a reconnect. Mounting the chat
    // again still reloads it, because nothing listened while it was closed.
    staleTime: Infinity,
    refetchOnMount: 'always',
  });
}

/** Applies a live channel event to the cached messages; ignored while the list is not loaded. */
export function applyLiveEvent(queryClient: QueryClient, projectId: string, event: LiveEvent) {
  queryClient.setQueryData<ChatItem[]>(
    messagesQueryKey(projectId),
    (items) => items && upsertMessage(items, event.message),
  );
}
