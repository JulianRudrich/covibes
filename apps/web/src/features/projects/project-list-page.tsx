import type { ProjectSummary } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { AppHeader } from '@web/components/app-header';
import { Avatar } from '@web/components/ui/avatar';
import { Badge } from '@web/components/ui/badge';
import { Card, Notice } from '@web/components/ui/card';
import { AccountMenu } from '@web/features/account/account-menu';
import { sessionQuery } from '@web/features/auth/session';
import { NotificationBell } from '@web/features/notifications/notification-bell';
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
          {project.waiting > 0 ? (
            <span className="flex h-5 items-center rounded-[10px] bg-ink px-2 text-badge font-semibold whitespace-nowrap text-on-ink tabular-nums">
              {t('projects.waiting', { count: project.waiting })}
            </span>
          ) : null}
          <Badge>{t(`projects.roles.${project.role}`)}</Badge>
          {t('projects.updated', {
            time: formatRelativeTime(project.updatedAt, i18n.language),
          })}
        </span>
      </Link>
    </li>
  );
}

const WELCOME_STEPS = ['collect', 'decide', 'handOver'] as const;

/**
 * What someone without a project sees (spec 33; derived look): what Covibes is, how a project
 * runs in three steps, and the button for the first one. It is the introduction; there is no
 * tour.
 */
function Welcome() {
  const { t } = useTranslation();
  return (
    <Card className="flex flex-col items-center px-8 py-10 text-center">
      <h2 className="m-0 text-[20px] font-semibold tracking-[-0.01em]">{t('welcome.title')}</h2>
      <p className="mt-2 mb-0 max-w-[440px] text-body leading-normal text-text-2">
        {t('welcome.text')}
      </p>
      <ol className="m-0 mt-7 grid w-full list-none grid-cols-3 gap-5 p-0 text-left">
        {WELCOME_STEPS.map((step, index) => (
          <li key={step} className="flex flex-col gap-1.5">
            <span
              aria-hidden="true"
              className="grid size-6 place-items-center rounded-full bg-bg-subtle text-small font-semibold text-text-2"
            >
              {index + 1}
            </span>
            <h3 className="m-0 text-ui font-semibold text-text">
              {t(`welcome.steps.${step}.title`)}
            </h3>
            <p className="m-0 text-small leading-snug text-text-3">
              {t(`welcome.steps.${step}.text`)}
            </p>
          </li>
        ))}
      </ol>
      <div className="mt-8">
        <CreateProjectDialog label={t('welcome.create')} />
      </div>
    </Card>
  );
}

export function ProjectListPage() {
  const { t } = useTranslation();
  const user = useQuery(sessionQuery).data;
  const projects = useQuery(projectsQuery);

  return (
    <div className="min-h-dvh bg-bg-app text-text">
      <AppHeader>
        {user ? <NotificationBell /> : null}
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
          {/* The welcome below has the button for the first project; this one steps back. */}
          <CreateProjectDialog quiet={projects.data?.length === 0} />
        </div>

        {projects.isPending ? (
          <p className="text-ui text-text-3">{t('common.loading')}</p>
        ) : projects.isError ? (
          <Notice tone="danger">{t('projects.loadError')}</Notice>
        ) : projects.data.length === 0 ? (
          <Welcome />
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
