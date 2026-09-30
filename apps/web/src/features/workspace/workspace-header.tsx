import type { Phase } from '@covibes/shared';
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Logo } from '@web/components/logo';
import { Avatar } from '@web/components/ui/avatar';
import { Button } from '@web/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import { Tooltip } from '@web/components/ui/tooltip';
import { AccountMenu } from '@web/features/account/account-menu';
import type { SessionUser } from '@web/features/auth/session';
import { DEMO_AGENTS } from '@web/features/workspace/demo-workspace';
import { PhaseIndicator } from '@web/features/workspace/phase-indicator';
import type { ProjectSettings, WorkspaceMember } from '@web/features/workspace/workspace-shell';
import { initialsOf } from '@web/lib/format';

type WorkspaceHeaderProps = {
  projectName: string;
  settings: ProjectSettings;
  activePhase: Phase;
  members: WorkspaceMember[];
  user: SessionUser | null;
};

export function WorkspaceHeader({
  projectName,
  settings,
  activePhase,
  members,
  user,
}: WorkspaceHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="grid grid-cols-[380px_minmax(0,1fr)_300px] items-center gap-2 px-2">
      <div className="flex min-w-0 items-center gap-2.5 pl-2">
        <Logo />
        <span className="text-display font-semibold tracking-[-0.02em]">
          {t('common.wordmark')}
        </span>
        <span aria-hidden="true" className="text-display text-text-faint">
          /
        </span>
        <ProjectMenu projectName={projectName} settings={settings} />
      </div>

      <div className="justify-self-center">
        <PhaseIndicator active={activePhase} />
      </div>

      <div className="flex items-center justify-end gap-2.5 pr-1">
        <div role="group" aria-label={t('workspace.humansLabel')} className="flex items-center">
          {members.map((member, index) => {
            const name = member.isCurrentUser ? t('common.you') : member.name;
            const avatar = (
              <Avatar
                kind="human"
                tone="strong"
                size={26}
                label={name}
                initials={member.isCurrentUser ? t('common.you') : initialsOf(member.name)}
                className="border-2 border-bg-app"
              />
            );
            return (
              <Tooltip key={member.id} content={name}>
                <span className={index > 0 ? '-ml-1.5' : undefined}>
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
        <span aria-hidden="true" className="h-5 w-px bg-divider-strong" />
        <div
          role="group"
          aria-label={t('workspace.agentsLabel')}
          className="flex items-center gap-[3px]"
        >
          {DEMO_AGENTS.map((agent) => (
            <Tooltip key={agent.key} content={t(`agents.${agent.key}`)}>
              <span>
                <Avatar
                  kind="agent"
                  agent={agent.key}
                  size={24}
                  label={t(`agents.${agent.key}`)}
                  initials={agent.initials}
                />
              </span>
            </Tooltip>
          ))}
        </div>
        <Button variant="primary" className="px-3.5">
          {t('common.share')}
        </Button>
      </div>
    </header>
  );
}

/**
 * The project name opens the project menu: back to the project list, and the proposals-only mode
 * (spec 13), which only owners switch until the project settings exist (spec 16).
 */
function ProjectMenu({
  projectName,
  settings,
}: {
  projectName: string;
  settings: ProjectSettings;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${projectName}, ${t('workspace.projectMenu')}`}
        className="flex h-[30px] min-w-0 cursor-pointer items-center gap-1.5 rounded-btn-s px-2 text-ui font-medium whitespace-nowrap text-text hover:bg-bg-hover-app focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <span className="truncate">{projectName}</span>
        <ChevronDown size={14} className="shrink-0 text-text-3" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          onSelect={() => {
            void navigate({ to: '/' });
          }}
        >
          {t('workspace.toProjects')}
        </DropdownMenuItem>
        <DropdownMenuItem
          role="menuitemcheckbox"
          aria-checked={settings.proposalsOnly}
          disabled={!settings.canChange}
          className="data-disabled:cursor-default data-disabled:opacity-60"
          onSelect={() => {
            settings.onProposalsOnlyChange(!settings.proposalsOnly);
          }}
        >
          {t('workspace.proposalsOnly')}
          {settings.proposalsOnly ? (
            <Check size={14} strokeWidth={2} className="ml-auto text-text-2" aria-hidden="true" />
          ) : null}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
