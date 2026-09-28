import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { PageMessage } from '@web/components/page-message';
import { Button } from '@web/components/ui/button';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <PageMessage title={t('errors.notFound')}>
      <Link to="/" className="mt-2 text-ui">
        {t('errors.toStart')}
      </Link>
    </PageMessage>
  );
}

/** Shown when a route cannot load, e.g. because the server is not running. */
export function ErrorPage() {
  const { t } = useTranslation();
  return (
    <PageMessage title={t('errors.unavailable')}>
      <p className="m-0 text-ui text-text-3">{t('errors.unavailableText')}</p>
      <Button
        className="mt-2 justify-self-center"
        onClick={() => {
          window.location.reload();
        }}
      >
        {t('errors.retry')}
      </Button>
    </PageMessage>
  );
}
