import type { Phase } from '@covibes/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Panel, PanelHeader, PanelTitle } from '@web/components/ui/panel';
import type { SessionUser } from '@web/features/auth/session';
import type { ProjectSettings } from '@web/features/workspace/project-settings-dialog';
import { WorkspaceHeader } from '@web/features/workspace/workspace-header';

export type WorkspaceMember = { id: string; name: string; isCurrentUser: boolean };

type WorkspaceShellProps = {
  projectName: string;
  settings: ProjectSettings;
  activePhase: Phase;
  members: WorkspaceMember[];
  user: SessionUser | null;
  /** The agents of the project in the header (spec 14). */
  team: ReactNode;
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
  activePhase,
  members,
  user,
  team,
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
        activePhase={activePhase}
        members={members}
        user={user}
        team={team}
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
