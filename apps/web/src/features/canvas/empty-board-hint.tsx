import { useTranslation } from 'react-i18next';

import { NO_EXPORT } from '@web/features/export/board-image';

/**
 * What an empty board says (spec 33; derived look): what goes on it and how to start. It lies in
 * the middle of the canvas and takes no clicks, so drawing starts right through it; an export
 * leaves it out. Viewers read that the board will fill.
 */
export function EmptyBoardHint({ readOnly }: { readOnly: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[4] grid place-items-center p-6"
      {...{ [NO_EXPORT]: '' }}
    >
      <div className="flex max-w-[340px] flex-col gap-1 text-center">
        <p className="m-0 text-title font-semibold text-text-2">{t('empty.canvas.title')}</p>
        <p className="m-0 text-ui leading-snug text-text-3">
          {t(readOnly ? 'empty.canvas.viewer' : 'empty.canvas.text')}
        </p>
      </div>
    </div>
  );
}
