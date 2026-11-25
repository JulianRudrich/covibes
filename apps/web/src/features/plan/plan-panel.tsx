import type { AwarenessUser, PlanLanguage, PlanState } from '@covibes/shared';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CanvasTabsRow } from '@web/features/canvas/board-tabs';
import { PlanExportMenu } from '@web/features/export/plan-export-menu';
import { PlanEditor, type PlanTaskAssignments } from '@web/features/plan/plan-editor';
import { PLAN_PANEL_ID } from '@web/features/plan/plan-ids';
import { PlanSuggestions } from '@web/features/plan/plan-suggestions';
import { PlanVersions } from '@web/features/plan/plan-versions';
import type { PlanDecision } from '@web/features/plan/queries';
import { RoadmapButton } from '@web/features/roadmap/roadmap-button';

type PlanPanelProps = {
  projectId: string;
  /** The board tabs of the header, with the plan's button (spec 11, spec 25a). */
  tabs: ReactNode;
  /** A short note, e.g. that the phase changed. */
  notice: string | null;
  user: AwarenessUser;
  readOnly: boolean;
  language: PlanLanguage;
  /** What the moderator has for the plan (spec 25b); undefined while it loads. */
  plan: PlanState | undefined;
  /** Owners and editors start a generation and decide the suggestions. */
  onGenerate?: () => void;
  onDecide?: (decision: PlanDecision) => void;
  /** Owners and editors bring an outdated plan up to date (spec 25c). */
  onUpdate?: () => void;
  /** Opens the roadmap on the canvas (spec 26a); busy while the server finds or adds it. */
  onOpenRoadmap: () => void;
  roadmapBusy: boolean;
  /** Who took which task of the plan (spec 26b); undefined until the roadmap is loaded. */
  tasks?: PlanTaskAssignments;
  decisionLinks?: { onOpenDecision: (id: string) => void };
  taskFocus?: string;
  onTaskFocused?: () => void;
  onTaskMissing?: () => void;
  /** The project's name, after which the exports of the plan are called (spec 27a). */
  projectName: string;
  onExportFailed: () => void;
};

/**
 * Header and plan of the project, as the two rows of the canvas panel (spec 25a): the plan takes
 * the place of the canvas while it is open, so the chat and the overview stay next to it.
 */
export function PlanPanel({
  tabs,
  notice,
  plan,
  onGenerate,
  onDecide,
  onUpdate,
  onOpenRoadmap,
  roadmapBusy,
  projectName,
  onExportFailed,
  ...editor
}: PlanPanelProps) {
  const { t } = useTranslation();
  // An export names who took a task; it has no avatars to show it.
  const assigneeNames = useMemo(
    () =>
      new Map(
        [...(editor.tasks?.assignees ?? [])].flatMap(([taskId, assignee]) =>
          assignee?.name ? [[taskId, assignee.name] as const] : [],
        ),
      ),
    [editor.tasks],
  );
  return (
    <>
      <CanvasTabsRow>{tabs}</CanvasTabsRow>

      <div
        id={PLAN_PANEL_ID}
        role="region"
        aria-label={t('plan.tab')}
        className="relative min-h-0 bg-bg-canvas"
      >
        <PlanEditor
          {...editor}
          above={(text) =>
            plan ? (
              <PlanSuggestions
                state={plan}
                language={editor.language}
                sections={text.sections}
                onDecide={onDecide}
                onUpdate={onUpdate}
              />
            ) : null
          }
          toolbarEnd={(text) => (
            <>
              <PlanVersions projectId={editor.projectId} current={text.nodes} />
              <RoadmapButton busy={roadmapBusy} onOpen={onOpenRoadmap} />
              <PlanExportMenu
                projectId={editor.projectId}
                projectName={projectName}
                language={editor.language}
                nodes={text.nodes}
                assignees={assigneeNames}
                outdated={Boolean(plan?.outdated)}
                onFailed={onExportFailed}
              />
            </>
          )}
          generation={
            onGenerate
              ? {
                  busy: plan === undefined || plan.generating || plan.suggestions.length > 0,
                  onGenerate,
                }
              : undefined
          }
        />
        {notice ? (
          <div
            role="status"
            className="absolute top-3 left-1/2 z-10 flex h-[26px] -translate-x-1/2 animate-pop items-center rounded-full bg-bg-panel px-3 text-status whitespace-nowrap text-text-body shadow-float"
          >
            {notice}
          </div>
        ) : null}
      </div>
    </>
  );
}
