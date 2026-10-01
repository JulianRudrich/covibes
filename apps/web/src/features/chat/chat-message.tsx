import type { MessageDebate } from '@covibes/shared';
import { Check, CornerDownRight, MessagesSquare } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@web/components/ui/avatar';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import { AgentAvatar } from '@web/features/agents/agent-avatar';
import { agentClass, useAgents, type AgentLook } from '@web/features/agents/agents';
import { MentionText } from '@web/features/chat/mention-text';
import { TypingDots } from '@web/features/chat/status-pill';
import { DebateCard } from '@web/features/debates/debate-card';
import { ComparisonCard } from '@web/features/decisions/comparison-card';
import { VoteCard, type Voting } from '@web/features/decisions/vote-card';
import type { ChatItem } from '@web/features/chat/types';
import { cn } from '@web/lib/cn';
import { formatClockTime, initialsOf } from '@web/lib/format';

const AGENT_NAME_COLOR: Record<AgentLook, string> = {
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
  custom: 'text-agent-custom-dark',
};

const AGENT_CARET: Record<AgentLook, string> = {
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
  custom: 'bg-agent-custom',
};

const NO_AGENTS: readonly string[] = [];

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
  team?: readonly string[];
  /** Accepts or declines the moderator's offer of help (spec 15); viewers get no buttons. */
  onOffer?: (message: ChatItem, accept: boolean) => void;
  /** Who votes and how, for the vote card of a message (spec 16b). */
  voting?: Voting;
  /** The moderator's badge says "neutral" unless its stance is its own opinion (spec 16b). */
  moderatorNeutral?: boolean;
  /** Ends a running debate early (spec 18); viewers get no button. */
  onStopDebate?: (debate: MessageDebate) => void;
};

/**
 * One chat message (handoff "2. Chat"). Humans have a round avatar; agents a square one in their
 * color, the name in the dark agent color and the badge "Agent"; the moderator writes in its own
 * card. While an agent's answer streams in, the header says it is typing and a caret follows the
 * text. Messages sent from this browser show when they are still on their way or could not be sent.
 * A turn of a debate and its summary are marked above their text (spec 18).
 */
export function ChatMessageView({
  item,
  isOwn,
  replyToName,
  onRetry,
  team = NO_AGENTS,
  onOffer,
  voting,
  moderatorNeutral = true,
  onStopDebate,
}: ChatMessageViewProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const agents = useAgents();
  const { author, delivery } = item;
  const agent = author.kind === 'agent' ? agents(author.agentKey) : null;
  const isModerator = agent?.key === 'moderator';
  // The agent whose answer is still streaming in, if any.
  const streamingAgent = agent !== null && item.status === 'streaming' ? agent : null;
  const name =
    agent !== null ? agent.name : author.kind === 'human' && !isOwn ? author.name : t('common.you');

  // Screen readers announce each message as "name (Agent) time (delivery state)".
  const labelIds = [
    `${id}-name`,
    agent === null ? null : `${id}-badge`,
    `${id}-time`,
    delivery === undefined ? null : `${id}-delivery`,
  ].filter((labelId) => labelId !== null);

  const avatar =
    agent !== null ? (
      <AgentAvatar
        agent={agent}
        size={isModerator ? 24 : 28}
        className={isModerator ? undefined : 'text-status'}
      />
    ) : (
      <Avatar
        kind="human"
        label={name}
        initials={isOwn || author.kind !== 'human' ? t('common.you') : initialsOf(author.name)}
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
          agent === null ? 'text-text' : agentClass(AGENT_NAME_COLOR, agent),
        )}
      >
        {name}
      </span>
      {agent !== null && (
        <span id={`${id}-badge`} className="flex shrink-0">
          <Badge agent={agent}>
            {t(isModerator && moderatorNeutral ? 'chat.agentNeutral' : 'chat.agentBadge')}
          </Badge>
        </span>
      )}
      {streamingAgent ? (
        <span
          id={`${id}-time`}
          className={cn(
            'flex shrink-0 items-center gap-1.5 text-meta',
            agentClass(AGENT_NAME_COLOR, streamingAgent),
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
      {item.debateTurn ? (
        <div className="flex items-center gap-[5px] text-meta text-text-3">
          <MessagesSquare size={12} strokeWidth={2} aria-hidden="true" />
          {item.debateTurn.round === null
            ? t('debates.markSummary')
            : t('debates.markRound', {
                round: item.debateTurn.round,
                rounds: item.debateTurn.rounds,
              })}
        </div>
      ) : null}
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
              agentClass(AGENT_CARET, streamingAgent),
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
        {item.comparison ? <ComparisonCard comparison={item.comparison} /> : null}
        {item.vote && voting ? <VoteCard vote={item.vote} voting={voting} /> : null}
        {item.debate ? <DebateCard debate={item.debate} onStop={onStopDebate} /> : null}
        {item.offer ? <OfferActions item={item} onOffer={onOffer} /> : null}
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

/**
 * The moderator's offer of help (spec 15; handoff: the buttons of the moderator's card): its action
 * and "Später" while open, then a line with a check that says who decided.
 */
function OfferActions({
  item,
  onOffer,
}: {
  item: ChatItem;
  onOffer?: (message: ChatItem, accept: boolean) => void;
}) {
  const { t } = useTranslation();
  const { offer } = item;
  if (!offer) return null;
  if (offer.status === 'open') {
    if (!onOffer) return null;
    return (
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="primary"
          onClick={() => {
            onOffer(item, true);
          }}
        >
          {offer.action}
        </Button>
        <Button
          onClick={() => {
            onOffer(item, false);
          }}
        >
          {t('offers.later')}
        </Button>
      </div>
    );
  }
  const accepted = offer.status === 'accepted';
  const text = offer.decidedBy
    ? t(accepted ? 'offers.acceptedBy' : 'offers.declinedBy', { name: offer.decidedBy })
    : t(accepted ? 'offers.accepted' : 'offers.declined');
  return (
    <p className="m-0 flex items-center gap-1.5 border-t border-agent-moderator-divider pt-2.5 text-small text-agent-moderator-dark">
      <Check size={14} strokeWidth={2.4} className="shrink-0" aria-hidden="true" />
      {text}
    </p>
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
