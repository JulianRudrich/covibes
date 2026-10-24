import { ENTITY_VISIBLE_FIELDS, type EntityField } from '@covibes/shared';
import type { NodeProps } from '@xyflow/react';
import { Check } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@web/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import { AgentAvatar } from '@web/features/agents/agent-avatar';
import { agentClass, useAgents, type AgentInfo } from '@web/features/agents/agents';
import {
  AGENT_BORDER,
  AGENT_DARK_TEXT,
  AGENT_TILE,
  AGENT_TINT_BORDER,
} from '@web/features/canvas/agent-look';
import { blockIcon, blockTypeGroups } from '@web/features/canvas/block-types';
import { useCanvasActions } from '@web/features/canvas/canvas-actions';
import { ArrowAnchors, ConnectionHandles } from '@web/features/canvas/connection-handles';
import { fieldLines, parseFieldLines } from '@web/features/canvas/entity-fields';
import type { BlockFlowNode, BlockNodeData } from '@web/features/canvas/flow-mapping';
import { useFocusOnMount, useInPlaceEditing } from '@web/features/canvas/in-place-editing';
import { EditCaret, JustDrawnPill, LockPill } from '@web/features/canvas/node-chrome';
import { useJustDrawnBy } from '@web/features/canvas/use-just-drawn';
import { cn } from '@web/lib/cn';
import { aiRing } from '@web/lib/styles';

/**
 * A block on the canvas as in the handoff (spec 08): icon tile, title, subtitle and author line;
 * an entity also lists its fields (spec 12). It shows who is editing it (locked), that an agent
 * just changed it (spec 07) or that it is selected. The own client edits title and subtitle (and
 * fields) in place, the icon tile of a selected block opens the type menu, and the points at its
 * edges start arrows (spec 09).
 */
export function BlockNode({ id, data, selected }: NodeProps<BlockFlowNode>) {
  const actions = useCanvasActions();
  const agents = useAgents();
  const justDrawnBy = useJustDrawnBy(data);
  const lockedBy = data.lockedBy;
  // A person editing the block counts more than an agent's change a moment ago.
  const agent = lockedBy || !justDrawnBy ? null : agents(justDrawnBy);
  const editing = actions.editingId === id;
  const canChange = !actions.readOnly && !lockedBy;
  const Icon = blockIcon(data.blockType);
  const entity = data.blockType === 'entity';
  const tile = (
    <span
      className={cn(
        'grid size-[30px] shrink-0 place-items-center rounded-md border',
        lockedBy
          ? 'border-border-soft bg-border-subtle text-text-2'
          : agent
            ? agentClass(AGENT_TILE, agent)
            : 'border-border-soft bg-bg-subtle text-text-2',
      )}
    >
      <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
    </span>
  );

  return (
    <div
      className={cn(
        'group relative flex w-[180px] flex-col rounded-panel transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none',
        lockedBy
          ? 'cursor-not-allowed border-[1.5px] border-human bg-bg-locked shadow-lock'
          : agent
            ? cn('border-[1.5px] bg-bg-panel', agentClass(AGENT_BORDER, agent))
            : 'border border-border-block bg-bg-panel shadow-block',
        selected && !lockedBy && 'outline-2 outline-offset-2 outline-ink',
      )}
      // The stored size includes the fields of an entity; while they are edited, the block grows
      // with the text field.
      style={{
        ...(editing && entity ? { minHeight: data.size.height } : { height: data.size.height }),
        ...(agent ? { boxShadow: aiRing(agent) } : {}),
      }}
    >
      {data.changedByAgent ? (
        <JustDrawnPill agent={data.changedByAgent} visible={agent !== null} />
      ) : null}
      {lockedBy ? <LockPill name={lockedBy.name} /> : null}

      {editing ? (
        <BlockEditor id={id} data={data} tile={tile} />
      ) : (
        <>
          <div className="flex h-[66px] shrink-0 items-center gap-2.5 px-3">
            <TypeMenu
              id={id}
              blockType={data.blockType}
              diagramType={data.diagramType}
              enabled={selected && canChange}
            >
              {tile}
            </TypeMenu>
            <div className="min-w-0">
              <div className="flex items-center text-body leading-snug font-semibold text-text">
                <span className="truncate">{data.label}</span>
                {lockedBy ? <EditCaret /> : null}
              </div>
              {data.subtitle ? (
                <div
                  className={cn(
                    'truncate text-meta',
                    agent ? agentClass(AGENT_DARK_TEXT, agent) : 'text-text-3',
                  )}
                >
                  {data.subtitle}
                </div>
              ) : null}
            </div>
          </div>
          {entity && data.fields.length > 0 ? (
            <EntityFields fields={data.fields} agent={agent} />
          ) : null}
        </>
      )}

      <AuthorLine data={data} agent={agent} />
      <ArrowAnchors />
      {canChange && !editing ? (
        <ConnectionHandles nodeId={id} selected={selected} anywhere={actions.tool === 'connect'} />
      ) : null}
    </div>
  );
}

