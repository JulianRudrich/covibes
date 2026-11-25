import type { ChatMessage, MessageCursor, NamedElement } from '@covibes/shared';

/**
 * A message as the chat shows it: confirmed by the server, or sent from this browser and not
 * confirmed yet (`sending`), or not sent because of an error (`failed`, can be sent again).
 * `named` are the elements of the canvas the sender asked about (spec 37b); they go along when
 * the message is sent again.
 */
export type ChatItem = ChatMessage & {
  delivery?: 'sending' | 'failed';
  named?: readonly NamedElement[];
};

/** React Query key of the latest messages of a project. */
export function messagesQueryKey(projectId: string) {
  return ['projects', projectId, 'messages'] as const;
}

/** History exhaustion belongs to the contiguous message window, not the lifetime of a project. */
export function messageHistoryCursorKey(projectId: string) {
  return ['projects', projectId, 'message-history-cursor'] as const;
}

export type MessageHistoryState = {
  generation: number;
  before: MessageCursor | null | undefined;
};
