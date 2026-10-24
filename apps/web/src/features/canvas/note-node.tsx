import type { NodeProps } from '@xyflow/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AgentAvatar } from '@web/features/agents/agent-avatar';
import { useAgents } from '@web/features/agents/agents';
import { useCanvasActions } from '@web/features/canvas/canvas-actions';
import type { NoteFlowNode, NoteNodeData } from '@web/features/canvas/flow-mapping';
import { useFocusOnMount, useInPlaceEditing } from '@web/features/canvas/in-place-editing';
import {
  EditCaret,
  JustDrawnOutline,
  JustDrawnPill,
  LockPill,
} from '@web/features/canvas/node-chrome';
import { useJustDrawnBy } from '@web/features/canvas/use-just-drawn';
import { cn } from '@web/lib/cn';
import { aiRing } from '@web/lib/styles';

/**
 * A sticky note for an unfinished thought (spec 09, handoff "Sticky note"): yellow, slightly
 * rotated, with its creator in the footer. It shows locks and agent changes like a block.
 */
export function NoteNode({ id, data, selected }: NodeProps<NoteFlowNode>) {
  const actions = useCanvasActions();
  const agents = useAgents();
  const justDrawnBy = useJustDrawnBy(data);
  const lockedBy = data.lockedBy;
  const agent = lockedBy || !justDrawnBy ? null : agents(justDrawnBy);
  const editing = actions.editingId === id;

  return (
    <div
      className={cn(
        'relative flex h-[124px] w-[176px] flex-col justify-between gap-2 rounded-[6px_6px_22px_6px] bg-note p-4 transition-[box-shadow,transform,rotate] duration-200 motion-reduce:transition-none',
        // Straight while it is written in, so the text does not run askew.
        !editing && '-rotate-2',
        lockedBy
          ? 'cursor-not-allowed shadow-lock'
          : cn(!agent && 'shadow-note', 'hover:-translate-y-0.5'),
        selected && !lockedBy && 'outline-2 outline-offset-2 outline-ink',
      )}
      style={agent ? { boxShadow: aiRing(agent) } : undefined}
    >
      {data.changedByAgent ? (
        <>
          <JustDrawnOutline agent={data.changedByAgent} visible={agent !== null} />
          <JustDrawnPill agent={data.changedByAgent} visible={agent !== null} />
        </>
      ) : null}
      {lockedBy ? <LockPill name={lockedBy.name} /> : null}

      {editing ? (
        <NoteEditor id={id} text={data.label} />
      ) : (
        <div className="line-clamp-3 min-h-0 font-display text-heading leading-snug font-semibold break-words text-note-text">
          {data.label}
          {lockedBy ? <EditCaret /> : null}
        </div>
      )}
      <NoteFooter data={data} />
    </div>
  );
}

function NoteFooter({ data }: { data: NoteNodeData }) {
  const { t } = useTranslation();
  const { authorOf } = useCanvasActions();
  const agents = useAgents();
  const { name, initials } = authorOf(data.createdBy);
  return (
    <div className="flex shrink-0 items-center gap-1.5 text-status text-note-meta">
      {data.createdBy.kind === 'agent' ? (
        <AgentAvatar agent={agents(data.createdBy.agentKey)} size={20} />
      ) : (
        <span
          role="img"
          aria-label={name}
          className="grid size-[18px] shrink-0 place-items-center rounded-full bg-note-avatar text-[9px] font-bold text-note-text"
        >
          <span aria-hidden="true">{initials}</span>
        </span>
      )}
      <span className="truncate">{t('canvas.noteBy', { name })}</span>
    </div>
  );
}

function NoteEditor({ id, text }: { id: string; text: string }) {
  const { t } = useTranslation();
  const { finishEditing } = useCanvasActions();
  const [draft, setDraft] = useState(text);
  const { onKeyDown, onBlur } = useInPlaceEditing((save) => {
    finishEditing(id, save ? { label: draft } : null);
  });
  const input = useFocusOnMount<HTMLTextAreaElement>();

  return (
    <textarea
      ref={input}
      value={draft}
      maxLength={200}
      rows={3}
      aria-label={t('canvas.noteText')}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className="nodrag min-h-0 flex-1 resize-none bg-transparent p-0 font-display text-heading leading-snug font-semibold text-note-text outline-none"
    />
  );
}
