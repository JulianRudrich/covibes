import type { AgentKey, CanvasProposal, Proposal, TeamProposal } from '@covibes/shared';
import { Check } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import { Avatar } from '@web/components/ui/avatar';
import { Button } from '@web/components/ui/button';
import { AGENT_DARK_TEXT } from '@web/features/canvas/agent-look';
import type { Decision, DecidedProposal } from '@web/features/proposals/queries';
import { proposalSummary } from '@web/features/proposals/summary';
import { formatRelativeTime } from '@web/lib/format';
import { cn } from '@web/lib/cn';

type WaitingForYouProps = {
  proposals: readonly Proposal[];
  /** Proposals decided in this session, shown as lines with a check. */
  decided: readonly DecidedProposal[];
  canDecide: boolean;
  onDecide: (proposal: Proposal, decision: Decision) => void;
  activeBoardId: string | null;
  /** Opens the board of a proposal that lies on another one. */
  onOpenBoard: (boardId: string) => void;
};

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
 * line with a check for every proposal decided in this session.
 */
export function WaitingForYou({
  proposals,
  decided,
  canDecide,
  onDecide,
  activeBoardId,
  onOpenBoard,
}: WaitingForYouProps) {
  const { t, i18n } = useTranslation();
  const agentList = useAgentList();

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
          aria-label={t('overview.waitingCount', { count: proposals.length })}
        >
          {proposals.length}
        </span>
      </div>

      {proposals.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {proposals.map((proposal) => {
            const agent = t(`agents.${proposal.agentKey}`);
            return (
              <li
                key={proposal.id}
                className="flex flex-col gap-2.5 rounded-card border border-border bg-bg-panel p-3 shadow-panel"
              >
                <div className="flex items-center gap-1.5 text-meta text-text-3">
                  <Avatar
                    kind="agent"
                    agent={proposal.agentKey}
                    size={16}
                    label={agent}
                    initials={t(`agentInitials.${proposal.agentKey}`)}
                  />
                  <span className={cn('font-medium', AGENT_DARK_TEXT[proposal.agentKey])}>
                    {agent}
                  </span>
                  <span>· {t('proposals.kind')}</span>
                  <span className="ml-auto tabular-nums">
                    {formatRelativeTime(proposal.createdAt, i18n.language)}
                  </span>
                </div>
                {proposal.kind === 'team' ? (
                  <TeamSummary proposal={proposal} />
                ) : (
                  <CanvasSummary
                    proposal={proposal}
                    elsewhere={proposal.boardId !== activeBoardId}
                    onOpenBoard={onOpenBoard}
                  />
                )}
                {canDecide ? (
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      size="s"
                      onClick={() => {
                        onDecide(proposal, 'apply');
                      }}
                    >
                      {t('proposals.apply')}
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
                  i18nKey={`proposals.${entry.status}`}
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
