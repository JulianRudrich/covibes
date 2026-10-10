import type { GitReturn, Phase } from '@covibes/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Panel, PanelHeader, PanelTitle } from '@web/components/ui/panel';
import type { SessionUser } from '@web/features/auth/session';
import type { ProjectSettings } from '@web/features/workspace/project-settings-dialog';
import { WorkspaceHeader } from '@web/features/workspace/workspace-header';

export type WorkspaceMember = { id: string; name: string; isCurrentUser: boolean };

/** The dialog "Repository" of the project's menu (spec 28a). */
export type WorkspaceRepository = {
  projectId: string;
  /** How the way back from GitLab ended; the dialog opens with it once. */
  returned: GitReturn | undefined;
  /** The dialog showed how it ended and was closed. */
  onReturnSeen: () => void;
  /** The review to show (spec 30b): the dialog "Merge Requests" opens with it. */
  reviewId?: string | null;
  /** That dialog was closed. */
  onReviewClosed?: () => void;
};

type WorkspaceShellProps = {
  projectName: string;
  settings: ProjectSettings;
  repository: WorkspaceRepository;
  /** The project's menu offers the usage (spec 31b): for owners. */
  showUsage?: boolean;
  activePhase: Phase;
  /** Jumping to a phase and asking for the next step (spec 24); missing for viewers. */
  onSelectPhase?: (phase: Phase) => void;
  onAskNextStep?: () => void;
  members: WorkspaceMember[];
  user: SessionUser | null;
  /** The agents of the project in the header (spec 14). */
  team: ReactNode;
  /** "Teilen" in the header (spec 21a). */
  share: ReactNode;
  /** Content of the chat panel: its header row and the chat. */
  chat: ReactNode;
  /** Content of the canvas panel: its header row and the canvas. */
  canvas: ReactNode;
  /** Sections of the overview: what waits for the user, decisions and criteria. */
  overview: ReactNode;
};

/** Main screen layout: header plus chat, canvas and overview panels (handoff "Main screen"). */
export function WorkspaceShell({
  projectName,
  settings,
  repository,
  showUsage,
  activePhase,
  onSelectPhase,
  onAskNextStep,
  members,
  user,
  team,
  share,
  chat,
  canvas,
  overview,
}: WorkspaceShellProps) {
  const { t } = useTranslation();

  return (
    <div className="grid h-dvh min-w-[1100px] grid-rows-[52px_minmax(0,1fr)] bg-bg-app text-text">
      <WorkspaceHeader
        projectName={projectName}
        settings={settings}
        repository={repository}
        showUsage={showUsage}
        activePhase={activePhase}
        onSelectPhase={onSelectPhase}
        onAskNextStep={onAskNextStep}
        members={members}
        user={user}
        team={team}
        share={share}
      />

      <main className="grid min-h-0 grid-cols-[380px_minmax(0,1fr)_300px] gap-2 px-2 pb-2">
        <Panel aria-label={t('panels.chat')}>{chat}</Panel>

        <Panel aria-label={t('panels.canvas')}>{canvas}</Panel>

        <Panel aria-label={t('panels.overview')}>
          <PanelHeader>
            <PanelTitle>{t('panels.overview')}</PanelTitle>
          </PanelHeader>
          <div className="min-h-0 overflow-y-auto">{overview}</div>
        </Panel>
      </main>
    </div>
  );
}
