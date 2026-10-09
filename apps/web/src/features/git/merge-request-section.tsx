import type { GitFileState, GitMergeRequestPlan } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, GitPullRequestArrow } from 'lucide-react';
import { useId, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { FieldError } from '@web/components/ui/input';
import {
  gitMergeRequestQuery,
  useApproveGitRequests,
  useRequestMergeRequest,
} from '@web/features/git/request-queries';
import { ApiError } from '@web/lib/api';
import { cn } from '@web/lib/cn';

const SECTION_TITLE = 'm-0 text-small font-medium text-text-2';
const NOTE = 'm-0 text-small leading-snug text-text-3';
const REPOSITORY = (
  <code className="rounded-sm bg-bg-subtle px-1 py-px font-mono text-small text-text-body" />
);

/** The states in the order the counts name them. */
const STATES: readonly GitFileState[] = ['new', 'changed', 'same', 'kept'];

const STATE_TONE: Record<GitFileState, string> = {
  new: 'text-success',
  changed: 'text-text-body',
  same: 'text-text-4',
  kept: 'text-text-4',
};

/** How the last click ended, for the line above the button. */
type Outcome = 'started' | 'proposed' | 'approveFailed' | 'taken' | 'notStored' | 'failed';

/**
 * "Ins Repository" in the dialog of the package (spec 29c; derived look): the package next to
 * the default branch of the project's repository, and the request that brings it there as a
 * merge request. Who may approve and has a GitLab account opens it with one click; everyone else
 * lays the request before the approvers. `beforeRequest` stores what the dialog still holds, so
 * the request carries it; it says whether that worked.
 */
export function MergeRequestSection({
  projectId,
  beforeRequest,
}: {
  projectId: string;
  beforeRequest: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const plan = useQuery(gitMergeRequestQuery(projectId));
  const data = plan.data;

  return (
    <section aria-labelledby={`${ids}-title`} className="flex flex-col gap-2">
      <h3 id={`${ids}-title`} className={SECTION_TITLE}>
        {t('git.mergeRequest.title')}
      </h3>
      {!data ? (
        plan.isError ? (
          <FieldError>{t('git.mergeRequest.loadFailed')}</FieldError>
        ) : (
          <p role="status" className={NOTE}>
            {t('git.mergeRequest.comparing')}
          </p>
        )
      ) : !data.repository ? (
        <p className={NOTE}>{t('git.mergeRequest.noRepository')}</p>
      ) : (
        <Compared
          projectId={projectId}
          plan={data}
          repository={data.repository.path}
          beforeRequest={beforeRequest}
        />
      )}
    </section>
  );
}

function Compared({
  projectId,
  plan,
  repository,
  beforeRequest,
}: {
  projectId: string;
  plan: GitMergeRequestPlan;
  repository: string;
  beforeRequest: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const request = useRequestMergeRequest(projectId);
  const approve = useApproveGitRequests(projectId);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [storing, setStoring] = useState(false);

  const files = plan.files ?? [];
  const counts = STATES.map((state) => ({
    state,
    count: files.filter((file) => file.state === state).length,
  })).filter(({ count }) => count > 0);
  const toWrite = files.filter((file) => file.state === 'new' || file.state === 'changed').length;
  const direct = plan.canApprove && plan.hasAccount;
  const busy = storing || request.isPending || approve.isPending;

  async function submit() {
    setOutcome(null);
    setStoring(true);
    const stored = await beforeRequest().catch(() => false);
    setStoring(false);
    if (!stored) {
      setOutcome('notStored');
      return;
    }
    request.mutate(undefined, {
      onSuccess: ({ requestId }) => {
        if (!direct) {
          setOutcome('proposed');
          return;
        }
        approve.mutate(
          { requestIds: [requestId] },
          {
            onSuccess: () => {
              setOutcome('started');
            },
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

  return (
    <>
      <p className={NOTE}>
        <Trans
          i18nKey="git.mergeRequest.hint"
          values={{ repository }}
          components={{ repo: REPOSITORY }}
        />
      </p>

      {plan.problem ? (
        <p className="m-0 text-small leading-snug text-text-2">
          {t(`git.mergeRequest.problems.${plan.problem}`)}
        </p>
      ) : (
        <>
          <p className="m-0 text-ui leading-snug text-text-body">
            {toWrite === 0
              ? t('git.mergeRequest.upToDate')
              : counts
                  .map(({ state, count }) => t(`git.mergeRequest.count.${state}`, { count }))
                  .join(' · ')}
          </p>
          {files.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-small font-medium text-text-2 select-none hover:text-text">
                {t('git.mergeRequest.files')}
              </summary>
              <ul className="mt-1.5 mb-0 flex max-h-[220px] list-none flex-col gap-0.5 overflow-y-auto rounded-md bg-bg-subtle px-3 py-2 font-mono text-meta text-text-2">
                {files.map((file) => (
                  <li key={file.path} className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{file.path}</span>
                    <span className={cn('shrink-0 font-sans', STATE_TONE[file.state])}>
                      {t(`git.mergeRequest.state.${file.state}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {plan.stale.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              <p className={NOTE}>{t('git.mergeRequest.stale')}</p>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0 font-mono text-meta text-text-3">
                {plan.stale.map((path) => (
                  <li key={path} className="[overflow-wrap:anywhere]">
                    {path}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      {plan.last ? (
        <p className={NOTE}>
          <Trans
            i18nKey="git.mergeRequest.last"
            values={{ number: plan.last.number }}
            components={{
              mr: (
                <a
                  href={plan.last.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-text-2 underline-offset-2 hover:text-text hover:underline"
                />
              ),
              icon: <ExternalLink size={11} strokeWidth={2} aria-hidden="true" />,
            }}
          />
        </p>
      ) : null}

      {!plan.canRequest ? (
        <p className={NOTE}>{t('git.mergeRequest.readOnly')}</p>
      ) : plan.pending && outcome === null ? (
        <p className={NOTE}>{t('git.mergeRequest.pending')}</p>
      ) : plan.canApprove && !plan.hasAccount ? (
        <p className={NOTE}>{t('git.issues.accountHint')}</p>
      ) : null}
      {outcome === 'started' || outcome === 'proposed' ? (
        <p role="status" className="m-0 text-small text-text-2">
          {t(`git.mergeRequest.outcome.${outcome}`)}
        </p>
      ) : outcome ? (
        <FieldError>{t(`git.mergeRequest.outcome.${outcome}`)}</FieldError>
      ) : null}

      {plan.canRequest ? (
        <div>
          <Button
            disabled={busy || plan.pending || plan.problem !== null || toWrite === 0}
            onClick={() => {
              void submit();
            }}
          >
            <GitPullRequestArrow size={14} strokeWidth={2} aria-hidden="true" />
            {t(direct ? 'git.mergeRequest.create' : 'git.mergeRequest.propose')}
          </Button>
        </div>
      ) : null}
    </>
  );
}
