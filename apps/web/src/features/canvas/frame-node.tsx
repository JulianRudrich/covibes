import { FRAME_MIN_SIZE } from '@covibes/shared';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { Frame } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AGENT_BORDER } from '@web/features/canvas/agent-look';
import { useCanvasActions } from '@web/features/canvas/canvas-actions';
import type { FrameFlowNode } from '@web/features/canvas/flow-mapping';
import { useFocusOnMount, useInPlaceEditing } from '@web/features/canvas/in-place-editing';
import { EditCaret, JustDrawnPill, LockPill } from '@web/features/canvas/node-chrome';
import { useJustDrawnBy } from '@web/features/canvas/use-just-drawn';
import { cn } from '@web/lib/cn';
import { aiRing } from '@web/lib/styles';

/**
 * A frame, a labeled area that holds a diagram (spec 09, handoff "Frame 'Architecture'"). It lies
 * below everything else; a selected frame can be resized at its corners.
 */
export function FrameNode({ id, data, selected }: NodeProps<FrameFlowNode>) {
  const { t } = useTranslation();
  const actions = useCanvasActions();
  const justDrawnBy = useJustDrawnBy(data);
  const lockedBy = data.lockedBy;
  const agent = lockedBy ? null : justDrawnBy;
  const editing = actions.editingId === id;
  const canChange = !actions.readOnly && !lockedBy;

  return (
    <div
      className={cn(
        'relative size-full rounded-frame bg-bg-panel/55 transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none',
        lockedBy
          ? 'border-[1.5px] border-human'
          : agent
            ? cn('border-[1.5px]', AGENT_BORDER[agent])
            : 'border border-frame-border',
        selected && !lockedBy && 'outline-2 outline-offset-2 outline-ink',
      )}
      style={agent ? { boxShadow: aiRing(agent) } : undefined}
    >
      <NodeResizer
        isVisible={selected && canChange && !editing}
        minWidth={FRAME_MIN_SIZE.width}
        minHeight={FRAME_MIN_SIZE.height}
        onResizeStart={() => {
          actions.beginChange();
        }}
        onResize={(_, bounds) => {
          actions.resizeFrame(id, bounds);
        }}
        lineClassName="!border-transparent"
        handleClassName="!size-2.5 !rounded-xs !border-2 !border-bg-panel !bg-ink"
      />
      {data.changedByAgent ? (
        <JustDrawnPill agent={data.changedByAgent} visible={agent !== null} />
      ) : null}
      {lockedBy ? <LockPill name={lockedBy.name} /> : null}

      <div className="absolute top-3 right-3.5 left-3.5 flex items-center gap-2 text-ui">
        <Frame size={14} strokeWidth={2} className="shrink-0 text-text-2b" aria-hidden="true" />
        {editing ? (
          <FrameTitleEditor id={id} title={data.label} />
        ) : (
          <span className="flex min-w-0 items-center font-semibold text-text">
            <span className="truncate">{data.label}</span>
            {lockedBy ? <EditCaret /> : null}
          </span>
        )}
        <span className="shrink-0 text-status text-text-3">
          {t('canvas.blockCount', { count: data.blockCount })}
        </span>
      </div>
    </div>
  );
}

function FrameTitleEditor({ id, title }: { id: string; title: string }) {
  const { t } = useTranslation();
  const { finishEditing } = useCanvasActions();
  const [draft, setDraft] = useState(title);
  const { onKeyDown, onBlur } = useInPlaceEditing((save) => {
    finishEditing(id, save ? { label: draft } : null);
  });
  const input = useFocusOnMount<HTMLInputElement>();

  return (
    <input
      ref={input}
      value={draft}
      maxLength={200}
      aria-label={t('canvas.frameTitle')}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className="nodrag min-w-0 flex-1 bg-transparent p-0 font-semibold text-text outline-none"
    />
  );
}
