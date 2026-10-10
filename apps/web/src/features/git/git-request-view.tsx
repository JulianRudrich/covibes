import type { GitAction, GitRequest } from '@covibes/shared';
import { Check, CircleDashed, ExternalLink, LoaderCircle, Minus, X } from 'lucide-react';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Avatar } from '@web/components/ui/avatar';
import { Button } from '@web/components/ui/button';
import { IconButton } from '@web/components/ui/icon-button';
import { Tooltip } from '@web/components/ui/tooltip';
import { AgentAvatar } from '@web/features/agents/agent-avatar';
import { agentClass, useAgents } from '@web/features/agents/agents';
import { AGENT_DARK_TEXT } from '@web/features/canvas/agent-look';
import { requestProgress } from '@web/features/git/request-progress';
import { cn } from '@web/lib/cn';
import { formatRelativeTime, initialsOf } from '@web/lib/format';

// A Git request as people see it (spec 29b; derived look): the card under "Wartet auf dich", the
// list of its actions, and the texts both share with the log.

const BOLD = <strong className="font-semibold text-text" />;
const REPOSITORY = (
  <code className="rounded-sm bg-bg-subtle px-1 py-px font-mono text-small text-text-body" />
);

/** The repository's name as people say it: the last part of its path. */
const repositoryName = (path: string) => path.split('/').at(-1) ?? path;

/** "12 Issues in `vereins-app` anlegen", or "… angelegt" for a request that is done. */
export function GitRequestSummary({
  request,
  done = false,
}: {
  request: Pick<GitRequest, 'actions' | 'repository' | 'kind'>;
  done?: boolean;
}) {
  // Merging (spec 29d) names the merge request by its number and title.
  if (request.kind === 'merge') {
    return (
      <Trans
        i18nKey={done ? 'git.requests.doneMerge' : 'git.requests.summaryMerge'}
        values={{
          title: request.actions[0]?.title ?? '',
          repository: repositoryName(request.repository.path),
        }}
        components={{ b: BOLD, repo: REPOSITORY }}
      />
    );
  }
  // A review as a comment (spec 30c) is named by its action: the merge request and what it found.
  if (request.kind === 'comment') {
    return (
      <Trans
        i18nKey={done ? 'git.requests.doneComment' : 'git.requests.summaryComment'}
        values={{
          title: request.actions[0]?.title ?? '',
          repository: repositoryName(request.repository.path),
        }}
        components={{ b: BOLD, repo: REPOSITORY }}
      />
    );
  }
  // The plan package as a merge request (spec 29c) is one thing, whatever it holds.
  if (request.kind === 'merge_request') {
    return (
      <Trans
        i18nKey={done ? 'git.requests.doneMergeRequest' : 'git.requests.summaryMergeRequest'}
        values={{ repository: repositoryName(request.repository.path) }}
        components={{ b: BOLD, repo: REPOSITORY }}
      />
    );
  }
  return (
    <Trans
      i18nKey={done ? 'git.requests.done' : 'git.requests.summary'}
      count={requestProgress(request).issues}
      values={{ repository: repositoryName(request.repository.path) }}
      components={{ b: BOLD, repo: REPOSITORY }}
    />
  );
}

