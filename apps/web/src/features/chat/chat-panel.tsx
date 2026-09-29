import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { PanelHeader, PanelTitle } from '@web/components/ui/panel';
import { Composer } from '@web/features/chat/composer';
import { MessageList } from '@web/features/chat/message-list';
import { applyLiveEvent, messagesQuery } from '@web/features/chat/queries';
import { chatStatus, runsQuery, runsQueryKey } from '@web/features/chat/runs';
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

/**
 * Header and content of the chat panel (specs 06 and 07): history, live updates including
 * streaming agent answers, the status pill of the agent runs and the composer.
 */
export function ChatPanel({ projectId, user, readOnly }: ChatPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const messages = useQuery(messagesQuery(projectId));
  const runs = useQuery(runsQuery(projectId));
  const { send, retry } = useSendMessage(projectId, { userId: user.id, name: user.name });

  // The reload has to start after the channel opened. A request still running from before (the
  // first load) may have read its data earlier, and React Query would reuse it instead of asking
  // again; so it is cancelled first, which keeps anything the live channel already wrote.
  function reload(queryKey: QueryKey) {
    void queryClient
      .cancelQueries({ queryKey })
      .then(() => queryClient.invalidateQueries({ queryKey }));
  }

  useLiveChannel(projectId, {
    onEvent: (event) => {
      applyLiveEvent(queryClient, projectId, event);
    },
    // Messages sent and runs changed before the channel opened (or while it was down) arrive with
    // the reload.
    onConnect: () => {
      reload(messagesQueryKey(projectId));
      reload(runsQueryKey(projectId));
    },
  });

  return (
    <>
      <PanelHeader className="justify-between">
        <PanelTitle>{t('panels.chat')}</PanelTitle>
        <ChatStatusPill status={chatStatus(runs.data ?? [], messages.data ?? [])} />
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
