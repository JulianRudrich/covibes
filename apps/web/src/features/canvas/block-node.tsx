import type { AgentKey } from '@covibes/shared';
import type { NodeProps } from '@xyflow/react';
import { Check } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@web/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import {
  AGENT_BORDER,
  AGENT_DARK_TEXT,
  AGENT_TILE,
  AGENT_TINT_BORDER,
} from '@web/features/canvas/agent-look';
import { BLOCK_TYPE_CHOICES, blockIcon } from '@web/features/canvas/block-types';
import { useCanvasActions } from '@web/features/canvas/canvas-actions';
import { ArrowAnchors, ConnectionHandles } from '@web/features/canvas/connection-handles';
import type { BlockFlowNode, BlockNodeData } from '@web/features/canvas/flow-mapping';
import { useFocusOnMount, useInPlaceEditing } from '@web/features/canvas/in-place-editing';
import { EditCaret, JustDrawnPill, LockPill } from '@web/features/canvas/node-chrome';
import { useJustDrawnBy } from '@web/features/canvas/use-just-drawn';
import { cn } from '@web/lib/cn';
import { aiRing } from '@web/lib/styles';

/**
 * A block on the canvas as in the handoff (spec 08): icon tile, title, subtitle and author line.
 * It shows who is editing it (locked), that an agent just changed it (spec 07) or that it is
 * selected. The own client edits title and subtitle in place, the icon tile of a selected block
 * opens the type menu, and the points at its edges start arrows (spec 09).
 */
export function BlockNode({ id, data, selected }: NodeProps<BlockFlowNode>) {
  const actions = useCanvasActions();
  const justDrawnBy = useJustDrawnBy(data);
  const lockedBy = data.lockedBy;
  // A person editing the block counts more than an agent's change a moment ago.
  const agent = lockedBy ? null : justDrawnBy;
  const editing = actions.editingId === id;
  const canChange = !actions.readOnly && !lockedBy;
  const Icon = blockIcon(data.blockType);

  return (
    <div
      className={cn(
        'group relative flex h-[96px] w-[180px] flex-col rounded-panel transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none',
        lockedBy
          ? 'cursor-not-allowed border-[1.5px] border-human bg-bg-locked shadow-lock'
          : agent
            ? cn('border-[1.5px] bg-bg-panel', AGENT_BORDER[agent])
            : 'border border-border-block bg-bg-panel shadow-block',
        selected && !lockedBy && 'outline-2 outline-offset-2 outline-ink',
      )}
      style={agent ? { boxShadow: aiRing(agent) } : undefined}
    >
      {data.changedByAgent ? (
        <JustDrawnPill agent={data.changedByAgent} visible={agent !== null} />
      ) : null}
      {lockedBy ? <LockPill name={lockedBy.name} /> : null}

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
              {lockedBy ? <EditCaret /> : null}
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
      <ArrowAnchors />
      {canChange && !editing ? (
        <ConnectionHandles nodeId={id} selected={selected} anywhere={actions.tool === 'connect'} />
      ) : null}
    </div>
  );
}

function AuthorLine({ data, agent }: { data: BlockNodeData; agent: AgentKey | null }) {
  const { authorOf } = useCanvasActions();
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
  const { setType } = useCanvasActions();
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
  const { finishEditing } = useCanvasActions();
  const [draftLabel, setDraftLabel] = useState(label);
  const [draftSubtitle, setDraftSubtitle] = useState(subtitle);
  const { onKeyDown, onBlur } = useInPlaceEditing((save) => {
    finishEditing(id, save ? { label: draftLabel, subtitle: draftSubtitle } : null);
  });
  const titleInput = useFocusOnMount<HTMLInputElement>();

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
