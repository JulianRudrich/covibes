import { PROJECT_NAME_MAX_LENGTH, projectNameSchema } from '@covibes/shared';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { Notice } from '@web/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@web/components/ui/dialog';
import { FieldError, Input, Label } from '@web/components/ui/input';
import { useCreateProject } from '@web/features/projects/queries';

export function CreateProjectDialog() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createProject = useCreateProject();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [invalid, setInvalid] = useState(false);

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      setName('');
      setInvalid(false);
      createProject.reset();
    }
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = projectNameSchema.safeParse(name);
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    createProject.mutate(
      { name: parsed.data },
      {
        onSuccess: (project) => {
          changeOpen(false);
          void navigate({ to: '/p/$projectId', params: { projectId: project.id } });
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
          {t('projects.create')}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={t('projects.dialog.title')}
        description={t('projects.dialog.description')}
      >
        <form className="grid gap-2" noValidate onSubmit={submit}>
          <Label htmlFor="project-name">{t('projects.dialog.nameLabel')}</Label>
          <Input
            id="project-name"
            autoFocus
            maxLength={PROJECT_NAME_MAX_LENGTH}
            placeholder={t('projects.dialog.namePlaceholder')}
            value={name}
            aria-invalid={invalid}
            aria-describedby={invalid ? 'project-name-error' : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setInvalid(false);
            }}
          />
          {invalid ? (
            <FieldError id="project-name-error">
              {t('projects.dialog.nameInvalid', { max: PROJECT_NAME_MAX_LENGTH })}
            </FieldError>
          ) : null}
          {createProject.isError ? (
            <Notice tone="danger">{t('projects.dialog.error')}</Notice>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <DialogClose asChild>
              <Button>{t('common.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" type="submit" disabled={createProject.isPending}>
              {createProject.isPending
                ? t('projects.dialog.creating')
                : t('projects.dialog.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
