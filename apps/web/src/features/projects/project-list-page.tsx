import type { ProjectSummary } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AppHeader } from '@web/components/app-header';
import { Avatar } from '@web/components/ui/avatar';
import { Badge } from '@web/components/ui/badge';
import { Card, Notice } from '@web/components/ui/card';
import { AccountMenu } from '@web/features/account/account-menu';
import { sessionQuery } from '@web/features/auth/session';
import { CreateProjectDialog } from '@web/features/projects/create-project-dialog';
import { projectsQuery } from '@web/features/projects/queries';
import { formatRelativeTime, initialsOf } from '@web/lib/format';

function ProjectRow({ project }: { project: ProjectSummary }) {
  const { t, i18n } = useTranslation();
  return (
    <li>
      <Link
        to="/p/$projectId"
        params={{ projectId: project.id }}
        className="flex items-center justify-between gap-4 rounded-card border border-border bg-bg-panel px-4 py-3 text-text no-underline shadow-panel transition-colors hover:border-border-strong hover:text-text"
      >
        <span className="truncate text-body font-medium">{project.name}</span>
        <span className="flex shrink-0 items-center gap-3 text-small text-text-3">
          <Badge>{t(`projects.roles.${project.role}`)}</Badge>
          {t('projects.updated', {
            time: formatRelativeTime(project.updatedAt, i18n.language),
          })}
        </span>
      </Link>
    </li>
  );
}

export function ProjectListPage() {
  const { t } = useTranslation();
  const user = useQuery(sessionQuery).data;
  const projects = useQuery(projectsQuery);

  return (
    <div className="min-h-dvh bg-bg-app text-text">
      <AppHeader>
        {user ? (
          <AccountMenu user={user}>
            <Avatar
              kind="human"
              tone="strong"
              size={28}
              label={user.name}
              initials={initialsOf(user.name)}
            />
          </AccountMenu>
        ) : null}
      </AppHeader>

      <main className="mx-auto w-full max-w-[760px] px-6 pt-8 pb-16">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h1 className="m-0 text-[20px] font-semibold tracking-[-0.01em]">
            {t('projects.title')}
          </h1>
          <CreateProjectDialog />
        </div>

        {projects.isPending ? (
          <p className="text-ui text-text-3">{t('common.loading')}</p>
        ) : projects.isError ? (
          <Notice tone="danger">{t('projects.loadError')}</Notice>
        ) : projects.data.length === 0 ? (
          <Card className="grid place-items-center gap-2 px-6 py-12 text-center">
            <FolderOpen size={28} className="text-text-4" aria-hidden="true" />
            <h2 className="m-0 text-title font-semibold">{t('projects.emptyTitle')}</h2>
            <p className="m-0 max-w-[360px] text-ui text-text-3">{t('projects.emptyText')}</p>
          </Card>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0" aria-label={t('projects.title')}>
            {projects.data.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
