import type { GitAccount, GitConnection, GitRepository, GitReturn, GitSync } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, GitBranch, Search } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { DialogClose, DialogContent } from '@web/components/ui/dialog';
import { FieldError, Input } from '@web/components/ui/input';
import {
  gitRepositoriesQuery,
  gitStateQuery,
  useConnectGitAccount,
  usePickGitRepository,
  useRemoveGitRepository,
} from '@web/features/git/queries';
import { SyncSection } from '@web/features/git/sync-section';
import { cn } from '@web/lib/cn';

const NOTE = 'm-0 text-ui leading-snug text-text-2';

type GitDialogProps = {
  projectId: string;
  /** How the way back from GitLab ended, if the person just came from there. */
  returned?: GitReturn;
  /** Sends the browser to GitLab's consent page; tests replace it. */
  goTo?: (url: string) => void;
};

/**
 * The dialog "Repository" (specs 28a and 29a; derived look): which repository in GitLab the
 * project belongs to, and with whose account it is reached. An owner picks it with their own
 * GitLab account, which they connect first if they have none, and removes it again; everyone else
 * sees what is connected. The content of a dialog; the caller opens and closes it.
 */
export function GitDialog({
  projectId,
  returned,
  goTo = (url) => {
    window.location.assign(url);
  },
}: GitDialogProps) {
  const { t } = useTranslation();
  const state = useQuery(gitStateQuery(projectId));
  const connect = useConnectGitAccount();
  const [problem, setProblem] = useState(false);
  /** The owner changes a repository that is picked already. */
  const [picking, setPicking] = useState(false);

  /** To GitLab and back to this dialog. */
  function start() {
    setProblem(false);
    connect.mutate(
      { origin: 'repository', projectId },
      {
        onSuccess: ({ url }) => {
          goTo(url);
        },
        onError: () => {
          setProblem(true);
        },
      },
    );
  }

  const data = state.data;
  const connectButton = (
    <div>
      <Button variant="primary" disabled={connect.isPending} onClick={start}>
        <GitBranch size={14} strokeWidth={2} aria-hidden="true" />
        {t('git.connect.action')}
      </Button>
    </div>
  );

  return (
    <DialogContent
      title={t('git.title')}
      description={t('git.hint')}
      className="w-[min(520px,calc(100vw-32px))]"
    >
      <div className="flex flex-col gap-4">
        {returned === 'denied' || returned === 'failed' ? (
          <FieldError>{t(`git.returned.${returned}`)}</FieldError>
        ) : null}

        {!data ? (
          state.isError ? (
            <FieldError>{t('git.loadFailed')}</FieldError>
          ) : (
            <p role="status" className="m-0 text-ui text-text-3">
              {t('common.loading')}
            </p>
          )
        ) : data.connection && !picking ? (
          <Connected
            projectId={projectId}
            connection={data.connection}
            canManage={data.canManage}
            sync={data.sync}
            loadedAt={state.dataUpdatedAt}
            canSetUpWebhook={data.canManage && data.available}
            onChange={() => {
              setPicking(true);
            }}
          />
        ) : !data.available ? (
          <p className={NOTE}>{t('git.unavailable')}</p>
        ) : !data.canManage ? (
          <p className={NOTE}>{t('git.connect.ownersOnly')}</p>
        ) : data.account ? (
          <>
            <p className={NOTE}>{t('git.account.as', accountNames(data.account))}</p>
            <RepositoryPicker
              projectId={projectId}
              current={data.connection?.repository ?? null}
              onPicked={() => {
                setPicking(false);
              }}
              onReconnect={start}
            />
          </>
        ) : (
          <>
            <p className={NOTE}>{t('git.connect.text')}</p>
            {connectButton}
          </>
        )}

        {problem ? <FieldError>{t('git.connect.failed')}</FieldError> : null}
      </div>

      <div className="mt-4 flex justify-end">
        <DialogClose asChild>
          <Button variant="ghost">{t('common.close')}</Button>
        </DialogClose>
      </div>
    </DialogContent>
  );
}

/** The names of an account for a text: the name if it has one, and the username. */
function accountNames(account: Pick<GitAccount, 'username' | 'name'>) {
  return { name: account.name || account.username, username: account.username };
}

/**
 * A project with a repository: which one, whose access reaches it, when its state was last read
 * (spec 30a), and how it ends.
 */
