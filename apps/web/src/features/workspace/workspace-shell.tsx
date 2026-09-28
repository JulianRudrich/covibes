import type { Phase } from '@covibes/shared';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Panel, PanelHeader, PanelTitle } from '@web/components/ui/panel';
import { WorkspaceHeader } from '@web/features/workspace/workspace-header';

function EmptyHint({ children }: { children: string }) {
  return (
    <div className="grid place-items-center p-6 text-center text-ui text-text-3">{children}</div>
  );
}

type WorkspaceShellProps = { projectName: string; activePhase: Phase };

/** Main screen layout: header plus chat, canvas and overview panels (handoff "Main screen"). */
export function WorkspaceShell({ projectName, activePhase }: WorkspaceShellProps) {
  const { t } = useTranslation();

  return (
    <div className="grid h-dvh min-w-[1100px] grid-rows-[52px_minmax(0,1fr)] bg-bg-app text-text">
      <WorkspaceHeader projectName={projectName} activePhase={activePhase} />

      <main className="grid min-h-0 grid-cols-[380px_minmax(0,1fr)_300px] gap-2 px-2 pb-2">
        <Panel aria-label={t('panels.chat')}>
          <PanelHeader className="justify-between">
            <PanelTitle>{t('panels.chat')}</PanelTitle>
          </PanelHeader>
          <EmptyHint>{t('empty.chat')}</EmptyHint>
        </Panel>

        <Panel aria-label={t('panels.canvas')}>
          <PanelHeader className="gap-1 px-3">
            <span className="flex h-[30px] shrink-0 items-center rounded-md bg-bg-subtle px-3 font-medium whitespace-nowrap">
              {t('workspace.mainCanvas')}
            </span>
            <button
              type="button"
              className="flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-ui whitespace-nowrap text-text-2b hover:bg-bg-subtle hover:text-text"
            >
              <Plus size={13} strokeWidth={2.2} aria-hidden="true" />
              {t('workspace.addBoard')}
            </button>
          </PanelHeader>
          <div className="relative grid canvas-dots">
            <EmptyHint>{t('empty.canvas')}</EmptyHint>
          </div>
        </Panel>

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
