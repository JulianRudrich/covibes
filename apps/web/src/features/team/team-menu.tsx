import {
  AGENT_KEYS,
  AGENT_MODELS,
  agentInitials,
  DEFAULT_AGENT_MODEL,
  mentionHandle,
  type AgentModel,
  type CustomAgent,
  type ProjectAgent,
} from '@covibes/shared';
import { Check, ChevronDown, Pencil, Plus, X } from 'lucide-react';
import { useId, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import { IconButton } from '@web/components/ui/icon-button';
import { Popover, PopoverContent, PopoverTrigger } from '@web/components/ui/popover';
import { Tooltip } from '@web/components/ui/tooltip';
import { AgentAvatar } from '@web/features/agents/agent-avatar';
import { agentColor, useAgents, type AgentInfo } from '@web/features/agents/agents';
import { HandBadge } from '@web/features/hands/hand-badge';
import { cn } from '@web/lib/cn';

type TeamMenuProps = {
  agents: readonly ProjectAgent[];
  /** Owners and editors add and remove specialists; viewers only see the team. */
  canEdit: boolean;
  /** Only owners choose the model of an agent. */
  canChooseModel: boolean;
  onAdd: (agentKey: string) => void;
  onRemove: (agentKey: string) => void;
  onModelChange: (agentKey: string, model: AgentModel | null) => void;
  /**
   * The custom agents the user can use here (spec 19): their personal ones and those shared in the
   * project. Those among them the user may edit get "Bearbeiten".
   */
  customAgents?: readonly CustomAgent[];
  /** The signed-in user, who edits their own personal agents. */
  userId?: string;
  /** Opens the agent editor for a new agent, or for an existing one. */
  onCreateAgent?: () => void;
  onEditAgent?: (agent: CustomAgent) => void;
  /** The agent that is writing in the chat right now: its mark glows (handoff "Im Raum"). */
  writing?: string | null;
  /** The agents with a raised hand: their marks carry the hand badge. */
  raising?: ReadonlySet<string>;
};

const NO_CUSTOM_AGENTS: readonly CustomAgent[] = [];
const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * The agents of the project in the header (spec 14; handoff: the agent avatars next to the
 * humans). A click opens the team popover (derived look): every agent with name, role and model,
 * removing specialists, and adding agents that are not in the team yet: catalog agents and the
 * custom agents the user can use (spec 19). Custom agents are created and edited from here.
 */
export function TeamMenu({
  agents,
  canEdit,
  canChooseModel,
  onAdd,
  onRemove,
  onModelChange,
  customAgents = NO_CUSTOM_AGENTS,
  userId,
  onCreateAgent,
  onEditAgent,
  writing = null,
  raising = NO_KEYS,
}: TeamMenuProps) {
  const { t } = useTranslation();
  const fromDirectory = useAgents();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const inTeam = new Set(agents.map((agent) => agent.key));
  const available = AGENT_KEYS.filter((key) => !inTeam.has(key));
  const availableCustom = customAgents.filter((agent) => !inTeam.has(agent.key));
  /**
   * A personal agent of the user is not in the project's directory until the project knows it is
   * in the team, so it is also resolved from the list of usable agents.
   */
  const resolve = (key: string): AgentInfo => {
    const agent = fromDirectory(key);
    const custom = customAgents.find((entry) => entry.key === key);
    if (agent.custom || !custom) return agent;
    return {
      ...agent,
      name: custom.name,
      initials: agentInitials(custom.name),
      role: custom.role,
      mention: mentionHandle(custom.name),
      color: custom.color,
      custom,
    };
  };
  const team = agents.map((agent) => ({ ...agent, info: resolve(agent.key) }));
  const names = team.map((agent) => agent.info.name).join(', ');
  // What the user may edit: their own personal agents, and shared agents as owner or editor.
  const editable = new Map(
    customAgents
      .filter((agent) => (agent.scope === 'personal' ? agent.ownerId === userId : canEdit))
      .map((agent) => [agent.key, agent]),
  );

  /** Opens the editor; the popover makes room for it. */
  function edit(agent: CustomAgent | null) {
    setOpen(false);
    if (agent) onEditAgent?.(agent);
    else onCreateAgent?.();
  }

  function editButton(agentKey: string, name: string) {
    const agent = onEditAgent ? editable.get(agentKey) : undefined;
    if (!agent) return null;
    return (
      <Tooltip content={t('team.edit')}>
        <IconButton
          aria-label={t('team.editAgent', { name })}
          className="size-6"
          onClick={() => {
            edit(agent);
          }}
        >
          <Pencil size={13} aria-hidden="true" />
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={t('team.open', { names })}
        className="flex cursor-pointer items-center rounded-[10px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
      >
        {team.map((agent, index) => {
          const { name } = agent.info;
          const isWriting = agent.key === writing;
          const hand = raising.has(agent.key);
          const label = isWriting
            ? t('chat.typing', { name })
            : hand
              ? t('hands.raises', { name })
              : name;
          return (
            <Tooltip key={agent.key} content={label}>
              <span className={cn('relative flex', index > 0 && '-ml-1.5')}>
                <AgentAvatar
                  agent={agent.info}
                  size={30}
                  className={cn(
                    'ring-[2.5px] ring-bg-panel',
                    isWriting && 'animate-glow motion-reduce:animate-none',
                  )}
                  style={
                    isWriting
                      ? ({
                          '--glow': `color-mix(in srgb, ${agentColor(agent.info)} 55%, transparent)`,
                          '--glow-gap': 'var(--color-bg-panel)',
                        } as CSSProperties)
                      : undefined
                  }
                />
                {hand ? <HandBadge agent={agent.info} /> : null}
              </span>
            </Tooltip>
          );
        })}
      </PopoverTrigger>
      <PopoverContent aria-labelledby={titleId} className="w-[380px]">
        <div className="max-h-[min(600px,calc(100dvh-80px))] overflow-y-auto">
          <div className="px-3.5 pt-3 pb-1.5">
            <h2 id={titleId} className="m-0 text-title font-semibold text-text">
              {t('team.title')}
            </h2>
            <p className="m-0 mt-0.5 text-small text-text-3">{t('team.hint')}</p>
          </div>
          <ul className="m-0 list-none px-1.5 pb-1.5">
            {team.map((agent) => {
              const { name } = agent.info;
              return (
                <li key={agent.key} className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
                  <AgentLine agent={agent.info} />
                  <ModelChoice
                    name={name}
                    model={agent.model}
                    // A custom agent brings its own default model.
                    defaultModel={agent.info.custom?.model ?? DEFAULT_AGENT_MODEL}
                    canChoose={canChooseModel}
                    onChange={(model) => {
                      onModelChange(agent.key, model);
                    }}
                  />
                  <span className="-mr-1 flex shrink-0 items-center">
                    {editButton(agent.key, name)}
                    {canEdit && agent.key !== 'moderator' ? (
                      <Tooltip content={t('team.remove')}>
                        <IconButton
                          aria-label={t('team.removeAgent', { name })}
                          className="size-6"
                          onClick={() => {
                            onRemove(agent.key);
                          }}
                        >
                          <X size={14} aria-hidden="true" />
                        </IconButton>
                      </Tooltip>
                    ) : canEdit ? (
                      // Keeps the models of all rows in one column.
                      <span aria-hidden="true" className="size-6 shrink-0" />
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {canEdit ? (
            <div className="border-t border-border-subtle px-1.5 py-1.5">
              <h3 className="m-0 px-2 pt-1 pb-1 text-meta font-medium text-text-3">
                {t('team.add')}
              </h3>
              {available.length + availableCustom.length > 0 ? (
                <ul className="m-0 list-none p-0">
                  {[...available, ...availableCustom.map((agent) => agent.key)].map((key) => {
                    const agent = resolve(key);
                    return (
                      <li key={key} className="flex items-center gap-0.5">
                        <button
                          type="button"
                          aria-label={t('team.addAgent', { name: agent.name })}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-ink"
                          onClick={() => {
                            onAdd(key);
                          }}
                        >
                          <AgentLine agent={agent} />
                          <Plus size={14} className="shrink-0 text-text-3" aria-hidden="true" />
                        </button>
                        {editButton(key, agent.name)}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="m-0 px-2 pb-1.5 text-small text-text-3">{t('team.allAdded')}</p>
              )}
              {onCreateAgent ? (
                <button
                  type="button"
                  className="mt-0.5 flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-ui font-medium text-text hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-ink"
                  onClick={() => {
                    edit(null);
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="grid size-[26px] shrink-0 place-items-center rounded-btn-s border border-dashed border-border-strong text-text-3"
                  >
                    <Plus size={14} />
                  </span>
                  {t('team.createAgent')}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Avatar, name and role of an agent; a custom agent says whether it is personal or shared. */
function AgentLine({ agent }: { agent: AgentInfo }) {
  const { t } = useTranslation();
  const scope = agent.custom
    ? t(agent.custom.scope === 'personal' ? 'team.personal' : 'team.shared')
    : null;
  return (
    <>
      <AgentAvatar agent={agent} size={26} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui font-medium text-text">{agent.name}</span>
        <span className="truncate text-meta text-text-3">
          {[agent.role, scope].filter((part) => part).join(' · ')}
        </span>
      </span>
    </>
  );
}

/** The agent's model: a menu for owners, plain text for everyone else. */
function ModelChoice({
  name,
  model,
  defaultModel,
  canChoose,
  onChange,
}: {
  name: string;
  model: AgentModel | null;
  /** What the agent uses unless the project chose another model. */
  defaultModel: AgentModel;
  canChoose: boolean;
  onChange: (model: AgentModel | null) => void;
}) {
  const { t } = useTranslation();
  const current = model ?? defaultModel;
  const label = t(`team.models.${current}`);
  if (!canChoose) {
    return (
      <span
        className="shrink-0 text-meta text-text-3"
        aria-label={t('team.modelOf', { name, model: label })}
      >
        {label}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('team.modelOf', { name, model: label })}
        className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 text-meta text-text-2b hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-ink"
      >
        {label}
        <ChevronDown size={12} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {AGENT_MODELS.map((option) => {
          const optionLabel = t(`team.models.${option}`);
          return (
            <DropdownMenuItem
              key={option}
              role="menuitemradio"
              aria-checked={option === current}
              onSelect={() => {
                // The default is stored as "no choice", so it follows a later default.
                onChange(option === defaultModel ? null : option);
              }}
            >
              {option === defaultModel
                ? t('team.defaultModel', { model: optionLabel })
                : optionLabel}
              {option === current ? (
                <Check
                  size={14}
                  strokeWidth={2}
                  className="ml-auto text-text-2"
                  aria-hidden="true"
                />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
