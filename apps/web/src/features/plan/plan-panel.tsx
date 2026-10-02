import type { AwarenessUser, PlanLanguage } from '@covibes/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { PanelHeader } from '@web/components/ui/panel';
import { PlanEditor } from '@web/features/plan/plan-editor';
import { PLAN_PANEL_ID } from '@web/features/plan/plan-ids';

type PlanPanelProps = {
  projectId: string;
  /** The board tabs of the header, with the plan's button (spec 11, spec 25a). */
  tabs: ReactNode;
  /** A short note, e.g. that the phase changed. */
  notice: string | null;
  user: AwarenessUser;
  readOnly: boolean;
  language: PlanLanguage;
};

/**
 * Header and plan of the project, as the two rows of the canvas panel (spec 25a): the plan takes
 * the place of the canvas while it is open, so the chat and the overview stay next to it.
 */
export function PlanPanel({ tabs, notice, ...plan }: PlanPanelProps) {
  const { t } = useTranslation();
  return (
    <>
      <PanelHeader className="gap-1 px-3">{tabs}</PanelHeader>

      <div
        id={PLAN_PANEL_ID}
        role="region"
        aria-label={t('plan.tab')}
        className="relative min-h-0 bg-bg-panel"
      >
        <PlanEditor {...plan} />
        {notice ? (
          <div
            role="status"
            className="absolute top-3 left-1/2 z-10 flex h-[26px] -translate-x-1/2 items-center rounded-[13px] bg-bg-panel px-3 text-status whitespace-nowrap text-text-body shadow-float"
          >
            {notice}
          </div>
        ) : null}
      </div>
    </>
  );
}
