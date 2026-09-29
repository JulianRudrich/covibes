import type { AgentKey } from '@covibes/shared';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@web/components/ui/avatar';
import { Badge } from '@web/components/ui/badge';
import { MentionText } from '@web/features/chat/mention-text';
import type { ChatItem } from '@web/features/chat/types';
import { cn } from '@web/lib/cn';
import { formatClockTime, initialsOf } from '@web/lib/format';

const AGENT_NAME_COLOR: Record<AgentKey, string> = {
  moderator: 'text-agent-moderator-dark',
  backend: 'text-agent-backend-dark',
  critic: 'text-agent-critic-dark',
  data: 'text-agent-data-dark',
};

type ChatMessageViewProps = {
  item: ChatItem;
  /** Written by the signed-in user, who appears as "You" (as in the workspace header). */
  isOwn: boolean;
  /** Sends a failed message again. Without it a failed message offers no retry. */
  onRetry?: (id: string) => void;
};

/**
 * One chat message (handoff "2. Chat"). Humans have a round avatar; agents a square one in their
 * color, the name in the dark agent color and the badge "Agent". Messages sent from this browser
 * show when they are still on their way or could not be sent.
 */
export function ChatMessageView({ item, isOwn, onRetry }: ChatMessageViewProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const { author, delivery } = item;
  const agent = author.kind === 'agent' ? author.agentKey : null;
  const name =
    author.kind === 'agent'
      ? t(`agents.${author.agentKey}`)
      : isOwn
        ? t('common.you')
        : author.name;

  // Screen readers announce each message as "name (Agent) time (delivery state)".
  const labelIds = [
    `${id}-name`,
    agent === null ? null : `${id}-badge`,
    `${id}-time`,
    delivery === undefined ? null : `${id}-delivery`,
  ].filter((labelId) => labelId !== null);

  return (
    <article
      aria-labelledby={labelIds.join(' ')}
      className={cn(
        'grid grid-cols-[28px_minmax(0,1fr)] gap-2.5 transition-opacity',
        delivery === 'sending' && 'opacity-60',
      )}
    >
      {/* The name is right next to the avatar, so the avatar is not announced a second time. */}
      <div aria-hidden="true">
        {author.kind === 'agent' ? (
          <Avatar
            kind="agent"
            agent={author.agentKey}
            label={name}
            initials={name.charAt(0).toUpperCase()}
            className="text-status"
          />
        ) : (
          <Avatar
            kind="human"
            label={name}
            initials={isOwn ? t('common.you') : initialsOf(author.name)}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-[3px]">
        <div
          className={cn('flex min-w-0 gap-2', agent === null ? 'items-baseline' : 'items-center')}
        >
          <span
            id={`${id}-name`}
            className={cn(
              'min-w-0 text-ui font-semibold wrap-break-word',
              agent === null ? 'text-text' : AGENT_NAME_COLOR[agent],
            )}
          >
            {name}
          </span>
          {agent !== null && (
            <span id={`${id}-badge`} className="flex shrink-0">
              <Badge agent={agent}>{t('chat.agentBadge')}</Badge>
            </span>
          )}
          <time
            id={`${id}-time`}
            dateTime={item.createdAt}
            className="shrink-0 text-meta text-text-4 tabular-nums"
          >
            {formatClockTime(item.createdAt, i18n.language)}
          </time>
          {delivery === 'sending' && (
            <span id={`${id}-delivery`} className="sr-only">
              {t('chat.sending')}
            </span>
          )}
        </div>

        <p className="text-body leading-[1.55] wrap-break-word text-text-body">
          <MentionText text={item.content} />
        </p>

        {delivery === 'failed' && (
          <div className="flex flex-wrap items-baseline gap-x-2 text-meta">
            <span id={`${id}-delivery`} className="text-danger">
              {t('chat.failed')}
            </span>
            {onRetry && (
              <button
                type="button"
                onClick={() => {
                  onRetry(item.id);
                }}
                className="cursor-pointer rounded-xs font-medium text-text-2 underline underline-offset-2 hover:text-text"
              >
                {t('chat.retry')}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
