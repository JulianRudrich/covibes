import type { GitMergeRequests, GitOpenMergeRequest } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, GitMerge, ScanSearch } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { DialogClose, DialogContent } from '@web/components/ui/dialog';
import { FieldError } from '@web/components/ui/input';
import {
  gitMergeRequestsQuery,
  useApproveGitRequests,
  useRequestMerge,
  useRequestReview,
} from '@web/features/git/request-queries';
import { ReviewVerdict, ReviewView } from '@web/features/git/review-view';
import { ApiError } from '@web/lib/api';
import { formatRelativeTime } from '@web/lib/format';

const NOTE = 'm-0 text-ui leading-snug text-text-2';

/** How the last click ended, with the merge request it was about. */
type Outcome = {
  number: number;
  kind: 'started' | 'proposed' | 'approveFailed' | 'taken' | 'failed';
};

/** How a click on "Prüfen" ended, with the merge request it was about. */
type ReviewOutcome = { number: number; kind: 'taken' | 'limit' | 'failed' };

/**
 * The dialog "Merge Requests" (spec 29d; derived look): the open merge requests of the project's
 * repository, and the request to merge one. Who may approve and has a GitLab account merges with
 * one click; everyone else lays the request before the approvers. Every merge request shows its
 * review against the architecture (spec 30b), which opens in place of the list; `reviewId` opens
 * the dialog with one. The content of a dialog; the caller opens and closes it.
 */
export function MergeRequestsDialog({
  projectId,
  reviewId: initialReviewId = null,
}: {
  projectId: string;
  reviewId?: string | null;
}) {
  const { t } = useTranslation();
  const [reviewId, setReviewId] = useState(initialReviewId);
  const list = useQuery({ ...gitMergeRequestsQuery(projectId), enabled: reviewId === null });
  const data = list.data;

  if (reviewId !== null) {
    return (
      <DialogContent
        title={t('git.review.title')}
        description={t('git.review.hint')}
        className="w-[min(600px,calc(100vw-32px))]"
      >
        <ReviewView
          projectId={projectId}
          reviewId={reviewId}
          onBack={() => {
            setReviewId(null);
          }}
        />
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">{t('common.close')}</Button>
          </DialogClose>
        </div>
      </DialogContent>
    );
  }

  return (
    <DialogContent
      title={t('git.merge.title')}
      description={t('git.merge.hint')}
      className="w-[min(600px,calc(100vw-32px))]"
    >
      {!data ? (
        list.isError ? (
          <FieldError>{t('git.merge.loadFailed')}</FieldError>
        ) : (
          <p role="status" className="m-0 text-ui text-text-3">
            {t('common.loading')}
          </p>
        )
      ) : !data.repository ? (
        <p className={NOTE}>{t('git.merge.noRepository')}</p>
      ) : data.mergeRequests === null ? (
        <FieldError>{t('git.merge.unreachable')}</FieldError>
      ) : data.mergeRequests.length === 0 ? (
        <p className={NOTE}>{t('git.merge.empty')}</p>
      ) : (
        <Open
          projectId={projectId}
          list={data}
          mergeRequests={data.mergeRequests}
          onOpenReview={setReviewId}
        />
      )}

      <div className="mt-6 flex justify-end gap-2">
        <DialogClose asChild>
          <Button variant="ghost">{t('common.close')}</Button>
        </DialogClose>
      </div>
    </DialogContent>
  );
}

