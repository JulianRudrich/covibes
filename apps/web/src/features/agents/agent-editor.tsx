import {
  AGENT_KEYS,
  AGENT_MODELS,
  CUSTOM_AGENT_COLORS,
  CUSTOM_AGENT_INSTRUCTIONS_MAX_LENGTH,
  CUSTOM_AGENT_NAME_MAX_LENGTH,
  CUSTOM_AGENT_ROLE_MAX_LENGTH,
  customAgentNameSchema,
  DEFAULT_AGENT_MODEL,
  isAgentModel,
  isCatalogAgentName,
  mentionHandle,
  type AgentKey,
  type AgentModel,
  type CustomAgent,
  type CustomAgentColor,
  type CustomAgentScope,
  type UpdateCustomAgentInput,
} from '@covibes/shared';
import { Check } from 'lucide-react';
import { useId, useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { DialogClose, DialogContent } from '@web/components/ui/dialog';
import { FieldError, Input, Label } from '@web/components/ui/input';
import { AgentKnowledge } from '@web/features/agents/agent-knowledge';
import { useCustomAgentMutations } from '@web/features/agents/queries';
import { ApiError } from '@web/lib/api';
import { cn } from '@web/lib/cn';

/** The catalog specialists a custom agent can start from. */
type TemplateKey = Exclude<AgentKey, 'moderator'>;
const TEMPLATES = AGENT_KEYS.filter((key): key is TemplateKey => key !== 'moderator');

/** The names of the six custom colors. */
const COLOR_NAMES = {
  1: 'agentEditor.colors.1',
  2: 'agentEditor.colors.2',
  3: 'agentEditor.colors.3',
  4: 'agentEditor.colors.4',
  5: 'agentEditor.colors.5',
  6: 'agentEditor.colors.6',
} as const satisfies Record<CustomAgentColor, string>;

const FIELD =
  'w-full rounded-md border border-border-strong bg-bg-panel px-3 text-ui text-text transition-colors focus-visible:border-ink focus-visible:outline-none';

type AgentEditorProps = {
  /** The agent to edit, or null to create one. */
  agent: CustomAgent | null;
  project: { id: string; name: string };
  userId: string;
  /** The color a new agent starts with. */
  defaultColor: CustomAgentColor;
  /** Called with the new agent, so it can join the team of the project it was created in. */
  onCreated: (agent: CustomAgent) => void;
  onDone: () => void;
};

/**
 * The agent editor (spec 19, derived look): name, role, instructions, color, model, whether the
 * agent may draw, and who sees it. A new agent can start from a catalog specialist. The content of
 * a dialog; the caller opens and closes it.
 */
export function AgentEditor({
  agent,
  project,
  userId,
  defaultColor,
  onCreated,
  onDone,
}: AgentEditorProps) {
  const { t } = useTranslation();
  const ids = useId();
  const { create, update, remove } = useCustomAgentMutations(project.id);
  const [template, setTemplate] = useState<TemplateKey | null>(null);
  const [name, setName] = useState(agent?.name ?? '');
  const [role, setRole] = useState(agent?.role ?? '');
  const [instructions, setInstructions] = useState(agent?.instructions ?? '');
  const [color, setColor] = useState<number>(agent?.color ?? defaultColor);
  const [model, setModel] = useState<AgentModel>(agent?.model ?? DEFAULT_AGENT_MODEL);
  const [canDraw, setCanDraw] = useState(agent?.canDraw ?? true);
  const [scope, setScope] = useState<CustomAgentScope>(agent?.scope ?? 'personal');
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const busy = create.isPending || update.isPending || remove.isPending;
  // Only the creator shares an agent or takes it back.
  const canChangeScope = agent === null || agent.ownerId === userId;

  const parsedName = customAgentNameSchema.safeParse(name);
  const canSave = !busy && name.trim() !== '' && role.trim() !== '';

  function chooseTemplate(key: TemplateKey | null) {
    setTemplate(key);
    if (!key) return;
    // The specialist's role and instructions, to be changed freely.
    setRole(t(`agentRoles.${key}`));
    setInstructions(t(`agentTemplates.${key}`));
  }

  function fail(cause: unknown) {
    const code = cause instanceof ApiError ? cause.code : 'failed';
    if (code === 'name_taken') setNameError(t('agentEditor.nameTaken'));
    else setError(t(code === 'limit_reached' ? 'agentEditor.limitReached' : 'agentEditor.failed'));
  }

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!parsedName.success) {
      setNameError(
        t(isCatalogAgentName(name) ? 'agentEditor.nameReserved' : 'agentEditor.nameInvalid'),
      );
      return;
    }
    const values = {
      name: parsedName.data,
      role: role.trim(),
      instructions: instructions.trim(),
      canDraw,
      model: model === DEFAULT_AGENT_MODEL ? null : model,
      color: color as CustomAgentColor,
      projectId: scope === 'project' ? project.id : null,
    };
    try {
      if (agent === null) {
        onCreated(await create.mutateAsync({ ...values, template }));
      } else {
        // Only what changed, so someone without the right to move the agent can still edit it.
        const changes: UpdateCustomAgentInput = {
          ...(values.name === agent.name ? {} : { name: values.name }),
          ...(values.role === agent.role ? {} : { role: values.role }),
          ...(values.instructions === agent.instructions
            ? {}
            : { instructions: values.instructions }),
          ...(values.canDraw === agent.canDraw ? {} : { canDraw: values.canDraw }),
          ...(values.model === agent.model ? {} : { model: values.model }),
          ...(values.color === agent.color ? {} : { color: values.color }),
          ...(scope === agent.scope ? {} : { projectId: values.projectId }),
        };
        if (Object.keys(changes).length > 0) {
          await update.mutateAsync({ key: agent.key, input: changes });
        }
      }
      onDone();
    } catch (cause) {
      fail(cause);
    }
  }

  async function deleteAgent() {
    if (!agent) return;
    try {
      await remove.mutateAsync(agent.key);
      onDone();
    } catch (cause) {
      fail(cause);
    }
  }

  return (
    <DialogContent
      title={
        agent ? t('agentEditor.editTitle', { name: agent.name }) : t('agentEditor.createTitle')
      }
      description={t('agentEditor.hint')}
      className="w-[min(520px,calc(100vw-32px))]"
    >
      <form
        onSubmit={(event) => {
          void save(event);
        }}
        className="flex flex-col gap-4"
      >
        <div className="flex max-h-[min(64vh,600px)] flex-col gap-3.5 overflow-y-auto pr-1">
          {agent === null ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${ids}-template`}>{t('agentEditor.template')}</Label>
              <select
                id={`${ids}-template`}
                value={template ?? ''}
                className={cn(FIELD, 'h-[34px]')}
                onChange={(event) => {
                  const { value } = event.target;
                  chooseTemplate(TEMPLATES.find((key) => key === value) ?? null);
                }}
              >
                <option value="">{t('agentEditor.noTemplate')}</option>
                {TEMPLATES.map((key) => (
                  <option key={key} value={key}>
                    {t(`agents.${key}`)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-name`}>{t('agentEditor.name')}</Label>
            <Input
              id={`${ids}-name`}
              value={name}
              maxLength={CUSTOM_AGENT_NAME_MAX_LENGTH}
              required
              aria-invalid={nameError !== null}
              aria-describedby={`${ids}-name-hint`}
              onChange={(event) => {
                setName(event.target.value);
                setNameError(null);
              }}
            />
            {nameError ? (
              <FieldError id={`${ids}-name-hint`}>{nameError}</FieldError>
            ) : (
              <p id={`${ids}-name-hint`} className="m-0 text-small text-text-3">
                {parsedName.success
                  ? t('agentEditor.mentionedAs', { handle: mentionHandle(parsedName.data) })
                  : t('agentEditor.nameRule')}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-role`}>{t('agentEditor.role')}</Label>
            <Input
              id={`${ids}-role`}
              value={role}
              maxLength={CUSTOM_AGENT_ROLE_MAX_LENGTH}
              required
              placeholder={t('agentEditor.rolePlaceholder')}
              onChange={(event) => {
                setRole(event.target.value);
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-instructions`}>{t('agentEditor.instructions')}</Label>
            <textarea
              id={`${ids}-instructions`}
              value={instructions}
              rows={7}
              maxLength={CUSTOM_AGENT_INSTRUCTIONS_MAX_LENGTH}
              placeholder={t('agentEditor.instructionsPlaceholder')}
              aria-describedby={`${ids}-count`}
              className={cn(FIELD, 'resize-y py-2 leading-normal')}
              onChange={(event) => {
                setInstructions(event.target.value);
              }}
            />
            <p id={`${ids}-count`} className="m-0 text-right text-meta text-text-4 tabular-nums">
              {t('agentEditor.count', {
                count: instructions.length,
                max: CUSTOM_AGENT_INSTRUCTIONS_MAX_LENGTH,
              })}
            </p>
          </div>

          <div className="flex flex-wrap items-start gap-x-6 gap-y-3.5">
            <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
              <legend className="mb-1.5 p-0 text-small font-medium text-text-2">
                {t('agentEditor.color')}
              </legend>
              <div className="flex gap-1.5">
                {CUSTOM_AGENT_COLORS.map((option) => (
                  <label key={option} className="relative flex cursor-pointer">
                    <input
                      type="radio"
                      name={`${ids}-color`}
                      checked={color === option}
                      aria-label={t(COLOR_NAMES[option])}
                      className="peer absolute inset-0 cursor-pointer opacity-0"
                      onChange={() => {
                        setColor(option);
                      }}
                    />
                    <span
                      className={cn(
                        'grid size-7 place-items-center rounded-md bg-agent-custom text-on-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink',
                        `agent-color-${String(option)}`,
                      )}
                    >
                      {color === option ? (
                        <Check size={14} strokeWidth={2.6} aria-hidden="true" />
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex min-w-[160px] flex-1 flex-col gap-1.5">
              <Label htmlFor={`${ids}-model`}>{t('agentEditor.model')}</Label>
              <select
                id={`${ids}-model`}
                value={model}
                className={cn(FIELD, 'h-[34px]')}
                onChange={(event) => {
                  if (isAgentModel(event.target.value)) setModel(event.target.value);
                }}
              >
                {AGENT_MODELS.map((option) => (
                  <option key={option} value={option}>
                    {option === DEFAULT_AGENT_MODEL
                      ? t('team.defaultModel', { model: t(`team.models.${option}`) })
                      : t(`team.models.${option}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Option
            type="checkbox"
            name={`${ids}-draw`}
            checked={canDraw}
            label={t('agentEditor.canDraw.label')}
            text={t('agentEditor.canDraw.text')}
            onChange={setCanDraw}
          />

          <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
            <legend className="mb-1 p-0 text-small font-medium text-text-2">
              {t('agentEditor.scope.title')}
            </legend>
            <Option
              type="radio"
              name={`${ids}-scope`}
              checked={scope === 'personal'}
              disabled={!canChangeScope}
              label={t('agentEditor.scope.personal.label')}
              text={t('agentEditor.scope.personal.text')}
              onChange={() => {
                setScope('personal');
              }}
            />
            <Option
              type="radio"
              name={`${ids}-scope`}
              checked={scope === 'project'}
              disabled={!canChangeScope}
              label={t('agentEditor.scope.project.label')}
              text={t('agentEditor.scope.project.text', { project: project.name })}
              onChange={() => {
                setScope('project');
              }}
            />
            {canChangeScope ? null : (
              <p className="m-0 px-1.5 text-small text-text-3">
                {t('agentEditor.scope.creatorOnly', { name: agent.ownerName })}
              </p>
            )}
          </fieldset>

          {agent === null ? (
            <p className="m-0 px-1.5 text-small leading-snug text-text-3">
              {t('agentEditor.knowledge.afterCreate')}
            </p>
          ) : (
            <AgentKnowledge agentKey={agent.key} />
          )}
        </div>

        {error ? <FieldError>{error}</FieldError> : null}

        <div className="flex items-center gap-2">
          {agent === null ? null : confirmingDelete ? (
            <>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => {
                  void deleteAgent();
                }}
              >
                {t('agentEditor.deleteConfirm')}
              </Button>
              <span className="min-w-0 text-small leading-snug text-text-3">
                {t('agentEditor.deleteHint')}
              </span>
            </>
          ) : (
            <Button
              variant="ghost"
              className="text-danger"
              disabled={busy}
              onClick={() => {
                setConfirmingDelete(true);
              }}
            >
              {t('agentEditor.delete')}
            </Button>
          )}
          <div className="ml-auto flex shrink-0 gap-2">
            <DialogClose asChild>
              <Button>{t('common.cancel')}</Button>
            </DialogClose>
            <Button type="submit" variant="primary" disabled={!canSave}>
              {t(agent ? 'agentEditor.save' : 'agentEditor.create')}
            </Button>
          </div>
        </div>
      </form>
    </DialogContent>
  );
}

/** A radio button or checkbox with its label and one line of explanation. */
function Option({
  type,
  name,
  checked,
  disabled = false,
  label,
  text,
  onChange,
}: {
  type: 'radio' | 'checkbox';
  name: string;
  checked: boolean;
  disabled?: boolean;
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
