import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppHeader } from '@web/components/app-header';
import { Avatar } from '@web/components/ui/avatar';
import { Card, Notice } from '@web/components/ui/card';
import { AccountMenu } from '@web/features/account/account-menu';
import { sessionQuery } from '@web/features/auth/session';
import { NotificationBell } from '@web/features/notifications/notification-bell';
import { CreateProjectDialog } from '@web/features/projects/create-project-dialog';
import { greetingKey } from '@web/features/projects/greeting';
import { ProjectCard } from '@web/features/projects/project-card';
import { projectsQuery } from '@web/features/projects/queries';
import { WorkspacePicker } from '@web/features/workspaces/workspace-picker';
import { workspaceProjectsQuery, workspacesQuery } from '@web/features/workspaces/queries';
import { initialsOf } from '@web/lib/format';

const WELCOME_STEPS = ['collect', 'decide', 'handOver'] as const;

/**
 * What someone without a project sees (spec 33; derived look): what Covibes is, how a project
 * runs in three steps, and the button for the first one. It is the introduction; there is no
 * tour.
 */
function Welcome({ workspaceId, canCreate }: { workspaceId?: string; canCreate: boolean }) {
  const { t } = useTranslation();
  return (
    <Card className="mx-auto flex max-w-[760px] flex-col items-center px-8 py-10 text-center">
      <h2 className="m-0 font-display text-[22px] font-semibold tracking-[-0.02em]">
        {t('welcome.title')}
      </h2>
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
            <h3 className="m-0 font-sans text-ui font-semibold text-text">
              {t(`welcome.steps.${step}.title`)}
            </h3>
            <p className="m-0 text-small leading-snug text-text-3">
              {t(`welcome.steps.${step}.text`)}
            </p>
          </li>
        ))}
      </ol>
      {canCreate ? (
        <div className="mt-8">
          <CreateProjectDialog
            workspaceId={workspaceId}
            label={t('welcome.create')}
            className="h-10 px-[18px]"
          />
        </div>
      ) : (
        <p className="mt-6 mb-0 text-small text-text-3">{t('workspaces.viewerCreateHint')}</p>
      )}
    </Card>
  );
}

/** The last card of the list (draft F): a dashed card that opens "Neues Projekt". */
function NewProjectCard({ workspaceId }: { workspaceId?: string }) {
  const { t } = useTranslation();
  return (
    <li className="flex">
      <CreateProjectDialog
        workspaceId={workspaceId}
        trigger={
          <button
            type="button"
            className="group flex min-h-[196px] w-full cursor-pointer flex-col items-center justify-center gap-2.5 rounded-surface border-2 border-dashed border-border-strong bg-transparent p-5 text-small text-text-3 transition-colors hover:border-edge focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <span
              aria-hidden="true"
              className="grid size-10 place-items-center rounded-full bg-bg-panel text-text-2 shadow-panel transition-colors group-hover:text-text"
            >
              <Plus size={17} strokeWidth={2.2} />
            </span>
            <span className="text-body font-semibold text-text-2">
              {t('projects.newCard.title')}
            </span>
            <span>{t('projects.newCard.text')}</span>
          </button>
        }
      />
    </li>
  );
}

