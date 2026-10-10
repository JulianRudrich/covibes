import type { SharedProject } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { ReactFlowProvider } from '@xyflow/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Logo } from '@web/components/logo';
import { PageMessage } from '@web/components/page-message';
import { LanguageSwitch } from '@web/features/account/language-switch';
import { Badge } from '@web/components/ui/badge';
import { Panel, PanelHeader, PanelTitle } from '@web/components/ui/panel';
import { AgentDirectoryProvider } from '@web/features/agents/agent-directory';
import { CriteriaSection } from '@web/features/decisions/criteria-section';
import { DecisionsSection } from '@web/features/decisions/decisions-section';
import { sharedBoardQuery, sharedProjectQuery } from '@web/features/share/queries';
import { SharedBoardCanvas } from '@web/features/share/shared-board';
import { ApiError } from '@web/lib/api';
import { cn } from '@web/lib/cn';

const route = getRouteApi('/share/$token');

/**
 * Route component for `/share/$token` (spec 21b): a project for people without an account. It
 * shows the boards and the overview with decisions and criteria, loaded again every 30 seconds;
 * nothing can be changed, and neither the chat nor a person is part of it.
 */
export function ShareViewPage() {
  const { t } = useTranslation();
  const { token } = route.useParams();
  const project = useQuery(sharedProjectQuery(token));

  if (project.isPending) {
    return (
      <PageMessage below={<LanguageSwitch />} title={t('shareView.loading')}>
        <span className="sr-only">{t('common.loading')}</span>
      </PageMessage>
    );
  }
  // Also when the link stops working while the view is open.
  if (project.isError) {
    const dead = project.error instanceof ApiError && project.error.code === 'not_found';
    return (
      <PageMessage
        below={<LanguageSwitch />}
        title={t(dead ? 'shareView.dead.title' : 'shareView.loadError')}
      >
        {dead ? <p className="m-0 text-ui text-text-3">{t('shareView.dead.text')}</p> : null}
        <Link to="/" className="mt-2 text-ui">
          {t('shareView.toCovibes')}
        </Link>
      </PageMessage>
    );
  }

  return (
    <AgentDirectoryProvider agents={project.data.customAgents}>
      <SharedWorkspace token={token} project={project.data} />
    </AgentDirectoryProvider>
  );
}

function SharedWorkspace({ token, project }: { token: string; project: SharedProject }) {
  const { t, i18n } = useTranslation();
  const [openBoard, setOpenBoard] = useState<string | null>(null);
  // The main canvas first; a board that was deleted meanwhile falls back to it.
  const board = project.boards.find((entry) => entry.id === openBoard) ?? project.boards[0];
  const content = useQuery({
    ...sharedBoardQuery(token, board?.id ?? ''),
    enabled: board !== undefined,
  });
  const updated = content.dataUpdatedAt
    ? new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(
        content.dataUpdatedAt,
      )
    : null;

  return (
    <div className="grid h-dvh min-w-[760px] grid-rows-[52px_minmax(0,1fr)] bg-bg-app text-text">
      <header className="flex items-center gap-2.5 px-4">
        <Logo />
        <span className="text-display font-semibold tracking-[-0.02em]">
          {t('common.wordmark')}
        </span>
        <span aria-hidden="true" className="text-display text-text-faint">
          /
        </span>
        <h1 className="m-0 min-w-0 truncate text-ui font-medium">{project.name}</h1>
        <Badge>{t('shareView.readOnly')}</Badge>
        <span className="ml-auto text-small text-text-3">
          {updated ? t('shareView.updated', { time: updated }) : null}
        </span>
        <LanguageSwitch />
      </header>

      <main className="grid min-h-0 grid-cols-[minmax(0,1fr)_300px] gap-2 px-2 pb-2">
        <Panel aria-label={t('panels.canvas')}>
          <PanelHeader className="gap-1 px-3">
            <div role="tablist" aria-label={t('shareView.boards')} className="flex h-8 gap-1">
              {project.boards.map((entry) => {
                const active = entry.id === board?.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={cn(
                      'flex h-full max-w-[200px] cursor-pointer items-center truncate rounded-md px-3 text-ui font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-ink',
                      active ? 'bg-bg-subtle text-text' : 'text-text-2 hover:bg-bg-subtle',
                    )}
                    onClick={() => {
                      setOpenBoard(entry.id);
                    }}
                  >
                    {entry.kind === 'main' ? t('workspace.mainCanvas') : entry.title}
                  </button>
                );
              })}
            </div>
          </PanelHeader>
          <div role="tabpanel" className="relative min-h-0 bg-bg-canvas">
            {board && content.data ? (
              <ReactFlowProvider key={board.id}>
                <SharedBoardCanvas
                  nodes={content.data.nodes}
                  edges={content.data.edges}
                  roadmap={content.data.roadmap}
                />
              </ReactFlowProvider>
            ) : (
              <div className="absolute inset-0 grid place-items-center p-6 text-center text-ui text-text-3">
                {content.isError ? t('shareView.boardError') : t('canvas.loading')}
              </div>
            )}
            {content.data?.nodes.length === 0 ? (
              <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center text-ui text-text-3">
                {t('shareView.emptyBoard')}
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel aria-label={t('panels.overview')}>
          <PanelHeader>
            <PanelTitle>{t('panels.overview')}</PanelTitle>
          </PanelHeader>
          <div className="min-h-0 overflow-y-auto">
            {/* Without the decision log: it names who decided what. */}
            <DecisionsSection decisions={project.decisions} log={undefined} />
            <CriteriaSection criteria={project.criteria} />
          </div>
        </Panel>
      </main>
    </div>
  );
}
