import type { GitReview, GitReviewSummary } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CircleCheck, ExternalLink, MessageSquare, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { FieldError } from '@web/components/ui/input';
import { AgentAvatar } from '@web/features/agents/agent-avatar';
import { agentClass, useAgents } from '@web/features/agents/agents';
import { AGENT_DARK_TEXT } from '@web/features/canvas/agent-look';
import {
  gitRequestsQuery,
  gitReviewsQuery,
  useApproveGitRequests,
  useRequestReviewComment,
} from '@web/features/git/request-queries';
import { ApiError } from '@web/lib/api';
import { cn } from '@web/lib/cn';
import { formatRelativeTime } from '@web/lib/format';

const NOTE = 'm-0 text-small leading-snug text-text-3';
const BOLD = { b: <strong className="font-semibold text-text" /> };

/**
 * The state of a review in a few words, as the list of merge requests and the review itself show
 * it (spec 30b; derived look): running, fits (green check), deviates (a warning sign and how
 * many findings), or failed.
 */
export function ReviewVerdict({
  review,
  className,
}: {
  review: Pick<GitReviewSummary, 'status' | 'verdict'> & { findings: number };
  className?: string;
}) {
  const { t } = useTranslation();
  if (review.status === 'queued' || review.status === 'running') {
    return (
      <span className={cn('animate-pulse text-text-2', className)}>{t('git.review.running')}</span>
    );
  }
  if (review.status === 'failed' || review.verdict === null) {
    return <span className={cn('text-danger', className)}>{t('git.review.failed')}</span>;
  }
  return review.verdict === 'fits' ? (
    <span className={cn('inline-flex items-center gap-1 text-success', className)}>
      <CircleCheck size={13} strokeWidth={2} aria-hidden="true" className="shrink-0" />
      {t('git.review.fits')}
    </span>
  ) : (
    <span className={cn('inline-flex items-center gap-1 text-danger', className)}>
      <TriangleAlert size={13} strokeWidth={2} aria-hidden="true" className="shrink-0" />
      {t('git.review.deviates', { count: review.findings })}
    </span>
  );
}

type ReviewViewProps = {
  projectId: string;
  reviewId: string;
  onBack: () => void;
};

/**
 * One review of a merge request against the architecture (spec 30b; derived look): the merge
 * request and the state of its commits that was read, the verdict, the summary, and the findings
 * with what of the architecture each goes against. Everything the model wrote shows as plain
 * text. It takes the place of the list in the dialog "Merge Requests".
 */
