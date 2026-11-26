import {
  LANGUAGE_NAMES,
  LANGUAGES,
  PROJECT_NAME_MAX_LENGTH,
  projectNameSchema,
} from '@covibes/shared';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState, type ReactElement, type SubmitEvent } from 'react';
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
import { Segmented } from '@web/components/ui/segmented';
import { FieldError, Input, Label } from '@web/components/ui/input';
import { useCreateProject } from '@web/features/projects/queries';
import { currentLanguage } from '@web/i18n/language';

/**
 * The button that opens the dialog "Neues Projekt". `label` names it differently, e.g. for the
 * first project of someone new (spec 33); `quiet` makes it the second choice where another
 * button of the page is the first. `trigger` replaces the button, e.g. with the card "Neues
 * Projekt" of the project list (spec 36c); `className` sizes the button.
 */
export function CreateProjectDialog({
  label,
  quiet = false,
  trigger,
  className,
  workspaceId,
}: {
  label?: string;
  quiet?: boolean;
  trigger?: ReactElement;
  className?: string;
  workspaceId?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createProject = useCreateProject(workspaceId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [invalid, setInvalid] = useState(false);
  // The language the project is written in (spec 32b): proposed is the one the person reads
  // the app in.
  const [language, setLanguage] = useState(currentLanguage);

  function changeOpen(next: boolean) {
    setOpen(next);
    if (next) setLanguage(currentLanguage());
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
      { name: parsed.data, language },
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
        {trigger ?? (
          <Button variant={quiet ? 'secondary' : 'primary'} className={className}>
            <Plus size={15} strokeWidth={2.2} aria-hidden="true" />
            {label ?? t('projects.create')}
          </Button>
        )}
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
          <fieldset className="m-0 mt-2 grid min-w-0 gap-1.5 border-0 p-0">
            <legend className="mb-1.5 p-0 text-small font-medium text-text-2">
              {t('projects.dialog.language')}
            </legend>
            <Segmented
              name="project-language"
              value={language}
              options={LANGUAGES.map((option) => ({
                value: option,
                label: LANGUAGE_NAMES[option],
              }))}
              describedBy="project-language-hint"
              onChange={setLanguage}
            />
            <p id="project-language-hint" className="m-0 text-small leading-snug text-text-3">
              {t('projects.dialog.languageHint')}
            </p>
          </fieldset>
          {createProject.isError ? (
            <Notice tone="danger">{t('projects.dialog.error')}</Notice>
          ) : null}
          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button>{t('common.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" type="submit" disabled={createProject.isPending}>
              {createProject.isPending
                ? t('projects.dialog.creating')
                : t('projects.dialog.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
