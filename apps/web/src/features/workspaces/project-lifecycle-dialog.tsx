import type { ProjectSummary } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
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
import { Input, Label } from '@web/components/ui/input';
import { Select } from '@web/components/ui/select';
import {
  useProjectLifecycle,
  workspaceErrorKey,
  workspacesQuery,
} from '@web/features/workspaces/queries';

export function ProjectLifecycleDialog({
  project,
}: {
  project: Pick<ProjectSummary, 'id' | 'name' | 'role'>;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const list = useQuery({ ...workspacesQuery, enabled: project.role === 'owner' });
  const { move, remove } = useProjectLifecycle(project.id);
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const busy = move.isPending || remove.isPending;
  if (project.role !== 'owner') return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          setOpen(next);
          setConfirmation('');
          setDestination('');
          move.reset();
          remove.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button aria-label={t('workspaces.project.manageNamed', { name: project.name })}>
          {t('workspaces.project.manage')}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={t('workspaces.project.title', { name: project.name })}
        className="max-h-[calc(100dvh-32px)] overflow-y-auto"
      >
        <div className="grid gap-5">
          <section aria-label={t('workspaces.project.move')} className="grid gap-3">
            <h3 className="m-0 font-display text-display font-semibold">
              {t('workspaces.project.move')}
            </h3>
            <p className="m-0 text-small text-text-3">{t('workspaces.project.moveDescription')}</p>
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
            ) : (
              <>
                <Label htmlFor={`move-project-${project.id}`}>
                  {t('workspaces.project.destination')}
                </Label>
                <Select
                  id={`move-project-${project.id}`}
                  size="field"
                  value={destination}
                  disabled={busy}
                  onChange={(event) => {
                    setDestination(event.target.value);
                    move.reset();
                  }}
                >
                  <option value="">{t('workspaces.project.chooseDestination')}</option>
                  {list.data
                    .filter((workspace) => workspace.role !== 'viewer')
                    .map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </option>
                    ))}
                </Select>
                <div>
                  <Button
                    variant="primary"
                    disabled={busy || !destination}
                    onClick={() => {
                      move.mutate(destination);
                    }}
                  >
                    {t(move.isPending ? 'common.loading' : 'workspaces.project.move')}
                  </Button>
                </div>
              </>
            )}
            {move.isSuccess ? (
              <Notice tone="success">{t('workspaces.project.moved')}</Notice>
            ) : null}
            {move.isError ? (
              <Notice tone="danger">{t(workspaceErrorKey(move.error))}</Notice>
            ) : null}
          </section>
          <section
            aria-label={t('workspaces.project.delete')}
            className="grid gap-3 border-t border-border pt-4"
          >
            <h3 className="m-0 font-display text-display font-semibold">
              {t('workspaces.project.delete')}
            </h3>
            <p className="m-0 text-small text-text-3">
              {t('workspaces.project.deleteDescription')}
            </p>
            <Label htmlFor={`delete-project-${project.id}`}>
              {t('workspaces.confirmName', { name: project.name })}
            </Label>
            <Input
              id={`delete-project-${project.id}`}
              autoComplete="off"
              value={confirmation}
              disabled={busy}
              onChange={(event) => {
                setConfirmation(event.target.value);
                remove.reset();
              }}
            />
            {remove.isError ? (
              <Notice tone="danger">
                {t(workspaceErrorKey(remove.error, 'workspaces.project.deleteConflict'))}
              </Notice>
            ) : null}
            <div>
              <Button
                variant="danger"
                disabled={busy || confirmation !== project.name}
                onClick={() => {
                  remove.mutate(confirmation, {
                    onSuccess: () => {
                      void navigate({ to: '/', search: { workspace: undefined }, replace: true });
                    },
                  });
                }}
              >
                {t(remove.isPending ? 'common.loading' : 'workspaces.project.delete')}
              </Button>
            </div>
          </section>
          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={busy}>{t('common.close')}</Button>
            </DialogClose>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
