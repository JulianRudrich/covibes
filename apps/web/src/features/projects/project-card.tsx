import {
  isAgentKey,
  phaseStatuses,
  PHASES,
  type ProjectCardAgent,
  type ProjectSummary,
} from '@covibes/shared';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { CATALOG_MARKS, customMark } from '@web/components/ui/agent-marks';
import { Avatar } from '@web/components/ui/avatar';
import { PhaseSegment } from '@web/components/ui/phase-segments';
import { UNKNOWN_AGENT_COLOR } from '@web/features/agents/agents';
import { cn } from '@web/lib/cn';
import { formatRelativeTime, initialsOf } from '@web/lib/format';
import { ProjectLifecycleDialog } from '@web/features/workspaces/project-lifecycle-dialog';

/** How many people and agents a card shows before "+N". */
const MAX_PEOPLE = 4;
const MAX_AGENTS = 5;

/** Overlapping avatars on the panel: a 2 px ring in the panel color sets them apart. */
const STACKED = 'ring-2 ring-bg-panel';

function AgentMark({ agent, first }: { agent: ProjectCardAgent; first: boolean }) {
  const { t } = useTranslation();
  const className = cn(STACKED, !first && '-ml-[5px]');
  if (isAgentKey(agent.key)) {
    return (
      <Avatar
        kind="agent"
        agent={agent.key}
        mark={CATALOG_MARKS[agent.key]}
        size={26}
        label={t(`agents.${agent.key}`)}
        className={className}
      />
    );
  }
  return (
    <Avatar
      kind="agent"
      agent="custom"
      mark={customMark(agent.key, agent.custom?.mark)}
      size={26}
      label={agent.custom?.name ?? t('agents.unknown')}
      className={cn(className, `agent-color-${String(agent.custom?.color ?? UNKNOWN_AGENT_COLOR)}`)}
    />
  );
}

/** The "+N" after the avatars a card leaves out. */
function More({ count, round }: { count: number; round: boolean }) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return (
    <span
      role="img"
      aria-label={t('projects.moreLabel', { count })}
      className={cn(
        'grid size-[26px] shrink-0 place-items-center bg-human-avatar-bg text-[10px] font-semibold text-human-avatar-fg tabular-nums',
        STACKED,
        round ? '-ml-1.5 rounded-full' : '-ml-[5px] rounded-[8px]',
      )}
    >
      <span aria-hidden="true">{t('projects.more', { count })}</span>
    </span>
  );
}

/**
 * The card of a project in the list (spec 36c, draft F): name, role and last change, what waits for
 * the person, the phase with its four segments, and the people and agents of the team.
 */
export function ProjectCard({ project, userId }: { project: ProjectSummary; userId?: string }) {
  const { t, i18n } = useTranslation();
  const people = project.members.slice(0, MAX_PEOPLE);
  const agents = project.agents.slice(0, MAX_AGENTS);
  return (
    <li className="flex flex-col gap-2">
      <Link
        to="/p/$projectId"
        params={{ projectId: project.id }}
        className="flex w-full flex-1 flex-col gap-[18px] rounded-surface bg-bg-panel p-5 text-text no-underline shadow-panel transition-[translate,box-shadow] duration-200 hover:-translate-y-0.5 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink motion-reduce:transition-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="m-0 truncate font-display text-[19px] font-semibold tracking-[-0.015em]">
              {project.name}
            </h2>
            <p className="mt-1 mb-0 truncate text-small text-text-3">
              {t(`projects.roles.${project.role}`)} ·{' '}
              {t('projects.updated', {
                time: formatRelativeTime(project.updatedAt, i18n.language),
              })}
            </p>
          </div>
          {project.waiting > 0 ? (
            <span className="flex h-6 shrink-0 items-center rounded-full bg-ink px-2.5 text-status font-semibold whitespace-nowrap text-on-ink tabular-nums">
              {t('projects.waiting', { count: project.waiting })}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2 text-small">
            <span className="font-semibold">{t(`phases.${project.phase}`)}</span>
            <span className="text-text-3 tabular-nums">
              {t('projects.step', {
                step: PHASES.indexOf(project.phase) + 1,
                total: PHASES.length,
              })}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {phaseStatuses(project.phase).map(({ phase, status }) => (
              <PhaseSegment key={phase} status={status} />
            ))}
          </div>
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-border pt-3.5">
          <span role="group" aria-label={t('projects.people')} className="flex items-center">
            {people.map((member, index) => {
              const you = member.userId === userId;
              return (
                <Avatar
                  key={member.userId}
                  kind="human"
                  size={26}
                  label={you ? t('projects.you') : member.name}
                  initials={you ? t('projects.you') : initialsOf(member.name)}
                  className={cn(STACKED, index > 0 && '-ml-1.5')}
                />
              );
            })}
            <More count={project.members.length - people.length} round />
          </span>
          <span role="group" aria-label={t('projects.team')} className="flex items-center">
            {agents.map((agent, index) => (
              <AgentMark key={agent.key} agent={agent} first={index === 0} />
            ))}
            <More count={project.agents.length - agents.length} round={false} />
          </span>
        </div>
      </Link>
      {project.role === 'owner' ? (
        <div className="self-end">
          <ProjectLifecycleDialog project={project} />
        </div>
      ) : null}
    </li>
  );
}
