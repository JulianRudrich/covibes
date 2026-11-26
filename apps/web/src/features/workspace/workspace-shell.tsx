import type { GitReturn, Phase, ProjectAgent } from '@covibes/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Panel } from '@web/components/ui/panel';
import type { SessionUser } from '@web/features/auth/session';
import type { ProjectSettings } from '@web/features/workspace/project-settings-dialog';
import { MobileWorkspace } from '@web/features/workspace/mobile-workspace';
import { WorkspaceHeader } from '@web/features/workspace/workspace-header';
import { usePhone } from '@web/lib/use-media-query';

export type WorkspaceMember = { id: string; name: string; isCurrentUser: boolean };

/** The dialog "Repository" of the project's menu (spec 28a). */
export type WorkspaceRepository = {
  projectId: string;
  /** How the way back from GitLab ended; the dialog opens with it once. */
  returned: GitReturn | undefined;
  githubReturned?: GitReturn | undefined;
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
  /** The members who have the open board open right now ("Im Raum"). */
  present: ReadonlySet<string>;
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
  /** For the phone layout (spec 36e): the team's marks in its header. */
  agents: readonly ProjectAgent[];
  writing?: string | null;
  raising?: ReadonlySet<string>;
  /** What waits for the user, counted on the tab "Überblick". */
  waiting: number;
  /** The note of the workspace, shown by the phone layout while the canvas is not. */
  notice: string | null;
  /** The address names a board, the plan or an element. */
  startOnCanvas: boolean;
  /** Grows whenever the chat or the overview opens something on the canvas. */
  canvasRequest: number;
};

/**
 * Main screen layout (handoff "Covibes Studio", "Layout"): the top bar on the app background
 * plus the chat, canvas and overview panels. On a phone one area at a time (spec 36e).
 */
export function WorkspaceShell({
  projectName,
  settings,
  repository,
  showUsage,
  activePhase,
  onSelectPhase,
  onAskNextStep,
  members,
  present,
  user,
  team,
  share,
  chat,
  canvas,
  overview,
  agents,
  writing,
  raising,
  waiting,
  notice,
  startOnCanvas,
  canvasRequest,
}: WorkspaceShellProps) {
  const { t } = useTranslation();
  const phone = usePhone();

  if (phone) {
    return (
      <MobileWorkspace
        projectName={projectName}
        activePhase={activePhase}
        agents={agents}
        writing={writing}
        raising={raising}
        waiting={waiting}
        notice={notice}
        startOnCanvas={startOnCanvas}
        canvasRequest={canvasRequest}
        chat={chat}
        canvas={canvas}
        overview={overview}
      />
    );
  }

  return (
    <div className="grid h-dvh min-w-[1100px] grid-rows-[64px_minmax(0,1fr)] bg-bg-app text-text">
      <WorkspaceHeader
        projectName={projectName}
        settings={settings}
        repository={repository}
        showUsage={showUsage}
        activePhase={activePhase}
        onSelectPhase={onSelectPhase}
        onAskNextStep={onAskNextStep}
        members={members}
        present={present}
        user={user}
        team={team}
        share={share}
      />

      <main className="grid min-h-0 grid-cols-[372px_minmax(0,1fr)_300px] gap-3 px-3 pb-3">
        <Panel aria-label={t('panels.chat')}>{chat}</Panel>

        <Panel aria-label={t('panels.canvas')}>{canvas}</Panel>

        {/* The overview has no title of its own: its sections head themselves. */}
        <aside
          aria-label={t('panels.overview')}
          className="flex min-h-0 min-w-0 flex-col gap-[22px] overflow-y-auto rounded-surface bg-bg-panel p-[18px] shadow-panel"
        >
          {overview}
        </aside>
      </main>
    </div>
  );
}
