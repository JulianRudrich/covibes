import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { DIALOG_SECTION_TITLE } from '@web/components/ui/dialog';
import { FieldError } from '@web/components/ui/input';
import {
  githubAccountQuery,
  useConnectGithubAccount,
  useDisconnectGithubAccount,
} from '@web/features/git/github-queries';

export function GithubAccountSection({
  projectId,
  goTo,
}: {
  projectId?: string;
  goTo: (url: string) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState(false);
  const account = useQuery(githubAccountQuery);
  const connect = useConnectGithubAccount();
  const disconnect = useDisconnectGithubAccount();

  return (
    <section className="flex flex-col items-start gap-2" aria-labelledby={titleId}>
      <h3 id={titleId} className={DIALOG_SECTION_TITLE}>
        {t('github.account.title')}
      </h3>
      {account.isError ? (
        <FieldError>{t('github.account.loadFailed')}</FieldError>
      ) : !account.data ? (
        <p role="status" className="m-0 text-ui text-text-3">
          {t('common.loading')}
        </p>
      ) : !account.data.available ? (
        <p className="m-0 text-ui text-text-2">{t('github.unavailable')}</p>
      ) : account.data.account ? (
        <>
          <p className="m-0 text-ui text-text-2">
            {account.data.account.name || account.data.account.username} (@
            {account.data.account.username})
          </p>
          {confirming ? (
            <>
              <Button
                variant="danger"
                disabled={disconnect.isPending}
                onClick={() => {
                  setProblem(false);
                  disconnect.mutate(undefined, {
                    onSuccess: () => {
                      setConfirming(false);
                    },
                    onError: () => {
                      setProblem(true);
                      setConfirming(false);
                    },
                  });
                }}
              >
                {t('github.account.disconnectConfirm')}
              </Button>
              <p className="m-0 text-small text-text-3">{t('github.account.disconnectHint')}</p>
            </>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(true);
              }}
            >
              {t('github.account.disconnect')}
            </Button>
          )}
        </>
      ) : (
        <Button
          variant="primary"
          disabled={connect.isPending}
          onClick={() => {
            setProblem(false);
            connect.mutate(
              { origin: 'account', ...(projectId ? { projectId } : {}) },
              {
                onSuccess: ({ url }) => {
                  goTo(url);
                },
                onError: () => {
                  setProblem(true);
                },
              },
            );
          }}
        >
          {t('github.account.connect')}
        </Button>
      )}
      {problem ? <FieldError>{t('github.account.error')}</FieldError> : null}
    </section>
  );
}
