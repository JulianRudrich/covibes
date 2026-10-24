import {
  AGENT_KEYS,
  AGENT_MODELS,
  CUSTOM_AGENT_COLORS,
  CUSTOM_AGENT_INSTRUCTIONS_MAX_LENGTH,
  CUSTOM_AGENT_MARKS,
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
  type CustomAgentMark,
  type CustomAgentScope,
  type UpdateCustomAgentInput,
} from '@covibes/shared';
import { useId, useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { CUSTOM_MARKS, derivedMark } from '@web/components/ui/agent-marks';
import { Button } from '@web/components/ui/button';
import { Choice } from '@web/components/ui/choice';
import { DialogClose, DialogContent } from '@web/components/ui/dialog';
import { FieldError, Input, Label } from '@web/components/ui/input';
import { Segmented } from '@web/components/ui/segmented';
import { Select } from '@web/components/ui/select';
import { AgentKnowledge } from '@web/features/agents/agent-knowledge';
import { AgentPreview } from '@web/features/agents/agent-preview';
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

/** The legend of a group of choices, in the look of a field's label. */
const LEGEND = 'mb-2 p-0 text-small font-medium text-text-2';

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
 * The agent editor (spec 19; looks of spec 36c, draft G): name, role, color, mark, instructions,
 * model, whether the agent may draw, and who sees it, with a preview of the agent at the right. A
 * new agent can start from a catalog specialist. The content of a dialog; the caller opens and
 * closes it.
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
  // An agent without a picked mark shows the one its id gives it; a new one starts with a circle.
  const shownMark = agent ? (agent.mark ?? derivedMark(agent.key)) : 'circle';
  const [mark, setMark] = useState<CustomAgentMark>(shownMark);
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
      mark,
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
          // Stored once someone picks another mark than the one the agent shows already.
          ...(values.mark === shownMark ? {} : { mark: values.mark }),
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
      className="w-[min(880px,calc(100vw-32px))]"
      aside={<AgentPreview name={name} role={role} color={color} mark={CUSTOM_MARKS[mark]} />}
    >
      <form
        onSubmit={(event) => {
          void save(event);
        }}
        className="flex flex-col gap-4"
      >
        <div className="-mx-1 flex max-h-[min(60vh,560px)] flex-col gap-4 overflow-x-hidden overflow-y-auto px-1 pb-1">
          {agent === null ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${ids}-template`}>{t('agentEditor.template')}</Label>
              <select
                id={`${ids}-template`}
                value={template ?? ''}
                className={cn(FIELD, 'h-9')}
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

          <div className="grid grid-cols-2 items-start gap-3 max-[560px]:grid-cols-1">
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
          </div>

          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className={LEGEND}>{t('agentEditor.color')}</legend>
            <div className="flex flex-wrap gap-2 p-[5px]">
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
                  {/* The chosen color wears a ring in itself, 3 px off (draft G). */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-[34px] rounded-full bg-agent-custom ring-agent-custom ring-offset-3 ring-offset-bg-panel transition-shadow peer-checked:ring-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[7px] peer-focus-visible:outline-ink',
                      `agent-color-${String(option)}`,
                    )}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className={LEGEND}>{t('agentEditor.mark')}</legend>
            <div
              className={cn(
                'grid grid-cols-[repeat(6,44px)] gap-2 max-[420px]:grid-cols-[repeat(4,44px)]',
                `agent-color-${String(color)}`,
              )}
            >
              {CUSTOM_AGENT_MARKS.map((option) => (
                <label key={option} className="relative flex cursor-pointer">
                  <input
                    type="radio"
                    name={`${ids}-mark`}
                    checked={mark === option}
                    aria-label={t(`agentEditor.marks.${option}`)}
                    className="peer absolute inset-0 cursor-pointer opacity-0"
                    onChange={() => {
                      setMark(option);
                    }}
                  />
                  <span
                    aria-hidden="true"
                    className="grid size-11 place-items-center rounded-[14px] bg-bg-subtle text-text-2 transition-colors peer-checked:bg-agent-custom-tint peer-checked:text-agent-custom peer-checked:inset-ring-2 peer-checked:inset-ring-agent-custom peer-hover:text-text peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink"
                  >
                    <svg
                      width={20}
                      height={20}
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      fillRule="evenodd"
                    >
                      <path d={CUSTOM_MARKS[option]} />
                    </svg>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-instructions`}>{t('agentEditor.instructions')}</Label>
            <textarea
              id={`${ids}-instructions`}
              value={instructions}
              rows={5}
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-model`}>{t('agentEditor.model')}</Label>
            <Select
              id={`${ids}-model`}
              size="field"
              wrapperClassName="w-full"
              value={model}
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
            </Select>
          </div>

          <Choice
            type="checkbox"
            name={`${ids}-draw`}
            checked={canDraw}
            label={t('agentEditor.canDraw.label')}
            text={t('agentEditor.canDraw.text')}
            onChange={setCanDraw}
          />

          <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
            <legend className={LEGEND}>{t('agentEditor.scope.title')}</legend>
            {/* A segmented switch (draft G); the line below says what the chosen one means. */}
            <Segmented
              name={`${ids}-scope`}
              value={scope}
              options={(['personal', 'project'] as const).map((option) => ({
                value: option,
                label: t(`agentEditor.scope.${option}.label`),
              }))}
              disabled={!canChangeScope}
              describedBy={`${ids}-scope-text`}
              onChange={setScope}
            />
            <p id={`${ids}-scope-text`} className="m-0 text-small leading-snug text-text-3">
              {scope === 'project'
                ? t('agentEditor.scope.project.text', { project: project.name })
                : t('agentEditor.scope.personal.text')}
            </p>
            {canChangeScope ? null : (
              <p className="m-0 text-small text-text-3">
                {t('agentEditor.scope.creatorOnly', { name: agent.ownerName })}
              </p>
            )}
          </fieldset>

          {agent === null ? (
            <p className="m-0 text-small leading-snug text-text-3">
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
