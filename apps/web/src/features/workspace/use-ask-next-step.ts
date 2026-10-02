import type { ChatMessage } from '@covibes/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { upsertMessage } from '@web/features/chat/message-cache';
import { messagesQueryKey, type ChatItem } from '@web/features/chat/types';
import { api } from '@web/lib/api';

/**
 * "Moderator fragen" in the card of the current phase (spec 24): asks the moderator in the chat,
 * in the user's name and language, where the project stands and what the next step is. It is an
 * ordinary message, so everyone sees the question and the answer.
 */
export function useAskNextStep(projectId: string, onFailed: () => void): () => void {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useCallback(() => {
    api<ChatMessage>(`/projects/${encodeURIComponent(projectId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ id: crypto.randomUUID(), content: t('phases.askMessage') }),
    })
      .then((message) => {
        // The live channel brings the message too; whichever comes first shows it.
        queryClient.setQueryData<ChatItem[]>(
          messagesQueryKey(projectId),
          (items) => items && upsertMessage(items, message),
        );
      })
      .catch(onFailed);
  }, [projectId, queryClient, t, onFailed]);
}
