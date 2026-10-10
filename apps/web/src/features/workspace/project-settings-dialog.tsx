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
import { DialogClose, DialogContent } from '@web/components/ui/dialog';
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
    <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
      <legend className="mb-1 p-0 text-ui font-semibold text-text">{title}</legend>
      {children}
      {note ? <p className="m-0 px-1.5 text-small leading-snug text-text-3">{note}</p> : null}
    </fieldset>
  );
}

/** A radio button or checkbox with its label and one line of explanation. */
function Choice({
  type,
  name,
  checked,
  disabled,
  label,
  text,
  onChange,
}: {
  type: 'radio' | 'checkbox';
  name: string;
  checked: boolean;
  disabled: boolean;
  label: string;
  text: string;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5 rounded-sm px-1.5 py-1 has-[input:enabled]:hover:bg-bg-subtle">
      <input
        id={id}
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-text`}
        className="mt-[3px] size-3.5 shrink-0 accent-ink enabled:cursor-pointer"
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <label htmlFor={id} className={cn('flex min-w-0 flex-col', !disabled && 'cursor-pointer')}>
        <span className="text-ui font-medium text-text">{label}</span>
        <span id={`${id}-text`} className="text-small leading-snug text-text-3">
          {text}
        </span>
      </label>
    </div>
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
      className="w-[min(480px,calc(100vw-32px))]"
    >
      <div className="flex max-h-[min(70vh,620px)] flex-col gap-4 overflow-y-auto">
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
      <div className="mt-4 flex justify-end">
        <DialogClose asChild>
          <Button variant="primary">{t('common.close')}</Button>
        </DialogClose>
      </div>
    </DialogContent>
  );
}
