import {
  AGENT_KEYS,
  CUSTOM_AGENT_COLORS,
  EDGE_LABEL_MAX_LENGTH,
  type AgentKey,
} from '@covibes/shared';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentClass, agentColor, useAgents, type AgentInfo } from '@web/features/agents/agents';
import { AGENT_LABEL } from '@web/features/canvas/agent-look';
import { useCanvasActions } from '@web/features/canvas/canvas-actions';
import type { ArrowFlowEdge } from '@web/features/canvas/flow-mapping';
import { useFocusOnMount, useInPlaceEditing } from '@web/features/canvas/in-place-editing';

import { useJustDrawnBy } from '@web/features/canvas/use-just-drawn';
import { cn } from '@web/lib/cn';

/** One arrowhead per color: the two neutral ones, every catalog agent and every custom color. */
type AgentTone = AgentKey | `custom-${string}`;
type MarkerTone = 'edge' | 'ink' | AgentTone;

function markerId(tone: MarkerTone) {
  return `covibes-arrowhead-${tone}`;
}

function toneOf(agent: Pick<AgentInfo, 'look' | 'color'>): AgentTone {
  return agent.look === 'custom' ? `custom-${String(agent.color ?? 5)}` : agent.look;
}

/** The look a marker tone stands for. */
function lookOf(tone: AgentTone): Pick<AgentInfo, 'look' | 'color'> {
  return tone.startsWith('custom-')
    ? { look: 'custom', color: Number(tone.slice('custom-'.length)) }
    : { look: tone as AgentKey, color: null };
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
  const tones: MarkerTone[] = [
    'edge',
    'ink',
    ...AGENT_KEYS,
    ...CUSTOM_AGENT_COLORS.map((color): AgentTone => `custom-${String(color)}`),
  ];
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
                fill:
                  tone === 'edge' || tone === 'ink' ? TONE_COLOR[tone] : agentColor(lookOf(tone)),
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
  const agents = useAgents();
  const justDrawnKey = useJustDrawnBy(
    data ?? { changedByAgent: null, lastChangedAt: new Date(0).toISOString() },
  );
  const justDrawnBy = justDrawnKey ? agents(justDrawnKey) : null;
  const geometry = data?.geometry;
  if (!data || !geometry) return null;

  const tone: MarkerTone = selected ? 'ink' : justDrawnBy ? toneOf(justDrawnBy) : 'edge';
  const stroke =
    selected || !justDrawnBy ? TONE_COLOR[selected ? 'ink' : 'edge'] : agentColor(justDrawnBy);
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
                    ? agentClass(AGENT_LABEL, justDrawnBy)
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
