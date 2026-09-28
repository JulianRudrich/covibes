import { phaseStatuses, type Phase, type PhaseStatus } from '@covibes/shared';
import { Check, ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@web/lib/cn';

function PhaseSymbol({ status, number }: { status: PhaseStatus; number: number }) {
  if (status === 'done') {
    return (
      <span className="grid size-4 shrink-0 place-items-center rounded-full bg-ink text-on-ink">
        <Check size={10} strokeWidth={3.5} aria-hidden="true" />
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="grid size-4 shrink-0 place-items-center rounded-full border-[1.5px] border-ink">
        <span className="size-1.5 rounded-full bg-ink" />
      </span>
    );
  }
  return (
    <span className="grid size-4 shrink-0 place-items-center rounded-full border-[1.5px] border-ring-upcoming text-[9px] font-semibold text-text-upcoming">
      {number}
    </span>
  );
}

/** Orientation bar: brainstorming → decide → architecture → project plan. */
export function PhaseIndicator({ active }: { active: Phase }) {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t('workspace.phasesLabel')}
      className="flex items-center gap-0.5 rounded-card bg-track p-[3px]"
    >
      {phaseStatuses(active).map(({ phase, status }, index) => (
        <Fragment key={phase}>
          {index > 0 && (
            <ChevronRight size={12} className="shrink-0 text-text-5" aria-hidden="true" />
          )}
          <span
            aria-current={status === 'active' ? 'step' : undefined}
            className={cn(
              'flex h-7 items-center gap-[7px] rounded-btn-s pl-2.5 whitespace-nowrap',
              status === 'active' ? 'bg-bg-panel pr-3 font-semibold shadow-phase-active' : 'pr-2.5',
              status === 'done' && 'text-text-2',
              status === 'upcoming' && 'text-text-upcoming',
            )}
          >
            <PhaseSymbol status={status} number={index + 1} />
            {t(`phases.${phase}`)}
          </span>
        </Fragment>
      ))}
    </nav>
  );
}
