import { AGENT_KEYS, EDGE_LABEL_MAX_LENGTH, type AgentKey } from '@covibes/shared';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AGENT_LABEL, agentColor } from '@web/features/canvas/agent-look';
import { useCanvasActions } from '@web/features/canvas/canvas-actions';
import type { ArrowFlowEdge } from '@web/features/canvas/flow-mapping';
import { useFocusOnMount, useInPlaceEditing } from '@web/features/canvas/in-place-editing';

import { useJustDrawnBy } from '@web/features/canvas/use-just-drawn';
import { cn } from '@web/lib/cn';

type MarkerTone = 'edge' | 'ink' | AgentKey;

function markerId(tone: MarkerTone) {
  return `covibes-arrowhead-${tone}`;
}

const TONE_COLOR: Record<'edge' | 'ink', string> = {
  edge: 'var(--color-edge)',
  ink: 'var(--color-ink)',
};

/**
 * The filled arrowheads of the handoff, one per color. Rendered once per board; arrows refer to
 * them by id.
 */
export function ArrowMarkers() {
  const tones: MarkerTone[] = ['edge', 'ink', ...AGENT_KEYS];
  return (
    <svg className="absolute size-0" aria-hidden="true">
      <defs>
        {tones.map((tone) => (
          <marker
            key={tone}
            id={markerId(tone)}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path
              d="M0 0 L10 5 L0 10 z"
              style={{
                fill: tone === 'edge' || tone === 'ink' ? TONE_COLOR[tone] : agentColor(tone),
              }}
            />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

/**
 * An arrow between two blocks (spec 09, handoff "Arrows"): a cubic Bézier in `edge` at 1.5 px
 * with a filled head and a mono label pill in the middle. Right after an agent drew it or its
 * target, it is drawn in the agent's color at 1.75 px; a selected arrow is graphite.
 */
export function CanvasArrow({ id, data, selected }: EdgeProps<ArrowFlowEdge>) {
  const actions = useCanvasActions();
  const justDrawnBy = useJustDrawnBy(
    data ?? { changedByAgent: null, lastChangedAt: new Date(0).toISOString() },
  );
  const geometry = data?.geometry;
  if (!data || !geometry) return null;

  const tone: MarkerTone = selected ? 'ink' : (justDrawnBy ?? 'edge');
  const stroke = tone === 'edge' || tone === 'ink' ? TONE_COLOR[tone] : agentColor(tone);
  const editing = actions.editingId === id;

  return (
    <>
      <BaseEdge
        id={id}
        path={geometry.path}
        markerEnd={`url(#${markerId(tone)})`}
        interactionWidth={16}
        style={{ stroke, strokeWidth: justDrawnBy && !selected ? 1.75 : 1.5 }}
      />
      {editing || data.label ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${String(geometry.label.x)}px, ${String(geometry.label.y)}px)`,
            }}
          >
            {editing ? (
              <LabelEditor id={id} label={data.label} />
            ) : (
              <span
                className={cn(
                  'flex h-5 items-center rounded-sm border px-[7px] font-mono text-badge whitespace-nowrap',
                  justDrawnBy && !selected
                    ? AGENT_LABEL[justDrawnBy]
                    : 'border-border-float bg-bg-panel text-text-2b',
                )}
              >
                {data.label}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function LabelEditor({ id, label }: { id: string; label: string }) {
  const { t } = useTranslation();
  const { finishEdgeEditing } = useCanvasActions();
  const [draft, setDraft] = useState(label);
  const { onKeyDown, onBlur } = useInPlaceEditing((save) => {
    finishEdgeEditing(id, save ? draft : null);
  });
  const input = useFocusOnMount<HTMLInputElement>();

  return (
    <input
      ref={input}
      value={draft}
      maxLength={EDGE_LABEL_MAX_LENGTH}
      size={Math.max(6, draft.length + 1)}
      aria-label={t('canvas.edgeLabel')}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className="h-5 rounded-sm border border-ink bg-bg-panel px-[7px] font-mono text-badge text-text-2b outline-none"
    />
  );
}