export function ProjectListPage() {
  const { t } = useTranslation();
  const user = useQuery(sessionQuery).data;
  const projects = useQuery(projectsQuery);
  const workspaces = useQuery(workspacesQuery);
  const { workspace: workspaceId } = useSearch({ strict: false });
  const navigate = useNavigate();
  const currentWorkspace = workspaces.data?.find((entry) => entry.id === workspaceId);
  const workspaceProjects = useQuery({
    ...workspaceProjectsQuery(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
  });
  const [query, setQuery] = useState('');
  const canCreate =
    !workspaceId || (currentWorkspace !== undefined && currentWorkspace.role !== 'viewer');
  const workspaceIds = new Set((workspaceProjects.data ?? []).map((project) => project.id));
  const accessible = (projects.data ?? []).filter(
    (project) => !workspaceId || workspaceIds.has(project.id),
  );

  const needle = query.trim().toLocaleLowerCase();
  const shown = accessible.filter((project) => project.name.toLocaleLowerCase().includes(needle));
  const pending =
    projects.isPending ||
    Boolean(workspaceId && (workspaceProjects.isPending || workspaces.isPending));
  const failed =
    projects.isError || Boolean(workspaceId && (workspaceProjects.isError || workspaces.isError));
  const none = !pending && !failed && accessible.length === 0;
  const firstName = user?.name.split(' ')[0] ?? '';

  return (
    <div className="min-h-dvh bg-bg-app text-text">
      <AppHeader>
        {user ? <NotificationBell /> : null}
        {user ? (
          <AccountMenu user={user}>
            <Avatar
              kind="human"
              tone="strong"
              size={32}
              label={user.name}
              initials={initialsOf(user.name)}
            />
          </AccountMenu>
        ) : null}
      </AppHeader>

      <main className="mx-auto w-full max-w-[1168px] px-6 pt-7 pb-16 max-md:px-4">
        <div className="mb-6">
          <WorkspacePicker
            value={workspaceId}
            onSelect={(id) => {
              setQuery('');
              void navigate({ to: '/', search: { workspace: id } });
            }}
          />
        </div>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            {firstName ? (
              <p className="mt-0 mb-1.5 text-body text-text-3">
                {t(greetingKey(new Date().getHours()), { name: firstName })}
              </p>
            ) : null}
            <h1 className="m-0 font-display text-[34px] font-semibold tracking-[-0.03em]">
              {currentWorkspace?.name ?? t('projects.heading')}
            </h1>
          </div>
          {/* On a phone search and button share the full width (spec 36e). */}
          <div className="flex items-center gap-2 max-md:w-full">
            {none ? null : (
              <label className="flex h-10 w-[240px] min-w-0 items-center max-md:w-auto max-md:flex-1 gap-2 rounded-full bg-bg-panel px-3.5 text-text-3 inset-ring inset-ring-border focus-within:inset-ring-ink">
                <Search size={15} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                <input
                  type="search"
                  value={query}
                  placeholder={t('projects.search')}
                  aria-label={t('projects.search')}
                  className="h-full min-w-0 flex-1 border-0 bg-transparent text-ui text-text outline-none placeholder:text-text-3"
                  onChange={(event) => {
                    setQuery(event.target.value);
                  }}
                />
              </label>
            )}
            {/* The welcome below has the button for the first project; this one steps back. */}
            {canCreate ? (
              <CreateProjectDialog
                workspaceId={workspaceId}
                quiet={none}
                className="h-10 px-[18px]"
              />
            ) : null}
          </div>
        </div>

        {pending ? (
          <p className="text-ui text-text-3">{t('common.loading')}</p>
        ) : failed ? (
          <Notice tone="danger">
            {t('projects.loadError')}{' '}
            <button
              type="button"
              className="cursor-pointer underline"
              onClick={() => {
                void projects.refetch();
                if (workspaceId) {
                  void workspaceProjects.refetch();
                  void workspaces.refetch();
                }
              }}
            >
              {t('workspaces.retry')}
            </button>
          </Notice>
        ) : none ? (
          <Welcome workspaceId={workspaceId} canCreate={canCreate} />
        ) : (
          <>
            <ul
              className="m-0 grid list-none grid-cols-3 gap-4 p-0 max-[1080px]:grid-cols-2 max-[720px]:grid-cols-1"
              aria-label={t('projects.title')}
            >
              {shown.map((project) => (
                <ProjectCard key={project.id} project={project} userId={user?.id} />
              ))}
              {needle === '' && canCreate ? <NewProjectCard workspaceId={workspaceId} /> : null}
            </ul>
            {shown.length === 0 ? (
              <p className="mt-2 text-body text-text-3">{t('projects.noMatch')}</p>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
