import { phaseStatuses, type Phase, type PhaseStatus } from '@covibes/shared';
import { Check, ChevronRight } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@web/components/ui/popover';
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

type PhaseIndicatorProps = {
  active: Phase;
  /** Owners and editors jump to another phase (spec 24); without it the phases are only read. */
  onSelect?: (phase: Phase) => void;
  /** Asks the moderator in the chat where the project stands and what comes next. */
  onAsk?: () => void;
};

/**
 * Orientation bar: brainstorming → decide → architecture → project plan (handoff "Main screen").
 * A phase opens a card that says what it is for (spec 24; derived looks). From there owners and
 * editors change to the phase, and in the current one they ask the moderator for the next step.
 */
export function PhaseIndicator({ active, onSelect, onAsk }: PhaseIndicatorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Phase | null>(null);

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
          <Popover
            open={open === phase}
            onOpenChange={(isOpen) => {
              setOpen(isOpen ? phase : null);
            }}
          >
            <PopoverTrigger
              aria-current={status === 'active' ? 'step' : undefined}
              className={cn(
                'flex h-7 cursor-pointer items-center gap-[7px] rounded-btn-s pl-2.5 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-ink',
                status === 'active'
                  ? 'bg-bg-panel pr-3 font-semibold shadow-phase-active'
                  : 'pr-2.5 hover:text-text',
                status === 'done' && 'text-text-2',
                status === 'upcoming' && 'text-text-upcoming',
              )}
            >
              <PhaseSymbol status={status} number={index + 1} />
              {t(`phases.${phase}`)}
            </PopoverTrigger>
            <PopoverContent
              align="center"
              aria-label={t(`phases.${phase}`)}
              className="flex w-[280px] flex-col gap-2 p-3.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="m-0 text-ui font-semibold text-text">{t(`phases.${phase}`)}</h2>
                <span className="shrink-0 text-meta text-text-3">
                  {t(`phases.status.${status}`)}
                </span>
              </div>
              <p className="m-0 text-body leading-normal text-text-body">
                {t(`phases.about.${phase}`)}
              </p>
              {status === 'active' ? (
                onAsk ? (
                  <>
                    <p className="m-0 text-small leading-snug text-text-3">{t('phases.askHint')}</p>
                    <div>
                      <Button
                        size="s"
                        onClick={() => {
                          onAsk();
                          setOpen(null);
                        }}
                      >
                        {t('phases.ask')}
                      </Button>
                    </div>
                  </>
                ) : null
              ) : onSelect ? (
                <div className="mt-0.5">
                  <Button
                    variant="primary"
                    size="s"
                    onClick={() => {
                      onSelect(phase);
                      setOpen(null);
                    }}
                  >
                    {t('phases.change')}
                  </Button>
                </div>
              ) : null}
            </PopoverContent>
          </Popover>
        </Fragment>
      ))}
    </nav>
  );
}
