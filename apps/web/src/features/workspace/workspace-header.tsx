import type { Phase } from '@covibes/shared';
import { useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  ChevronDown,
  Gauge,
  GitBranch,
  GitMerge,
  ScrollText,
  Settings2,
} from 'lucide-react';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { DialogLoading } from '@web/components/dialog-loading';
import { Logo } from '@web/components/logo';
import { Dialog } from '@web/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import type { SessionUser } from '@web/features/auth/session';
import { NotificationBell } from '@web/features/notifications/notification-bell';
import { PhaseIndicator } from '@web/features/workspace/phase-indicator';
import { Room } from '@web/features/workspace/room';
import { ThemeButton } from '@web/features/workspace/theme-button';
import {
  ProjectSettingsDialog,
  type ProjectSettings,
} from '@web/features/workspace/project-settings-dialog';
import type { WorkspaceMember, WorkspaceRepository } from '@web/features/workspace/workspace-shell';

const GitDialog = lazy(async () => ({
  default: (await import('@web/features/git/git-dialog')).GitDialog,
}));

const GitLogDialog = lazy(async () => ({
  default: (await import('@web/features/git/git-log-dialog')).GitLogDialog,
}));

const MergeRequestsDialog = lazy(async () => ({
  default: (await import('@web/features/git/merge-requests-dialog')).MergeRequestsDialog,
}));

const UsageDialog = lazy(async () => ({
  default: (await import('@web/features/usage/usage-dialog')).UsageDialog,
}));

type WorkspaceHeaderProps = {
  projectName: string;
  settings: ProjectSettings;
  repository: WorkspaceRepository;
  /** The menu offers the usage of the project (spec 31b): for owners. */
  showUsage?: boolean;
  activePhase: Phase;
  /** Jumping to a phase and asking for the next step (spec 24); missing for viewers. */
  onSelectPhase?: (phase: Phase) => void;
  onAskNextStep?: () => void;
  members: WorkspaceMember[];
  /** The members who have the open board open right now. */
  present: ReadonlySet<string>;
  user: SessionUser | null;
  /** The agents of the project (spec 14): their marks and the team popover. */
  team: ReactNode;
  /** "Teilen" with the share dialog (spec 21a). */
  share: ReactNode;
  layout?: ReactNode;
};

export function WorkspaceHeader({
  projectName,
  settings,
  repository,
  showUsage = false,
  activePhase,
  onSelectPhase,
  onAskNextStep,
  members,
  present,
  user,
  team,
  share,
  layout,
}: WorkspaceHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="studio-workspace-header grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 pr-4 pl-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <Logo />
        <span className="font-display text-[18px] font-bold tracking-[-0.025em]">
          {t('common.wordmark')}
        </span>
        <span aria-hidden="true" className="mx-0.5 text-text-3">
          /
        </span>
        <ProjectMenu
          projectName={projectName}
          settings={settings}
          repository={repository}
          showUsage={showUsage}
        />
      </div>

      <PhaseIndicator active={activePhase} onSelect={onSelectPhase} onAsk={onAskNextStep} />

      <div className="flex min-w-0 items-center justify-end gap-3">
        <Room members={members} present={present} user={user} team={team} />
        <div className="flex items-center gap-1">
          <NotificationBell />
          <ThemeButton />
        </div>
        {layout}
        {share}
      </div>
    </header>
  );
}

/**
 * The project name opens the project menu: back to the project list, the project settings
 * (spec 16b), which everyone sees and owners change, the repository, and for owners the usage
 * (spec 31b).
 */
function ProjectMenu({
  projectName,
  settings,
  repository,
  showUsage,
}: {
  projectName: string;
  settings: ProjectSettings;
  repository: WorkspaceRepository;
  showUsage: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Someone who comes back from GitLab lands in the dialog they left for it.
  const [repositoryOpen, setRepositoryOpen] = useState(
    repository.returned !== undefined || repository.githubReturned !== undefined,
  );
  const [logOpen, setLogOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  // "Ansehen" at a review under "Wartet auf dich" opens the merge requests with that review.
  const reviewId = repository.reviewId ?? null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${projectName}, ${t('workspace.projectMenu')}`}
          className="flex h-[34px] min-w-0 cursor-pointer items-center gap-1.5 rounded-full pr-2.5 pl-3 font-semibold whitespace-nowrap text-text transition-colors hover:bg-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
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
            <ArrowLeft size={15} aria-hidden="true" />
            {t('workspace.toProjects')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setSettingsOpen(true);
            }}
          >
            <Settings2 size={15} aria-hidden="true" />
            {t('workspace.settings')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setRepositoryOpen(true);
            }}
          >
            <GitBranch size={15} aria-hidden="true" />
            {t('workspace.repository')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setMergeOpen(true);
            }}
          >
            <GitMerge size={15} aria-hidden="true" />
            {t('workspace.mergeRequests')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setLogOpen(true);
            }}
          >
            <ScrollText size={15} aria-hidden="true" />
            {t('workspace.gitLog')}
          </DropdownMenuItem>
          {showUsage ? (
            <DropdownMenuItem
              onSelect={() => {
                setUsageOpen(true);
              }}
            >
              <Gauge size={15} aria-hidden="true" />
              {t('workspace.usage')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        {settingsOpen ? <ProjectSettingsDialog settings={settings} /> : null}
      </Dialog>
      <Dialog
        open={repositoryOpen}
        onOpenChange={(open) => {
          setRepositoryOpen(open);
          if (
            !open &&
            (repository.returned !== undefined || repository.githubReturned !== undefined)
          )
            repository.onReturnSeen();
        }}
      >
        {repositoryOpen ? (
          <Suspense fallback={<DialogLoading />}>
            <GitDialog
              projectId={repository.projectId}
              returned={repository.returned}
              githubReturned={repository.githubReturned}
            />
          </Suspense>
        ) : null}
      </Dialog>
      <Dialog
        open={mergeOpen || reviewId !== null}
        onOpenChange={(open) => {
          setMergeOpen(open);
          if (!open) repository.onReviewClosed?.();
        }}
      >
        {/* Mounted only while open: the merge requests are read from the repository then. */}
        {mergeOpen || reviewId !== null ? (
          <Suspense fallback={<DialogLoading />}>
            <MergeRequestsDialog
              // Another review is another view of the dialog.
              key={reviewId ?? 'list'}
              projectId={repository.projectId}
              reviewId={reviewId}
            />
          </Suspense>
        ) : null}
      </Dialog>
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        {/* Mounted only while open: the log is loaded then. */}
        {logOpen ? (
          <Suspense fallback={<DialogLoading />}>
            <GitLogDialog projectId={repository.projectId} />
          </Suspense>
        ) : null}
      </Dialog>
      <Dialog open={usageOpen} onOpenChange={setUsageOpen}>
        {/* Mounted only while open: the usage is loaded then. */}
        {usageOpen ? (
          <Suspense fallback={<DialogLoading />}>
            <UsageDialog projectId={repository.projectId} />
          </Suspense>
        ) : null}
      </Dialog>
    </>
  );
}
