import { diffPlan, type PlanNode, type PlanVersion } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@web/components/ui/dialog';
import { PlanContent } from '@web/features/plan/plan-content';
import { PlanDiffView } from '@web/features/plan/plan-diff-view';
import { planVersionQuery, planVersionsQuery } from '@web/features/plan/queries';
import { cn } from '@web/lib/cn';
import { formatRelativeTime } from '@web/lib/format';

type PlanVersionsProps = {
  projectId: string;
  /** The plan as it stands, to compare a version with. */
  current: readonly PlanNode[];
};

/** What the dialog shows of a version: its text, or what differs from another state. */
type View = 'text' | 'current' | 'previous';

/**
 * "Versionen" in the plan (spec 25c; derived looks): the versions that were kept, newest first.
 * A version is read as it stood, or compared with the plan as it stands or with the version
 * before it. Versions are for reading; text is taken back by copying it.
 */
export function PlanVersions({ projectId, current }: PlanVersionsProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="s"
        onClick={() => {
          setOpen(true);
        }}
      >
        <History size={14} strokeWidth={2} aria-hidden="true" />
        {t('plan.versions.button')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? <VersionsDialog projectId={projectId} current={current} /> : null}
      </Dialog>
    </>
  );
}

function VersionsDialog({ projectId, current }: PlanVersionsProps) {
  const { t, i18n } = useTranslation();
  const versions = useQuery(planVersionsQuery(projectId)).data;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>('current');
  // The newest version until another one is chosen.
  const selected = versions?.find((version) => version.id === selectedId) ?? versions?.[0];
  const previous = selected
    ? versions?.find((version) => version.number === selected.number - 1)
    : undefined;
  const shown: View = view === 'previous' && !previous ? 'current' : view;
  const content = useQuery({
    ...planVersionQuery(projectId, selected?.id ?? ''),
    enabled: selected !== undefined,
  }).data;
  const before = useQuery({
    ...planVersionQuery(projectId, previous?.id ?? ''),
    enabled: shown === 'previous' && previous !== undefined,
  }).data;

  const when = (version: PlanVersion) =>
    [formatRelativeTime(version.createdAt, i18n.language), version.createdBy]
      .filter((part) => part)
      .join(' · ');

  return (
    <DialogContent title={t('plan.versions.title')} className="w-[min(880px,calc(100vw-32px))]">
      {versions === undefined ? (
        <p className="m-0 text-ui text-text-3">{t('common.loading')}</p>
      ) : versions.length === 0 ? (
        <p className="m-0 text-ui text-text-3">{t('plan.versions.empty')}</p>
      ) : (
        <div className="grid h-[min(62vh,560px)] grid-cols-[220px_minmax(0,1fr)] gap-4">
          <ul
            aria-label={t('plan.versions.list')}
            className="m-0 flex list-none flex-col gap-1 overflow-y-auto p-0 pr-1"
          >
            {versions.map((version) => {
              const active = version.id === selected?.id;
              return (
                <li key={version.id}>
                  <button
                    type="button"
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-ink',
                      active ? 'bg-bg-subtle' : 'hover:bg-bg-subtle',
                    )}
                    onClick={() => {
                      setSelectedId(version.id);
                    }}
                  >
                    <span className="text-ui font-semibold text-text">
                      {t('plan.versions.number', { number: version.number })}
                    </span>
                    <span className="text-small text-text-2">
                      {t(`plan.versions.reason.${version.reason}`)}
                    </span>
                    <span className="text-meta text-text-3">{when(version)}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex min-h-0 flex-col gap-3">
            <div
              role="group"
              aria-label={t('plan.versions.show')}
              className="flex flex-wrap gap-1.5"
            >
              {(['current', 'previous', 'text'] as const).map((option) =>
                option === 'previous' && !previous ? null : (
                  <Button
                    key={option}
                    size="s"
                    variant={shown === option ? 'secondary' : 'ghost'}
                    aria-pressed={shown === option}
                    onClick={() => {
                      setView(option);
                    }}
                  >
                    {t(`plan.versions.view.${option}`, { number: previous?.number ?? 0 })}
                  </Button>
                ),
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-card border border-border p-4">
              {content === undefined || (shown === 'previous' && before === undefined) ? (
                <p className="m-0 text-ui text-text-3">{t('plan.versions.loading')}</p>
              ) : shown === 'text' ? (
                <PlanContent nodes={content.content} />
              ) : shown === 'previous' ? (
                // A comparison of its own: what was unfolded in another one stays there.
                <PlanDiffView
                  key={`previous:${content.id}`}
                  lines={diffPlan(before?.content ?? [], content.content)}
                />
              ) : (
                <PlanDiffView
                  key={`current:${content.id}`}
                  lines={diffPlan(content.content, current)}
                />
              )}
            </div>
          </div>
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <DialogClose asChild>
          <Button variant="primary">{t('common.close')}</Button>
        </DialogClose>
      </div>
    </DialogContent>
  );
}
