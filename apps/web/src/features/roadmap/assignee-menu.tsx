import { NO_USER_ID, type RoadmapAssignee, type RoadmapTask } from '@covibes/shared';
import { Check, UserRoundPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@web/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import type { TaskAssigning } from '@web/features/roadmap/roadmap-context';
import { cn } from '@web/lib/cn';
import { initialsOf } from '@web/lib/format';

/** The read-only view names nobody: a person there is a team member with a dot. */
function useAssigneeLook() {
  const { t } = useTranslation();
  return (assignee: RoadmapAssignee) =>
    assignee.userId === NO_USER_ID || assignee.name === ''
      ? { name: t('shareView.teamMember'), initials: '·' }
      : { name: assignee.name, initials: initialsOf(assignee.name) };
}

/**
 * The choices of who takes a task (spec 26b; derived looks), for a dropdown menu: the members with
 * a check at the current assignee, then "Niemand".
 */
export function AssigneeItems({
  current,
  assigning,
  onDone,
}: {
  current: RoadmapAssignee | null;
  assigning: TaskAssigning;
  onDone: (assignee: RoadmapAssignee | null) => void;
}) {
  const { t } = useTranslation();
  const check = (
    <Check size={14} strokeWidth={2} className="ml-auto text-text-2" aria-hidden="true" />
  );
  return (
    <>
      <DropdownMenuLabel>{t('roadmap.assign.title')}</DropdownMenuLabel>
      {assigning.members.map((member) => (
        <DropdownMenuItem
          key={member.userId}
          onSelect={() => {
            onDone(member);
          }}
        >
          {/* The name follows; the avatar adds nothing to hear. */}
          <span aria-hidden="true">
            <Avatar kind="human" size={16} label={member.name} initials={initialsOf(member.name)} />
          </span>
          <span className="truncate">{member.name}</span>
          {member.userId === current?.userId ? check : null}
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem
        className="text-text-2"
        onSelect={() => {
          onDone(null);
        }}
      >
        {t('roadmap.assign.nobody')}
        {current === null ? check : null}
      </DropdownMenuItem>
    </>
  );
}

/**
 * Who took a task of the roadmap, at the right end of its card (spec 26b; derived looks): the
 * assignee's avatar, or for owners and editors a faint button to assign. A task the server has
 * given no id yet cannot be assigned; it shows nothing until then.
 */
export function TaskAssignee({
  task,
  assigning,
}: {
  task: RoadmapTask;
  assigning: TaskAssigning | undefined;
}) {
  const { t } = useTranslation();
  const look = useAssigneeLook();
  const { id, assignee } = task;
  const shown = assignee ? look(assignee) : null;
  const avatar = shown ? (
    <Avatar
      kind="human"
      size={24}
      label={t('roadmap.assign.assignedTo', { name: shown.name })}
      initials={shown.initials}
    />
  ) : null;

  if (!assigning || id === null) {
    return avatar ? <span title={shown?.name}>{avatar}</span> : null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={
          shown
            ? t('roadmap.assign.change', { task: task.text, name: shown.name })
            : t('roadmap.assign.open', { task: task.text })
        }
        title={shown?.name}
        className={cn(
          'nodrag nopan grid size-6 shrink-0 cursor-pointer place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
          !shown &&
            'border border-dashed border-border-strong text-text-4 hover:border-text-3 hover:text-text-2',
        )}
      >
        {avatar ?? <UserRoundPlus size={12} strokeWidth={2} aria-hidden="true" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        <AssigneeItems
          current={assignee}
          assigning={assigning}
          onDone={(next) => {
            if (next?.userId !== assignee?.userId) assigning.onAssign(id, next);
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
