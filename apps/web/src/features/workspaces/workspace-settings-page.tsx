import { workspaceNameSchema, type WorkspaceMember, type WorkspaceSummary } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { AppHeader } from '@web/components/app-header';
import { Button } from '@web/components/ui/button';
import { Card, Notice } from '@web/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from '@web/components/ui/dialog';
import { FieldError, Input, Label } from '@web/components/ui/input';
import { Select } from '@web/components/ui/select';
import { sessionQuery } from '@web/features/auth/session';
import { CreateProjectDialog } from '@web/features/projects/create-project-dialog';
import { WorkspaceInvitations } from '@web/features/workspaces/workspace-invitations';
import {
  useWorkspaceActions,
  workspaceErrorKey,
  workspaceMembersQuery,
  workspacesQuery,
} from '@web/features/workspaces/queries';
import { WorkspacePicker } from '@web/features/workspaces/workspace-picker';

const route = getRouteApi('/_authed/workspaces/$workspaceId');

export function WorkspaceSettingsPage() {
  const { t } = useTranslation();
  const { workspaceId } = route.useParams();
  const navigate = useNavigate();
  const list = useQuery(workspacesQuery);
  const user = useQuery(sessionQuery).data;
  const workspace = list.data?.find((entry) => entry.id === workspaceId);
  return (
    <div className="min-h-dvh bg-bg-app text-text">
      <AppHeader>
        <WorkspacePicker
          value={workspaceId}
          onSelect={(id) => {
            void navigate({ to: '/', search: { workspace: id } });
          }}
        />
      </AppHeader>
      <main className="mx-auto grid w-full max-w-[900px] gap-5 px-6 pt-6 pb-16 max-md:px-4">
        <Link
          to="/"
          search={{ workspace: workspaceId }}
          className="text-ui text-text-3 hover:text-text"
        >
          {t('workspaces.back')}
        </Link>
        {list.isPending ? (
          <p role="status">{t('common.loading')}</p>
        ) : list.isError ? (
          <Notice tone="danger">
            {t('workspaces.loadFailed')}{' '}
            <Button
              onClick={() => {
                void list.refetch();
              }}
            >
              {t('workspaces.retry')}
            </Button>
          </Notice>
        ) : workspace && user ? (
          <WorkspaceSettings key={workspace.id} workspace={workspace} userId={user.id} />
        ) : (
          <Notice tone="danger">{t('workspaces.unavailable')}</Notice>
        )}
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="min-w-0 p-6 max-md:p-5">
      <section aria-label={title} className="grid gap-4">
        <h2 className="m-0 font-display text-heading font-semibold tracking-[-0.01em]">{title}</h2>
        {children}
      </section>
    </Card>
  );
}

