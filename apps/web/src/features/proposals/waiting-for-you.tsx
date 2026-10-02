import {
  variantLetter,
  type AgentKey,
  type CanvasProposal,
  type DecisionProposal,
  type HandRaise,
  type OpenVote,
  type Proposal,
  type TeamProposal,
  type VariantsProposal,
} from '@covibes/shared';
import { Check } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import { Avatar } from '@web/components/ui/avatar';
import { Button } from '@web/components/ui/button';
import { AgentAvatar } from '@web/features/agents/agent-avatar';
import { agentClass, useAgents } from '@web/features/agents/agents';
import { AGENT_DARK_TEXT } from '@web/features/canvas/agent-look';
import type { HandDecision } from '@web/features/hands/queries';
import type { DecideProposal, DecidedProposal } from '@web/features/proposals/queries';
import { proposalSummary } from '@web/features/proposals/summary';
import { waitingCount } from '@web/features/proposals/waiting-count';
import { VariantPreview } from '@web/features/proposals/variant-preview';
import { formatRelativeTime } from '@web/lib/format';
import { cn } from '@web/lib/cn';

type WaitingForYouProps = {
  proposals: readonly Proposal[];
  /** Proposals decided in this session, shown as lines with a check. */
  decided: readonly DecidedProposal[];
  canDecide: boolean;
  /** Whether the user confirms decisions; false for editors while the owner decides (spec 16b). */
  canConfirmDecisions?: boolean;
  onDecide: DecideProposal;
  activeBoardId: string | null;
  /** Opens the board of a proposal that lies on another one. */
  onOpenBoard: (boardId: string) => void;
  /** The open raised hands of the agents (spec 22a). */
  hands?: readonly HandRaise[];
  onHand?: (hand: HandRaise, decision: HandDecision) => void;
  /** The open votes in which the user has not voted yet (spec 22a). */
  votes?: readonly OpenVote[];
  onVote?: (vote: OpenVote, option: number) => void;
  /** How many people vote, for "1 von 3 haben abgestimmt". */
  voters?: number;
};

const NO_HANDS: readonly HandRaise[] = [];
const NO_VOTES: readonly OpenVote[] = [];

const CARD = 'flex flex-col gap-2.5 rounded-card border border-border bg-bg-panel p-3 shadow-panel';

const BOLD = { b: <strong className="font-semibold text-text" /> };

/** Agent names as a list in the UI language, e.g. "Kritiker und Sicherheit". */
function useAgentList() {
  const { t, i18n } = useTranslation();
  return (agents: readonly AgentKey[]) =>
    new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(
      agents.map((agent) => t(`agents.${agent}`)),
    );
}

/**
 * "Wartet auf dich" in the overview (handoff, section 4; spec 13 for proposals): a live counter,
 * one card per open proposal with "Übernehmen" and "Verwerfen", in sync with the canvas, and a
 * line with a check for every proposal decided in this session. Raised hands and votes without
 * the own vote wait here too (spec 22a); the counter counts what the user can act on.
 */
