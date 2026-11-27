import type {
  HandRaise,
  MessageReference,
  NamedElement,
  ProjectMember,
  ProjectRole,
  ProjectSearchResult,
} from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { PanelHeader, PanelTitle } from '@web/components/ui/panel';
import { useMentionNames } from '@web/features/agents/agents';
import { ChatStart } from '@web/features/chat/chat-start';
import { Composer } from '@web/features/chat/composer';
import { MessageList } from '@web/features/chat/message-list';
import {
  ProjectSearchButton,
  ProjectSearchPanel,
  ProjectSearchRow,
} from '@web/features/chat/project-search';
import { useMessageHistory } from '@web/features/chat/use-message-history';
import { messagesQuery } from '@web/features/chat/queries';
import { chatStatus, runsQuery } from '@web/features/chat/runs';
import { ChatStatusPill } from '@web/features/chat/status-pill';
import { useSendMessage } from '@web/features/chat/use-send-message';
import { useStopDebate } from '@web/features/debates/queries';
import { useUploads, type UploadProblem } from '@web/features/files/use-uploads';
import { useVoteActions } from '@web/features/decisions/queries';
import type { Voting } from '@web/features/decisions/vote-card';
import { handsQuery, useHandDecisions, useOfferDecisions } from '@web/features/hands/queries';
import { RaisedHands } from '@web/features/hands/raised-hands';
import { UsageLimitNote } from '@web/features/usage/limit-note';

