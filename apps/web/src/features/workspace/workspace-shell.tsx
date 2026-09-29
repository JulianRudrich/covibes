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

type WorkspaceShellProps = {
  projectName: string;
  activePhase: Phase;
  members: WorkspaceMember[];
  user: SessionUser | null;
  /** Content of the canvas panel: its header row and the canvas. */
  canvas: ReactNode;
};

/** Main screen layout: header plus chat, canvas and overview panels (handoff "Main screen"). */
export function WorkspaceShell({
  projectName,
  activePhase,
  members,
  user,
  canvas,
}: WorkspaceShellProps) {
  const { t } = useTranslation();

  return (
    <div className="grid h-dvh min-w-[1100px] grid-rows-[52px_minmax(0,1fr)] bg-bg-app text-text">
      <WorkspaceHeader
        projectName={projectName}
        activePhase={activePhase}
        members={members}
        user={user}
      />

      <main className="grid min-h-0 grid-cols-[380px_minmax(0,1fr)_300px] gap-2 px-2 pb-2">
        <Panel aria-label={t('panels.chat')}>
          <PanelHeader className="justify-between">
            <PanelTitle>{t('panels.chat')}</PanelTitle>
          </PanelHeader>
          <EmptyHint>{t('empty.chat')}</EmptyHint>
        </Panel>

        <Panel aria-label={t('panels.canvas')}>{canvas}</Panel>

        <Panel aria-label={t('panels.overview')}>
          <PanelHeader>
            <PanelTitle>{t('panels.overview')}</PanelTitle>
          </PanelHeader>
          <EmptyHint>{t('empty.overview')}</EmptyHint>
        </Panel>
      </main>
    </div>
  );
}
