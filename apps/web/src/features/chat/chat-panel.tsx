import type { AgentKey, HandRaise, ProjectMember, ProjectRole } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { PanelHeader, PanelTitle } from '@web/components/ui/panel';
import { Composer } from '@web/features/chat/composer';
import { MessageList } from '@web/features/chat/message-list';
import { messagesQuery } from '@web/features/chat/queries';
import { chatStatus, runsQuery } from '@web/features/chat/runs';
import { ChatStatusPill } from '@web/features/chat/status-pill';
import { useSendMessage } from '@web/features/chat/use-send-message';
import { useVoteActions } from '@web/features/decisions/queries';
import type { Voting } from '@web/features/decisions/vote-card';
import { handsQuery, useHandDecisions, useOfferDecisions } from '@web/features/hands/queries';
import { RaisedHands } from '@web/features/hands/raised-hands';

type ChatPanelProps = {
  projectId: string;
  user: { id: string; name: string };
  /** Viewers read along but cannot write. */
  readOnly: boolean;
  /** The agents of the team (spec 14): only they can be mentioned. */
  team: readonly AgentKey[];
  /** The members of the project and the user's role, for the vote cards (spec 16b). */
  members: readonly ProjectMember[];
  role: ProjectRole;
  /** Whether the moderator's badge says "neutral" (spec 16b). */
  moderatorNeutral: boolean;
  /** Shows a short note, e.g. when deciding a raised hand or an offer failed. */
  onNotice: (text: string) => void;
};

/**
 * Header and content of the chat panel (specs 06 and 07): history, live updates including
 * streaming agent answers, the status pill of the agent runs and the composer. The live updates
 * arrive through the project's live channel (`useProjectLive`), which writes them into the cache.
 */
export function ChatPanel({
  projectId,
  user,
  readOnly,
  team,
  members,
  role,
  moderatorNeutral,
  onNotice,
}: ChatPanelProps) {
  const { t } = useTranslation();
  const messages = useQuery(messagesQuery(projectId));
  const runs = useQuery(runsQuery(projectId));
  const hands = useQuery(handsQuery(projectId)).data ?? NO_HANDS;
  const { send, retry } = useSendMessage(projectId, { userId: user.id, name: user.name }, team);
  const decideHand = useHandDecisions(projectId, (reason) => {
    onNotice(t(reason === 'already_decided' ? 'hands.alreadyDecided' : 'hands.failed'));
  });
  const decideOffer = useOfferDecisions(projectId, user.name, (reason) => {
    onNotice(t(reason === 'already_decided' ? 'offers.alreadyDecided' : 'offers.failed'));
  });
  const votes = useVoteActions(projectId, user.id, (reason) => {
    onNotice(t(reason === 'already_decided' ? 'votes.alreadyClosed' : 'votes.failed'));
  });
  const voting = useMemo<Voting>(
    () => ({
      voters: members.filter((member) => member.role !== 'viewer'),
      userId: user.id,
      canVote: role !== 'viewer',
      canClose: role === 'owner',
      onVote: votes.cast,
      onClose: votes.close,
    }),
    [members, user.id, role, votes.cast, votes.close],
  );

  return (
    <>
      <PanelHeader className="justify-between">
        <PanelTitle>{t('panels.chat')}</PanelTitle>
        <ChatStatusPill status={chatStatus(runs.data ?? [], messages.data ?? [], hands.length)} />
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
          <MessageList
            items={messages.data}
            currentUserId={user.id}
            team={team}
            onRetry={retry}
            onOffer={readOnly ? undefined : decideOffer}
            voting={voting}
            moderatorNeutral={moderatorNeutral}
          />
        )}

        <div className="flex flex-col gap-2.5 px-4 pt-3 pb-4">
          <RaisedHands hands={hands} onDecide={readOnly ? undefined : decideHand} />
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

const NO_HANDS: HandRaise[] = [];
