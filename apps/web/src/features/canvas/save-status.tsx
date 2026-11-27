import type { PersistenceState } from '@covibes/shared';
import { useTranslation } from 'react-i18next';

export function SaveStatus({ state, retry }: { state: PersistenceState; retry: () => void }) {
  const { t } = useTranslation();
  if (state === 'unknown') return null;
  return (
    <div
      role="status"
      className="absolute right-3 bottom-3 z-10 flex items-center gap-2 rounded-full bg-bg-panel px-3 py-1.5 text-status text-text-2 shadow-float"
    >
      <span>{t(`persistence.${state}`)}</span>
      {state === 'error' ? (
        <button type="button" className="font-semibold underline" onClick={retry}>
          {t('persistence.retry')}
        </button>
      ) : null}
    </div>
  );
}
