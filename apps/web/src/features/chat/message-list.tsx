import type { AgentKey, MessageDebate } from '@covibes/shared';
import { Fragment, useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatMessageView } from '@web/features/chat/chat-message';
import type { ChatItem } from '@web/features/chat/types';
import type { Voting } from '@web/features/decisions/vote-card';
import { formatLongDate, isSameLocalDay } from '@web/lib/format';

/** Closer than this to the bottom counts as "at the bottom", so new messages scroll into view. */
const STICK_THRESHOLD_PX = 48;

type MessageListProps = {
  items: readonly ChatItem[];
  currentUserId: string;
  /** The agents of the team, whose mentions in agent answers are shown as chips. */
  team: readonly AgentKey[];
  onRetry: (id: string) => void;
  /** Accepts or declines the moderator's offer of help; without it the buttons are left out. */
  onOffer?: (message: ChatItem, accept: boolean) => void;
  /** Who votes and how, for the vote cards (spec 16b). */
  voting?: Voting;
  moderatorNeutral?: boolean;
  /** Ends a running debate early (spec 18); without it the button is left out. */
  onStopDebate?: (debate: MessageDebate) => void;
};

function DayDivider({ label }: { label: string }) {
  return (
    <li role="separator" className="flex items-center gap-2.5 text-meta text-text-4">
      <span className="h-px flex-1 bg-border-subtle" aria-hidden="true" />
      {label}
      <span className="h-px flex-1 bg-border-subtle" aria-hidden="true" />
    </li>
  );
}

/**
 * The chat history with a divider per day ("Today" or the date). It follows new messages as long
 * as the reader is at the bottom; after scrolling up it stays put, except for own new messages.
 */
export function MessageList({
  items,
  currentUserId,
  team,
  onRetry,
  onOffer,
  voting,
  moderatorNeutral,
  onStopDebate,
}: MessageListProps) {
  const { t, i18n } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastId = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    const element = scroller.current;
    const last = items.at(-1);
    const ownNewMessage =
      last !== undefined &&
      last.id !== lastId.current &&
      last.author.kind === 'human' &&
      last.author.userId === currentUserId;
    lastId.current = last?.id;
    if (element && (atBottom.current || ownNewMessage)) {
      element.scrollTop = element.scrollHeight;
      atBottom.current = true;
    }
  }, [items, currentUserId]);

  // The list gets shorter when something appears below it, e.g. a raised hand above the composer
  // (spec 15); a reader at the bottom stays there.
  const hasItems = items.length > 0;
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [hasItems]);

  function onScroll() {
    const element = scroller.current;
    if (!element) return;
    atBottom.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < STICK_THRESHOLD_PX;
  }

  if (items.length === 0) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-6 text-center text-ui text-text-3">
        {t('empty.chat')}
      </div>
    );
  }

  const now = new Date().toISOString();
  const byId = new Map(items.map((item) => [item.id, item]));
  return (
    <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <ol aria-label={t('chat.messages')} className="m-0 flex list-none flex-col gap-[18px] p-4">
        {items.map((item, index) => {
          const previous = items[index - 1];
          const newDay = !previous || !isSameLocalDay(previous.createdAt, item.createdAt);
          const isOwn = item.author.kind === 'human' && item.author.userId === currentUserId;
          // "↳ Reply to Sam" only for answers to a person whose message is in the list.
          const replied = item.replyTo === null ? undefined : byId.get(item.replyTo);
          const replyToName = replied?.author.kind === 'human' ? replied.author.name : undefined;
          return (
            <Fragment key={item.id}>
              {newDay ? (
                <DayDivider
                  label={
                    isSameLocalDay(item.createdAt, now)
                      ? t('chat.today')
                      : formatLongDate(item.createdAt, i18n.language)
                  }
                />
              ) : null}
              <li>
                <ChatMessageView
                  item={item}
                  isOwn={isOwn}
                  replyToName={replyToName}
                  team={team}
                  onRetry={onRetry}
                  onOffer={onOffer}
                  voting={voting}
                  moderatorNeutral={moderatorNeutral}
                  onStopDebate={onStopDebate}
                />
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}
