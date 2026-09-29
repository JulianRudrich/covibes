import type { ChatMessage } from '@covibes/shared';

/**
 * A message as the chat shows it: confirmed by the server, or sent from this browser and not
 * confirmed yet (`sending`), or not sent because of an error (`failed`, can be sent again).
 */
export type ChatItem = ChatMessage & { delivery?: 'sending' | 'failed' };

/** React Query key of the latest messages of a project. */
export function messagesQueryKey(projectId: string) {
  return ['projects', projectId, 'messages'] as const;
}
