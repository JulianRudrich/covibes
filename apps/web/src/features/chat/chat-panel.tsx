import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { PanelHeader, PanelTitle } from '@web/components/ui/panel';
import { Composer } from '@web/features/chat/composer';
import { MessageList } from '@web/features/chat/message-list';
import { applyLiveEvent, messagesQuery } from '@web/features/chat/queries';
import { ChatStatusPill } from '@web/features/chat/status-pill';
import { messagesQueryKey } from '@web/features/chat/types';
import { useSendMessage } from '@web/features/chat/use-send-message';
import { useLiveChannel } from '@web/features/realtime/live-channel';

type ChatPanelProps = {
  projectId: string;
  user: { id: string; name: string };
  /** Viewers read along but cannot write. */
  readOnly: boolean;
};

/** Header and content of the chat panel (spec 06): history, live updates and the composer. */
export function ChatPanel({ projectId, user, readOnly }: ChatPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const messages = useQuery(messagesQuery(projectId));
  const { send, retry } = useSendMessage(projectId, { userId: user.id, name: user.name });

  useLiveChannel(projectId, {
    onEvent: (event) => {
      applyLiveEvent(queryClient, projectId, event);
    },
    // Messages sent before the channel opened (or while it was down) arrive with the reload.
    onConnect: () => {
      void queryClient.invalidateQueries({ queryKey: messagesQueryKey(projectId) });
    },
  });

  return (
    <>
      <PanelHeader className="justify-between">
        <PanelTitle>{t('panels.chat')}</PanelTitle>
        {/* Agents type and wait from spec 07 on. */}
        <ChatStatusPill status={null} />
      </PanelHeader>

      <div className="flex min-h-0 flex-col">
        {messages.isPending ? (
          <p className="m-0 grid flex-1 place-items-center p-6 text-ui text-text-3">
            {t('common.loading')}
          </p>
        ) : messages.isError ? (
          <p role="alert" className="m-0 grid flex-1 place-items-center p-6 text-ui text-danger">
            {t('chat.loadError')}
          </p>
        ) : (
          <MessageList items={messages.data} currentUserId={user.id} onRetry={retry} />
        )}

        <div className="px-4 pt-3 pb-4">
          {readOnly ? (
            <p className="m-0 rounded-panel bg-bg-muted px-3.5 py-3 text-center text-ui text-text-3">
              {t('chat.readOnly')}
            </p>
          ) : (
            <Composer
              onSend={(content) => {
                send(content);
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}
