import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@web/components/ui/avatar';
import { Tooltip } from '@web/components/ui/tooltip';
import { AccountMenu } from '@web/features/account/account-menu';
import type { SessionUser } from '@web/features/auth/session';
import type { WorkspaceMember } from '@web/features/workspace/workspace-shell';
import { initialsOf } from '@web/lib/format';

type RoomProps = {
  /** The signed-in user first. */
  members: readonly WorkspaceMember[];
  /** The members who have the open board open right now. */
  present: ReadonlySet<string>;
  user: SessionUser | null;
  /** The agents of the team with their popover (spec 14). */
  team: ReactNode;
};

/**
 * "Im Raum" in the top bar (handoff): the people of the project as overlapping circles, a green
 * dot on whoever else is on the open board, and the agents of the team as their marks. The own
 * circle opens the account menu, the marks open the team.
 */
export function Room({ members, present, user, team }: RoomProps) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t('workspace.inRoom')}
      className="flex h-11 min-w-0 items-center gap-3 rounded-full bg-bg-panel pr-3 pl-2 shadow-panel"
    >
      <div role="group" aria-label={t('workspace.humansLabel')} className="flex items-center">
        {members.map((member, index) => {
          const name = member.isCurrentUser ? t('common.you') : member.name;
          const here = !member.isCurrentUser && present.has(member.id);
          const label = here ? t('workspace.onBoard', { name }) : name;
          const avatar = (
            <span className="relative flex rounded-full ring-[2.5px] ring-bg-panel">
              <Avatar
                kind="human"
                size={30}
                label={label}
                initials={member.isCurrentUser ? t('common.you') : initialsOf(member.name)}
              />
              {here ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-px -bottom-px size-[9px] rounded-full bg-success ring-2 ring-bg-panel"
                />
              ) : null}
            </span>
          );
          return (
            <Tooltip key={member.id} content={label}>
              <span className={index > 0 ? '-ml-2 flex' : 'flex'}>
                {member.isCurrentUser && user ? (
                  <AccountMenu user={user}>{avatar}</AccountMenu>
                ) : (
                  avatar
                )}
              </span>
            </Tooltip>
          );
        })}
      </div>
      <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
      <div role="group" aria-label={t('workspace.agentsLabel')} className="flex items-center">
        {team}
      </div>
    </div>
  );
}
