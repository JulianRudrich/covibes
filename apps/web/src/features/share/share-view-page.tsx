import type { SharedProject } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { ReactFlowProvider } from '@xyflow/react';
import { SquareCheckBig, Workflow } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Logo } from '@web/components/logo';
import { PageMessage, PageMessageLink } from '@web/components/page-message';
import { LanguageSwitch } from '@web/features/account/language-switch';
import { Badge } from '@web/components/ui/badge';
import { MobileTabs } from '@web/components/ui/mobile-tabs';
import { Panel } from '@web/components/ui/panel';
import { AgentDirectoryProvider } from '@web/features/agents/agent-directory';
import { CriteriaSection } from '@web/features/decisions/criteria-section';
import { DecisionsSection } from '@web/features/decisions/decisions-section';
import { sharedBoardQuery, sharedProjectQuery } from '@web/features/share/queries';
import { SharedBoardCanvas } from '@web/features/share/shared-board';
import { ApiError } from '@web/lib/api';
import { cn } from '@web/lib/cn';
import { usePhone } from '@web/lib/use-media-query';

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
        {dead ? <p className="m-0 text-body text-text-3">{t('shareView.dead.text')}</p> : null}
        <PageMessageLink to="/">{t('shareView.toCovibes')}</PageMessageLink>
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
  const phone = usePhone();
  const [area, setArea] = useState<'canvas' | 'overview'>('canvas');
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

  // The boards with their tabs, and the overview: side by side on a desktop, one at a time on a
  // phone (spec 36e).
  const boards = (
    <>
      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex *:pointer-events-auto">
        <div role="tablist" aria-label={t('shareView.boards')} className="flex gap-1">
          {project.boards.map((entry) => {
            const active = entry.id === board?.id;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={cn(
                  'flex h-[34px] max-w-[200px] cursor-pointer items-center truncate rounded-full text-ui whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
                  active
                    ? 'bg-bg-panel px-4 font-semibold text-text shadow-block'
                    : 'px-3.5 font-medium text-text-2 hover:bg-wash hover:text-text',
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
      </div>
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
    </>
  );
  const overview = (
    <>
      {/* Without the decision log: it names who decided what. */}
      <DecisionsSection decisions={project.decisions} log={undefined} />
      <CriteriaSection criteria={project.criteria} />
    </>
  );
  const updatedLine = (
    <span className="text-small text-text-3 tabular-nums">
      {updated ? t('shareView.updated', { time: updated }) : null}
    </span>
  );

  if (phone) {
    return (
      <div className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] bg-bg-panel text-text">
        <header className="flex min-w-0 items-center gap-2.5 bg-bg-app px-4 pt-3.5 pb-3">
          <Logo />
          <h1 className="m-0 min-w-0 truncate font-display text-[18px] font-semibold tracking-[-0.015em]">
            {project.name}
          </h1>
          <Badge className="h-[22px] shrink-0 px-2.5">{t('shareView.readOnly')}</Badge>
        </header>
        <main className="relative min-h-0">
          {area === 'canvas' ? (
            <section
              aria-label={t('panels.canvas')}
              className="absolute inset-0 grid grid-rows-[minmax(0,1fr)]"
            >
              {boards}
            </section>
          ) : null}
          <aside
            aria-label={t('panels.overview')}
            hidden={area !== 'overview'}
            className="absolute inset-0 flex flex-col gap-[22px] overflow-y-auto p-4"
          >
            <div className="flex items-center justify-between gap-3">
              {updatedLine}
              <LanguageSwitch />
            </div>
            {overview}
          </aside>
        </main>
        <MobileTabs
          tabs={[
            { id: 'canvas', label: t('panels.canvas'), icon: Workflow },
            { id: 'overview', label: t('panels.overview'), icon: SquareCheckBig },
          ]}
          active={area}
          onSelect={setArea}
        />
      </div>
    );
  }

  return (
    <div className="grid h-dvh min-w-[760px] grid-rows-[64px_minmax(0,1fr)] bg-bg-app text-text">
      <header className="flex items-center gap-2.5 pr-4 pl-5">
        <Logo />
        <span className="font-display text-[18px] font-bold tracking-[-0.025em]">
          {t('common.wordmark')}
        </span>
        <span aria-hidden="true" className="mx-0.5 text-text-3">
          /
        </span>
        <h1 className="m-0 min-w-0 truncate text-ui font-semibold">{project.name}</h1>
        <Badge className="h-[22px] px-2.5">{t('shareView.readOnly')}</Badge>
        <span className="ml-auto">{updatedLine}</span>
        <LanguageSwitch />
      </header>

      <main className="grid min-h-0 grid-cols-[minmax(0,1fr)_300px] gap-3 px-3 pb-3">
        <Panel aria-label={t('panels.canvas')} className="relative grid-rows-[minmax(0,1fr)]">
          {boards}
        </Panel>

        {/* Like the main screen's overview: no title of its own (spec 36b). */}
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
