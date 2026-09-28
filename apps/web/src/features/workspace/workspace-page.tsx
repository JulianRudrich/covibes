import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { PageMessage } from '@web/components/page-message';
import { sessionQuery } from '@web/features/auth/session';
import { projectQuery } from '@web/features/projects/queries';
import { DEMO_ACTIVE_PHASE } from '@web/features/workspace/demo-workspace';
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

  // The signed-in user comes first and is shown as "you".
  const members: WorkspaceMember[] = project.data.members
    .map((member) => ({
      id: member.userId,
      name: member.name,
      isCurrentUser: member.userId === user?.id,
    }))
    .sort((a, b) => Number(b.isCurrentUser) - Number(a.isCurrentUser));

  return (
    <WorkspaceShell
      projectName={project.data.name}
      activePhase={DEMO_ACTIVE_PHASE}
      members={members}
      user={user ?? null}
    />
  );
}