function Open({
  projectId,
  list,
  mergeRequests,
  onOpenReview,
}: {
  projectId: string;
  list: GitMergeRequests;
  mergeRequests: readonly GitOpenMergeRequest[];
  onOpenReview: (reviewId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const request = useRequestMerge(projectId);
  const approve = useApproveGitRequests(projectId);
  const review = useRequestReview(projectId);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [reviewOutcome, setReviewOutcome] = useState<ReviewOutcome | null>(null);
  const direct = list.canApprove && list.hasAccount;
  const busy = request.isPending || approve.isPending;

  function check(number: number) {
    setReviewOutcome(null);
    review.mutate(number, {
      onError: (error) => {
        const code = error instanceof ApiError ? error.code : null;
        setReviewOutcome({
          number,
          kind:
            code === 'already_running' ? 'taken' : code === 'limit_reached' ? 'limit' : 'failed',
        });
      },
    });
  }

  function merge(number: number) {
    setOutcome(null);
    request.mutate(number, {
      onSuccess: ({ requestId }) => {
        if (!direct) {
          setOutcome({ number, kind: 'proposed' });
          return;
        }
        approve.mutate(
          { requestIds: [requestId] },
          {
            onSuccess: () => {
              setOutcome({ number, kind: 'started' });
            },
            onError: () => {
              setOutcome({ number, kind: 'approveFailed' });
            },
          },
        );
      },
      onError: (error) => {
        setOutcome({
          number,
          kind: error instanceof ApiError && error.code === 'already_running' ? 'taken' : 'failed',
        });
      },
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="m-0 flex max-h-[min(420px,56vh)] list-none flex-col overflow-y-auto p-0 pr-1">
        {mergeRequests.map((entry) => {
          const said = outcome?.number === entry.number ? outcome.kind : null;
          const reviewSaid = reviewOutcome?.number === entry.number ? reviewOutcome.kind : null;
          const reviewed = entry.review;
          const reviewing = reviewed?.status === 'queued' || reviewed?.status === 'running';
          // A review of the commits as they are now needs no second one, unless it failed.
          const canCheck =
            list.canReview &&
            !reviewing &&
            (!reviewed || !entry.reviewCurrent || reviewed.status === 'failed');
          return (
            <li
              key={entry.number}
              className="flex items-start gap-3 border-b border-border-subtle py-2.5 first:pt-0 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-baseline gap-1.5 text-ui leading-snug font-medium text-text underline-offset-2 hover:underline"
                >
                  {/* The space is for who hears the link: "!7 Login", not "!7Login". */}
                  <span className="shrink-0 text-text-3 tabular-nums">!{entry.number}</span>{' '}
                  <span className="min-w-0 [overflow-wrap:anywhere]">{entry.title}</span>
                  <ExternalLink
                    size={11}
                    strokeWidth={2}
                    aria-hidden="true"
                    className="shrink-0 self-center text-text-3"
                  />
                </a>
                <span className="text-meta leading-snug text-text-3 [overflow-wrap:anywhere]">
                  <code className="font-mono">{entry.sourceBranch}</code> →{' '}
                  <code className="font-mono">{entry.targetBranch}</code>
                  {entry.author ? ` · ${entry.author}` : null}
                  {entry.updatedAt
                    ? ` · ${formatRelativeTime(entry.updatedAt, i18n.language)}`
                    : null}
                </span>
                {entry.draft || entry.conflicts ? (
                  <span className="text-meta leading-snug text-text-2">
                    {[
                      entry.draft ? t('git.merge.draft') : null,
                      entry.conflicts ? t('git.merge.conflicts') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                ) : null}
                {reviewed || canCheck ? (
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta leading-snug">
                    {reviewed && reviewed.status === 'done' ? (
                      <button
                        type="button"
                        aria-label={t('git.review.open', { number: entry.number })}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-xs underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                        onClick={() => {
                          onOpenReview(reviewed.id);
                        }}
                      >
                        {entry.reviewCurrent ? null : (
                          <span className="text-text-3">{t('git.review.older')}</span>
                        )}
                        <ReviewVerdict review={reviewed} />
                      </button>
                    ) : reviewed ? (
                      <span role="status">
                        <ReviewVerdict review={reviewed} />
                      </span>
                    ) : null}
                    {canCheck ? (
                      <button
                        type="button"
                        disabled={review.isPending}
                        aria-label={t('git.review.checkOne', { number: entry.number })}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-xs text-text-2 underline-offset-2 hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:pointer-events-none disabled:opacity-50"
                        onClick={() => {
                          check(entry.number);
                        }}
                      >
                        <ScanSearch size={12} strokeWidth={2} aria-hidden="true" />
                        {t(reviewed ? 'git.review.again' : 'git.review.check')}
                      </button>
                    ) : null}
                  </span>
                ) : null}
                {reviewSaid ? (
                  <FieldError>{t(`git.review.outcome.${reviewSaid}`)}</FieldError>
                ) : null}
                {said === 'started' || said === 'proposed' ? (
                  <span role="status" className="text-meta leading-snug text-text-2">
                    {t(`git.merge.outcome.${said}`)}
                  </span>
                ) : said ? (
                  <FieldError>{t(`git.merge.outcome.${said}`)}</FieldError>
                ) : null}
              </div>
              {entry.requested ? (
                <span className="shrink-0 pt-1 text-small text-text-3">
                  {t('git.merge.requested')}
                </span>
              ) : list.canRequest && !entry.draft ? (
                <Button
                  size="s"
                  disabled={busy}
                  aria-label={t(direct ? 'git.merge.mergeOne' : 'git.merge.proposeOne', {
                    number: entry.number,
                  })}
                  onClick={() => {
                    merge(entry.number);
                  }}
                >
                  <GitMerge size={13} strokeWidth={2} aria-hidden="true" />
                  {t(direct ? 'git.merge.merge' : 'git.merge.propose')}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!list.canRequest ? (
        <p className="m-0 text-small text-text-3">{t('git.merge.readOnly')}</p>
      ) : list.canApprove && !list.hasAccount ? (
        <p className="m-0 text-small text-text-3">{t('git.issues.accountHint')}</p>
      ) : null}
    </div>
  );
}
