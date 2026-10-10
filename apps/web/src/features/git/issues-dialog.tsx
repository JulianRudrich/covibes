import { MAX_GIT_ISSUES, type GitIssuePlan, type GitIssueTask } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, ExternalLink } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { DialogClose, DialogContent } from '@web/components/ui/dialog';
import { FieldError } from '@web/components/ui/input';
import {
  gitIssuesQuery,
  useApproveGitRequests,
  useRequestGitIssues,
} from '@web/features/git/request-queries';
import { ApiError } from '@web/lib/api';
import { cn } from '@web/lib/cn';

const NOTE = 'm-0 text-ui leading-snug text-text-2';

/** How the last click ended, for the line above the buttons. */
type Outcome = 'started' | 'proposed' | 'approveFailed' | 'taken' | 'failed';

/**
 * The dialog "Issues aus dem Plan" (spec 29b; derived look): the plan's tasks by milestone, to
 * tick, and the request for an issue per chosen task. Who may approve and has a GitLab account
 * creates them with one click; everyone else lays the request before the approvers. The content
 * of a dialog; the caller opens and closes it.
 */
export function IssuesDialog({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const plan = useQuery(gitIssuesQuery(projectId));
  const data = plan.data;

  return (
    <DialogContent
      title={t('git.issues.title')}
      description={t('git.issues.hint')}
      className="w-[min(560px,calc(100vw-32px))]"
    >
      {!data ? (
        <>
          {plan.isError ? (
            <FieldError>{t('git.issues.loadFailed')}</FieldError>
          ) : (
            <p role="status" className="m-0 text-ui text-text-3">
              {t('common.loading')}
            </p>
          )}
          <Footer />
        </>
      ) : !data.repository ? (
        <>
          <p className={NOTE}>{t('git.issues.noRepository')}</p>
          <Footer />
        </>
      ) : data.milestones.every((milestone) => milestone.tasks.length === 0) ? (
        <>
          <p className={NOTE}>{t('git.issues.noTasks')}</p>
          <Footer />
        </>
      ) : (
        <Tasks projectId={projectId} plan={data} repository={data.repository.path} />
      )}
    </DialogContent>
  );
}

function Footer({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 flex justify-end gap-2">
      <DialogClose asChild>
        <Button variant="ghost">{t('common.close')}</Button>
      </DialogClose>
      {children}
    </div>
  );
}

/** A task that can get an issue now. */
const isFree = (task: GitIssueTask): task is GitIssueTask & { id: string } =>
  task.id !== null && task.state === 'free';

function Tasks({
  projectId,
  plan,
  repository,
}: {
  projectId: string;
  plan: GitIssuePlan;
  repository: string;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const request = useRequestGitIssues(projectId);
  const approve = useApproveGitRequests(projectId);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  /** What the person ticked; until they tick, every free task is chosen. */
  const [ticked, setTicked] = useState<ReadonlySet<string> | null>(null);

  const free = useMemo(
    () => plan.milestones.flatMap((milestone) => milestone.tasks.filter(isFree)),
    [plan.milestones],
  );
  // Only what is still free counts: a task someone else asked for meanwhile drops out.
  const chosen = useMemo(
    () => free.filter((task) => ticked === null || ticked.has(task.id)).map((task) => task.id),
    [free, ticked],
  );
  const tooMany = chosen.length > MAX_GIT_ISSUES;
  const direct = plan.canApprove && plan.hasAccount;
  const busy = request.isPending || approve.isPending;

  function toggle(taskIds: string[], on: boolean) {
    setOutcome(null);
    const next = new Set(chosen);
    for (const id of taskIds) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setTicked(next);
  }

  function submit() {
    setOutcome(null);
    request.mutate(
      { taskIds: chosen },
      {
        onSuccess: ({ requestId }) => {
          // Nothing stays ticked: what is free next is chosen by the person.
          setTicked(new Set());
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
      },
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <p className={NOTE}>
          <Trans
            i18nKey="git.issues.repository"
            values={{ repository }}
            components={{
              repo: (
                <code className="rounded-sm bg-bg-subtle px-1 py-px font-mono text-small text-text-body" />
              ),
            }}
          />
        </p>

        <div className="flex max-h-[min(380px,50vh)] flex-col gap-3 overflow-y-auto pr-1">
          {plan.milestones.map((milestone) => {
            const own = milestone.tasks.filter(isFree).map((task) => task.id);
            const ownChosen = own.filter((id) => chosen.includes(id));
            const headingId = `${ids}-m${String(milestone.number)}`;
            return (
              <section key={milestone.number} aria-labelledby={headingId}>
                <div className="flex items-center gap-2 border-b border-border-soft pb-1">
                  {plan.canRequest && own.length > 0 ? (
                    <input
                      type="checkbox"
                      aria-label={t('git.issues.allOf', { title: milestone.title })}
                      checked={ownChosen.length === own.length}
                      ref={(input) => {
                        if (input) {
                          input.indeterminate =
                            ownChosen.length > 0 && ownChosen.length < own.length;
                        }
                      }}
                      disabled={busy}
                      className="size-3.5 accent-ink enabled:cursor-pointer"
                      onChange={(event) => {
                        toggle(own, event.target.checked);
                      }}
                    />
                  ) : null}
                  <h3
                    id={headingId}
                    className="m-0 min-w-0 truncate text-small font-medium text-text-2"
                  >
                    {t('git.issues.milestone', {
                      number: milestone.number,
                      title: milestone.title,
                    })}
                  </h3>
                  <span className="ml-auto shrink-0 text-meta text-text-3 tabular-nums">
                    {t('git.issues.count', {
                      done: milestone.tasks.filter((task) => task.state === 'done').length,
                      total: milestone.tasks.length,
                    })}
                  </span>
                </div>
                {milestone.tasks.length === 0 ? (
                  <p className="m-0 pt-1.5 text-small text-text-3">{t('git.issues.noTasksHere')}</p>
                ) : (
                  <ul className="m-0 flex list-none flex-col p-0">
                    {milestone.tasks.map((task, index) => (
                      <TaskRow
                        // A task without an id has no other name yet; the order is the plan's.
                        key={task.id ?? `${String(milestone.number)}-${String(index)}`}
                        task={task}
                        canRequest={plan.canRequest}
                        checked={task.id !== null && chosen.includes(task.id)}
                        disabled={busy}
                        onToggle={(on) => {
                          if (task.id !== null) toggle([task.id], on);
                        }}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>

        {!plan.canRequest ? (
          <p className="m-0 text-small text-text-3">{t('git.issues.readOnly')}</p>
        ) : plan.canApprove && !plan.hasAccount ? (
          <p className="m-0 text-small text-text-3">{t('git.issues.accountHint')}</p>
        ) : null}
        {tooMany ? (
          <FieldError>{t('git.issues.limit', { count: MAX_GIT_ISSUES })}</FieldError>
        ) : null}
        {outcome === 'started' || outcome === 'proposed' ? (
          <p role="status" className="m-0 text-small text-text-2">
            {t(`git.issues.outcome.${outcome}`)}
          </p>
        ) : outcome ? (
          <FieldError>{t(`git.issues.outcome.${outcome}`)}</FieldError>
        ) : null}
      </div>

      <Footer>
        {plan.canRequest ? (
          <Button
            variant="primary"
            disabled={busy || chosen.length === 0 || tooMany}
            onClick={submit}
          >
            {chosen.length === 0
              ? t(direct ? 'git.issues.createNone' : 'git.issues.proposeNone')
              : t(direct ? 'git.issues.create' : 'git.issues.propose', { count: chosen.length })}
          </Button>
        ) : null}
      </Footer>
    </>
  );
}

function TaskRow({
  task,
  canRequest,
  checked,
  disabled,
  onToggle,
}: {
  task: GitIssueTask;
  canRequest: boolean;
  checked: boolean;
  disabled: boolean;
  onToggle: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const free = isFree(task);
  return (
    <li className="flex min-h-[30px] items-start gap-2 border-b border-border-soft py-1.5 last:border-b-0">
      {canRequest ? (
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled || !free}
          className="mt-[3px] size-3.5 shrink-0 accent-ink enabled:cursor-pointer"
          onChange={(event) => {
            onToggle(event.target.checked);
          }}
        />
      ) : null}
      <label
        htmlFor={canRequest ? id : undefined}
        className={cn(
          'min-w-0 flex-1 text-ui leading-snug [overflow-wrap:anywhere]',
          free ? 'cursor-pointer text-text-body' : 'text-text-2',
        )}
      >
        {task.text}
      </label>
      {task.issue ? (
        <a
          href={task.issue.url}
          target="_blank"
          rel="noreferrer"
          aria-label={t(task.issue.closed ? 'roadmap.issue.closed' : 'roadmap.issue.open', {
            number: task.issue.number,
          })}
          className="inline-flex shrink-0 items-center gap-1 text-small text-text-2 underline-offset-2 hover:text-text hover:underline"
        >
          {task.issue.closed ? (
            <CircleCheck size={13} strokeWidth={2} aria-hidden="true" className="text-success" />
          ) : null}
          #{task.issue.number}
          <ExternalLink size={11} strokeWidth={2} aria-hidden="true" />
        </a>
      ) : task.state === 'requested' ? (
        <span className="shrink-0 text-small text-text-3">{t('git.issues.requested')}</span>
      ) : null}
    </li>
  );
}
