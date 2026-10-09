import type { Phase } from '@covibes/shared';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Logo } from '@web/components/logo';
import { Avatar } from '@web/components/ui/avatar';
import { Dialog } from '@web/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import { Tooltip } from '@web/components/ui/tooltip';
import { AccountMenu } from '@web/features/account/account-menu';
import { GitDialog } from '@web/features/git/git-dialog';
import { GitLogDialog } from '@web/features/git/git-log-dialog';
import { MergeRequestsDialog } from '@web/features/git/merge-requests-dialog';
import type { SessionUser } from '@web/features/auth/session';
import { NotificationBell } from '@web/features/notifications/notification-bell';
import { PhaseIndicator } from '@web/features/workspace/phase-indicator';
import {
  ProjectSettingsDialog,
  type ProjectSettings,
} from '@web/features/workspace/project-settings-dialog';
import type { WorkspaceMember, WorkspaceRepository } from '@web/features/workspace/workspace-shell';
import { initialsOf } from '@web/lib/format';

type WorkspaceHeaderProps = {
  projectName: string;
  settings: ProjectSettings;
  repository: WorkspaceRepository;
  activePhase: Phase;
  /** Jumping to a phase and asking for the next step (spec 24); missing for viewers. */
  onSelectPhase?: (phase: Phase) => void;
  onAskNextStep?: () => void;
  members: WorkspaceMember[];
  user: SessionUser | null;
  /** The agents of the project (spec 14): their avatars and the team popover. */
  team: ReactNode;
  /** "Teilen" with the share dialog (spec 21a). */
  share: ReactNode;
};

export function WorkspaceHeader({
  projectName,
  settings,
  repository,
  activePhase,
  onSelectPhase,
  onAskNextStep,
  members,
  user,
  team,
  share,
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
        <ProjectMenu projectName={projectName} settings={settings} repository={repository} />
      </div>

      <div className="justify-self-center">
        <PhaseIndicator active={activePhase} onSelect={onSelectPhase} onAsk={onAskNextStep} />
      </div>

      <div className="flex items-center justify-end gap-2.5 pr-1">
        <NotificationBell />
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
        <div role="group" aria-label={t('workspace.agentsLabel')} className="flex items-center">
          {team}
        </div>
        {share}
      </div>
    </header>
  );
}

/**
 * The project name opens the project menu: back to the project list, and the project settings
 * (spec 16b), which everyone sees and owners change.
 */
function ProjectMenu({
  projectName,
  settings,
  repository,
}: {
  projectName: string;
  settings: ProjectSettings;
  repository: WorkspaceRepository;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Someone who comes back from GitLab lands in the dialog they left for it.
  const [repositoryOpen, setRepositoryOpen] = useState(repository.returned !== undefined);
  const [logOpen, setLogOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  return (
    <>
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
            onSelect={() => {
              setSettingsOpen(true);
            }}
          >
            {t('workspace.settings')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setRepositoryOpen(true);
            }}
          >
            {t('workspace.repository')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setMergeOpen(true);
            }}
          >
            {t('workspace.mergeRequests')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setLogOpen(true);
            }}
          >
            {t('workspace.gitLog')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        {settingsOpen ? <ProjectSettingsDialog settings={settings} /> : null}
      </Dialog>
      <Dialog
        open={repositoryOpen}
        onOpenChange={(open) => {
          setRepositoryOpen(open);
          if (!open && repository.returned !== undefined) repository.onReturnSeen();
        }}
      >
        {repositoryOpen ? (
          <GitDialog projectId={repository.projectId} returned={repository.returned} />
        ) : null}
      </Dialog>
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        {/* Mounted only while open: the merge requests are read from the repository then. */}
        {mergeOpen ? <MergeRequestsDialog projectId={repository.projectId} /> : null}
      </Dialog>
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        {/* Mounted only while open: the log is loaded then. */}
        {logOpen ? <GitLogDialog projectId={repository.projectId} /> : null}
      </Dialog>
    </>
  );
}