function AuthorLine({ data, agent }: { data: BlockNodeData; agent: AgentInfo | null }) {
  const { authorOf } = useCanvasActions();
  const agents = useAgents();
  const { createdBy } = data;
  const { name, initials } = authorOf(createdBy);
  const author = createdBy.kind === 'agent' ? agents(createdBy.agentKey) : null;
  return (
    <div
      className={cn(
        'mt-auto flex h-[30px] shrink-0 items-center gap-1.5 border-t px-3 text-meta',
        agent ? agentClass(AGENT_TINT_BORDER, agent) : 'border-border-subtle',
      )}
    >
      {author ? (
        <>
          <AgentAvatar agent={author} size={16} />
          <span className={cn('truncate font-medium', agentClass(AGENT_DARK_TEXT, author))}>
            {author.name}
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

/**
 * The fields of an entity in the mono font, name left and type right (spec 12); after 8 fields a row
 * says how many more there are.
 */
function EntityFields({ fields, agent }: { fields: EntityField[]; agent: AgentInfo | null }) {
  const { t } = useTranslation();
  const shown = fields.slice(0, ENTITY_VISIBLE_FIELDS);
  const more = fields.length - shown.length;
  return (
    <ul
      aria-label={t('canvas.entityFields')}
      className={cn(
        // 3 px + 4 px padding and the 1 px border: the 8 px the model reserves (`blockSize`).
        'm-0 flex list-none flex-col border-t px-3 pt-[3px] pb-1 font-mono text-badge',
        agent ? agentClass(AGENT_TINT_BORDER, agent) : 'border-border-subtle',
      )}
    >
      {shown.map((field, index) => (
        <li key={`${String(index)}-${field.name}`} className="flex h-[22px] items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-text-body">{field.name}</span>
          {field.type ? (
            <span className="max-w-[55%] shrink-0 truncate text-text-3">{field.type}</span>
          ) : null}
        </li>
      ))}
      {more > 0 ? (
        <li className="flex h-[22px] items-center text-text-3">
          {t('canvas.moreFields', { count: more })}
        </li>
      ) : null}
    </ul>
  );
}

/**
 * The icon tile of a selected block that may be changed opens the menu of block types: in a
 * typed frame the types of its diagram, anywhere else all types by diagram (spec 12).
 */
function TypeMenu({
  id,
  blockType,
  diagramType,
  enabled,
  children,
}: {
  id: string;
  blockType: string | null;
  diagramType: string | null;
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
      <DropdownMenuContent
        align="start"
        className="max-h-[min(440px,var(--radix-dropdown-menu-content-available-height))] min-w-[180px] overflow-y-auto"
      >
        {blockTypeGroups(diagramType).map((group) => (
          <Fragment key={group.diagram ?? 'generic'}>
            {group.diagram ? (
              <DropdownMenuLabel>{t(`canvas.diagramTypes.${group.diagram}`)}</DropdownMenuLabel>
            ) : null}
            {group.types.map((choice) => {
              const ChoiceIcon = blockIcon(choice);
              return (
                <DropdownMenuItem
                  key={choice ?? 'generic'}
                  onSelect={() => {
                    setType(id, choice);
                  }}
                >
                  <ChoiceIcon
                    size={15}
                    strokeWidth={1.8}
                    className="text-text-2"
                    aria-hidden="true"
                  />
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
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Title and subtitle as inputs in the block's own typography, for an entity also its fields, one
 * per line (spec 12). Enter (in the fields Ctrl or Cmd + Enter) or leaving the block saves, Escape
 * cancels; an empty title is not saved.
 */
function BlockEditor({ id, data, tile }: { id: string; data: BlockNodeData; tile: ReactNode }) {
  const { t } = useTranslation();
  const { finishEditing } = useCanvasActions();
  const entity = data.blockType === 'entity';
  const [draftLabel, setDraftLabel] = useState(data.label);
  const [draftSubtitle, setDraftSubtitle] = useState(data.subtitle);
  const [draftFields, setDraftFields] = useState(() => fieldLines(data.fields));
  const { onKeyDown, onBlur } = useInPlaceEditing((save) => {
    finishEditing(
      id,
      save
        ? {
            label: draftLabel,
            subtitle: draftSubtitle,
            ...(entity ? { fields: parseFieldLines(draftFields) } : {}),
          }
        : null,
    );
  });
  const titleInput = useFocusOnMount<HTMLInputElement>();

  return (
    <div className="nodrag flex min-h-0 flex-1 flex-col" onBlur={onBlur} onKeyDown={onKeyDown}>
      <div className="flex h-[66px] shrink-0 items-center gap-2.5 px-3">
        {tile}
        <div className="min-w-0 flex-1">
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
      </div>
      {entity ? (
        <textarea
          value={draftFields}
          rows={Math.max(3, draftFields.split('\n').length + 1)}
          aria-label={t('canvas.entityFields')}
          placeholder={t('canvas.entityFieldsPlaceholder')}
          onChange={(event) => {
            setDraftFields(event.target.value);
          }}
          onKeyDown={(event) => {
            // A plain Enter starts the next field; Ctrl or Cmd + Enter saves like elsewhere.
            if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) event.stopPropagation();
          }}
          className="block w-full resize-none border-t border-border-subtle bg-transparent px-3 pt-[3px] pb-1 font-mono text-badge leading-[22px] text-text-body outline-none placeholder:text-text-4"
        />
      ) : null}
    </div>
  );
}
