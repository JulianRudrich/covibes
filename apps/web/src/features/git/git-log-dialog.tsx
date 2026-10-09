import type { GitRequest } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { DialogClose, DialogContent } from '@web/components/ui/dialog';
import { FieldError } from '@web/components/ui/input';
import { useAgents } from '@web/features/agents/agents';
import { GitActionList, GitRequestSummary } from '@web/features/git/git-request-view';
import { requestProgress } from '@web/features/git/request-progress';
import { gitLogQuery } from '@web/features/git/request-queries';
import { cn } from '@web/lib/cn';

/**
 * The dialog "Git-Protokoll" (spec 29b; derived look): every request for Git actions of the
 * project, the newest first, with who asked, who decided and when, and what became of its
 * actions. Every member reads it. The content of a dialog; the caller opens and closes it.
 */
export function GitLogDialog({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const log = useQuery(gitLogQuery(projectId));

  return (
    <DialogContent
      title={t('git.log.title')}
      description={t('git.log.hint')}
      className="w-[min(600px,calc(100vw-32px))]"
    >
      {!log.data ? (
        log.isError ? (
          <FieldError>{t('git.log.loadFailed')}</FieldError>
        ) : (
          <p role="status" className="m-0 text-ui text-text-3">
            {t('common.loading')}
          </p>
        )
      ) : log.data.requests.length === 0 ? (
        <p className="m-0 text-ui leading-snug text-text-2">{t('git.log.empty')}</p>
      ) : (
        <ul className="m-0 flex max-h-[min(460px,60vh)] list-none flex-col overflow-y-auto p-0 pr-1">
          {log.data.requests.map((request) => (
            <LogEntry key={request.id} request={request} />
          ))}
        </ul>
      )}

      <div className="mt-4 flex justify-end">
        <DialogClose asChild>
          <Button variant="ghost">{t('common.close')}</Button>
        </DialogClose>
      </div>
    </DialogContent>
  );
}

const STATUS_TONE: Record<GitRequest['status'], string> = {
  waiting: 'text-text-3',
  approved: 'text-text-3',
  done: 'text-success',
  failed: 'text-danger',
  rejected: 'text-text-3',
  withdrawn: 'text-text-3',
};

function LogEntry({ request }: { request: GitRequest }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const { done, total } = requestProgress(request);
  const at = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  const someone = t('git.requests.someone');
  const agents = useAgents();
  // A request an agent made (spec 29e) is the agent's.
  const requester =
    request.agentKey === null ? request.requestedBy.name || someone : agents(request.agentKey).name;
  const decided =
    request.decidedBy && request.decidedAt
      ? t(request.status === 'rejected' ? 'git.log.rejectedBy' : 'git.log.approvedBy', {
          name: request.decidedBy.name || someone,
          date: at(request.decidedAt),
        })
      : null;

  return (
    <li className="flex flex-col gap-1.5 border-b border-border-soft py-2.5 first:pt-0 last:border-b-0">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 text-ui leading-snug text-text-body">
          <GitRequestSummary request={request} done={request.status === 'done'} />
        </div>
        <span className={cn('shrink-0 text-small font-medium', STATUS_TONE[request.status])}>
          {t(`git.log.status.${request.status}`)}
          {request.status === 'failed' || request.status === 'approved'
            ? ` · ${t('git.log.progress', { done, total })}`
            : null}
        </span>
      </div>
      <p className="m-0 text-meta leading-snug text-text-3">
        {t('git.log.requestedBy', {
          name: requester,
          date: at(request.createdAt),
        })}
        {decided ? ` · ${decided}` : null}
        {request.status === 'done' || request.status === 'failed' ? ` · ${t('git.log.via')}` : null}
      </p>
      {open ? <GitActionList actions={request.actions} /> : null}
      <div>
        <Button
          size="s"
          variant="ghost"
          aria-expanded={open}
          className="-ml-2.5"
          onClick={() => {
            setOpen((shown) => !shown);
          }}
        >
          {t(open ? 'git.log.hideActions' : 'git.log.showActions', {
            count: request.actions.length,
          })}
        </Button>
      </div>
    </li>
  );
}
