import {
  ROADMAP,
  roadmapLayout,
  roadmapWeeks,
  type Roadmap,
  type RoadmapColumn,
} from '@covibes/shared';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { TaskAssignee } from '@web/features/roadmap/assignee-menu';
import { useRoadmap, useRoadmapSource } from '@web/features/roadmap/roadmap-context';
import { cn } from '@web/lib/cn';

/** "Roadmap · 4 Meilensteine · 13 Wochen" in the header of a roadmap frame (spec 26a). */
export function RoadmapSummary() {
  const { t } = useTranslation();
  const roadmap = useRoadmap();
  const type = t('canvas.diagramTypes.roadmap');
  if (!roadmap) return type;
  const weeks = roadmapWeeks(roadmap);
  return [
    type,
    t('roadmap.summary', { count: roadmap.milestones.length }),
    ...(weeks === null ? [] : [t('roadmap.weeks', { count: weeks })]),
  ].join(' · ');
}

/** The content of a roadmap frame, with the roadmap from where the canvas gets it. */
export function RoadmapFrameContent() {
  return <RoadmapContent roadmap={useRoadmap()} />;
}

/**
 * What a roadmap frame shows below its title (spec 26a; derived looks): a scale in weeks when
 * every milestone has a time, then one column per milestone with its number, name, time, goal and
 * tasks. Everything stands where `roadmapLayout` puts it, so the frame's size fits without
 * measuring.
 */
export function RoadmapContent({ roadmap }: { roadmap: Roadmap | undefined }) {
  const { t } = useTranslation();
  if (!roadmap) {
    return (
      <p
        className="absolute right-3.5 left-3.5 m-0 text-ui text-text-3"
        style={{ top: ROADMAP.top }}
      >
        {t('roadmap.loading')}
      </p>
    );
  }
  if (roadmap.milestones.length === 0) return <EmptyRoadmap />;

  const layout = roadmapLayout(roadmap);
  const { scale } = layout;
  const last = layout.columns.at(-1);
  const right = last ? last.x + last.width : ROADMAP.side;
  return (
    <>
      {scale ? (
        <div
          aria-hidden="true"
          className="absolute border-b border-border"
          style={{
            top: ROADMAP.top,
            left: ROADMAP.side,
            width: right - ROADMAP.side,
            height: ROADMAP.scale,
          }}
        >
          {Array.from({ length: scale.weeks }, (_, index) => (
            <span
              key={index}
              className="absolute top-0 border-l border-border pl-1 text-meta leading-[18px] text-text-3"
              style={{ left: index * scale.week, width: scale.week, height: ROADMAP.scale }}
            >
              {t('roadmap.week', { week: index + 1 })}
            </span>
          ))}
        </div>
      ) : null}
      <ol
        aria-label={t('roadmap.label', { count: roadmap.milestones.length })}
        className="absolute m-0 flex list-none overflow-hidden rounded-card border border-border bg-bg-panel p-0"
        // The border comes on top of the columns' height.
        style={{ top: layout.top, left: ROADMAP.side, height: layout.columnHeight + 2 }}
      >
        {roadmap.milestones.map((milestone, index) => {
          const column = layout.columns[index];
          if (!column) return null;
          return (
            <Milestone
              key={milestone.number}
              milestone={milestone}
              column={column}
              first={index === 0}
              hasGoals={layout.hasGoals}
            />
          );
        })}
      </ol>
    </>
  );
}

function Milestone({
  milestone,
  column,
  first,
  hasGoals,
}: {
  milestone: Roadmap['milestones'][number];
  column: RoadmapColumn;
  first: boolean;
  hasGoals: boolean;
}) {
  const { t } = useTranslation();
  const { assigning } = useRoadmapSource();
  const time = milestone.duration
    ? [
        milestone.duration.text,
        column.weeks
          ? column.weeks.from === column.weeks.to
            ? t('roadmap.week', { week: column.weeks.from })
            : t('roadmap.span', column.weeks)
          : null,
      ]
        .filter((part) => part)
        .join(' · ')
    : t('roadmap.noTime');
  const name = t('roadmap.milestone', { number: milestone.number, title: milestone.title });

  return (
    <li
      aria-label={name}
      className={cn('flex shrink-0 flex-col', !first && 'border-l border-dashed border-border')}
      style={{ width: column.width, padding: ROADMAP.padding }}
    >
      <div className="flex items-center gap-2" style={{ height: ROADMAP.title }}>
        <span
          aria-hidden="true"
          className="grid size-5 shrink-0 place-items-center rounded-xs bg-ink text-meta font-semibold text-on-ink"
        >
          {milestone.number}
        </span>
        <span title={milestone.title} className="truncate text-ui font-semibold text-text">
          {milestone.title}
        </span>
      </div>
      <span
        className="truncate text-meta text-text-3"
        style={{ height: ROADMAP.meta, lineHeight: `${String(ROADMAP.meta)}px` }}
      >
        {time}
      </span>
      {hasGoals ? (
        <p
          title={milestone.goal || undefined}
          className="m-0 line-clamp-2 text-small leading-snug text-text-2"
          style={{ height: ROADMAP.goal, marginTop: ROADMAP.blockGap }}
        >
          {milestone.goal}
        </p>
      ) : null}
      {column.shownTasks > 0 ? (
        <ul
          aria-label={t('roadmap.tasks')}
          className="m-0 flex list-none flex-col p-0"
          style={{ gap: ROADMAP.taskGap, marginTop: ROADMAP.blockGap }}
        >
          {milestone.tasks.slice(0, column.shownTasks).map((task, index) => (
            // A task gets its id from the server a moment after it was written; until then only
            // its place tells it apart.
            <li
              key={task.id ?? index}
              className="flex items-center gap-1.5 rounded-md border border-border bg-bg-panel py-1.5 pr-1.5 pl-2"
              style={{ height: ROADMAP.task }}
            >
              <span
                title={task.text}
                className="line-clamp-2 min-w-0 flex-1 text-small leading-snug text-text-body"
              >
                {task.text}
              </span>
              <TaskAssignee task={task} assigning={assigning} />
            </li>
          ))}
        </ul>
      ) : null}
      {column.moreTasks > 0 ? (
        <span
          className="text-meta text-text-3"
          style={{
            height: ROADMAP.more,
            lineHeight: `${String(ROADMAP.more)}px`,
            marginTop: ROADMAP.taskGap,
          }}
        >
          {t('roadmap.more', { count: column.moreTasks })}
        </span>
      ) : null}
    </li>
  );
}

function EmptyRoadmap() {
  const { t } = useTranslation();
  const { onOpenPlan } = useRoadmapSource();
  return (
    <div
      className="absolute flex flex-col items-start gap-2"
      style={{ top: ROADMAP.top, left: ROADMAP.side, right: ROADMAP.side }}
    >
      <p className="m-0 text-ui font-semibold text-text">{t('roadmap.emptyTitle')}</p>
      <p className="m-0 text-small leading-snug text-text-2">{t('roadmap.emptyText')}</p>
      {onOpenPlan ? (
        <Button size="s" className="nodrag mt-1" onClick={onOpenPlan}>
          {t('roadmap.openPlan')}
        </Button>
      ) : null}
    </div>
  );
}
