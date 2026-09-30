import type { AgentKey } from '@covibes/shared';
import { CornerDownRight } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@web/components/ui/avatar';
import { Badge } from '@web/components/ui/badge';
import { MentionText } from '@web/features/chat/mention-text';
import { TypingDots } from '@web/features/chat/status-pill';
import type { ChatItem } from '@web/features/chat/types';
import { cn } from '@web/lib/cn';
import { formatClockTime, initialsOf } from '@web/lib/format';

const AGENT_NAME_COLOR: Record<AgentKey, string> = {
  moderator: 'text-agent-moderator-dark',
  backend: 'text-agent-backend-dark',
  critic: 'text-agent-critic-dark',
  data: 'text-agent-data-dark',
  product: 'text-agent-product-dark',
  frontend: 'text-agent-frontend-dark',
  devops: 'text-agent-devops-dark',
  security: 'text-agent-security-dark',
  ml: 'text-agent-ml-dark',
  content: 'text-agent-content-dark',
};

const AGENT_CARET: Record<AgentKey, string> = {
  moderator: 'bg-agent-moderator',
  backend: 'bg-agent-backend',
  critic: 'bg-agent-critic',
  data: 'bg-agent-data',
  product: 'bg-agent-product',
  frontend: 'bg-agent-frontend',
  devops: 'bg-agent-devops',
  security: 'bg-agent-security',
  ml: 'bg-agent-ml',
  content: 'bg-agent-content',
};

const NO_AGENTS: readonly AgentKey[] = [];

type ChatMessageViewProps = {
  item: ChatItem;
  /** Written by the signed-in user, who appears as "You" (as in the workspace header). */
  isOwn: boolean;
  /** Name of the person this message answers ("↳ Reply to Sam"), if it answers a person. */
  replyToName?: string;
  /** Sends a failed message again. Without it a failed message offers no retry. */
  onRetry?: (id: string) => void;
  /**
   * The agents of the team (spec 14). A person's message shows chips for the mentions the server
   * kept; an agent's answer for the agents of the team it names.
   */
  team?: readonly AgentKey[];
};

/**
 * One chat message (handoff "2. Chat"). Humans have a round avatar; agents a square one in their
 * color, the name in the dark agent color and the badge "Agent"; the moderator writes in its own
 * card. While an agent's answer streams in, the header says it is typing and a caret follows the
 * text. Messages sent from this browser show when they are still on their way or could not be sent.
 */
export function ChatMessageView({
  item,
  isOwn,
  replyToName,
  onRetry,
  team = NO_AGENTS,
}: ChatMessageViewProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const { author, delivery } = item;
  const agent = author.kind === 'agent' ? author.agentKey : null;
  const isModerator = agent === 'moderator';
  // The agent whose answer is still streaming in, if any.
  const streamingAgent = agent !== null && item.status === 'streaming' ? agent : null;
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

  const avatar =
    author.kind === 'agent' ? (
      <Avatar
        kind="agent"
        agent={author.agentKey}
        label={name}
        initials={t(`agentInitials.${author.agentKey}`)}
        size={isModerator ? 24 : 28}
        className={isModerator ? undefined : 'text-status'}
      />
    ) : (
      <Avatar
        kind="human"
        label={name}
        initials={isOwn ? t('common.you') : initialsOf(author.name)}
      />
    );

  const header = (
    <div
      className={cn(
        'flex min-w-0',
        isModerator ? 'items-center gap-2' : 'gap-2',
        !isModerator && (agent === null ? 'items-baseline' : 'items-center'),
      )}
    >
      {/* The name is right next to the avatar, so the avatar is not announced a second time. */}
      {isModerator ? <span aria-hidden="true">{avatar}</span> : null}
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
          <Badge agent={agent}>{t(isModerator ? 'chat.agentNeutral' : 'chat.agentBadge')}</Badge>
        </span>
      )}
      {streamingAgent ? (
        <span
          id={`${id}-time`}
          className={cn(
            'flex shrink-0 items-center gap-1.5 text-meta',
            AGENT_NAME_COLOR[streamingAgent],
            isModerator && 'ml-auto',
          )}
        >
          <TypingDots agent={streamingAgent} />
          {t('chat.typingShort')}
        </span>
      ) : (
        <time
          id={`${id}-time`}
          dateTime={item.createdAt}
          className={cn(
            'shrink-0 text-meta tabular-nums',
            isModerator ? 'ml-auto text-text-3' : 'text-text-4',
          )}
        >
          {formatClockTime(item.createdAt, i18n.language)}
        </time>
      )}
      {delivery === 'sending' && (
        <span id={`${id}-delivery`} className="sr-only">
          {t('chat.sending')}
        </span>
      )}
    </div>
  );

  const body = (
    <>
      {replyToName === undefined ? null : (
        <div className="flex items-center gap-[5px] text-meta text-text-3">
          <CornerDownRight size={12} strokeWidth={2} aria-hidden="true" />
          {t('chat.replyTo', { name: replyToName })}
        </div>
      )}

      <p className="text-body leading-[1.55] wrap-break-word text-text-body">
        <MentionText text={item.content} agents={agent === null ? item.mentions : team} />
        {streamingAgent ? (
          <span
            aria-hidden="true"
            className={cn(
              'ml-px inline-block h-[15px] w-0.5 translate-y-[3px] animate-caret-blink motion-reduce:animate-none',
              AGENT_CARET[streamingAgent],
            )}
          />
        ) : null}
      </p>

      {agent !== null && item.status === 'error' ? (
        <span className="text-meta text-danger">{t('chat.agentError')}</span>
      ) : null}

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
    </>
  );

  if (isModerator) {
    return (
      <Card labelledBy={labelIds.join(' ')}>
        {header}
        {body}
      </Card>
    );
  }

  return (
    <article
      aria-labelledby={labelIds.join(' ')}
      className={cn(
        'grid grid-cols-[28px_minmax(0,1fr)] gap-2.5 transition-opacity',
        delivery === 'sending' && 'opacity-60',
      )}
    >
      <div aria-hidden="true">{avatar}</div>
      <div className="flex min-w-0 flex-col gap-[3px]">
        {header}
        {body}
      </div>
    </article>
  );
}

/** The moderator's card (handoff "Moderator message"): moderator border and tint, padding 12. */
function Card({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  return (
    <article
      aria-labelledby={labelledBy}
      className="flex flex-col gap-2.5 rounded-panel border border-agent-moderator-border bg-agent-moderator-tint-2 p-3"
    >
      {children}
    </article>
  );
}