export function ReviewView({ projectId, reviewId, onBack }: ReviewViewProps) {
  const { t, i18n } = useTranslation();
  const reviews = useQuery(gitReviewsQuery(projectId));
  const review = reviews.data?.reviews.find((entry) => entry.id === reviewId);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button size="s" variant="ghost" className="-ml-2.5" onClick={onBack}>
          <ArrowLeft size={13} strokeWidth={2} aria-hidden="true" />
          {t('git.review.back')}
        </Button>
      </div>
      {!reviews.data ? (
        reviews.isError ? (
          <FieldError>{t('git.review.loadFailed')}</FieldError>
        ) : (
          <p role="status" className="m-0 text-ui text-text-3">
            {t('common.loading')}
          </p>
        )
      ) : !review ? (
        <p className="m-0 text-ui leading-snug text-text-2">{t('git.review.gone')}</p>
      ) : (
        <article
          aria-label={t('git.review.label', { number: review.number })}
          className="flex max-h-[min(460px,60vh)] flex-col gap-3 overflow-y-auto pr-1"
        >
          <header className="flex flex-col gap-0.5">
            <a
              href={review.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 items-baseline gap-1.5 text-ui leading-snug font-medium text-text underline-offset-2 hover:underline"
            >
              <span className="shrink-0 text-text-3 tabular-nums">!{review.number}</span>{' '}
              <span className="min-w-0 [overflow-wrap:anywhere]">{review.title}</span>
              <ExternalLink
                size={11}
                strokeWidth={2}
                aria-hidden="true"
                className="shrink-0 self-center text-text-3"
              />
            </a>
            <span className="text-meta leading-snug text-text-3 [overflow-wrap:anywhere]">
              {[
                t('git.review.state', { sha: review.sha.slice(0, 8) }),
                review.requestedBy
                  ? t('git.review.by', {
                      name: review.requestedBy.name || t('git.requests.someone'),
                    })
                  : t('git.review.auto'),
                formatRelativeTime(review.finishedAt ?? review.createdAt, i18n.language),
                review.issueNumber === null
                  ? null
                  : t('git.review.issue', { number: review.issueNumber }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </header>

          <p
            role="status"
            className={cn(
              'm-0 flex items-center rounded-md border px-3 py-2 text-ui font-medium',
              review.status !== 'done'
                ? 'border-border-soft bg-bg-muted'
                : review.verdict === 'fits'
                  ? 'border-transparent bg-success-bg'
                  : 'border-danger-border bg-danger-bg',
            )}
          >
            <ReviewVerdict review={{ ...review, findings: review.findings.length }} />
          </p>

          {review.summary ? (
            <p className="m-0 text-ui leading-snug whitespace-pre-line text-text-body">
              {review.summary}
            </p>
          ) : null}

          {review.findings.length > 0 ? (
            <ol
              aria-label={t('git.review.findings')}
              className="m-0 flex list-none flex-col gap-2 p-0"
            >
              {review.findings.map((finding, index) => (
                <li
                  key={index}
                  className="flex flex-col gap-1.5 rounded-card border border-border bg-bg-panel p-3"
                >
                  <h4 className="m-0 text-ui leading-snug font-semibold text-text [overflow-wrap:anywhere]">
                    {finding.title}
                  </h4>
                  <p className="m-0 text-ui leading-snug whitespace-pre-line text-text-body [overflow-wrap:anywhere]">
                    {finding.detail}
                  </p>
                  {finding.basis || finding.file ? (
                    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-meta leading-snug">
                      {finding.basis ? (
                        <>
                          <dt className="text-text-3">{t('git.review.basis')}</dt>
                          <dd className="m-0 text-text-2 [overflow-wrap:anywhere]">
                            {finding.basis}
                          </dd>
                        </>
                      ) : null}
                      {finding.file ? (
                        <>
                          <dt className="text-text-3">{t('git.review.file')}</dt>
                          <dd className="m-0 font-mono text-text-2 [overflow-wrap:anywhere]">
                            {finding.file}
                          </dd>
                        </>
                      ) : null}
                    </dl>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}

          <ReviewComment
            projectId={projectId}
            review={review}
            canRequest={reviews.data.canRequest}
          />
          <p className={NOTE}>{t('git.review.note')}</p>
        </article>
      )}
    </div>
  );
}

/** How a click on "In GitLab kommentieren" ended, if not as it should. */
type CommentOutcome = 'taken' | 'approveFailed' | 'failed';

/**
 * The review as a comment in the repository (spec 30c; derived look): what became of it, and for
 * owners and editors the way to lay it before the approvers. Who may approve and has a GitLab
 * account posts it with one click; nothing reaches the repository without an approval.
 */
function ReviewComment({
  projectId,
  review,
  canRequest,
}: {
  projectId: string;
  review: GitReview;
  canRequest: boolean;
}) {
  const { t } = useTranslation();
  const access = useQuery(gitRequestsQuery(projectId)).data;
  const request = useRequestReviewComment(projectId);
  const approve = useApproveGitRequests(projectId);
  const [outcome, setOutcome] = useState<CommentOutcome | null>(null);
  const direct = access?.canApprove === true && access.hasAccount;
  const busy = request.isPending || approve.isPending;
  const { comment } = review;

  function post() {
    setOutcome(null);
    request.mutate(review.id, {
      onSuccess: ({ requestId }) => {
        if (!direct) return;
        approve.mutate(
          { requestIds: [requestId] },
          {
            onError: () => {
              setOutcome('approveFailed');
            },
          },
        );
      },
      onError: (error) => {
        setOutcome(
          error instanceof ApiError && error.code === 'already_running' ? 'taken' : 'failed',
        );
      },
    });
  }

  if (review.status !== 'done') return null;
  if (comment?.state === 'done') {
    return (
      <p className="m-0 flex items-center gap-1.5 text-small text-text-2">
        <MessageSquare size={13} strokeWidth={2} aria-hidden="true" className="shrink-0" />
        {comment.url ? (
          <a
            href={comment.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline-offset-2 hover:text-text hover:underline"
          >
            {t('git.review.comment.done')}
            <ExternalLink size={11} strokeWidth={2} aria-hidden="true" />
          </a>
        ) : (
          t('git.review.comment.done')
        )}
      </p>
    );
  }
  if (comment) {
    return comment.state === 'failed' ? (
      <FieldError>{t('git.review.comment.failed')}</FieldError>
    ) : (
      <p
        role="status"
        className={cn('m-0 text-small text-text-2', comment.state === 'running' && 'animate-pulse')}
      >
        {t(`git.review.comment.${comment.state}`)}
      </p>
    );
  }
  if (!canRequest) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="s" disabled={busy} onClick={post}>
          <MessageSquare size={13} strokeWidth={2} aria-hidden="true" />
          {t(direct ? 'git.review.comment.post' : 'git.review.comment.propose')}
        </Button>
        <span className="min-w-0 flex-1 text-small leading-snug text-text-3">
          {t('git.review.comment.hint')}
        </span>
      </div>
      {outcome ? <FieldError>{t(`git.review.comment.outcome.${outcome}`)}</FieldError> : null}
    </div>
  );
}

/**
 * A merge request that goes against the architecture, as a card under "Wartet auf dich" (spec
 * 30b; derived look): the moderator's review in one sentence, the first findings by their name,
 * and the way to the whole review.
 */
export function ReviewCard({ review, onOpen }: { review: GitReview; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const moderator = useAgents()('moderator');
  const shown = review.findings.slice(0, 2);
  return (
    <>
      <div className="flex items-center gap-1.5 text-meta text-text-3">
        <AgentAvatar agent={moderator} size={16} />
        <span
          className={cn('min-w-0 truncate font-medium', agentClass(AGENT_DARK_TEXT, moderator))}
        >
          {moderator.name}
        </span>
        <span className="shrink-0">· {t('git.review.kind')}</span>
        <span className="ml-auto shrink-0 tabular-nums">
          {formatRelativeTime(review.finishedAt ?? review.createdAt, i18n.language)}
        </span>
      </div>
      <div className="text-body leading-snug text-text-body [overflow-wrap:anywhere]">
        <Trans
          i18nKey="git.review.card"
          count={review.findings.length}
          values={{ number: review.number, title: review.title }}
          components={BOLD}
        />
      </div>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-meta leading-snug text-text-2">
        {shown.map((finding, index) => (
          <li key={index} className="flex items-start gap-1.5">
            <TriangleAlert
              size={12}
              strokeWidth={2}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-danger"
            />
            <span className="min-w-0 [overflow-wrap:anywhere]">{finding.title}</span>
          </li>
        ))}
        {review.findings.length > shown.length ? (
          <li className="pl-[18px] text-text-3">
            {t('git.review.more', { count: review.findings.length - shown.length })}
          </li>
        ) : null}
      </ul>
      <div className="flex items-center gap-2">
        <Button
          size="s"
          aria-label={t('git.review.open', { number: review.number })}
          onClick={onOpen}
        >
          {t('git.review.view')}
        </Button>
        {review.comment?.state === 'done' ? (
          <span className="inline-flex min-w-0 items-center gap-1 text-meta text-text-3">
            <MessageSquare size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
            {t('git.review.comment.done')}
          </span>
        ) : null}
      </div>
    </>
  );
}
