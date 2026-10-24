import type { AwayAuthor, AwayBoard, AwayDecision, AwaySummary } from '@covibes/shared';
import {
  AtSign,
  Check,
  FileText,
  Hourglass,
  ListChecks,
  MessageSquare,
  PenLine,
  RotateCcw,
  SquarePlus,
  type LucideIcon,
} from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { AgentAvatar } from '@web/features/agents/agent-avatar';
import { agentClass, useAgents } from '@web/features/agents/agents';
import { AGENT_DARK_TEXT } from '@web/features/canvas/agent-look';
import { cn } from '@web/lib/cn';
import { formatRelativeTime } from '@web/lib/format';

type SinceYouWereAwayProps = {
  summary: AwaySummary;
  /** How much waits for the user now; the cards are right below under "Wartet auf dich". */
  waiting: number;
  /** Opens a decision with its reasoning, where owners and editors reopen it. */
  onOpenDecision: (decisionId: string) => void;
  onOpenBoard: (boardId: string) => void;
  /** Opens the project plan, whose new versions the summary counts (spec 25c). */
  onOpenPlan?: () => void;
  onDismiss: () => void;
};

const BOLD = { b: <strong className="font-semibold text-text" /> };

const LINK =
  'cursor-pointer rounded-xs p-0 text-left underline decoration-border-strong underline-offset-2 hover:decoration-text focus-visible:outline-2 focus-visible:outline-ink';

/** Names as a list in the UI language: "Olga, Moderator und 2 weitere". */
function useAuthorList() {
  const { t, i18n } = useTranslation();
  const agents = useAgents();
  return (by: readonly AwayAuthor[], authors: number): string => {
    const names = by.map((author) =>
      author.kind === 'human' ? author.name : agents(author.agentKey).name,
    );
    const more = authors - names.length;
    return new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(
      more > 0 && names.length > 0 ? [...names, t('away.others', { count: more })] : names,
    );
  };
}

/** One line of the summary: an icon and what happened. */
function Row({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-body leading-snug text-text-body">
      <Icon size={14} aria-hidden="true" className="mt-[3px] shrink-0 text-text-3" />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function DecisionRow({
  decision,
  onOpen,
}: {
  decision: AwayDecision;
  onOpen: (decisionId: string) => void;
}) {
  const { decisionId } = decision;
  const text = (
    <Trans
      i18nKey={decision.kind === 'decided' ? 'away.decided' : 'away.reopened'}
      values={{ topic: decision.topic, value: decision.value ?? '' }}
      components={BOLD}
    />
  );
  return (
    <Row icon={decision.kind === 'decided' ? Check : RotateCcw}>
      {decisionId ? (
        <button
          type="button"
          className={LINK}
          onClick={() => {
            onOpen(decisionId);
          }}
        >
          {text}
        </button>
      ) : (
        text
      )}
    </Row>
  );
}

function BoardRow({
  board,
  names,
  onOpen,
}: {
  board: AwayBoard;
  names: string;
  onOpen: (boardId: string) => void;
}) {
  return (
    <Row icon={board.isNew ? SquarePlus : PenLine}>
      <button
        type="button"
        className={LINK}
        onClick={() => {
          onOpen(board.boardId);
        }}
      >
        <Trans
          i18nKey={board.isNew ? 'away.boardNew' : names ? 'away.board' : 'away.boardPlain'}
          values={{ title: board.title, count: board.changed, names }}
          components={BOLD}
        />
      </button>
    </Row>
  );
}

/**
 * "Seit du weg warst" at the top of the overview (spec 23; derived looks): what happened in the
 * project while the user did not have it open. The moderator sums up the conversation; below are
 * the decisions, the changes per board, the new messages and what waits now. "Verstanden" closes
 * it until the user comes back from the next absence.
 */
export function SinceYouWereAway({
  summary,
  waiting,
  onOpenDecision,
  onOpenBoard,
  onOpenPlan,
  onDismiss,
}: SinceYouWereAwayProps) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const moderator = useAgents()('moderator');
  const authorList = useAuthorList();
  const { messages } = summary;
  const writers = authorList(messages.by, messages.authors);

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2
          id={titleId}
          className="m-0 font-display text-heading font-semibold tracking-[-0.01em] text-text"
        >
          {t('away.title')}
        </h2>
        <span className="shrink-0 text-meta text-text-3">
          {t('away.lastHere', { time: formatRelativeTime(summary.since, i18n.language) })}
        </span>
      </div>

      {summary.textStatus === 'pending' || (summary.textStatus === 'done' && summary.text) ? (
        <div className="flex animate-rise flex-col gap-2 rounded-panel bg-bg-subtle p-3.5">
          <div className="flex items-center gap-1.5 text-status text-text-3">
            <AgentAvatar agent={moderator} size={20} />
            <span className={cn('font-semibold', agentClass(AGENT_DARK_TEXT, moderator))}>
              {moderator.name}
            </span>
            <span>· {t('away.summary')}</span>
          </div>
          {summary.textStatus === 'pending' ? (
            <p className="m-0 animate-pulse text-body leading-normal text-text-3" role="status">
              {t('away.writing')}
            </p>
          ) : (
            <p className="m-0 text-body leading-normal text-text-body">{summary.text}</p>
          )}
        </div>
      ) : null}

      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {summary.decisions.map((decision) => (
          <DecisionRow key={decision.id} decision={decision} onOpen={onOpenDecision} />
        ))}
        {summary.criteriaChanges > 0 ? (
          <Row icon={ListChecks}>{t('away.criteria', { count: summary.criteriaChanges })}</Row>
        ) : null}
        {summary.boards.map((board) => (
          <BoardRow
            key={board.boardId}
            board={board}
            names={authorList(board.by, board.authors)}
            onOpen={onOpenBoard}
          />
        ))}
        {summary.planVersions > 0 ? (
          <Row icon={FileText}>
            {onOpenPlan ? (
              <button type="button" className={LINK} onClick={onOpenPlan}>
                {t('away.planVersions', { count: summary.planVersions })}
              </button>
            ) : (
              t('away.planVersions', { count: summary.planVersions })
            )}
          </Row>
        ) : null}
        {messages.count > 0 ? (
          <Row icon={MessageSquare}>
            {t(writers ? 'away.messages' : 'away.messagesPlain', {
              count: messages.count,
              names: writers,
            })}
          </Row>
        ) : null}
        {messages.mentions > 0 ? (
          <Row icon={AtSign}>{t('away.mentions', { count: messages.mentions })}</Row>
        ) : null}
        {waiting > 0 ? <Row icon={Hourglass}>{t('away.waiting', { count: waiting })}</Row> : null}
      </ul>

      <div>
        <Button size="s" onClick={onDismiss}>
          {t('away.dismiss')}
        </Button>
      </div>
    </section>
  );
}
