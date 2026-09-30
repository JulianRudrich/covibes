import type { AgentKey } from '@covibes/shared';
import type { NodeProps } from '@xyflow/react';
import { Check, Lock } from 'lucide-react';
import {
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@web/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import { useBlockActions } from '@web/features/canvas/block-actions';
import { BLOCK_TYPE_CHOICES, blockIcon } from '@web/features/canvas/block-types';
import {
  justDrawnRemainingMs,
  type BlockFlowNode,
  type BlockNodeData,
} from '@web/features/canvas/flow-mapping';
import { cn } from '@web/lib/cn';
import { aiRing } from '@web/lib/styles';

// Agent colors as complete class names, so Tailwind finds them.
const AGENT_BORDER: Record<AgentKey, string> = {
  moderator: 'border-agent-moderator',
  backend: 'border-agent-backend',
  critic: 'border-agent-critic',
  data: 'border-agent-data',
};

const AGENT_BACKGROUND: Record<AgentKey, string> = {
  moderator: 'bg-agent-moderator',
  backend: 'bg-agent-backend',
  critic: 'bg-agent-critic',
  data: 'bg-agent-data',
};

/** Icon tile of a block an agent just changed: agent tint, agent border, icon in the dark color. */
const AGENT_TILE: Record<AgentKey, string> = {
  moderator: 'border-agent-moderator-border bg-agent-moderator-tint text-agent-moderator-dark',
  backend: 'border-agent-backend-border bg-agent-backend-tint text-agent-backend-dark',
  critic: 'border-agent-critic-border bg-agent-critic-tint text-agent-critic-dark',
  data: 'border-agent-data-border bg-agent-data-tint text-agent-data-dark',
};

const AGENT_DARK_TEXT: Record<AgentKey, string> = {
  moderator: 'text-agent-moderator-dark',
  backend: 'text-agent-backend-dark',
  critic: 'text-agent-critic-dark',
  data: 'text-agent-data-dark',
};

const AGENT_TINT_BORDER: Record<AgentKey, string> = {
  moderator: 'border-agent-moderator-tint',
  backend: 'border-agent-backend-tint',
  critic: 'border-agent-critic-tint',
  data: 'border-agent-data-tint',
};

/**
 * A block on the canvas as in the handoff (spec 08): icon tile, title, subtitle and author line.
 * It shows who is editing it (locked), that an agent just changed it (spec 07) or that it is
 * selected. The own client edits title and subtitle in place, and the icon tile of a selected
 * block opens the type menu.
 */
export function BlockNode({ id, data, selected }: NodeProps<BlockFlowNode>) {
  const { t } = useTranslation();
  const actions = useBlockActions();
  const justDrawnBy = useJustDrawnBy(data);
  const lockedBy = data.lockedBy;
  // A person editing the block counts more than an agent's change a moment ago.
  const agent = lockedBy ? null : justDrawnBy;
  const editing = actions.editingId === id;
  const canChange = !actions.readOnly && !lockedBy;
  const pillAgent = data.changedByAgent;
  const Icon = blockIcon(data.blockType);

  return (
    <div
      className={cn(
        'relative flex h-[96px] w-[180px] flex-col rounded-panel transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none',
        lockedBy
          ? 'cursor-not-allowed border-[1.5px] border-human bg-bg-locked shadow-lock'
          : agent
            ? cn('border-[1.5px] bg-bg-panel', AGENT_BORDER[agent])
            : 'border border-border-block bg-bg-panel shadow-block',
        selected && !lockedBy && 'outline-2 outline-offset-2 outline-ink',
      )}
      style={agent ? { boxShadow: aiRing(agent) } : undefined}
    >
      {/* Stays mounted after an agent change, so it can fade out together with border and ring. */}
      {pillAgent ? (
        <div
          className={cn(
            'absolute -top-[27px] -right-[1.5px] flex h-[22px] items-center gap-[5px] rounded-sm pr-2 pl-1.5 text-meta font-medium whitespace-nowrap text-on-ink transition-[opacity,visibility] duration-200 motion-reduce:transition-none',
            AGENT_BACKGROUND[pillAgent],
            !agent && 'invisible opacity-0',
          )}
        >
          <Sparkle />
          {t('canvas.justDrawn')}
        </div>
      ) : null}
      {lockedBy ? (
        <div className="absolute -top-[27px] -left-[1.5px] flex h-[22px] items-center gap-1.5 rounded-sm bg-human pr-2 pl-1.5 text-meta font-medium whitespace-nowrap text-on-ink">
          <Lock size={11} strokeWidth={2.4} aria-hidden="true" />
          {t('canvas.isEditing', { name: lockedBy.name })}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 items-center gap-2.5 px-3">
        <TypeMenu id={id} blockType={data.blockType} enabled={selected && canChange && !editing}>
          <span
            className={cn(
              'grid size-[30px] shrink-0 place-items-center rounded-md border',
              lockedBy
                ? 'border-border-soft bg-border-subtle text-text-2'
                : agent
                  ? AGENT_TILE[agent]
                  : 'border-border-soft bg-bg-subtle text-text-2',
            )}
          >
            <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
          </span>
        </TypeMenu>
        {editing ? (
          <BlockEditor id={id} label={data.label} subtitle={data.subtitle} />
        ) : (
          <div className="min-w-0">
            <div className="flex items-center text-body leading-snug font-semibold text-text">
              <span className="truncate">{data.label}</span>
              {lockedBy ? (
                <span
                  className="ml-0.5 inline-block h-[15px] w-0.5 shrink-0 animate-caret-blink bg-human"
                  aria-hidden="true"
                />
              ) : null}
            </div>
            {data.subtitle ? (
              <div
                className={cn('truncate text-meta', agent ? AGENT_DARK_TEXT[agent] : 'text-text-3')}
              >
                {data.subtitle}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <AuthorLine data={data} agent={agent} />
    </div>
  );
}

function AuthorLine({ data, agent }: { data: BlockNodeData; agent: AgentKey | null }) {
  const { authorOf } = useBlockActions();
  const { createdBy } = data;
  const { name, initials } = authorOf(createdBy);
  return (
    <div
      className={cn(
        'flex h-[30px] shrink-0 items-center gap-1.5 border-t px-3 text-meta',
        agent ? AGENT_TINT_BORDER[agent] : 'border-border-subtle',
      )}
    >
      {createdBy.kind === 'agent' ? (
        <>
          <Avatar
            kind="agent"
            agent={createdBy.agentKey}
            size={16}
            label={name}
            initials={initials}
          />
          <span className={cn('truncate font-medium', AGENT_DARK_TEXT[createdBy.agentKey])}>
            {name}
          </span>
        </>
      ) : (
        <>
          <Avatar kind="human" size={16} label={name} initials={initials} />
          <span className="truncate text-text-2b">{name}</span>
        </>
      )}
    </div>
  );
}

/** The icon tile of a selected block that may be changed opens the menu of block types. */
function TypeMenu({
  id,
  blockType,
  enabled,
  children,
}: {
  id: string;
  blockType: string | null;
  enabled: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { setType } = useBlockActions();
  if (!enabled) return children;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="nodrag shrink-0 cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        aria-label={t('canvas.changeType')}
      >
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        {BLOCK_TYPE_CHOICES.map((choice) => {
          const ChoiceIcon = blockIcon(choice);
          return (
            <DropdownMenuItem
              key={choice ?? 'generic'}
              onSelect={() => {
                setType(id, choice);
              }}
            >
              <ChoiceIcon size={15} strokeWidth={1.8} className="text-text-2" aria-hidden="true" />
              {t(`canvas.blockTypes.${choice ?? 'generic'}`)}
              {choice === blockType ? (
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

/**
 * Title and subtitle as inputs in the block's own typography. Enter or leaving the block saves,
 * Escape cancels; an empty title is not saved.
 */
function BlockEditor({ id, label, subtitle }: { id: string; label: string; subtitle: string }) {
  const { t } = useTranslation();
  const { finishEditing } = useBlockActions();
  const [draftLabel, setDraftLabel] = useState(label);
  const [draftSubtitle, setDraftSubtitle] = useState(subtitle);
  const done = useRef(false);
  const titleInput = useRef<HTMLInputElement>(null);

  // Focus moves into the block when editing starts, with the title selected for overwriting.
  useLayoutEffect(() => {
    titleInput.current?.focus();
    titleInput.current?.select();
  }, []);

  function finish(save: boolean) {
    if (done.current) return;
    done.current = true;
    finishEditing(id, save ? { label: draftLabel, subtitle: draftSubtitle } : null);
  }

  function onKeyDown(event: KeyboardEvent) {
    // Keys typed here belong to the inputs, not to the canvas (e.g. Backspace would delete).
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    finish(true);
  }

  return (
    <div className="nodrag min-w-0 flex-1" onBlur={onBlur} onKeyDown={onKeyDown}>
      <input
        ref={titleInput}
        value={draftLabel}
        maxLength={200}
        aria-label={t('canvas.blockTitle')}
        onChange={(event) => {
          setDraftLabel(event.target.value);
        }}
        className="block w-full min-w-0 bg-transparent p-0 text-body leading-snug font-semibold text-text outline-none"
      />
      <input
        value={draftSubtitle}
        maxLength={200}
        aria-label={t('canvas.blockSubtitle')}
        placeholder={t('canvas.blockSubtitle')}
        onChange={(event) => {
          setDraftSubtitle(event.target.value);
        }}
        className="block w-full min-w-0 bg-transparent p-0 text-meta text-text-3 outline-none placeholder:text-text-4"
      />
    </div>
  );
}

/**
 * The agent whose change the block currently shows as "just drawn", or null. A timer ends the
 * state once the rest of the 5 s has passed; a change that ran out stays over, so a later check
 * cannot bring it back. The layout effect runs before paint, so an agent change that arrives
 * already old (e.g. after a reconnect) never flashes up.
 */
function useJustDrawnBy(data: BlockNodeData): AgentKey | null {
  const { changedByAgent, lastChangedAt } = data;
  const [overAt, setOverAt] = useState(() =>
    justDrawnRemainingMs(data, Date.now()) > 0 ? null : lastChangedAt,
  );

  useLayoutEffect(() => {
    if (changedByAgent === null) return;
    const remaining = justDrawnRemainingMs({ changedByAgent, lastChangedAt }, Date.now());
    if (remaining === 0) {
      setOverAt(lastChangedAt);
      return;
    }
    const timer = setTimeout(() => {
      setOverAt(lastChangedAt);
    }, remaining);
    return () => {
      clearTimeout(timer);
    };
  }, [changedByAgent, lastChangedAt]);

  return overAt === lastChangedAt ? null : changedByAgent;
}

/** The AI marker from the handoff: a filled four-pointed star, 12 px. */
function Sparkle() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3c.5 4.8 3.2 7.5 8 8-4.8.5-7.5 3.2-8 8-.5-4.8-3.2-7.5-8-8 4.8-.5 7.5-3.2 8-8z" />
    </svg>
  );
}
