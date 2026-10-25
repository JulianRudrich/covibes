import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@web/lib/cn';

export type MobileTab<Id extends string> = {
  id: Id;
  label: string;
  icon: LucideIcon;
  /** What waits there, as a badge on the icon; nothing at 0. */
  count?: number;
  /** Read with the count, e.g. "2 warten auf dich". */
  countLabel?: string;
};

type MobileTabsProps<Id extends string> = {
  tabs: readonly MobileTab<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
};

/**
 * The tabs at the bottom of the phone layout (spec 36e, draft H-Mobile): equal columns on the
 * panel color, each a 52 px target with its icon in a pill and the label below; the chosen one
 * has the pill on the subtle surface and its label in the text color.
 */
export function MobileTabs<Id extends string>({ tabs, active, onSelect }: MobileTabsProps<Id>) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('mobile.areas')}
      className="grid auto-cols-fr grid-flow-col border-t border-border bg-bg-panel px-3 pt-1.5 pb-[max(10px,env(safe-area-inset-bottom))]"
    >
      {tabs.map((tab) => {
        const chosen = tab.id === active;
        const Icon = tab.icon;
        const count = tab.count ?? 0;
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={chosen ? 'page' : undefined}
            aria-label={count > 0 && tab.countLabel ? `${tab.label}, ${tab.countLabel}` : undefined}
            className={cn(
              'flex h-[52px] cursor-pointer flex-col items-center justify-center gap-[3px] rounded-panel text-[12px] focus-visible:outline-offset-0',
              chosen ? 'font-semibold text-text' : 'font-medium text-text-3',
            )}
            onClick={() => {
              onSelect(tab.id);
            }}
          >
            <span
              aria-hidden="true"
              className={cn(
                'relative grid h-7 w-[52px] place-items-center rounded-full transition-colors duration-150',
                chosen && 'bg-bg-subtle',
              )}
            >
              <Icon size={19} strokeWidth={2} />
              {count > 0 ? (
                <span className="absolute top-0 right-2 grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-[10px] font-bold text-on-ink tabular-nums">
                  {count}
                </span>
              ) : null}
            </span>
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