type ChatPanelProps = {
  projectId: string;
  user: { id: string; name: string };
  /** Viewers read along but cannot write. */
  readOnly: boolean;
  /** The agents of the team (spec 14), by key: only they can be mentioned. */
  team: readonly string[];
  /** The members of the project and the user's role, for the vote cards (spec 16b). */
  members: readonly ProjectMember[];
  role: ProjectRole;
  /** Whether the moderator's badge says "neutral" (spec 16b). */
  moderatorNeutral: boolean;
  /** Shows a short note, e.g. when deciding a raised hand or an offer failed. */
  onNotice: (text: string) => void;
  /** Opens the canvas at an element a message refers to (spec 37a). */
  onOpenReference?: (reference: MessageReference) => void;
  /** An element of the canvas someone asks about (spec 37b); it goes into the composer. */
  ask?: NamedElement & { label: string };
  onSearchResult?: (result: ProjectSearchResult) => void;
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
  onOpenReference,
  ask,
  onSearchResult,
}: ChatPanelProps) {
  const { t } = useTranslation();
  const messages = useQuery(messagesQuery(projectId));
  const history = useMessageHistory(projectId);
  const runs = useQuery(runsQuery(projectId));
  const hands = useQuery(handsQuery(projectId)).data ?? NO_HANDS;
  const mentionNames = useMentionNames(team);
  // Everyone but oneself can be mentioned (spec 22a).
  const others = useMemo(
    () => members.filter((member) => member.userId !== user.id),
    [members, user.id],
  );
  const { send, retry } = useSendMessage(
    projectId,
    { userId: user.id, name: user.name },
    mentionNames,
    others,
  );
  const decideHand = useHandDecisions(projectId, (reason) => {
    onNotice(t(reason === 'already_decided' ? 'hands.alreadyDecided' : 'hands.failed'));
  });
  const decideOffer = useOfferDecisions(projectId, user.name, (reason) => {
    onNotice(t(reason === 'already_decided' ? 'offers.alreadyDecided' : 'offers.failed'));
  });
  const votes = useVoteActions(projectId, user.id, (reason) => {
    onNotice(t(reason === 'already_decided' ? 'votes.alreadyClosed' : 'votes.failed'));
  });
  const reportUpload = useCallback(
    (problem: UploadProblem, name: string) => {
      onNotice(t(`files.problems.${problem}`, { name }));
    },
    [onNotice, t],
  );
  const uploads = useUploads(projectId, reportUpload);
  const stopDebate = useStopDebate(projectId, user.name, (reason) => {
    onNotice(t(reason === 'already_decided' ? 'debates.alreadyStopped' : 'debates.stopFailed'));
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

  // A first message the empty chat offers (spec 33): it goes into the composer.
  const [start, setStart] = useState<{ key: number; text: string }>();
  const offerStart = useCallback((text: string) => {
    setStart((previous) => ({ key: (previous?.key ?? 0) + 1, text }));
  }, []);

  // The project search (spec 56) opens from the header or, on a phone, from a row in the chat;
  // closing it gives the focus back to what opened it.
  const searchPanelId = useId();
  const [searchOpen, setSearchOpen] = useState(false);
  const openedFrom = useRef<HTMLElement | null>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchRow = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const openSearch = useCallback((from: HTMLElement | null) => {
    openedFrom.current = from;
    setSearchOpen(true);
  }, []);
  const closeSearch = useCallback(() => {
    restoreFocus.current = true;
    setSearchOpen(false);
  }, []);
  useEffect(() => {
    if (searchOpen || !restoreFocus.current) return;
    restoreFocus.current = false;
    // The row is drawn anew once the search closes, so it is found by its ref again.
    const target =
      openedFrom.current === searchButton.current ? searchButton.current : searchRow.current;
    target?.focus();
  }, [searchOpen]);

  return (
    <>
      {/* On a phone the tab names the chat (spec 36e). */}
      <PanelHeader className="justify-between max-md:hidden">
        <PanelTitle>{t('panels.chat')}</PanelTitle>
        <div className="flex items-center gap-1.5">
          <ChatStatusPill status={chatStatus(runs.data ?? [], messages.data ?? [], hands.length)} />
          <ProjectSearchButton
            ref={searchButton}
            open={searchOpen}
            aria-controls={searchOpen ? searchPanelId : undefined}
            onClick={(event) => {
              if (searchOpen) closeSearch();
              else openSearch(event.currentTarget);
            }}
          />
        </div>
      </PanelHeader>

      <div className="studio-chat-content">
        {searchOpen ? (
          <ProjectSearchPanel
            id={searchPanelId}
            projectId={projectId}
            onClose={closeSearch}
            onOpen={(result) => {
              if (result.kind === 'message') void history.openMessage(result.id);
              else onSearchResult?.(result);
            }}
          />
        ) : (
          <div className="hidden shrink-0 px-4 pt-3 pb-2 max-md:flex">
            <ProjectSearchRow
              ref={searchRow}
              onClick={(event) => {
                openSearch(event.currentTarget);
              }}
            />
          </div>
        )}
        {history.context ? (
          <div
            role="status"
            className="mx-4 mb-2 flex shrink-0 items-center justify-between gap-2 rounded-full bg-bg-subtle py-1 pr-1 pl-3.5 text-small text-text-2"
          >
            <span className="min-w-0 truncate">{t('conversation.context')}</span>
            <Button variant="surface" size="s" onClick={history.latest}>
              {t('conversation.latest')}
            </Button>
          </div>
        ) : null}
        {history.failed ? (
          <p
            role="alert"
            className="mx-4 mt-0 mb-2 shrink-0 rounded-card bg-danger-bg px-3.5 py-2 text-small text-danger"
          >
            {t('conversation.loadFailed')}
          </p>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col">
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
              items={history.context?.items ?? messages.data}
              onLoadOlder={history.loadOlder}
              hasOlder={history.hasOlder}
              loadingOlder={history.loading}
              focusMessageId={history.focusId}
              onOpenMessage={(id) => {
                void history.openMessage(id);
              }}
              empty={
                <ChatStart
                  readOnly={readOnly}
                  // The first messages are for the moderator, who has to be in the team.
                  onStart={team.includes('moderator') ? offerStart : undefined}
                />
              }
              currentUserId={user.id}
              team={team}
              people={members}
              onRetry={retry}
              onOffer={readOnly ? undefined : decideOffer}
              voting={voting}
              moderatorNeutral={moderatorNeutral}
              onStopDebate={readOnly ? undefined : stopDebate}
              onOpenReference={onOpenReference}
            />
          )}

          <div className="flex flex-col gap-2.5 px-3 pb-3">
            <RaisedHands hands={hands} onDecide={readOnly ? undefined : decideHand} />
            {/* While a limit of the AI is reached (spec 31a); people keep writing to each other. */}
            <UsageLimitNote projectId={projectId} />
            {readOnly ? (
              <p className="m-0 rounded-full bg-bg-subtle px-4 py-3.5 text-center text-ui text-text-3">
                {t('chat.readOnly')}
              </p>
            ) : (
              <Composer
                agents={team}
                people={others}
                uploads={uploads}
                start={start}
                ask={ask}
                onSend={(content, attachments, references) => {
                  history.latest();
                  send(content, attachments, references);
                }}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

const NO_HANDS: HandRaise[] = [];
