import { workspaceNameSchema } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { Notice } from '@web/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from '@web/components/ui/dialog';
import { FieldError, Input, Label } from '@web/components/ui/input';
import { Select } from '@web/components/ui/select';
import {
  useCreateWorkspace,
  workspaceErrorKey,
  workspacesQuery,
} from '@web/features/workspaces/queries';

/** Native selection retains keyboard and mobile platform behavior. */
export function WorkspacePicker({
  value,
  onSelect,
}: {
  value?: string;
  onSelect: (id: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const workspaces = useQuery(workspacesQuery);
  const selected = workspaces.data?.find((workspace) => workspace.id === value);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Select
        aria-label={t('workspaces.select')}
        value={value ?? ''}
        disabled={workspaces.isPending}
        wrapperClassName="max-w-full"
        className="max-w-[240px] truncate"
        onChange={(event) => {
          onSelect(event.target.value || undefined);
        }}
      >
        <option value="">{t('workspaces.allProjects')}</option>
        {(workspaces.data ?? []).map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.kind === 'personal'
              ? t('workspaces.personal', { name: workspace.name })
              : workspace.name}
          </option>
        ))}
        {value && !selected ? <option value={value}>{t('workspaces.unavailable')}</option> : null}
      </Select>
      {selected ? (
        <Button
          onClick={() => {
            void navigate({ to: '/workspaces/$workspaceId', params: { workspaceId: selected.id } });
          }}
        >
          {t('workspaces.settings')}
        </Button>
      ) : null}
      <CreateWorkspaceDialog />
      {workspaces.isError ? (
        <Notice tone="danger" className="flex flex-wrap items-center gap-2">
          {t('workspaces.loadFailed')}
          <Button
            size="s"
            onClick={() => {
              void workspaces.refetch();
            }}
          >
            {t('workspaces.retry')}
          </Button>
        </Notice>
      ) : null}
    </div>
  );
}

export function CreateWorkspaceDialog() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateWorkspace();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [invalid, setInvalid] = useState(false);
  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      setName('');
      setInvalid(false);
      create.reset();
    }
  }
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = workspaceNameSchema.safeParse(name);
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    create.mutate(parsed.data, {
      onSuccess: (workspace) => {
        changeOpen(false);
        void navigate({ to: '/workspaces/$workspaceId', params: { workspaceId: workspace.id } });
      },
    });
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button>{t('workspaces.create')}</Button>
      </DialogTrigger>
      <DialogContent title={t('workspaces.create')} description={t('workspaces.createDescription')}>
        <form noValidate onSubmit={submit} className="grid gap-3">
          <Label htmlFor="new-workspace-name">{t('workspaces.name')}</Label>
          <Input
            id="new-workspace-name"
            autoFocus
            maxLength={100}
            value={name}
            aria-invalid={invalid}
            aria-describedby={invalid ? 'new-workspace-error' : undefined}
            disabled={create.isPending}
            onChange={(event) => {
              setName(event.target.value);
              setInvalid(false);
            }}
          />
          {invalid ? (
            <FieldError id="new-workspace-error">{t('workspaces.nameInvalid')}</FieldError>
          ) : null}
          {create.isError ? (
            <Notice tone="danger">{t(workspaceErrorKey(create.error))}</Notice>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={create.isPending}>{t('common.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" type="submit" disabled={create.isPending}>
              {t(create.isPending ? 'common.loading' : 'workspaces.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
