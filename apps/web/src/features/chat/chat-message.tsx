import type { MessageDebate, MessageReference } from '@covibes/shared';
import { Check, CornerDownRight, MessagesSquare } from 'lucide-react';
import { useId, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@web/components/ui/avatar';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import { AgentAvatar } from '@web/features/agents/agent-avatar';
import { agentClass, useAgents, type AgentLook } from '@web/features/agents/agents';
import { FormattedMessage } from '@web/features/chat/formatted-message';
import { TypingDots } from '@web/features/chat/status-pill';
import { DebateCard } from '@web/features/debates/debate-card';
import { AttachmentList } from '@web/features/files/attachment-list';
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

/** An agent writes into a bubble in its tint. */
const AGENT_BUBBLE: Record<AgentLook, string> = {
  moderator: 'bg-agent-moderator-tint',
  backend: 'bg-agent-backend-tint',
  critic: 'bg-agent-critic-tint',
  data: 'bg-agent-data-tint',
  product: 'bg-agent-product-tint',
  frontend: 'bg-agent-frontend-tint',
  devops: 'bg-agent-devops-tint',
  security: 'bg-agent-security-tint',
  ml: 'bg-agent-ml-tint',
  content: 'bg-agent-content-tint',
  custom: 'bg-agent-custom-tint',
};

const NO_AGENTS: readonly string[] = [];
const NO_PEOPLE: readonly { userId: string; name: string }[] = [];

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
  /** The members of the project; a person's message shows chips for those it mentions (spec 22a). */
  people?: readonly { userId: string; name: string }[];
  /** The signed-in user, whose own mention stands out. */
  currentUserId?: string;
  /** Accepts or declines the moderator's offer of help (spec 15); viewers get no buttons. */
  onOffer?: (message: ChatItem, accept: boolean) => void;
  /** Who votes and how, for the vote card of a message (spec 16b). */
  voting?: Voting;
  /** The moderator's badge says "neutral" unless its stance is its own opinion (spec 16b). */
  moderatorNeutral?: boolean;
  /** Ends a running debate early (spec 18); viewers get no button. */
  onStopDebate?: (debate: MessageDebate) => void;
  /** Leads to an element of the canvas the message refers to (spec 37a). */
  onOpenReference?: (reference: MessageReference) => void;
  onOpenMessage?: (messageId: string) => void;
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
  people = NO_PEOPLE,
  currentUserId,
  onOffer,
  voting,
  moderatorNeutral = true,
  onStopDebate,
  onOpenReference,
  onOpenMessage,
}: ChatMessageViewProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const agents = useAgents();
  const { author, delivery } = item;
  const TextContainer = /(^|\n)\s*(?:```|[-*+]\s|\d+[.)]\s)/.test(item.content) ? 'div' : 'p';
  const agent = author.kind === 'agent' ? agents(author.agentKey) : null;
  const isModerator = agent?.key === 'moderator';
  // The agent whose answer is still streaming in, if any.
  const streamingAgent = agent !== null && item.status === 'streaming' ? agent : null;
  const name =
    agent !== null ? agent.name : author.kind === 'human' && !isOwn ? author.name : t('common.you');

  // The people the server found mentioned; agents mention nobody.
  const mentionedUsers = item.mentionedUsers;
  const mentioned = useMemo(
    () =>
      mentionedUsers && mentionedUsers.length > 0
        ? people.filter((person) => mentionedUsers.includes(person.userId))
        : NO_PEOPLE,
    [people, mentionedUsers],
  );

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
        size={isModerator ? 28 : 30}
        // The moderator's mark stands on the panel color inside its tinted card.
        className={isModerator ? 'bg-bg-panel' : undefined}
      />
    ) : (
      <Avatar
        kind="human"
        size={30}
        label={name}
        initials={isOwn || author.kind !== 'human' ? t('common.you') : initialsOf(author.name)}
      />
    );

  // Name, badge and time above a bubble (handoff: "Alex · 10:41"); the moderator's card has them
  // in its first row with its mark.
  const time = streamingAgent ? (
    <span
      id={`${id}-time`}
      className={cn(
        'flex shrink-0 items-center gap-1.5',
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
      className={cn('shrink-0 text-text-3 tabular-nums', isModerator && 'ml-auto')}
    >
      {formatClockTime(item.createdAt, i18n.language)}
    </time>
  );
  const delivering =
    delivery === 'sending' ? (
      <span id={`${id}-delivery`} className="sr-only">
        {t('chat.sending')}
      </span>
    ) : null;
  const header = isModerator ? (
    <div className="flex min-w-0 items-center gap-2">
      {/* The name is right next to the mark, so the mark is not announced a second time. */}
      <span aria-hidden="true" className="flex">
        {avatar}
      </span>
      <span
        id={`${id}-name`}
        className="min-w-0 text-body font-bold wrap-break-word text-agent-moderator-dark"
      >
        {name}
      </span>
      <span
        id={`${id}-badge`}
        className="flex h-5 shrink-0 items-center rounded-full bg-bg-panel px-2 text-meta font-semibold text-agent-moderator-dark"
      >
        {t(moderatorNeutral ? 'chat.neutral' : 'chat.agentBadge')}
      </span>
      <span className="ml-auto flex shrink-0 text-status">{time}</span>
      {delivering}
    </div>
  ) : (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-status text-text-3',
        isOwn ? 'mr-3 justify-end' : 'ml-3',
      )}
    >
      <span
        id={`${id}-name`}
        // Own bubbles show no name, as in the handoff; screen readers still hear it.
        className={cn(
          'min-w-0 font-semibold wrap-break-word',
          isOwn ? 'sr-only' : agent === null ? 'text-text-2' : agentClass(AGENT_NAME_COLOR, agent),
        )}
      >
        {name}
      </span>
      {agent !== null && (
        <span id={`${id}-badge`} className="flex shrink-0">
          <Badge agent={agent}>{t('chat.agentBadge')}</Badge>
        </span>
      )}
      {isOwn ? null : <span aria-hidden="true">·</span>}
      {time}
      {delivering}
    </div>
  );

  // "Debatte · Runde 1 von 2" and "Antwort an Sam" stand above the text.
  const markClass = cn('flex items-center gap-[5px] text-meta text-text-3', !isModerator && 'ml-3');
  const marks = (
    <>
      {item.debateTurn ? (
        <div className={markClass}>
          <MessagesSquare size={12} strokeWidth={2} aria-hidden="true" />
          {item.debateTurn.round === null
            ? t('debates.markSummary')
            : t('debates.markRound', {
                round: item.debateTurn.round,
                rounds: item.debateTurn.rounds,
              })}
        </div>
      ) : null}
      {replyToName === undefined && !(item.replyTo && onOpenMessage) ? null : (
        <div className={markClass}>
          <CornerDownRight size={12} strokeWidth={2} aria-hidden="true" />
          {item.replyTo && onOpenMessage ? (
            <button
              type="button"
              onClick={() => {
                onOpenMessage(item.replyTo ?? '');
              }}
            >
              {replyToName ? t('chat.replyTo', { name: replyToName }) : t('conversation.openReply')}
            </button>
          ) : (
            t('chat.replyTo', { name: replyToName })
          )}
        </div>
      )}
    </>
  );

  const text = (
    <>
      <FormattedMessage
        text={item.content}
        agents={agent === null ? item.mentions : team}
        people={mentioned}
        self={currentUserId}
        references={item.references}
        onOpenReference={onOpenReference}
        onInk={isOwn}
      />
      {streamingAgent ? (
        <span
          aria-hidden="true"
          className={cn(
            'ml-0.5 inline-block h-[15px] w-0.5 translate-y-[3px] animate-caret-blink motion-reduce:animate-none',
            agentClass(AGENT_CARET, streamingAgent),
          )}
        />
      ) : null}
    </>
  );

  const after = (
    <>
      {item.attachments ? (
        <AttachmentList projectId={item.projectId} attachments={item.attachments} />
      ) : null}

      {agent !== null && item.status === 'error' ? (
        <span className={cn('text-meta text-danger', !isModerator && 'ml-3')}>
          {t('chat.agentError')}
        </span>
      ) : null}

      {delivery === 'failed' && (
        <div
          className={cn(
            'flex flex-wrap items-baseline gap-x-2 text-meta',
            isOwn ? 'mr-3 justify-end' : 'ml-3',
          )}
        >
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
        {marks}
        <TextContainer className="m-0 text-body leading-[1.55] wrap-break-word text-text-body">
          {text}
        </TextContainer>
        {after}
        {item.comparison ? <ComparisonCard comparison={item.comparison} /> : null}
        {item.vote && voting ? <VoteCard vote={item.vote} voting={voting} /> : null}
        {item.debate ? <DebateCard debate={item.debate} onStop={onStopDebate} /> : null}
        {item.offer ? <OfferActions item={item} onOffer={onOffer} /> : null}
      </Card>
    );
  }

  // A bubble (handoff "Chat"): others on the left with their avatar and the corner at the author,
  // own messages on the right in ink without an avatar, agents in their tint.
  return (
    <article
      aria-labelledby={labelIds.join(' ')}
      className={cn(
        'flex gap-2.5 transition-opacity',
        isOwn ? 'justify-end' : 'items-end',
        delivery === 'sending' && 'opacity-60',
      )}
    >
      {isOwn ? null : (
        <div aria-hidden="true" className="flex shrink-0">
          {avatar}
        </div>
      )}
      <div
        className={cn(
          'flex min-w-0 flex-col gap-1',
          agent === null ? 'max-w-[272px]' : 'max-w-[290px]',
          'max-md:max-w-[80%]',
          isOwn && 'items-end',
        )}
      >
        {header}
        {marks}
        <TextContainer
          className={cn(
            'm-0 max-w-full rounded-[18px] px-3.5 py-2.5 text-body wrap-break-word',
            isOwn
              ? 'rounded-br-[6px] bg-ink leading-normal text-on-ink'
              : agent === null
                ? 'rounded-bl-[6px] bg-bg-subtle leading-normal text-text-body'
                : cn(
                    'rounded-bl-[6px] leading-[1.55] text-text-body',
                    agentClass(AGENT_BUBBLE, agent),
                  ),
          )}
        >
          {text}
        </TextContainer>
        {after}
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
      <div className="flex flex-wrap gap-1.5 max-md:grid max-md:grid-cols-2 max-md:gap-2">
        <Button
          variant="primary"
          className="h-[34px] px-4 max-md:h-11 max-md:text-[14px]"
          onClick={() => {
            onOffer(item, true);
          }}
        >
          {offer.action}
        </Button>
        <Button
          variant="surface"
          className="h-[34px] px-4 max-md:h-11 max-md:text-[14px]"
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
    <p className="m-0 flex animate-pop items-center gap-[7px] border-t border-agent-moderator-border pt-2.5 text-ui font-semibold text-agent-moderator-dark">
      <Check size={14} strokeWidth={2.6} className="shrink-0" aria-hidden="true" />
      {text}
    </p>
  );
}

/** The moderator's card (handoff "Chat"): its tint, a 1 px inner line, radius 20. */
function Card({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  return (
    <article
      aria-labelledby={labelledBy}
      className="flex flex-col gap-2.5 rounded-[20px] bg-agent-moderator-tint p-3.5 inset-ring inset-ring-agent-moderator-border"
    >
      {children}
    </article>
  );
}