function WorkspaceSettings({ workspace, userId }: { workspace: WorkspaceSummary; userId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const owner = workspace.role === 'owner';
  const team = workspace.kind === 'team';
  const members = useQuery(workspaceMembersQuery(workspace.id));
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mt-0 mb-1.5 text-small text-text-3">
            {t(team ? 'workspaces.team' : 'workspaces.personalLabel')}
          </p>
          <h1 className="m-0 break-words font-display text-[34px] font-semibold tracking-[-0.03em]">
            {workspace.name}
          </h1>
        </div>
        {workspace.role !== 'viewer' ? <CreateProjectDialog workspaceId={workspace.id} /> : null}
      </div>
      <Section title={t('workspaces.settings')}>
        <WorkspaceName workspace={workspace} />
      </Section>
      <Section title={t('workspaces.members')}>
        <p className="m-0 text-small text-text-3">
          {t(team ? 'workspaces.membersDescription' : 'workspaces.personalDescription')}
        </p>
        {members.isPending ? (
          <p role="status">{t('common.loading')}</p>
        ) : members.isError ? (
          <Notice tone="danger">
            {t('workspaces.loadFailed')}{' '}
            <Button
              onClick={() => {
                void members.refetch();
              }}
            >
              {t('workspaces.retry')}
            </Button>
          </Notice>
        ) : (
          <Members workspace={workspace} members={members.data} userId={userId} />
        )}
      </Section>
      {team && owner ? (
        <Section title={t('workspaces.invitations')}>
          <WorkspaceInvitations workspaceId={workspace.id} />
        </Section>
      ) : null}
      {team ? (
        <Section title={t('workspaces.accessAndDeletion')}>
          <p className="m-0 text-small text-text-3">{t('workspaces.leaveDescription')}</p>
          <TeamAction
            workspace={workspace}
            action="leave"
            userId={userId}
            onDone={() => {
              void navigate({ to: '/', search: { workspace: undefined } });
            }}
          />
          {owner ? (
            <>
              <p className="m-0 text-small text-text-3">{t('workspaces.deleteDescription')}</p>
              {workspace.projectCount > 0 ? (
                <p className="m-0 text-small text-text-3">{t('workspaces.projectsRemain')}</p>
              ) : null}
              <TeamAction
                workspace={workspace}
                action="delete"
                userId={userId}
                disabled={workspace.projectCount > 0}
                onDone={() => {
                  void navigate({ to: '/', search: { workspace: undefined } });
                }}
              />
            </>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}

function WorkspaceName({ workspace }: { workspace: WorkspaceSummary }) {
  const { t } = useTranslation();
  const { rename } = useWorkspaceActions(workspace.id);
  const [name, setName] = useState(workspace.name);
  const [invalid, setInvalid] = useState(false);
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = workspaceNameSchema.safeParse(name);
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    rename.mutate(parsed.data);
  }
  return (
    <form noValidate onSubmit={submit} className="grid gap-3">
      <Label htmlFor="workspace-name">{t('workspaces.name')}</Label>
      <Input
        id="workspace-name"
        value={name}
        maxLength={100}
        disabled={workspace.role !== 'owner' || rename.isPending}
        aria-invalid={invalid}
        aria-describedby={invalid ? 'workspace-name-error' : undefined}
        onChange={(event) => {
          setName(event.target.value);
          setInvalid(false);
          rename.reset();
        }}
      />
      {invalid ? (
        <FieldError id="workspace-name-error">{t('workspaces.nameInvalid')}</FieldError>
      ) : null}
      {rename.isError ? <Notice tone="danger">{t(workspaceErrorKey(rename.error))}</Notice> : null}
      {rename.isSuccess ? <Notice tone="success">{t('workspaces.saved')}</Notice> : null}
      {workspace.role === 'owner' ? (
        <div>
          <Button variant="primary" type="submit" disabled={rename.isPending}>
            {t(rename.isPending ? 'common.loading' : 'workspaces.saveName')}
          </Button>
        </div>
      ) : (
        <p className="m-0 text-small text-text-3">{t('workspaces.ownerOnly')}</p>
      )}
    </form>
  );
}

function Members({
  workspace,
  members,
  userId,
}: {
  workspace: WorkspaceSummary;
  members: WorkspaceMember[];
  userId: string;
}) {
  const { t } = useTranslation();
  const { setRole, removeMember } = useWorkspaceActions(workspace.id);
  const busy = setRole.isPending || removeMember.isPending;
  const canManage = workspace.kind === 'team' && workspace.role === 'owner';
  const ownerCount = members.filter((member) => member.role === 'owner').length;
  const error = setRole.error ?? removeMember.error;
  return (
    <>
      {error ? (
        <Notice tone="danger">{t(workspaceErrorKey(error, 'workspaces.ownerConflict'))}</Notice>
      ) : null}
      <ul className="m-0 grid list-none gap-3 p-0">
        {members.map((member) => {
          const lastOwner = member.role === 'owner' && ownerCount === 1;
          return (
            <li
              key={member.userId}
              className="flex flex-wrap items-center gap-3 rounded-card bg-bg-subtle px-4 py-3"
            >
              <span className="min-w-0 flex-1 break-words text-ui font-medium">
                {member.name}
                {member.userId === userId ? ` (${t('common.you')})` : ''}
              </span>
              {canManage ? (
                <>
                  <Select
                    aria-label={t('workspaces.roleFor', { name: member.name })}
                    value={member.role}
                    disabled={busy || lastOwner}
                    onChange={(event) => {
                      const role = event.target.value;
                      if (role === 'owner' || role === 'editor' || role === 'viewer') {
                        removeMember.reset();
                        setRole.mutate({ userId: member.userId, role });
                      }
                    }}
                  >
                    {(['viewer', 'editor', 'owner'] as const).map((role) => (
                      <option key={role} value={role}>
                        {t(`projects.roles.${role}`)}
                      </option>
                    ))}
                  </Select>
                  {member.userId !== userId ? (
                    <Button
                      disabled={busy || lastOwner}
                      aria-label={t('workspaces.removeMemberNamed', { name: member.name })}
                      onClick={() => {
                        setRole.reset();
                        removeMember.mutate(member.userId);
                      }}
                    >
                      {t('workspaces.removeMember')}
                    </Button>
                  ) : null}
                </>
              ) : (
                <span className="text-small text-text-3">{t(`projects.roles.${member.role}`)}</span>
              )}
            </li>
          );
        })}
      </ul>
      {canManage && ownerCount === 1 ? (
        <p className="m-0 text-small text-text-3">{t('workspaces.ownerConflict')}</p>
      ) : null}
    </>
  );
}

function TeamAction({
  workspace,
  action,
  userId,
  disabled,
  onDone,
}: {
  workspace: WorkspaceSummary;
  action: 'leave' | 'delete';
  userId: string;
  disabled?: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { removeMember, remove } = useWorkspaceActions(workspace.id);
  const mutation = action === 'leave' ? removeMember : remove;
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const title = t(action === 'leave' ? 'workspaces.leave' : 'workspaces.delete');
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) {
          setOpen(next);
          setConfirmation('');
          remove.reset();
          removeMember.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="danger" disabled={disabled}>
          {title}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={title}
        description={t(
          action === 'leave' ? 'workspaces.leaveDescription' : 'workspaces.deleteDescription',
        )}
      >
        <div className="grid gap-3">
          <Label htmlFor={`confirm-${action}`}>
            {t('workspaces.confirmName', { name: workspace.name })}
          </Label>
          <Input
            id={`confirm-${action}`}
            value={confirmation}
            autoComplete="off"
            disabled={mutation.isPending}
            onChange={(event) => {
              setConfirmation(event.target.value);
            }}
          />
          {mutation.isError ? (
            <Notice tone="danger">
              {t(
                workspaceErrorKey(
                  mutation.error,
                  action === 'leave' ? 'workspaces.ownerConflict' : 'workspaces.deleteConflict',
                ),
              )}
            </Notice>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={mutation.isPending}>{t('common.cancel')}</Button>
            </DialogClose>
            <Button
              variant="danger"
              disabled={mutation.isPending || confirmation !== workspace.name}
              onClick={() => {
                if (action === 'leave') removeMember.mutate(userId, { onSuccess: onDone });
                else remove.mutate(undefined, { onSuccess: onDone });
              }}
            >
              {t(
                mutation.isPending
                  ? 'common.loading'
                  : action === 'leave'
                    ? 'workspaces.leave'
                    : 'workspaces.delete',
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
