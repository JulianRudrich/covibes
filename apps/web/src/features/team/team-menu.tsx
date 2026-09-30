import {
  AGENT_KEYS,
  AGENT_MODELS,
  DEFAULT_AGENT_MODEL,
  type AgentKey,
  type AgentModel,
  type ProjectAgent,
} from '@covibes/shared';
import { Check, ChevronDown, Plus, X } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@web/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import { IconButton } from '@web/components/ui/icon-button';
import { Popover, PopoverContent, PopoverTrigger } from '@web/components/ui/popover';
import { Tooltip } from '@web/components/ui/tooltip';

type TeamMenuProps = {
  agents: readonly ProjectAgent[];
  /** Owners and editors add and remove specialists; viewers only see the team. */
  canEdit: boolean;
  /** Only owners choose the model of an agent. */
  canChooseModel: boolean;
  onAdd: (agentKey: AgentKey) => void;
  onRemove: (agentKey: AgentKey) => void;
  onModelChange: (agentKey: AgentKey, model: AgentModel | null) => void;
};

/**
 * The agents of the project in the header (spec 14; handoff: the agent avatars next to the
 * humans). A click opens the team popover (derived look): every agent with name, role and model,
 * removing specialists, and adding the catalog agents that are not in the team yet.
 */
export function TeamMenu({
  agents,
  canEdit,
  canChooseModel,
  onAdd,
  onRemove,
  onModelChange,
}: TeamMenuProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const inTeam = new Set(agents.map((agent) => agent.key));
  const available = AGENT_KEYS.filter((key) => !inTeam.has(key));
  const names = agents.map((agent) => t(`agents.${agent.key}`)).join(', ');

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t('team.open', { names })}
        className="flex cursor-pointer items-center gap-[3px] rounded-btn-s p-0.5 hover:bg-bg-hover-app focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        {agents.map((agent) => (
          <Tooltip key={agent.key} content={t(`agents.${agent.key}`)}>
            <span className="flex">
              <Avatar
                kind="agent"
                agent={agent.key}
                size={24}
                label={t(`agents.${agent.key}`)}
                initials={t(`agentInitials.${agent.key}`)}
              />
            </span>
          </Tooltip>
        ))}
      </PopoverTrigger>
      <PopoverContent aria-labelledby={titleId} className="w-[360px]">
        <div className="max-h-[min(600px,calc(100dvh-80px))] overflow-y-auto">
          <div className="px-3.5 pt-3 pb-1.5">
            <h2 id={titleId} className="m-0 text-title font-semibold text-text">
              {t('team.title')}
            </h2>
            <p className="m-0 mt-0.5 text-small text-text-3">{t('team.hint')}</p>
          </div>
          <ul className="m-0 list-none px-1.5 pb-1.5">
            {agents.map((agent) => {
              const name = t(`agents.${agent.key}`);
              return (
                <li key={agent.key} className="flex items-center gap-2.5 rounded-sm px-2 py-1.5">
                  <AgentLine agentKey={agent.key} />
                  <ModelChoice
                    name={name}
                    model={agent.model}
                    canChoose={canChooseModel}
                    onChange={(model) => {
                      onModelChange(agent.key, model);
                    }}
                  />
                  {canEdit && agent.key !== 'moderator' ? (
                    <Tooltip content={t('team.remove')}>
                      <IconButton
                        aria-label={t('team.removeAgent', { name })}
                        className="-mr-1 size-6"
                        onClick={() => {
                          onRemove(agent.key);
                        }}
                      >
                        <X size={14} aria-hidden="true" />
                      </IconButton>
                    </Tooltip>
                  ) : canEdit ? (
                    // Keeps the models of all rows in one column.
                    <span aria-hidden="true" className="-mr-1 size-6 shrink-0" />
                  ) : null}
                </li>
              );
            })}
          </ul>
          {canEdit ? (
            <div className="border-t border-border-subtle px-1.5 py-1.5">
              <h3 className="m-0 px-2 pt-1 pb-1 text-meta font-medium text-text-3">
                {t('team.add')}
              </h3>
              {available.length > 0 ? (
                <ul className="m-0 list-none p-0">
                  {available.map((key) => (
                    <li key={key}>
                      <button
                        type="button"
                        aria-label={t('team.addAgent', { name: t(`agents.${key}`) })}
                        className="flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-left hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-ink"
                        onClick={() => {
                          onAdd(key);
                        }}
                      >
                        <AgentLine agentKey={key} />
                        <Plus size={14} className="shrink-0 text-text-3" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 px-2 pb-1.5 text-small text-text-3">{t('team.allAdded')}</p>
              )}
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Avatar, name and role of an agent. */
function AgentLine({ agentKey }: { agentKey: AgentKey }) {
  const { t } = useTranslation();
  const name = t(`agents.${agentKey}`);
  return (
    <>
      <Avatar
        kind="agent"
        agent={agentKey}
        size={26}
        label={name}
        initials={t(`agentInitials.${agentKey}`)}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui font-medium text-text">{name}</span>
        <span className="truncate text-meta text-text-3">{t(`agentRoles.${agentKey}`)}</span>
      </span>
    </>
  );
}

/** The agent's model: a menu for owners, plain text for everyone else. */
function ModelChoice({
  name,
  model,
  canChoose,
  onChange,
}: {
  name: string;
  model: AgentModel | null;
  canChoose: boolean;
  onChange: (model: AgentModel | null) => void;
}) {
  const { t } = useTranslation();
  const current = model ?? DEFAULT_AGENT_MODEL;
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
        className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-sm px-1.5 text-meta text-text-2b hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-ink"
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
                // The default is stored as "no choice", so it follows a later catalog default.
                onChange(option === DEFAULT_AGENT_MODEL ? null : option);
              }}
            >
              {option === DEFAULT_AGENT_MODEL
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
