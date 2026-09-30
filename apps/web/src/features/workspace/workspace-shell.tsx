import type { Phase } from '@covibes/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Panel, PanelHeader, PanelTitle } from '@web/components/ui/panel';
import type { SessionUser } from '@web/features/auth/session';
import { WorkspaceHeader } from '@web/features/workspace/workspace-header';

function EmptyHint({ children }: { children: string }) {
  return (
    <div className="grid place-items-center p-6 text-center text-ui text-text-3">{children}</div>
  );
}

export type WorkspaceMember = { id: string; name: string; isCurrentUser: boolean };

/** The project menu of the header (spec 13): the proposals-only mode. */
export type ProjectSettings = {
  proposalsOnly: boolean;
  /** Only owners change the settings; everyone else sees them. */
  canChange: boolean;
  onProposalsOnlyChange: (proposalsOnly: boolean) => void;
};

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
  /** Sections of the overview; without any, the overview explains what will appear. */
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
          <div className="min-h-0 overflow-y-auto">
            {overview ?? <EmptyHint>{t('empty.overview')}</EmptyHint>}
          </div>
        </Panel>
      </main>
    </div>
  );
}
