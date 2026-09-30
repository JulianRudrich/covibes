import type { AgentKey } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { PanelHeader, PanelTitle } from '@web/components/ui/panel';
import { Composer } from '@web/features/chat/composer';
import { MessageList } from '@web/features/chat/message-list';
import { messagesQuery } from '@web/features/chat/queries';
import { chatStatus, runsQuery } from '@web/features/chat/runs';
import { ChatStatusPill } from '@web/features/chat/status-pill';
import { useSendMessage } from '@web/features/chat/use-send-message';

type ChatPanelProps = {
  projectId: string;
  user: { id: string; name: string };
  /** Viewers read along but cannot write. */
  readOnly: boolean;
  /** The agents of the team (spec 14): only they can be mentioned. */
  team: readonly AgentKey[];
};

/**
 * Header and content of the chat panel (specs 06 and 07): history, live updates including
 * streaming agent answers, the status pill of the agent runs and the composer. The live updates
 * arrive through the project's live channel (`useProjectLive`), which writes them into the cache.
 */
export function ChatPanel({ projectId, user, readOnly, team }: ChatPanelProps) {
  const { t } = useTranslation();
  const messages = useQuery(messagesQuery(projectId));
  const runs = useQuery(runsQuery(projectId));
  const { send, retry } = useSendMessage(projectId, { userId: user.id, name: user.name }, team);

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
          <MessageList items={messages.data} currentUserId={user.id} team={team} onRetry={retry} />
        )}

        <div className="px-4 pt-3 pb-4">
          {readOnly ? (
            <p className="m-0 rounded-panel bg-bg-muted px-3.5 py-3 text-center text-ui text-text-3">
              {t('chat.readOnly')}
            </p>
          ) : (
            <Composer
              agents={team}
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
