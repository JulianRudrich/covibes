import {
  parseMentions,
  parsePeopleMentions,
  sendMessageInputSchema,
  type ChatMessage,
  type MentionNames,
  type MessageAttachment,
  type SendMessageInput,
} from '@covibes/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { setDelivery, upsertMessage } from '@web/features/chat/message-cache';
import { messagesQueryKey, type ChatItem } from '@web/features/chat/types';
import { api } from '@web/lib/api';

function updateMessages(
  queryClient: QueryClient,
  projectId: string,
  change: (items: readonly ChatItem[]) => ChatItem[],
) {
  queryClient.setQueryData<ChatItem[]>(
    messagesQueryKey(projectId),
    (items) => items && change(items),
  );
}

/** Sends a message and records the outcome on its cached copy. */
async function post(queryClient: QueryClient, projectId: string, input: SendMessageInput) {
  try {
    const message = await api<ChatMessage>(`/projects/${encodeURIComponent(projectId)}/messages`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    updateMessages(queryClient, projectId, (items) => upsertMessage(items, message));
  } catch {
    updateMessages(queryClient, projectId, (items) => setDelivery(items, input.id, 'failed'));
  }
}

const NO_PEOPLE: readonly { userId: string; name: string }[] = [];

/**
 * Optimistic sending (spec 06). The delivery state lives on each message in the cached list, so
 * several messages can be on their way at once. The id is created here, so sending again after an
 * error cannot store the message twice.
 */
export function useSendMessage(
  projectId: string,
  author: { userId: string; name: string },
  /** The names the team answers to; like the server, only their mentions count (spec 14). */
  names: MentionNames,
  /** The other members; like the server, their mentions are stored with the message (spec 22a). */
  people: readonly { userId: string; name: string }[] = NO_PEOPLE,
) {
  const queryClient = useQueryClient();
  const { userId, name } = author;

  /**
   * Shows the message right away and sends it, with the uploaded files it takes along (spec 20a).
   * Returns false, and does nothing, for text that is empty or too long after trimming, or while
   * the message list is not loaded yet.
   */
  const send = useCallback(
    (text: string, attachments: readonly MessageAttachment[] = []): boolean => {
      const input = sendMessageInputSchema.safeParse({ id: crypto.randomUUID(), content: text });
      if (!input.success) return false;
      // Without the list there is nowhere to show the message or a failure to send it.
      if (queryClient.getQueryData<ChatItem[]>(messagesQueryKey(projectId)) === undefined) {
        return false;
      }

      const { id, content } = input.data;
      const now = new Date().toISOString();
      const mentionedUsers = parsePeopleMentions(content, people, names);
      const item: ChatItem = {
        id,
        projectId,
        author: { kind: 'human', userId, name },
        content,
        mentions: parseMentions(content, names),
        ...(mentionedUsers.length > 0 ? { mentionedUsers } : {}),
        ...(attachments.length > 0 ? { attachments: [...attachments] } : {}),
        replyTo: null,
        status: 'complete',
        createdAt: now,
        updatedAt: now,
        delivery: 'sending',
      };
      updateMessages(queryClient, projectId, (items) => upsertMessage(items, item));
      void post(queryClient, projectId, {
        id,
        content,
        ...(attachments.length > 0 ? { attachments: attachments.map((file) => file.id) } : {}),
      });
      return true;
    },
    [queryClient, projectId, userId, name, names, people],
  );

  /** Sends a failed message again with the same id; does nothing for any other message. */
  const retry = useCallback(
    (id: string) => {
      const item = queryClient
        .getQueryData<ChatItem[]>(messagesQueryKey(projectId))
        ?.find((candidate) => candidate.id === id);
      if (item?.delivery !== 'failed') return;
      updateMessages(queryClient, projectId, (items) => setDelivery(items, id, 'sending'));
      const attached = item.attachments ?? [];
      void post(queryClient, projectId, {
        id,
        content: item.content,
        ...(attached.length > 0 ? { attachments: attached.map((file) => file.id) } : {}),
      });
    },
    [queryClient, projectId],
  );

  return { send, retry };
}
