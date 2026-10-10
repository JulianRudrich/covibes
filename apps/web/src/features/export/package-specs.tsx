import type { CodingPackageOverview } from '@covibes/shared';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { FieldError } from '@web/components/ui/input';
import { AgentAvatar } from '@web/features/agents/agent-avatar';
import { useAgents } from '@web/features/agents/agents';
import { formatUntil } from '@web/lib/format';

type PackageSpecsSectionProps = {
  milestones: CodingPackageOverview['milestoneSpecs'];
  /** Owners and editors have the specs written out; viewers see how far they are. */
  canEdit: boolean;
  /** The milestone whose run could not be asked for, if any. */
  problem: number | null;
  /** A request is on its way: no second one in the same moment. */
  busy: boolean;
  onWrite: (milestone: number) => void;
};

/**
 * The feature specs of the package by milestone (spec 27d; derived look): how many of a
 * milestone's specs are written out, "Ausarbeiten" to have the moderator write them, a note while
 * it does, and why a run gave nothing.
 */
export function PackageSpecsSection({
  milestones,
  canEdit,
  problem,
  busy,
  onWrite,
}: PackageSpecsSectionProps) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const moderator = useAgents()('moderator');

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 id={titleId} className="m-0 text-small font-medium text-text-2">
          {t('export.package.specs.title')}
        </h3>
        <p className="m-0 text-small leading-snug text-text-3">{t('export.package.specs.hint')}</p>
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {milestones.map((milestone) => {
          const { run } = milestone;
          const complete = milestone.tasks > 0 && milestone.written === milestone.tasks;
          return (
            <li
              key={milestone.number}
              className="flex flex-col gap-1 border-t border-border-soft py-2 first:border-t-0"
            >
              <div className="flex min-h-7 items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-ui text-text-body">
                    {milestone.title
                      ? t('export.package.specs.milestone', {
                          number: milestone.number,
                          title: milestone.title,
                        })
                      : t('export.package.specs.milestoneUntitled', { number: milestone.number })}
                  </span>
                  <span className="text-meta text-text-3">
                    {milestone.tasks > 0
                      ? t('export.package.specs.written', {
                          written: milestone.written,
                          count: milestone.tasks,
                        })
                      : t('export.package.specs.noTasks')}
                  </span>
                </div>
                {run?.status === 'running' ? (
                  <span
                    role="status"
                    className="flex shrink-0 items-center gap-1.5 text-small text-text-2"
                  >
                    <AgentAvatar agent={moderator} size={16} />
                    <span className="animate-pulse">{t('export.package.specs.running')}</span>
                  </span>
                ) : canEdit && milestone.tasks > 0 ? (
                  <Button
                    size="s"
                    variant={complete ? 'ghost' : 'secondary'}
                    className="shrink-0"
                    disabled={busy}
                    onClick={() => {
                      onWrite(milestone.number);
                    }}
                  >
                    {t(complete ? 'export.package.specs.rewrite' : 'export.package.specs.write')}
                  </Button>
                ) : null}
              </div>
              {run?.status === 'failed' ? (
                <FieldError>
                  {run.failure.kind === 'quota'
                    ? run.failure.resetsAt
                      ? t('export.package.suggestion.quotaUntil', {
                          time: formatUntil(run.failure.resetsAt, i18n.language),
                        })
                      : t('export.package.suggestion.quota')
                    : t('export.package.specs.failed')}
                </FieldError>
              ) : problem === milestone.number ? (
                <FieldError>{t('export.package.specs.failed')}</FieldError>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