function Connected({
  projectId,
  connection,
  canManage,
  sync,
  loadedAt,
  canSetUpWebhook,
  onChange,
}: {
  projectId: string;
  connection: GitConnection;
  canManage: boolean;
  sync: GitSync | null;
  loadedAt: number;
  canSetUpWebhook: boolean;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const remove = useRemoveGitRepository(projectId);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState(false);
  const { account, connectedBy, repository } = connection;

  return (
    <>
      <div className="flex items-center gap-3 rounded-card border border-border bg-bg-subtle px-3.5 py-3">
        <GitBranch size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 text-text-3" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-ui font-semibold text-text">{repository.name}</span>
          <a
            href={repository.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-1 text-small text-text-2 underline-offset-2 hover:text-text hover:underline"
          >
            <span className="truncate">{repository.path}</span>
            <ExternalLink size={11} strokeWidth={2} aria-hidden="true" className="shrink-0" />
          </a>
        </div>
        {canManage ? (
          <Button size="s" variant="ghost" className="ml-auto" onClick={onChange}>
            {t('git.repository.change')}
          </Button>
        ) : null}
      </div>
      <p className="m-0 text-small leading-snug text-text-3">
        {t('git.connected.by', { ...accountNames(account), by: connectedBy.name })}
      </p>

      <SyncSection
        projectId={projectId}
        sync={sync}
        loadedAt={loadedAt}
        canSetUpWebhook={canSetUpWebhook}
      />

      {canManage ? (
        <div className="flex items-center gap-2">
          {confirming ? (
            <>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() => {
                  setProblem(false);
                  remove.mutate(undefined, {
                    onError: () => {
                      setProblem(true);
                      setConfirming(false);
                    },
                  });
                }}
              >
                {t('git.remove.confirm')}
              </Button>
              <span className="min-w-0 text-small leading-snug text-text-3">
                {t('git.remove.hint')}
              </span>
            </>
          ) : (
            <Button
              variant="ghost"
              className="text-danger"
              onClick={() => {
                setConfirming(true);
              }}
            >
              {t('git.remove.action')}
            </Button>
          )}
        </div>
      ) : null}
      {problem ? <FieldError>{t('git.remove.failed')}</FieldError> : null}
    </>
  );
}

/** The repositories of the owner's own account with a search; a click picks one. */
function RepositoryPicker({
  projectId,
  current,
  onPicked,
  onReconnect,
}: {
  projectId: string;
  current: GitRepository | null;
  onPicked: () => void;
  onReconnect: () => void;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const repositories = useQuery(gitRepositoriesQuery(projectId, search));
  const pick = usePickGitRepository(projectId);
  const [problem, setProblem] = useState(false);

  // The list follows the typing with a short pause, so GitLab is not asked for every letter.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(text.trim());
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);

  return (
    <section aria-labelledby={`${ids}-title`} className="flex flex-col gap-2">
      <h3 id={`${ids}-title`} className="m-0 text-small font-medium text-text-2">
        {t('git.repository.pick')}
      </h3>
      <div className="relative">
        <Search
          size={14}
          strokeWidth={2}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-4"
        />
        <Input
          type="search"
          value={text}
          aria-label={t('git.repository.search')}
          placeholder={t('git.repository.search')}
          className="pl-8"
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </div>
      {repositories.isError ? (
        <div className="flex flex-col items-start gap-2">
          <FieldError>{t('git.repository.listFailed')}</FieldError>
          <Button size="s" onClick={onReconnect}>
            {t('git.connect.again')}
          </Button>
        </div>
      ) : repositories.data === undefined ? (
        <p role="status" className="m-0 text-small text-text-3">
          {t('common.loading')}
        </p>
      ) : repositories.data.length === 0 ? (
        <p className="m-0 text-small text-text-3">
          {t(search ? 'git.repository.noneFound' : 'git.repository.none')}
        </p>
      ) : (
        <ul className="m-0 flex max-h-[240px] list-none flex-col gap-1 overflow-y-auto p-0">
          {repositories.data.map((repository) => (
            <li key={repository.id}>
              <button
                type="button"
                disabled={pick.isPending}
                aria-pressed={repository.id === current?.id}
                className={cn(
                  'flex w-full cursor-pointer flex-col rounded-md border px-3 py-2 text-left transition-colors hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:pointer-events-none disabled:opacity-60',
                  repository.id === current?.id ? 'border-ink' : 'border-border',
                )}
                onClick={() => {
                  setProblem(false);
                  pick.mutate(
                    { repositoryId: repository.id },
                    {
                      onSuccess: onPicked,
                      onError: () => {
                        setProblem(true);
                      },
                    },
                  );
                }}
              >
                <span className="text-ui font-medium text-text">{repository.name}</span>
                <span className="text-small text-text-3">{repository.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {problem ? <FieldError>{t('git.repository.pickFailed')}</FieldError> : null}
    </section>
  );
}
