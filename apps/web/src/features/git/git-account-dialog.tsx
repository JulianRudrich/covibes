import type { GitReturn } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { GitBranch } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { DialogClose, DialogContent } from '@web/components/ui/dialog';
import { FieldError } from '@web/components/ui/input';
import { GithubAccountSection } from '@web/features/git/github-account-section';
import {
  gitAccountQuery,
  useConnectGitAccount,
  useDisconnectGitAccount,
} from '@web/features/git/queries';

const NOTE = 'm-0 text-ui leading-snug text-text-2';

type GitAccountDialogProps = {
  /** The project the person is in, to come back to it after the way to GitLab. */
  projectId?: string;
  /** How the way back from GitLab ended, if the person just came from there. */
  returned?: GitReturn;
  /** Sends the browser to GitLab's consent page; tests replace it. */
  goTo?: (url: string) => void;
};

/**
 * The dialog "GitLab-Konto" (spec 29a; derived look): the person's own GitLab account, with which
 * an owner picks the repository of a project and Git actions run in the person's name. Everyone
 * connects and disconnects their own. The content of a dialog; the caller opens and closes it.
 */
export function GitAccountDialog({
  projectId,
  returned,
  goTo = (url) => {
    window.location.assign(url);
  },
}: GitAccountDialogProps) {
  const { t } = useTranslation();
  const state = useQuery(gitAccountQuery);
  const connect = useConnectGitAccount();
  const disconnect = useDisconnectGitAccount();
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<'connect' | 'disconnect' | null>(null);

  const data = state.data;
  return (
    <DialogContent
      title={t('git.account.title')}
      description={t('git.account.hint')}
      className="w-[min(480px,calc(100vw-32px))]"
    >
      <div className="flex flex-col gap-4">
        {returned === 'denied' || returned === 'failed' ? (
          <FieldError>{t(`git.returned.${returned}`)}</FieldError>
        ) : null}

        {!data ? (
          state.isError ? (
            <FieldError>{t('git.account.loadFailed')}</FieldError>
          ) : (
            <p role="status" className="m-0 text-ui text-text-3">
              {t('common.loading')}
            </p>
          )
        ) : data.account ? (
          <>
            <div className="flex items-center gap-3 rounded-card bg-bg-subtle px-4 py-3.5">
              <GitBranch
                size={16}
                strokeWidth={2}
                aria-hidden="true"
                className="shrink-0 text-text-3"
              />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-ui font-semibold text-text">
                  {data.account.name || data.account.username}
                </span>
                <span className="truncate text-small text-text-2">
                  @{data.account.username} · {new URL(data.account.baseUrl).host}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {confirming ? (
                <>
                  <Button
                    variant="danger"
                    disabled={disconnect.isPending}
                    onClick={() => {
                      setProblem(null);
                      disconnect.mutate(undefined, {
                        onSuccess: () => {
                          setConfirming(false);
                        },
                        onError: () => {
                          setProblem('disconnect');
                          setConfirming(false);
                        },
                      });
                    }}
                  >
                    {t('git.account.disconnect.confirm')}
                  </Button>
                  <span className="min-w-0 text-small leading-snug text-text-3">
                    {t('git.account.disconnect.hint')}
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
                  {t('git.account.disconnect.action')}
                </Button>
              )}
            </div>
          </>
        ) : !data.available ? (
          <p className={NOTE}>{t('git.unavailable')}</p>
        ) : (
          <>
            <p className={NOTE}>{t('git.account.connect')}</p>
            <div>
              <Button
                variant="primary"
                disabled={connect.isPending}
                onClick={() => {
                  setProblem(null);
                  connect.mutate(
                    { origin: 'account', ...(projectId ? { projectId } : {}) },
                    {
                      onSuccess: ({ url }) => {
                        goTo(url);
                      },
                      onError: () => {
                        setProblem('connect');
                      },
                    },
                  );
                }}
              >
                <GitBranch size={14} strokeWidth={2} aria-hidden="true" />
                {t('git.connect.action')}
              </Button>
            </div>
          </>
        )}

        {problem ? (
          <FieldError>
            {t(problem === 'connect' ? 'git.connect.failed' : 'git.account.disconnect.failed')}
          </FieldError>
        ) : null}
        <GithubAccountSection projectId={projectId} goTo={goTo} />
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <DialogClose asChild>
          <Button variant="ghost">{t('common.close')}</Button>
        </DialogClose>
      </div>
    </DialogContent>
  );
}
