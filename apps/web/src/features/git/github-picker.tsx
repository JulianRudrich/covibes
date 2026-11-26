import type { GitRepository } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { DIALOG_SECTION_TITLE } from '@web/components/ui/dialog';
import { FieldError, Input } from '@web/components/ui/input';
import {
  githubAccountQuery,
  githubInstallationsQuery,
  githubRepositoriesQuery,
  useConnectGithubAccount,
  usePickGithubRepository,
} from '@web/features/git/github-queries';

export function GithubPicker({
  projectId,
  current,
  onPicked,
  goTo,
}: {
  projectId: string;
  current: GitRepository | null;
  onPicked: () => void;
  goTo: (url: string) => void;
}) {
  const { t } = useTranslation();
  const account = useQuery(githubAccountQuery);
  const connect = useConnectGithubAccount();
  const [failed, setFailed] = useState(false);

  if (account.isError) return <FieldError>{t('github.loadFailed')}</FieldError>;
  if (!account.data) return <p role="status">{t('common.loading')}</p>;
  if (!account.data.available) return <p>{t('github.unavailable')}</p>;
  if (!account.data.account)
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="m-0 text-ui text-text-2">{t('github.connectText')}</p>
        <Button
          variant="primary"
          disabled={connect.isPending}
          onClick={() => {
            setFailed(false);
            connect.mutate(
              { origin: 'repository', projectId },
              {
                onSuccess: ({ url }) => {
                  goTo(url);
                },
                onError: () => {
                  setFailed(true);
                },
              },
            );
          }}
        >
          {t('github.connect')}
        </Button>
        {failed ? <FieldError>{t('github.connectFailed')}</FieldError> : null}
      </div>
    );
  return (
    <GithubInstallations
      projectId={projectId}
      current={current}
      onPicked={onPicked}
      installUrl={account.data.installUrl}
    />
  );
}

function GithubInstallations({
  projectId,
  current,
  onPicked,
  installUrl,
}: {
  projectId: string;
  current: GitRepository | null;
  onPicked: () => void;
  installUrl: string | null;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [installationId, setInstallationId] = useState<number | null>(null);
  const installations = useQuery(githubInstallationsQuery(projectId, page));
  return (
    <div className="flex flex-col gap-3">
      <h3 className={DIALOG_SECTION_TITLE}>{t('github.installations')}</h3>
      {installations.isError ? <FieldError>{t('github.installationsFailed')}</FieldError> : null}
      {!installations.data && !installations.isError ? (
        <p role="status">{t('common.loading')}</p>
      ) : null}
      {installations.data?.installations.length === 0 ? (
        <p className="m-0 text-small text-text-3">{t('github.noInstallations')}</p>
      ) : null}
      {installations.data?.installations.map((installation) => (
        <Button
          key={installation.id}
          variant="ghost"
          aria-pressed={installation.id === installationId}
          onClick={() => {
            setInstallationId(installation.id);
          }}
        >
          {installation.account}
        </Button>
      ))}
      <div className="flex flex-wrap gap-2">
        {page > 1 ? (
          <Button
            size="s"
            onClick={() => {
              setPage(page - 1);
              setInstallationId(null);
            }}
          >
            {t('github.previous')}
          </Button>
        ) : null}
        {installations.data?.more && page < 20 ? (
          <Button
            size="s"
            onClick={() => {
              setPage(page + 1);
              setInstallationId(null);
            }}
          >
            {t('github.next')}
          </Button>
        ) : null}
        {installUrl ? (
          <a
            href={installUrl}
            target="_blank"
            rel="noreferrer"
            className="text-small text-text-2 underline"
          >
            {t('github.install')}
          </a>
        ) : null}
        {installUrl ? (
          <Button
            size="s"
            variant="ghost"
            onClick={() => {
              void installations.refetch();
            }}
          >
            {t('github.refresh')}
          </Button>
        ) : null}
      </div>
      {installationId !== null ? (
        <GithubRepositories
          projectId={projectId}
          installationId={installationId}
          current={current}
          onPicked={onPicked}
        />
      ) : null}
    </div>
  );
}

function GithubRepositories({
  projectId,
  installationId,
  current,
  onPicked,
}: {
  projectId: string;
  installationId: number;
  current: GitRepository | null;
  onPicked: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const repositories = useQuery(githubRepositoriesQuery(projectId, installationId, search));
  const pick = usePickGithubRepository(projectId);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(text.trim());
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className={DIALOG_SECTION_TITLE}>
        {t('git.repository.pick')}
      </h3>
      <Input
        type="search"
        value={text}
        aria-label={t('git.repository.search')}
        placeholder={t('git.repository.search')}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      {repositories.isError ? <FieldError>{t('github.repositoriesFailed')}</FieldError> : null}
      {!repositories.data && !repositories.isError ? (
        <p role="status">{t('common.loading')}</p>
      ) : null}
      {repositories.data?.length === 0 ? (
        <p className="m-0 text-small text-text-3">{t('github.noRepositories')}</p>
      ) : null}
      {repositories.data?.length === 20 ? (
        <p className="m-0 text-small text-text-3">{t('github.refineSearch')}</p>
      ) : null}
      <ul className="m-0 flex max-h-[240px] list-none flex-col gap-1 overflow-y-auto p-0">
        {repositories.data?.map((repository) => (
          <li key={repository.id}>
            <button
              type="button"
              disabled={pick.isPending}
              aria-pressed={current?.provider === 'github' && current.id === repository.id}
              className="flex w-full cursor-pointer flex-col rounded-card border border-border px-3.5 py-2.5 text-left hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-60"
              onClick={() => {
                setFailed(false);
                pick.mutate(
                  { installationId, repositoryId: repository.id },
                  {
                    onSuccess: onPicked,
                    onError: () => {
                      setFailed(true);
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
      {failed ? <FieldError>{t('git.repository.pickFailed')}</FieldError> : null}
    </section>
  );
}
