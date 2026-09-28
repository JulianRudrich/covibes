import type { DevMail } from '@covibes/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { AppHeader } from '@web/components/app-header';
import { Card, Notice } from '@web/components/ui/card';
import { api } from '@web/lib/api';
import { formatRelativeTime } from '@web/lib/format';

const devMailsQuery = queryOptions({
  queryKey: ['dev-mails'],
  queryFn: () => api<DevMail[]>('/dev/mails'),
  refetchInterval: 3_000,
});

/** Mail text with its links clickable; the login link opens in the same tab. */
function MailText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/);
  return (
    <p className="m-0 text-ui leading-[1.55] break-words whitespace-pre-wrap text-text-body">
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <a key={index} href={part}>
            {part}
          </a>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </p>
  );
}

/** `/dev/mails`: mails the server would send, only in development. */
export function DevMailsPage() {
  const { t, i18n } = useTranslation();
  const mails = useQuery(devMailsQuery);

  return (
    <div className="min-h-dvh bg-bg-app text-text">
      <AppHeader>
        <Link to="/login" className="text-ui">
          {t('devMails.toLogin')}
        </Link>
      </AppHeader>
      <main className="mx-auto grid w-full max-w-[760px] gap-4 px-6 pt-8 pb-16">
        <div>
          <h1 className="m-0 text-[20px] font-semibold tracking-[-0.01em]">
            {t('devMails.title')}
          </h1>
          <p className="mt-1 mb-0 text-ui text-text-3">{t('devMails.hint')}</p>
        </div>
        {mails.isPending ? (
          <p className="text-ui text-text-3">{t('common.loading')}</p>
        ) : mails.isError ? (
          <Notice tone="danger">{t('devMails.loadError')}</Notice>
        ) : mails.data.length === 0 ? (
          <Card className="px-6 py-10 text-center text-ui text-text-3">{t('devMails.empty')}</Card>
        ) : (
          mails.data.map((mail) => (
            <Card key={mail.id} className="grid gap-3 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="m-0 text-title font-semibold">{mail.subject}</h2>
                <span className="text-small text-text-3">
                  {t('devMails.to', { email: mail.to })} ·{' '}
                  {formatRelativeTime(mail.sentAt, i18n.language)}
                </span>
              </div>
              <MailText text={mail.text} />
            </Card>
          ))
        )}
      </main>
    </div>
  );
}
