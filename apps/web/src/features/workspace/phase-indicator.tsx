import { nextPhase, phaseStatuses, PHASES, type Phase } from '@covibes/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { PhaseSegment } from '@web/components/ui/phase-segments';
import { Popover, PopoverContent, PopoverTrigger } from '@web/components/ui/popover';

type PhaseIndicatorProps = {
  active: Phase;
  /** Owners and editors jump to another phase (spec 24); without it the phases are only read. */
  onSelect?: (phase: Phase) => void;
  /** Asks the moderator in the chat where the project stands and what comes next. */
  onAsk?: () => void;
};

/**
 * The phase bar of the top bar (handoff "Phase bar"): the step, the name of the current phase,
 * a segment per phase and what comes next. Every segment opens a card that says what its phase is
 * for (spec 24; derived look). From there owners and editors change to the phase, and in the
 * current one they ask the moderator for the next step.
 */
export function PhaseIndicator({ active, onSelect, onAsk }: PhaseIndicatorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Phase | null>(null);
  const next = nextPhase(active);

  return (
    <nav
      aria-label={t('workspace.phasesLabel')}
      className="flex h-11 items-center gap-3.5 rounded-full bg-bg-panel pr-[18px] pl-4 whitespace-nowrap shadow-panel"
    >
      <span className="text-small text-text-3 tabular-nums">
        {t('workspace.step', { step: PHASES.indexOf(active) + 1, total: PHASES.length })}
      </span>
      <span className="font-display text-display font-semibold tracking-[-0.01em] text-text">
        {t(`phases.${active}`)}
      </span>
      <span className="-mx-1 flex">
        {phaseStatuses(active).map(({ phase, status }) => (
          <Popover
            key={phase}
            open={open === phase}
            onOpenChange={(isOpen) => {
              setOpen(isOpen ? phase : null);
            }}
          >
            <PopoverTrigger
              aria-label={`${t(`phases.${phase}`)}: ${t(`phases.status.${status}`)}`}
              aria-current={status === 'active' ? 'step' : undefined}
              title={t(`phases.${phase}`)}
              // A 6 px segment in a target large enough to hit.
              className="group grid h-7 w-[34px] cursor-pointer place-items-center rounded-full hover:bg-wash focus-visible:outline-2 focus-visible:outline-ink"
            >
              <PhaseSegment status={status} className="w-[30px]" />
            </PopoverTrigger>
            <PopoverContent
              align="center"
              aria-label={t(`phases.${phase}`)}
              className="flex w-[280px] flex-col gap-2 p-3.5 whitespace-normal"
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
        ))}
      </span>
      {/* The last phase has nothing after it. */}
      {next ? (
        <span className="text-small text-text-3">
          {t('workspace.next', { phase: t(`phases.${next}`) })}
        </span>
      ) : null}
    </nav>
  );
}
