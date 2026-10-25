import { LANGUAGE_NAMES, LANGUAGES } from '@covibes/shared';
import { useTranslation } from 'react-i18next';

import { TOUCH_TARGET } from '@web/components/ui/button-variants';
import { useChooseLanguage } from '@web/features/account/language';
import { cn } from '@web/lib/cn';

/**
 * The two languages of the interface as a small switch (spec 32a; derived look), for the pages
 * someone sees signed out: login, invitation and the read-only view. Each language is named in
 * its own language, so it is found by who cannot read the other one.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const choose = useChooseLanguage();

  return (
    <div
      role="group"
      aria-label={t('language.label')}
      className={cn('flex items-center justify-center gap-1 text-small', className)}
    >
      {LANGUAGES.map((language, index) => {
        const shown = i18n.language === language;
        return (
          <span key={language} className="flex items-center gap-1">
            {index > 0 ? (
              <span aria-hidden="true" className="text-text-faint">
                ·
              </span>
            ) : null}
            <button
              type="button"
              lang={language}
              aria-pressed={shown}
              onClick={() => {
                choose(language);
              }}
              className={cn(
                'cursor-pointer rounded-xs border-0 bg-transparent px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-ink',
                TOUCH_TARGET,
                shown ? 'font-semibold text-text' : 'text-text-3 hover:text-text',
              )}
            >
              {LANGUAGE_NAMES[language]}
            </button>
          </span>
        );
      })}
    </div>
  );
}
