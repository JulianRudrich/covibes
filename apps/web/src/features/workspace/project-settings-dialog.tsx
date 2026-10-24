import {
  DECISION_PROCESSES,
  LANGUAGE_NAMES,
  LANGUAGES,
  MODERATOR_STANCES,
  type DecisionProcess,
  type Language,
  type ModeratorStance,
  type UpdateProjectInput,
} from '@covibes/shared';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { Choice } from '@web/components/ui/choice';
import {
  DIALOG_SECTION_TITLE,
  DialogClose,
  DialogContent,
  DialogFooter,
} from '@web/components/ui/dialog';
import { cn } from '@web/lib/cn';

/** The settings of a project that its owners change (specs 13, 15, 16b, 20b and 32b). */
export type ProjectSettings = {
  stance: ModeratorStance;
  decisionProcess: DecisionProcess;
  proposalsOnly: boolean;
  observer: boolean;
  webAccess: boolean;
  /** The language the project is written in: plan, exports, Git texts. */
  language: Language;
  /** Only owners change the settings; everyone else sees them. */
  canChange: boolean;
  onChange: (change: UpdateProjectInput) => void;
};

function Group({
  title,
  note,
  children,
}: {
  title: string;
  /** What holds for the whole group, below its choices. */
  note?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
      <legend className={cn(DIALOG_SECTION_TITLE, 'mb-2.5 p-0')}>{title}</legend>
      {children}
      {note ? <p className="m-0 mt-0.5 px-1 text-small leading-snug text-text-3">{note}</p> : null}
    </fieldset>
  );
}

/**
 * The project settings (spec 16b, derived look): the moderator's stance, how the project decides,
 * the switches for agents, and the language the project is written in (spec 32b). Every change
 * applies at once; owners change them, everyone else sees them.
 */
export function ProjectSettingsDialog({ settings }: { settings: ProjectSettings }) {
  const { t } = useTranslation();
  const stanceName = useId();
  const processName = useId();
  const languageName = useId();
  const disabled = !settings.canChange;

  return (
    <DialogContent
      title={t('settings.title')}
      description={disabled ? t('settings.ownerOnly') : undefined}
      className="w-[min(520px,calc(100vw-32px))]"
    >
      <div className="-mx-1 flex max-h-[min(70vh,640px)] flex-col gap-6 overflow-y-auto px-1 pb-1">
        <Group title={t('settings.stance.title')}>
          {MODERATOR_STANCES.map((stance) => (
            <Choice
              key={stance}
              type="radio"
              name={stanceName}
              checked={settings.stance === stance}
              disabled={disabled}
              label={t(`settings.stance.${stance}.label`)}
              text={t(`settings.stance.${stance}.text`)}
              onChange={() => {
                settings.onChange({ stance });
              }}
            />
          ))}
        </Group>
        <Group title={t('settings.process.title')}>
          {DECISION_PROCESSES.map((process) => (
            <Choice
              key={process}
              type="radio"
              name={processName}
              checked={settings.decisionProcess === process}
              disabled={disabled}
              label={t(`settings.process.${process}.label`)}
              text={t(`settings.process.${process}.text`)}
              onChange={() => {
                settings.onChange({ decisionProcess: process });
              }}
            />
          ))}
        </Group>
        <Group title={t('settings.agents.title')}>
          <Choice
            type="checkbox"
            name="proposalsOnly"
            checked={settings.proposalsOnly}
            disabled={disabled}
            label={t('settings.agents.proposalsOnly.label')}
            text={t('settings.agents.proposalsOnly.text')}
            onChange={(proposalsOnly) => {
              settings.onChange({ proposalsOnly });
            }}
          />
          <Choice
            type="checkbox"
            name="observer"
            checked={settings.observer}
            disabled={disabled}
            label={t('settings.agents.observer.label')}
            text={t('settings.agents.observer.text')}
            onChange={(observer) => {
              settings.onChange({ observer });
            }}
          />
          <Choice
            type="checkbox"
            name="webAccess"
            checked={settings.webAccess}
            disabled={disabled}
            label={t('settings.agents.webAccess.label')}
            text={t('settings.agents.webAccess.text')}
            onChange={(webAccess) => {
              settings.onChange({ webAccess });
            }}
          />
        </Group>
        <Group title={t('settings.language.title')} note={t('settings.language.note')}>
          {LANGUAGES.map((language) => (
            <Choice
              key={language}
              type="radio"
              name={languageName}
              checked={settings.language === language}
              disabled={disabled}
              label={LANGUAGE_NAMES[language]}
              text={t(`settings.language.${language}`)}
              onChange={() => {
                settings.onChange({ language });
              }}
            />
          ))}
        </Group>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="primary">{t('common.close')}</Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  );
}
