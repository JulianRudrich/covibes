import type { ProjectDetails } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageMessage } from '@web/components/page-message';
import { sessionQuery, type SessionUser } from '@web/features/auth/session';
import { BoardTabs } from '@web/features/canvas/board-tabs';
import { CanvasPanel } from '@web/features/canvas/canvas-panel';
import { ChatPanel } from '@web/features/chat/chat-panel';
import { projectQuery } from '@web/features/projects/queries';
import { DEMO_ACTIVE_PHASE } from '@web/features/workspace/demo-workspace';
import { useProjectLive } from '@web/features/workspace/use-project-live';
import { WorkspaceShell, type WorkspaceMember } from '@web/features/workspace/workspace-shell';
import { ApiError } from '@web/lib/api';

const route = getRouteApi('/_authed/p/$projectId');

/** Route component for `/p/$projectId`. */
export function WorkspacePage() {
  const { t } = useTranslation();
  const { projectId } = route.useParams();
  const user = useQuery(sessionQuery).data;
  const project = useQuery(projectQuery(projectId));

  if (project.isPending) {
    return (
      <PageMessage title={t('workspace.loading')}>
        <span className="sr-only">{t('common.loading')}</span>
      </PageMessage>
    );
  }
  if (project.isError) {
    const notFound = project.error instanceof ApiError && project.error.code === 'not_found';
    return (
      <PageMessage title={notFound ? t('workspace.notFound.title') : t('workspace.loadError')}>
        {notFound ? (
          <p className="m-0 text-ui text-text-3">{t('workspace.notFound.text')}</p>
        ) : null}
        <Link to="/" className="mt-2 text-ui">
          {t('workspace.notFound.back')}
        </Link>
      </PageMessage>
    );
  }

  return <Workspace project={project.data} user={user ?? null} />;
}

/** How long a note over the canvas stays. */
const NOTICE_MS = 5_000;

/** A short note that disappears by itself; a new one starts the time again. */
function useNotice() {
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      setNotice(null);
    }, NOTICE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [notice]);
  const show = useCallback((text: string) => {
    setNotice({ text, at: Date.now() });
  }, []);
  return { notice: notice?.text ?? null, show };
}

function Workspace({ project, user }: { project: ProjectDetails; user: SessionUser | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { board: requested } = route.useSearch();
  const { notice, show: showNotice } = useNotice();
  useProjectLive(project.id);

  // The main canvas comes first; it is open unless the address names another board.
  const activeBoard =
    project.boards.find((board) => board.id === requested) ??
    project.boards.find((board) => board.kind === 'main');

  const selectBoard = useCallback(
    (boardId: string, replace = false) =>
      navigate({
        to: '/p/$projectId',
        params: { projectId: project.id },
        search: boardId === mainBoardId(project) ? {} : { board: boardId },
        replace,
      }),
    [navigate, project],
  );

  // A board that disappears while it is open was deleted by someone else; unknown boards in the
  // address (e.g. an old link) just open the main canvas.
  const knownBoards = useRef(new Set<string>());
  useEffect(() => {
    if (requested !== undefined && !project.boards.some((board) => board.id === requested)) {
      if (knownBoards.current.has(requested)) showNotice(t('canvas.boards.deleted'));
      const main = mainBoardId(project);
      if (main) void selectBoard(main, true);
    }
    for (const board of project.boards) knownBoards.current.add(board.id);
  }, [project, requested, selectBoard, showNotice, t]);

  // The signed-in user comes first and is shown as "you".
  const members: WorkspaceMember[] = project.members
    .map((member) => ({
      id: member.userId,
      name: member.name,
      isCurrentUser: member.userId === user?.id,
    }))
    .sort((a, b) => Number(b.isCurrentUser) - Number(a.isCurrentUser));

  const readOnly = project.role === 'viewer';

  return (
    <WorkspaceShell
      projectName={project.name}
      activePhase={DEMO_ACTIVE_PHASE}
      members={members}
      user={user}
      chat={
        user ? (
          <ChatPanel
            key={project.id}
            projectId={project.id}
            user={{ id: user.id, name: user.name }}
            readOnly={readOnly}
          />
        ) : null
      }
      canvas={
        activeBoard && user ? (
          <CanvasPanel
            boardId={activeBoard.id}
            tabs={
              <BoardTabs
                projectId={project.id}
                boards={project.boards}
                activeBoardId={activeBoard.id}
                readOnly={readOnly}
                onSelect={(boardId) => selectBoard(boardId)}
                onNotice={showNotice}
              />
            }
            notice={notice}
            user={{ id: user.id, name: user.name }}
            members={project.members}
            readOnly={readOnly}
          />
        ) : null
      }
    />
  );
}

function mainBoardId(project: ProjectDetails): string | undefined {
  return project.boards.find((board) => board.kind === 'main')?.id;
}
