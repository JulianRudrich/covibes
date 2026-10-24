import { useTranslation } from 'react-i18next';

import { PageMessage, PageMessageLink } from '@web/components/page-message';
import { Button } from '@web/components/ui/button';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <PageMessage title={t('errors.notFound')}>
      <PageMessageLink to="/">{t('errors.toStart')}</PageMessageLink>
    </PageMessage>
  );
}

/** Shown when a route cannot load, e.g. because the server is not running. */
export function ErrorPage() {
  const { t } = useTranslation();
  return (
    <PageMessage title={t('errors.unavailable')}>
      <p className="m-0 text-body text-text-3">{t('errors.unavailableText')}</p>
      <Button
        variant="primary"
        size="l"
        className="mt-3 justify-self-center"
        onClick={() => {
          window.location.reload();
        }}
      >
        {t('errors.retry')}
      </Button>
    </PageMessage>
  );
}
