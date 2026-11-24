import type { MessageDebate, MessageReference } from '@covibes/shared';
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { ChatMessageView } from '@web/features/chat/chat-message';
import type { ChatItem } from '@web/features/chat/types';
import type { Voting } from '@web/features/decisions/vote-card';
import { formatLongDate, isSameLocalDay } from '@web/lib/format';

/** Closer than this to the bottom counts as "at the bottom", so new messages scroll into view. */
const STICK_THRESHOLD_PX = 48;
/** On the first load the last messages rise one after the other (handoff "Motion"). */
const RISE_STAGGER_MS = 80;
const RISE_STAGGERED = 6;

type MessageListProps = {
  items: readonly ChatItem[];
  /** What the chat shows before its first message (spec 33). */
  empty: ReactNode;
  currentUserId: string;
  /** The agents of the team, whose mentions in agent answers are shown as chips. */
  team: readonly string[];
  /** The members of the project, for the chips of mentioned people (spec 22a). */
  people?: readonly { userId: string; name: string }[];
  onRetry: (id: string) => void;
  /** Accepts or declines the moderator's offer of help; without it the buttons are left out. */
  onOffer?: (message: ChatItem, accept: boolean) => void;
  /** Who votes and how, for the vote cards (spec 16b). */
  voting?: Voting;
  moderatorNeutral?: boolean;
  /** Ends a running debate early (spec 18); without it the button is left out. */
  onStopDebate?: (debate: MessageDebate) => void;
  /** Leads to an element of the canvas a message refers to (spec 37a). */
  onOpenReference?: (reference: MessageReference) => void;
  onLoadOlder?: () => Promise<void>;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  focusMessageId?: string;
  onOpenMessage?: (messageId: string) => void;
};

function DayDivider({ label }: { label: string }) {
  return (
    <li role="separator" className="flex items-center gap-2.5 py-1 text-meta text-text-4">
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
  empty,
  currentUserId,
  team,
  people,
  onRetry,
  onOffer,
  voting,
  moderatorNeutral,
  onStopDebate,
  onOpenReference,
  onLoadOlder,
  hasOlder = false,
  loadingOlder = false,
  focusMessageId,
  onOpenMessage,
}: MessageListProps) {
  const { t, i18n } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const readingAnchor = useRef<{ height: number; top: number } | null>(null);
  const focusedMessage = useRef<string | undefined>(undefined);
  const lastId = useRef<string | undefined>(undefined);
  // The messages of the first load, newest first: they rise staggered, later ones at once.
  const [firstLoad] = useState(() => items.map((item) => item.id).reverse());

  useLayoutEffect(() => {
    const element = scroller.current;
    const last = items.at(-1);
    const ownNewMessage =
      last !== undefined &&
      last.id !== lastId.current &&
      last.author.kind === 'human' &&
      last.author.userId === currentUserId;
    lastId.current = last?.id;
    if (element && readingAnchor.current) {
      element.scrollTop =
        readingAnchor.current.top + element.scrollHeight - readingAnchor.current.height;
      readingAnchor.current = null;
      atBottom.current = false;
    } else if (element && (atBottom.current || ownNewMessage)) {
      element.scrollTop = element.scrollHeight;
      atBottom.current = true;
    }
  }, [items, currentUserId]);

  useLayoutEffect(() => {
    if (!focusMessageId) {
      focusedMessage.current = undefined;
      return;
    }
    if (focusedMessage.current === focusMessageId || !scroller.current) return;
    const item = [...scroller.current.querySelectorAll<HTMLElement>('[data-message-id]')].find(
      (element) => element.dataset.messageId === focusMessageId,
    );
    if (!item) return;
    focusedMessage.current = focusMessageId;
    atBottom.current = false;
    item.scrollIntoView({ block: 'center' });
    item.focus({ preventScroll: true });
  }, [focusMessageId, items]);

  function older() {
    const element = scroller.current;
    if (!element || !onLoadOlder || loadingOlder || !hasOlder) return;
    readingAnchor.current = { height: element.scrollHeight, top: element.scrollTop };
    atBottom.current = false;
    void onLoadOlder();
  }

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
    if (element.scrollTop <= STICK_THRESHOLD_PX) older();
  }

  if (items.length === 0) return empty;

  const now = new Date().toISOString();
  const byId = new Map(items.map((item) => [item.id, item]));
  return (
    <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      {hasOlder ? (
        <button type="button" disabled={loadingOlder} onClick={older}>
          {t(loadingOlder ? 'common.loading' : 'conversation.loadOlder')}
        </button>
      ) : null}
      {/* Few messages stand at the bottom, next to the composer (handoff "Chat"). */}
      <ol
        aria-label={t('chat.messages')}
        className="m-0 flex min-h-full list-none flex-col justify-end gap-3.5 px-4 pt-1 pb-3.5"
      >
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
              <li
                data-message-id={item.id}
                tabIndex={-1}
                className="animate-rise"
                style={riseDelay(firstLoad.indexOf(item.id))}
              >
                <ChatMessageView
                  item={item}
                  isOwn={isOwn}
                  replyToName={replyToName}
                  team={team}
                  people={people}
                  currentUserId={currentUserId}
                  onRetry={onRetry}
                  onOffer={onOffer}
                  voting={voting}
                  moderatorNeutral={moderatorNeutral}
                  onStopDebate={onStopDebate}
                  onOpenReference={onOpenReference}
                  onOpenMessage={onOpenMessage}
                />
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}

function riseDelay(fromNewest: number): CSSProperties | undefined {
  if (fromNewest < 0 || fromNewest >= RISE_STAGGERED) return undefined;
  return { animationDelay: `${String((RISE_STAGGERED - 1 - fromNewest) * RISE_STAGGER_MS)}ms` };
}
