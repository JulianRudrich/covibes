import { useTranslation } from 'react-i18next';

import { DialogContent } from '@web/components/ui/dialog';

export function DialogLoading() {
  const { t } = useTranslation();
  return (
    <DialogContent title={t('common.loading')}>
      <p role="status" aria-busy="true" className="m-0 text-small text-text-3">
        {t('layout.loadingRoute')}
      </p>
    </DialogContent>
  );
}