export function WaitingForYou({
  proposals,
  decided,
  canDecide,
  canConfirmDecisions = canDecide,
  onDecide,
  activeBoardId,
  onOpenBoard,
  hands = NO_HANDS,
  onHand,
  votes = NO_VOTES,
  onVote,
  voters,
}: WaitingForYouProps) {
  const { t, i18n } = useTranslation();
  const agents = useAgents();
  const agentList = useAgentList();
  // What the user can act on: nothing for viewers, no decisions while only the owner decides.
  const waiting = waitingCount({ proposals, hands, votes, canDecide, canConfirmDecisions });

  return (
    <section
      aria-labelledby="waiting-for-you"
      className="flex flex-col gap-2.5 border-b border-border-subtle p-4"
    >
      <div className="flex items-center gap-2">
        <h3 id="waiting-for-you" className="m-0 text-ui font-semibold text-text">
          {t('overview.waiting')}
        </h3>
        <span
          className="grid h-5 min-w-5 place-items-center rounded-[10px] bg-ink px-1.5 text-badge font-semibold text-on-ink tabular-nums"
          aria-label={t('overview.waitingCount', { count: waiting })}
        >
          {waiting}
        </span>
      </div>

      {proposals.length + hands.length + votes.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {proposals.map((proposal) => {
            const agent = agents(proposal.agentKey);
            return (
              <li key={proposal.id} className={CARD}>
                <div className="flex items-center gap-1.5 text-meta text-text-3">
                  <AgentAvatar agent={agent} size={16} />
                  <span className={cn('font-medium', agentClass(AGENT_DARK_TEXT, agent))}>
                    {agent.name}
                  </span>
                  <span>
                    ·{' '}
                    {t(
                      proposal.kind === 'decision'
                        ? 'proposals.kindDecision'
                        : proposal.kind === 'variants'
                          ? 'variants.kind'
                          : 'proposals.kind',
                    )}
                  </span>
                  <span className="ml-auto tabular-nums">
                    {formatRelativeTime(proposal.createdAt, i18n.language)}
                  </span>
                </div>
                {proposal.kind === 'team' ? (
                  <TeamSummary proposal={proposal} />
                ) : proposal.kind === 'decision' ? (
                  <DecisionSummary proposal={proposal} />
                ) : proposal.kind === 'variants' ? (
                  <VariantsSummary
                    proposal={proposal}
                    elsewhere={proposal.boardId !== activeBoardId}
                    onOpenBoard={onOpenBoard}
                  />
                ) : (
                  <CanvasSummary
                    proposal={proposal}
                    elsewhere={proposal.boardId !== activeBoardId}
                    onOpenBoard={onOpenBoard}
                  />
                )}
                {/* Choosing a variant or confirming a decision decides (spec 16b). */}
                {(proposal.kind === 'decision' || proposal.kind === 'variants') &&
                canDecide &&
                !canConfirmDecisions ? (
                  <p className="m-0 text-meta text-text-3">{t('proposals.waitsForOwner')}</p>
                ) : canDecide && proposal.kind === 'variants' ? (
                  <div className="flex flex-wrap gap-2">
                    {(proposal.operations[0]?.variants ?? []).map((variant, position) => (
                      <Button
                        key={variant.name}
                        size="s"
                        onClick={() => {
                          onDecide(proposal, 'apply', position);
                        }}
                      >
                        {t('variants.adopt', { letter: variantLetter(position) })}
                      </Button>
                    ))}
                    <Button
                      variant="ghost"
                      size="s"
                      onClick={() => {
                        onDecide(proposal, 'reject');
                      }}
                    >
                      {t('proposals.reject')}
                    </Button>
                  </div>
                ) : canDecide ? (
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      size="s"
                      onClick={() => {
                        onDecide(proposal, 'apply');
                      }}
                    >
                      {t(proposal.kind === 'decision' ? 'proposals.confirm' : 'proposals.apply')}
                    </Button>
                    <Button
                      size="s"
                      onClick={() => {
                        onDecide(proposal, 'reject');
                      }}
                    >
                      {t('proposals.reject')}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
          {hands.map((hand) => {
            const agent = agents(hand.agentKey);
            return (
              <li key={hand.id} className={CARD}>
                <div className="flex items-center gap-1.5 text-meta text-text-3">
                  <AgentAvatar agent={agent} size={16} />
                  <span className={cn('font-medium', agentClass(AGENT_DARK_TEXT, agent))}>
                    {agent.name}
                  </span>
                  <span>· {t('overview.hand')}</span>
                  <span className="ml-auto tabular-nums">
                    {formatRelativeTime(hand.createdAt, i18n.language)}
                  </span>
                </div>
                <div className="text-body leading-snug text-text-body">{hand.reason}</div>
                {canDecide && onHand ? (
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      size="s"
                      onClick={() => {
                        onHand(hand, 'listen');
                      }}
                    >
                      {t('hands.listen')}
                    </Button>
                    <Button
                      size="s"
                      onClick={() => {
                        onHand(hand, 'dismiss');
                      }}
                    >
                      {t('hands.dismiss')}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
          {votes.map((vote) => {
            const moderator = agents('moderator');
            return (
              <li key={vote.id} className={CARD}>
                <div className="flex items-center gap-1.5 text-meta text-text-3">
                  <AgentAvatar agent={moderator} size={16} />
                  <span className={cn('font-medium', agentClass(AGENT_DARK_TEXT, moderator))}>
                    {moderator.name}
                  </span>
                  <span>· {t('overview.vote')}</span>
                  <span className="ml-auto tabular-nums">
                    {formatRelativeTime(vote.createdAt, i18n.language)}
                  </span>
                </div>
                <div className="text-body leading-snug font-semibold text-text">{vote.topic}</div>
                {canDecide && onVote ? (
                  <div className="flex flex-wrap gap-2">
                    {vote.options.map((option, position) => (
                      <Button
                        // The options of a vote never change, so their position is a stable key.
                        key={position}
                        size="s"
                        className="max-w-full"
                        aria-label={t('overview.voteFor', { option })}
                        onClick={() => {
                          onVote(vote, position);
                        }}
                      >
                        <span className="truncate">{option}</span>
                      </Button>
                    ))}
                  </div>
                ) : null}
                {voters === undefined ? null : (
                  <div className="text-meta text-text-3">
                    {t('overview.voteProgress', { voted: vote.ballots.length, total: voters })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {decided.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {decided.map((entry) => (
            <li key={entry.id} className="flex items-start gap-1.5 text-body text-text-2b">
              <Check
                size={14}
                strokeWidth={2.4}
                className="mt-[3px] shrink-0 text-success"
                aria-hidden="true"
              />
              {/* Two lines at most, so a long list of agents still says what happened. */}
              <span className="line-clamp-2 min-w-0">
                <Trans
                  i18nKey={
                    entry.decision && entry.status === 'applied'
                      ? 'proposals.confirmed'
                      : `proposals.${entry.status}`
                  }
                  values={{ name: entry.agents ? agentList(entry.agents) : entry.name }}
                  components={BOLD}
                />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Variants A/B (spec 17): the topic, and per variant a preview of its diagram with its name and
 * summary. On another board the topic opens that board, where the variants lie side by side.
 */
function VariantsSummary({
  proposal,
  elsewhere,
  onOpenBoard,
}: {
  proposal: VariantsProposal;
  elsewhere: boolean;
  onOpenBoard: (boardId: string) => void;
}) {
  const { t } = useTranslation();
  const [operation] = proposal.operations;
  if (!operation) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-body leading-snug font-semibold text-text">
        {elsewhere ? (
          <button
            type="button"
            className="cursor-pointer p-0 text-left font-semibold underline decoration-border-strong underline-offset-2 hover:decoration-text"
            onClick={() => {
              onOpenBoard(proposal.boardId);
            }}
          >
            {operation.topic}
          </button>
        ) : (
          operation.topic
        )}
      </div>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {operation.variants.map((variant, position) => {
          const title = t('variants.title', {
            letter: variantLetter(position),
            name: variant.name,
          });
          return (
            <li key={variant.name} className="flex flex-col gap-1">
              <VariantPreview operations={variant.operations} label={title} />
              <span className="text-small leading-snug text-text-3">
                <strong className="font-semibold text-text">{title}</strong>
                {variant.summary ? ` – ${variant.summary}` : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A canvas proposal in one line; on another board the line opens that board. */
function CanvasSummary({
  proposal,
  elsewhere,
  onOpenBoard,
}: {
  proposal: CanvasProposal;
  elsewhere: boolean;
  onOpenBoard: (boardId: string) => void;
}) {
  const { t } = useTranslation();
  const summary = proposalSummary(proposal);
  const text = (
    <Trans
      i18nKey={`proposals.summary.${summary.main.key}`}
      values={summary.main.values}
      components={BOLD}
    />
  );
  return (
    <div className="text-body leading-snug text-text-body">
      {elsewhere ? (
        <button
          type="button"
          className="cursor-pointer p-0 text-left underline decoration-border-strong underline-offset-2 hover:decoration-text"
          onClick={() => {
            onOpenBoard(proposal.boardId);
          }}
        >
          {text}
        </button>
      ) : (
        text
      )}
      {summary.more > 0 ? (
        <div className="mt-0.5 text-meta text-text-3">
          {t('proposals.more', { count: summary.more })}
        </div>
      ) : null}
    </div>
  );
}

/** A team proposal (spec 14): the agents to add, each with the moderator's reason. */
function TeamSummary({ proposal }: { proposal: TeamProposal }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-body leading-snug text-text-body">{t('proposals.summary.team')}</div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {proposal.operations.map((operation, index) => {
          const name = t(`agents.${operation.agentKey}`);
          return (
            // Operations only grow at the end, so their position is a stable key.
            <li key={index} className="flex items-start gap-2">
              <Avatar
                kind="agent"
                agent={operation.agentKey}
                size={16}
                label={name}
                initials={t(`agentInitials.${operation.agentKey}`)}
                className="mt-px"
              />
              <span className="min-w-0 text-small leading-snug text-text-3">
                <strong className={cn('font-semibold', AGENT_DARK_TEXT[operation.agentKey])}>
                  {name}
                </strong>
                {operation.reason ? ` · ${operation.reason}` : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A decision that waits for confirmation (spec 16a): topic, value and the moderator's reasoning. */
function DecisionSummary({ proposal }: { proposal: DecisionProposal }) {
  return (
    <div className="flex flex-col gap-1.5">
      {proposal.operations.map((operation) => (
        <div key={operation.topic} className="text-body leading-snug text-text-body">
          <Trans
            i18nKey="proposals.summary.decision"
            values={{ topic: operation.topic, value: operation.value }}
            components={BOLD}
          />
          {operation.reasoning ? (
            <div className="mt-0.5 text-meta text-text-3">{operation.reasoning}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
