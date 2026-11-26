import { useTranslation } from 'react-i18next';

import { PageMessage } from '@web/components/page-message';

/** Existing Studio geometry while a route chunk is fetched. Errors use the route's retry page. */
export function RouteLoading() {
  const { t } = useTranslation();
  return (
    <PageMessage title={t('common.loading')}>
      <p role="status" aria-live="polite" aria-busy="true" className="m-0 text-small text-text-3">
        {t('layout.loadingRoute')}
      </p>
    </PageMessage>
  );
}