/** The actions of a request with what became of each. */
export function GitActionList({ actions }: { actions: readonly GitAction[] }) {
  const { t } = useTranslation();
  return (
    <ul className="m-0 flex max-h-[220px] list-none flex-col gap-1 overflow-y-auto p-0">
      {actions.map((action) => (
        <li key={action.id} className="flex items-start gap-1.5 text-small leading-snug">
          <ActionIcon status={action.status} />
          <span className="min-w-0 flex-1 text-text-body [overflow-wrap:anywhere]">
            {action.title}
            {action.error ? (
              <span className="block text-meta text-danger">
                {t(`git.requests.errors.${action.error.code}`)}
                {action.error.detail ? (
                  <span className="text-text-3"> ({action.error.detail})</span>
                ) : null}
              </span>
            ) : null}
          </span>
          {action.status === 'done' && action.result ? (
            action.result.url ? (
              <a
                href={action.result.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-text-2 underline-offset-2 hover:text-text hover:underline"
              >
                {action.kind === 'comment'
                  ? t('git.actions.comment')
                  : action.result.number === null
                    ? t(action.result.existed ? 'git.actions.existed' : 'git.actions.created')
                    : `${action.kind === 'merge_request' || action.kind === 'merge' ? '!' : '#'}${String(action.result.number)}`}
                <ExternalLink size={11} strokeWidth={2} aria-hidden="true" />
              </a>
            ) : (
              <span className="shrink-0 text-text-3">
                {t(action.result.existed ? 'git.actions.existed' : 'git.actions.created')}
              </span>
            )
          ) : action.status === 'dropped' ? (
            <span className="shrink-0 text-text-3">{t('git.actions.dropped')}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ActionIcon({ status }: { status: GitAction['status'] }) {
  const { t } = useTranslation();
  const common = { size: 13, strokeWidth: 2.2, 'aria-label': t(`git.actions.status.${status}`) };
  const place = 'mt-[2px] shrink-0';
  if (status === 'done') return <Check {...common} className={cn(place, 'text-success')} />;
  if (status === 'failed') return <X {...common} className={cn(place, 'text-danger')} />;
  if (status === 'started') {
    return <LoaderCircle {...common} className={cn(place, 'animate-spin text-text-3')} />;
  }
  if (status === 'dropped') return <Minus {...common} className={cn(place, 'text-text-4')} />;
  return <CircleDashed {...common} className={cn(place, 'text-text-4')} />;
}

/** What the person may do with the requests of a project, and how. */
export type GitRequestActions = {
  /** The person approves and rejects: owners, and editors with the right. */
  canApprove: boolean;
  /** The person has a GitLab account of their own, which approving needs. */
  hasAccount: boolean;
  /** The person, to know their own requests. */
  userId: string;
  /** A decision is on its way. */
  busy: boolean;
  onApprove: (requestIds: string[]) => void;
  onEnd: (requestId: string, how: 'reject' | 'withdraw') => void;
  /** Leads to connecting the own GitLab account. */
  onConnect: () => void;
  /** Opens the review a comment posts (spec 30c): what will stand in the repository. */
  onOpenReview?: (reviewId: string) => void;
};

/**
 * The card of a request under "Wartet auf dich" (handoff, section 4: "· Freigabe" with
 * "Freigeben" and "Ansehen"). It waits, runs or failed; what the person can do depends on their
 * right and their GitLab account. The content of a card; the caller gives it its frame.
 */
export function GitRequestCard({
  request,
  actions,
}: {
  request: GitRequest;
  actions: GitRequestActions;
}) {
  const { t, i18n } = useTranslation();
  const [viewing, setViewing] = useState(false);
  const { total, done, error } = requestProgress(request);
  const { canApprove, hasAccount, busy } = actions;
  const own = request.requestedBy.userId !== null && request.requestedBy.userId === actions.userId;
  const name = request.requestedBy.name || t('git.requests.someone');
  // A request an agent made (spec 29e) shows the agent, like a proposal does.
  const agents = useAgents();
  const agent = request.agentKey === null ? null : agents(request.agentKey);

  // A comment is looked at as its review: that is the text that will stand in the repository.
  const reviewId = request.kind === 'comment' ? (request.actions[0]?.reviewId ?? null) : null;
  const { onOpenReview } = actions;
  const view =
    reviewId !== null && onOpenReview ? (
      <Button
        size="s"
        // The short word fits the narrow card next to "Freigeben"; the name says what opens.
        aria-label={t('git.requests.viewReview')}
        onClick={() => {
          onOpenReview(reviewId);
        }}
      >
        {t('git.requests.view')}
      </Button>
    ) : (
      <Button
        size="s"
        aria-expanded={viewing}
        onClick={() => {
          setViewing((open) => !open);
        }}
      >
        {t(viewing ? 'git.requests.hide' : 'git.requests.view')}
      </Button>
    );
  // Rejecting is an icon at the end of the row, so three actions fit the narrow card.
  const reject = (label: string) => (
    <Tooltip content={label}>
      <IconButton
        aria-label={label}
        className="ml-auto"
        disabled={busy}
        onClick={() => {
          actions.onEnd(request.id, 'reject');
        }}
      >
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    </Tooltip>
  );

  return (
    <>
      <div className="flex items-center gap-1.5 text-meta text-text-3">
        {agent ? (
          <>
            <AgentAvatar agent={agent} size={16} />
            <span
              className={cn('min-w-0 truncate font-medium', agentClass(AGENT_DARK_TEXT, agent))}
            >
              {agent.name}
            </span>
          </>
        ) : (
          <>
            <Avatar kind="human" size={16} label={name} initials={initialsOf(name)} />
            <span className="min-w-0 truncate font-medium text-text-body">{name}</span>
          </>
        )}
        <span className="shrink-0">· {t('git.requests.kind')}</span>
        <span className="ml-auto shrink-0 tabular-nums">
          {formatRelativeTime(request.createdAt, i18n.language)}
        </span>
      </div>
      <div className="text-body leading-snug text-text-body">
        <GitRequestSummary request={request} />
      </div>

      {request.status === 'approved' ? (
        <p role="status" className="m-0 animate-pulse text-meta text-text-3">
          {t('git.requests.running', { done, total })}
        </p>
      ) : request.status === 'failed' ? (
        <p role="alert" className="m-0 text-meta leading-snug text-danger">
          {t('git.requests.failed', { open: total - done, total })}{' '}
          {t(`git.requests.errors.${error?.code ?? 'failed'}`)}
        </p>
      ) : !canApprove ? (
        <p className="m-0 text-meta text-text-3">{t('git.requests.waitsForApprover')}</p>
      ) : !hasAccount ? (
        <p className="m-0 text-meta text-text-3">{t('git.requests.needsAccount')}</p>
      ) : null}

      {viewing ? <GitActionList actions={request.actions} /> : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {request.status === 'approved' ? (
          view
        ) : canApprove ? (
          <>
            {hasAccount ? (
              <Button
                variant="primary"
                size="s"
                disabled={busy}
                onClick={() => {
                  actions.onApprove([request.id]);
                }}
              >
                {t(request.status === 'failed' ? 'git.requests.retry' : 'git.requests.approve')}
              </Button>
            ) : (
              <Button variant="primary" size="s" disabled={busy} onClick={actions.onConnect}>
                {t('git.requests.connectAccount')}
              </Button>
            )}
            {view}
            {reject(
              t(request.status === 'failed' ? 'git.requests.discard' : 'git.requests.reject'),
            )}
          </>
        ) : (
          <>
            {view}
            {own && request.status === 'waiting' ? (
              <Button
                size="s"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  actions.onEnd(request.id, 'withdraw');
                }}
              >
                {t('git.requests.withdraw')}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
