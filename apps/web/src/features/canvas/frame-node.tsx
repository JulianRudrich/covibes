import { FRAME_MIN_SIZE, isDiagramType, ROADMAP_DIAGRAM } from '@covibes/shared';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { Check } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import { agentClass, useAgents } from '@web/features/agents/agents';
import { AGENT_BORDER } from '@web/features/canvas/agent-look';
import { DIAGRAM_TYPE_CHOICES, diagramIcon } from '@web/features/canvas/block-types';
import { useCanvasActions } from '@web/features/canvas/canvas-actions';
import type { FrameFlowNode } from '@web/features/canvas/flow-mapping';
import { useFocusOnMount, useInPlaceEditing } from '@web/features/canvas/in-place-editing';
import { EditCaret, JustDrawnPill, LockPill } from '@web/features/canvas/node-chrome';
import { useJustDrawnBy } from '@web/features/canvas/use-just-drawn';
import { RoadmapFrameContent, RoadmapSummary } from '@web/features/roadmap/roadmap-content';
import { cn } from '@web/lib/cn';
import { aiRing } from '@web/lib/styles';

/**
 * A frame, a labeled area that holds a diagram (spec 09, handoff "Frame 'Architecture'"). It lies
 * below everything else; a selected frame can be resized at its corners. Its header shows the
 * diagram type, which the icon of a selected frame changes (spec 12). A roadmap (spec 26a) shows
 * the plan's milestones instead of blocks; its size and type follow from the plan.
 */
export function FrameNode({ id, data, selected }: NodeProps<FrameFlowNode>) {
  const { t } = useTranslation();
  const actions = useCanvasActions();
  const agents = useAgents();
  const justDrawnBy = useJustDrawnBy(data);
  const lockedBy = data.lockedBy;
  const agent = lockedBy || !justDrawnBy ? null : agents(justDrawnBy);
  const editing = actions.editingId === id;
  const canChange = !actions.readOnly && !lockedBy;
  const Icon = diagramIcon(data.diagramType);
  const isRoadmap = data.diagramType === ROADMAP_DIAGRAM;
  const count = t('canvas.blockCount', { count: data.blockCount });

  return (
    <div
      className={cn(
        'relative size-full rounded-frame bg-bg-panel/55 transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none',
        lockedBy
          ? 'border-[1.5px] border-human'
          : agent
            ? cn('border-[1.5px]', agentClass(AGENT_BORDER, agent))
            : 'border border-frame-border',
        selected && !lockedBy && 'outline-2 outline-offset-2 outline-ink',
      )}
      style={agent ? { boxShadow: aiRing(agent) } : undefined}
    >
      <NodeResizer
        isVisible={selected && canChange && !editing && !isRoadmap}
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
        <DiagramMenu
          id={id}
          diagramType={data.diagramType}
          enabled={selected && canChange && !editing && !isRoadmap}
        >
          <Icon size={14} strokeWidth={2} className="shrink-0 text-text-2b" aria-hidden="true" />
        </DiagramMenu>
        {editing ? (
          <FrameTitleEditor id={id} title={data.label} />
        ) : (
          <span className="flex min-w-0 items-center font-semibold text-text">
            <span className="truncate">{data.label}</span>
            {lockedBy ? <EditCaret /> : null}
          </span>
        )}
        <span className="shrink-0 text-status text-text-3">
          {isRoadmap ? (
            <RoadmapSummary />
          ) : isDiagramType(data.diagramType) ? (
            `${t(`canvas.diagramTypes.${data.diagramType}`)} · ${count}`
          ) : (
            count
          )}
        </span>
      </div>
      {isRoadmap ? <RoadmapFrameContent /> : null}
    </div>
  );
}

/** The icon of a selected frame that may be changed opens the menu of diagram types. */
function DiagramMenu({
  id,
  diagramType,
  enabled,
  children,
}: {
  id: string;
  diagramType: string | null;
  enabled: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { setDiagramType } = useCanvasActions();
  if (!enabled) return children;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="nodrag grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        aria-label={t('canvas.changeDiagramType')}
      >
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        {DIAGRAM_TYPE_CHOICES.map((choice) => {
          const ChoiceIcon = diagramIcon(choice);
          const current = isDiagramType(diagramType) ? diagramType : null;
          return (
            <DropdownMenuItem
              key={choice ?? 'none'}
              onSelect={() => {
                setDiagramType(id, choice);
              }}
            >
              <ChoiceIcon size={15} strokeWidth={1.8} className="text-text-2" aria-hidden="true" />
              {t(`canvas.diagramTypes.${choice ?? 'none'}`)}
              {choice === current ? (
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
