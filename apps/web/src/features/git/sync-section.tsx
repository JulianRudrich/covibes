import type { GitSync } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DIALOG_SECTION_TITLE } from '@web/components/ui/dialog';
import { Button } from '@web/components/ui/button';
import { FieldError, Input } from '@web/components/ui/input';
import { gitWebhookQuery, useRenewGitWebhook, useRequestGitSync } from '@web/features/git/queries';
import { formatRelativeTime } from '@web/lib/format';

/** How long "Wird abgeglichen …" waits for the reading to arrive before it gives up. */
const SYNC_WAIT_MS = 15_000;

const TITLE = DIALOG_SECTION_TITLE;
const NOTE = 'm-0 text-small leading-snug text-text-3';

type SyncSectionProps = {
  projectId: string;
  sync: GitSync | null;
  /** Counts up whenever the state was loaded again: a reading that ended shows as a new load. */
  loadedAt: number;
  /** Owners set up the webhook, on a server that is set up for GitLab. */
  canSetUpWebhook: boolean;
};

/**
 * The state from GitLab in the dialog "Repository" (spec 30a; derived look): when Covibes last
 * read whether the issues of the tasks are open or closed, a button to read now, and for owners
 * the webhook with which GitLab says at once that something changed.
 */
export function SyncSection({ projectId, sync, loadedAt, canSetUpWebhook }: SyncSectionProps) {
  const { t, i18n } = useTranslation();
  const ids = useId();
  const request = useRequestGitSync(projectId);
  /** A reading was asked for with a click; `loadedAt` of then tells when its result is there. */
  const [waiting, setWaiting] = useState<number | null>(null);
  const [note, setNote] = useState<'justNow' | 'requestFailed' | null>(null);
  const [webhook, setWebhook] = useState(false);
  const running = request.isPending || (waiting !== null && waiting === loadedAt);

  // A reading that never reports back (the worker rests) does not hold the button forever.
  useEffect(() => {
    if (waiting === null) return;
    const timer = setTimeout(() => {
      setWaiting(null);
    }, SYNC_WAIT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [waiting]);

  function syncNow() {
    setNote(null);
    request.mutate(
      { force: true },
      {
        onSuccess: ({ queued }) => {
          if (queued) setWaiting(loadedAt);
          else setNote('justNow');
        },
        onError: () => {
          setNote('requestFailed');
        },
      },
    );
  }

  const when = sync?.syncedAt ? formatRelativeTime(sync.syncedAt, i18n.language) : null;
  return (
    <section
      aria-labelledby={`${ids}-title`}
      className="flex flex-col gap-2 border-t border-border-subtle pt-3"
    >
      <h3 id={`${ids}-title`} className={TITLE}>
        {t('git.sync.title')}
      </h3>
      <p className={NOTE}>{t('git.sync.text')}</p>
      <div className="flex items-center gap-3">
        {sync?.failed ? (
          <FieldError>{t(when ? 'git.sync.failedSince' : 'git.sync.failed', { when })}</FieldError>
        ) : (
          <p role="status" className="m-0 min-w-0 flex-1 text-small text-text-2">
            {running
              ? t('git.sync.running')
              : when
                ? t('git.sync.at', { when })
                : t('git.sync.never')}
          </p>
        )}
        <Button size="s" className="ml-auto" disabled={running} onClick={syncNow}>
          <RefreshCw size={13} strokeWidth={2} aria-hidden="true" />
          {t('git.sync.now')}
        </Button>
      </div>
      {note === 'justNow' ? <p className={NOTE}>{t('git.sync.justNow')}</p> : null}
      {note === 'requestFailed' ? <FieldError>{t('git.sync.requestFailed')}</FieldError> : null}

      {canSetUpWebhook ? (
        webhook ? (
          <Webhook projectId={projectId} />
        ) : (
          <div>
            <Button
              size="s"
              variant="ghost"
              className="-ml-2.5"
              onClick={() => {
                setWebhook(true);
              }}
            >
              {t('git.webhook.show')}
            </Button>
          </div>
        )
      ) : null}
    </section>
  );
}

/** The webhook an owner enters in GitLab: its address and secret, and a new secret on demand. */
function Webhook({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const ids = useId();
  const webhook = useQuery(gitWebhookQuery(projectId));
  const renew = useRenewGitWebhook(projectId);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState(false);

  return (
    <section
      aria-labelledby={`${ids}-title`}
      className="flex flex-col gap-2 rounded-card bg-bg-subtle p-3.5"
    >
      <h4 id={`${ids}-title`} className={TITLE}>
        {t('git.webhook.title')}
      </h4>
      <p className={NOTE}>{t('git.webhook.text')}</p>
      {webhook.data ? (
        <>
          <CopyField label={t('git.webhook.url')} value={webhook.data.url} />
          <CopyField label={t('git.webhook.secret')} value={webhook.data.secret} secret />
          <div className="flex items-center gap-2">
            {confirming ? (
              <>
                <Button
                  size="s"
                  variant="danger"
                  disabled={renew.isPending}
                  onClick={() => {
                    setProblem(false);
                    renew.mutate(undefined, {
                      onError: () => {
                        setProblem(true);
                      },
                      onSettled: () => {
                        setConfirming(false);
                      },
                    });
                  }}
                >
                  {t('git.webhook.renewConfirm')}
                </Button>
                <span className="min-w-0 text-small leading-snug text-text-3">
                  {t('git.webhook.renewHint')}
                </span>
              </>
            ) : (
              <Button
                size="s"
                variant="ghost"
                className="-ml-2.5"
                onClick={() => {
                  setConfirming(true);
                }}
              >
                {t('git.webhook.renew')}
              </Button>
            )}
          </div>
          {problem ? <FieldError>{t('git.webhook.renewFailed')}</FieldError> : null}
        </>
      ) : webhook.isError ? (
        <FieldError>{t('git.webhook.loadFailed')}</FieldError>
      ) : (
        <p role="status" className={NOTE}>
          {t('common.loading')}
        </p>
      )}
    </section>
  );
}

/** A value to copy into GitLab; a secret shows as dots until the owner wants to see it. */
function CopyField({
  label,
  value,
  secret = false,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  /** What was copied; a new secret is a new value to copy. */
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const copied = copiedValue === value;
  const [shown, setShown] = useState(!secret);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
    } catch {
      // No clipboard (e.g. no permission): the value shows, so it can be copied by hand.
      setShown(true);
      setCopiedValue(null);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-meta text-text-3">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          readOnly
          value={shown ? value : '•'.repeat(24)}
          className="h-7 min-w-0 flex-1 font-mono text-meta"
          onFocus={(event) => {
            event.target.select();
          }}
        />
        {secret ? (
          <Button
            size="s"
            variant="ghost"
            aria-label={t(shown ? 'git.webhook.hide' : 'git.webhook.reveal')}
            aria-pressed={shown}
            className="px-1.5"
            onClick={() => {
              setShown((now) => !now);
            }}
          >
            {shown ? (
              <EyeOff size={14} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Eye size={14} strokeWidth={2} aria-hidden="true" />
            )}
          </Button>
        ) : null}
        <Button
          size="s"
          aria-label={t(copied ? 'git.webhook.copied' : 'git.webhook.copy', { label })}
          onClick={() => {
            void copy();
          }}
        >
          {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          {t(copied ? 'share.invite.copied' : 'share.invite.copy')}
        </Button>
      </div>
    </div>
  );
}
